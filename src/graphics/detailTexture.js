import * as THREE from 'three';

/**
 * 阶段8（轻量版）：代码生成的地面法线细节贴图。
 * 不下载任何素材、不加面数、不加 draw call —— 只给地面一点微表面起伏，
 * 让头灯/月光扫过时有粗糙水泥质感。层叠 value noise → 高度场 → 法线。
 */
function valueNoise(size, cells) {
  // 生成 cells×cells 的随机点，双线性插值到 size×size
  const grid = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
  const h = new Float32Array(size * size);
  const step = size / cells;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x / step, gy = y / step;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = gx - x0, fy = gy - y0;
      const g = (ix, iy) => grid[iy * (cells + 1) + ix];
      const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      h[y * size + x] = a + (b - a) * sx + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return h;
}

export function makeDetailNormal(size = 256) {
  // 多倍频叠加成高度场
  const height = new Float32Array(size * size);
  let amp = 1, sum = 0;
  for (const cells of [8, 16, 32, 64]) {
    const n = valueNoise(size, cells);
    for (let i = 0; i < height.length; i++) height[i] += n[i] * amp;
    sum += amp; amp *= 0.5;
  }
  for (let i = 0; i < height.length; i++) height[i] /= sum;

  // 高度场 -> 法线（Sobel），写入 RGB
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  const strength = 2.0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const nx = -dx, ny = -dy, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * size + x) * 4;
      data[i] = (nx * inv * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
