/**
 * 程序化体素模型（配合 greedyMesh 使用）。
 * 每个模型返回 { sx, sy, sz, get(x,y,z) }，get 返回 0xRRGGBB 颜色或 -1(空)。
 * 立面朝 +z（放置时让 +z 对着玩家）。
 */

// 确定性 hash（避免 Math.random，保证每次一样、同 seed 同结果）
function hash1(s) {
  let h = (s * 2654435761) & 0x7fffffff;
  h = ((h ^ (h >> 15)) * 2246822519) & 0x7fffffff;
  return (h & 0xffff) / 0xffff;
}
function hash2(x, z) {
  let h = (x * 374761393 + z * 668265263) & 0x7fffffff;
  h = (h ^ (h >> 13)) * 1274126177 & 0x7fffffff;
  return (h & 0xffff) / 0xffff;
}
const pick = (arr, s) => arr[Math.floor(hash1(s) * arr.length) % arr.length];

/**
 * 一栋风格化联排小楼。
 * style: styles.js 里的一项；opts: { seed, w, h, d }
 */
export function makeBuilding(style, opts = {}) {
  const w = opts.w ?? 28, h = opts.h ?? 48, d = opts.d ?? 18;
  const seed = opts.seed ?? 1;

  const wall = pick(style.墙, seed * 7 + 1);
  const roof = pick(style.瓦, seed * 13 + 3);
  const shutter = pick(style.百叶窗, seed * 17 + 5);
  const roofDark = shade(roof, 0.82);

  const baseTop = 4, roofH = 7, bodyTop = h - roofH, floorH = 11;
  const winW = 4, winH = 6;
  const colCenters = [Math.round(w * 0.28), Math.round(w * 0.72)];
  const nFloors = Math.max(1, Math.floor((bodyTop - baseTop - 3) / floorH));

  const wins = [];
  for (let f = 0; f < nFloors; f++) {
    const y0 = baseTop + 4 + f * floorH;
    for (const cx of colCenters) wins.push({ x0: cx - winW / 2, x1: cx + winW / 2 - 1, y0, y1: y0 + winH - 1 });
  }
  const doorX0 = Math.round(w / 2) - 2, doorX1 = Math.round(w / 2) + 1;

  return {
    sx: w, sy: h, sz: d,
    get(x, y, z) {
      // 陶土坡屋顶（顶部逐层收边）
      if (y >= bodyTop) {
        const r = y - bodyTop;
        if (x < r || x >= w - r || z < r || z >= d - r) return -1;
        if (y === h - 1) return style.瓦脊;
        return (x + z) & 1 ? roof : roofDark;
      }
      // 石基
      if (y < baseTop) return style.地基;
      // 角石柱（两侧，隔行错开出砌块感）
      if (x < 2 || x >= w - 2) {
        if (Math.floor(y / 2) % 2 === 0) return style.角石;
      }
      // 檐口/腰线
      if (y === baseTop + 2 || y === bodyTop - 1) return style.檐;

      // 前立面细节
      if (z === d - 1) {
        // 门（底层中间，木门齐平）
        if (y >= baseTop && y < baseTop + 7 && x >= doorX0 && x <= doorX1) return style.门;
        // 窗：前层挖空做凹陷
        for (const wn of wins) if (x >= wn.x0 && x <= wn.x1 && y >= wn.y0 && y <= wn.y1) return -1;
        // 窗框（凹陷四周）
        for (const wn of wins) if (x >= wn.x0 - 1 && x <= wn.x1 + 1 && y >= wn.y0 - 1 && y <= wn.y1 + 1) return style.窗框;
        // 百叶窗（窗两侧各 2 格）
        for (const wn of wins) {
          if (y >= wn.y0 - 1 && y <= wn.y1) {
            if ((x >= wn.x0 - 3 && x <= wn.x0 - 2) || (x >= wn.x1 + 2 && x <= wn.x1 + 3)) return shutter;
          }
        }
      }
      // 凹陷里的亮玻璃 / 门后
      if (z === d - 2) {
        for (const wn of wins) if (x >= wn.x0 && x <= wn.x1 && y >= wn.y0 && y <= wn.y1) {
          return hash2(wn.x0, wn.y0) < 0.72 ? style.窗亮 : style.窗暗;   // 有亮有暗
        }
        if (y >= baseTop && y < baseTop + 7 && x >= doorX0 && x <= doorX1) return style.门;
      }
      // 墙体：轻微色变
      const n = (x * 2 + y * 3 + z) % 9;
      return n === 0 ? style.墙暗 : n === 4 ? shade(wall, 1.05) : wall;
    },
  };
}

/** 鹅卵石/砖地：2 层，顶层随机缺一点做出石缝(AO 会自然变暗) */
export function makeCobble(w = 64, d = 64) {
  const base = 0x4a4038;
  const cobbles = [0x6a5c4a, 0x5f5342, 0x736452, 0x574b3d, 0x6f6150, 0x655643];
  return {
    sx: w, sy: 2, sz: d,
    get(x, y, z) {
      if (y === 0) return base;
      const r = hash2(x, z);
      if (r < 0.10) return -1;
      return cobbles[Math.floor(r * 997) % cobbles.length];
    },
  };
}

function shade(hex, k) {
  const r = Math.min(255, ((hex >> 16) & 255) * k) | 0;
  const g = Math.min(255, ((hex >> 8) & 255) * k) | 0;
  const b = Math.min(255, (hex & 255) * k) | 0;
  return (r << 16) | (g << 8) | b;
}
