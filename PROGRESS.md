# 过夜升级进度日志

> 目标：夜间恐怖氛围写实 + 可玩性增强。纯增量，不重写核心循环。
> 每阶段：改动 → 自测（build/dev 无错 + Playwright 截图 + console 检查）→ commit。

---

## 【最新：南法体素小镇 + 玩法补强】

**画面**：整个场景改成"法国南部(普罗旺斯)"体素风，全部走自研贪婪网格合并器。
- `graphics/voxel/greedyMesh.js` 通用合并器（合并共面/剔内部面/顶点色）——所有体素模型的地基
- `graphics/voxel/styles.js` 风格库（法国南部调色板；加新风格只需加一项）
- `graphics/voxel/voxelModels.js` 模型：联排小楼(makeTerrace)、喷泉、梧桐、咖啡桌、
  **市集摊位/板条箱/石花坛/酒桶/中央石台**（后 5 个取代了原来的灰方块掩体）
- `graphics/groundTexture.js` 程序化鹅卵石地(albedo+法线)，去掉游戏感网格线
- 光照转"可读黄昏"：env IBL 全局光 + 强 N8AO + 暖调色

**玩法补强**：
- **掉落拾取**(`pickups.js`)：丧尸掉弹药(30%)/医疗(10%)，走近自动捡。
  ⚠️ 这是补一个致命洞：换弹会丢弃余弹，若无补给来源长局必然弹尽。
- **受击方向指示器**：被打时红弧指向伤害来源（丧尸围攻时必备）
- 打空自动换弹；换弹丢弃弹夹余弹（拟真）

**性能优化**（HIGH 档，headless 测 draw call）：
| 项 | 优化前 | 优化后 |
|---|---|---|
| 场景底噪 | 170 | **94** |
| 每只丧尸 | 12.8 | **7.3** |
| 16 只丧尸场景 | 299 | **211** |
- 手段：同类静态道具 `mergeGeometries` 批合并；丧尸只有躯干/头投影
- 碰撞与视觉分离（`addCollider`），所有视觉改动**不影响打枪/移动判定**

---

## 【晨间总结】☀️

**一句话**：8 个阶段(0–8)全部走完，游戏此刻能正常打开游玩，`npm run build` 通过、控制台零 error，每阶段都已 commit（崩了可 `git revert` 或 `git reset` 到任意阶段）。

### 完成度
| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 画质框架 QualityManager + stats.js + 集中 config + 自测脚本 | ✅ |
| 1 | 冷色月夜光照（ACES + 月光 + 半球 + 指数雾） | ✅ |
| 2 | 后处理（Bloom/Vignette/SMAA，HIGH +色散/颗粒/N8AO） | ✅ |
| 3 | 打击感（顿帧/碎裂粒子/命中反馈/抖屏/低血心跳） | ✅ |
| 4 | 动态光（头灯 SpotLight + 枪口火光池 + 红眼 InstancedMesh） | ✅ |
| 5 | 丧尸分化（4 种含爆炸尸）+ 波次尸潮曲线 | ✅ |
| 6 | 音效氛围（环境 drone + 音频 ducking） | ✅ |
| 7 | 正式暂停/设置菜单（画质/音量/灵敏度/画面开关） | ✅ |
| 8 | 材质细节：**轻量做了**（代码生成地面法线）；**KTX2 PBR 按预算跳过** | ⚠️ |

### draw call（headless swiftshader；**这里的 FPS 不代表你的真机，别看 FPS，看 draw call**）
| 档位 | draw call | 预算 | 结论 |
|---|---|---|---|
| LOW | ~50–66 | ≤80 | ✅ 达标 |
| MED | ~53–91 | ≤150 | ✅ 达标 |
| HIGH | ~168–181 | ≤150 | ❌ 超 ~20–30 |
- **HIGH 超预算的唯一根因**：丧尸身体没实例化，在 主渲染+月光阴影+头灯阴影+AO深度 4 个 pass 里各画一遍。**我没动它是因为命中检测(打枪)靠对每只丧尸的部件 mesh 做 raycast，实例化=改核心，属无人值守红线**（详见阶段5）。
- **想立刻让 HIGH 达标**：设置菜单里关掉 **AO** 和 **头灯投影**（或 `graphics.js` 里 `环境光遮蔽:false`），draw call 立降到 ~120。

### 截图对照（progress-shots/）
- `stage0` 框架/stats · `stage1` 冷色夜 · `stage2-high` 后处理 · `stage3-debris` 击杀反馈 · `stage4-eyes` 一排红眼(恐怖核心) · `stage5-types` 丧尸分化 · `stage7-pause` 设置菜单 · `stage8` 地面细节 · `final-menu/low/med/high` 最终各档
- 关键一张：**`stage4-eyes.png`**（头灯照亮近处、远处只剩红眼）最能代表这次的美术方向。

