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

  applyBiome(renderer, scene, 'town', tierParams);
}

// 环境贴图渐变（PMREM）按生态缓存，切图时复用不重建
const _envCache = {};
const _biomeExposure = { town: null, desert: null };

const TOWN_STOPS = [
  [0.00, '#4a5378'], [0.40, '#6b5f78'], [0.58, '#c79458'], [0.70, '#7a5636'], [1.00, '#241d22'],
];
const DESERT_STOPS = [   // 明亮白天：天蓝→暖沙
  [0.00, '#8fb6e8'], [0.42, '#cfd6dc'], [0.55, '#ecd6a2'], [0.72, '#d9bd82'], [1.00, '#b89a60'],
];
const BARRACKS_STOPS = [  // 阴冷黄昏：铅灰天→冷绿地
  [0.00, '#6b7684'], [0.42, '#8a94a0'], [0.58, '#9a9c8e'], [0.72, '#6e6f5c'], [1.00, '#33352a'],
];
const FORTRESS_STOPS = [  // 战地日光：暖白天→石灰地
  [0.00, '#aeb6c2'], [0.42, '#c9cdcf'], [0.58, '#c8c2b0'], [0.72, '#9c968a'], [1.00, '#5c574d'],
];
const BIOME = {
  town:     { fog: (GFX.雾色 ?? 色卡.夜色), fogMul: 1.0, expMul: 1.0, envInt: (GFX.环境光强度 ?? 0.85), stops: TOWN_STOPS },
  desert:   { fog: 0xd8c49a, fogMul: 0.5, expMul: 1.15, envInt: 1.05, stops: DESERT_STOPS },
  barracks: { fog: 0x8a8f88, fogMul: 0.7, expMul: 1.0, envInt: 0.95, stops: BARRACKS_STOPS },
  // 超大要塞：雾极薄(0.12x)，看得到远处；曝光略高
  fortress: { fog: 0xb8bcc0, fogMul: 0.12, expMul: 1.08, envInt: 1.0, stops: FORTRESS_STOPS },
};

/** 切换生态（'town' | 'desert'）：雾色/背景/曝光/环境 IBL 一起换 */
export function applyBiome(renderer, scene, biome, tierParams) {
  const B = BIOME[biome] || BIOME.town;

  if (GFX.全局光) {
    try {
      if (!_envCache[biome]) _envCache[biome] = buildEnvironment(renderer, B.stops);
      scene.environment = _envCache[biome];
      scene.environmentIntensity = B.envInt;
    } catch (e) { console.warn('环境光 IBL 构建失败，跳过:', e); }
  }

  scene.background = new THREE.Color(B.fog);
  renderer.setClearColor(B.fog, 1);
  if (GFX.雾) {
    if (!scene.fog || !scene.fog.isFogExp2) scene.fog = new THREE.FogExp2(B.fog, tierParams.fogDensity * B.fogMul);
    else { scene.fog.color.setHex(B.fog); scene.fog.density = tierParams.fogDensity * B.fogMul; }
  } else {
    scene.fog = null;
  }
  if (GFX.色调映射) renderer.toneMappingExposure = (GFX.曝光 ?? 1.1) * B.expMul;

  scene._biome = biome;
  scene._fogMul = B.fogMul;
}

export function setFogDensity(scene, d) {
  if (scene.fog && scene.fog.isFogExp2) scene.fog.density = d * (scene._fogMul ?? 1.0);
}

/** 生成渐变环境贴图（PMREM），给场景柔和的环境反弹光。stops=[[t,'#hex'],...] */
function buildEnvironment(renderer, stops = TOWN_STOPS) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const cx = c.getContext('2d');
  const g = cx.createLinearGradient(0, 0, 0, 256);
  for (const [t, col] of stops) g.addColorStop(t, col);
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
