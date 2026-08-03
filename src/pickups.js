import * as THREE from 'three';
import { 掉落 } from './config/gameplay.js';

/**
 * 掉落拾取系统：丧尸死亡有概率掉弹药/医疗包，走过去自动拾取。
 * 用对象池，渲染循环内不 new。弹药=黄铜色弹匣，医疗=红十字盒。
 */
export class Pickups {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = [];

    // 两种外观共用池：切换 geometry 不方便，故各建一半
    const ammoGeo = new THREE.BoxGeometry(0.3, 0.42, 0.18);
    const medGeo = new THREE.BoxGeometry(0.38, 0.3, 0.3);
    const mkMat = (c, e) => new THREE.MeshStandardMaterial({
      color: c, emissive: e, emissiveIntensity: 0.9, roughness: 0.5, metalness: 0.3,
    });

    for (let i = 0; i < 24; i++) {
      const isAmmo = i < 16;
      const m = new THREE.Mesh(
        isAmmo ? ammoGeo : medGeo,
        isAmmo ? mkMat(0xd8a838, 0x6a4a10) : mkMat(0xd83a3a, 0x5a1010)
      );
      m.visible = false;
      m.castShadow = false;
      scene.add(m);
      this.pool.push({ mesh: m, kind: isAmmo ? 'ammo' : 'health' });
    }
    this._t = 0;
  }

  /** 丧尸死亡时调用，按概率掉落 */
  dropFrom(pos, isElite = false) {
    if (!掉落.启用) return;
    const r = Math.random();
    let kind = null;
    if (r < 掉落.弹药概率 * (isElite ? 1.6 : 1)) kind = 'ammo';
    else if (r < 掉落.弹药概率 + 掉落.医疗概率 * (isElite ? 1.6 : 1)) kind = 'health';
    if (!kind) return;
    this.spawn(pos, kind);
  }

  spawn(pos, kind) {
    const idx = this.pool.findIndex((p) => p.kind === kind);
    if (idx < 0) return;                       // 该类型池空，跳过
    const p = this.pool.splice(idx, 1)[0];
    p.mesh.position.set(pos.x, 0.5, pos.z);
    p.mesh.visible = true;
    p.life = 掉落.存在时间;
    p.phase = Math.random() * Math.PI * 2;
    this.active.push(p);
  }

  /** 每帧更新：漂浮旋转 + 拾取检测。返回拾到的 {kind} 或 null */
  update(dt, playerPos) {
    this._t += dt;
    let got = null;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      p.mesh.rotation.y += dt * 2.2;
      p.mesh.position.y = 0.5 + Math.sin(this._t * 3 + p.phase) * 0.12;

      const dx = p.mesh.position.x - playerPos.x;
      const dz = p.mesh.position.z - playerPos.z;
      const near = dx * dx + dz * dz < 掉落.拾取半径 * 掉落.拾取半径;

      if (near || p.life <= 0) {
        if (near) got = { kind: p.kind, pos: p.mesh.position.clone() };
        p.mesh.visible = false;
        this.active.splice(i, 1);
        this.pool.push(p);
      } else if (p.life < 3) {
        p.mesh.visible = Math.floor(p.life * 8) % 2 === 0;   // 快消失时闪烁提示
      }
    }
    return got;
  }

  clear() {
    for (const p of this.active) { p.mesh.visible = false; this.pool.push(p); }
    this.active.length = 0;
  }
}