### 跳过了什么 & 为什么
1. **丧尸身体实例化**：避免重写打枪命中检测核心（安全红线）。→ 导致 HIGH draw call 略超。
2. **KTX2/Basis PBR 贴图**：超预算 + 需外部素材/转码器、无人值守风险高。→ 改用零成本代码地面法线。
3. **烘焙光照贴图**：同上，未做。
4. **PositionalAudio 真三维声像**：丧尸吼叫用按距离调音量替代，收益有限。

### 需要你决定的（都不阻塞游玩）
- **A. 要不要把丧尸身体实例化？** 收益：HIGH draw call 大降、能扛更多丧尸；代价：要改命中检测为 InstancedMesh+instanceId，**需你在场一起测**。我强烈建议做，但要醒着做。
- **B. 要不要上真正的 KTX2 PBR 贴图？** 建议在 A 之后做。
- **C. 夜太黑？** 默认偏暗是刻意的（靠头灯看）。嫌暗可调 `atmosphere.js` 的 `toneMappingExposure`(1.1→1.2) 或 `DynamicLights.js` 头灯强度(45→60)。

### 建议你醒来第一件事
1. 打开游戏（`npm run dev` → 点开始），按 **Esc** 看设置菜单，先感受整体氛围。
2. 觉得卡就在设置里切 **中/低** 档或关 AO/头灯投影。
3. 然后告诉我 **A（丧尸实例化）** 做不做——这是把 HIGH 拉回预算内、并支撑更大尸潮的关键一步。

---


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

### 阶段7 · 设置与暂停菜单 ✅
- **做了什么**：Esc 暂停时弹出正式菜单（不再是简陋的"点击继续"）。
  - 按钮：继续 / 重新开始 / 设置(可折叠)。
  - 设置项全部实时生效：**画质档位**(低/中/高 分段按钮)、**总音量/音乐/环境音**(滑块)、**鼠标灵敏度**(滑块)、**画面效果开关**(后处理/泛光/暗角/AO/头灯/红眼/性能面板 复选框)。
  - 面板用当前配置初始化；切效果开关会正确 `postfx.rebuild()` 或调对应系统。
- **改了哪些文件**：`index.html`(暂停菜单 DOM+CSS)、`main.js`(暂停显示菜单、`setupPauseMenu` 接线、音量/灵敏度 import)、`StatsPanel.js`(setVisible)。
- **自测**：ok=true 无 error；菜单显示、切档(→高)、拖滑块、开关效果 全部无报错。截图 `stage7-pause.png`（菜单完整美观）。
- **已知小坑**：浏览器安全策略下，按 Esc 后极短时间内 `requestPointerLock` 可能被拒，点"继续"偶尔要点第二下才回到游戏——这是浏览器限制，非 bug。
- **给你早上的问题**：无。"音效"没做成独立总线（SFX 直连 master），所以设置里是"总音量/音乐/环境音"三档；要单独的 SFX 音量需给所有音效加一层 bus，改动多，暂未做。

### 阶段8 · 材质细节 ⚠️ 部分完成（重活按预算跳过）
- **KTX2/Basis PBR 贴图管线：按预算跳过**。原因：①HIGH 已超 draw call 预算(见阶段5)，规则明确"超预算就跳过"；②KTX2 需要下载外部贴图素材 + basis 转码器 wasm + 异步加载，对无人值守风险高、收益在"暗+雾"的夜场里有限。
- **改为轻量替代（已做）**：`detailTexture.js` 用代码生成地面细节法线（多倍频 value noise→高度场→法线），贴到地面材质。**不下载素材、不加面数、不加 draw call**，让头灯/月光扫过地面时有水泥微起伏质感。挂 `graphics.js` 的 `PBR贴图` 开关，失败自动跳过不崩。
- **改了哪些文件**：新增 `detailTexture.js`；`level.js`(存 ground 引用)、`main.js`(生成并贴到地面)。
- **自测**：ok=true 无 error；draw call 不变(50)。截图 `stage8.png`(头灯下地面有细节)。
- **给你早上的问题**：要不要上"真正的 KTX2 PBR 贴图"？需要我：选/下载 CC0 贴图 + 建 KTX2 转码 + 应用到墙/地/集装箱。建议等你醒着、且先把丧尸身体实例化把 draw call 降下来之后再上，否则 HIGH 更吃紧。

