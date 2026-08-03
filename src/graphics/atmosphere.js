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
    renderer.toneMappingExposure = GFX.曝光 ?? 1.1;
  } else {
    renderer.toneMapping = THREE.NoToneMapping;
  }

  // 全局光 IBL：用一张暖色渐变当环境贴图 → 柔和环境反弹，材质质感的关键
  if (GFX.全局光) {
    try {
      scene.environment = buildEnvironment(renderer);
      scene.environmentIntensity = GFX.环境光强度 ?? 0.85;
    } catch (e) { console.warn('环境光 IBL 构建失败，跳过:', e); }
  }

  // 天空/雾色（暖暗黄昏）+ clearColor 对齐，避免远处色差边
  const fogCol = GFX.雾色 ?? 色卡.夜色;
  scene.background = new THREE.Color(fogCol);
  renderer.setClearColor(fogCol, 1);

  if (GFX.雾) {
    scene.fog = new THREE.FogExp2(fogCol, tierParams.fogDensity);
  } else {
    scene.fog = null;
  }
}

export function setFogDensity(scene, d) {
  if (scene.fog && scene.fog.isFogExp2) scene.fog.density = d;
}

/** 生成暖色渐变环境贴图（PMREM），给场景柔和的环境反弹光 */
function buildEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const cx = c.getContext('2d');
  const g = cx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.00, '#4a5378');  // 天顶：黄昏蓝（提亮）
  g.addColorStop(0.40, '#6b5f78');  // 中天：暖紫
  g.addColorStop(0.58, '#c79458');  // 地平线：明亮暖琥珀（关键暖反弹）
  g.addColorStop(0.70, '#7a5636');  // 近地：暖
  g.addColorStop(1.00, '#241d22');  // 地面：暗暖
  cx.fillStyle = g;
  cx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose();
  pmrem.dispose();
  return rt.texture;
}
