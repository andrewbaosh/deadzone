/**
 * 程序化体素模型（配合 greedyMesh）。返回 { sx, sy, sz, get(x,y,z) }。
 * 建筑立面朝 +z。
 */

function hash1(s) { let h = (s * 2654435761) & 0x7fffffff; h = ((h ^ (h >> 15)) * 2246822519) & 0x7fffffff; return (h & 0xffff) / 0xffff; }
function hash2(x, z) { let h = (x * 374761393 + z * 668265263) & 0x7fffffff; h = (h ^ (h >> 13)) * 1274126177 & 0x7fffffff; return (h & 0xffff) / 0xffff; }
const pick = (arr, s) => arr[Math.floor(hash1(s) * arr.length) % arr.length];
function shade(hex, k) {
  const r = Math.min(255, ((hex >> 16) & 255) * k) | 0, g = Math.min(255, ((hex >> 8) & 255) * k) | 0, b = Math.min(255, (hex & 255) * k) | 0;
  return (r << 16) | (g << 8) | b;
}

/* ---------------- 建筑 ---------------- */
function unitConfig(style, w, h, d, seed) {
  const baseTop = 4, roofH = 7, bodyTop = h - roofH, floorH = 11, winW = 4, winH = 6;
  const colCenters = [Math.round(w * 0.28), Math.round(w * 0.72)];
  const nFloors = Math.max(1, Math.floor((bodyTop - baseTop - 3) / floorH));
  const wins = [];
  for (let f = 0; f < nFloors; f++) { const y0 = baseTop + 4 + f * floorH; for (const cx of colCenters) wins.push({ x0: cx - winW / 2, x1: cx + winW / 2 - 1, y0, y1: y0 + winH - 1 }); }
  return {
    w, h, d, baseTop, bodyTop,
    wall: pick(style.墙, seed * 7 + 1), roof: pick(style.瓦, seed * 13 + 3),
    roofDark: shade(pick(style.瓦, seed * 13 + 3), 0.82), shutter: pick(style.百叶窗, seed * 17 + 5),
    wins, doorX0: Math.round(w / 2) - 2, doorX1: Math.round(w / 2) + 1,
  };
}
function unitVoxel(cfg, style, x, y, z) {
  const { w, h, d, baseTop, bodyTop, wins, doorX0, doorX1, wall, roof, roofDark, shutter } = cfg;
  if (y >= bodyTop) { const r = y - bodyTop; if (x < r || x >= w - r || z < r || z >= d - r) return -1; if (y === h - 1) return style.瓦脊; return (x + z) & 1 ? roof : roofDark; }
  if (y < baseTop) return style.地基;
  if (x < 2 || x >= w - 2) { if (Math.floor(y / 2) % 2 === 0) return style.角石; }
  if (y === baseTop + 2 || y === bodyTop - 1) return style.檐;
  if (z === d - 1) {
    if (y >= baseTop && y < baseTop + 7 && x >= doorX0 && x <= doorX1) return style.门;
    for (const wn of wins) if (x >= wn.x0 && x <= wn.x1 && y >= wn.y0 && y <= wn.y1) return -1;
    for (const wn of wins) if (x >= wn.x0 - 1 && x <= wn.x1 + 1 && y >= wn.y0 - 1 && y <= wn.y1 + 1) return style.窗框;
    for (const wn of wins) if (y >= wn.y0 - 1 && y <= wn.y1) { if ((x >= wn.x0 - 3 && x <= wn.x0 - 2) || (x >= wn.x1 + 2 && x <= wn.x1 + 3)) return shutter; }
  }
  if (z === d - 2) {
    for (const wn of wins) if (x >= wn.x0 && x <= wn.x1 && y >= wn.y0 && y <= wn.y1) return hash2(wn.x0, wn.y0) < 0.72 ? style.窗亮 : style.窗暗;
    if (y >= baseTop && y < baseTop + 7 && x >= doorX0 && x <= doorX1) return style.门;
  }
  const n = (x * 2 + y * 3 + z) % 9;
  return n === 0 ? style.墙暗 : n === 4 ? shade(wall, 1.05) : wall;
}