### 大 Boss（替代撤离点，击杀通关）✅
- **做了什么**：撑过 `BOSS.出现波数`（默认 3 波）后不再撤离，而是召唤唯一大 Boss「腐化巨兽」，击杀即通关。
  - **外观**：体素巨怪（`boss.js`，BVS=0.13，前倾躯干+垂地长臂+粗腿+露骨肩），头顶是弱点（发光红眼），greedyMesh 合批一材质。
  - **三个技能（已平衡）**：
    1. **区域轰炸**：锁定玩家脚下，地面红圈闪烁预警 1.6s（够你跑），到点爆炸，中心 42 伤害向外衰减 + 击退。
    2. **跺脚冲击波**：你靠近 9m 内才跺，扩散橙环冲到你身上→**无伤害**但强力震开 + 扰乱瞄准（recoil 抖动），逼你重新架枪。
    3. **滚地火球**：慢速（6.5）贴地火球两连发，扇形散开，能走位躲，命中 20 伤害。
  - **平衡**：血厚 4200（越晚出现越肉），头部 2× 弱点鼓励爆头/狙/火箭；每掉 20% 血掉一次弹药/医疗补给（Boss 战无小怪捡补给，靠它续航）。
- **改了哪些文件**：新增 `boss.js`；`config/gameplay.js`(BOSS 数值)、`index.html`(顶部 BOSS 血条 HUD)、`main.js`(spawnBoss/onBossKilled、命中检测含头部倍率、帧循环 update + 血条、召唤时清怪、`updateWaves` 加 `state===PLAYING` 守卫防止胜利提示被"下一波"覆盖)。
- **自测**（`scripts/_bosstest.mjs`）：ok=true 无 error；召唤→血条显示 100%→打头 10×100=掉 2000 血(证实 2× 倍率)→秒杀→state=WIN + Boss 清理。截图 `boss-fight.png`（巨兽立于广场，红血条在顶）。
- **给你早上的问题**：数值都在 `gameplay.js` 的 `BOSS`，太难就调低 `生命`/伤害或调长 `轰炸预警`；想更凶就升 `每波加成`、缩短各 `间隔`。

### 新武器 · 加特林 M134 ✅
- **做了什么**：新增第 6 把武器「加特林 M134」，6 管旋转机枪，按 **6** 切换（或 Q/E 循环）。
  - **手感定位**：泼子弹的压制武器——射速 1400 发/分(全场最高)、单发 15 伤(靠量堆 DPS≈327)、爆头 2×、散布大(1.8+移动4.0)、后坐低但水平飘(0.7/0.9)、换弹慢 4.5s。
  - **弹药 = 600**：一条 200 发弹链 + 400 备弹（HUD 显示 `200 / 400`）。
  - **体素模型**（`weapons.js` 新 builder，sx9×sy20×sz76）：中心一圈 6 根旋转枪管 + 前端固定盘 + 转子外壳 + 粗机匣 + 左侧弹箱(作 mag 部件，换弹整箱掉换) + 可动供弹机 + 尾部双匙形握把。约 898 三角。
- **改了哪些文件**：`config.js`(武器.加特林)、`weapon.js`(slots 加入)、`graphics/voxel/weapons.js`(builder+DIMS+MUZ_Y)、`main.js`(Digit6 热键 + preventDefault)、`index.html`(HUD 提示 + 帮助里的选枪说明)。
- **自测**（`_gattest.mjs`）：切枪→名字「加特林 M134」、弹药 200/400、模型 898 三角 4 部件、开火掉弹、HUD 正确、0 报错。截图 `gatling.png`（持枪在手，左侧弹箱清晰）。
- **给你早上的问题**：数值都在 `config.js` 的 `武器.加特林`。嫌 600 发太多/太少就改 `弹匣`+`备弹`(两者之和=总弹药)；嫌太猛就降 `射速` 或 `伤害`。

### 第四波 · 沙漠地图（第二张关卡）✅
- **做了什么**：击败第三波 Boss 后不再直接通关，而是**撤入沙漠地图**打最后一波（第四波），清空沙漠尸潮才算最终通关。
  - **第二张关卡**：`Level` 加 `theme:'town'|'desert'`。两张图同场共存、各自一个 `root` group，切图=整组显隐（`setActive`，隐藏时其灯光也不参与渲染）。复用同一套碰撞点，所以流场/掩体位置一致，只换皮。
  - **沙漠视觉**（`voxelModels.js` 新道具 + `addDesertShowcase`）：砂岩地面、白天强光（炽白日照+天蓝半球光）、砂岩中央高台、巨石/仙人掌(带顶花)/枯灌木掩体、围边沙丘、残破石柱地标、白骨点缀。
  - **氛围切换**（`atmosphere.js` 新 `applyBiome`）：雾色/背景/曝光/环境 IBL 一起换——沙漠是暖沙雾+更亮曝光+天蓝→暖沙的环境贴图；小镇仍是夜色。按生态缓存不重建。
  - **流程**：`startNextWave` 第 3 波=Boss、第 4 波=沙漠尸潮(26 只)；`onBossKilled` 改为切沙漠+开第四波；沙漠波清空→`onFinalWin` 通关；重开局自动切回小镇。
