import * as THREE from 'three';
import { 画面 } from './config.js';
import { 色卡, GFX } from './config/graphics.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FlowField } from './flowfield.js';
import { greedyMesh } from './graphics/voxel/greedyMesh.js';
import {
  makeTerrace, makeFountain, makeTree, makeTable,
  makeStall, makeCrates, makePlanter, makeBarrel, makeStonePlatform,
  makeRock, makeCactus, makeDeadShrub, makeDune, makeRuinPillar, makeBones,
  makeSandbags, makeMilCrate, makeTent, makeBarracksHut, makeWatchtower,
} from './graphics/voxel/voxelModels.js';
import { 建筑风格 } from './graphics/voxel/styles.js';
import { makeCobbleTextures } from './graphics/groundTexture.js';

/**
 * 关卡：一个带掩体的废弃厂区。
 * 所有可以撞到的东西都会登记成一个 AABB 盒子（colliders），
 * 玩家和敌人都靠这些盒子做碰撞。
 */

export class Level {
  constructor(scene, opts = {}) {
    this.realScene = scene;
    // 关卡所有物件都挂在 root 下，整组显隐即可切换地图（沙漠/小镇同场共存）
    this.root = new THREE.Group();
    scene.add(this.root);
    this.scene = this.root;   // 内部 this.scene.add(...) 一律进 root
    this.theme = opts.theme || 'town';   // 'town' | 'desert'
    this.colliders = [];      // {min:Vector3, max:Vector3}
    this.hitMeshes = [];      // 子弹能打中的静态物体
    this.spawnPoints = [];
    this.size = 46;           // 场地半径（正方形半边长）
    this.shadowMapSize = opts.shadowMapSize || 2048;
    this.sun = null;          // 主方向光（供画质切换时调整阴影分辨率）
    this.build();
  }

  /** 整组显隐：不可见时其灯光也不参与渲染（three.js 跳过 visible=false 的对象与灯光） */
  setActive(v) { this.root.visible = v; }

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

  /** 只登记碰撞盒，不生成网格（视觉交给体素道具） */
  addCollider(x, y, z, w, h, d) {
    this.colliders.push({
      min: new THREE.Vector3(x - w / 2, y, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h, z + d / 2),
    });
  }

