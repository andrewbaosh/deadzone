/**
 * 无头自测：打开游戏、进入战斗、截图、抓取控制台 error/warning 和性能数据。
 * 用法: node scripts/selftest.mjs <截图路径> [menu]
 *   - 默认会调用 window.__game.forceStart() 进入战斗再截图
 *   - 传 "menu" 则只截开始界面
 * 退出码: 有 console error 或页面异常时为 1，否则 0。
 */
import { chromium } from 'playwright';

const url = process.env.URL || 'http://localhost:5173';
const shot = process.argv[2] || 'progress-shots/test.png';
const mode = process.argv[3] || 'play';

const errors = [];
const warnings = [];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

page.on('console', (m) => {
  const t = m.type();
  const txt = m.text();
  if (t === 'error') errors.push(txt);
  else if (t === 'warning') warnings.push(txt);
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e && e.message ? e.message : String(e))));

try {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1500);

  if (mode !== 'menu') {
    await page.evaluate(() => {
      try { if (window.__game && window.__game.forceStart) window.__game.forceStart(); } catch (e) {}
    });
    await page.waitForTimeout(2200);
    // 可强制画质档（验证 HIGH 后处理用）
    if (process.env.TIER) {
      await page.evaluate((t) => { try { window.__game && window.__game.setTier && window.__game.setTier(t); } catch (e) {} }, process.env.TIER);
      await page.waitForTimeout(500);
    }
    // 造几只丧尸让截图有内容（若有该调试钩子）
    await page.evaluate(() => {
      try { if (window.__game && window.__game.spawnTestEnemies) window.__game.spawnTestEnemies(6); } catch (e) {}
    });
    await page.waitForTimeout(600);
  }

  const stats = await page.evaluate(() => {
    try { return window.__game && window.__game.stats ? window.__game.stats() : null; } catch (e) { return null; }
  });

  await page.screenshot({ path: shot });
  await browser.close();

  console.log(JSON.stringify({ ok: errors.length === 0, errors, warnings: warnings.slice(0, 20), stats }, null, 1));
  process.exit(errors.length ? 1 : 0);
} catch (e) {
  try { await page.screenshot({ path: shot }); } catch (_) {}
  await browser.close();
  console.log(JSON.stringify({ ok: false, fatal: String(e), errors, warnings }, null, 1));
  process.exit(2);
}
