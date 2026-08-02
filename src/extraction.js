import * as THREE from 'three';
import { 撤离 as CFG } from './config.js';

/**
 * 撤离点：一道从地面冲天而起的发光光柱 + 地面光环 + 灯光，
 * 隔着掩体和迷雾也能一眼看到。开启前隐藏，开启后出现在指定位置。
 */
export class Extraction {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.position = new THREE.Vector3();
    this.time = 0;

    const color = CFG.光柱颜色;
    const R = CFG.半径;

    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    // fog:false 让光柱无视迷雾，隔着半张地图也一样亮（灯塔效果）
    const H = 80;

    // 最外层光晕（很宽、很淡，营造光晕散射）
    const haloGeo = new THREE.CylinderGeometry(R * 2.0, R * 2.4, H, 24, 1, true);
    this.haloMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.07, fog: false,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.halo = new THREE.Mesh(haloGeo, this.haloMat);
    this.halo.position.y = H / 2;
    this.group.add(this.halo);

    // 外层光柱
    const beamGeo = new THREE.CylinderGeometry(R * 0.95, R * 1.1, H, 28, 1, true);
    this.beamMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.28, fog: false,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.position.y = H / 2;
    this.group.add(this.beam);

    // 内层光柱（细、亮）
    const coreGeo = new THREE.CylinderGeometry(R * 0.34, R * 0.4, H, 20, 1, true);
    this.coreMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.75, fog: false,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.core.position.y = H / 2;
    this.group.add(this.core);

    // 地面光环（旋转）
    const ringGeo = new THREE.TorusGeometry(R, 0.14, 8, 60);
    this.ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, fog: false,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.06;
    this.group.add(this.ring);

    // 内圈第二个环
    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(R * 0.6, 0.08, 8, 48), this.ringMat
    );
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 0.06;
    this.ring2 = ring2;
    this.group.add(ring2);

    // 地面发光圆盘
    const discGeo = new THREE.CircleGeometry(R, 40);
    this.discMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.12,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.disc = new THREE.Mesh(discGeo, this.discMat);
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.04;
    this.group.add(this.disc);

    // 点光源，照亮周围地面
    this.light = new THREE.PointLight(color, 40, 22, 2);
    this.light.position.y = 3;
    this.group.add(this.light);
  }

  open(pos) {
    this.position.copy(pos);
    this.position.y = 0;
    this.group.position.copy(this.position);
    this.group.visible = true;
    this.active = true;
  }

  close() {
    this.active = false;
    this.group.visible = false;
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;

    // 光柱脉动
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
    this.haloMat.opacity = 0.05 + pulse * 0.05;
    this.beamMat.opacity = 0.22 + pulse * 0.14;
    this.coreMat.opacity = 0.6 + pulse * 0.3;
    this.light.intensity = 30 + pulse * 25;

    // 光环旋转 + 呼吸
    this.ring.rotation.z += dt * 0.8;
    this.ring2.rotation.z -= dt * 1.3;
    const s = 1 + Math.sin(this.time * 2) * 0.06;
    this.ring.scale.setScalar(s);
    this.disc.material.opacity = 0.08 + pulse * 0.12;
  }
}