- **改了哪些文件**：`level.js`(root+theme+沙漠灯光/街景)、`graphics/voxel/voxelModels.js`(makeRock/Cactus/DeadShrub/Dune/RuinPillar/Bones + 石台配色)、`graphics/atmosphere.js`(applyBiome/生态缓存)、`config/gameplay.js`(沙漠 配置)、`main.js`(第二关卡+activeLevel+切图+波次/胜负流程)、`minimap.js`(setLevel 重烘)。
- **自测**：Boss 在小镇打→击杀切沙漠(wave4/biome desert/26 只)→清空 state=WIN「☀ 你活着走出了沙漠！」→重开局回小镇(wave0/z20)，全程 0 报错；小镇基础 selftest 仍 ok（draw 99，隐藏的沙漠不占 draw call）。截图 `desert.png`。
- **给你早上的问题**：沙漠波数量在 `gameplay.js` 的 `沙漠.数量`(现 26)；想让第四波也是 Boss 或双 Boss，跟我说，`onBossKilled` 里换一行就行。

### 第五波 · 持枪 Boss「沙漠尖兵」✅
- **做了什么**：第四波沙漠尸潮清空后，第五波来一个**拿突击步枪的远程 Boss**——击杀它才是最终通关。和近战/AOE 的巨兽完全不同的打法。
  - **体素模型**（`rifleBoss.js`，BVS=0.15，直立人形）：护甲躯干+露骨肩甲+双腿+红眼，双臂前伸**托着一把突击步枪**（机匣/枪管/弹匣/枪托/瞄具），枪口指向玩家。
  - **AI**：面向玩家、保持约 16m 距离（太近就后撤）、左右**走位**；开火前枪口**亮红光预警 0.5s**（看到就跑），然后一次 5 发点射；每 4 次点射长换弹给你喘息。
  - **命中机制（可躲）**：开火瞬间锁定你当时的位置打，弹着点在那点附近散布——**你原地不动约五成中，看到红光就走位基本能躲**。单发 8 伤、命中判定半径 1.5m。血 3200、头部 2.2× 弱点、每掉 25% 血掉补给。
- **改了哪些文件**：新增 `rifleBoss.js`；`config/gameplay.js`(步枪Boss 配置)、`boss.js`(加 kind/headMul)、`main.js`(spawnRifleBoss/onRifleBossKilled、帧循环按 kind 分派、命中检测改用 boss.hitMeshes、波次流程 wave5=持枪Boss、HUD 名字切换、开枪音效)、`index.html`(BOSS 名字改成可切换)。
- **自测**：召唤→名字「沙漠尖兵 · BOSS」、血 3200、打头 10×100=掉 2200(证实 2.2×)、原地不动被点射掉血到 92(证实会射击命中)、秒杀→最终通关「☀ 你打穿了整片沙漠！」；完整链路 沙漠尸潮清空→自动进第五波持枪Boss(不提前通关)；小镇 selftest 仍 ok；全程 0 报错。截图 `rifleboss.png`。
- **给你早上的问题**：太难就调 `gameplay.js` 的 `步枪Boss`——调大 `命中半径`/`落点抖动` 反而更难躲，调小更好躲；`预警` 调长更好躲；`单发伤害`/`连射` 降低更肉。想让它也召唤小兵或加第二技能，跟我说。

- **平衡调整（沙漠尖兵"太超模"）**：血 3200→2000（不再海绵）、单发 8→6、连射 5→4、开火冷却 2.0→2.6、预警 0.5→0.8（更好躲）、命中半径 1.5→1.3、落点抖动 2.1→2.3（站着约两成中）、移速 3.0→2.3 + 走位调缓（更好瞄）、头部 2.2→2.5（会瞄更快撂倒）、掉补给 25%→20%。自测：血 2000、7×100 打头掉 1750(证实 2.5×)、原地站 8s 掉血极少、0 报错。

### 新武器 · 砍刀（近战）✅
- **做了什么**：加第 7 把武器「砍刀 · 近战」，按 **7** 切换。攻速最慢、但一击伤害最高、**无限使用（没子弹、不换弹）**、只有很短射程（够近才砍得到）。
  - **手感定位**：伤害 140（普通丧尸基本一刀）、射速 50（全场最慢的挥砍节奏）、射程 2.8m、爆头 2×、∞ 弹药。近身高风险高回报。
  - **实现**：`weapon.js` 加近战分支——不耗弹/不换弹/无枪口火光，触发**挥砍动画**（斜劈再收回）+ 挥刀"唰"音效（`audio.js` 新 `playMelee`）；`main.js` 命中走和枪一样的射线，但**近战不画曳光**；HUD 弹药显示「∞」。
  - **体素模型**（`weapons.js` 新 builder）：砍刀/马チェーテ——亮刃+刀脊+血槽反光的钢刀身、十字护手、缠绕木柄、尾锤，约 188 三角。
