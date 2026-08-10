import * as THREE from 'three';
import { greedyMesh } from './graphics/voxel/greedyMesh.js';
import { 步枪Boss } from './config/gameplay.js';

/* ---------------- 体素模型：持枪的「沙漠尖兵」（直立人形巨怪 + 突击步枪） ---------------- */
const BVS = 0.15;
const ARMOR = 0x39413a, ARMOR2 = 0x2b322c, PLATE = 0x4a5346, CLOTH = 0x715f3c,
  SKIN = 0x5c6f49, SKIN2 = 0x4a5b3a, BONE = 0xcabf9e, GUN = 0x23262b, GUN2 = 0x14161a,
  STRAP = 0x2a2018, MUZ = 0x0a0b0d;
const bx = (x, y, z, a, b, c, d, e, f) => x >= a && x <= b && y >= c && y <= d && z >= e && z <= f;
function nz(x, y, z) { let h = (x * 3671 + y * 9173 + z * 4517) & 0x7fffffff; h = (h ^ (h >> 13)) & 0x7fffffff; return (h & 255) / 255; }

// 返回 [颜色, 部件('body'|'head'|'gun')]；模型 +z 为正面（朝玩家），枪口在最前
function soldier(x, y, z) {
  const cx = 9;
  // 头（弱点）
  if (bx(x, y, z, cx - 3, cx + 3, 18, 24, 7, 13)) {
    if (z >= 12 && y >= 20 && y <= 21 && (x < cx - 1 || x > cx + 1)) return [0x120f0e, 'head'];   // 眼窝
    if (nz(x, y, z) < 0.12) return [BONE, 'head'];
    return nz(x, y, z) < 0.35 ? [SKIN2, 'head'] : [SKIN, 'head'];
  }
  // 颈
  if (bx(x, y, z, cx - 2, cx + 2, 17, 18, 8, 12)) return [SKIN2, 'body'];
  // 躯干护甲
  if (bx(x, y, z, cx - 6, cx + 6, 9, 17, 6, 13)) {
    if (y >= 15 && (x < cx - 4 || x > cx + 4)) return [BONE, 'body'];         // 肩甲露骨
    if (((x + 17 - y) % 5) === 0 && z >= 12) return [STRAP, 'body'];          // 斜挎弹链
    if ((x + y) % 4 === 0) return [ARMOR2, 'body'];
    if (z >= 12) return [PLATE, 'body'];                                       // 前胸板亮一点
    return nz(x + 2, y, z) < 0.3 ? [ARMOR2, 'body'] : [ARMOR, 'body'];
  }
  // 双腿
  for (const lx of [cx - 4, cx + 4]) {
    if (bx(x, y, z, lx - 2, lx + 1, 0, 9, 7, 12)) {
      if (y < 2) return [GUN2, 'body'];                                        // 靴
      return (y % 3 === 0) ? [CLOTH, 'body'] : [(nz(x, y, z) < 0.4 ? ARMOR2 : CLOTH), 'body'];
    }
  }
  // 左臂（前伸托住护木）
  if (bx(x, y, z, cx - 8, cx - 5, 11, 16, 7, 10)) return [ARMOR, 'body'];      // 上臂
  if (bx(x, y, z, cx - 6, cx - 3, 12, 14, 13, 17)) return [SKIN2, 'body'];     // 前臂搭枪
  // 右臂（握把）
  if (bx(x, y, z, cx + 5, cx + 8, 11, 16, 7, 11)) return [ARMOR, 'body'];
  if (bx(x, y, z, cx + 3, cx + 5, 11, 13, 11, 14)) return [SKIN2, 'body'];
  // ===== 突击步枪（part 'gun'），沿 +z 指向玩家 =====
  if (bx(x, y, z, cx - 1, cx + 1, 12, 14, 10, 18)) return [(z % 2) ? GUN : GUN2, 'gun'];  // 机匣
  if (bx(x, y, z, cx, cx, 12, 13, 18, 21)) return [GUN2, 'gun'];               // 枪管
  if (z === 21 && x === cx && y === 12) return [MUZ, 'gun'];                    // 枪口
  if (bx(x, y, z, cx - 1, cx, 9, 12, 13, 15)) return [GUN2, 'gun'];            // 弹匣
  if (bx(x, y, z, cx - 1, cx + 1, 12, 14, 7, 10)) return [GUN, 'gun'];         // 枪托
  if (bx(x, y, z, cx, cx, 14, 15, 13, 15)) return [GUN2, 'gun'];               // 顶部瞄具
  return null;
}

