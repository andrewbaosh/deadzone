import * as THREE from 'three';

/**
 * 第八波·空战用的战斗机。
 *  - PlayerJet：玩家驾驶的战机（模型/机头世界坐标；飞行、相机、开火在 main.js 里控）
 *  - ZombieJet：僵尸驾驶的敌机（自带绕飞 AI，会朝玩家开火）
 * 机头方向 = 本地 -Z。
 */
function buildJet(c) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: c.body, roughness: 0.5, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: c.dark, roughness: 0.6, metalness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: c.glass, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.75 });

  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 4.2, 12), body);
  fus.rotation.x = Math.PI / 2; g.add(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.5, 12), body);
  nose.rotation.x = -Math.PI / 2; nose.position.z = -2.75; g.add(nose);
  const cp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), glass);
  cp.scale.set(1, 0.62, 1.5); cp.position.set(0, 0.34, -0.7); g.add(cp);
  // 主翼（带一点后掠：用两块斜置的板）
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.12, 1.25), dark);
    wing.position.set(sx * 1.7, 0, 0.5); wing.rotation.y = sx * 0.35; g.add(wing);
  }
  // 垂尾
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.95), dark);
  fin.position.set(0, 0.5, 1.9); g.add(fin);
  // 平尾
  for (const sx of [-1, 1]) {
    const tp = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 0.6), dark);
    tp.position.set(sx * 0.75, 0, 1.9); tp.rotation.y = sx * 0.25; g.add(tp);
  }
  // 尾喷口辉光
  const glowMat = new THREE.MeshBasicMaterial({ color: c.glow, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 14), glowMat);
  glow.position.z = 2.16; glow.rotation.y = Math.PI; g.add(glow);

  g.traverse((o) => { if (o.isMesh && o.material !== glowMat) o.castShadow = true; });
  return { group: g, glow };
}

const PLAYER_COLORS = { body: 0x5a6b8a, dark: 0x2f3c52, glass: 0x8fd8f0, glow: 0x66ccff };
const ZOMBIE_COLORS = { body: 0x4a5a30, dark: 0x2a3018, glass: 0x9a3a3a, glow: 0xff5522 };

export class PlayerJet {
  constructor(scene) {
    const b = buildJet(PLAYER_COLORS);
    this.root = b.group; this.glow = b.glow; this.scene = scene;
    this.root.rotation.order = 'YXZ';
    scene.add(this.root);
  }
  // 机头世界坐标（机炮/导弹发射起点）
  noseWorld(out) { out.set(0, 0, -3.5); this.root.localToWorld(out); return out; }
  remove() { this.scene.remove(this.root); }
}

export class ZombieJet {
  constructor(scene, pos, cfg) {
    const b = buildJet(ZOMBIE_COLORS);
    this.root = b.group; this.glow = b.glow; this.scene = scene; this.cfg = cfg;
    this.root.rotation.order = 'YXZ';
    this.root.position.copy(pos);
    this.hp = cfg.生命; this.maxHp = cfg.生命; this.dead = false;
    this.phase = Math.random() * Math.PI * 2;
    this.spin = (Math.random() < 0.5 ? 1 : -1);
    this.hFreq = 0.5 + Math.random() * 0.6;
    this.fireCd = 1 + Math.random() * cfg.开火间隔;
    this._to = new THREE.Vector3();
    scene.add(this.root);
  }
  takeDamage(d) {
    if (this.dead) return false;
    this.hp -= d;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; return true; }
    return false;
  }
  // 绕着玩家飞，间歇朝玩家开火。返回 {fire,from,dir} 表示这帧开了一枪
  update(dt, targetPos) {
    this.phase += dt * 0.35 * this.spin;
    const c = this.cfg;
    const desired = this._to.set(
      targetPos.x + Math.cos(this.phase) * c.环绕半径,
      targetPos.y + Math.sin(this.phase * this.hFreq) * 22,
      targetPos.z + Math.sin(this.phase) * c.环绕半径,
    ).sub(this.root.position);
    const dist = desired.length();
    if (dist > 0.001) desired.multiplyScalar(1 / dist);
    this.root.position.addScaledVector(desired, c.速度 * dt);
    // 机头对准飞行方向（-Z 面向 desired）
    this.root.rotation.y = Math.atan2(-desired.x, -desired.z);
    this.root.rotation.x = Math.asin(Math.max(-1, Math.min(1, desired.y)));
    this.root.rotation.z = -this.spin * 0.35;
    if (this.glow) this.glow.material.opacity = 0.5 + 0.35 * Math.random();

    this.fireCd -= dt;
    if (this.fireCd <= 0) {
      this.fireCd = c.开火间隔 * (0.7 + Math.random() * 0.7);
      const from = this.root.position.clone();
      const dir = targetPos.clone().sub(from).normalize();
      return { fire: true, from, dir };
    }
    return null;
  }
  remove() { this.scene.remove(this.root); }
}

/**
 * 友军僚机（第八波·简单模式）。跟在玩家附近飞，自动朝最近的僵尸战机开火。
 * 子弹由 main.js 复用玩家机炮管线（打僵尸战机）。
 */
export class AllyJet {
  constructor(scene, pos, side, cfg) {
    const b = buildJet(PLAYER_COLORS);
    this.root = b.group; this.glow = b.glow; this.scene = scene; this.cfg = cfg;
    this.root.rotation.order = 'YXZ';
    this.root.position.copy(pos);
    this.side = side;                       // 站位偏移方向 (-1/1)
    this.fireCd = 0.5 + Math.random();
    this._to = new THREE.Vector3();
    scene.add(this.root);
  }
  update(dt, playerPos, playerFwd, enemyJets) {
    const rx = -playerFwd.z, rz = playerFwd.x;   // 水平右向量
    const desired = this._to.set(
      playerPos.x - playerFwd.x * 14 + rx * this.side * 16,
      playerPos.y + 4 * this.side,
      playerPos.z - playerFwd.z * 14 + rz * this.side * 16,
    ).sub(this.root.position);
    const dist = desired.length();
    if (dist > 0.001) desired.multiplyScalar(1 / dist);
    const followSp = Math.min(this.cfg.玩家速度 * 1.2, 20 + dist * 2);
    this.root.position.addScaledVector(desired, followSp * dt);
    let best = null, bestD = Infinity;
    for (const jz of enemyJets) { if (jz.dead) continue; const dd = jz.root.position.distanceToSquared(this.root.position); if (dd < bestD) { bestD = dd; best = jz; } }
    let aim;
    if (best) aim = best.root.position.clone().sub(this.root.position).normalize();
    else aim = desired.clone();
    this.root.rotation.y = Math.atan2(-aim.x, -aim.z);
    this.root.rotation.x = Math.asin(Math.max(-1, Math.min(1, aim.y)));
    if (this.glow) this.glow.material.opacity = 0.6 + 0.4 * Math.random();
    this.fireCd -= dt;
    if (best && bestD < 480 * 480 && this.fireCd <= 0) {
      this.fireCd = 0.12;                   // 速射
      const from = this.root.position.clone().addScaledVector(aim, 3.5);
      return { fire: true, from, dir: aim };
    }
    return null;
  }
  remove() { this.scene.remove(this.root); }
}