- **改了哪些文件**：`config.js`(武器.砍刀)、`weapon.js`(slots+近战分支+挥砍动画+ammoText ∞)、`graphics/voxel/weapons.js`(砍刀 builder+DIMS+MUZ_Y)、`audio.js`(playMelee 挥刀声)、`main.js`(Digit7 热键+近战不画曳光)、`index.html`(HUD 提示与帮助)。
- **自测**：切枪→「砍刀 · 近战」/∞/伤害140/射速50/射程2.8/近战true/模型188三角；正对丧尸挥砍→秒杀（100血→死）；R 换弹对近战无效仍 ∞；0 报错。截图 `knife.png`。
- **给你早上的问题**：想更强/更弱改 `config.js` 的 `武器.砍刀`——`伤害` 一刀几点、`射速` 挥得多快、`射程` 够多远才砍得到。

- **第四波调整**：沙漠尸潮不再出黄色的"快速"僵尸（`沙漠.排除类型:['快速']`），数量 26→14。做法：`pickType(wave, exclude)` 支持按类型排除，`Enemy` 构造多收一个 `excludeTypes`，`spawnOne` 在第四波传入排除表。自测：第四波 toSpawn=14、整波只出「普通」无「快速」、0 报错。

- **砍刀反馈修正**（3 处）：① 砍中身体的音效不再用打枪的命中提示音——新增 `playMeleeHit`（低频闷响+切肉噪声的"噗嗤"，爆头更脆）；② 挥刀声重做——从"刷子"般的宽带噪声改成短促高 Q 向下扫的破空"咻"（`playMelee`）；③ 近战砍到墙/地不再留弹孔，只溅一点火花（`processShot` 里 `shot.melee` 分支跳过 `addBulletHole`）。自测：步枪砍平台+1 弹孔、砍刀砍平台+0 弹孔、0 报错。

### 尸体永久保留 + 地面血迹 ✅
- **做了什么**：僵尸死后不再倒下缩小消失，而是**仰面躺倒、永久留在这张地图上**，死亡处地面还会溅一滩暗红血迹。
  - **死亡改动**（`enemy.js`）：死亡动画从"倒下+下沉+缩小+移除"改成"仰倒贴地不消失"；新增 `bakeCorpse()` 把 6 个身体部件**合并成一个网格（1 draw call）**、暗灰化、躺平。
  - **主循环**（`main.js`）：僵尸倒地完成时不再直接删掉，而是烘焙成尸体 + 生成血迹，挂到**当前地图的分组下**（`activeLevel.root`）——切到沙漠时小镇的尸体随分组自动隐藏，不会串图。血迹 `makeBloodDecal` 是大小两三块随机暗红圆斑合成的贴地面片（1 draw call）。
  - **性能护栏**：尸体上限 40，超出清理最旧的（连血迹）；每具尸体+血迹各 1 draw call。重开一局 `clearCorpses` 清空。
- **改了哪些文件**：`enemy.js`(死亡不消失 + bakeCorpse + 导入 mergeGeometries)、`main.js`(corpses 池/addCorpse/makeBloodDecal/clearCorpses + 帧循环烘焙 + 重开清理 + 导入 mergeGeometries)。
- **自测**：连杀后尸体累积并**长期不消失**（截图 40 具堆场上）、超 40 被截到上限、切沙漠无报错、重开清空；0 报错。截图 `corpses.png`（满地绿尸+血迹）。注：无头测试里 dt 被 clamp 到 0.05s 导致死亡动画慢放，尸体要几秒才烘出来；正常 60fps 下 0.6s 即倒地成尸。
- **给你早上的问题**：觉得卡就把 `main.js` 的 `尸体上限`（现 40）调小；想尸体更暗/血更红可改 `bakeCorpse` 的材质色和 `_bloodMat`。

### 血液反馈 ✅
- **不规则血迹**：把地面血迹从"几个圆叠加"改成**不规则溅血形状**——边缘半径随机+平滑、偶尔拖出长血滴、外围甩几点小血点，整块合成 1 draw call（`makeBloodDecal`/`bloodBlob`，`_bloodMat` 改 DoubleSide）。
- **被打中喷血**：僵尸中枪时沿子弹方向喷出一串暗红液滴（`effects.addBloodSpray`：非发光、受重力、落地/寿命到消失，上限 90）；接在 `processShot` 命中分支（原橙色火花调少）。自测：`addBloodSpray` 生成 12 滴、update 后仍在、0 报错。

