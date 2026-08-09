import * as THREE from 'three';
import { greedyMesh } from './greedyMesh.js';

/**
 * 体素武器第一人称模型（细分辨率 VS=0.01，约 1cm 一格）。
 * 每把枪按类型用小方块拼出侧面剖面：枪管/准星/导轨/机匣/弯弹匣/扳机护圈/枪托。
 * 弹匣(mag)与枪机(slide)作为独立部件，供换弹/开火动画单独移动。
 * 坐标：x=右, y=上, z 索引 0=枪口(前) → sz-1=枪托(后)；muzzle 在 z≈0。
 */
const VS = 0.01;

const MET = 0x30343b, MET2 = 0x1e2126, DARK = 0x0e1012, POLY = 0x2c3037,
  WOOD = 0x6a4a2c, WOOD2 = 0x543c22, TAN = 0x7c6242, GRIP = 0x212328,
  SIGHT = 0x121417, GLASS = 0x8fd0e6, RED = 0x6a1a14;

const box = (x, y, z, x0, x1, y0, y1, z0, z1) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
const cyl = (x, y, cx, cy, r) => { const dx = x - cx, dy = y - cy; return dx * dx + dy * dy <= r * r; };
const ring = (x, y, cx, cy, r, r2) => { const dx = x - cx, dy = y - cy, d = dx * dx + dy * dy; return d <= r * r && d >= r2 * r2; };

// 加特林 6 根旋转枪管在中心周围一圈的偏移（半径 2.6）
const GAT_BARRELS = [];
for (let k = 0; k < 6; k++) GAT_BARRELS.push([Math.cos(k * Math.PI / 3) * 2.6, Math.sin(k * Math.PI / 3) * 2.6]);

