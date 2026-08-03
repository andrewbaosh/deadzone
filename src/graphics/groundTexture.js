import * as THREE from 'three';

/**
 * 程序化鹅卵石地面贴图：颜色(albedo) + 法线(normal)。
 * 画抖动的石块 + 深色勾缝，法线从高度场求，头灯/月光扫过有真实凹凸。
 */
export function makeCobbleTextures(size = 512, cells = 11) {
  // --- 高度场 canvas（石块亮=高、缝隙暗=低）---
  const hc = document.createElement('canvas'); hc.width = hc.height = size;
  const hx = hc.getContext('2d');
  hx.fillStyle = '#000'; hx.fillRect(0, 0, size, size);

  // --- 颜色 canvas ---
  const ac = document.createElement('canvas'); ac.width = ac.height = size;
  const ax = ac.getContext('2d');
  ax.fillStyle = '#2c2620'; ax.fillRect(0, 0, size, size);   // 勾缝暗色

  const stone = ['#8a7a62', '#7d6e58', '#948468', '#6f6252', '#877757', '#9a8a6c'];
  const cell = size / cells;
  const rnd = mulberry(1234);
  for (let j = -1; j < cells + 1; j++) {
    for (let i = -1; i < cells + 1; i++) {
      const jitterX = (rnd() - 0.5) * cell * 0.4;
      const jitterY = (rnd() - 0.5) * cell * 0.4;
      const cx = (i + 0.5) * cell + jitterX;
      const cy = (j + 0.5) * cell + jitterY + (i % 2) * cell * 0.15;
      const rw = cell * (0.34 + rnd() * 0.12);
      const rh = cell * (0.30 + rnd() * 0.12);
      // 颜色石块
      ax.fillStyle = stone[(rnd() * stone.length) | 0];
      roundRect(ax, cx - rw, cy - rh, rw * 2, rh * 2, cell * 0.18); ax.fill();
      // 高度（中间亮、边缘略暗做圆润）
      const g = hx.createRadialGradient(cx, cy, 1, cx, cy, rw);
      g.addColorStop(0, '#dcdcdc'); g.addColorStop(0.7, '#aaa'); g.addColorStop(1, '#333');
      hx.fillStyle = g;
      roundRect(hx, cx - rw, cy - rh, rw * 2, rh * 2, cell * 0.18); hx.fill();
    }
  }

  const map = new THREE.CanvasTexture(ac);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const normalMap = heightToNormal(hx.getImageData(0, 0, size, size), size, 2.2);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  return { map, normalMap };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function heightToNormal(img, size, strength) {
  const d = img.data;
  const H = (x, y) => d[((((y + size) % size) * size + ((x + size) % size)) * 4)] / 255;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const nx = -dx, ny = -dy, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      out[i] = (nx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(out, size, size, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

// 小型可复现随机
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