### 上线公网（GitHub Pages）✅
- **做了什么**：配好一键自动部署到 GitHub Pages。`vite.config.js` 用 `base: build?'/deadzone/':'/'`（本地 dev 仍是根路径，不受影响）；`.github/workflows/deploy.yml` 每次 push 到 main 自动 `npm ci && npm run build` 并发布 `dist`。
- **踩坑修复**：音频原来是绝对路径 `/sounds/xxx`，子路径部署会 404；改成相对路径 + `import.meta.env.BASE_URL` 前缀（`audio.js`），dev 和 Pages 都能取到。
- **自测**：build 后 `dist/index.html` 资源路径带 `/deadzone/`、`dist/sounds/` 已拷贝；本地 dev 根路径 200、`/sounds/rifle.ogg` 200、`__game` 正常、0 报错。
- **你要手动做一步**：仓库 Settings → Pages → Source 选 **GitHub Actions**（我改不了仓库设置）。之后每次推送自动更新，地址：**https://andrewbaosh.github.io/deadzone/**

### 第六波 · 军营地图 + 会飞的喷气背包僵尸 ✅
- **做了什么**：击败第五波「沙漠尖兵」后，撤入**军营地图（第三张关卡）**打一波**会飞的喷气背包僵尸**，清空即最终通关。
  - **第三张地图 军营**（`level.js` theme='barracks'）：泥土/碎石地面、混凝土围墙、阴冷黄昏冷白光；体素道具（`voxelModels.js` 新增）：军用帐篷/军用补给箱/沙袋墙/瞭望塔/长条营房 + 油桶，复用同套碰撞点（gameplay 一致，只换皮）。氛围 `atmosphere.js` 新增 barracks 生态（铅灰天/冷绿）。
  - **会飞的僵尸**（`enemy.js`）：新类型「飞行」，背喷气背包（两推进罐+背板+两束蓝色脉动火焰）；独立飞行 AI——无视地形/流场，3D 朝玩家飞、远处高空巡航、逼近时下压到胸口咬；空中死亡会抛射坠地再倒成尸体。只在第六波用 forcedType 刷。
  - **流程**（`main.js`）：`switchMap()` 抽象出通用切图；`onRifleBossKilled` 改为切军营+开第六波；`startNextWave` 第六波刷 16 只飞尸；`updateWaves` 第六波清空→`onFinalWin`；重开局切回小镇。
- **改了哪些文件**：`config/gameplay.js`(飞行类型+军营配置)、`enemy.js`(飞行 AI+喷气背包+坠地)、`graphics/voxel/voxelModels.js`(军营5种道具)、`level.js`(barracks 主题+灯光+街景)、`graphics/atmosphere.js`(barracks 生态)、`main.js`(第三关卡+switchMap+第六波流程+forceBarracks)。
- **自测**：forceBarracks→biome=barracks/wave6/16只飞尸全在空中(y3.57)带喷气背包+火焰；完整链路 沙漠尖兵击杀→切军营→飞尸潮→清空最终通关→重开回小镇；小镇 selftest 仍 ok(draw114)；全程 0 报错。截图 `barracks.png`。
- **给你早上的问题**：飞尸数量/飞行高度在 `gameplay.js` 的 `军营.数量` 和 `丧尸种类.飞行.飞行高度`；嫌军营空就往 `addBarracksShowcase` 里加道具。

- **平衡调整（飞行僵尸"太超模"）**：数量 16→10、血量倍率 0.75→0.5（更快打死）、速度倍率 1.15→0.9（能跑能瞄）、伤害倍率 1.1→0.65（咬得更轻）、新增攻击间隔倍率 1.7（咬得更慢）。自测：toSpawn=10、单只 dmg9.1/speed2.78/hp84/atkMul1.7、0 报错。

### 新武器 · 追踪导弹（制导）✅
- **做了什么**：加第 8 把武器「追踪导弹 HOMING」，按 **8** 切换。威力与火箭筒同级（同样的爆炸伤害/半径/冲击），但**发射后会自动锁定并拐弯咬住敌人**。
  - **制导实现**（`rocket.js`）：`Rocket` 加 `homing`——每帧挑一个"最接近当前朝向、够近(≤48m、前方~78°锥)"的敌人锁定，用 `turnRate`(3.6 rad/s) 平滑转向；目标死了才重新锁。顺手修了个老 bug：火箭命中判定的敌人中心高度没考虑会飞的僵尸(在空中)，现在飞尸也能被火箭/导弹打中。
  - **管线复用**：`是火箭:true` 走火箭发射/爆炸管线；`spawnRocket` 改用当前武器配置(火箭筒/追踪导弹各自的弹速/追踪)，`explode` 接收该武器的爆炸参数。弹速 30(比火箭慢，好拐弯)、自伤低(0.12)、弹匣2备弹10。
  - **体素模型**（`weapons.js`）：方形制导发射器——发射管+顶部蓝色光学瞄具+管内露出的白/红弹头+握把，约 536 三角。
