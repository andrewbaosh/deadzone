/** 定向回归：需先启动 Vite。测试钩子仅由 Playwright 拦截注入，不进入发布产物。 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/\/src\/main\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const source = await response.text();
    assert.ok(source.includes('window.__game = {'), '找不到测试钩子注入点');
    await route.fulfill({ response, body: source.replace('window.__game = {', `
      window.__regression = {
        get allies() { return allyJets; },
        pause: pauseGame,
        resume() { paused = false; pauseMenu.style.display = 'none'; },
        // 子弹一帧从目标前 6 米飞到后 6 米，旧的端点判定会漏掉它。
        cannonHitAtCeiling() {
          startFreshGame(); wave = 8; enterJetMode(8);
          jetPos.set(0, 空战.最高高度, 0); player.yaw = 0; player.pitch = 0;
          const target = zombieJets[0]; target.root.position.set(0, 空战.最高高度, -50);
          const before = target.hp;
          spawnJetBullet(new THREE.Vector3(0, 空战.最高高度, -44), new THREE.Vector3(0, 0, -1), 空战.机炮, jetTracerMat, jetBullets);
          updateJetMode(0.05, simulationTime);
          return { damage: before - target.hp, expected: 空战.机炮.伤害, altitude: jetPos.y };
        },
        enemyHitAtCeiling() {
          jetPos.set(0, 空战.最高高度, 0); player.yaw = 0; player.pitch = -Math.PI / 2;
          const before = player.hp;
          // 低帧率/更快弹速时也必须覆盖整段轨迹；仍使用正常敌机伤害配置。
          spawnJetBullet(new THREE.Vector3(-6, 空战.最高高度, 0), new THREE.Vector3(1, 0, 0), { ...空战.敌机, 弹速: 240 }, jetEnemyTracerMat, enemyBullets);
          updateJetMode(0.05, simulationTime);
          return { damage: before - player.hp, expected: 空战.敌机.子弹伤害 };
        },
      };
      window.__game = {`) });
  });
  await page.goto(process.env.URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__game && !!window.__regression);
  await page.evaluate(() => {
    const g = window.__game;
    g.startAt(1, 'hard'); g.spawnTestEnemies(1);
    g.player.onKey('KeyW', true); g.weapons.setTrigger(true);
    document.dispatchEvent(new Event('pointerlockchange'));
  });
  const snapshot = () => page.evaluate(() => ({
    paused: window.__game.paused, player: window.__game.player.pos.toArray(),
    enemy: window.__game.enemies[0].root.position.toArray(), hp: window.__game.player.hp,
    ammo: window.__game.weapons.ammo['步枪'], keys: Object.fromEntries(Object.entries(window.__game.player.keys).filter(([,down]) => down)),
    trigger: window.__game.weapons.triggerHeld,
  }));
  const before = await snapshot();
  assert.equal(before.paused, true); assert.equal(before.trigger, false); assert.deepEqual(before.keys, {});
  await page.keyboard.press('r'); await page.keyboard.press('3');
  await page.waitForTimeout(1000);
  assert.deepEqual(await snapshot(), before, '暂停时模拟必须完全停止');
  await page.evaluate(() => window.__regression.resume());
  await page.waitForFunction(pos => window.__game.enemies[0].root.position.distanceTo({ x: pos[0], y: pos[1], z: pos[2] }) > 0.01, before.enemy);
  console.log('PASS 暂停冻结、清除按住输入、恢复模拟');

  const reload = await page.evaluate(() => {
    const g = window.__game; g.startAt(1, 'hard');
    g.weapons.ammo['步枪'].mag = 0; g.weapons.startReload();
    const wasReloading = g.weapons.reloading;
    g.weapons.setTrigger(true); g.startAt(1, 'hard');
    const reserve = g.weapons.ammo['步枪'].reserve;
    g.weapons.update(10, false, false);
    return { wasReloading, reloading: g.weapons.reloading, trigger: g.weapons.triggerHeld, reserve, after: g.weapons.ammo['步枪'].reserve };
  });
  assert.equal(reload.wasReloading, true); assert.equal(reload.reloading, false);
  assert.equal(reload.trigger, false); assert.equal(reload.after, reload.reserve);
  console.log('PASS 换弹中重开不会残留换弹或扣备弹');

  for (const name of ['cannonHitAtCeiling', 'enemyHitAtCeiling']) {
    const hit = await page.evaluate(name => window.__regression[name](), name);
    assert.equal(hit.damage, hit.expected, name);
    console.log('PASS 高度上限扫掠命中', name, hit);
  }

  await page.evaluate(() => window.__game.startAt(8, 'easy'));
  assert.equal(await page.evaluate(() => window.__regression.allies.filter(a => a.root.getObjectByName('ally-label')).length), 2);
  const friendly = await page.evaluate(() => ({ enemies: window.__game.jetState.enemyJets.length, allies: window.__game.allyJetCount }));
  assert.equal(friendly.enemies, 6); assert.equal(friendly.allies, 2);
  await page.evaluate(() => { window.__game.setJetPos(0, 200, 0); window.__game.player.yaw = 0; window.__game.jetDive(0); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#enemies-left').textContent(), '6', '空战敌人数不能被地面 HUD 覆盖');
  // 固定友军在视野中，便于人工检查标签；不改变正式游戏的跟随行为。
  await page.evaluate(() => {
    window.__regression.pause();
    document.getElementById('pause-menu').style.display = 'none';
    window.__regression.allies.forEach((a, i) => a.root.position.set(i ? 10 : -10, 200, -35));
  });
  await page.screenshot({ path: 'test-results/ally-labels.png' });
  console.log('PASS 简单模式 2 架友机标识，敌我独立');

  const memory = [];
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => { window.__game.startAt(8, 'easy'); window.__regression.pause(); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    memory.push(await page.evaluate(() => { const s = window.__game.stats(); return { geometries: s.geometries, textures: s.textures }; }));
  }
  assert.deepEqual(memory.slice(1), Array(4).fill(memory[1]), '预热后重开资源数量不应增长');
  console.log('PASS 连续重开资源稳定', memory);
  await page.evaluate(() => window.__game.startAt(9, 'hard'));
  await page.evaluate(() => { window.__game.w9SpawnMinion(); window.__game.w9DamageBoss(999999); });
  await page.waitForFunction(() => window.__game.state === 3);
  await page.evaluate(() => window.__game.startAt(1, 'hard'));
  assert.equal(await page.evaluate(() => window.__game.jetState.jetMode), false);
  assert.equal(await page.evaluate(() => window.__game.paused), false);
  assert.deepEqual(errors, []);
  console.log('PASS 通关后重开地面关卡；浏览器无错误');
} catch (error) { console.error('Browser errors:', errors); throw error; } finally { await browser.close(); }
