import * as THREE from 'three';
import { 画面 } from './config.js';
import { 色卡 } from './config/graphics.js';

/**
 * 关卡：一个带掩体的废弃厂区。
 * 所有可以撞到的东西都会登记成一个 AABB 盒子（colliders），
 * 玩家和敌人都靠这些盒子做碰撞。
 */

export class Level {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.colliders = [];      // {min:Vector3, max:Vector3}
    this.hitMeshes = [];      // 子弹能打中的静态物体
    this.spawnPoints = [];
    this.size = 46;           // 场地半径（正方形半边长）
    this.shadowMapSize = opts.shadowMapSize || 2048;
    this.sun = null;          // 月光方向光（供画质切换时调整阴影分辨率）
    this.build();
  }

  /** 登记一个盒子障碍物 */
  addBox(x, y, z, w, h, d, color, opts = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.85,
      metalness: opts.metalness ?? 0.1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = 画面.阴影 && (opts.castShadow ?? true);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    if (opts.solid !== false) {
      this.colliders.push({
        min: new THREE.Vector3(x - w / 2, y, z - d / 2),
        max: new THREE.Vector3(x + w / 2, y + h, z + d / 2),
      });
    }
    this.hitMeshes.push(mesh);
    return mesh;
  }

  build() {
    const S = this.size;

    // ---------- 地面 ----------
    const groundGeo = new THREE.PlaneGeometry(S * 2, S * 2, 1, 1);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.hitMeshes.push(ground);
    this.ground = ground;   // 供阶段8 贴细节法线

    // 地面格子线，帮助判断距离和速度
    const grid = new THREE.GridHelper(S * 2, S, 0x3d4650, 0x333a42);
    grid.position.y = 0.01;
    grid.material.opacity = 0.35;
    grid.material.transparent = true;
    this.scene.add(grid);

    // ---------- 外墙 ----------
    const wallH = 7;
    const wallColor = 0x353b44;
    this.addBox(0, 0, -S, S * 2, wallH, 1.2, wallColor);
    this.addBox(0, 0, S, S * 2, wallH, 1.2, wallColor);
    this.addBox(-S, 0, 0, 1.2, wallH, S * 2, wallColor);
    this.addBox(S, 0, 0, 1.2, wallH, S * 2, wallColor);

    // ---------- 中央建筑（带屋顶平台，可以爬上去） ----------
    this.addBox(0, 0, 0, 12, 3.2, 12, 0x474e58);
    // 东侧台阶：4 级，每级 0.8 米，走上去就能上屋顶
    for (let i = 0; i < 4; i++) {
      this.addBox(9.6 - i * 1.4, 0, 0, 1.4, 0.8 * (i + 1), 4.4, 0x4d555f);
    }

    // ---------- 集装箱掩体 ----------
    const containers = [
      [-16, -14, 6, 2.6, 3, 0x6b4a3a, 0],
      [-20, 8, 6, 2.6, 3, 0x3a5a6b, 0],
      [17, -18, 6, 2.6, 3, 0x4a6b3a, Math.PI / 2],
      [22, 12, 6, 2.6, 3, 0x6b3a4a, 0],
      [-6, 22, 6, 2.6, 3, 0x5a5a3a, Math.PI / 2],
      [8, -25, 6, 2.6, 3, 0x3a4a6b, 0],
      [-28, -24, 6, 2.6, 3, 0x6b5a3a, Math.PI / 2],
      [30, 28, 6, 2.6, 3, 0x455a45, 0],
    ];
    for (const [x, z, w, h, d, color, rot] of containers) {
      const ww = rot ? d : w;
      const dd = rot ? w : d;
      this.addBox(x, 0, z, ww, h, dd, color, { metalness: 0.35, roughness: 0.6 });
    }

    // 叠一层的集装箱，形成高低差
    this.addBox(-16, 2.6, -14, 5, 2.6, 2.6, 0x5a4030, { metalness: 0.35 });
    this.addBox(22, 2.6, 12, 5, 2.6, 2.6, 0x5a3040, { metalness: 0.35 });

    // ---------- 矮掩体（可以蹲下躲） ----------
    const lowCovers = [
      [-9, -8], [10, 9], [-12, 14], [14, -6], [0, -18],
      [-24, 2], [26, -2], [4, 26], [-30, 18], [20, 24],
    ];
    for (const [x, z] of lowCovers) {
      this.addBox(x, 0, z, 2.4, 1.15, 1.2, 0x4a5058, { roughness: 0.95 });
    }

    // ---------- 油桶（小掩体，视觉点缀） ----------
    const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x8a4a2a, roughness: 0.7, metalness: 0.3 });
    const barrelSpots = [
      [-5, 5], [-4.2, 6.2], [12, -12], [12.8, -11], [-18, -3], [25, 6], [-26, -12], [6, 15],
    ];
    for (const [x, z] of barrelSpots) {
      const b = new THREE.Mesh(barrelGeo, barrelMat);
      b.position.set(x, 0.55, z);
      b.castShadow = 画面.阴影;
      b.receiveShadow = true;
      this.scene.add(b);
      this.hitMeshes.push(b);
      this.colliders.push({
        min: new THREE.Vector3(x - 0.42, 0, z - 0.42),
        max: new THREE.Vector3(x + 0.42, 1.1, z + 0.42),
      });
    }

    // ---------- 丧尸的出生点：场地四周的暗角 ----------
    const r = S - 4;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.spawnPoints.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }

    this.buildLights();
  }

  buildLights() {
    // 半球光：上冷 / 下暗（夜色）
    this.scene.add(new THREE.HemisphereLight(色卡.半球上, 色卡.半球下, 0.5));
    // 极弱环境光补一点暗部细节
    this.scene.add(new THREE.AmbientLight(色卡.半球上, 0.12));

    // 月光主方向光（冷蓝），从高处斜射，收紧阴影相机不漏光不悬浮
    const sun = new THREE.DirectionalLight(色卡.月光, 1.5);
    sun.position.set(34, 58, 20);
    sun.target.position.set(0, 0, 0);
    this.scene.add(sun.target);
    sun.castShadow = true;               // 是否真出阴影由 renderer.shadowMap.enabled（画质档）控制
    sun.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
    const d = 42;                        // 收紧到场地范围，提升阴影分辨率
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 140;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;        // 防自阴影/漏光
    this.scene.add(sun);
    this.sun = sun;
  }

  /** 玩家出生位置 */
  playerSpawn() {
    return new THREE.Vector3(0, 0, 20);
  }
}
