import * as THREE from 'three';
import { 色卡, GFX } from '../config/graphics.js';

/**
 * 阶段4：动态光。
 * - 玩家头灯：跟随相机的 SpotLight（暖白 #fff4e0），HIGH 投影，形成"黑暗一束光"。
 * - 临时光对象池：开火/爆炸时借一盏 PointLight 照亮周围，寿命到就归还（预算 8 盏）。
 */
export class DynamicLights {
  constructor(scene, camera, tierParams) {
    this.scene = scene;
    this.camera = camera;

    // 头灯
    this.headlight = new THREE.SpotLight(色卡.头灯, 45, 34, 0.6, 0.45, 1.4);
    this.headlight.position.set(0.15, -0.15, 0.1);
    camera.add(this.headlight);
    this.headlight.target.position.set(0, -0.05, -1);
    camera.add(this.headlight.target);
    this.headlight.visible = !!GFX.玩家头灯;
    this.applyTier(tierParams);

    // 临时光对象池
    this.pool = [];
    this.active = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 12, 2);
      l.visible = false;
      l.castShadow = false;      // 临时光不投影，省性能
      scene.add(l);
      this.pool.push(l);
    }
  }

  applyTier(tier) {
    const wantShadow = !!tier.headlightShadow && !!GFX.玩家头灯;
    this.headlight.castShadow = wantShadow;
    if (wantShadow) {
      this.headlight.shadow.mapSize.set(1024, 1024);
      this.headlight.shadow.camera.near = 0.5;
      this.headlight.shadow.camera.far = 38;
      this.headlight.shadow.bias = -0.0005;
      this.headlight.shadow.normalBias = 0.02;
    }
  }

  setHeadlight(on) { this.headlight.visible = on; }

  /** 借一盏临时光闪一下（枪口火光/爆炸）。life 秒。 */
  flash(pos, color, intensity, distance, life) {
    const l = this.pool.pop();
    if (!l) return;                    // 池空了就跳过（预算保护）
    l.color.set(color);
    l.intensity = intensity;
    l.distance = distance;
    l.position.copy(pos);
    l.visible = true;
    this.active.push({ l, life, maxLife: life, intensity });
  }

  muzzleFlash(pos) {
    if (!GFX.枪口火光) return;
    this.flash(pos, 色卡.暖焦点, 8, 10, 0.05);
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.life -= dt;
      const k = Math.max(0, a.life / a.maxLife);
      a.l.intensity = a.intensity * k;
      if (a.life <= 0) {
        a.l.visible = false;
        a.l.intensity = 0;
        this.pool.push(a.l);
        this.active.splice(i, 1);
      }
    }
  }
}
