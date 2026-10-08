import * as THREE from 'three';
import { disposeObject } from './graphics/disposeObject.js';

/**
 * 第九波·空中打 BOSS 用的地面单位：
 *  - Wave9Boss：钢铁指挥官。自身不攻击，只召唤小弟；血条高，打死即通关。
 *  - AAVehicle：防空车。重机枪，开火前 3 秒预警，然后扫射玩家战机。
 *  - TankVehicle：坦克。辅助火力，很慢地打你（可躲）。
 * 位置都在地面(y≈0)。开火/召唤逻辑在类里，实际弹药/伤害由 main.js 结算。
 */

export class Wave9Boss {
  constructor(scene, pos, cfg) {
    this.scene = scene; this.cfg = cfg;
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.5, metalness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.7, metalness: 0.5 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff3322, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    // 底盘
    const base = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 10, 3, 10), dark);
    base.position.y = 1.5; base.castShadow = true; g.add(base);
    // 主体穹顶
    const dome = new THREE.Mesh(new THREE.SphereGeometry(6.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), metal);
    dome.position.y = 3; dome.castShadow = true; g.add(dome);
    // 环形炮塔（装饰）
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const t = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 2.6), metal);
      t.position.set(Math.cos(a) * 7, 3, Math.sin(a) * 7); t.rotation.y = -a; g.add(t);
    }
    // 顶部核心（发光弱点感）
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), glowMat);
    core.position.y = 8.5; g.add(core); this.core = core;
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 6), metal);
    ant.position.y = 11; g.add(ant);
    g.position.copy(pos); g.position.y = 0;
    scene.add(g);
    this.root = g;
    this.hp = cfg.生命; this.maxHp = cfg.生命; this.dead = false;
    this.summonCd = cfg.首次召唤;
    this.t = 0;
  }
  takeDamage(d) { if (this.dead) return false; this.hp -= d; if (this.hp <= 0) { this.hp = 0; this.dead = true; return true; } return false; }
  flashHit() { this.hitT = 0.12; }
  // 返回 true 表示这帧要召唤一个小弟
  update(dt) {
    this.t += dt;
    this.root.rotation.y += dt * 0.15;
    if (this.hitT > 0) this.hitT -= dt;
    if (this.core) { const hit = this.hitT > 0; const s = 1 + 0.12 * Math.sin(this.t * 3) + (hit ? 0.5 : 0); this.core.scale.setScalar(s); this.core.material.color.setHex(hit ? 0xffffff : 0xff3322); this.core.material.opacity = 0.7 + 0.3 * Math.abs(Math.sin(this.t * 3)); }
    this.summonCd -= dt;
    if (this.summonCd <= 0) { this.summonCd = this.cfg.召唤间隔; return true; }
    return false;
  }
  // 顶部核心世界坐标（锁定/瞄准点）
  aimPoint(out) { return out.set(this.root.position.x, 8.5, this.root.position.z); }
  remove() { disposeObject(this.root); }
}

class GroundUnit {
  constructor(scene, pos, cfg) {
    this.scene = scene; this.cfg = cfg;
    this.hp = cfg.生命; this.maxHp = cfg.生命; this.dead = false;
    this._d = new THREE.Vector3();
  }
  takeDamage(d) { if (this.dead) return false; this.hp -= d; if (this.hp <= 0) { this.hp = 0; this.dead = true; return true; } return false; }
  flashHit() { this.hitT = 0.1; }
  _hitPop(dt) { if (this.hitT > 0) { this.hitT -= dt; this.root.scale.setScalar(1 + Math.max(0, this.hitT) * 1.4); } else if (this.root.scale.x !== 1) this.root.scale.setScalar(1); }
  aimPoint(out) { return out.set(this.root.position.x, 1.6, this.root.position.z); }
  // 慢慢开到玩家正下方附近，保持在射程内
  _drive(dt, playerPos) {
    const p = this.root.position;
    const dx = playerPos.x - p.x, dz = playerPos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 30) { p.x += (dx / d) * this.cfg.移速 * dt; p.z += (dz / d) * this.cfg.移速 * dt; }
    p.y = 0;
  }
  remove() { disposeObject(this.root); }
}

