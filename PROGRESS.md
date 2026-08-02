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

### 阶段2 · 后处理氛围 ✅
- **做了什么**：`src/graphics/PostFX.js`（pmndrs postprocessing 6.39 + n8ao 2.0）。
  - MED：Bloom(阈值0.55只让亮部发光) + Vignette + SMAA。
  - HIGH：追加 极弱色散(0.0006) + 弱胶片颗粒(0.08) + N8AO(halfRes 半分辨率, 小半径1.6, Low质量)。
  - composer 用 HalfFloatType；色调映射移到链末 ToneMappingEffect(ACES)，开后处理时 renderer.toneMapping=None，关闭时还原。
  - LOW/关闭：直接 renderer.render，完全不走 composer。
  - **健壮性**：构建/重建包 try-catch，失败自动回退直接渲染，绝不崩游戏；档位变化时 `rebuild()` 重建链，保证 HIGH 才有 AO/色散/颗粒。
  - 修正 draw call 统计：`renderer.info.autoReset=false` + 每帧手动 reset，累加 composer 所有 pass。
- **改了哪些文件**：新增 `PostFX.js`；改 `main.js`(接入 composer 渲染、resize、onQualityChange 重建、info.reset)。渲染以外逻辑未动。
- **自测**：AUTO 与 HIGH 均 ok=true 无 error。截图 `stage2.png`(LOW/无后处理) 与 `stage2-high.png`(HIGH：暗角+红眼bloom可见)。
- **性能**：LOW **57** call（<80 ✅）；HIGH **168** call（>150 ❌，超 18）。
  - ⚠️ **超预算原因**：①丧尸未实例化(每只多 draw call)；②N8AO 会重渲一遍场景深度(~+40 call)。两者都在**阶段5 实例化**后大幅下降，届时复测 HIGH 应回到 150 内。
  - 立即可用的降载：改 `graphics.js` 里 `环境光遮蔽:false` 可马上砍掉 AO 的深度 pass。headless swiftshader 帧率(22-23fps)不代表真机，仅 draw call 数有参考意义。
- **给你早上的问题**：HIGH 的 N8AO 是否保留？它最吃 draw call。若你的机器 AUTO 落在 HIGH 且觉得卡，`环境光遮蔽:false` 即可。我暂定保留（你点名要 N8AO/SSAO）。

### 阶段3 · 打击感与反馈 ✅（可玩性核心）
- **做了什么**（全部挂 `gameplay.js` 的 `打击感`，可单项开关/调倍率）：
  - **击杀顿帧(hitstop)**：击杀瞬间模拟 dt 降到 6%，约 45ms 微时停（爆头 ×1.5），镜头灵敏度不受影响。
  - **死亡碎裂粒子**：`effects.js` 新增 InstancedMesh 碎片对象池(160 片，**全程 1 个 draw call**)，按丧尸身体色迸发、带重力/翻滚/落地反弹/缩小消失。实测击杀 10 只→110 片活跃、无报错。
  - **准星命中反馈**：命中时准星弹大 +变亮（跟 hitmarker 同步）。
  - **丧尸受击闪白→红**：emissive 从白热回落到红，更有肉感。
  - **开火/被咬抖屏**：开火按后坐力大小轻微抖，被咬按伤害强度抖（原爆炸抖动保留）。
  - **低血心跳**：血量 <30% 触发心跳音(越低越急)+屏幕红晕脉动。
  - 后坐力镜头/击退 也接入配置可关/调。原有 hitmarker、伤害数字、受伤红晕、击退 保留增强。
- **改了哪些文件**：`effects.js`(碎片池)、`enemy.js`(死亡碎片/闪白/击退接配置)、`audio.js`(playHeartbeat)、`main.js`(hitstop simDt/准星pop/心跳脉动/开火抖动)。核心循环结构未变，仅把 sim 更新的 dt 换成 simDt。
- **自测**：ok=true 无 error；碎片/顿帧脚本验证通过。截图 `stage3.png`、`stage3-debris.png`(+100 击杀反馈)。
- **性能**：LOW **66** call（碎片池 +1，<80 ✅）。
- **给你早上的问题**：无。顿帧时长/抖动强度/各开关都在 `gameplay.js` 的 `打击感` 里。

