import * as THREE from 'three';
import { 画面 } from './config.js';
import { 色卡, GFX } from './config/graphics.js';
import { greedyMesh } from './graphics/voxel/greedyMesh.js';
import { makeTownhouse, makeCobble } from './graphics/voxel/voxelModels.js';

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
    this.buildAmbiance();
  }

  /** 暖光窗户（一个 InstancedMesh，1 draw call）+ 街灯，营造黄昏温馨氛围 */
  buildAmbiance() {
    if (GFX.暖窗 !== false) this.addWindows();
    if (GFX.街灯 !== false) this.addLamps();
    if (GFX.体素细节 !== false) this.addVoxelShowcase();
  }

  /** 精细体素建筑 + 砖地（贪婪网格合并 proof）。视觉盖在碰撞盒上，不影响打枪逻辑。 */
  addVoxelShowcase() {
    const vs = 0.16;   // 每格 16cm，够细腻
    // ---- 砖地：铺在前方广场 ----
    const cob = makeCobble(80, 80);
    const cobRes = greedyMesh(cob, vs, new THREE.Vector3(-80 * vs / 2, -0.28, -6 - 80 * vs / 2));
    const cobMesh = new THREE.Mesh(cobRes.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    cobMesh.receiveShadow = true;
    this.scene.add(cobMesh);
    this.hitMeshes.push(cobMesh);

    // ---- 体素小楼：放在左侧、+z 面朝玩家 ----
    const house = makeTownhouse();
    const W = house.sx * vs, D = house.sz * vs;
    const hx = -14, hz = 6;
    const res = greedyMesh(house, vs, new THREE.Vector3(hx - W / 2, 0, hz - D / 2));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
    const houseMesh = new THREE.Mesh(res.geometry, mat);
    houseMesh.castShadow = true;
    houseMesh.receiveShadow = true;
    this.scene.add(houseMesh);
    this.hitMeshes.push(houseMesh);
    this.voxelStats = { houseTris: res.tris, houseQuads: res.quads };

    // 碰撞盒（占位，别让玩家/丧尸穿进楼里）
    this.colliders.push({
      min: new THREE.Vector3(hx - W / 2, 0, hz - D / 2),
      max: new THREE.Vector3(hx + W / 2, house.sy * vs, hz + D / 2),
    });
  }

  addWindows() {
    const S = this.size;
    const wins = [];  // {x,y,z,ry}
    // 一面墙上按网格铺窗
    const row = (cx, cy, cz, ry, nx, ny, dx, dy) => {
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
          const ox = (i - (nx - 1) / 2) * dx;
          const oy = j * dy;
          // 沿墙面切向偏移（ry 决定墙朝向）
          const sx = Math.cos(ry), sz = Math.sin(ry);
          wins.push({ x: cx + ox * sx, y: cy + oy, z: cz + ox * sz, ry });
        }
      }
    };
    // 中央建筑四面（面朝外）
    row(0, 1.0, 6.05, 0, 5, 3, 1.6, 0.75);
    row(0, 1.0, -6.05, Math.PI, 5, 3, 1.6, 0.75);
    row(6.05, 1.0, 0, Math.PI / 2, 5, 3, 1.6, 0.75);
    row(-6.05, 1.0, 0, -Math.PI / 2, 5, 3, 1.6, 0.75);
    // 四周高墙内侧（面朝场内），窗户在高处
    row(0, 2.2, -S + 0.7, 0, 11, 3, 3.2, 1.3);
    row(0, 2.2, S - 0.7, Math.PI, 11, 3, 3.2, 1.3);
    row(-S + 0.7, 2.2, 0, Math.PI / 2, 11, 3, 3.2, 1.3);
    row(S - 0.7, 2.2, 0, -Math.PI / 2, 11, 3, 3.2, 1.3);

    const geo = new THREE.PlaneGeometry(0.62, 0.62);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, wins.length);
    mesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    const lit = new THREE.Color(0xffd9a0);
    const warm = new THREE.Color(0xffb060);
    const dark = new THREE.Color(0x241a12);
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      dummy.position.set(w.x, w.y, w.z);
      dummy.rotation.set(0, w.ry + Math.PI, 0);   // 面片法线朝外
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const r = Math.random();
      mesh.setColorAt(i, r < 0.55 ? lit : r < 0.75 ? warm : dark);   // 有亮有暗才自然
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
    this.windows = mesh;
  }

  addLamps() {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.6, metalness: 0.5 });
    const headMat = new THREE.MeshBasicMaterial({ color: 色卡.头灯, toneMapped: false });
    const spots = [[-14, 12], [16, -10], [10, 14], [-20, -6]];
    for (const [x, z] of spots) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.2, 0.18), postMat);
      post.position.set(x, 1.6, z);
      post.castShadow = true;
      this.scene.add(post);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.4), headMat);
      head.position.set(x, 3.35, z);
      this.scene.add(head);
      // 暖色点光（短距离，营造暖光池）
      const lamp = new THREE.PointLight(色卡.头灯, 6, 11, 2);
      lamp.position.set(x, 3.2, z);
      this.scene.add(lamp);
    }
  }

  buildLights() {
    // 半球光：上冷天光 / 下暖地面反弹（可读的黄昏，不再纯黑）
    this.scene.add(new THREE.HemisphereLight(0x9aa8d0, 0x7a5e40, 1.6));
    // 环境光补暗部（暖一点）
    this.scene.add(new THREE.AmbientLight(0x7a728a, 0.5));
    // 一盏暖色补光模拟街灯/室内暖光的整体氛围
    const warmFill = new THREE.DirectionalLight(色卡.暖焦点, 0.5);
    warmFill.position.set(-20, 24, -14);
    this.scene.add(warmFill);

    // 月光主方向光（冷蓝），从高处斜射，收紧阴影相机不漏光不悬浮
    const sun = new THREE.DirectionalLight(色卡.月光, 1.7);
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
