import * as THREE from 'three';
import { 色卡, GFX } from '../config/graphics.js';

/**
 * 阶段4：丧尸红眼 —— 所有丧尸的眼睛用一个 InstancedMesh 统一渲染（1 个 draw call）。
 * 每帧根据存活丧尸的头部世界位置写入眼睛实例。materialtoneMapped=false 让红色保持高亮，
 * 被 Bloom 点亮，黑暗中一对对逼近的红点就是恐怖核心。
 */
export class EyeField {
  constructor(scene, capacityPairs = 64) {
    this.cap = capacityPairs * 2;
    const geo = new THREE.BoxGeometry(0.085, 0.055, 0.03);
    const mat = new THREE.MeshBasicMaterial({ color: 色卡.危险红, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    scene.add(this.mesh);

    this._d = new THREE.Object3D();     // 丧尸朝向参考
    this._dummy = new THREE.Object3D();  // 单只眼睛
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
  }

  update(enemies) {
    if (!GFX.丧尸红眼) { this.mesh.count = 0; return; }
    let idx = 0;
    for (const en of enemies) {
      if (en.dead || en.airborne) continue;
      if (idx + 2 > this.cap) break;
      const s = en.scaleFactor;
      this._d.position.copy(en.root.position);
      this._d.quaternion.setFromEuler(this._e.set(0, en.root.rotation.y, 0));
      this._d.updateMatrixWorld();
      for (const ox of [-0.09 * s, 0.09 * s]) {
        this._v.set(ox, 1.62 * s, 0.2 * s);
        this._d.localToWorld(this._v);
        this._dummy.position.copy(this._v);
        this._dummy.quaternion.copy(this._d.quaternion);
        this._dummy.scale.setScalar(s);
        this._dummy.updateMatrix();
        this.mesh.setMatrixAt(idx++, this._dummy.matrix);
      }
    }
    this.mesh.count = idx;
    if (idx > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
