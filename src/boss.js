import * as THREE from 'three';
import { greedyMesh } from './graphics/voxel/greedyMesh.js';
import { BOSS } from './config/gameplay.js';
import { playExplosion } from './audio.js';

/* ---------------- 体素大 Boss 模型（巨型腐化怪） ---------------- */
const BVS = 0.13;
const FLESH = 0x4a6a3a, FLESH2 = 0x3c5830, FLESHD = 0x2e4426, BONE = 0xcabf9e,
  BLOOD = 0x6a1a14, CLAW = 0x1a1c18, DARK = 0x20281c;
const bx = (x, y, z, x0, x1, y0, y1, z0, z1) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
function bh(x, y, z) { let h = (x * 3671 + y * 9173 + z * 4517) & 0x7fffffff; h = (h ^ (h >> 13)) & 0x7fffffff; return (h & 255) / 255; }

// 返回 [颜色, 部件('body'|'head')]
function brute(x, y, z) {
  const cx = 8;
  // 头（顶部，弱点）
  if (bx(x, y, z, cx - 4, cx + 4, 25, 31, 3, 10)) {
    if (z >= 9 && y >= 27 && y <= 29 && (x < cx - 1 || x > cx + 1)) return [DARK, 'head'];   // 眼窝
    if (bh(x, y, z) < 0.12) return [BONE, 'head'];
    return bh(x, y, z) < 0.3 ? [FLESH2, 'head'] : [FLESH, 'head'];
  }
  // 躯干（大块，前倾）
  if (bx(x, y, z, cx - 6, cx + 6, 12, 25, 2, 11)) {
    if (bh(x, y, z) < 0.06) return [BLOOD, 'body'];
    if (y > 22 && (x < cx - 4 || x > cx + 4)) return [BONE, 'body'];   // 肩部露骨
    if ((x + y) % 5 === 0) return [FLESHD, 'body'];
    return bh(x + 3, y, z) < 0.3 ? [FLESH2, 'body'] : [FLESH, 'body'];
  }
  // 手臂（两侧大臂垂到地）
  for (const sx of [cx - 8, cx + 8]) {
    if (bx(x, y, z, sx - 2, sx + 2, 2, 22, 4, 9)) {
      if (y < 5) return [CLAW, 'body'];                 // 爪
      return bh(x, y + 1, z) < 0.25 ? [FLESH2, 'body'] : [FLESH, 'body'];
    }
  }
  // 腿（两条粗腿）
  for (const lx of [cx - 3, cx + 3]) {
    if (bx(x, y, z, lx - 2, lx + 2, 0, 13, 4, 9)) {
      if (y < 2) return [CLAW, 'body'];
      return bh(x, y, z + 2) < 0.28 ? [FLESHD, 'body'] : [FLESH2, 'body'];
    }
  }
  return null;
}
function bossParts() {
  const sx = 17, sy = 32, sz = 13;
  const origin = new THREE.Vector3(-sx * BVS / 2, 0, -sz * BVS / 2);
  const vol = (want) => ({ sx, sy, sz, get: (x, y, z) => { const r = brute(x, y, z); return r && r[1] === want ? r[0] : -1; } });
  return {
    body: greedyMesh(vol('body'), BVS, origin).geometry,
    head: greedyMesh(vol('head'), BVS, origin).geometry,
    headY: 27 * BVS, eyeY: 28 * BVS, eyeZ: 9.5 * BVS, eyeX: 2.2 * BVS,
    height: sy * BVS,
  };
}