export function makeBuilding(style, opts = {}) {
  const w = opts.w ?? 28, h = opts.h ?? 48, d = opts.d ?? 18, seed = opts.seed ?? 1;
  const cfg = unitConfig(style, w, h, d, seed);
  return { sx: w, sy: h, sz: d, get: (x, y, z) => unitVoxel(cfg, style, x, y, z) };
}

/** 一整排联排小楼合成一个体（一个 draw call）。高低错落。 */
export function makeTerrace(style, opts = {}) {
  const units = opts.units ?? 10, uw = opts.unitW ?? 28, d = opts.d ?? 18, baseSeed = opts.baseSeed ?? 1;
  const heights = opts.heights ?? Array.from({ length: units }, (_, i) => 44 + Math.floor(hash1(baseSeed * 31 + i) * 6) * 2);
  const maxH = Math.max(...heights);
  const cfgs = heights.map((h, i) => unitConfig(style, uw, h, d, baseSeed * 100 + i + 1));
  return {
    sx: units * uw, sy: maxH, sz: d,
    get(x, y, z) {
      const ui = Math.floor(x / uw); if (ui < 0 || ui >= units) return -1;
      const cfg = cfgs[ui]; if (y >= cfg.h) return -1;
      return unitVoxel(cfg, style, x - ui * uw, y, z);
    },
  };
}

/* ---------------- 标志物 ---------------- */

/** 石砌喷泉：方形水池 + 中央水柱 */
export function makeFountain() {
  const s = 30, hgt = 16, R = s / 2;
  const stone = 0x9a8c72, stone2 = 0x8a7c64, water = 0x2f6274, waterTop = 0x5a92a8;
  return {
    sx: s, sy: hgt, sz: s,
    get(x, y, z) {
      const rr = Math.max(Math.abs(x - R + 0.5), Math.abs(z - R + 0.5));
      if (y < 6) {
        if (rr > R - 2 && rr <= R - 0.5) return (x + z) & 1 ? stone : stone2;   // 池壁
        if (rr <= R - 2) { if (y < 1) return stone; if (y < 4) return water; if (y === 4) return waterTop; return -1; }
        return -1;
      }
      if (rr < 2.2) return y === hgt - 1 ? waterTop : stone;   // 中央柱
      if (y === 8 && rr < 5) return (x + z) & 1 ? stone : stone2;   // 中层小盆边
      return -1;
    },
  };
}

/** 法国梧桐：树干 + 团块树冠 */
export function makeTree(seed = 1) {
  const s = 26, h = 40, R = s / 2;
  const trunk = 0x5a4632, trunk2 = 0x4a3a2a;
  const leaf = [0x3a5a2e, 0x46683a, 0x33502a, 0x50704a, 0x2e4a26];
  return {
    sx: s, sy: h, sz: s,
    get(x, y, z) {
      const dx = x - R + 0.5, dz = z - R + 0.5;
      const r = Math.hypot(dx, dz);
      if (y < 16) return r < 1.8 ? ((y & 1) ? trunk : trunk2) : -1;
      const cy = y - 27;
      const rr = Math.hypot(dx, dz, cy * 1.15);
      const wobble = (hash2(x + seed * 13, z + y * 7) - 0.5) * 4;
      if (rr < 9 + wobble) return leaf[(hash2(x, z * 3 + y) * leaf.length) | 0];
      return -1;
    },
  };
}

/* ---------------- 战斗掩体（南法市集风，替代灰盒子） ---------------- */

