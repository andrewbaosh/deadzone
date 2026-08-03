import * as THREE from 'three';

/**
 * 贪婪网格合并器（greedy meshing）—— 体素细腻化的核心工具，一劳永逸。
 * 输入一个体素体（每格一个颜色或空），输出一个合并后的 BufferGeometry：
 *   - 只生成看得见的外表面（内部面剔除）
 *   - 相邻同色的共面面合并成大四边形（大幅减少三角形/顶点）
 *   - 顶点色（一个材质搞定所有颜色），扁平法线（体素硬边感）
 *
 * vol 接口：{ sx, sy, sz, get(x,y,z) -> 颜色0xRRGGBB | -1(空) }
 * 返回可直接配 MeshStandardMaterial({ vertexColors:true }) 的几何体。
 */
export function greedyMesh(vol, voxelSize = 0.2, origin = new THREE.Vector3()) {
  const dims = [vol.sx, vol.sy, vol.sz];
  const inb = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < dims[0] && y < dims[1] && z < dims[2];
  const get = (x, y, z) => (inb(x, y, z) ? vol.get(x, y, z) : -1);

  const positions = [], normals = [], colors = [], indices = [];
  let vi = 0;

  const colCache = new Map();
  const colOf = (c) => {
    let e = colCache.get(c);
    if (!e) { const col = new THREE.Color().setHex(c, THREE.SRGBColorSpace); e = [col.r, col.g, col.b]; colCache.set(c, e); }
    return e;
  };

  function emit(p, du, dv, d, dir, color) {
    const P = (a) => [a[0] * voxelSize + origin.x, a[1] * voxelSize + origin.y, a[2] * voxelSize + origin.z];
    const c0 = P(p);
    const c1 = P([p[0] + du[0], p[1] + du[1], p[2] + du[2]]);
    const c2 = P([p[0] + du[0] + dv[0], p[1] + du[1] + dv[1], p[2] + du[2] + dv[2]]);
    const c3 = P([p[0] + dv[0], p[1] + dv[1], p[2] + dv[2]]);
    const nrm = [0, 0, 0]; nrm[d] = dir;
    const [r, g, b] = colOf(color);
    const quad = dir > 0 ? [c0, c1, c2, c3] : [c0, c3, c2, c1];  // 保证外朝向正确的绕序
    for (const q of quad) { positions.push(q[0], q[1], q[2]); normals.push(nrm[0], nrm[1], nrm[2]); colors.push(r, g, b); }
    indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    vi += 4;
  }

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const X = [0, 0, 0];
    const mw = dims[u], mh = dims[v];
    const mask = new Int32Array(mw * mh);

    for (X[d] = -1; X[d] < dims[d];) {
      // 构建这一层的面掩码：mask 存 有符号的(颜色+1)，0=无面，正=+d朝向，负=-d朝向
      let n = 0;
      for (X[v] = 0; X[v] < dims[v]; X[v]++) {
        for (X[u] = 0; X[u] < dims[u]; X[u]++, n++) {
          const a = X[d] >= 0 ? get(X[0], X[1], X[2]) : -1;
          const B = [X[0], X[1], X[2]]; B[d] += 1;
          const b = X[d] < dims[d] - 1 ? get(B[0], B[1], B[2]) : -1;
          const aS = a >= 0, bS = b >= 0;
          if (aS === bS) mask[n] = 0;
          else if (aS) mask[n] = a + 1;
          else mask[n] = -(b + 1);
        }
      }
      X[d]++;

      // 贪婪合并
      n = 0;
      for (let j = 0; j < mh; j++) {
        for (let i = 0; i < mw;) {
          const c = mask[n];
          if (c !== 0) {
            let w = 1;
            while (i + w < mw && mask[n + w] === c) w++;
            let h = 1, stop = false;
            while (j + h < mh) {
              for (let k = 0; k < w; k++) { if (mask[n + k + h * mw] !== c) { stop = true; break; } }
              if (stop) break;
              h++;
            }
            const dir = c > 0 ? 1 : -1;
            const color = Math.abs(c) - 1;
            const p = [0, 0, 0]; p[d] = X[d]; p[u] = i; p[v] = j;
            const du = [0, 0, 0]; du[u] = w;
            const dv = [0, 0, 0]; dv[v] = h;
            emit(p, du, dv, d, dir, color);
            for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[n + k + l * mw] = 0;
            i += w; n += w;
          } else { i++; n++; }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return { geometry: geo, quads: vi / 4, tris: indices.length / 3 };
}