const BUILDERS = {
  // ============ 步枪 AR-15 ============ sx5 sy22 sz72
  步枪(x, y, z) {
    const cy = 12;
    // 枪口消焰器(略粗)
    if (z <= 3 && ring(x, y, 2, cy, 2.2, 0.8)) return [DARK, 'body'];
    // 枪管
    if (z <= 30 && cyl(x, y, 2, cy, 1.2)) return [MET2, 'body'];
    // 前准星(z5, 高)
    if (box(x, y, z, 1, 3, cy + 1, cy + 6, 4, 5)) return [SIGHT, 'body'];
    if (box(x, y, z, 2, 2, cy + 6, cy + 7, 4, 5)) return [SIGHT, 'body'];
    // 护木(带散热孔)
    if (z >= 7 && z <= 30 && ring(x, y, 2, cy, 3.4, 2.2)) { if ((z % 4) < 2 && (Math.abs(x - 2) > 1 || y > cy)) return [POLY, 'body']; return [POLY, 'body']; }
    if (z >= 7 && z <= 30 && cyl(x, y, 2, cy, 3.4)) { if ((z % 5) === 0 && y < cy && Math.abs(x - 2) <= 1) return [-1, null]; }
    // 上机匣
    if (box(x, y, z, 0, 4, cy - 4, cy + 3, 30, 52)) return [MET, 'body'];
    // 顶部导轨(带齿)
    if (box(x, y, z, 1, 3, cy + 3, cy + 4, 30, 54)) return [(z % 2) ? SIGHT : MET2, 'body'];
    // 后准星(z50)
    if (box(x, y, z, 1, 3, cy + 4, cy + 6, 49, 51)) return [SIGHT, 'body'];
    // 抛壳口(右侧凹)
    if (box(x, y, z, 4, 4, cy, cy + 2, 34, 40)) return [DARK, 'body'];
    // 拉机柄(枪机, 后上, 可动)
    if (box(x, y, z, 0, 4, cy + 3, cy + 4, 50, 53)) return [MET2, 'slide'];
    // 弹匣井 + 弯弹匣(下, 可动)
    if (box(x, y, z, 1, 3, cy - 12, cy - 4, 36, 46)) {
      const curve = Math.floor((cy - 4 - y) * 0.5);   // 越往下越往前弯
      if (z >= 36 - curve && z <= 45 - curve) return [MET2, 'mag'];
    }
    // 扳机护圈
    if (ring(z, y, 49, cy - 5, 3, 2) && x >= 1 && x <= 3) return [MET, 'body'];
    // 握把(下, 后斜)
    if (box(x, y, z, 1, 3, cy - 11, cy - 4, 52, 58)) { if ((z - 52) + (cy - 4 - y) < 8) return [GRIP, 'body']; }
    // 枪托
    if (box(x, y, z, 1, 3, cy - 3, cy + 3, 54, 71)) return [POLY, 'body'];
    if (box(x, y, z, 1, 3, cy - 4, cy + 4, 66, 71)) return [POLY, 'body'];   // 托底
    if (box(x, y, z, 1, 3, cy - 2, cy + 1, 56, 66)) return [-1, null];        // 托内镂空
    return null;
  },

  // ============ 手枪 P-9 ============ sx5 sy16 sz26
  手枪(x, y, z) {
    const cy = 9;
    // 套筒(上, 可动)
    if (box(x, y, z, 0, 4, cy, cy + 5, 1, 22)) return [(z < 3 ? MET2 : MET), 'slide'];
    if (box(x, y, z, 1, 3, cy + 5, cy + 5, 3, 6)) return [SIGHT, 'slide'];    // 准星
    if (box(x, y, z, 1, 3, cy + 5, cy + 5, 19, 21)) return [SIGHT, 'slide'];  // 照门
    if (z === 1 && cyl(x, y, 2, cy + 2, 1.4)) return [DARK, 'slide'];         // 枪口
    // 机匣
    if (box(x, y, z, 0, 4, cy - 1, cy, 8, 22)) return [POLY, 'body'];
    // 扳机护圈
    if (ring(z, y, 16, cy - 3, 3, 2) && x >= 1 && x <= 3) return [POLY, 'body'];
    // 握把(后斜)
    if (box(x, y, z, 0, 4, cy - 8, cy, 15, 24) && ((z - 15) * 0.7 + (cy - y) < 12)) return [GRIP, 'body'];
    // 弹匣(握把里, 可动)
    if (box(x, y, z, 1, 3, cy - 8, cy - 1, 16, 22)) return [MET2, 'mag'];
    if (box(x, y, z, 1, 3, cy - 9, cy - 8, 16, 23)) return [DARK, 'mag'];     // 底垫
    return null;
  },

  // ============ 霰弹枪 M-870 ============ sx5 sy18 sz60
  霰弹枪(x, y, z) {
    const cy = 11;
    if (z <= 34 && cyl(x, y, 2, cy + 2, 1.6)) return [MET2, 'body'];          // 枪管
    if (z <= 30 && cyl(x, y, 2, cy - 1, 1.4)) return [MET, 'body'];           // 下弹仓管
    if (box(x, y, z, 1, 3, cy + 4, cy + 5, 4, 6)) return [SIGHT, 'body'];     // 前豆准星
    // 泵(前握, 木, 可前后)
    if (z >= 10 && z <= 20 && ring(x, y, 2, cy - 1, 2.6, 1.3)) return [(z % 3) ? WOOD : WOOD2, 'slide'];
    // 机匣
    if (box(x, y, z, 0, 4, cy - 3, cy + 4, 32, 44)) return [MET, 'body'];
    // 扳机护圈
    if (ring(z, y, 42, cy - 5, 3, 2) && x >= 1 && x <= 3) return [MET, 'body'];
    // 握把+枪托(木)
    if (box(x, y, z, 0, 4, cy - 8, cy - 3, 40, 48) && ((z - 40) * 0.6 + (cy - 3 - y) < 9)) return [WOOD2, 'body'];
    if (box(x, y, z, 1, 3, cy - 4, cy + 3, 44, 59)) return [(z % 5 < 3) ? WOOD : WOOD2, 'body'];  // 托
    return null;
  },

  // ============ 火箭筒 RPG ============ sx7 sy16 sz64
  火箭筒(x, y, z) {
    const cy = 8;
    // 战斗部(前锥)
    if (z <= 12 && cyl(x, y, 3, cy, 4.2 - z * 0.22)) return [RED, 'body'];
    // 主发射管
    if (cyl(x, y, 3, cy, 3.2)) {
      if (z > 12 && z < 16) return [MET2, 'body'];
      if (z > 50 && z < 58) return [DARK, 'body'];      // 后喷口加厚
      return [(z & 3) === 0 ? MET2 : MET, 'body'];
    }
    // 木质护握(中)
    if (box(x, y, z, 1, 5, cy - 5, cy - 3, 26, 40)) return [WOOD, 'body'];
    // 握把+扳机
    if (box(x, y, z, 3, 4, cy - 8, cy - 5, 32, 36)) return [GRIP, 'body'];
    if (ring(z, y, 35, cy - 6, 3, 2) && x >= 3 && x <= 4) return [MET, 'body'];
    // 瞄准具(上)
    if (box(x, y, z, 3, 4, cy + 4, cy + 8, 22, 24)) return [SIGHT, 'body'];
    if (box(x, y, z, 3, 4, cy + 7, cy + 8, 20, 26)) return [SIGHT, 'body'];
    return null;
  },

  // ============ 狙击枪 AWP ============ sx5 sy24 sz84
  狙击枪(x, y, z) {
    const cy = 11;
    if (z <= 40 && cyl(x, y, 2, cy, 1.3)) return [MET2, 'body'];              // 长枪管
    if (z >= 2 && z <= 6 && cyl(x, y, 2, cy, 1.8)) return [MET, 'body'];      // 枪口制退
    // 机匣
    if (box(x, y, z, 0, 4, cy - 4, cy + 3, 36, 58)) return [POLY, 'body'];
    // 瞄准镜(上, 长圆柱) + 前后镜片 + 镜座
    if (z >= 30 && z <= 60 && cyl(x, y, 2, cy + 8, 3)) {
      if (z === 30 || z === 60) return [GLASS, 'body'];
      if (z >= 40 && z <= 46) return [SIGHT, 'body'];    // 调焦鼓包
      return [MET2, 'body'];
    }
    if (box(x, y, z, 1, 3, cy + 3, cy + 5, 34, 36)) return [SIGHT, 'body'];   // 前镜座
    if (box(x, y, z, 1, 3, cy + 3, cy + 5, 54, 56)) return [SIGHT, 'body'];   // 后镜座
    // 栓(枪机把手, 右侧, 可动)
    if (box(x, y, z, 4, 4, cy, cy + 1, 56, 58)) return [MET, 'slide'];
    if (box(x, y, z, 4, 5, cy, cy + 1, 57, 58)) return [MET, 'slide'];        // 栓头球
    // 弹匣
    if (box(x, y, z, 1, 3, cy - 9, cy - 4, 46, 52)) return [MET2, 'mag'];
    // 扳机护圈
    if (ring(z, y, 58, cy - 6, 3, 2) && x >= 1 && x <= 3) return [MET, 'body'];
    // 握把+托(带拇指孔)
    if (box(x, y, z, 0, 4, cy - 10, cy - 4, 56, 62) && ((z - 56) + (cy - 4 - y) < 9)) return [TAN, 'body'];
    if (box(x, y, z, 0, 4, cy - 6, cy + 4, 60, 83)) return [TAN, 'body'];     // 托身
    if (box(x, y, z, 1, 3, cy - 3, cy + 2, 64, 74)) return [-1, null];        // 拇指孔
    if (box(x, y, z, 0, 4, cy + 4, cy + 6, 74, 80)) return [TAN, 'body'];     // 腮托
    return null;
  },

  // ============ 加特林 M134 ============ sx9 sy20 sz76（6 管旋转机枪）
  加特林(x, y, z) {
    const cx = 4, cy = 10;
    // 6 根旋转枪管（前段）+ 中心转轴
    if (z <= 41) {
      for (let k = 0; k < 6; k++) {
        if (cyl(x, y, cx + GAT_BARRELS[k][0], cy + GAT_BARRELS[k][1], 1.0))
          return [(k % 2) ? MET2 : MET, 'body'];
      }
      if (cyl(x, y, cx, cy, 0.9)) return [DARK, 'body'];        // 中心转轴
    }
    // 枪管前端固定盘（把 6 管箍在一起）
    if (z >= 4 && z <= 8 && ring(x, y, cx, cy, 3.9, 3.5)) return [DARK, 'body'];
    // 转子外壳前盘
    if (z >= 42 && z <= 47 && cyl(x, y, cx, cy, 4.0)) return [(z % 2) ? MET2 : MET, 'body'];
    // 主机匣（粗圆柱）
    if (z >= 47 && z <= 66 && cyl(x, y, cx, cy, 3.8)) {
      if (z >= 49 && z <= 51) return [DARK, 'body'];            // 一圈凹槽
      return [((z & 3) === 0) ? MET2 : MET, 'body'];
    }
    // 顶部馈弹盖/瞄准条
    if (box(x, y, z, cx - 1, cx + 1, cy + 4, cy + 5, 44, 66)) return [SIGHT, 'body'];
    // 左侧弹箱（弹链从这里进；换弹时整箱掉换，作 mag 部件）
    if (box(x, y, z, cx - 7, cx - 4, cy - 6, cy + 2, 50, 66)) return [TAN, 'body'];
    if (box(x, y, z, cx - 7, cx - 4, cy - 7, cy - 6, 50, 66)) return [DARK, 'body'];   // 箱底
    // 弹链（从弹箱到机匣的一小段，黄铜感用 WOOD 近似）
    if (box(x, y, z, cx - 4, cx - 2, cy - 3, cy - 1, 56, 60)) return [WOOD, 'mag'];
    if (box(x, y, z, cx - 6, cx - 4, cy - 5, cy + 1, 52, 64)) return [MET2, 'mag'];     // 可动供弹机
    // 尾部背板
    if (box(x, y, z, cx - 4, cx + 4, cy - 3, cy + 3, 66, 70)) return [POLY, 'body'];
    // 双匙形握把（后方两侧手柄）
    if (box(x, y, z, cx - 5, cx - 3, cy - 5, cy - 2, 68, 75)) return [GRIP, 'body'];
    if (box(x, y, z, cx + 3, cx + 5, cy - 5, cy - 2, 68, 75)) return [GRIP, 'body'];
    if (box(x, y, z, cx - 5, cx + 5, cy - 3, cy - 2, 72, 74)) return [MET2, 'body'];    // 两握把间横梁
    return null;
  },
};

const DIMS = {
  步枪: [5, 22, 72], 手枪: [5, 16, 26], 霰弹枪: [5, 18, 60], 火箭筒: [7, 16, 64], 狙击枪: [5, 24, 84], 加特林: [9, 20, 76],
};
const MUZ_Y = { 步枪: 12, 手枪: 11, 霰弹枪: 13, 火箭筒: 8, 狙击枪: 11, 加特林: 10 };

export function makeWeaponMesh(type) {
  const b = BUILDERS[type] || BUILDERS.步枪;
  const [sx, sy, sz] = DIMS[type] || DIMS.步枪;
  const origin = new THREE.Vector3(-sx * VS / 2, -sy * VS * 0.5, -sz * VS);
  const vol = (want) => ({ sx, sy, sz, get: (x, y, z) => { const r = b(x, y, z); return r && r[0] >= 0 && r[1] === want ? r[0] : -1; } });
  const g = (want) => greedyMesh(vol(want), VS, origin).geometry;
  return {
    body: g('body'), mag: g('mag'), slide: g('slide'),
    muzzle: new THREE.Vector3(0, (MUZ_Y[type] || 12) * VS + origin.y, origin.z + 1.5 * VS),
    sz, VS,
  };
}
