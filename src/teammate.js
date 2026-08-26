import * as THREE from 'three';

/**
 * 友军队友（简单模式）。跟在玩家身边，自动瞄准附近丧尸开火（命中即造成伤害）。
 * 不会被丧尸攻击（丧尸只盯玩家）——只做火力增援，不改变原有难度曲线。
 * 模型/跟随/瞄准在这里；实际伤害由 main.js 通过 onFire 回调结算。
 */
function buildSoldier(idx) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: idx === 0 ? 0x2f6fb0 : 0x2f9f7a, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xcaa07a, roughness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.5, metalness: 0.6 });
  // 腿
  for (const sx of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.7, 0.26), dark);
    leg.position.set(sx, 0.35, 0); leg.castShadow = true; g.add(leg);
  }
  // 躯干
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.36), cloth);
  torso.position.y = 1.05; torso.castShadow = true; g.add(torso);
  // 头 + 头盔
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skin);
  head.position.y = 1.62; head.castShadow = true; g.add(head);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.4), cloth);
  helmet.position.y = 1.8; g.add(helmet);
  // 枪（端在身前）
  const gun = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.95), metal);
  barrel.position.z = -0.5; gun.add(barrel);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.32), dark);
  stock.position.z = 0.1; gun.add(stock);
  gun.position.set(0.24, 1.1, 0); g.add(gun);
  g.userData.gun = gun;
  // 枪口（世界坐标发射起点）
  return g;
}

export class Teammate {
  constructor(scene, pos, idx, cfg) {
    this.scene = scene; this.cfg = cfg; this.idx = idx;
    this.root = buildSoldier(idx);
    this.root.position.copy(pos);
    scene.add(this.root);
    this.fireCd = 0.2 + Math.random() * cfg.开火间隔;
    this.muzzleFlash = 0;
    this._m = new THREE.Vector3();
    // 站位：一个偏左后、一个偏右后
    this.side = idx === 0 ? -1 : 1;
  }

  // onFire(enemy, dmg, muzzleWorldPos) —— 命中一个丧尸时回调（由 main 结算伤害/特效）
  update(dt, playerPos, playerYaw, enemies, onFire) {
    const c = this.cfg;
    // 跟随：站在玩家身后偏侧位
    const bx = Math.sin(playerYaw), bz = Math.cos(playerYaw);          // 玩家前方(-forward 约定)
    const rx = Math.sin(playerYaw - Math.PI / 2), rz = Math.cos(playerYaw - Math.PI / 2);
    const tx = playerPos.x + bx * (c.跟随距离 * 0.7) + rx * this.side * 2.2;
    const tz = playerPos.z + bz * (c.跟随距离 * 0.7) + rz * this.side * 2.2;
    const p = this.root.position;
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.4) {
      const sp = Math.min(d, 9) * dt;   // 跟得上玩家但不瞬移
      p.x += (dx / d) * sp * 4; p.z += (dz / d) * sp * 4;
    }
    p.y = 0;

    // 找最近的活丧尸
    let best = null, bestD = c.射程 * c.射程;
    for (const en of enemies) {
      if (en.dead) continue;
      const ex = en.root.position.x - p.x, ez = en.root.position.z - p.z;
      const dd = ex * ex + ez * ez;
      if (dd < bestD) { bestD = dd; best = en; }
    }
    // 朝向：有目标看目标，否则看玩家前方
    let faceX, faceZ;
    if (best) { faceX = best.root.position.x - p.x; faceZ = best.root.position.z - p.z; }
    else { faceX = -bx; faceZ = -bz; }
    this.root.rotation.y = Math.atan2(faceX, faceZ) + Math.PI;   // 模型正面 +Z

    // 开火
    this.fireCd -= dt;
    if (this.muzzleFlash > 0) this.muzzleFlash -= dt;
    if (best && this.fireCd <= 0) {
      this.fireCd = c.开火间隔 * (0.8 + Math.random() * 0.5);
      this.muzzleFlash = 0.05;
      const muzzle = this._m.set(p.x + faceX * 0.02, 1.1, p.z + faceZ * 0.02);
      // 枪口大致朝目标：起点抬到胸口高度
      muzzle.set(p.x, 1.1, p.z);
      onFire(best, c.伤害, muzzle.clone());
    }
  }

  remove() { this.scene.remove(this.root); }
}
