/**
 * 无头自测：打开游戏、进入战斗、截图、抓取控制台 error/warning 和性能数据。
 * 用法: node scripts/selftest.mjs <截图路径> [menu]
 *   - 默认会调用 window.__game.forceStart() 进入战斗再截图
 *   - 传 "menu" 则只截开始界面
 * 退出码: 正常为 0，控制台/页面错误为 1，导航或断言失败为 2。
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const url = process.env.URL || 'http://localhost:5173';
const shot = process.argv[2] || 'test-results/play.png';
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
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__game?.forceStart === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  if (mode !== 'menu') {
    await page.evaluate(() => {
      window.__game.forceStart();
    });
    assert.equal(await page.evaluate(() => window.__game.state), 1, '应进入 PLAYING 状态');
    await page.waitForTimeout(2200);
    // 可强制画质档（验证 HIGH 后处理用）
    if (process.env.TIER) {
      await page.evaluate((t) => window.__game.setTier(t), process.env.TIER);
      await page.waitForTimeout(500);
    }
    // 造几只丧尸让截图有内容
    await page.evaluate(() => {
      window.__game.spawnTestEnemies(6);
    });
    await page.waitForTimeout(600);
  }

  if (mode === 'menu') {
    assert.equal(await page.evaluate(() => window.__game.state), 0, '应停留在 MENU 状态');
  }
  const stats = await page.evaluate(() => window.__game.stats());
  assert.ok(stats && stats.calls > 0 && stats.tris > 0, '应已渲染游戏场景');

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
