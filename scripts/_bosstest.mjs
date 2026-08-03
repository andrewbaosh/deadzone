import { chromium } from 'playwright';

const url = process.env.URL || 'http://localhost:5173';
const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e && e.message ? e.message : String(e))));

try {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__game.forceStart());
  await page.waitForTimeout(1500);

  const spawned = await page.evaluate(() => window.__game.forceBoss());
  console.log('spawned:', JSON.stringify(spawned));

  // 让 Boss 跑 6 秒，触发轰炸/火球/逼近
  await page.waitForTimeout(6000);
  const mid = await page.evaluate(() => window.__game.boss);
  console.log('after 6s:', JSON.stringify(mid));

  // HUD 血条是否显示
  const hudVisible = await page.evaluate(() => {
    const h = document.getElementById('boss-hud');
    return { display: h.style.display, width: h.querySelector('.boss-fill').style.width };
  });
  console.log('hud:', JSON.stringify(hudVisible));

  // 打头部若干次，应比打身体掉血更快（验证头部倍率）
  const beforeHead = await page.evaluate(() => window.__game.boss.hp);
  await page.evaluate(() => { for (let i = 0; i < 10; i++) window.__game.bossTakeDamage(100, true); });
  const afterHead = await page.evaluate(() => window.__game.boss.hp);
  console.log('head 10x100 dmg dealt:', (beforeHead - afterHead).toFixed(0), '(期望 ~2000 = 头部倍率2)');

  // 一击秒杀，触发胜利
  const killed = await page.evaluate(() => window.__game.bossTakeDamage(999999, false));
  console.log('kill:', JSON.stringify(killed));
  await page.waitForTimeout(1500);
  const finalState = await page.evaluate(() => ({ state: window.__game.state, boss: window.__game.boss }));
  console.log('final:', JSON.stringify(finalState), '(state 3 = WIN, boss null = 已清理)');

  await page.screenshot({ path: 'progress-shots/boss-test.png' });
} catch (e) {
  errors.push('SCRIPT: ' + e.message);
}

console.log('ERRORS:', errors.length);
for (const e of errors) console.log('  ' + e);
await browser.close();
process.exit(errors.length ? 1 : 0);