  build() {
    const S = this.size;

    const desert = this.theme === 'desert';
    const barracks = this.theme === 'barracks';
    const cobble = !desert && !barracks;   // 只有小镇用鹅卵石贴图

    // ---------- 地面 ----------
    const groundGeo = new THREE.PlaneGeometry(S * 2, S * 2, 1, 1);
    const groundMat = desert
      ? new THREE.MeshStandardMaterial({ color: 0xcaa96f, roughness: 1.0, metalness: 0 })
      : barracks
        ? new THREE.MeshStandardMaterial({ color: 0x6d6c5c, roughness: 1.0, metalness: 0 })   // 泥土/碎石
        : new THREE.MeshStandardMaterial({ color: 0xb8a888, roughness: 0.95, metalness: 0 });
    if (cobble && GFX.体素细节 !== false) {
      try {
        const { map, normalMap } = makeCobbleTextures(512, 11);
        const rep = S * 2 / 4.5;              // 每 ~4.5m 一块贴图
        map.repeat.set(rep, rep); normalMap.repeat.set(rep, rep);
        groundMat.map = map;
        groundMat.normalMap = normalMap;
        groundMat.normalScale.set(0.9, 0.9);
        groundMat.color.set(0xffffff);        // 有贴图后不额外染色
      } catch (e) { console.warn('鹅卵石地面贴图失败:', e); }
    }
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.hitMeshes.push(ground);
    this.ground = ground;   // 网格线已去掉（和石板风格冲突）

    // ---------- 外墙（沙漠=砂岩壁；军营=混凝土围墙；小镇=深色围墙）----------
    const wallH = 7;
    const wallRough = cobble ? 0.85 : 1.0;
    const wallColor = desert ? 0x9a7a4c : barracks ? 0x585a4c : 0x353b44;
    this.addBox(0, 0, -S, S * 2, wallH, 1.2, wallColor, { roughness: wallRough });
    this.addBox(0, 0, S, S * 2, wallH, 1.2, wallColor, { roughness: wallRough });
    this.addBox(-S, 0, 0, 1.2, wallH, S * 2, wallColor, { roughness: wallRough });
    this.addBox(S, 0, 0, 1.2, wallH, S * 2, wallColor, { roughness: wallRough });

    // ---------- 中央高台（可登高）：碰撞在此，视觉在 showcase ----------
    this.addCollider(0, 0, 0, 12, 3.2, 12);
    // 东侧台阶：4 级，每级 0.8 米，走上去就能上台
    const stairColor = desert ? 0xbf9a5e : barracks ? 0x8a8a76 : 0xa89a7c;
    for (let i = 0; i < 4; i++) {
      this.addBox(9.6 - i * 1.4, 0, 0, 1.4, 0.8 * (i + 1), 4.4, stairColor, { roughness: desert ? 1.0 : 0.9 });
    }
    // 台阶入口（玩家在平台上时，把僵尸先引到这里来爬楼）
    this.stairEntrance = new THREE.Vector3(10.8, 0, 0);

    // ---------- 掩体布局（只登记碰撞，视觉由体素道具提供）----------
    // 高掩体：市集摊位
    this.stallSpots = [
      [-16, -14, 0], [-20, 8, 0], [17, -18, Math.PI / 2], [22, 12, 0],
      [-6, 22, Math.PI / 2], [8, -25, 0], [-28, -24, Math.PI / 2], [30, 28, 0],
    ];
    for (const [x, z, rot] of this.stallSpots) {
      const ww = rot ? 4.2 : 6.4, dd = rot ? 6.4 : 4.2;
      this.addCollider(x, 0, z, ww, 1.5, dd);          // 只挡到腰，头顶是遮阳棚可穿视线
    }
    // 中掩体：板条箱堆
    this.crateSpots = [[-16.5, -10.5], [22.5, 15.5], [-2, 12], [13, -8], [-25, 16], [27, -6]];
    for (const [x, z] of this.crateSpots) this.addCollider(x, 0, z, 3.0, 2.5, 2.2);
    // 矮掩体：石花坛（蹲下可躲）
    this.planterSpots = [
      [-9, -8], [10, 9], [-12, 14], [14, -6], [0, -18],
      [-24, 2], [26, -2], [4, 26], [-30, 18], [20, 24],
    ];
    for (const [x, z] of this.planterSpots) this.addCollider(x, 0, z, 2.6, 1.2, 1.5);
    // 小掩体：酒桶
    this.barrelSpots = [
      [-5, 5], [-4.2, 6.2], [12, -12], [12.8, -11], [-18, -3], [25, 6], [-26, -12], [6, 15],
    ];
    for (const [x, z] of this.barrelSpots) this.addCollider(x, 0, z, 1.0, 1.3, 1.0);

    // ---------- 丧尸的出生点：广场内圈（在联排小楼前方，别刷进楼里）----------
    const r = S - 16;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.spawnPoints.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }

