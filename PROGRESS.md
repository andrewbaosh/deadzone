# 过夜升级进度日志

> 目标：夜间恐怖氛围写实 + 可玩性增强。纯增量，不重写核心循环。
> 每阶段：改动 → 自测（build/dev 无错 + Playwright 截图 + console 检查）→ commit。

---

## 【晨间总结】
（全部完成后写在这里，见文件末尾的占位）

---

## 环境
- 技术栈：Three.js 0.185 + Vite 8，纯前端
- Node 22.21，dev server 端口 5173
- 自测：`node scripts/selftest.mjs progress-shots/阶段N.png`（Playwright 无头 Chromium）
- 基线提交：`overnight-baseline` 标签（commit 4f2b0af）

## 美术色卡（锁定，取色只能来自这里）
| 用途 | 颜色 |
|---|---|
| 夜色环境冷色（雾/天空/暗部） | #0a0e1a |
| 月光冷色（主方向光） | #88aaff |
| 半球光 上冷 / 下暗 | #334466 / #080810 |
| 暖色焦点（枪口/爆炸） | #ffaa44 |
| 头灯/室内灯 暖 | #fff4e0 |
| 危险红（红眼/血/警报） | #ff3322 |

## 性能预算（硬红线）
- Draw call ≤150 (HIGH) / ≤80 (LOW)
- 动态光：1 方向光 + 1 玩家聚光 + 8 池化临时光
- 重复物体用 InstancedMesh；渲染循环内禁止 new；临时光用对象池
- stats.js 显示 FPS/MS + renderer.info.render.calls

---

## 阶段记录

### 阶段0 · 地基 ✅
- **做了什么**：搭画质/性能框架，不加任何画面效果。
  - `src/config/graphics.js`：色卡（锁定）、GFX 效果开关、TIERS(LOW/MED/HIGH) 参数、启动画质=AUTO。
  - `src/config/gameplay.js`：打击感/丧尸种类/波次曲线/音效氛围 的开关与数值（供 3/5/6 阶段用）。
  - `src/graphics/QualityManager.js`：按 GPU 猜档 + 前 2 秒实测帧率自动降档；管理 pixelRatio 与阴影总开关；`F7` 手动循环切档。
  - `src/graphics/StatsPanel.js`：stats.js(FPS/MS) + 自绘 draw call/tier/zombies 行；`F8` 开关。
  - `scripts/selftest.mjs`：Playwright 无头自测（进战斗→截图→抓 console error/warning→读 stats）。
- **改了哪些文件**：新增上述 5 个文件 + `main.js`（导入、创建 quality/statsPanel、frame 里 begin/sample/end、__game 加 stats/spawnTestEnemies/setTier、F7/F8 键）。核心循环/输入/音效/波次**未改**。
- **自测**：Playwright ok=true，无 console error。截图 `progress-shots/stage0.png`。
- **性能**：draw call **136** / tri 2.2k / 7 只丧尸（headless swiftshader，档位 AUTO→MED，测得 ~50fps）。
  - ⚠️ 注意：丧尸目前每只是 ~10 个 mesh 的 Group（未实例化），draw call 会随丧尸数线性上涨，20+ 只就可能破 150 预算。阶段5 计划用 InstancedMesh 优化。
- **警告（无害，headless 环境）**：THREE.Clock 已弃用(用 Timer)、PCFSoftShadowMap 在 swiftshader 降级为 PCFShadowMap。真机无碍，暂不动（属核心计时/阴影，避免引入风险）。
- **给你早上的问题**：无。默认 AUTO 选档，可 F7 手动切 / 改 `graphics.js` 启动画质。

### 阶段1 · 核心光照色彩 ✅
- **做了什么**：从"白模"变成"冷色月夜"。
  - `src/graphics/atmosphere.js`：sRGB 输出 + ACESFilmic 色调映射(exposure 1.1) + 夜色背景/clearColor(#0a0e1a) + FogExp2(按档位密度 0.022~0.030)。
  - `level.buildLights` 改为色卡配色：HemisphereLight(上#334466/下#080810) + 极弱 AmbientLight + 月光 DirectionalLight(#88aaff, 强度1.5)，收紧阴影相机(d=42)、normalBias 防漏光/悬浮；**删掉了原来 3 盏即兴彩色补光**（超预算且偏色）。
  - 画质档变化时自动调雾密度 + 阴影分辨率（`onQualityChange`）。
- **改了哪些文件**：新增 `atmosphere.js`；改 `level.js`(灯光+构造函数接 shadowMapSize)、`main.js`(atmosphere 接入、Level 传参、onQualityChange)。几何/碰撞/玩法**未动**。
- **自测**：ok=true 无 error。截图 `progress-shots/stage1.png`（明显变冷变暗、红眼在暗处很突出）。
- **性能**：draw call **144** / tri 2.3k / 7 丧尸（MED）。灯光从 5 盏降到 2 盏(+target)，符合预算。
- **决策/注意**：
  - 现在偏暗是**刻意**的（夜间恐怖），可见性主要靠阶段4 的玩家头灯 + 阶段2 的 Bloom 让亮部发光。若你早上觉得太暗，调 `atmosphere.js` 的 `toneMappingExposure`(1.1→1.2) 或 `level.js` 月光强度(1.5→1.8)。
  - 场景材质本就是 MeshStandard（含少量 metalness 0.3~0.6）；无 env map 时金属面偏黑，暂可接受，阶段8 上 PBR/env 时再统一。
  - draw call 逼近 150，阶段5 丧尸实例化后会降。
