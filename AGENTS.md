# deadzone 开发约定

浏览器丧尸波次 FPS，父子共同开发。使用原生 JavaScript ES modules、Three.js 和 Vite，无后端。保持中文参数名、中文注释和现有体素美术风格。

## 开始工作

- 先读 `HANDOFF.md` 获取关卡、系统和调试接口；`PROGRESS.md` 是历史记录，旧条目可能已被后续功能替代，以代码为准。
- 安装依赖用 `npm ci`，沿用 `package-lock.json`，不要为接手项目顺便升级依赖。
- 本地 `npm run dev -- --host 127.0.0.1`；生产构建 `npm run build`。
- Node.js 版本要求以安装的 Vite 的 `engines` 为准；本项目已在 Node.js 22.21.0 验证。

## 代码入口

- `src/main.js`：状态机、输入、波次切换、地面/坦克/空战集成、HUD 和 `window.__game`。
- `src/config.js`：基础玩家、武器、手感；`src/config/gameplay.js`：关卡、敌人、技能与平衡；`src/config/graphics.js`：画质。
- `src/level.js`：小镇、沙漠、军营、要塞；`src/graphics/`：渲染和体素。
- `src/jet.js`、`src/groundunits.js`：第 8/9 波；`index.html`：HUD DOM 与 CSS。

## 修改原则

- 用户已授权：开发、检查和回归中发现并确认的实际问题，直接修复、完成相应验证并按下方约定自动提交上线，不只列出问题等待用户再次通知。尚未确认的疑点先调查，不把主观偏好当作缺陷；用户明确要求只审查不修改时遵从当次要求。
- 可调数值放入对应 config，避免在逻辑里增加魔法数字。
- 优先复用地图切换、火箭/爆炸、单位清理等现有管线。修改波次或载具时检查重开局是否完整清理状态。
- 保留 GitHub Pages 的 `/deadzone/` 构建路径；公共资源使用 `import.meta.env.BASE_URL`，不要写死 `/sounds/...`。
- 改功能时同步相应文档；不要顺便大规模重构 `main.js`。

## 验证

- 代码修改后运行 `npm run build`。
- 浏览器验证前安装 `npx playwright install chromium`，先启动 dev server，再运行 `npm test`；菜单检查用 `npm run test:menu`。
- 默认 URL 是 `http://localhost:5173`，其他端口用 `URL=http://127.0.0.1:5174 npm test`。截图默认在忽略的 `test-results/`。
- 功能验证用 `window.__game.startAt(n, 'easy'|'hard')` 和对应调试钩子，明确断言状态，不能只截图或吞掉异常。调试钩子不能替代真实键鼠交互验证。
- WebGL 无头运行使用脚本中已有的 SwiftShader 参数。等待 `domcontentloaded` 后再等待 `window.__game`；后台标签页节流和 dt 钳制会让模拟变慢，不把真实等待秒数当游戏时间。
- `npm test` 只覆盖启动；`npm run test:regression` 在 dev server 上验证暂停、重开局、高空命中、友军标识和资源释放。`scripts/_bosstest.mjs` 是旧诊断脚本，第 3 波击杀后通关的注释已过时，不作为完整回归保证。

## Git 与部署

- 用户已授权：以后本项目的改动验证通过后，自动提交并推送 `origin main` 上线，无需再次确认；用户明确要求暂不发布时除外。提交说明使用中文，作者沿用当前 Git 配置。
- 发布后检查 GitHub Actions 部署结果和公网页面；部署失败时排查修复，并如实报告状态。
- 推送 `main` 会触发 `.github/workflows/deploy.yml` 自动发布 GitHub Pages。
- 保留 `.claude/launch.json` 供原工具使用；Codex 的项目约定以本文件为入口。