- **改了哪些文件**：`config.js`(追踪导弹)、`rocket.js`(homing 制导+飞尸命中高度修复)、`main.js`(spawnRocket 用当前武器cfg / explode 收 cfg / Digit8 热键)、`weapon.js`(slots)、`graphics/voxel/weapons.js`(追踪导弹 builder)、`index.html`(HUD/帮助)。
- **自测**：切枪「追踪导弹 HOMING」2/10、模型536三角；把僵尸放在侧前方(离轴)，朝正前方发射→导弹锁定(locked)并拐弯咬中把它炸死(killed)；火箭筒不受影响；小镇 selftest 仍 ok；0 报错。截图 `homing.png`。
- **给你早上的问题**：转向太猛/太笨在 `config.js` 的 `追踪导弹.转向`（现 3.6，越大拐得越急）；弹速在 `弹速`（现 30）。

### 第七波 · 军民要塞（超大地图，第四张关卡）✅
- **做了什么**：击败第六波军营飞尸潮后，撤入**军民要塞**——每边约 920m（军营的 10 倍）的超大地图，打一波**地面+会飞混合尸潮**，清空即最终通关。
  - **大地图支持**（核心工程）：`Level` 支持 `size` 参数（要塞 460）；相机视距按地图大小拉远（要塞 far≈1058）；要塞生态雾极薄(0.12x)看得到对面；**阴影相机每帧跟随玩家**（大地图不可能全覆盖）；**寻路网格改粗**（huge 用 cell 6，别炸 BFS）；敌人活动边界随地图放大；**敌人在玩家周围环形(46-90m)刷**（否则 920m 外永远等不到）；**小地图以玩家为中心**动态绘制附近掩体。
  - **要塞场景**（`level.js` theme='fortress'）：石砖地、16m 高大石墙、中央要塞主楼、内环营房/瞭望塔、外环大瞭望塔、四角棱堡；战地日光。
  - **混合尸潮**：34 只，约 40% 是会飞的喷气背包僵尸，其余地面各型。
  - **流程**（`main.js`）：第六波清空→`transitionToFortress`；第七波清空→`onFinalWin`；`switchMap` 统一切图并调相机视距；重开局切回小镇（相机视距复位）。
- **改了哪些文件**：`config/gameplay.js`(要塞配置)、`level.js`(size/huge/fortress 主题+灯光+街景+粗流场)、`graphics/atmosphere.js`(fortress 薄雾生态)、`enemy.js`(活动边界随地图)、`minimap.js`(超大图以玩家为中心)、`main.js`(第四关卡+相机视距+太阳跟随+近身刷怪+第七波流程+forceFortress)。
- **自测**：forceFortress→biome=fortress/size460/far1058/wave7/34只；敌人在玩家周围52-56m 刷、地面+飞行混合、draw 仅 73、小地图玩家居中；重开回小镇；小镇 selftest 仍 ok(draw102)；0 报错。截图 `fortress.png`。
- **给你早上的问题**：第七波现在打的是"混合尸潮"（你只定了地图）。想让第七波是 Boss、双 Boss、或别的，跟我说。数值在 `gameplay.js` 的 `要塞`（`数量`/`飞行占比`/`刷怪半径`/`地图大小`）。

### 第七波重做 · 僵尸轰炸机 + 友军坦克 ✅
- **做了什么**：第七波不再是普通尸潮。改成——**僵尸轰炸机**（会飞的飞机，绕玩家高空盘旋，**只投僵尸不投炸弹**）+ **友军坦克**（停在要塞里，**按 F 上车驾驶，弹药无限**）。把轰炸机全打下来 + 投下的僵尸全清 = 最终通关。
  - **僵尸轰炸机**（`bomber.js`）：primitive 拼的腐绿飞机（机身/主翼/尾翼/引擎+红光核/机腹弹舱），绕玩家半径48高空17盘旋，每 3.4s 投一只下坠僵尸（每机最多5只）。子弹/爆炸都能打下来。
  - **友军坦克**（`tank.js` + main 驾驶逻辑）：车体+可转炮塔+炮管+履带。靠近按 **F 上车**：第三人称追尾相机、**WASD 开车**、鼠标瞄准、**左键无限开炮**（复用火箭/爆炸管线，威力比火箭筒还猛），再按 F 下车。开车时枪械隐藏、不开镜。
  - **接线**：轰炸机命中（子弹 processShot / 火箭·坦克炮 rocket 碰撞 / 爆炸 AOE 三条路都能打）；投下的僵尸进 enemies 正常追人；第七波清空条件加"轰炸机全灭"；spawnRocket 支持坦克炮 cfg；重开局清掉轰炸机/坦克/下车。