/** 市集摊位：条纹遮阳棚 + 木架 + 货物（高掩体，约 6.4×3.5×4m） */
export function makeStall(seed = 1) {
  const w = 40, h = 22, d = 26;
  const wood = 0x6b4f33, wood2 = 0x5a4029, post = 0x4a3625;
  const awnA = pick([0xc0503f, 0x3f6f8a, 0x4a7a52, 0x9a6a3a], seed * 3 + 1);
  const awnB = 0xe8dcc0;
  const goods = [0xc4633a, 0x7a9a4a, 0xb8a03a, 0x8a4a6a, 0xd0a050, 0x5a8a7a];
  return {
    sx: w, sy: h, sz: d,
    get(x, y, z) {
      const edgeX = x < 3 || x >= w - 3, edgeZ = z < 3 || z >= d - 3;
      // 遮阳棚（顶部，前沿下垂）
      if (y >= h - 4) {
        const drop = z >= d - 4 ? 1 : 0;             // 前沿多探出
        if (y >= h - 1 - drop) return -1;
        return (Math.floor(x / 4) & 1) ? awnA : awnB;   // 条纹
      }
      // 四角立柱
      if (y < h - 4 && edgeX && edgeZ) return post;
      // 台面
      if (y >= 9 && y <= 10) { if (x >= 2 && x < w - 2 && z >= 2 && z < d - 2) return (x + z) & 1 ? wood : wood2; }
      // 台下挡板（半高，可蹲）
      if (y < 9 && y >= 1 && z >= d - 4 && x >= 2 && x < w - 2) return wood2;
      // 台面上的货物（几堆箱子/筐）
      if (y > 10 && y < 15) {
        const gx = Math.floor((x - 4) / 7), gz = Math.floor((z - 5) / 8);
        if (gx >= 0 && gz >= 0 && (x - 4) % 7 < 5 && (z - 5) % 8 < 6) {
          const top = 11 + Math.floor(hash1(seed * 17 + gx * 5 + gz) * 3);
          if (y <= top) return goods[Math.floor(hash1(seed * 29 + gx * 7 + gz * 3) * goods.length) % goods.length];
        }
      }
      return -1;
    },
  };
}

/** 板条箱堆：木箱带板条缝（中掩体，约 3×2.5×2.2m） */
export function makeCrates(seed = 1) {
  const w = 19, h = 16, d = 14;
  const A = 0x8a6a42, B = 0x7a5c38, edge = 0x5f4529;
  const box = (x, y, z, bx, by, bz, bw, bh, bd) =>
    x >= bx && x < bx + bw && y >= by && y < by + bh && z >= bz && z < bz + bd;
  const skin = (x, y, z, bx, by, bz, bw, bh, bd) => {
    const lx = x - bx, ly = y - by, lz = z - bz;
    if (lx < 1 || ly < 1 || lz < 1 || lx >= bw - 1 || ly >= bh - 1 || lz >= bd - 1) return edge;  // 棱
    return (Math.floor(ly / 3) & 1) ? A : B;   // 板条
  };
  return {
    sx: w, sy: h, sz: d,
    get(x, y, z) {
      // 底层两个箱 + 上层一个偏移箱
      if (box(x, y, z, 0, 0, 0, 10, 9, 10)) return skin(x, y, z, 0, 0, 0, 10, 9, 10);
      if (box(x, y, z, 10, 0, 2, 9, 8, 9)) return skin(x, y, z, 10, 0, 2, 9, 8, 9);
      const ox = seed % 2 ? 3 : 6;
      if (box(x, y, z, ox, 9, 1, 9, 7, 9)) return skin(x, y, z, ox, 9, 1, 9, 7, 9);
      return -1;
    },
  };
}

/** 石花坛：石砌边 + 泥土 + 花草（矮掩体，蹲下可躲，约 2.6×1.2×1.4m） */
export function makePlanter(seed = 1) {
  const w = 16, h = 8, d = 9;
  const stone = 0xa89878, stone2 = 0x968764, soil = 0x3a2a1c;
  const leaf = [0x4a6f38, 0x3f5f30, 0x567d42];
  const bloom = [0xb04a6a, 0xc08a3a, 0x8a5aa0, 0xc4544a];
  return {
    sx: w, sy: h, sz: d,
    get(x, y, z) {
      const rim = x < 2 || z < 2 || x >= w - 2 || z >= d - 2;
      if (y < 5) return rim ? ((x + z + y) & 1 ? stone : stone2) : (y >= 3 ? soil : stone2);
      if (y === 5 && rim) return stone;               // 压顶
      if (y >= 5 && !rim) {                            // 花草
        const r = hash2(x * 3 + seed, z * 5 + y);
        if (y === 5) return r < 0.85 ? leaf[(r * 997 | 0) % leaf.length] : -1;
        if (y === 6) return r < 0.5 ? leaf[(r * 991 | 0) % leaf.length] : (r < 0.62 ? bloom[(r * 983 | 0) % bloom.length] : -1);
        if (y === 7) return r < 0.18 ? bloom[(r * 977 | 0) % bloom.length] : -1;
      }
      return -1;
    },
  };
}

