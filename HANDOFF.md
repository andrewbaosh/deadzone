# deadzone —— 项目交接文档

> 浏览器丧尸波次 FPS，父子业余项目。中文变量名贯穿全代码。请沿用现有风格与约定。

> Codex 接手入口见 `AGENTS.md`；本文保留游戏系统细节。

## 1. 技术栈 / 运行 / 部署
- **Three.js 0.185 + Vite 8**，纯客户端、无后端、无网络请求。体素美术（贪婪网格合并 `greedyMesh`）。
- 仓库：`github.com/andrewbaosh/deadzone`；GitHub Pages 自动部署到 `https://andrewbaosh.github.io/deadzone/`（`vite.config.js` 里 `base` 仅在 build 时为 `/deadzone/`）。
- 本地开发：`npm install` → `npm run dev`（端口 5173）。构建：`npm run build`（产物 `dist/`）。
- 资源路径用相对路径 + `import.meta.env.BASE_URL` 前缀（否则 Pages 子路径下 404）。

## 2. 开发约定（务必遵守）
- **改完必须 `npm run build` 确认 0 报错**再提交。
- 用户已授权后续改动验证通过后自动提交并推送 origin main，无需再次确认；提交说明使用中文，作者沿用当前 Git 配置。推送后检查 GitHub Pages 部署结果和公网页面；用户明确要求暂不发布时除外。
- **所有可调数值集中在 `src/config/gameplay.js`**（父子调参主要改这里）；基础武器/玩家数值在 `src/config.js`。加功能时把数值抽到 config，不要写死。
- 平衡反馈常见词：「太超模」= 需要削弱。
- 无自动化测试框架。验证用 **Playwright headless**（`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`）驱动 `window.__game` 调试钩子；注意 headless 有 **dt 钳制导致约 1/4~1/10 慢放**，计时类验证要多等真实时间。浏览器预览面板在**未聚焦时会节流 requestAnimationFrame**，帧不推进属正常，用 headless 或前置标签页验证。

## 3. 代码地图（关键文件）
| 文件 | 作用 |
|---|---|
| `src/main.js` (~2780 行) | 主编排：状态机、主循环、波次流程、输入、空战/座舱、召唤支援、HUD、`window.__game` 调试钩子。**几乎所有集成逻辑在这里。** |
| `src/config/gameplay.js` | 全部平衡配置（见 §6） |
| `src/config.js` | 基础武器表(`武器`)、玩家(`PLAYER`)、波次(`波次`)、手感、分数、声音等 |
| `src/level.js` | `Level` 类：4 套主题地图(town/desert/barracks/fortress)，`switchMap`，超大图支持(相机 far/雾/太阳跟随/流场/小地图) |
| `src/player.js` | 玩家移动/视角/血量。`freePitch` 标志=空战解锁俯仰（可翻筋斗） |
| `src/weapon.js` | 8 把武器 + 火箭标志(`是火箭`→走 rocket 管线) |
| `src/enemy.js` | 丧尸(5 种：普通/快速/肉盾/爆炸/飞行)、冻结、飞行 AI、尸体烘焙 |
| `src/boss.js` / `src/rifleBoss.js` | 第 3 波巨兽 / 第 5 波持枪 Boss |
| `src/bomber.js` / `src/tank.js` | 第 7 波僵尸轰炸机 / 可驾驶友军坦克 |
| `src/jet.js` | 空战：`PlayerJet` / `ZombieJet`(第8波敌机) / `AllyJet`(简单模式僚机) |
| `src/groundunits.js` | 第 9 波：`Wave9Boss`(钢铁指挥官) / `AAVehicle`(防空车) / `TankVehicle`(坦克) |
| `src/teammate.js` | 简单模式地面步兵队友 |
| `src/abilities.js` | 三冰冻技能 Z/X/V |
| `src/rocket.js` | 火箭/追踪导弹/坦克炮弹（`追踪`标志=homing）|
| `src/effects.js` `src/audio.js` `src/music.js` | 特效池、音效、动态音乐 |
| `src/minimap.js` `src/pickups.js` `src/extraction.js` `src/flowfield.js` | 小地图/掉落/撤离点/流场寻路 |
| `src/graphics/*` `src/config/graphics.js` | PostFX、动态光、画质档位、体素、大气/biome、贴图 |
| `index.html` | 全部 HUD DOM + 内联 CSS（含座舱两套界面） |

