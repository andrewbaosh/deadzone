/**
 * ============================================================
 *  画面总配置 —— 所有新增画面效果的开关都在这里
 *  早上想关掉某个效果，把对应的 true 改成 false 即可，不用动逻辑代码
 * ============================================================
 */

// 锁定色卡（取色只能来自这里，不许即兴调色）
export const 色卡 = {
  夜色: 0x0a0e1a,     // 雾 / 天空 / 暗部
  月光: 0x88aaff,     // 主方向光（冷蓝）
  半球上: 0x334466,   // 半球光上半（冷）
  半球下: 0x080810,   // 半球光下半（暗）
  暖焦点: 0xffaa44,   // 枪口 / 爆炸
  头灯: 0xfff4e0,     // 头灯 / 室内灯（暖）
  危险红: 0xff3322,   // 丧尸红眼 / 血 / 警报
};

// 各画面效果的总开关（默认全开，可单独关）
export const GFX = {
  显示性能面板: true,   // 左上角 stats.js（FPS/MS/DrawCall/档位）
  小地图: true,         // 右上角小地图（场地/僵尸/掉落/撤离点）

  // 阶段1 光照色彩
  色调映射: true,       // ACESFilmic tone mapping + sRGB
  月光: true,           // 方向光月光
  半球光: true,
  雾: true,             // FogExp2 夜雾
  雾色: 0x2c2436,       // 雾/背景色（黄昏紫暖）——想更暗更冷改小/改 0x0a0e1a
  全局光: true,         // 环境贴图 IBL：柔和环境反弹光，材质从"发灰"变"被环境照亮"（质感关键）
  环境光强度: 1.6,      // env map 影响强度
  曝光: 1.5,            // 色调映射曝光（调亮一点材质才看得清）

  // 质感调色
  调色: true,           // 暖调 + 对比 + 饱和微调
  暖度: 0.12,           // 往暖色偏
  对比: 0.12,
  饱和: 0.18,

  // 阶段2 后处理
  后处理: true,         // 总开关（关掉则完全不走 composer）
  泛光: true,           // Bloom
  暗角: true,           // Vignette
  抗锯齿SMAA: true,
  色散: true,           // ChromaticAberration（仅 HIGH，极弱）
  胶片颗粒: true,       // Noise（仅 HIGH，弱）
  环境光遮蔽: true,     // N8AO/SSAO（仅 HIGH）

  // 阶段3 打击感（视觉部分）
  镜头抖动: true,
  受伤血迹: true,       // 屏幕边缘泛红

  // 阶段4 动态光
  丧尸红眼: true,
  枪口火光: true,       // 池化 PointLight
  玩家头灯: true,       // 跟随相机的聚光灯

  // 氛围建模细节（黄昏温馨）
  暖窗: true,           // 建筑上的暖光窗户（发光，被 bloom 点亮）
  街灯: true,           // 街灯柱 + 暖色光池
  体素细节: true,       // 精细体素建筑/砖地（贪婪网格合并，proof-of-concept）

  // 阶段8
  PBR贴图: true,
};

// 三档画质参数（QualityManager 用；AUTO 会自动选一档）
export const TIERS = {
  LOW: {
    label: 'LOW',
    pixelRatioMax: 1.0,
    shadows: false,
    shadowMapSize: 512,
    postFX: false,          // LOW 不走后处理
    ao: false,
    fogDensity: 0.016,
    particleCap: 60,
    headlightShadow: false,
    bloom: false,
  },
  MED: {
    label: 'MED',
    pixelRatioMax: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    postFX: true,
    ao: false,
    fogDensity: 0.012,
    particleCap: 160,
    headlightShadow: false,
    bloom: true,
  },
  HIGH: {
    label: 'HIGH',
    pixelRatioMax: 2.0,
    shadows: true,
    shadowMapSize: 2048,
    postFX: true,
    ao: true,
    fogDensity: 0.009,
    particleCap: 320,
    headlightShadow: true,
    bloom: true,
  },
};

// 启动时选档：'AUTO' 会按 GPU + 前两秒帧率自动选；也可写死 'LOW'/'MED'/'HIGH'
export const 启动画质 = 'AUTO';