/** 橡木酒桶：桶身 + 铁箍（小掩体，约 0.9×1.2m） */
export function makeBarrel() {
  const w = 7, h = 8, d = 7, R = w / 2;
  const oak = 0x7a5230, oak2 = 0x6a4526, band = 0x4a4a50;
  return {
    sx: w, sy: h, sz: d,
    get(x, y, z) {
      const dx = x - R + 0.5, dz = z - R + 0.5;
      const bulge = 1 + 0.28 * Math.sin((y / (h - 1)) * Math.PI);   // 中间鼓
      const r = Math.hypot(dx, dz) / bulge;
      if (r > R - 0.9) return -1;
      if (y === 1 || y === h - 2) return band;                       // 铁箍
      if (y === 0 || y === h - 1) return oak2;                       // 桶盖
      return ((x + z) & 1) ? oak : oak2;
    },
  };
}

/** 中央石台：可登高的石砌平台 + 栏杆（替代灰方块中央建筑）。pal 可换沙漠砂岩配色 */
export function makeStonePlatform(size = 76, hgt = 22, pal = null) {
  const stone = pal?.stone ?? 0xb0a284, stone2 = pal?.stone2 ?? 0x9e9074,
    cap = pal?.cap ?? 0xc0b294, dark = pal?.dark ?? 0x8a7c60;
  return {
    sx: size, sy: hgt, sz: size,
    get(x, y, z) {
      const edge = x < 2 || z < 2 || x >= size - 2 || z >= size - 2;
      const top = hgt - 6;
      if (y < top) {
        if (y === top - 1) return cap;                              // 台沿压顶
        if (edge) return (Math.floor(y / 3) + x + z) & 1 ? stone : stone2;   // 砌块感外墙
        return dark;                                                 // 内部（看不见）
      }
      // 栏杆：立柱 + 扶手（留出东侧台阶口）
      const openEast = x >= size - 3 && z > size * 0.35 && z < size * 0.65;
      if (openEast) return -1;
      if (!edge) return -1;
      if (y === hgt - 1) return cap;                                 // 扶手
      return (x % 6 < 2 || z % 6 < 2) ? stone : -1;                  // 栏杆柱
    },
  };
}

/** 露天咖啡桌 + 红桌布 + 两把椅子 */
export function makeTable() {
  const s = 16, h = 11, R = s / 2;
  const leg = 0x3a2e22, cloth = 0xb0392c, cloth2 = 0xc85341, chair = 0x4a3a2a;
  return {
    sx: s, sy: h, sz: s,
    get(x, y, z) {
      const dx = x - R + 0.5, dz = z - R + 0.5, r = Math.hypot(dx, dz);
      if (y >= 7 && y <= 8 && r < 4.4) return (x + z) & 1 ? cloth : cloth2;   // 桌布
      if (y < 7 && Math.abs(dx) < 1 && Math.abs(dz) < 1) return leg;           // 桌腿
      for (const cxx of [R - 6, R + 4]) {                                       // 两把椅子
        if (Math.abs(x - cxx) <= 1.5 && Math.abs(dz) < 1.8) { if (y < 4) return chair; if (y >= 4 && y < 5 && x < cxx) return chair; }
      }
      return -1;
    },
  };
}

/* ================= 沙漠地图道具 ================= */