## 4. 核心架构
- **状态机**：`STATE.MENU/PLAYING/DEAD/WIN`，全局 `state`、`wave`。主循环 `frame()`（`dt = min(0.05, clock.getDelta())`）。
- **多地图**：`allLevels = [level, desert, barracks, fortress]`；`switchMap(target, biome)` 切换 active level + 玩家 + 碰撞列表 + 小地图 + biome 大气 + 相机 far。内容都挂 `level.root`，`setActive` 切可见性。
- **波次流程**：`startNextWave()` 按 `wave` 分派；清波在 `updateWaves()`。每波结束触发过图/召唤 Boss/进空战。
- **火箭管线复用**：武器返回 `{rocket:true}` → `spawnRocket` → `Rocket` → `explode()`；追踪导弹/坦克炮/RPG 都走它。
- **空战(第8/9波)**：`jetMode=true` 时主循环走 `updateJetMode` 分支（`updateJetFlight` 飞行+相机，`jetWave===9` 转 `updateWave9`），完全绕开地面逻辑；`updateWaves` 里 `if(jetMode) return`。

## 5. 已实现的 9 个波次（关卡）
1. **第 1~2 波**：小镇(town)，普通尸潮。
2. **第 3 波**：巨兽 BOSS（town，本波无小怪）。击杀 → 撤入沙漠。
3. **第 4 波**：沙漠尸潮（desert，排除「快速」黄尸）。
4. **第 5 波**：沙漠尖兵·持枪远程 Boss（desert）。击杀 → 撤入军营。
5. **第 6 波**：军营(barracks)，会飞的喷气背包僵尸。清空 → 撤入要塞。
6. **第 7 波**：军民要塞（超大图 ~920m）。**无普通刷怪**：僵尸轰炸机高空盘旋投「降落伞僵尸炸弹」（落地生尸/砸坦克掉血）；**友军坦克**靠近按 **F** 上车驾驶（弹药无限、可碾压撞死僵尸、坦克内免疫普通僵尸）。清空 → 升空第 8 波。
7. **第 8 波**：**空战·狗斗**。驾驶战斗机 vs 僵尸战斗机。武器：**左键机炮**(无限)、**长按 2 键锁定导弹**(随机锁一架，松开发射，全程追踪至命中)。敌机全灭 → 第 9 波。
8. **第 9 波**：**空中打 BOSS**（对地强击）。BOSS「钢铁指挥官」**自身不攻击**，只召唤小弟（**防空车**：重机枪，开火前屏幕底部 3 秒预警；**坦克**：慢速炮击）。打死 BOSS = 通关，它召唤的小弟一起死。战机三武器 **1/2/3 切换**：① 机炮(无限、伤害5) ② 反坦克导弹(11发、直射AoE半径5) ③ 空对地锁定导弹(11发、自动锁定载具/BOSS后追踪)；②③ 打光后每 2 秒回 1 发。

## 6. 平衡配置入口 `src/config/gameplay.js`（顶层导出）
`打击感 / 丧尸种类 / BOSS / 沙漠 / 步枪Boss / 军营 / 要塞 / 轰炸机 / 坦克(含碾压半径) / 空战(第8波) / 空战九(第9波:boss/防空车/坦克/机炮/反坦克导弹/空对地) / 坠机(撞地翻倍伤害) / 队友(简单模式) / 波次曲线 / 掉落 / 受击指示 / 音效氛围 / 技能(Z/X/V) / 支援(炮兵齐射/制导导弹/核弹含辐射/冷冻弹药)`。基础武器/玩家在 `src/config.js` 的 `武器 / PLAYER / 波次`。

## 7. 跨波次系统
- **8 把武器**（数字键 1~8）：步枪/手枪/霰弹/火箭筒/狙击/加特林/砍刀(近战)/追踪导弹。
- **三冰冻技能**：Z 冷冻发射器(大招·冻住即死)、X 冰罐(地面冰面)、V 温感震撼弹(锁定+伤害)。`abilities.js`。
- **伤害积分召唤支援**：累计对生物造成的伤害当货币。按 **G** 开菜单 → 数字键 1~4 选 → 准星瞄地面 → 空格确认（**纯键盘+准星，无鼠标也能用**）。四种：炮兵齐射(800)/制导导弹(1000)/核弹(2000，10秒倒计时慢降+爆后留持续核辐射区)/冷冻弹药(1200)。`伤害积分`、`earnDamage()`、`updateStrikes/updateRadiation`。
- **开局选关卡+难度**：开始界面单屏选 **第 1~9 关** + **简单/困难** + 绿色「开始游戏」按钮（键盘：数字选关、←→选难度、回车开始）。**简单 = 多 2 名队友**（地面步兵 `teammate.js` / 空战僚机 `AllyJet`，会帮打 BOSS）；**困难 = 你自己**。**丧尸数量与血量两种难度完全一致**，区别只在有无队友。`jumpToWave(n)` 复用各波切换逻辑。

