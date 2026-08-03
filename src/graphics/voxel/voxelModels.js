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
