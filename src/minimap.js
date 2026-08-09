import { GFX } from './config/graphics.js';

/**
 * 小地图：右上角 canvas，俯视显示场地/掩体/玩家(带朝向)/僵尸/掉落/撤离点。
 * 每帧只画少量点，开销极小。
 */
export class Minimap {
  constructor(level) {
    this.enabled = GFX.小地图 !== false;
    this.level = level;
    this.S = level.size;
    if (!this.enabled) return;

    const size = 168;
    this.size = size;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.style.cssText =
      'position:fixed;top:12px;right:12px;z-index:20;border-radius:50%;' +
      'border:2px solid rgba(180,200,230,.35);box-shadow:0 4px 16px rgba(0,0,0,.5);' +
      'background:rgba(14,18,28,.72);pointer-events:none;';
    document.body.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d');

    // 预烘掩体轮廓（静态，不每帧重画）
    this.staticCanvas = document.createElement('canvas');
    this.staticCanvas.width = this.staticCanvas.height = size;
    this.bakeStatic();
  }

  /** 切换关卡（沙漠/小镇）：重烘掩体轮廓 */
  setLevel(level) {
    this.level = level;
    this.S = level.size;
    if (this.staticCanvas) this.bakeStatic();
  }

  w2m(x, z) {
    const k = this.size / (this.S * 2);
    return [this.size / 2 + x * k, this.size / 2 + z * k];
  }

  bakeStatic() {
    const g = this.staticCanvas.getContext('2d');
    g.clearRect(0, 0, this.size, this.size);
    g.fillStyle = 'rgba(150,150,170,.5)';
    for (const c of this.level.colliders) {
      if (c.max.y <= 1.0) continue;
      const [x0, z0] = this.w2m(c.min.x, c.min.z);
      const [x1, z1] = this.w2m(c.max.x, c.max.z);
      g.fillRect(x0, z0, Math.max(1, x1 - x0), Math.max(1, z1 - z0));
    }
  }

  update(player, enemies, pickupsActive, extraction) {
    if (!this.enabled) return;
    const ctx = this.ctx, S = this.size;
    ctx.clearRect(0, 0, S, S);

    // 圆形裁剪
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.drawImage(this.staticCanvas, 0, 0);

    // 撤离点
    if (extraction && extraction.active) {
      const [ex, ez] = this.w2m(extraction.position.x, extraction.position.z);
      ctx.fillStyle = '#33ffcc';
      ctx.beginPath(); ctx.arc(ex, ez, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // 掉落物
    if (pickupsActive) {
      for (const p of pickupsActive) {
        const [x, z] = this.w2m(p.mesh.position.x, p.mesh.position.z);
        ctx.fillStyle = p.kind === 'health' ? '#ff5a5a' : '#ffd24a';
        ctx.fillRect(x - 1.5, z - 1.5, 3, 3);
      }
    }
    // 僵尸（红点）
    ctx.fillStyle = '#ff3b30';
    for (const e of enemies) {
      if (e.dead) continue;
      const [x, z] = this.w2m(e.root.position.x, e.root.position.z);
      ctx.beginPath(); ctx.arc(x, z, 2, 0, Math.PI * 2); ctx.fill();
    }
    // 玩家（带朝向的三角）。前方=(-sin yaw,-cos yaw)，三角基朝上(-y)对应 yaw=0
    const [px, pz] = this.w2m(player.pos.x, player.pos.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-player.yaw);
    ctx.fillStyle = '#8fefc0';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  setVisible(on) {
    this.enabled = on && this.canvas != null;
    if (this.canvas) this.canvas.style.display = on ? '' : 'none';
  }
}