export class TankVehicle extends GroundUnit {
  constructor(scene, pos, cfg) {
    super(scene, pos, cfg);
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x4a5a30, roughness: 0.75, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x232a16, roughness: 0.85 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x2f332a, roughness: 0.5, metalness: 0.6 });
    for (const sx of [-1.1, 1.1]) { const tr = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.85, 4), dark); tr.position.set(sx, 0.45, 0); tr.castShadow = true; g.add(tr); }
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.85, 3.4), body); hull.position.y = 1.05; hull.castShadow = true; g.add(hull);
    this.turret = new THREE.Group();
    const tur = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 2), body); this.turret.add(tur);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 3, 10), metal); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.05, -1.8); this.turret.add(barrel);
    this.barrel = barrel; this.turret.position.set(0, 1.7, 0); g.add(this.turret);
    g.position.copy(pos); g.position.y = 0; scene.add(g);
    this.root = g;
    this.fireCd = 2 + Math.random() * cfg.开火间隔;
    this.bullet = { 伤害: cfg.子弹伤害, 弹速: cfg.弹速, 命中半径: cfg.命中半径, 大: true };
  }
  update(dt, playerPos) {
    this._drive(dt, playerPos); this._hitPop(dt);
    // 炮塔转向玩家
    const dx = playerPos.x - this.root.position.x, dz = playerPos.z - this.root.position.z;
    this.turret.rotation.y = Math.atan2(dx, dz) - this.root.rotation.y + Math.PI;
    this.fireCd -= dt;
    if (this.fireCd <= 0) {
      this.fireCd = this.cfg.开火间隔;
      const from = new THREE.Vector3(this.root.position.x, 2, this.root.position.z);
      const dir = this._d.copy(playerPos).sub(from).normalize();
      return { fire: true, from, dir, bullet: this.bullet };
    }
    return null;
  }
}

export class AAVehicle extends GroundUnit {
  constructor(scene, pos, cfg) {
    super(scene, pos, cfg);
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.6, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.4, metalness: 0.7 });
    // 轮式底盘
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1, 4.4), body); hull.position.y = 1; hull.castShadow = true; g.add(hull);
    for (const sx of [-1.3, 1.3]) for (const sz of [-1.4, 0, 1.4]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 10), dark); w.rotation.z = Math.PI / 2; w.position.set(sx, 0.5, sz); g.add(w); }
    // 旋转炮塔 + 四联装机枪
    this.turret = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 0.7, 12), metal); this.turret.add(base);
    for (const sx of [-0.35, 0.35]) for (const sy of [-0.2, 0.35]) { const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 8), dark); barrel.rotation.x = Math.PI / 2; barrel.position.set(sx, sy + 0.4, -1.3); this.turret.add(barrel); }
    // 雷达片
    const radar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 1.4), metal); radar.position.set(0.9, 1.1, 0.3); this.turret.add(radar);
    this.turret.position.set(0, 1.7, 0); g.add(this.turret);
    // 预警灯
    this.warnMat = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), this.warnMat); lamp.position.set(0, 2.5, 0); g.add(lamp);
    g.position.copy(pos); g.position.y = 0; scene.add(g);
    this.root = g;
    this.state = 'idle'; this.stateT = 1 + Math.random() * 2;   // 先待机一会儿
    this.mgCd = 0;
    this.bullet = { 伤害: cfg.子弹伤害, 弹速: cfg.弹速, 命中半径: cfg.命中半径 };
  }
  // 返回 {warn: 剩余秒} 表示预警中，或 {fire,from,dir,bullet} 表示打了一发机枪
  update(dt, playerPos) {
    this._drive(dt, playerPos); this._hitPop(dt);
    const dx = playerPos.x - this.root.position.x, dz = playerPos.z - this.root.position.z;
    this.turret.rotation.y = Math.atan2(dx, dz) - this.root.rotation.y + Math.PI;
    const c = this.cfg;
    this.stateT -= dt;
    let ret = null;
    if (this.state === 'idle') {
      this.warnMat.opacity = 0;
      if (this.stateT <= 0) { this.state = 'warn'; this.stateT = c.预警; }
    } else if (this.state === 'warn') {
      this.warnMat.opacity = 0.4 + 0.6 * Math.abs(Math.sin(this.stateT * 8));   // 闪红灯
      ret = { warn: Math.max(0, this.stateT) };
      if (this.stateT <= 0) { this.state = 'fire'; this.stateT = c.连射时长; this.mgCd = 0; }
    } else if (this.state === 'fire') {
      this.warnMat.opacity = 0.7;
      this.mgCd -= dt;
      if (this.mgCd <= 0) {
        this.mgCd = c.每发间隔;
        const from = new THREE.Vector3(this.root.position.x, 2.2, this.root.position.z);
        const spread = 0.04;
        const dir = this._d.copy(playerPos).sub(from).normalize();
        dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
        dir.normalize();
        ret = { fire: true, from, dir, bullet: this.bullet };
      }
      if (this.stateT <= 0) { this.state = 'cool'; this.stateT = c.冷却; }
    } else { // cool
      this.warnMat.opacity = 0;
      if (this.stateT <= 0) { this.state = 'warn'; this.stateT = c.预警; }
    }
    return ret;
  }
}