- **改了哪些文件**：新增 `bomber.js`/`tank.js`；`config/gameplay.js`(要塞/轰炸机/坦克)、`main.js`(第七波生成、坦克驾驶/相机/开炮、F 上下车、轰炸机命中与投放、清空条件、HUD 提示)、`rocket.js`(轰炸机碰撞)、`index.html`(坦克提示 + hud ref)。
- **自测**：forceFortress→wave7/3轰炸机/坦克就位；轰炸机投下 9 只僵尸；F 上车→W 前进(坦克位移)→左键开炮(生成炮弹)→F 下车全 OK；打光轰炸机+清空僵尸→最终通关；小镇 selftest 仍 ok；0 报错。截图 `tank.png`（第三人称坦克 + 天上的轰炸机）。
- **给你早上的问题**：坦克开火间隔/威力在 `gameplay.js` 的 `坦克`；轰炸机数量/投放在 `要塞.轰炸机数` 和 `轰炸机`。

### 三个技能（冰冻主题）✅
- **做了什么**：加了 3 个可释放技能，各有按键和冷却，HUD 左下角显示图标/冷却/弹数。
  - **Z 冷冻发射器（大招，冷却100s，6发）**：hitscan 冻住准星下的僵尸——冻住不能动、你能继续打，`freeze` 时长后**解冻即死**；打完 6 发进 100s 冷却再回满。
  - **X 冰罐（冷却30s）**：前方地面生成一片冰(半径4.5、持续20s)，僵尸站上**2 秒被冻住**(解冻也死)。
  - **V 温感震撼弹（冷却30s）**：扔出抛物线落地后**自动锁定半径内僵尸**(最多6个)，每个拉一条**红线** + 造成 **45 伤害**。
  - **僵尸冻结**（`enemy.js`）：`freeze()`/frozen 状态——定住不动、冰蓝发光、清零击退；`freezeTimer<=0` 解冻即 `die()`。`iceTime` 记录站冰时长。
- **改了哪些文件**：新增 `abilities.js`（三技能+特效+冷却+HUD状态）；`config/gameplay.js`(技能配置)、`enemy.js`(冻结)、`main.js`(实例化+ZXV按键+每帧update+HUD+重开reset+调试钩子)、`index.html`(技能栏HUD+CSS+提示)。
- **自测**：Z 冻住僵尸(ammo6→5)、打满6发→cd100、解冻即死(thaw→die)；X 生成冰面、站2秒被冻住;V 落地对附近僵尸各45伤害、cd30；小镇 selftest 仍 ok；0 报错。截图 `skills.png`(左下技能栏)。
- **给你早上的问题**：技能数值都在 `gameplay.js` 的 `技能`（冷却/弹数/冻结时长/半径/伤害/投掷距离）。按键也在那里(键)。

### 第七波强化 · 坦克内免疫 + 降落伞僵尸炸弹 ✅
- **做了什么**（按你的要求）：
  - **坦克里普通僵尸打不掉血**：在坦克中普通僵尸近战伤害=0（僵尸只是骚扰）；玩家位置跟着坦克走，僵尸会围过来但伤不到你。
  - **飞机改投"僵尸炸弹"**（`main.js` spawnZombieBomb/updateZombieBomb）：带**降落伞慢慢降落**（降速2.6，会飘）；**落地生成一堆僵尸**（每颗4只）；**砸中坦克**则小爆炸、（在坦克里时）**炸掉你 20 血**。
- **改了哪些文件**：`config/gameplay.js`(轰炸机:每弹僵尸/炸弹降速/炸坦克伤害，每机投放3)、`main.js`(坦克内 !inTank 免伤、玩家跟随坦克、僵尸炸弹系统、清空条件加"没有正在落的炸弹"、重开清理、调试钩子)。
- **自测**：坦克内僵尸近战 hpDrop=0；炸弹砸坦克 hpDrop=20；炸弹落地生成 4 僵尸；降落伞慢降；小镇 selftest 仍 ok；0 报错。截图 `zombiebomb.png`（降落伞炸弹 + 轰炸机）。
- **给你早上的问题**：每颗炸弹几只僵尸/炸坦克掉多少血/降落速度都在 `gameplay.js` 的 `轰炸机`。
