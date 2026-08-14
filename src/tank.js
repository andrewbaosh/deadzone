import * as THREE from 'three';

/**
 * 友军坦克（玩家可驾驶）。停在要塞里，靠近按 F 上车。
 * 本类只管模型/朝向/炮口世界坐标；驾驶、相机、开炮都由 main.js 控制。
 */
export class Tank {
  constructor(scene, pos) {
    this.scene = scene;
    const grp = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x4a5238, roughness: 0.7, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24281c, roughness: 0.85, metalness: 0.2 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x2f332a, roughness: 0.5, metalness: 0.6 });

    // 履带（两条）
    for (const sx of [-1.2, 1.2]) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.95, 4.4), dark);
      track.position.set(sx, 0.48, 0); track.castShadow = true; grp.add(track);
    }
    // 车体
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.95, 3.8), body);
    hull.position.y = 1.15; hull.castShadow = true; grp.add(hull);
    // 前装甲斜板
    const glacis = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.8), body);
    glacis.position.set(0, 0.95, -1.9); glacis.rotation.x = -0.5; grp.add(glacis);

    // 炮塔（可转）
    this.turret = new THREE.Group();
    const tur = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 2.2), body);
    tur.castShadow = true; this.turret.add(tur);
    // 炮管
    this.barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 3.4, 12), metal);
    this.barrel.rotation.x = Math.PI / 2; this.barrel.position.set(0, 0.05, -2.0); this.turret.add(this.barrel);
    // 舱盖 + 天线
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 10), metal);
    hatch.position.set(0.4, 0.48, 0.3); this.turret.add(hatch);
    // 炮口火光（开炮时闪）
    this.muzzleMat = new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.muzzleFlash = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), this.muzzleMat);
    this.muzzleFlash.position.set(0, 0.05, -3.8); this.muzzleFlash.visible = false; this.turret.add(this.muzzleFlash);
    this.turret.position.set(0, 1.85, 0);
    grp.add(this.turret);

    this.root = grp;
    this.root.position.copy(pos); this.root.position.y = 0;
    scene.add(grp);

    this.hullAngle = 0;          // 车体朝向
    this._m = new THREE.Vector3();
  }

  // 炮口世界坐标（开炮起点）
  muzzleWorld(out) { out.set(0, 0.05, -3.9); this.turret.localToWorld(out); return out; }

  flash() {
    this.muzzleFlash.visible = true;
    this.muzzleMat.opacity = 1;
    this.muzzleFlash.scale.setScalar(0.8 + Math.random() * 0.5);
    this.muzzleFlash.rotation.z = Math.random() * Math.PI;
  }

  update(dt) {
    if (this.muzzleFlash.visible) {
      this.muzzleMat.opacity -= dt * 8;
      if (this.muzzleMat.opacity <= 0) this.muzzleFlash.visible = false;
    }
  }

  remove() { this.scene.remove(this.root); }
}
