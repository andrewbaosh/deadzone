import { defineConfig } from 'vite';

// 部署到 GitHub Pages 的项目页在子路径下：https://andrewbaosh.github.io/deadzone/
// 只有 build 时用 /deadzone/，本地 dev 仍是根路径（npm run dev 照常 http://localhost:5173/）
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/deadzone/' : '/',
}));
