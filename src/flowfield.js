import * as THREE from 'three';

/**
 * 流场寻路（flow field）：每帧从玩家格做一次 BFS 铺开距离场，
 * 所有僵尸顺着"往玩家方向的下坡"走 —— 自动绕开建筑找通路。
 * 几百只僵尸也只算一次 BFS，极省。只管大障碍(建筑/墙/摊位/箱堆)，
 * 小物件(酒桶/花坛)交给僵尸本地滑动，中央平台/台阶区放行(交给踩台阶逻辑)。
 */
export class FlowField {
  constructor(colliders, size, cell = 1.6) {
    this.S = size;
    this.cell = cell;
    this.cols = Math.ceil((2 * size) / cell);
    const n = this.cols * this.cols;
    this.blocked = new Uint8Array(n);
    this.dist = new Int32Array(n);
    this.queue = new Int32Array(n);

    for (const c of colliders) {
      if (c.max.y <= 1.0) continue;                         // 矮的(台阶/花坛)不算障碍
      const w = c.max.x - c.min.x, d = c.max.z - c.min.z;
      if (w < 3 && d < 3) continue;                         // 小物件(酒桶等)不进流场
      const cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2;
      // 中央区：封"大平台"(僵尸绕行)，但放行台阶等小碰撞(僵尸从这里爬上去)
      if (Math.abs(cx) < 9 && Math.abs(cz) < 9 && w < 10 && d < 10) continue;
      const x0 = this.gx(c.min.x - 0.7), x1 = this.gx(c.max.x + 0.7);   // 膨胀 0.7m 防贴角
      const z0 = this.gz(c.min.z - 0.7), z1 = this.gz(c.max.z + 0.7);
      for (let zz = z0; zz <= z1; zz++)
        for (let xx = x0; xx <= x1; xx++)
          if (this.inb(xx, zz)) this.blocked[zz * this.cols + xx] = 1;
    }
    this._ready = false;
  }

  openBox(wx0, wx1, wz0, wz1) {
    const x0 = this.gx(wx0), x1 = this.gx(wx1), z0 = this.gz(wz0), z1 = this.gz(wz1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (this.inb(x, z)) this.blocked[z * this.cols + x] = 0;
  }

  gx(x) { return Math.floor((x + this.S) / this.cell); }
  gz(z) { return Math.floor((z + this.S) / this.cell); }
  inb(x, z) { return x >= 0 && z >= 0 && x < this.cols && z < this.cols; }

  /** 每帧从玩家位置铺开距离场 */
  compute(px, pz) {
    this.dist.fill(-1);
    let pcx = Math.max(0, Math.min(this.cols - 1, this.gx(px)));
    let pcz = Math.max(0, Math.min(this.cols - 1, this.gz(pz)));
    let start = pcz * this.cols + pcx;
    if (this.blocked[start]) {                    // 玩家格恰好在障碍里→找最近可走格
      start = this.nearestFree(pcx, pcz);
      if (start < 0) { this._ready = false; return; }
    }
    const q = this.queue;
    let head = 0, tail = 0;
    this.dist[start] = 0; q[tail++] = start;
    while (head < tail) {
      const cur = q[head++];
      const cd = this.dist[cur];
      const cx = cur % this.cols, cz = (cur / this.cols) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const nz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!this.inb(nx, nz)) continue;
        const ni = nz * this.cols + nx;
        if (this.blocked[ni] || this.dist[ni] >= 0) continue;
        this.dist[ni] = cd + 1; q[tail++] = ni;
      }
    }
    this._ready = true;
  }

  nearestFree(cx, cz) {
    for (let r = 1; r < 6; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, z = cz + dz;
        if (this.inb(x, z) && !this.blocked[z * this.cols + x]) return z * this.cols + x;
      }
    }
    return -1;
  }

  /** 取世界坐标处朝玩家的流向（写入 out）。返回 false=无解(调用方退回直冲) */
  dir(x, z, out) {
    if (!this._ready) return false;
    const cx = this.gx(x), cz = this.gz(z);
    if (!this.inb(cx, cz)) return false;
    const here = this.dist[cz * this.cols + cx];
    // 自己格子被挡(here<0)时 best=∞，会朝"能走且最靠近玩家"的邻格挪，从而脱离障碍回到通路
    let best = here >= 0 ? here : Infinity, bx = 0, bz = 0, found = false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const nx = cx + dx, nz = cz + dz;
      if (!this.inb(nx, nz)) continue;
      const nd = this.dist[nz * this.cols + nx];
      if (nd >= 0 && nd < best) { best = nd; bx = dx; bz = dz; found = true; }
    }
    if (!found) return false;
    out.set(bx, 0, bz).normalize();
    return true;
  }
}
