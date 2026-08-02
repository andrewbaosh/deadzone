import * as THREE from 'three';
import { 色卡, GFX } from '../config/graphics.js';

/**
 * 阶段1：色彩/色调映射 + 夜色背景 + 指数雾。
 * 灯光本体在 level.buildLights 里按色卡设置（月光方向光 + 半球光 + 弱环境光）。
 */
export function setupAtmosphere(renderer, scene, tierParams) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (GFX.色调映射) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
  } else {
    renderer.toneMapping = THREE.NoToneMapping;
  }

  // 夜色天空 + clearColor 对齐雾色，避免远处出现色差边
  scene.background = new THREE.Color(色卡.夜色);
  renderer.setClearColor(色卡.夜色, 1);

  if (GFX.雾) {
    scene.fog = new THREE.FogExp2(色卡.夜色, tierParams.fogDensity);
  } else {
    scene.fog = null;
  }
}

export function setFogDensity(scene, d) {
  if (scene.fog && scene.fog.isFogExp2) scene.fog.density = d;
}