/* ---------------- Boss ---------------- */
export class Boss {
  constructor(scene, pos, wave, hooks) {
    this.scene = scene;
    this.hooks = hooks;   // { damagePlayer, knockback, shake, aimDisrupt, dropSupply }
    this.dead = false;

    const over = Math.max(0, wave - BOSS.出现波数);
    this.maxHp = BOSS.生命 * Math.pow(BOSS.每波加成, over);
    this.hp = this.maxHp;
    this.scaleFactor = BOSS.体型;
    this.speed = BOSS.移动速度;

    const P = bossParts();
    this.root = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85 });
    this.bodyMat = bodyMat;
    this.body = new THREE.Mesh(P.body, bodyMat);
    this.head = new THREE.Mesh(P.head, this.headMat);
    this.body.castShadow = this.head.castShadow = true;
    this.root.add(this.body, this.head);
    this.root.scale.setScalar(this.scaleFactor);
    // 发光红眼
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3322, toneMapped: false });
    const eyeGeo = new THREE.BoxGeometry(0.16, 0.12, 0.06);
    for (const sx of [-P.eyeX, P.eyeX]) {
      const e = new THREE.Mesh(eyeGeo, eyeMat); e.position.set(sx, P.eyeY, P.eyeZ); this.root.add(e);
    }
    this.height = P.height * this.scaleFactor;
    this.root.position.copy(pos); this.root.position.y = 0;
    this.root.traverse((o) => { if (o.isMesh) o.userData.boss = this; });
    scene.add(this.root);
    this.hitMeshes = [this.head, this.body];

    // 攻击计时
    this.bombTimer = 3; this.stompTimer = 4; this.fireballTimer = 2.5;
    this.pendingBomb = null;
    this.shock = null;
    this.fireballs = [];
    this.nextDropAt = this.maxHp * (1 - BOSS.掉落血量间隔);
    this.hurtFlash = 0;
    this._tmp = new THREE.Vector3();
  }

  takeDamage(dmg, isHead, effects) {
    if (this.dead) return false;
    this.hp -= dmg * (isHead ? BOSS.头部倍率 : 1);
    this.hurtFlash = 0.08;
    if (this.hp <= this.nextDropAt && this.hp > 0) {
      this.nextDropAt -= this.maxHp * BOSS.掉落血量间隔;
      const p = this.root.position;
      this.hooks.dropSupply(new THREE.Vector3(p.x + (Math.random() - 0.5) * 4, 0, p.z + (Math.random() - 0.5) * 4));
    }
    if (this.hp <= 0) { this.hp = 0; this.dead = true; return true; }
    return false;
  }

  update(dt, playerPos, effects) {
    if (this.dead) return;
    const pos = this.root.position;

    // 受击闪红
    if (this.hurtFlash > 0) { this.hurtFlash -= dt; const f = Math.max(0, this.hurtFlash / 0.08); this.bodyMat.emissive.setRGB(f, 0, 0); this.headMat.emissive.setRGB(f, 0, 0); }

    // 缓慢面向并逼近玩家
    const to = this._tmp.set(playerPos.x - pos.x, 0, playerPos.z - pos.z);
    const dist = to.length(); to.normalize();
    this.root.rotation.y = Math.atan2(to.x, to.z);
    if (dist > 6) { pos.x += to.x * this.speed * dt; pos.z += to.z * this.speed * dt; }
    // 走路轻微起伏
    this.root.position.y = Math.abs(Math.sin(performance.now() * 0.002)) * 0.06;

    this._updateBomb(dt, playerPos, effects);
    this._updateStomp(dt, playerPos, dist, effects);
    this._updateFireballs(dt, playerPos, effects);
  }

  /* ① 区域轰炸 */
  _updateBomb(dt, playerPos, effects) {
    if (this.pendingBomb) {
      const b = this.pendingBomb;
      b.t -= dt;
      const k = 1 - b.t / BOSS.轰炸预警;
      b.decal.material.opacity = 0.3 + 0.4 * Math.abs(Math.sin(b.t * 12));
      b.decal.scale.setScalar(0.4 + k * 0.6);
      if (b.t <= 0) {
        effects.addExplosion(b.pos, BOSS.轰炸半径);
        playExplosion();
        this.hooks.shake(0.5);
        const pd = Math.hypot(playerPos.x - b.pos.x, playerPos.z - b.pos.z);
        if (pd < BOSS.轰炸半径) {
          this.hooks.damagePlayer(BOSS.轰炸伤害 * (1 - pd / BOSS.轰炸半径), b.pos);
          this.hooks.knockback(playerPos.x - b.pos.x, playerPos.z - b.pos.z, 6, 4);
        }
        this.scene.remove(b.decal); b.decal.geometry.dispose(); b.decal.material.dispose();
        this.pendingBomb = null;
      }
      return;
    }
    this.bombTimer -= dt;
    if (this.bombTimer <= 0) {
      this.bombTimer = BOSS.轰炸间隔;
      const pos = new THREE.Vector3(playerPos.x, 0.06, playerPos.z);
      const geo = new THREE.RingGeometry(BOSS.轰炸半径 * 0.7, BOSS.轰炸半径, 40);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff3322, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
      const decal = new THREE.Mesh(geo, mat); decal.rotation.x = -Math.PI / 2; decal.position.copy(pos);
      this.scene.add(decal);
      this.pendingBomb = { pos, t: BOSS.轰炸预警, decal };
    }
  }

  /* ② 跺脚冲击波（无伤害，震开+扰瞄） */
  _updateStomp(dt, playerPos, dist, effects) {
    if (this.shock) {
      this.shock.r += 26 * dt;
      this.shock.mesh.scale.setScalar(this.shock.r);
      this.shock.mesh.material.opacity = Math.max(0, 0.6 - this.shock.r / 30);
      if (!this.shock.hit && this.shock.r >= dist - 0.5) {
        this.shock.hit = true;
        const pos = this.root.position;
        this.hooks.knockback(playerPos.x - pos.x, playerPos.z - pos.z, BOSS.跺脚击退, 3);
        this.hooks.shake(0.7);
        this.hooks.aimDisrupt(BOSS.跺脚扰瞄);
      }
      if (this.shock.r > 30) { this.scene.remove(this.shock.mesh); this.shock.mesh.geometry.dispose(); this.shock.mesh.material.dispose(); this.shock = null; }
      return;
    }
    this.stompTimer -= dt;
    if (this.stompTimer <= 0 && dist < BOSS.跺脚触发距离) {
      this.stompTimer = BOSS.跺脚间隔;
      const geo = new THREE.RingGeometry(0.9, 1.0, 40);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(geo, mat); mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(this.root.position.x, 0.1, this.root.position.z);
      this.scene.add(mesh);
      this.shock = { mesh, r: 1, hit: false };
      this.hooks.shake(0.3);
    }
  }

  /* ③ 滚地火球 */
  _updateFireballs(dt, playerPos, effects) {
    this.fireballTimer -= dt;
    if (this.fireballTimer <= 0) {
      this.fireballTimer = BOSS.火球间隔;
      const pos = this.root.position;
      for (let i = 0; i < BOSS.火球数量; i++) {
        const dir = new THREE.Vector3(playerPos.x - pos.x, 0, playerPos.z - pos.z).normalize();
        const spread = (i - (BOSS.火球数量 - 1) / 2) * 0.25;
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
        const geo = new THREE.SphereGeometry(0.42, 10, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff7722, toneMapped: false });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(pos.x + dir.x * 1.5, 0.45, pos.z + dir.z * 1.5);
        this.scene.add(m);
        this.fireballs.push({ mesh: m, vel: dir.multiplyScalar(BOSS.火球速度), life: BOSS.火球存活 });
      }
    }
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      f.life -= dt;
      f.mesh.position.x += f.vel.x * dt;
      f.mesh.position.z += f.vel.z * dt;
      f.mesh.rotation.x += dt * 8; f.mesh.rotation.z += dt * 5;
      const pd = Math.hypot(f.mesh.position.x - playerPos.x, f.mesh.position.z - playerPos.z);
      if (pd < 1.1) { this.hooks.damagePlayer(BOSS.火球伤害, f.mesh.position); f.life = 0; }
      if (f.life <= 0) { this.scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); this.fireballs.splice(i, 1); }
    }
  }

  remove() {
    this.scene.remove(this.root);
    for (const f of this.fireballs) this.scene.remove(f.mesh);
    if (this.shock) this.scene.remove(this.shock.mesh);
    if (this.pendingBomb) this.scene.remove(this.pendingBomb.decal);
  }
}