    this.buildLights();
    this.buildAmbiance();
    // 所有碰撞盒登记完后，建流场寻路网格
    this.flow = new FlowField(this.colliders, this.size, 1.6);
  }

  /** 氛围：小镇=暖窗+街灯+南法街景；沙漠=沙丘/仙人掌；军营=营房/帐篷/沙袋/瞭望塔 */
  buildAmbiance() {
    if (this.theme === 'desert') {
      if (GFX.体素细节 !== false) this.addDesertShowcase();
      return;
    }
    if (this.theme === 'barracks') {
      if (GFX.街灯 !== false) this.addLamps();   // 探照/营地灯复用街灯池
      if (GFX.体素细节 !== false) this.addBarracksShowcase();
      return;
    }
    if (GFX.暖窗 !== false) this.addWindows();
    if (GFX.街灯 !== false) this.addLamps();
    if (GFX.体素细节 !== false) this.addVoxelShowcase();
  }

  /**
   * 一个物件体素模型 → 合并网格 → 放进场景（可选碰撞盒）。rotY 只用 0/±90/180。
   * opts.batch: 传字符串则不单独建 mesh，而是攒进该批次，最后 flushBatches() 合成一个网格
   * （大幅降 draw call；仅适用于静态、同材质参数的道具）。
   */
  placeVoxel(vol, vs, wx, wz, rotY = 0, opts = {}) {
    const W = vol.sx * vs, H = vol.sy * vs, D = vol.sz * vs;
    // 生成时把体居中在 X、front(+z) 在 +D/2，方便旋转朝向
    const res = greedyMesh(vol, vs, new THREE.Vector3(-W / 2, 0, -D / 2));
    this._voxTris = (this._voxTris || 0) + res.tris;

    if (opts.batch) {
      // 把变换烘进几何，攒批
      const g = res.geometry;
      g.rotateY(rotY);
      g.translate(wx, opts.y ?? 0, wz);
      this._batches = this._batches || {};
      (this._batches[opts.batch] = this._batches[opts.batch] || { geos: [], opts }).geos.push(g);
      if (opts.collide) this._addRotatedCollider(wx, wz, W, H, D, rotY);
      return null;
    }

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.rough ?? 0.82, metalness: 0 });
    const m = new THREE.Mesh(res.geometry, mat);
    m.position.set(wx, opts.y ?? 0, wz);
    m.rotation.y = rotY;
    m.castShadow = opts.cast ?? true;
    m.receiveShadow = true;
    this.scene.add(m);
    this.hitMeshes.push(m);
    if (opts.collide) this._addRotatedCollider(wx, wz, W, H, D, rotY);
    return m;
  }

  _addRotatedCollider(wx, wz, W, H, D, rotY) {
    // 旋转后的世界足迹（0/±90/180 都是轴对齐）
    const halfW = (Math.abs(Math.cos(rotY)) * W + Math.abs(Math.sin(rotY)) * D) / 2;
    const halfD = (Math.abs(Math.sin(rotY)) * W + Math.abs(Math.cos(rotY)) * D) / 2;
    this.colliders.push({
      min: new THREE.Vector3(wx - halfW, 0, wz - halfD),
      max: new THREE.Vector3(wx + halfW, H, wz + halfD),
    });
  }

  /** 把各批次几何合并成单个网格，大幅降低 draw call */
  flushBatches() {
    if (!this._batches) return;
    for (const [name, b] of Object.entries(this._batches)) {
      if (!b.geos.length) continue;
      const merged = mergeGeometries(b.geos, false);
      b.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: b.opts.rough ?? 0.82, metalness: 0 });
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = b.opts.cast ?? true;
      m.receiveShadow = true;
      m.name = 'batch_' + name;
      this.scene.add(m);
      this.hitMeshes.push(m);
    }
    this._batches = null;
  }

  /** 铺开整条南法小街：四面联排小楼围合 + 喷泉/梧桐/咖啡桌等标志物。视觉盖在碰撞上，不动打枪逻辑。 */
  addVoxelShowcase() {
    const vs = 0.16;
    const style = 建筑风格.法国南部;
    const S = this.size, uw = 28, dd = 18;
    const Dw = dd * vs;                 // 楼深（世界）
    const inner = S - 3;               // 楼背贴近外墙

    // 四面联排（立面朝内）。units 控制长度。
    const sides = [
      { units: 13, rotY: 0, at: [0, -(inner - Dw / 2)], seed: 2 },              // 北，朝 +z
      { units: 13, rotY: Math.PI, at: [0, inner - Dw / 2], seed: 5 },           // 南，朝 -z
      { units: 13, rotY: Math.PI / 2, at: [-(inner - Dw / 2), 0], seed: 8 },    // 西，朝 +x
      { units: 13, rotY: -Math.PI / 2, at: [inner - Dw / 2, 0], seed: 11 },     // 东，朝 -x
    ];
    for (const s of sides) {
      const ter = makeTerrace(style, { units: s.units, unitW: uw, d: dd, baseSeed: s.seed });
      this.placeVoxel(ter, vs, s.at[0], s.at[1], s.rotY, { collide: true, batch: 'terraces' });
    }

    // ---- 战斗掩体（体素化，统一南法市集风；碰撞已在 build() 登记）----
    // 同类道具攒成一个批次 → 合成单网格，大幅降 draw call
    this.stallSpots.forEach(([x, z, rot], i) => this.placeVoxel(makeStall(i + 1), vs, x, z, rot, { batch: 'stalls' }));
    this.crateSpots.forEach(([x, z], i) => this.placeVoxel(makeCrates(i + 1), vs, x, z, (i % 4) * Math.PI / 2, { batch: 'crates' }));
    this.planterSpots.forEach(([x, z], i) => this.placeVoxel(makePlanter(i + 1), vs, x, z, (i % 2) * Math.PI / 2, { batch: 'planters' }));
    this.barrelSpots.forEach(([x, z]) => this.placeVoxel(makeBarrel(), vs, x, z, 0, { batch: 'barrels' }));
    // 中央石台（视觉），碰撞已在 build() 登记
    this.placeVoxel(makeStonePlatform(76, 22), vs, 0, 0, 0, { batch: 'props', rough: 0.9 });

    // 标志物
    this.placeVoxel(makeFountain(), vs, 14, 14, 0, { batch: 'props', collide: true });
    const treeSpots = [[-12, 16], [20, 12], [-24, -6], [24, -18], [-2, -22], [10, -16]];
    treeSpots.forEach(([x, z], i) => this.placeVoxel(makeTree(i + 1), vs, x, z, 0, { batch: 'trees' }));
    const tableSpots = [[-16, 12], [-10, 15], [18, 6], [7, 17]];
    tableSpots.forEach(([x, z]) => this.placeVoxel(makeTable(), vs, x, z, 0, { batch: 'tables' }));

    this.flushBatches();
    this.voxelStats = { tris: this._voxTris };
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
    if (this.theme === 'desert') return this.buildDesertLights();
    if (this.theme === 'barracks') return this.buildBarracksLights();
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

  /** 沙漠白天强光：炽热天光 + 高角度暖白太阳 + 硬阴影 */
  buildDesertLights() {
    // 半球光：上天蓝 / 下暖沙反弹，整体明亮
    this.scene.add(new THREE.HemisphereLight(0xbfd4ec, 0xd8b878, 2.1));
    this.scene.add(new THREE.AmbientLight(0xffe8c0, 0.4));

    const sun = new THREE.DirectionalLight(0xfff2d0, 3.0);   // 炽白日照
    sun.position.set(24, 66, 30);
    sun.target.position.set(0, 0, 0);
    this.scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
    const d = 42;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 150;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.sun = sun;
  }

  /** 沙漠街景：中央砂岩台 + 巨石/仙人掌/枯灌木掩体（复用同一套碰撞点）+ 围边沙丘/废柱/白骨 */
  addDesertShowcase() {
    const vs = 0.16;
    const sandPal = { stone: 0xc2a068, stone2: 0xb08c54, cap: 0xd0b478, dark: 0x8a6a3c };

    // 中央砂岩高台（视觉；碰撞已在 build 登记）
    this.placeVoxel(makeStonePlatform(76, 22, sandPal), vs, 0, 0, 0, { batch: 'props', rough: 1.0 });

    // 高掩体（原摊位点）→ 砂岩巨砾
    this.stallSpots.forEach(([x, z, rot], i) =>
      this.placeVoxel(makeRock(i + 1, { w: 40, h: 24, d: 26 }), vs, x, z, rot, { batch: 'rocks' }));
    // 中掩体（原箱堆点）→ 中巨石
    this.crateSpots.forEach(([x, z], i) =>
      this.placeVoxel(makeRock(i + 3, { w: 20, h: 16, d: 15 }), vs, x, z, (i % 4) * Math.PI / 2, { batch: 'rocks' }));
    // 矮掩体（原花坛点）→ 枯灌木/矮岩
    this.planterSpots.forEach(([x, z], i) =>
      this.placeVoxel(makeDeadShrub(i + 1), vs, x, z, (i % 2) * Math.PI / 2, { batch: 'shrubs' }));
    // 小掩体（原酒桶点）→ 仙人掌
    this.barrelSpots.forEach(([x, z], i) =>
      this.placeVoxel(makeCactus(i + 1), vs, x, z, 0, { batch: 'cacti' }));

    // 围边沙丘（贴外墙一圈，矮不挡枪，只做轮廓）
    const S = this.size, e = S - 5;
    const dunes = [
      [0, -e, 0], [0, e, 0], [-e, 0, Math.PI / 2], [e, 0, Math.PI / 2],
      [-e * 0.6, -e, 0], [e * 0.6, -e, 0], [-e * 0.6, e, 0], [e * 0.6, e, 0],
      [-e, -e * 0.55, Math.PI / 2], [-e, e * 0.55, Math.PI / 2], [e, -e * 0.55, Math.PI / 2], [e, e * 0.55, Math.PI / 2],
    ];
    dunes.forEach(([x, z, rot], i) => this.placeVoxel(makeDune(i + 1, { w: 62, h: 13, d: 24 }), vs, x, z, rot, { batch: 'dunes' }));

    // 地标：几根残破石柱 + 白骨点缀（不挡路）
    const pillars = [[-34, -30], [33, -34], [-36, 30], [36, 32]];
    pillars.forEach(([x, z], i) => this.placeVoxel(makeRuinPillar(i + 1), vs, x, z, 0, { batch: 'ruins', collide: true }));
    const bones = [[-8, -30], [18, 30], [-30, 8], [28, -14]];
    bones.forEach(([x, z], i) => this.placeVoxel(makeBones(i + 1), vs, x, z, (i % 4) * Math.PI / 2, { batch: 'bones' }));

    this.flushBatches();
    this.voxelStats = { tris: this._voxTris };
  }

  /** 军营·阴冷黄昏：偏冷的天光 + 低角度冷白探照方向光 + 硬阴影 */
  buildBarracksLights() {
    this.scene.add(new THREE.HemisphereLight(0x8f9aa8, 0x565039, 1.5));
    this.scene.add(new THREE.AmbientLight(0x6a6e72, 0.45));
    const sun = new THREE.DirectionalLight(0xd6dae0, 1.9);   // 冷白
    sun.position.set(-30, 52, 24);
    sun.target.position.set(0, 0, 0);
    this.scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
    const d = 42;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 150;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.sun = sun;
  }

  /** 军营街景：中央混凝土台 + 帐篷/军箱/沙袋/油桶掩体（复用同套碰撞点）+ 围边营房 + 瞭望塔 */
  addBarracksShowcase() {
    const vs = 0.16;
    const concrete = { stone: 0x8a8c82, stone2: 0x767869, cap: 0x9a9c90, dark: 0x565749 };

    // 中央混凝土高台（视觉；碰撞已在 build 登记）
    this.placeVoxel(makeStonePlatform(76, 22, concrete), vs, 0, 0, 0, { batch: 'props', rough: 1.0 });

    // 高掩体（原摊位点）→ 军用帐篷
    this.stallSpots.forEach(([x, z, rot], i) => this.placeVoxel(makeTent(i + 1), vs, x, z, rot, { batch: 'tents' }));
    // 中掩体（原箱堆点）→ 军用补给箱
    this.crateSpots.forEach(([x, z], i) => this.placeVoxel(makeMilCrate(i + 1), vs, x, z, (i % 4) * Math.PI / 2, { batch: 'milcrates' }));
    // 矮掩体（原花坛点）→ 沙袋墙
    this.planterSpots.forEach(([x, z], i) => this.placeVoxel(makeSandbags(i + 1), vs, x, z, (i % 2) * Math.PI / 2, { batch: 'sandbags' }));
    // 小掩体（原酒桶点）→ 油桶
    this.barrelSpots.forEach(([x, z]) => this.placeVoxel(makeBarrel(), vs, x, z, 0, { batch: 'drums' }));

    // 围边营房（四面贴墙，立面朝内）
    const S = this.size, inner = S - 6;
    const huts = [
      [0, -inner, 0], [0, inner, Math.PI], [-inner, 0, Math.PI / 2], [inner, 0, -Math.PI / 2],
      [-24, -inner, 0], [24, -inner, 0], [-24, inner, Math.PI], [24, inner, Math.PI],
    ];
    huts.forEach(([x, z, rot], i) => this.placeVoxel(makeBarracksHut(i + 1, { w: 44, h: 22, d: 18 }), vs, x, z, rot, { batch: 'huts', collide: true }));

    // 地标：四角瞭望塔
    const towers = [[-34, -34], [34, -34], [-34, 34], [34, 34]];
    towers.forEach(([x, z], i) => this.placeVoxel(makeWatchtower(i + 1), vs, x, z, 0, { batch: 'towers', collide: true }));

    this.flushBatches();
    this.voxelStats = { tris: this._voxTris };
  }

  /** 玩家出生位置 */
  playerSpawn() {
    return new THREE.Vector3(0, 0, 20);
  }
}
