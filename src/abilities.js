import * as THREE from 'three';
import { 技能 } from './config/gameplay.js';

/**
 * 三个冰冻主题技能：
 *  Z 冷冻发射器（大招）：6 发，命中把僵尸冻住；解冻即死；打完 100s 冷却
 *  X 冰罐：前方地面生成一片冰(20s)，僵尸站 2 秒被冻住
 *  V 温感震撼弹：扔出后锁定附近僵尸(红线)，各造成 45 伤害
 */
export class Abilities {
  constructor(scene, camera, effects, onDamage) {
    this.scene = scene; this.camera = camera; this.effects = effects;
    this.onDamage = onDamage || (() => {});
    this.freezeAmmo = 技能.冷冻发射器.弹数;
    this.freezeCd = 0; this.iceCd = 0; this.shockCd = 0;
    this.patches = [];    // 冰面 {mesh,pos,r,life}
    this.grenades = [];   // 震撼弹飞行体
    this.lines = [];      // 冰束/红线
    this._o = new THREE.Vector3(); this._d = new THREE.Vector3();
    this.iceMat = new THREE.MeshBasicMaterial({ color: 0x8fd8f0, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
    this.gGeo = new THREE.SphereGeometry(0.16, 8, 6);
    this.gMat = new THREE.MeshStandardMaterial({ color: 0xcc3322, emissive: 0x661111, roughness: 0.5 });
  }

  reset() {
    for (const p of this.patches) { this.scene.remove(p.mesh); p.mesh.material.dispose(); p.mesh.geometry.dispose(); }
    for (const g of this.grenades) this.scene.remove(g.mesh);
    for (const L of this.lines) { this.scene.remove(L.line); L.line.material.dispose(); L.line.geometry.dispose(); }
    this.patches.length = this.grenades.length = this.lines.length = 0;
    this.freezeAmmo = 技能.冷冻发射器.弹数;
    this.freezeCd = this.iceCd = this.shockCd = 0;
  }

  /** Z：冷冻发射器 —— 冻住准星下的僵尸 */
  useFreeze(enemies) {
    if (this.freezeCd > 0 || this.freezeAmmo <= 0) return false;
    const cfg = 技能.冷冻发射器;
    this.camera.getWorldPosition(this._o);
    this.camera.getWorldDirection(this._d);
    const en = this._pickAlongRay(this._o, this._d, enemies, cfg.射程);
    this.freezeAmmo--;
    if (this.freezeAmmo <= 0) this.freezeCd = cfg.冷却;
    if (en) {
      en.freeze(cfg.冻结时长);
      const c = en.root.position;
      const hy = (en.flying ? c.y : 1.0 * en.scaleFactor);
      this._iceTracer(this._o.clone(), new THREE.Vector3(c.x, hy, c.z));
      this.effects.addSparks(new THREE.Vector3(c.x, hy, c.z), new THREE.Vector3(0, 1, 0), 14, 0x9fe6ff);
    } else {
      this._iceTracer(this._o.clone(), this._o.clone().addScaledVector(this._d, cfg.射程));
    }
    return true;
  }

  /** X：冰罐 —— 前方地面生成一片冰 */
  useIce(player) {
    if (this.iceCd > 0) return false;
    const cfg = 技能.冰罐;
    this.iceCd = cfg.冷却;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const pos = new THREE.Vector3(player.pos.x + fx * cfg.投掷距离, 0.03, player.pos.z + fz * cfg.投掷距离);
    const geo = new THREE.CircleGeometry(cfg.半径, 28); geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.iceMat.clone());
    mesh.position.copy(pos); this.scene.add(mesh);
    this.patches.push({ mesh, pos, r: cfg.半径, life: cfg.持续 });
    return true;
  }

  /** V：温感震撼弹 —— 扔出后锁定并伤害附近僵尸 */
  useShock(player) {
    if (this.shockCd > 0) return false;
    const cfg = 技能.震撼弹;
    this.shockCd = cfg.冷却;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const start = new THREE.Vector3(player.pos.x, player.pos.y - 0.3, player.pos.z);
    const target = new THREE.Vector3(player.pos.x + fx * cfg.投掷距离, 0.7, player.pos.z + fz * cfg.投掷距离);
    const mesh = new THREE.Mesh(this.gGeo, this.gMat);
    mesh.position.copy(start); this.scene.add(mesh);
    this.grenades.push({ mesh, from: start.clone(), target, t: 0, dur: 0.5 });
    return true;
  }

  _detonateShock(pos, enemies) {
    const cfg = 技能.震撼弹;
    let n = 0;
    for (const en of enemies) {
      if (en.dead || n >= cfg.最多锁定) continue;
      const c = en.root.position;
      if (Math.hypot(c.x - pos.x, c.z - pos.z) > cfg.半径) continue;
      n++;
      const hy = (en.flying ? c.y : 1.0 * en.scaleFactor);
      this._redLine(pos.clone(), new THREE.Vector3(c.x, hy, c.z));
      en.takeDamage(cfg.伤害, new THREE.Vector3(c.x - pos.x, 0, c.z - pos.z).normalize(), this.effects, new THREE.Vector3(c.x, hy, c.z));
      this.onDamage(cfg.伤害);
    }
    this.effects.addExplosion(pos, 3);
  }

  update(dt, enemies, player) {
    if (this.freezeCd > 0) { this.freezeCd -= dt; if (this.freezeCd <= 0) { this.freezeCd = 0; this.freezeAmmo = 技能.冷冻发射器.弹数; } }
    if (this.iceCd > 0) this.iceCd = Math.max(0, this.iceCd - dt);
    if (this.shockCd > 0) this.shockCd = Math.max(0, this.shockCd - dt);

    // 冰面：站上去累计，够 2 秒就冻住
    if (this.patches.length) {
      for (const en of enemies) {
        if (en.dead || en.frozen) continue;
        let on = false;
        for (const p of this.patches) { if (Math.hypot(en.root.position.x - p.pos.x, en.root.position.z - p.pos.z) <= p.r) { on = true; break; } }
        if (on) { en.iceTime += dt; if (en.iceTime >= 技能.冰罐.冻结需时) en.freeze(技能.冰罐.冻结时长); }
        else if (en.iceTime > 0) en.iceTime = 0;
      }
    }
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i]; p.life -= dt;
      p.mesh.material.opacity = (0.26 + 0.14 * Math.abs(Math.sin(p.life * 3))) * Math.min(1, p.life);
      if (p.life <= 0) { this.scene.remove(p.mesh); p.mesh.material.dispose(); p.mesh.geometry.dispose(); this.patches.splice(i, 1); }
    }
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i]; g.t += dt;
      const k = Math.min(1, g.t / g.dur);
      g.mesh.position.lerpVectors(g.from, g.target, k);
      g.mesh.position.y += Math.sin(k * Math.PI) * 1.8;
      if (k >= 1) { this._detonateShock(g.mesh.position.clone(), enemies); this.scene.remove(g.mesh); this.grenades.splice(i, 1); }
    }
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const L = this.lines[i]; L.life -= dt;
      L.line.material.opacity = Math.max(0, L.life / L.max);
      if (L.life <= 0) { this.scene.remove(L.line); L.line.material.dispose(); L.line.geometry.dispose(); this.lines.splice(i, 1); }
    }
  }

  _pickAlongRay(o, d, enemies, maxDist) {
    let best = null, bestT = Infinity;
    for (const en of enemies) {
      if (en.dead || en.frozen) continue;
      const c = en.root.position;
      const cy = en.flying ? c.y : 1.0 * en.scaleFactor;
      const vx = c.x - o.x, vy = cy - o.y, vz = c.z - o.z;
      const t = vx * d.x + vy * d.y + vz * d.z;
      if (t < 1 || t > maxDist) continue;
      const perp = Math.hypot(o.x + d.x * t - c.x, o.y + d.y * t - cy, o.z + d.z * t - c.z);
      if (perp <= 0.7 * en.scaleFactor + 0.9 && t < bestT) { bestT = t; best = en; }
    }
    return best;
  }

  _iceTracer(from, to) { this._line(from, to, 0x9fe6ff, 0.25); }
  _redLine(from, to) { this._line(from, to, 0xff2020, 0.5); }
  _line(from, to, color, life) {
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
    this.scene.add(line);
    this.lines.push({ line, life, max: life });
  }

  state() {
    return {
      freeze: { ammo: this.freezeAmmo, max: 技能.冷冻发射器.弹数, cd: this.freezeCd, cdMax: 技能.冷冻发射器.冷却 },
      ice: { cd: this.iceCd, cdMax: 技能.冰罐.冷却 },
      shock: { cd: this.shockCd, cdMax: 技能.震撼弹.冷却 },
    };
  }
}
