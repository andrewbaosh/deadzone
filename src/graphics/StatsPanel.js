import Stats from 'stats.js';
import { GFX } from '../config/graphics.js';

/**
 * 性能面板：stats.js 的 FPS/MS 面板 + 一行自绘的 DrawCall/档位/丧尸数。
 * 用法：begin() 在每帧渲染前，end(renderer, extra) 在渲染后。
 */
export class StatsPanel {
  constructor() {
    this.enabled = !!GFX.显示性能面板;
    if (!this.enabled) return;

    this.stats = new Stats();
    this.stats.showPanel(0); // FPS
    const dom = this.stats.dom;
    dom.style.cssText = 'position:fixed;top:6px;left:6px;z-index:1000;opacity:0.85;';
    document.body.appendChild(dom);

    // 额外信息行（draw call / 档位）
    this.info = document.createElement('div');
    this.info.style.cssText =
      'position:fixed;top:54px;left:6px;z-index:1000;font:11px/1.4 monospace;' +
      'color:#8fefc0;background:rgba(0,0,0,.55);padding:3px 6px;border-radius:3px;white-space:pre;pointer-events:none;';
    document.body.appendChild(this.info);

    this._t = 0;
    this._last = { calls: 0, tris: 0, tier: '', enemies: 0 };
  }

  begin() { if (this.enabled) this.stats.begin(); }

  end(renderer, extra = {}) {
    if (!this.enabled) return;
    this.stats.end();
    // 每 0.25s 刷新一次文字，避免频繁 DOM 写入
    this._t += 1;
    if (this._t % 15 === 0 && renderer) {
      const info = renderer.info.render;
      this.info.textContent =
        `draw ${info.calls}  tri ${(info.triangles / 1000).toFixed(1)}k\n` +
        `tier ${extra.tier || '?'}  zombies ${extra.enemies ?? 0}`;
    }
  }

  toggle() {
    if (!this.enabled) return;
    const vis = this.stats.dom.style.display !== 'none';
    this.stats.dom.style.display = vis ? 'none' : '';
    this.info.style.display = vis ? 'none' : '';
  }
}