function soldierParts() {
  const sx = 18, sy = 26, sz = 22;
  const origin = new THREE.Vector3(-sx * BVS / 2, 0, -sz * BVS / 2);
  const vol = (want) => ({ sx, sy, sz, get: (x, y, z) => { const r = soldier(x, y, z); return r && r[1] === want ? r[0] : -1; } });
  return {
    body: greedyMesh(vol('body'), BVS, origin).geometry,
    head: greedyMesh(vol('head'), BVS, origin).geometry,
    gun: greedyMesh(vol('gun'), BVS, origin).geometry,
    eyeX: 2 * BVS, eyeY: 20.5 * BVS, eyeZ: 13 * BVS,
    muzzle: new THREE.Vector3(0, 12.5 * BVS + origin.y, 21.5 * BVS + origin.z),
    height: sy * BVS,
  };
}

/* ---------------- RifleBoss ---------------- */
export class RifleBoss {
  constructor(scene, pos, wave, hooks) {
    this.kind = 'rifle';
    this.scene = scene;
    this.hooks = hooks;   // { damagePlayer, shake, dropSupply, shoot }
    this.dead = false;

    const over = Math.max(0, wave - 步枪Boss.出现波数);
    this.maxHp = 步枪Boss.生命 * Math.pow(1.1, over);
    this.hp = this.maxHp;
    this.headMul = 步枪Boss.头部倍率;

    const P = soldierParts();
    this.root = new THREE.Group();
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.72, metalness: 0.25 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.55 });
    this.body = new THREE.Mesh(P.body, this.bodyMat);
    this.head = new THREE.Mesh(P.head, this.headMat);
    this.gun = new THREE.Mesh(P.gun, gunMat);
    this.body.castShadow = this.head.castShadow = this.gun.castShadow = true;
    this.root.add(this.body, this.head, this.gun);

    // 发光红眼
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3322, toneMapped: false });
    const eyeGeo = new THREE.BoxGeometry(0.14, 0.1, 0.05);
    for (const sx of [-P.eyeX, P.eyeX]) {
      const e = new THREE.Mesh(eyeGeo, eyeMat); e.position.set(sx, P.eyeY, P.eyeZ); this.root.add(e);
    }
    // 枪口火光/瞄准红光（同一片，颜色随状态变）
    this.muzzleLocal = P.muzzle.clone();
    this.muzzleFlash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    this.muzzleFlash.position.copy(this.muzzleLocal);
    this.muzzleFlash.visible = false;
    this.root.add(this.muzzleFlash);

    this.height = P.height;
    this.root.position.copy(pos); this.root.position.y = 0;
    this.root.traverse((o) => { if (o.isMesh) o.userData.boss = this; });
    scene.add(this.root);
    this.hitMeshes = [this.head, this.body, this.gun];

    // 战斗状态机
    this.state = 'move';            // move → aim → burst → move
    this.fireCd = 1.4;
    this.aimT = 0; this.shotT = 0; this.shotsLeft = 0; this.burstCount = 0;
    this.aimPoint = new THREE.Vector3();
    this.strafeDir = 1; this.strafeT = 1.5;
    this.nextDropAt = this.maxHp * (1 - 步枪Boss.掉落血量间隔);
    this.hurtFlash = 0; this._t = 0;
    this._tmp = new THREE.Vector3(); this._mw = new THREE.Vector3();
  }

  takeDamage(dmg, isHead, effects) {
    if (this.dead) return false;
    this.hp -= dmg * (isHead ? 步枪Boss.头部倍率 : 1);
    this.hurtFlash = 0.08;
    if (this.hp <= this.nextDropAt && this.hp > 0) {
      this.nextDropAt -= this.maxHp * 步枪Boss.掉落血量间隔;
      const p = this.root.position;
      this.hooks.dropSupply(new THREE.Vector3(p.x + (Math.random() - 0.5) * 4, 0, p.z + (Math.random() - 0.5) * 4));
    }
    if (this.hp <= 0) { this.hp = 0; this.dead = true; return true; }
    return false;
  }

  _muzzleWorld(out) { out.copy(this.muzzleLocal); this.root.localToWorld(out); return out; }

  update(dt, playerPos, effects) {
    if (this.dead) return;
    this._t += dt;
    const pos = this.root.position;

    // 受击闪红
    if (this.hurtFlash > 0) { this.hurtFlash -= dt; const f = Math.max(0, this.hurtFlash / 0.08); this.bodyMat.emissive.setRGB(f, 0, 0); this.headMat.emissive.setRGB(f, 0, 0); }

    // 面向玩家
    const to = this._tmp.set(playerPos.x - pos.x, 0, playerPos.z - pos.z);
    const dist = to.length() || 1; to.divideScalar(dist);
    this.root.rotation.y = Math.atan2(to.x, to.z);
    this.root.position.y = Math.abs(Math.sin(this._t * 3)) * 0.05;

    // 保持距离 + 侧移走位
    const KD = 步枪Boss.保持距离, RET = 步枪Boss.近战回避, sp = 步枪Boss.移动速度;
    let mvx = 0, mvz = 0;
    if (dist > KD + 2) { mvx = to.x; mvz = to.z; }
    else if (dist < RET) { mvx = -to.x; mvz = -to.z; }
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeT = 1.6 + Math.random() * 1.8; this.strafeDir *= -1; }
    mvx += to.z * this.strafeDir * 0.35; mvz += -to.x * this.strafeDir * 0.35;   // 垂直方向侧移（已调缓，好瞄）
    const ml = Math.hypot(mvx, mvz);
    if (ml > 0.001) { pos.x += (mvx / ml) * sp * dt; pos.z += (mvz / ml) * sp * dt; }
    pos.x = Math.max(-40, Math.min(40, pos.x)); pos.z = Math.max(-40, Math.min(40, pos.z));

    // 射击状态机
    this.fireCd -= dt;
    if (this.state === 'aim') {
      this.aimT -= dt;
      this.muzzleFlash.visible = true;
      this.muzzleFlash.material.color.setHex(0xff3020);                 // 红光预警
      this.muzzleFlash.material.opacity = 0.35 + 0.4 * Math.abs(Math.sin(this._t * 30));
      this.muzzleFlash.scale.setScalar(0.55);
      if (this.aimT <= 0) { this.state = 'burst'; this.shotsLeft = 步枪Boss.连射; this.shotT = 0; this.aimPoint.copy(playerPos); }
    } else if (this.state === 'burst') {
      this.shotT -= dt;
      if (this.shotT <= 0) {
        this.shotT = 步枪Boss.点射间隔;
        this._fireOne(playerPos, effects);
        if (--this.shotsLeft <= 0) {
          this.state = 'move';
          this.burstCount++;
          // 每若干次点射来一次长换弹（喘息）
          this.fireCd = (this.burstCount % 步枪Boss.换弹间隔 === 0) ? 步枪Boss.开火冷却 * 2.4 : 步枪Boss.开火冷却;
        }
      }
    } else {
      if (this.fireCd <= 0 && dist < 步枪Boss.有效射程) { this.state = 'aim'; this.aimT = 步枪Boss.预警; }
    }

    // 火光淡出（非瞄准态）
    if (this.state !== 'aim' && this.muzzleFlash.material.opacity > 0) {
      this.muzzleFlash.material.opacity -= dt * 12;
      this.muzzleFlash.scale.multiplyScalar(1 + dt * 5);
      this.muzzleFlash.visible = this.muzzleFlash.material.opacity > 0.02;
    }
  }

  _fireOne(playerPos, effects) {
    const mw = this._muzzleWorld(this._mw);
    // 弹着点：瞄准时锁定的位置 + 抖动（玩家开火后移动就能躲开）
    const jit = 步枪Boss.落点抖动;
    const ex = this.aimPoint.x + (Math.random() - 0.5) * 2 * jit;
    const ez = this.aimPoint.z + (Math.random() - 0.5) * 2 * jit;
    const end = this._tmp.set(ex, 1.1, ez);
    effects.addTracer(mw.clone(), end.clone());
    effects.addSparks(mw, this._tmp.set(0, 0.2, 1), 3, 0xffcc66);
    // 枪口火光
    this.muzzleFlash.visible = true;
    this.muzzleFlash.material.color.setHex(0xffdd88);
    this.muzzleFlash.material.opacity = 1;
    this.muzzleFlash.scale.setScalar(0.7 + Math.random() * 0.4);
    if (this.hooks.shoot) this.hooks.shoot();
    // 命中判定：玩家现在是否还在弹着点附近
    if (Math.hypot(playerPos.x - ex, playerPos.z - ez) < 步枪Boss.命中半径) {
      this.hooks.damagePlayer(步枪Boss.单发伤害, mw);
      this.hooks.shake(0.12);
    }
  }

  remove() {
    this.scene.remove(this.root);
  }
}