### 阶段4 · 动态光效 ✅（画面+玩法交汇）
- **做了什么**：
  - **玩家头灯**（`DynamicLights.js`）：跟随相机的 SpotLight(#fff4e0)，形成"黑暗一束光"构图，近处丧尸被照亮、远处只剩红眼。HIGH 投影(1024)，MED/LOW 只留光锥不投影。
  - **枪口火光对象池**：8 盏 PointLight 池化，开火时借一盏(#ffaa44, 强度8, 寿命50ms)照亮周围，用完归还——渲染循环内**不 new 光源**，符合预算。
  - **丧尸红眼**（`EyeField.js`）：所有丧尸眼睛用**一个 InstancedMesh** 渲染(1 draw call)，每帧按存活丧尸头部世界位置+朝向写入；材质 `toneMapped:false` 保持高亮被 Bloom 点亮。实测 6 丧尸→12 眼、无报错。替代了原来每只 2 个 eye mesh（顺带省 draw call）。
- **改了哪些文件**：新增 `DynamicLights.js`、`EyeField.js`；改 `enemy.js`(移除各自 eye mesh)、`main.js`(接入头灯/枪口光/眼场、onQualityChange 头灯投影)。丧尸 AI/碰撞未动。
- **自测**：ok=true 无 error；eyeCount=12 正确；截图 `stage4.png`(头灯光锥)、`stage4-eyes.png`(一排丧尸+红眼，恐怖构图成立)。
- **性能**：LOW **58** / MED **91**（均达标）/ HIGH **169**（仍 >150）。
  - HIGH 高是因为：未实例化的丧尸身体在 主渲染+月光阴影+头灯阴影+AO深度 共 4 个 pass 各画一遍。**阶段5 丧尸身体实例化后会一次性砍掉所有 pass 的这部分**，届时 HIGH 应回落到 150 内。
- **给你早上的问题**：无。头灯太亮/太暗可调 `DynamicLights.js` 里 SpotLight 的强度(45)与距离(34)。

### 阶段5 · 丧尸分化与波次曲线 ✅（耐玩度）
- **做了什么**（数值全在 `gameplay.js`）：
  - **4 种丧尸**：普通 / 快速(瘦小0.82×、跑1.8×、血0.55×) / 肉盾(1.42×、慢0.6×、血3.4×) / **爆炸尸**(死亡范围伤害 45、半径 4.5)。按"当前波数已解锁 + 权重"随机；颜色区分(绿/黄/暗红/橙)。实测 HP 230/127/784/196、爆炸尸自爆对玩家造成伤害(100→81)。
  - **波次曲线**：每 5 波一次"尸潮"高潮(数量×1.6 + 红字警告)。
  - 类型选择从 `config.js` 硬编码改为读 `gameplay.js` 的 `丧尸种类`（集中可调）；原 config 的 快速/重型出现波数 字段废弃但保留无害。
- **⚠️ 重要安全决策：没有实例化丧尸"身体"**。原因：射击命中检测(processShot)靠对每只丧尸的 `head/torso/腿/臂` mesh 做 raycast(`userData.enemy`)，改成 InstancedMesh 会**重写命中检测核心**——违反"不重写能工作的核心"红线，风险太高不适合无人值守。**眼睛已实例化**(阶段4)。身体保持每只一组 mesh。
  - 因此 **HIGH draw call 仍 ~169 略超 150**（LOW 58 / MED 91 达标）。这是刻意用"稳"换"省"。若你要更低：①`graphics.js` 关 `环境光遮蔽`(省 AO 深度 pass ~40)；②想真正实例化身体需要把命中检测改成 InstancedMesh+instanceId 映射，建议你醒着时我再单独做+充分测试。
- **改了哪些文件**：`gameplay.js`(种类加颜色)、`enemy.js`(类型从配置选、自爆属性)、`main.js`(精英波、自爆死亡伤害)。寻路/碰撞/命中检测**未动**。
- **自测**：ok=true 无 error。截图 `stage5-types.png`。
- **给你早上的问题**：是否要我在你醒着时把丧尸身体也实例化（收益：HIGH draw call 大降；代价：改命中检测核心，需你在场测试）？见上。

### 阶段6 · 音效氛围 ✅
- **做了什么**（`audio.js` 新增，`gameplay.js` 的 `音效氛围` 可开关）：
  - **环境底噪 drone**：几个失谐低频锯齿 + 32Hz sub + 慢速 LFO 扫滤波 + 极轻风噪，营造持续低沉恐怖氛围；随游戏开始渐入、暂停/死亡/切后台渐出。
  - **音频 ducking**：开火压低环境音(-50%,0.22s)、爆炸更狠(-70%,0.4s)，让枪声爆炸更突出。
  - 原有：开火/换弹/命中(playHitmarker 区分爆头)/被咬(playPlayerHurt)/丧尸吼叫(playGrowl 按距离调音量) 全部保留。
- **改了哪些文件**：`audio.js`(ambient/duck)、`main.js`(生命周期 start/stopAmbient + 开火/爆炸 duck)。
- **自测**：ok=true 无 error；ambient start/duck/stop 无异常（静音验证）。
- **跳过/说明**：丧尸吼叫用的是"按距离调音量"而非 Three.js PositionalAudio 的真三维声像——前者已够用且更省，真正的 3D 声像收益有限、集成成本高，**故跳过**。所有音量目前在 `config.js 声音` 与 `setAmbientVolume()`，阶段7 的设置菜单会接上滑块。
- **给你早上的问题**：环境底噪默认音量 0.16，觉得吵可在 `audio.js` 的 `ambientTarget` 调低或 `gameplay.js` 关 `环境drone`。
