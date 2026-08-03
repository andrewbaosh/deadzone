/**
 * 程序化体素模型（配合 greedyMesh 使用）。
 * 每个模型返回 { sx, sy, sz, get(x,y,z) }，get 返回 0xRRGGBB 颜色或 -1(空)。
 * 面朝 +z（放置时让 +z 对着玩家）。
 */

// 简单确定性 hash（避免 Math.random，保证每次一样）
function hash2(x, z) {
  let h = (x * 374761393 + z * 668265263) & 0x7fffffff;
  h = (h ^ (h >> 13)) * 1274126177 & 0x7fffffff;
  return (h & 0xffff) / 0xffff;
}

/** 一栋带凹陷暖窗、屋檐、墙面色变化的联排小楼 */
export function makeTownhouse() {
  const w = 22, h = 46, d = 18;
  const C = {
    plaster: 0xc9b89a, plaster2: 0xc0ad8c, plaster3: 0xd2c2a4,
    base: 0x6f6150, win: 0xffd39a, winDim: 0x8a6a3a, frame: 0x5a4939,
    trim: 0xb2a184, roof: 0x8a3b2e, roof2: 0x7a3428, door: 0x4a3526,
  };
  // 窗户格子（x 两列、y 三层）
  const cols = [[4, 9], [13, 18]];
  const floors = [[9, 16], [21, 28], [33, 40]];
  const wins = [];
  for (const [x0, x1] of cols) for (const [y0, y1] of floors) wins.push({ x0, x1, y0, y1 });
  const inWin = (x, y) => wins.find((wn) => x >= wn.x0 && x <= wn.x1 && y >= wn.y0 && y <= wn.y1);
  const inFrame = (x, y) => wins.some((wn) => x >= wn.x0 - 1 && x <= wn.x1 + 1 && y >= wn.y0 - 1 && y <= wn.y1 + 1);

  return {
    sx: w, sy: h, sz: d,
    get(x, y, z) {
      // 屋顶：顶部若干层往里收，做出坡屋顶剪影
      const roofBase = h - 6;
      if (y >= roofBase) {
        const r = y - roofBase;
        if (x < r || x >= w - r || z < r || z >= d - r) return -1;   // 收边=空
        return (x + z) & 1 ? C.roof : C.roof2;
      }
      // 地基
      if (y < 4) return C.base;
      // 大门（底层中间，前面）
      if (z === d - 1 && y >= 4 && y < 9 && x >= 9 && x <= 13) return C.door;
      // 檐口/腰线
      if (y === 7 || y === 19 || y === 31 || y === 42) return C.trim;
      // 前立面窗户（凹陷1层：前层挖空，后一层放亮玻璃，四周框）
      if (z === d - 1) {
        if (inWin(x, y)) return -1;
        if (inFrame(x, y)) return C.frame;
      }
      if (z === d - 2 && inWin(x, y)) {
        // 有的窗亮有的暗，更自然
        return hash2(Math.floor(x / 3), Math.floor(y / 4)) < 0.7 ? C.win : C.winDim;
      }
      // 墙体：轻微色变，别死板
      const n = (x * 2 + y * 3 + z) % 7;
      return n === 0 ? C.plaster2 : n === 3 ? C.plaster3 : C.plaster;
    },
  };
}

/** 一块鹅卵石/砖地：2 层，顶层随机缺一点做出石缝(AO 会自然变暗) */
export function makeCobble(w = 64, d = 64) {
  const base = 0x4a4038;
  const cobbles = [0x6a5c4a, 0x5f5342, 0x736452, 0x574b3d, 0x6f6150];
  return {
    sx: w, sy: 2, sz: d,
    get(x, y, z) {
      if (y === 0) return base;
      const r = hash2(x, z);
      if (r < 0.10) return -1;                 // 石缝（缺一块→下陷→缝隙 AO）
      return cobbles[Math.floor(r * 997) % cobbles.length];
    },
  };
}
