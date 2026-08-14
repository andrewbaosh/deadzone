import * as THREE from 'three';

const _FWD = new THREE.Vector3(0, 0, 1);

/**
 * 会飞的火箭弹。发射后沿方向飞行，撞到敌人/墙/地面/飞到最大射程就爆炸。
 * update() 返回 { explode:true, point, direct } 时，由 main.js 触发爆炸。
 */
export class Rocket {
  constructor(scene, origin, dir, cfg, hitMeshes) {
    this.scene = scene;
    this.cfg = cfg;
    this.dir = dir.clone().normalize();
    this.pos = origin.clone();
    this.speed = cfg.弹速;
    this.age = 0;
    this.life = cfg.射程 / cfg.弹速 + 0.3;
    this.hitMeshes = hitMeshes;
    this.ray = new THREE.Raycaster();

    // 制导（追踪导弹）：发射后锁定并转向敌人
    this.homing = !!cfg.追踪;
    this.turnRate = cfg.转向 || 3.2;   // 每秒最多转多少弧度
    this.target = null;
    this._t1 = new THREE.Vector3();
    this._t2 = new THREE.Vector3();

    // 弹体：暗色弹身 + 发光弹头 + 尾焰
    this.group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 10), bodyMat);
    body.rotation.x = Math.PI / 2;
    this.group.add(body);
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x992222, roughness: 0.5, emissive: 0x551111 });
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.22, 10), noseMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = -0.34;
    this.group.add(nose);
    // 尾焰（加色发光）
    this.flameMat = new THREE.MeshBasicMaterial({
      color: 0xffcc55, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.6, 8), this.flameMat);
    this.flame.rotation.x = -Math.PI / 2;
    this.flame.position.z = 0.5;
    this.group.add(this.flame);
    // 弹头照明
    this.light = new THREE.PointLight(0xff8844, 8, 6, 2);
    this.group.add(this.light);

    this.group.position.copy(this.pos);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.dir);
    scene.add(this.group);

    // 烟雾尾迹
    this.smokes = [];
    this.smokeTimer = 0;
    this.smokeGeo = new THREE.SphereGeometry(0.16, 6, 5);
  }

  update(dt, enemies) {
    this.age += dt;
    if (this.homing) this._steer(dt, enemies);
    const step = this.speed * dt;
    const from = this.pos.clone();
    const to = this.pos.clone().addScaledVector(this.dir, step);

    // 1) 撞敌人（线段 vs 敌人身体近似球）
    let hitEnemy = null, hitT = Infinity;
    for (const en of enemies) {
      if (en.dead || en.airborne) continue;
      const c = en.root.position;
      const cy = en.flying ? c.y + 0.5 : 1.0 * en.scaleFactor;   // 会飞的在空中
      const center = new THREE.Vector3(c.x, cy, c.z);
      const t = this._closestOnSeg(from, to, center);
      const cp = from.clone().addScaledVector(this.dir, t * step);
      const rr = 0.55 * en.scaleFactor + 0.2;
      if (cp.distanceToSquared(center) <= rr * rr && t < hitT) {
        hitT = t; hitEnemy = en;
        this._enemyHitPoint = cp;
      }
    }

    // 2) 撞环境（射线检测这一步的距离）
    this.ray.set(from, this.dir);
    this.ray.far = step + 0.05;
    const envHits = this.hitMeshes ? this.ray.intersectObjects(this.hitMeshes, false) : [];
    const envHit = envHits.length ? envHits[0] : null;

    // 谁更近就先炸
    if (hitEnemy && (!envHit || hitT * step <= envHit.distance)) {
      return { explode: true, point: this._enemyHitPoint.clone(), direct: hitEnemy };
    }
    if (envHit) {
      return { explode: true, point: envHit.point.clone(), direct: null };
    }

    // 3) 落地 / 超时
    if (to.y <= 0.15) { to.y = 0.15; return { explode: true, point: to, direct: null }; }
    if (this.age >= this.life) return { explode: true, point: to, direct: null };

    // 前进 + 尾迹
    this.pos.copy(to);
    this.group.position.copy(this.pos);
    this.flame.scale.z = 0.8 + Math.random() * 0.6;
    this.updateSmoke(dt);
    return null;
  }

  /** 制导：锁定并平滑转向目标（保持当前目标，死了才重新锁） */
  _steer(dt, enemies) {
    if (!this.target || this.target.dead) this.target = this._acquire(enemies);
    const en = this.target;
    if (!en || en.dead) return;
    const c = en.root.position;
    const cy = en.flying ? c.y + 0.5 : 1.0 * en.scaleFactor;
    const desired = this._t1.set(c.x - this.pos.x, cy - this.pos.y, c.z - this.pos.z);
    if (desired.lengthSq() < 1e-6) return;
    desired.normalize();
    const angle = this.dir.angleTo(desired);
    if (angle > 1e-4) {
      const t = Math.min(1, (this.turnRate * dt) / angle);
      this.dir.lerp(desired, t).normalize();
      this.group.quaternion.setFromUnitVectors(_FWD, this.dir);
    }
  }

  /** 挑一个"最接近当前朝向、够近"的敌人锁定 */
  _acquire(enemies) {
    let best = null, bestScore = -Infinity;
    for (const en of enemies) {
      if (en.dead || en.airborne) continue;
      const c = en.root.position;
      const cy = en.flying ? c.y + 0.5 : 1.0 * en.scaleFactor;
      const to = this._t2.set(c.x - this.pos.x, cy - this.pos.y, c.z - this.pos.z);
      const dist = to.length();
      if (dist > 48 || dist < 0.1) continue;
      to.divideScalar(dist);
      const dot = this.dir.dot(to);
      if (dot < 0.2) continue;                 // 只锁前方约 78° 锥内
      const score = dot - dist * 0.008;        // 朝向优先，略偏近
      if (score > bestScore) { bestScore = score; best = en; }
    }
    return best;
  }

  _closestOnSeg(a, b, p) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz || 1e-6;
    let t = (apx * abx + apy * aby + apz * abz) / len2;
    return Math.max(0, Math.min(1, t));
  }

  updateSmoke(dt) {
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.02;
      const m = new THREE.Mesh(this.smokeGeo, new THREE.MeshBasicMaterial({
        color: 0x888888, transparent: true, opacity: 0.35, depthWrite: false,
      }));
      m.position.copy(this.pos).addScaledVector(this.dir, -0.3);
      m.userData.age = 0;
      this.scene.add(m);
      this.smokes.push(m);
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.userData.age += dt;
      const k = s.userData.age / 0.5;
      if (k >= 1) { this.scene.remove(s); s.material.dispose(); this.smokes.splice(i, 1); continue; }
      s.material.opacity = 0.35 * (1 - k);
      s.scale.setScalar(1 + k * 2);
    }
  }

  remove() {
    this.scene.remove(this.group);
    for (const s of this.smokes) { this.scene.remove(s); s.material.dispose(); }
    this.smokes.length = 0;
  }
}