const _box = (x, y, z, x0, x1, y0, y1, z0, z1) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;

/** 巨石/砂岩巨砾（椭球堆叠，按尺寸做大/中/矮掩体） */
export function makeRock(seed = 1, opts = {}) {
  const w = opts.w ?? 20, h = opts.h ?? 15, d = opts.d ?? 15;
  const rock = 0x9a8262, rock2 = 0x866e4e, rock3 = 0xa89070, shadow = 0x6f5a3e;
  // 1~2 个椭球堆叠
  const blobs = [{ cx: w / 2, cy: h * 0.42, cz: d / 2, rx: w * 0.5, ry: h * 0.55, rz: d * 0.5 }];
  if ((seed % 2) === 0) blobs.push({ cx: w * 0.32, cy: h * 0.3, cz: d * 0.6, rx: w * 0.34, ry: h * 0.4, rz: d * 0.34 });
  return {
    sx: w, sy: h, sz: d,
    get(x, y, z) {
      let inside = false;
      for (const b of blobs) {
        const nx = (x - b.cx) / b.rx, ny = (y - b.cy) / b.ry, nz = (z - b.cz) / b.rz;
        const noise = (hash2(x * 2 + seed * 7, z * 3 + y) - 0.5) * 0.22;
        if (nx * nx + ny * ny + nz * nz <= 1 + noise) { inside = true; break; }
      }
      if (!inside) return -1;
      if (y < 1) return shadow;
      const r = hash2(x * 5 + seed, z * 7 + y * 3);
      return r < 0.2 ? shadow : r < 0.5 ? rock2 : r < 0.82 ? rock : rock3;
    },
  };
}

/** 仙人掌（萨瓜罗）：主干 + 两条上举的手臂 + 顶花 */
export function makeCactus(seed = 1) {
  const w = 9, h = 30, d = 9, cx = 4, cz = 4;
  const green = 0x4c7a3e, green2 = 0x3f6a33, dark = 0x2f5228, flower = 0xd8607a;
  const armH = 12 + Math.floor(hash1(seed * 5) * 6);
  return {
    sx: w, sy: h, sz: d,
    get(x, y, z) {
      const dx = x - cx, dz = z - cz;
      const trunkR = (Math.abs(dz) <= 1 && Math.abs(dx) <= 1);
      // 主干
      if (trunkR && y < 27) return y === 26 ? flowerTop(x, z) : ribbed(x, y, z);
      // 左臂：横 (y=armH) 再竖
      if (y === armH && dx >= -3 && dx <= -1 && Math.abs(dz) <= 1) return ribbed(x, y, z);
      if (dx >= -3 && dx <= -2 && Math.abs(dz) <= 1 && y >= armH && y <= armH + 7) return y === armH + 7 ? flower : ribbed(x, y, z);
      // 右臂：横 (y=armH+4) 再竖
      if (y === armH + 4 && dx >= 1 && dx <= 3 && Math.abs(dz) <= 1) return ribbed(x, y, z);
      if (dx >= 2 && dx <= 3 && Math.abs(dz) <= 1 && y >= armH + 4 && y <= armH + 11) return y === armH + 11 ? flower : ribbed(x, y, z);
      return -1;
      function ribbed(x, y) { const rib = ((x + 100) % 2) === 0; return (y % 6 === 0) ? dark : rib ? green : green2; }
      function flowerTop(x, z) { return ((x + z) & 1) ? flower : green; }
    },
  };
}

/** 枯灌木/矮岩（矮掩体，蹲下可躲） */
export function makeDeadShrub(seed = 1) {
  const w = 16, h = 8, d = 10;
  const rock = 0x8a7454, rock2 = 0x76603e, twig = 0x5a4a34, twig2 = 0x6a5638;
  return {
    sx: w, sy: h, sz: d,
    get(x, y, z) {
      const dx = x - w / 2, dz = z - d / 2;
      // 底部矮岩
      const nx = dx / (w * 0.5), ny = (y - 1) / 4, nz = dz / (d * 0.5);
      if (y < 5 && nx * nx + ny * ny + nz * nz <= 1 + (hash2(x + seed, z + y) - 0.5) * 0.2)
        return (hash2(x * 3, z * 3 + y) < 0.4) ? rock2 : rock;
      // 顶部几根枯枝
      if (y >= 4 && Math.abs(dx) <= 4 && Math.abs(dz) <= 3) {
        const r = hash2(x * 7 + seed, z * 5 + y * 3);
        if (r < 0.12) return (y & 1) ? twig : twig2;
      }
      return -1;
    },
  };
}

