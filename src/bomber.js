import * as THREE from 'three';
import { 轰炸机 } from './config/gameplay.js';

/**
 * 僵尸轰炸机：会飞的飞机，绕着玩家高空盘旋，定时往下投僵尸（不投炸弹）。
 * 任何武器都能把它打下来。update() 返回 { drop: Vector3 } 表示这一帧投了一只。
 */
export class Bomber {
  constructor(scene, wave, phase = 0) {
    this.scene = scene;
    this.dead = false;
    this.headMul = 1;
    this.maxHp = 轰炸机.生命 * Math.pow(1.08, Math.max(0, wave - 7));
    this.hp = this.maxHp;
    this.angle = phase;
    this.dropTimer = 1.2 + Math.random() * 轰炸机.投放间隔;
    this.dropsLeft = 轰炸机.每机投放;
    this.hurtFlash = 0;

    const grp = new THREE.Group();
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x5a6b3e, roughness: 0.82, metalness: 0.15 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x33383a, roughness: 0.6, metalness: 0.5 });
    const fus = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 4.2), this.bodyMat);
    grp.add(fus);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.3, 8), this.bodyMat);
    nose.rotation.x = -Math.PI / 2; nose.position.z = -2.6; grp.add(nose);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.22, 1.4), this.bodyMat);
    wing.position.y = 0.1; grp.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 0.8), this.bodyMat);
    tail.position.set(0, 0.1, 2.1); grp.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.0, 0.8), this.bodyMat);
    fin.position.set(0, 0.6, 2.1); grp.add(fin);
    // 引擎 + 发红的核（僵尸感）
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3322, toneMapped: false });
    for (const sx of [-1.8, 1.8]) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.5, 8), metal);
      eng.rotation.x = Math.PI / 2; eng.position.set(sx, -0.05, -0.2); grp.add(eng);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), eyeMat);
      glow.position.set(sx, -0.05, 0.7); grp.add(glow);
    }
    // 机腹弹舱（投僵尸口）
    const bay = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 1.5), metal);
    bay.position.set(0, -0.62, 0.3); grp.add(bay);

    grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.bomber = this; } });
    this.root = grp;
    this.hitMeshes = [fus, wing, nose];
    scene.add(grp);
    this._tmp = new THREE.Vector3();
  }

  takeDamage(dmg, isHead, effects) {
    if (this.dead) return false;
    this.hp -= dmg;
    this.hurtFlash = 0.08;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; return true; }
    return false;
  }

  update(dt, playerPos) {
    if (this.dead) return null;
    if (this.hurtFlash > 0) { this.hurtFlash -= dt; const f = Math.max(0, this.hurtFlash / 0.08); this.bodyMat.emissive.setRGB(f, 0, 0); }
    // 绕玩家盘旋
    this.angle += (轰炸机.速度 / 轰炸机.环绕半径) * dt;
    const tx = playerPos.x + Math.cos(this.angle) * 轰炸机.环绕半径;
    const tz = playerPos.z + Math.sin(this.angle) * 轰炸机.环绕半径;
    const pos = this.root.position;
    pos.x += (tx - pos.x) * Math.min(1, dt * 2);
    pos.z += (tz - pos.z) * Math.min(1, dt * 2);
    pos.y += (轰炸机.高度 - pos.y) * Math.min(1, dt * 2);
    // 机头(模型 -z)对准飞行方向(切线 = (-sin a, cos a))，别倒着飞
    this.root.rotation.y = Math.atan2(Math.sin(this.angle), -Math.cos(this.angle));
    this.root.rotation.z = -Math.cos(this.angle) * 0.12;   // 转弯时朝内侧压坡

    let drop = null;
    if (this.dropsLeft > 0) {
      this.dropTimer -= dt;
      if (this.dropTimer <= 0) {
        this.dropTimer = 轰炸机.投放间隔;
        this.dropsLeft--;
        drop = this._tmp.set(pos.x, pos.y - 0.9, pos.z).clone();
      }
    }
    return drop ? { drop } : null;
  }

  remove() { this.scene.remove(this.root); }
}
