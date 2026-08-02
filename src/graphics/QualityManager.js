import { TIERS, 启动画质, GFX } from '../config/graphics.js';

/**
 * 画质管理器：LOW/MED/HIGH 三档。
 * - AUTO：先按 GPU 型号猜一档，再用前两秒实测帧率修正（掉帧就降档）。
 * - 管理 renderer 的 pixelRatio 与阴影总开关。
 * - onChange 回调让各系统（雾、后处理、头灯投影…）按当前档位调整。
 * - setTier() 供设置菜单/快捷键手动切换。
 */
export class QualityManager {
  constructor(renderer, onChange) {
    this.renderer = renderer;
    this.onChange = onChange || (() => {});
    this.tierName = 启动画质 === 'AUTO' ? this.guessTierFromGPU() : 启动画质;
    this.auto = 启动画质 === 'AUTO';

    // 自动测帧率的采样状态
    this._sampleTime = 0;
    this._sampleFrames = 0;
    this._sampled = !this.auto;   // 手动指定画质则不再自动调
    this._settleDelay = 0.6;      // 头 0.6s 不计（加载抖动）
    this._window = 2.0;           // 采样窗口秒数

    this.apply();
  }

  get params() { return TIERS[this.tierName]; }

  guessTierFromGPU() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return 'LOW';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      const s = r.toLowerCase();
      // 触屏设备优先 LOW
      if (('ontouchstart' in window) && navigator.maxTouchPoints > 0 && /adreno|mali|apple gpu|powervr/.test(s)) return 'LOW';
      // 集显关键词 → MED
      if (/intel|uhd|iris|integrated|swiftshader|llvmpipe|mesa/.test(s)) return 'MED';
      // 独显/苹果桌面 → HIGH
      if (/nvidia|geforce|rtx|gtx|radeon|rx |apple m\d|arc /.test(s)) return 'HIGH';
      return 'MED';
    } catch (e) {
      return 'MED';
    }
  }

  /** 每帧调用，负责自动降档 */
  sample(dt) {
    if (this._sampled) return;
    if (this._settleDelay > 0) { this._settleDelay -= dt; return; }
    this._sampleTime += dt;
    this._sampleFrames++;
    if (this._sampleTime >= this._window) {
      const fps = this._sampleFrames / this._sampleTime;
      this._sampled = true;
      if (fps < 28 && this.tierName !== 'LOW') this.setTier(this.tierName === 'HIGH' ? 'MED' : 'LOW');
      else if (fps < 45 && this.tierName === 'HIGH') this.setTier('MED');
      this._autoResult = { fps: Math.round(fps), finalTier: this.tierName };
    }
  }

  setTier(name) {
    if (!TIERS[name] || name === this.tierName) return;
    this.tierName = name;
    this.apply();
    this.onChange(this.params, this.tierName);
  }

  cycleTier() {
    const order = ['LOW', 'MED', 'HIGH'];
    const i = order.indexOf(this.tierName);
    this.setTier(order[(i + 1) % order.length]);
  }

  apply() {
    const p = this.params;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatioMax));
    this.renderer.shadowMap.enabled = !!p.shadows && GFX.阴影 !== false;
  }
}
