import { HalfFloatType, Vector2, NoToneMapping, ACESFilmicToneMapping } from 'three';
import {
  EffectComposer, RenderPass, EffectPass,
  BloomEffect, VignetteEffect, SMAAEffect, SMAAPreset,
  ChromaticAberrationEffect, NoiseEffect, ToneMappingEffect, ToneMappingMode,
  BlendFunction, KernelSize,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { GFX } from '../config/graphics.js';

/**
 * 阶段2：后处理氛围。
 * MED：Bloom + Vignette + SMAA。
 * HIGH：追加 极弱色散 + 弱胶片颗粒 + N8AO(半分辨率，小半径)。
 * 关键：用了 composer 后，色调映射(ACES)必须移到链末的 ToneMappingEffect，
 *      因此启用后处理时把 renderer.toneMapping 设为 NoToneMapping，关闭时再还原。
 * LOW / 关闭后处理：直接 renderer.render，不走 composer。
 */
export class PostFX {
  constructor(renderer, scene, camera, tierParams) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = false;
    this.composer = null;
    this.tier = tierParams;
    this.available = true;
    try {
      this.build(tierParams);
    } catch (e) {
      // 后处理构建失败也绝不能让游戏崩：降级为直接渲染
      console.warn('PostFX 构建失败，回退到直接渲染:', e);
      this.available = false;
    }
  }

  build(tier) {
    const w = window.innerWidth, h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // N8AO（仅 HIGH，半分辨率保性能）
    if (tier.ao && GFX.环境光遮蔽) {
      const ao = new N8AOPostPass(this.scene, this.camera, w, h);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = 2.2;
      ao.configuration.halfRes = true;         // 降采样，控制在预算内
      if (ao.setQualityMode) ao.setQualityMode('Low');
      this.composer.addPass(ao);
      this.ao = ao;
    }

    // 主效果链
    const effects = [];
    if (GFX.泛光 && tier.bloom) {
      effects.push(new BloomEffect({
        intensity: 0.75,
        luminanceThreshold: 0.55,   // 只让较亮的东西发光（红眼/枪口/爆炸）
        luminanceSmoothing: 0.3,
        mipmapBlur: true,
        kernelSize: KernelSize.MEDIUM,
      }));
    }
    if (GFX.色散 && tier.ao) {   // tier.ao 仅 HIGH 为 true，借用作 HIGH 判断
      effects.push(new ChromaticAberrationEffect({ offset: new Vector2(0.0006, 0.0006), radialModulation: true, modulationOffset: 0.3 }));
    }
    if (GFX.胶片颗粒 && tier.ao) {
      const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
      noise.blendMode.opacity.value = 0.08;    // 弱
      effects.push(noise);
    }
    if (GFX.暗角) {
      effects.push(new VignetteEffect({ darkness: 0.55, offset: 0.32 }));
    }
    // 色调映射放最后（HDR -> LDR）
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
    this.composer.addPass(new EffectPass(this.camera, ...effects));

    // SMAA 单独一遍放最末
    if (GFX.抗锯齿SMAA) {
      this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
    }
  }

  /** 档位变化时重建效果链，保证 HIGH 才有 AO/色散/颗粒，MED 只有基础三件 */
  rebuild(tierParams) {
    this.tier = tierParams;
    try {
      if (this.composer) this.composer.dispose();
      this.ao = null;
      this.build(tierParams);
      this.available = true;
      this.setEnabled(tierParams.postFX);
    } catch (e) {
      console.warn('PostFX 重建失败，回退直接渲染:', e);
      this.available = false;
      this.setEnabled(false);
    }
  }

  setEnabled(on) {
    this.enabled = on && this.available && GFX.后处理 !== false;
    // 后处理开：色调映射交给链末；关：还给 renderer
    if (this.enabled) {
      this.renderer.toneMapping = NoToneMapping;   // 交给链末 ToneMappingEffect
    } else {
      this.renderer.toneMapping = ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.1;
    }
  }

  setSize(w, h) {
    if (this.composer) this.composer.setSize(w, h);
    if (this.ao && this.ao.setSize) this.ao.setSize(w, h);
  }

  render(dt) {
    if (this.enabled && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