## 8. 空战飞行细节（第 8/9 波）
- 飞行：鼠标转向、W/S 油门、机头对准视线、第三人称追尾相机。
- **协调转弯压坡度**：用转向角速度(rad/s，与帧率无关)，向左转→左翼下沉（机身顶朝右倾），最多约 68°。
- **可翻筋斗**：`player.freePitch=true` 解锁俯仰夹角，能拉垂直翻身再俯冲；空战高度上限 200，下限 8。
- **撞地翻倍伤害**：撞地每次翻倍 10→20→40→80，第 4 次直接死（`坠机` config）。
- **飞行仪表 HUD**（第三人称底部）：水平仪(姿态,含俯仰刻度梯+横滚刻度弧+指针) + 高度/空速/航向。
- **座舱内视角（按 C 切换，保留第三人称）**：相机随机身翻滚俯冲；**按波次分风格**——
  - 第 8 波 = **现代战机 HUD**：绿色滚动航向带、左空速带/右高度带、横滚弧、俯仰梯、飞行路径准星、AoA/G/马赫、CRT 扫描线+荧光抖动。
  - 第 9 波 = **二战伊尔-2 强击机座舱**：6 圆表仪表盘(空速/地平仪/高度/罗盘/转速/升降,黄铜表圈+指针,由真实数据驱动) + 反射式瞄准具 + **前风挡装甲玻璃 + 加强筋骨架**(顶框/两侧竖筋,带铆钉) + 操纵杆。
  - 做旧感：玻璃灰尘(feTurbulence 噪声)/污渍/划痕、金属磨损/掉漆/油渍、表玻璃泛黄反光。
  - ⚠ 座舱内瞄准环=屏幕正中（=相机正前方=真实射向）；血条在伊尔-2 面板上方另置以免被挡。

## 9. 调试钩子 `window.__game`（在 main.js 末尾）
用于自测，可直接在控制台/Playwright 调用。常用：
- `forceStart()` 直接开局；`startAt(n, 'easy'|'hard')` 从第 n 关+难度开局；`forceBoss/forceDesert/forceRifleBoss/forceBarracks/forceFortress/forceJet/forceWave9()`。
- `spawnTestEnemies(n)`、`setPlayerPos(x,z)`、`grantPoints(n)`、`fireStrikeAt/detonateNow(type,x,z)`。
- 空战：`jetState`、`w9State()`、`toggleCockpit()`、`setJetPos`、`w9SwitchWeapon/w9Fire/w9DamageBoss/w9SpawnMinion`、`jetDive(pitch)`、`get jetRoll`。
- `board()` 上坦克、`useFreeze/useIce/useShock()` 等。

## 10. 已知注意事项 / 坑
- **headless 慢放 + 预览面板节流**：计时/AI/攻击类验证要么用 headless 多等真实时间、要么把标签页前置；`waitUntil:'load'` 常挂，用 `'domcontentloaded'`。
- 空战里地面/空中目标是**空对地**：机炮子弹高速，命中判定用**扫掠线段**(`distToSeg2`)防穿透；对地目标命中半径给得较大。
- `boss` 是地面 Boss 对象（第3/5波）；第9波用 `w9Boss` + `w9Units`，两者不同。
- 声音路径要相对 + BASE_URL 前缀。
- Mac 上 F5 是系统键（所以召唤支援用 G）。

## 11. 可能的下一步（供参考，非必须）
- 平衡微调（各波数值、队友强度、空战武器威力）。
- 座舱可继续加细节（机鼻/机盖入镜、仪表夜光、更多风挡样式）。
- 第 8 波简单模式僚机对空、第 9 波敌方可加「锁定你」的导弹（如果要提难度）。
- 移动端/触屏适配（目前为键鼠+触摸板）。