/** 沙丘（很宽很矮的沙堆，围边用；矮到不挡枪但有轮廓） */
export function makeDune(seed = 1, opts = {}) {
  const w = opts.w ?? 60, h = opts.h ?? 14, d = opts.d ?? 26;
  const sand = 0xcdae76, sand2 = 0xbe9d64, sand3 = 0xd8bd88, shade = 0xa88a54;
  const cx = w / 2, cz = d / 2;
  return {
    sx: w, sy: h, sz: d,
    get(x, y, z) {
      const nx = (x - cx) / (w * 0.5), nz = (z - cz) / (d * 0.5);
      const rise = 1 - (nx * nx + nz * nz);                    // 中间高四周低
      if (rise <= 0) return -1;
      const top = rise * (h - 1) + (hash2(x + seed * 9, z) - 0.5) * 1.5;
      if (y > top) return -1;
      const r = hash2(x * 3 + seed, z * 2);
      // 风纹：斜向条带
      const ripple = ((x + z * 2) % 5) < 2;
      if (y >= top - 1) return ripple ? sand3 : sand;
      return r < 0.25 ? shade : r < 0.6 ? sand2 : sand;
    },
  };
}

/** 残破砂岩石柱（地标/高掩体） */
export function makeRuinPillar(seed = 1) {
  const w = 12, h = 34, d = 12;
  const s1 = 0xc2a068, s2 = 0xb08c54, s3 = 0xa07c46, cap = 0xd0b478;
  const topBreak = 22 + Math.floor(hash1(seed * 11) * 10);   // 断裂高度
  return {
    sx: w, sy: h, sz: d,
    get(x, y, z) {
      if (y > topBreak) return -1;
      const dx = x - w / 2, dz = z - d / 2;
      // 略收腰的方柱
      const inset = (y > topBreak - 3) ? (topBreak - y >= 0 ? Math.floor(hash2(x + seed, z + y) * 2) : 0) : 0;
      if (Math.abs(dx) > w / 2 - 1.5 - inset || Math.abs(dz) > d / 2 - 1.5 - inset) return -1;
      if (y % 7 === 0) return cap;                              // 砌块横缝
      const r = hash2(x * 3 + seed, z * 5 + y);
      return r < 0.3 ? s3 : r < 0.65 ? s2 : s1;
    },
  };
}

/** 白骨（牛头骨 + 几根肋骨，沙漠点缀，不挡路） */
export function makeBones(seed = 1) {
  const w = 14, h = 6, d = 10;
  const bone = 0xdcd2b4, bone2 = 0xc8bd9a;
  return {
    sx: w, sy: h, sz: d,
    get(x, y, z) {
      const dx = x - 4, dz = z - d / 2;
      // 头骨（左侧一团）+ 两只角
      if (y < 4 && (dx * dx) / 9 + ((y - 1) * (y - 1)) / 4 + (dz * dz) / 6 <= 1) return (hash2(x, z + y) < 0.3) ? bone2 : bone;
      if (y >= 2 && y <= 4 && Math.abs(dz) >= 2 && Math.abs(dz) <= 3 && dx >= -2 && dx <= 0) return bone;   // 角
      // 肋骨（右侧几根弧）
      for (let i = 0; i < 4; i++) {
        const rx = 8 + i * 1.4;
        if (Math.abs(x - rx) < 0.8 && y <= 2 + Math.floor(Math.sin((z / d) * Math.PI) * 2)) return bone2;
      }
      return -1;
    },
  };
}
