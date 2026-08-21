import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLAYER, 手感, 画面, 波次, 分数, 撤离, 敌人 as ECFG, 准星 } from './config.js';
import { Level } from './level.js';
import { Player } from './player.js';
import { WeaponSystem } from './weapon.js';
import { Enemy } from './enemy.js';
import { Effects } from './effects.js';
import { Extraction } from './extraction.js';
import { Rocket } from './rocket.js';
import { initAudio, resumeAudio, playWaveStart, playPlayerHurt, playExplosion, getAudio, _soundState, startAmbient, stopAmbient, duckEnv } from './audio.js';
import { initMusic, startMusic, stopMusic, toggleMusic, setIntensity, isMusicOn, setMusicVolume, _debug as musicDebug } from './music.js';
import { setVolume as setMasterVolume, setAmbientVolume } from './audio.js';
import { 声音 } from './config.js';
import { QualityManager } from './graphics/QualityManager.js';
import { StatsPanel } from './graphics/StatsPanel.js';
import { GFX, 色卡 } from './config/graphics.js';
import { setupAtmosphere, setFogDensity, applyBiome } from './graphics/atmosphere.js';
import { PostFX } from './graphics/PostFX.js';
import { DynamicLights } from './graphics/DynamicLights.js';
import { EyeField } from './graphics/EyeField.js';
import { makeDetailNormal } from './graphics/detailTexture.js';
import { 打击感, 波次曲线, 音效氛围, 掉落, 受击指示 } from './config/gameplay.js';
import { playHeartbeat, playPickup, playShot, playRocketFire } from './audio.js';
import { Pickups } from './pickups.js';
import { Minimap } from './minimap.js';
import { Boss } from './boss.js';
import { RifleBoss } from './rifleBoss.js';
import { Bomber } from './bomber.js';
import { Tank } from './tank.js';
import { Abilities } from './abilities.js';
import { BOSS, 沙漠, 步枪Boss, 军营, 要塞, 轰炸机, 坦克, 技能, 支援 } from './config/gameplay.js';

/* ============ 渲染基础 ============ */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = 画面.阴影;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;   // 手动每帧 reset，好统计 composer 多 pass 的总 draw call

/* ============ 画质框架（阶段0） ============ */
const statsPanel = new StatsPanel();
// 后续阶段往这里挂"档位变化时要调整的东西"（雾密度/后处理/头灯投影…）
let onQualityChange = () => {};
const quality = new QualityManager(renderer, (p, tier) => onQualityChange(p, tier));

const scene = new THREE.Scene();
// 阶段1：色调映射 + 夜色背景 + 指数雾（按当前画质档的雾密度）
setupAtmosphere(renderer, scene, quality.params);

const camera = new THREE.PerspectiveCamera(手感.视野角度, window.innerWidth / window.innerHeight, 0.05, 400);
scene.add(camera);   // 相机进场景，好挂枪模型

// 阶段2：后处理（Bloom/Vignette/SMAA + HIGH 追加 色散/颗粒/AO）
const postfx = new PostFX(renderer, scene, camera, quality.params);
postfx.setEnabled(quality.params.postFX);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});

/* ============ 游戏对象 ============ */
const level = new Level(scene, { shadowMapSize: quality.params.shadowMapSize });
// 第二张地图：沙漠（第四波用）。同场共存，先隐藏，切图时整组显隐
const desert = new Level(scene, { theme: 'desert', shadowMapSize: quality.params.shadowMapSize });
desert.setActive(false);
// 第三张地图：军营（第六波用）
const barracks = new Level(scene, { theme: 'barracks', shadowMapSize: quality.params.shadowMapSize });
barracks.setActive(false);
// 第四张地图：军民要塞（第七波用，超大 ~920m）
const fortress = new Level(scene, { theme: 'fortress', size: 要塞.地图大小, shadowMapSize: quality.params.shadowMapSize });
fortress.setActive(false);
const allLevels = [level, desert, barracks, fortress];
let activeLevel = level;   // 当前生效的关卡（碰撞/流场/出生点/小地图都跟它走）

// 阶段4：动态光（玩家头灯 + 枪口/爆炸临时光对象池）+ 丧尸红眼实例场
const dynamicLights = new DynamicLights(scene, camera, quality.params);
const eyeField = new EyeField(scene, 64);

// 地面细节法线现由 level 的鹅卵石贴图提供（makeCobbleTextures），此处不再叠加。

// 画质档变化时：调雾密度 + 阴影分辨率 + 后处理 + 头灯投影
onQualityChange = (p) => {
  setFogDensity(scene, p.fogDensity);
  for (const lv of allLevels) {
    if (lv.sun) {
      lv.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      if (lv.sun.shadow.map) { lv.sun.shadow.map.dispose(); lv.sun.shadow.map = null; }
    }
  }
  if (typeof postfx !== 'undefined') postfx.rebuild(p);   // 重建效果链以匹配新档位
  dynamicLights.applyTier(p);
};
const player = new Player(camera, level);
const weapons = new WeaponSystem(camera, scene);
const effects = new Effects(scene, camera);
const extraction = new Extraction(scene);
const pickups = new Pickups(scene);
const minimap = new Minimap(level);
const abilities = new Abilities(scene, camera, effects, earnDamage);
const raycaster = new THREE.Raycaster();

let enemies = [];
let rockets = [];
const corpses = [];                            // 永久尸体 { mesh, blood, root }
const 尸体上限 = 40;                            // 尸体过多会掉帧，超过就清理最旧的
let staticHitList = level.hitMeshes.slice();   // 环境可命中物
let shakeAmount = 0;                            // 屏幕震动强度
let hitstopTimer = 0;                           // 命中顿帧（微时停）
let _lastGunYaw = 0;                            // 上帧朝向（枪身 sway 用）
let heartbeatTimer = 0;                         // 低血心跳计时

/* ============ 游戏状态 ============ */
const STATE = { MENU: 0, PLAYING: 1, DEAD: 2, WIN: 3 };
let state = STATE.MENU;

let score = 0;
let wave = 0;
let kills = 0;
let 伤害积分 = 0;               // 累计对生物造成的伤害，用来换召唤支援
function earnDamage(d) { if (d > 0) 伤害积分 += d; }
// 召唤支援：正在下落的打击体 + 炮兵齐射排队的炮弹 + 目标预警圈
let strikeProjectiles = [];
let artilleryShells = [];
let strikeMarkers = [];
let callInOpen = false;         // G 支援菜单是否打开（打开时冻结模拟）
let aimingStrike = false;       // 是否正在用准星瞄地面选支援落点
let pendingStrike = null;
let aiming = false;

// 波次调度
let waveActive = false;
let toSpawn = 0;
let spawnTimer = 0;
let restTimer = 0;
let killsThisWave = 0;

// 撤离阶段
let extractionActive = false;
let holdProgress = 0;        // 已在撤离区停留的秒数
let contSpawnTimer = 0;      // 撤离阶段持续出怪计时

// Boss 阶段（替代撤离）
let boss = null;
let bossActive = false;

// 瞄准状态：切换式(F)或按住式(右键)，两者取或
let aimToggle = false;
let rightHeld = false;
let mouseHeld = false;          // 左键是否按住（坦克开炮用）
// 第七波：僵尸轰炸机 + 友军坦克
let bombers = [];
let zombieBombs = [];           // 带降落伞的僵尸炸弹
let tank = null;
let inTank = false;             // 是否在坦克里
let tankFireCd = 0;
let prevWeaponName = '步枪';    // 检测换枪以自动收镜

/* ============ HUD 元素 ============ */
const el = (id) => document.getElementById(id);
const hud = {
  hp: el('hp-fill'), hpText: el('hp-text'),
  ammo: el('ammo'), weaponName: el('weapon-name'),
  wave: el('wave'), score: el('score'), kills: el('kills'),
  enemiesLeft: el('enemies-left'),
  crosshair: el('crosshair'),
  scope: el('scope'),
  center: el('center-msg'),
  damageVignette: el('damage-vignette'),
  hitmarker: el('hitmarker'),
  waypoint: el('waypoint'),
  wpArrow: el('waypoint').querySelector('.wp-arrow'),
  wpDist: el('waypoint').querySelector('.wp-dist'),
  extractStatus: el('extract-status'),
  exText: el('extract-status').querySelector('.ex-text'),
  exBar: el('extract-status').querySelector('.ex-bar'),
  exFill: el('extract-status').querySelector('.ex-fill'),
  hitDirs: el('hit-dirs'),
  pickupToast: el('pickup-toast'),
  bossHud: el('boss-hud'),
  bossFill: el('boss-hud').querySelector('.boss-fill'),
  bossName: el('boss-hud').querySelector('.boss-name'),
  tankHint: el('tank-hint'),
  skZ: el('sk-z'), skX: el('sk-x'), skV: el('sk-v'),
  skZcd: el('sk-z').querySelector('.sk-cd'), skXcd: el('sk-x').querySelector('.sk-cd'), skVcd: el('sk-v').querySelector('.sk-cd'),
  skZnum: el('sk-z').querySelector('.sk-num'),
  dmgPoints: el('dmg-points'),
  nukeTimer: el('nuke-timer'),
};

function setCenterMsg(html, show = true) {
  hud.center.innerHTML = html;
  hud.center.style.display = show ? 'flex' : 'none';
}

/* ============ 指针锁定 / 开始 ============ */
const startOverlay = el('start-overlay');
const pauseMenu = el('pause-menu');

function beginGame() {
  initAudio();
  resumeAudio();
  initMusic();
  if (声音.开背景音乐) startMusic();
  canvas.requestPointerLock();
}

startOverlay.addEventListener('click', beginGame);

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    startOverlay.style.display = 'none';
    pauseMenu.style.display = 'none';
    if (state === STATE.MENU) startFreshGame();
    if (state === STATE.DEAD) { /* 死亡界面自己处理重开 */ }
    // 开始/恢复游戏时才放音乐（若被 M 关掉则 startMusic 自动跳过）+ 环境底噪
    if (声音.开背景音乐) startMusic();
    if (音效氛围.环境drone) startAmbient();
  } else {
    if (state === STATE.PLAYING && !callInOpen) {
      // 暂停：停掉音乐 + 环境，弹出暂停菜单（打开支援界面时不算暂停）
      stopMusic();
      stopAmbient();
      pauseMenu.style.display = 'flex';
    }
  }
});

// 切到别的标签页/窗口时停音乐，切回来且正在游戏中再续上
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopMusic();
    stopAmbient();
  } else if (state === STATE.PLAYING && document.pointerLockElement === canvas) {
    if (声音.开背景音乐) startMusic();
    if (音效氛围.环境drone) startAmbient();
  }
});

/* ============ 输入 ============ */
document.addEventListener('keydown', (e) => {
  if (state !== STATE.PLAYING) return;
  // G：召唤支援（开菜单 / 取消瞄准）
  if (e.code === 'KeyG') { e.preventDefault(); if (callInOpen) closeCallIn(); else if (aimingStrike) cancelAiming(); else openCallIn(); return; }
  // 菜单打开：按 1/2/3/4 选支援，Esc 关闭（其他键屏蔽）
  if (callInOpen) {
    e.preventDefault();
    if (e.code === 'Digit1') pickStrike(0);
    else if (e.code === 'Digit2') pickStrike(1);
    else if (e.code === 'Digit3') pickStrike(2);
    else if (e.code === 'Digit4') pickStrike(3);
    else if (e.code === 'Escape') closeCallIn();
    return;
  }
  // 瞄准中：空格召唤，Esc 取消（其余键照常移动/看）
  if (aimingStrike) {
    if (e.code === 'Space') { e.preventDefault(); confirmAiming(); return; }
    if (e.code === 'Escape') { cancelAiming(); return; }
  }
  player.onKey(e.code, true);
  if (e.code === 'KeyR') weapons.startReload();
  // CS 风格选枪：1步枪 2手枪 3霰弹 4火箭 5狙击 6加特林
  if (e.code === 'Digit1') weapons.switchTo('步枪');
  if (e.code === 'Digit2') weapons.switchTo('手枪');
  if (e.code === 'Digit3') weapons.switchTo('霰弹枪');
  if (e.code === 'Digit4') weapons.switchTo('火箭筒');
  if (e.code === 'Digit5') weapons.switchTo('狙击枪');
  if (e.code === 'Digit6') weapons.switchTo('加特林');
  if (e.code === 'Digit7') weapons.switchTo('砍刀');
  if (e.code === 'Digit8') weapons.switchTo('追踪导弹');
  if (e.code === 'KeyQ') weapons.quickSwitch();                   // CS：Q 快速切回上一把
  if (e.code === 'KeyF') tryToggleTank();                         // 靠近友军坦克=上/下车；否则开/关瞄准镜
  // 三个技能（冰冻主题）
  if (e.code === 技能.冷冻发射器.键) abilities.useFreeze(enemies);
  if (e.code === 技能.冰罐.键) abilities.useIce(player);
  if (e.code === 技能.震撼弹.键) abilities.useShock(player);
  if (e.code === 'KeyE') { const i = (weapons.slots.indexOf(weapons.current) + 1) % weapons.slots.length; weapons.switchByIndex(i); } // 循环换枪（备用）
  if (e.code === 'KeyM') { const on = toggleMusic(); flashWaveBanner(on ? '♪ 音乐开' : '♪ 音乐关'); }
  if (e.code === 'F7') { quality.cycleTier(); flashWaveBanner('画质 ' + quality.tierName); }
  if (e.code === 'F8') { statsPanel.toggle(); }
  if (['KeyW','KeyA','KeyS','KeyD','Space','KeyR','KeyQ','KeyE','KeyF','KeyM','KeyZ','KeyX','KeyV','KeyG','Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8'].includes(e.code)) e.preventDefault();
});
document.addEventListener('keyup', (e) => player.onKey(e.code, false));

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (callInOpen) return;   // 支援菜单打开(冻结)时不转视角，避免松开后画面跳
  player.onMouseMove(e.movementX, e.movementY);
});

document.addEventListener('mousedown', (e) => {
  if (state === STATE.DEAD) return;
  if (document.pointerLockElement !== canvas) return;
  if (e.button === 0) { if (aimingStrike) { confirmAiming(); return; } mouseHeld = true; if (!inTank) weapons.setTrigger(true); }
  if (e.button === 2) { rightHeld = true; }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) { mouseHeld = false; weapons.setTrigger(false); }
  if (e.button === 2) { rightHeld = false; }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// 滚轮换枪
document.addEventListener('wheel', (e) => {
  if (state !== STATE.PLAYING) return;
  const i = weapons.slots.indexOf(weapons.current);
  const n = weapons.slots.length;
  const next = (i + (e.deltaY > 0 ? 1 : -1) + n) % n;
  weapons.switchByIndex(next);
});

/* ============ 波次逻辑 ============ */
function startFreshGame() {
  // 清场
  for (const en of enemies) en.remove();
  enemies = [];
  clearCorpses();
  for (const r of rockets) r.remove();
  rockets = [];
  pickups.clear();
  for (const h of hitDirs) h.el.remove();
  hitDirs.length = 0;
  toastTimer = 0;
  hud.pickupToast.style.opacity = '0';
  shakeAmount = 0;
  score = 0; wave = 0; kills = 0;
  // 清掉第七波的轰炸机/炸弹/坦克
  for (const bm of bombers) bm.remove(); bombers = [];
  for (const zb of zombieBombs) scene.remove(zb.root); zombieBombs = [];
  if (tank) { tank.remove(); tank = null; }
  abilities.reset();
  clearStrikes(); 伤害积分 = 0;
  if (callInOpen) closeCallIn();
  if (aimingStrike) endAiming();
  inTank = false; hud.tankHint.style.display = 'none';
  hud.crosshair.classList.remove('tank');
  // 回到小镇地图（上一局可能停在沙漠/军营/要塞）
  if (activeLevel !== level) {
    switchMap(level, 'town');
  }
  player.respawn();
  for (const k of weapons.slots) {
    weapons.ammo[k] = { mag: 武器Config(k).弹匣, reserve: 武器Config(k).备弹 };
  }
  weapons.current = '步枪';
  weapons.buildViewModel();
  state = STATE.PLAYING;
  aimToggle = false; rightHeld = false; aiming = false;
  prevWeaponName = weapons.current;
  player.sensScale = 1; player.speedScale = 1;
  hud.scope.style.display = 'none';
  hud.crosshair.style.visibility = 'visible';
  weapons.viewGroup.visible = true;
  setCenterMsg('', false);
  restTimer = 2.5;         // 开局给 2.5 秒喘口气
  waveActive = false;

  // 重置撤离
  extractionActive = false;
  holdProgress = 0;
  extraction.close();
  hud.waypoint.style.display = 'none';
  hud.extractStatus.style.display = 'none';
  // 重置 Boss
  if (boss) { boss.remove(); boss = null; }
  bossActive = false;
  hud.bossHud.style.display = 'none';
}

// 避免和 config 的中文名冲突，这里包一层
import { 武器 as 武器Table } from './config.js';
function 武器Config(k) { return 武器Table[k]; }

function startNextWave() {
  wave++;
  // 第 3 波正好是 Boss（这一波没有小丧尸）
  if (wave === BOSS.出现波数) { spawnBoss(); return; }
  // 第 5 波：拿突击步枪的远程 Boss
  if (wave === 步枪Boss.出现波数) { spawnRifleBoss(); return; }
  waveActive = true;
  killsThisWave = 0;
  // 第 4 波 = 沙漠决战：固定一大波
  if (wave === 沙漠.波数) {
    toSpawn = 沙漠.数量;
    spawnTimer = 0;
    playWaveStart();
    flashWaveBanner('☀ 沙漠尸潮 · 来袭！');
    return;
  }
  // 第 6 波 = 军营：会飞的喷气背包僵尸
  if (wave === 军营.波数) {
    toSpawn = 军营.数量;
    spawnTimer = 0;
    playWaveStart();
    flashWaveBanner('🚀 军营 · 飞行尸潮！');
    return;
  }
  // 第 7 波 = 军民要塞（超大图）：僵尸轰炸机(投僵尸) + 友军坦克，清空即最终通关
  if (wave === 要塞.波数) { spawnBombersAndTank(); return; }
  let count = Math.round(波次.第一波数量 + (wave - 1) * 波次.每波增加);
  // 波次曲线：每隔几波来一次小高潮（数量激增）
  const isElite = 波次曲线.启用扩展曲线 && wave % 波次曲线.精英波间隔 === 0;
  if (isElite) count = Math.round(count * 波次曲线.精英波数量倍率);
  toSpawn = count;
  spawnTimer = 0;
  playWaveStart();
  flashWaveBanner(isElite ? `⚠ 第 ${wave} 波 · 尸潮！` : `第 ${wave} 波`);
}

let waveEnemyTotal = 0;
function flashWaveBanner(text) {
  const b = el('wave-banner');
  b.textContent = text;
  b.classList.remove('show');
  void b.offsetWidth;   // 重置动画
  b.classList.add('show');
}

function spawnOne() {
  const pts = activeLevel.spawnPoints;
  let best = pts[0], bestD = -1;
  for (let t = 0; t < 4; t++) {
    const p = pts[(Math.random() * pts.length) | 0];
    const d = p.distanceToSquared(player.pos);
    if (d > bestD) { bestD = d; best = p; }
  }
  const exclude = (wave === 沙漠.波数) ? 沙漠.排除类型 : null;
  const forced = (wave === 军营.波数) ? '飞行' : null;   // 军营波全是会飞的
  const en = new Enemy(scene, best.clone(), wave, forced, exclude, activeLevel.size);
  enemies.push(en);
}

function aliveCount() {
  let n = 0;
  for (const e of enemies) if (!e.dead) n++;
  return n;
}

function updateSkillsHud() {
  const s = abilities.state();
  hud.skZnum.textContent = s.freeze.ammo;
  hud.skZcd.style.height = s.freeze.cd > 0 ? `${(s.freeze.cd / s.freeze.cdMax) * 100}%` : '0%';
  hud.skZ.classList.toggle('ready', s.freeze.cd <= 0 && s.freeze.ammo > 0);
  hud.skXcd.style.height = s.ice.cd > 0 ? `${(s.ice.cd / s.ice.cdMax) * 100}%` : '0%';
  hud.skX.classList.toggle('ready', s.ice.cd <= 0);
  hud.skVcd.style.height = s.shock.cd > 0 ? `${(s.shock.cd / s.shock.cdMax) * 100}%` : '0%';
  hud.skV.classList.toggle('ready', s.shock.cd <= 0);
}

function updateWaves(dt) {
  if (state !== STATE.PLAYING) return;    // 已胜利/死亡：别再覆盖中央提示
  if (bossActive) return;                 // Boss 阶段不再刷波
  if (extractionActive) { updateExtractionPhase(dt); return; }

  if (!waveActive) {
    // 波间休息倒计时
    restTimer -= dt;
    const secs = Math.max(0, Math.ceil(restTimer));
    if (restTimer > 0) {
      setCenterMsg(`<div class="big">下一波 ${secs}s</div><div class="sub">补弹药、找个好位置 — 按 R 换弹</div>`);
    } else {
      setCenterMsg('', false);
      startNextWave();
    }
    return;
  }

  // 出怪
  if (toSpawn > 0 && aliveCount() < 波次.同屏上限) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnOne();
      toSpawn--;
      spawnTimer = 波次.出怪间隔;
    }
  }

  // 本波清完（第七波还要求轰炸机全灭、没有正在落的炸弹）
  if (toSpawn <= 0 && aliveCount() === 0 && bombers.length === 0 && zombieBombs.length === 0) {
    waveActive = false;
    // 第七波（要塞：轰炸机+投下的僵尸）清空 = 最终通关
    if (wave >= 要塞.波数) { onFinalWin(); return; }
    // 第六波（军营飞尸潮）清空 → 撤入军民要塞打第七波
    if (wave === 军营.波数) transitionToFortress();
    score += 分数.过波奖励;
    restTimer = 波次.波间休息;
    flashWaveBanner(
      wave === 沙漠.波数 ? `沙漠尸潮 清空！尖兵将至…`
        : wave === 军营.波数 ? `飞尸潮 清空！撤入军民要塞…`
          : `第 ${wave} 波 完成 +${分数.过波奖励}`
    );
  }
}

/* ============ 撤离阶段 ============ */
function openExtraction() {
  extractionActive = true;
  holdProgress = 0;
  contSpawnTimer = 0;

  // 在远离玩家的角落选一个撤离点（强迫穿越地图）
  const corners = [
    new THREE.Vector3(32, 0, -32),
    new THREE.Vector3(-32, 0, -32),
    new THREE.Vector3(32, 0, 32),
    new THREE.Vector3(-32, 0, 32),
  ];
  let best = corners[0], bestD = -1;
  for (const c of corners) {
    const d = c.distanceToSquared(player.pos);
    if (d > bestD) { bestD = d; best = c; }
  }
  extraction.open(best);

  playWaveStart();
  flashWaveBanner('🚁 撤离点已开启！');
  hud.extractStatus.style.display = 'flex';
  hud.waypoint.style.display = 'flex';
}

function updateExtractionPhase(dt) {
  // 持续出怪，保持压力
  if (aliveCount() < 撤离.持续同屏上限) {
    contSpawnTimer -= dt;
    if (contSpawnTimer <= 0) {
      spawnOne();
      contSpawnTimer = 撤离.持续出怪间隔;
    }
  }

  // 玩家是否在撤离区内
  const flatDist = Math.hypot(player.pos.x - extraction.position.x, player.pos.z - extraction.position.z);
  const inside = flatDist <= 撤离.半径;

  if (inside) {
    holdProgress += dt;
    hud.exBar.style.display = 'block';
    hud.exText.textContent = '⚠ 撤离中… 待在光柱里别出去！';
    hud.exFill.style.width = `${Math.min(100, holdProgress / 撤离.停留时间 * 100)}%`;
    if (holdProgress >= 撤离.停留时间) { onWin(); return; }
  } else {
    if (撤离.离开重置进度) holdProgress = 0;
    hud.exBar.style.display = holdProgress > 0 ? 'block' : 'none';
    hud.exFill.style.width = `${Math.min(100, holdProgress / 撤离.停留时间 * 100)}%`;
    const m = Math.round(flatDist);
    hud.exText.textContent = holdProgress > 0
      ? `进度已保留 · 回到光柱继续撤离（${m}m）`
      : `🚁 撤离点已开启 · 跟着光柱走（${m}m）`;
  }
}

function onWin() {
  state = STATE.WIN;
  extractionActive = false;
  score += 分数.撤离成功;
  stopMusic();
  stopAmbient();
  document.exitPointerLock();
  hud.waypoint.style.display = 'none';
  hud.extractStatus.style.display = 'none';
  setCenterMsg(
    `<div class="big win">✈ 撤离成功！</div>
     <div class="sub">撑过 ${wave} 波 · 击杀 ${kills} · 得分 ${score} (+${分数.撤离成功})</div>
     <div class="restart-btn" id="restart-btn">点击再来一局</div>`
  );
  setTimeout(() => {
    const btn = el('restart-btn');
    if (btn) btn.addEventListener('click', () => {
      startOverlay.querySelector('.start-title').textContent = '丧尸围城';
      canvas.requestPointerLock();
      startFreshGame();
    });
  }, 0);
}

/* ============ 大 Boss ============ */
function spawnBoss() {
  bossActive = true;
  waveActive = false;
  // 清掉残余小僵尸，只留 Boss
  for (const en of enemies) en.remove();
  enemies = [];
  const spawn = new THREE.Vector3(0, 0, -26);
  boss = new Boss(scene, spawn, wave, {
    damagePlayer: (dmg, src) => { if (player.alive) damagePlayer(dmg, clock.elapsedTime, src); },
    knockback: (dx, dz, force, up) => {
      const l = Math.hypot(dx, dz) || 1;
      player.vel.x += (dx / l) * force; player.vel.z += (dz / l) * force;
      player.vel.y += up; player.onGround = false;
    },
    shake: (a) => addShake(a * 手感.屏幕震动),
    aimDisrupt: (amt) => { weapons.recoilPitch += amt; weapons.recoilYaw += (Math.random() - 0.5) * amt; },
    dropSupply: (pos) => pickups.spawn(pos, Math.random() < 0.5 ? 'ammo' : 'health'),
  });
  playWaveStart();
  setCenterMsg('', false);
  flashWaveBanner('⚠ 腐化巨兽 降临！');
  hud.bossName.textContent = '腐化巨兽 · BOSS';
  hud.bossHud.style.display = 'block';
}

// 第五波：拿突击步枪的远程 Boss「沙漠尖兵」
function spawnRifleBoss() {
  bossActive = true;
  waveActive = false;
  for (const en of enemies) en.remove();
  enemies = [];
  const spawn = new THREE.Vector3(0, 0, -24);
  boss = new RifleBoss(scene, spawn, wave, {
    damagePlayer: (dmg, src) => { if (player.alive) damagePlayer(dmg, clock.elapsedTime, src); },
    shake: (a) => addShake(a * 手感.屏幕震动),
    dropSupply: (pos) => pickups.spawn(pos, Math.random() < 0.5 ? 'ammo' : 'health'),
    shoot: () => playShot({ ...武器Config('步枪').音色, 音量: (武器Config('步枪').音色.音量 ?? 0.8) * 0.6 }),
  });
  playWaveStart();
  setCenterMsg('', false);
  flashWaveBanner('⚠ 沙漠尖兵 · 持枪来袭！');
  hud.bossName.textContent = '沙漠尖兵 · BOSS';
  hud.bossHud.style.display = 'block';
}

// 击败 Boss：不再直接通关，而是撤入沙漠打最后一波
function onBossKilled() {
  bossActive = false;
  score += 分数.撤离成功;
  if (boss) { boss.remove(); boss = null; }
  hud.bossHud.style.display = 'none';
  transitionToDesert();
  startNextWave();   // wave 3 → 4：沙漠尸潮
}

/** 切换地图：整组显隐 + 玩家/碰撞/流场/小地图/氛围/相机视距全部改到目标关卡 */
function switchMap(target, biome) {
  for (const lv of allLevels) lv.setActive(lv === target);
  activeLevel = target;
  player.level = target;
  player.pos.copy(target.playerSpawn());
  player.vel.x = player.vel.y = player.vel.z = 0;
  player.onGround = true;
  staticHitList = target.hitMeshes.slice();
  minimap.setLevel(target);
  applyBiome(renderer, scene, biome, quality.params);
  // 大地图拉远相机视距（否则 920m 的要塞看不到对面）
  camera.far = Math.max(400, target.size * 2.3);
  camera.updateProjectionMatrix();
  setCenterMsg('', false);   // 清掉可能残留的"下一波"提示
}
function transitionToDesert() { switchMap(desert, 'desert'); }
function transitionToBarracks() { switchMap(barracks, 'barracks'); }
function transitionToFortress() { switchMap(fortress, 'fortress'); }

// 击败第五波「沙漠尖兵」→ 撤入军营打第六波会飞的僵尸
function onRifleBossKilled() {
  bossActive = false;
  if (boss) { boss.remove(); boss = null; }
  hud.bossHud.style.display = 'none';
  transitionToBarracks();
  startNextWave();   // wave 5 → 6：军营飞尸潮
}

// 最终通关
function onFinalWin() {
  state = STATE.WIN;
  score += 分数.撤离成功 * 2;
  stopMusic(); stopAmbient();
  document.exitPointerLock();
  setCenterMsg(
    `<div class="big win">🏰 要塞不破！你赢了整场战争！</div>
     <div class="sub">通关！巨兽·沙漠尖兵·飞尸潮·军民要塞全清 · 击杀 ${kills} · 得分 ${score}</div>
     <div class="restart-btn" id="restart-btn">点击再来一局</div>`
  );
  setTimeout(() => {
    const btn = el('restart-btn');
    if (btn) btn.addEventListener('click', () => { canvas.requestPointerLock(); startFreshGame(); });
  }, 0);
}

/* ============ 第七波：僵尸轰炸机 + 友军坦克 ============ */
function spawnBombersAndTank() {
  bossActive = false;
  waveActive = true;
  toSpawn = 0;                         // 这一波不走普通刷怪，全靠轰炸机投放
  for (const en of enemies) en.remove(); enemies = [];
  bombers = [];
  for (let i = 0; i < 要塞.轰炸机数; i++) bombers.push(new Bomber(scene, wave, (i / 要塞.轰炸机数) * Math.PI * 2));
  // 友军坦克停在出生点旁
  if (tank) tank.remove();
  tank = new Tank(scene, new THREE.Vector3(8, 0, 16));
  playWaveStart();
  setCenterMsg('', false);
  flashWaveBanner('🏰 军民要塞 · 轰炸机来袭！按 F 上坦克');
}

// 轰炸机投下一只下坠的僵尸
function spawnDroppedZombie(pos) {
  const en = new Enemy(scene, pos.clone(), wave, null, null, activeLevel.size);
  en.root.position.copy(pos);
  en.airborne = true;
  en.vel.set((Math.random() - 0.5) * 2, -1, (Math.random() - 0.5) * 2);
  enemies.push(en);
}

// 僵尸炸弹（带降落伞，慢慢降落）
const _bombMat = new THREE.MeshStandardMaterial({ color: 0x2c2f26, roughness: 0.7, metalness: 0.3 });
const _chuteMat = new THREE.MeshStandardMaterial({ color: 0x5a6b3e, roughness: 0.9, side: THREE.DoubleSide });
const _bombGeo = new THREE.SphereGeometry(0.42, 10, 8);
const _chuteGeo = new THREE.SphereGeometry(1.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);   // 半球伞
function spawnZombieBomb(pos) {
  const g = new THREE.Group();
  const bomb = new THREE.Mesh(_bombGeo, _bombMat); bomb.castShadow = true; g.add(bomb);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 6), _bombMat); fin.position.y = -0.5; fin.rotation.x = Math.PI; g.add(fin);
  const chute = new THREE.Mesh(_chuteGeo, _chuteMat); chute.position.y = 2.2; g.add(chute);
  // 伞绳
  const cordMat = new THREE.LineBasicMaterial({ color: 0x2a2a24 });
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const cg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(Math.cos(a) * 1.3, 2.2, Math.sin(a) * 1.3)]);
    g.add(new THREE.Line(cg, cordMat));
  }
  g.position.copy(pos);
  scene.add(g);
  zombieBombs.push({ root: g, sway: Math.random() * Math.PI * 2 });
}
// 返回 true 表示这颗炸弹处理完了（要移除）
function updateZombieBomb(b, dt, time) {
  const p = b.root.position;
  p.y -= 轰炸机.炸弹降速 * dt;                       // 降落伞慢降
  b.sway += dt * 1.5;
  p.x += Math.sin(b.sway) * 0.3 * dt; p.z += Math.cos(b.sway * 0.8) * 0.3 * dt;
  b.root.rotation.y += dt * 0.6;
  // 砸中坦克：炸掉一点血（在坦克里才算），小爆炸
  if (tank) {
    const dx = p.x - tank.root.position.x, dz = p.z - tank.root.position.z;
    if (Math.hypot(dx, dz) < 3.4 && p.y < 3.2) {
      effects.addExplosion(new THREE.Vector3(p.x, 1.5, p.z), 3.5);
      playExplosion(); addShake(0.4 * 手感.屏幕震动);
      if (inTank) damagePlayer(轰炸机.炸坦克伤害, time, tank.root.position);
      return true;
    }
  }
  // 落地：生成一堆僵尸
  if (p.y <= 0.4) {
    effects.addExplosion(new THREE.Vector3(p.x, 0.3, p.z), 3);
    playExplosion();
    for (let i = 0; i < 轰炸机.每弹僵尸; i++) {
      const a = (i / 轰炸机.每弹僵尸) * Math.PI * 2, r = 1.5 + Math.random() * 2;
      spawnDroppedZombie(new THREE.Vector3(p.x + Math.cos(a) * r, 0.5, p.z + Math.sin(a) * r));
    }
    return true;
  }
  return false;
}

/* ============ 伤害积分召唤支援（打击体/齐射/区域效果） ============ */
function markerRing(pos, color, r) {
  const geo = new THREE.RingGeometry(Math.max(0.5, r * 0.9), r, 44);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(pos.x, 0.06, pos.z);
  scene.add(m);
  const mk = { mesh: m, life: 8 };
  strikeMarkers.push(mk);
  return mk;
}
function spawnStrikeProjectile(kind, pos, speed, marker, cfg, fuse = null) {
  const g = new THREE.Group();
  if (kind === 'nuke') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 10), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.4 })));
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.0, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a })); f.position.y = -0.9; f.rotation.x = Math.PI; g.add(f);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffcc44, toneMapped: false })));
  } else {
    const col = kind === 'freeze' ? 0x8fd8f0 : 0x992222;
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.4, 10), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.5 })));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 10), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4 })); nose.position.y = -0.9; nose.rotation.x = Math.PI; g.add(nose);
  }
  g.position.set(pos.x, 62, pos.z);
  scene.add(g);
  strikeProjectiles.push({ kind, mesh: g, target: pos.clone(), speed, marker, cfg, fuse });
}
function fireStrike(type, pos) {
  const cfg = 支援[type];
  伤害积分 = Math.max(0, 伤害积分 - cfg.花费);
  if (type === '炮兵齐射') {
    const mk = markerRing(pos, 0xffaa33, cfg.散布); mk.life = cfg.时长 + 1;
    for (let i = 0; i < cfg.弹数; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * cfg.散布;
      artilleryShells.push({ land: new THREE.Vector3(pos.x + Math.cos(a) * r, 0, pos.z + Math.sin(a) * r), t: 0.3 + (i / cfg.弹数) * cfg.时长 + Math.random() * 0.3 });
    }
    flashWaveBanner('📡 炮兵齐射 已呼叫！');
  } else if (type === '制导导弹') {
    spawnStrikeProjectile('guided', pos, cfg.降速, markerRing(pos, 0xff3020, cfg.半径), cfg); flashWaveBanner('📡 制导导弹 已呼叫！');
  } else if (type === '核弹') {
    const mk = markerRing(pos, 0xff2200, cfg.半径); mk.life = cfg.倒计时 + 1.5;
    spawnStrikeProjectile('nuke', pos, cfg.降速, mk, cfg, cfg.倒计时); flashWaveBanner('☢ 核弹来袭！10 秒后爆炸，快跑！');
  } else if (type === '冷冻弹药') {
    spawnStrikeProjectile('freeze', pos, cfg.降速, markerRing(pos, 0x8fd8f0, cfg.半径), cfg); flashWaveBanner('❄ 冷冻弹药 已呼叫！');
  }
}
function updateStrikes(dt) {
  // 下落打击体
  let nukeT = Infinity;
  for (let i = strikeProjectiles.length - 1; i >= 0; i--) {
    const s = strikeProjectiles[i];
    s.mesh.position.y -= s.speed * dt;
    let done = false;
    if (s.fuse != null) {                     // 有倒计时(核弹)：慢降+读秒，到点才炸
      s.fuse -= dt;
      if (s.mesh.position.y < 0.7) s.mesh.position.y = 0.7;
      if (s.fuse < nukeT) nukeT = s.fuse;
      if (s.fuse <= 0) done = true;
    } else if (s.mesh.position.y <= 0.5) done = true;
    if (done) {
      detonateStrike(s.kind, s.target, s.cfg);
      scene.remove(s.mesh);
      if (s.marker) s.marker.life = 0;
      strikeProjectiles.splice(i, 1);
    }
  }
  // 核弹倒计时 HUD
  if (nukeT < Infinity) { hud.nukeTimer.style.display = 'block'; hud.nukeTimer.textContent = `☢ 核弹爆炸倒计时 ${Math.ceil(Math.max(0, nukeT))}s · 快跑！`; }
  else if (hud.nukeTimer.style.display !== 'none') hud.nukeTimer.style.display = 'none';
  // 炮兵齐射：逐发落地
  for (let i = artilleryShells.length - 1; i >= 0; i--) {
    const sh = artilleryShells[i]; sh.t -= dt;
    if (sh.t <= 0) {
      const c = 支援.炮兵齐射;
      effects.addExplosion(sh.land, c.单发半径); playExplosion(); addShake(0.18 * 手感.屏幕震动);
      areaDamage(sh.land, c.单发半径, c.单发伤害);
      artilleryShells.splice(i, 1);
    }
  }
  // 预警圈
  for (let i = strikeMarkers.length - 1; i >= 0; i--) {
    const mk = strikeMarkers[i]; mk.life -= dt;
    mk.mesh.material.opacity = 0.35 + 0.35 * Math.abs(Math.sin(mk.life * 8));
    if (mk.life <= 0) { scene.remove(mk.mesh); mk.mesh.geometry.dispose(); mk.mesh.material.dispose(); strikeMarkers.splice(i, 1); }
  }
}
function detonateStrike(kind, pos, cfg) {
  if (kind === 'nuke') {
    effects.addExplosion(pos, cfg.半径 * 0.5); effects.addExplosion(new THREE.Vector3(pos.x, 4, pos.z), cfg.半径 * 0.35);
    playExplosion(); addShake(1.0 * 手感.屏幕震动); flashScreen(0.85);
    killArea(pos, cfg.半径);
  } else if (kind === 'guided') {
    effects.addExplosion(pos, cfg.半径 * 0.4); playExplosion(); addShake(0.7 * 手感.屏幕震动); flashScreen(0.4);
    killArea(pos, cfg.半径);
  } else if (kind === 'freeze') {
    effects.addExplosion(pos, cfg.半径 * 0.3); playExplosion(); addShake(0.4 * 手感.屏幕震动);
    freezeArea(pos, cfg.半径, cfg.冻结时长);
  }
}
function killArea(pos, r) {
  const r2 = r * r;
  for (const en of enemies) {
    if (en.dead) continue;
    if ((en.root.position.x - pos.x) ** 2 + (en.root.position.z - pos.z) ** 2 <= r2) { en.die(effects); kills++; }
  }
  if (boss && !boss.dead && (boss.root.position.x - pos.x) ** 2 + (boss.root.position.z - pos.z) ** 2 <= r2) boss.takeDamage(9e9, false, effects);
  for (const bm of bombers) if (!bm.dead && (bm.root.position.x - pos.x) ** 2 + (bm.root.position.z - pos.z) ** 2 <= r2) bm.takeDamage(9e9, false, effects);
}
function freezeArea(pos, r, dur) {
  const r2 = r * r;
  for (const en of enemies) {
    if (en.dead) continue;
    if ((en.root.position.x - pos.x) ** 2 + (en.root.position.z - pos.z) ** 2 <= r2) en.freeze(dur);
  }
}
function areaDamage(pos, r, dmg) {
  const r2 = r * r;
  for (const en of enemies) {
    if (en.dead) continue;
    if ((en.root.position.x - pos.x) ** 2 + (en.root.position.z - pos.z) ** 2 <= r2) {
      const killed = en.takeDamage(dmg, new THREE.Vector3(0, 0, 1), effects, en.root.position.clone());
      if (killed) onKill(en, false);
    }
  }
}
function clearStrikes() {
  for (const s of strikeProjectiles) scene.remove(s.mesh);
  for (const mk of strikeMarkers) { scene.remove(mk.mesh); mk.mesh.geometry.dispose(); mk.mesh.material.dispose(); }
  strikeProjectiles = []; artilleryShells = []; strikeMarkers = [];
  hud.nukeTimer.style.display = 'none';
}

/* ============ G 召唤支援：键盘选(1-4) + 准星瞄地面召唤（无鼠标也能用） ============ */
const ciEl = el('callin'), ciMenu = el('callin-menu'), ciTarget = el('callin-target'),
  ciCards = el('ci-cards'), ciPoints = el('ci-points');
ciTarget.style.display = 'none';   // 不再用小地图面板
const CI_ORDER = ['炮兵齐射', '制导导弹', '核弹', '冷冻弹药'];
const CI_KEYS = ['①', '②', '③', '④'];
const CI_DESC = { 炮兵齐射: '多发炮弹覆盖目标区', 制导导弹: '30m 内所有生物立即死亡', 核弹: '慢降 · 45m 内立即死亡', 冷冻弹药: '30m 内全部冻住（除你）' };

function openCallIn() {
  if (state !== STATE.PLAYING || callInOpen || aimingStrike) return;
  callInOpen = true;                 // 冻结模拟；指针保持锁定（用键盘选，不用点）
  buildCiCards();
  ciMenu.style.display = ''; ciTarget.style.display = 'none';
  ciEl.classList.add('show');
}
function closeCallIn() { callInOpen = false; ciEl.classList.remove('show'); }
function buildCiCards() {
  ciPoints.textContent = Math.floor(伤害积分);
  ciCards.innerHTML = '';
  CI_ORDER.forEach((type, i) => {
    const cfg = 支援[type], afford = 伤害积分 >= cfg.花费;
    const card = document.createElement('div');
    card.className = 'ci-card' + (afford ? '' : ' disabled');
    const cost = afford ? `<div class="cc">✓ 花费 ${cfg.花费}</div>` : `<div class="cc locked">🔒 还差 ${Math.ceil(cfg.花费 - 伤害积分)}</div>`;
    card.innerHTML = `<div class="ci-key">${CI_KEYS[i]}</div><div class="cn">${cfg.名字}</div><div class="cd">${CI_DESC[type]}</div>${cost}`;
    ciCards.appendChild(card);
  });
}
// 按 1/2/3/4 选支援 → 进入准星瞄准
function pickStrike(i) {
  const type = CI_ORDER[i];
  if (!type) return;
  if (伤害积分 < 支援[type].花费) { flashWaveBanner(`伤害积分不足（还差 ${Math.ceil(支援[type].花费 - 伤害积分)}）`); return; }
  closeCallIn();
  startAiming(type);
}

// 准星瞄地面：地上一个落点圈 + AOE 圈；空格/左键召唤，Esc 取消
let aimRing = null, aimAoe = null;
const _aimWorld = new THREE.Vector3(), _ao = new THREE.Vector3(), _ad = new THREE.Vector3();
function startAiming(type) {
  aimingStrike = true; pendingStrike = type;
  const cfg = 支援[type], r = (type === '炮兵齐射' ? cfg.散布 : cfg.半径);
  const col = type === '冷冻弹药' ? 0x8fd8f0 : (type === '核弹' ? 0xff2200 : 0xff7733);
  if (!aimRing) {
    aimRing = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.2, 24), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    aimRing.rotation.x = -Math.PI / 2; scene.add(aimRing);
    aimAoe = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 56), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    aimAoe.rotation.x = -Math.PI / 2; scene.add(aimAoe);
  }
  aimRing.material.color.setHex(col); aimAoe.material.color.setHex(col);
  aimAoe.scale.setScalar(r);
  aimRing.visible = aimAoe.visible = true;
  hud.tankHint.textContent = `瞄准地面 · 空格/左键 召唤【${cfg.名字}】 · Esc 取消`;
  hud.tankHint.style.display = 'block';
}
function updateAimMarker() {
  camera.getWorldPosition(_ao); camera.getWorldDirection(_ad);
  let t = _ad.y < -0.02 ? (-_ao.y / _ad.y) : 220;
  t = Math.min(Math.max(2, t), 320);
  const b = activeLevel.size - 4;
  _aimWorld.set(Math.max(-b, Math.min(b, _ao.x + _ad.x * t)), 0.07, Math.max(-b, Math.min(b, _ao.z + _ad.z * t)));
  aimRing.position.copy(_aimWorld); aimAoe.position.copy(_aimWorld);
  aimRing.material.opacity = 0.7 + 0.3 * Math.abs(Math.sin(performance.now() * 0.006));
}
function confirmAiming() {
  if (!aimingStrike) return;
  fireStrike(pendingStrike, _aimWorld.clone().setY(0));
  endAiming();
}
function cancelAiming() { if (aimingStrike) { endAiming(); flashWaveBanner('已取消召唤'); } }
function endAiming() {
  aimingStrike = false; pendingStrike = null;
  if (aimRing) aimRing.visible = aimAoe.visible = false;
  hud.tankHint.style.display = 'none';
}

const _tankTmp = new THREE.Vector3();
function tryToggleTank() {
  if (state !== STATE.PLAYING || !tank) { aimToggle = !aimToggle; return; }   // 没坦克时 F 还是开镜
  if (inTank) { exitTank(); return; }
  const d = Math.hypot(player.pos.x - tank.root.position.x, player.pos.z - tank.root.position.z);
  if (d <= 坦克.上车距离) enterTank();
  else aimToggle = !aimToggle;
}
function enterTank() {
  inTank = true;
  weapons.setTrigger(false);
  weapons.viewGroup.visible = false;
  hud.crosshair.classList.add('tank');
}
function exitTank() {
  inTank = false;
  weapons.viewGroup.visible = true;
  hud.crosshair.classList.remove('tank');
  // 下车站到坦克旁边
  player.pos.set(tank.root.position.x + 3.2, player.height, tank.root.position.z);
  player.vel.set(0, 0, 0);
}

// 驾驶坦克：WASD 开车、鼠标瞄准、左键无限开炮、第三人称追尾相机
function updateTank(dt) {
  const t = tank;
  const y = player.yaw, p = player.pitch;
  const lookH = _tankTmp.set(-Math.sin(y), 0, -Math.cos(y));   // 相机水平朝向
  const rightX = -Math.cos(y), rightZ = Math.sin(y);
  const sp = 坦克.移动速度;
  let mx = 0, mz = 0;
  if (player.keys['KeyW']) { mx += lookH.x; mz += lookH.z; }
  if (player.keys['KeyS']) { mx -= lookH.x; mz -= lookH.z; }
  if (player.keys['KeyD']) { mx += rightX; mz += rightZ; }
  if (player.keys['KeyA']) { mx -= rightX; mz -= rightZ; }
  const ml = Math.hypot(mx, mz);
  const pos = t.root.position;
  if (ml > 0.01) {
    mx /= ml; mz /= ml;
    pos.x += mx * sp * dt; pos.z += mz * sp * dt;
    const b = activeLevel.size - 6;
    pos.x = Math.max(-b, Math.min(b, pos.x)); pos.z = Math.max(-b, Math.min(b, pos.z));
    const targetHull = Math.atan2(mx, mz);
    t.root.rotation.y += Math.atan2(Math.sin(targetHull - t.root.rotation.y), Math.cos(targetHull - t.root.rotation.y)) * Math.min(1, dt * 3);
  }
  // 玩家位置跟着坦克走（僵尸会围过来骚扰坦克，但打不掉血）
  player.pos.x = pos.x; player.pos.z = pos.z;
  // 炮塔朝相机水平方向
  t.turret.rotation.y = y - t.root.rotation.y;
  t.update(dt);

  // 第三人称追尾相机
  const camY = pos.y + 5.2;
  camera.position.set(pos.x - lookH.x * 11, camY, pos.z - lookH.z * 11);
  const lookDir = new THREE.Vector3(-Math.sin(y) * Math.cos(p), -Math.sin(p), -Math.cos(y) * Math.cos(p));
  camera.lookAt(pos.x + lookDir.x * 30, pos.y + 2 + lookDir.y * 30, pos.z + lookDir.z * 30);

  // 开炮（无限弹药）
  tankFireCd -= dt;
  if (mouseHeld && tankFireCd <= 0) {
    tankFireCd = 坦克.开火间隔;
    const muzzle = t.muzzleWorld(new THREE.Vector3());
    spawnRocket({ origin: muzzle, dir: lookDir.clone() }, 坦克);
    t.flash();
    addShake(0.35 * 手感.屏幕震动);
    playRocketFire();
  }
}

/* ============ 撤离路标（屏幕方向指示） ============ */
const _wp = new THREE.Vector3();
function updateWaypoint() {
  if (!extraction.active) { hud.waypoint.style.display = 'none'; return; }
  hud.waypoint.style.display = 'flex';

  const W = window.innerWidth, H = window.innerHeight;
  _wp.copy(extraction.position); _wp.y = 3;
  _wp.project(camera);                       // -> NDC (-1..1)，z>1 表示在身后

  const dist = Math.round(player.pos.distanceTo(extraction.position));
  hud.wpDist.textContent = dist;

  const behind = _wp.z > 1;
  let nx = _wp.x, ny = _wp.y;
  if (behind) { nx = -nx; ny = -ny; }        // 身后时翻转，指回正确方向

  const onScreen = !behind && nx > -1 && nx < 1 && ny > -1 && ny < 1;
  if (onScreen) {
    const x = (nx * 0.5 + 0.5) * W;
    const y = (-ny * 0.5 + 0.5) * H;
    hud.waypoint.style.left = `${x}px`;
    hud.waypoint.style.top = `${Math.max(40, y)}px`;
    hud.wpArrow.style.transform = 'rotate(0deg)';   // 在屏内时箭头朝上
    hud.wpArrow.textContent = '◈';
  } else {
    // 屏幕外：贴到边缘并旋转箭头指向它
    const margin = 0.86;
    const len = Math.max(Math.abs(nx), Math.abs(ny)) || 1;
    const cx = (nx / len) * margin;
    const cy = (ny / len) * margin;
    const x = (cx * 0.5 + 0.5) * W;
    const y = (-cy * 0.5 + 0.5) * H;
    hud.waypoint.style.left = `${x}px`;
    hud.waypoint.style.top = `${y}px`;
    const ang = Math.atan2(-cy, cx) * 180 / Math.PI + 90;  // ▲ 默认朝上
    hud.wpArrow.textContent = '▲';
    hud.wpArrow.style.transform = `rotate(${ang}deg)`;
  }
}

/* ============ 火箭筒 ============ */
function addShake(a) { shakeAmount = Math.min(0.9, shakeAmount + a); }
const _flashEl = el('screen-flash');
function flashScreen(i) { _flashEl.style.transition = 'none'; _flashEl.style.opacity = String(i); requestAnimationFrame(() => { _flashEl.style.transition = 'opacity .55s ease-out'; _flashEl.style.opacity = '0'; }); }

function spawnRocket(shot, cfgOverride) {
  // 用当前武器的配置（火箭筒 / 追踪导弹各自的弹速/追踪/爆炸）；坦克炮传 cfgOverride
  const cfg = cfgOverride || ((weapons.cfg && weapons.cfg.是火箭) ? weapons.cfg : 武器Config('火箭筒'));
  const r = new Rocket(scene, shot.origin, shot.dir, cfg, staticHitList);
  rockets.push(r);
}

function explode(center, direct, time, cfg = 武器Config('火箭筒')) {
  effects.addExplosion(center, cfg.爆炸半径);
  playExplosion();
  if (音效氛围.开火压低环境) duckEnv(0.7, 0.4);
  addShake(0.5 * 手感.屏幕震动);

  // 对所有敌人施加冲击波
  for (const en of enemies) {
    const bonus = (en === direct) ? cfg.直接伤害 : 0;
    const r = en.applyBlast(center, cfg.爆炸半径, cfg.爆炸伤害, cfg.冲击力, effects, bonus);
    if (r) earnDamage(cfg.爆炸伤害 * 0.6 + bonus);
    if (r && r.killed) onKill(en, false);
  }
  // 对空中的僵尸轰炸机施加爆炸伤害（3D 距离）
  for (const bm of bombers) {
    if (bm.dead) continue;
    const d = bm.root.position.distanceTo(center);
    const R = cfg.爆炸半径 + 2;
    if (d < R) { const bd = (bm === direct ? cfg.直接伤害 : 0) + cfg.爆炸伤害 * Math.max(0.25, 1 - d / R); bm.takeDamage(bd, false, effects); earnDamage(bd); }
  }

  // 自己在范围内：受伤 + 被弹开（可以玩火箭跳）
  const pd = player.pos.distanceTo(center);
  if (pd < cfg.爆炸半径) {
    const f = 1 - pd / cfg.爆炸半径;
    let ax = player.pos.x - center.x, az = player.pos.z - center.z;
    const al = Math.hypot(ax, az) || 1;
    player.vel.x += (ax / al) * cfg.冲击力 * f * 0.55;
    player.vel.z += (az / al) * cfg.冲击力 * f * 0.55;
    player.vel.y += 6 * f + 3;
    player.onGround = false;
    damagePlayer(cfg.爆炸伤害 * cfg.自伤比例 * f, time);
  }
}

/* ============ 开火命中处理 ============ */
const _origin = new THREE.Vector3();
function processShot(shot) {
  camera.getWorldPosition(_origin);

  // 收集敌人可命中网格
  const targets = staticHitList.slice();
  for (const en of enemies) {
    if (en.dead) continue;
    targets.push(en.head, en.torso, en.legL, en.legR, en.armL, en.armR);
  }
  if (boss && !boss.dead) targets.push(...boss.hitMeshes);
  for (const bm of bombers) if (!bm.dead) targets.push(...bm.hitMeshes);

  for (const dir of shot.rays) {
    raycaster.set(_origin, dir);
    raycaster.far = shot.range;
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) {
      // 打空：画一条飞向远方的曳光弹（近战不画曳光）
      if (!shot.melee) {
        const end = _origin.clone().addScaledVector(dir, shot.range);
        effects.addTracer(muzzlePos(), end);
      }
      continue;
    }
    const hit = hits[0];
    if (!shot.melee) effects.addTracer(muzzlePos(), hit.point);

    const bmb = hit.object.userData.bomber;
    if (bmb && !bmb.dead) {
      const dmg = shot.damage;
      bmb.takeDamage(dmg, false, effects); earnDamage(dmg);
      effects.addSparks(hit.point, dir.clone().negate(), 6, 0xffcc66);
      shot.onHit(false); showHitmarker(false);
      if (手感.显示伤害数字) effects.addFloatingNumber(hit.point, String(Math.round(dmg)), 'hit');
      continue;
    }

    const bo = hit.object.userData.boss;
    if (bo && !bo.dead) {
      const isHead = hit.object === bo.head;
      const dmg = shot.damage * (isHead ? shot.headMul : 1);
      bo.takeDamage(dmg, isHead, effects); earnDamage(dmg * (isHead ? bo.headMul : 1));
      effects.addSparks(hit.point, dir.clone().negate(), isHead ? 10 : 6, isHead ? 0xff6644 : 0x88aa44);
      shot.onHit(isHead);
      showHitmarker(isHead);
      if (手感.显示伤害数字) {
        effects.addFloatingNumber(hit.point, String(Math.round(dmg * (isHead ? bo.headMul : 1))), isHead ? 'headshot' : 'hit');
      }
      continue;
    }

    const en = hit.object.userData.enemy;
    if (en && !en.dead) {
      const isHead = hit.object === en.head;
      const dmg = shot.damage * (isHead ? shot.headMul : 1);
      const fromDir = dir.clone(); fromDir.y = 0; fromDir.normalize();
      const killed = en.takeDamage(dmg, fromDir, effects, hit.point); earnDamage(dmg);
      effects.addBloodSpray(hit.point, dir, isHead ? 12 : 7);   // 被打中喷血（沿子弹方向）
      effects.addSparks(hit.point, dir.clone().negate(), isHead ? 4 : 2, isHead ? 0xff6644 : 0xaa3322);
      shot.onHit(isHead);
      showHitmarker(isHead);
      if (手感.显示伤害数字) {
        effects.addFloatingNumber(hit.point, String(Math.round(dmg)), isHead ? 'headshot' : 'hit');
      }
      if (killed) onKill(en, isHead);
    } else {
      // 环境命中
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
      if (shot.melee) {
        // 近战砍到墙/地：只溅一点火花，不留弹孔
        effects.addSparks(hit.point, n, 3, 0xcfd6de);
      } else {
        effects.addBulletHole(hit.point, n);
        effects.addSparks(hit.point, n, 4, 0xffcc66);
      }
    }
  }
}

function muzzlePos() {
  // 枪口世界坐标（大致）
  const p = new THREE.Vector3();
  camera.getWorldPosition(p);
  const d = new THREE.Vector3();
  camera.getWorldDirection(d);
  const r = new THREE.Vector3().crossVectors(d, camera.up).normalize();
  return p.addScaledVector(d, 0.5).addScaledVector(r, 0.14).add(new THREE.Vector3(0, -0.12, 0));
}

function onKill(en, isHead) {
  kills++;
  killsThisWave++;
  let gained = 分数.击杀;
  if (isHead) gained += 分数.爆头额外;
  score += gained;
  effects.addFloatingNumber(
    en.root.position.clone().setY(1.8),
    isHead ? `爆头 +${gained}` : `+${gained}`,
    isHead ? 'headshot' : 'kill'
  );
  // 击杀顿帧（微时停），爆头更久一点
  if (打击感.受击顿帧) hitstopTimer = Math.max(hitstopTimer, (打击感.顿帧毫秒 / 1000) * (isHead ? 1.5 : 1));
  // 掉落弹药/医疗包（肉盾/爆炸尸算精英，掉率更高）
  pickups.dropFrom(en.root.position, en.type === '肉盾' || en.type === '爆炸');
}

/* ============ 永久尸体 + 地面血迹 ============ */
const _bloodMat = new THREE.MeshBasicMaterial({ color: 0x5c0d0a, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide });
// 一块不规则的溅血（边缘半径随机 + 偶尔拖出长血滴），贴在 XZ 平面
function bloodBlob(cx, cz, r) {
  const seg = 18;
  const rad = [];
  for (let i = 0; i < seg; i++) rad.push(r * (0.55 + Math.random() * 0.7));
  for (let i = 0; i < seg; i++) if (Math.random() < 0.14) rad[i] *= 1.6 + Math.random() * 1.2;   // 偶尔一道拖出的血滴
  // 平滑一遍，避免变成锯齿星形
  const sm = rad.map((v, i) => (rad[(i - 1 + seg) % seg] + v * 2 + rad[(i + 1) % seg]) / 4);
  const pos = [cx, 0, cz];
  for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pos.push(cx + Math.cos(a) * sm[i], 0, cz + Math.sin(a) * sm[i]); }
  const idx = [];
  for (let i = 0; i < seg; i++) idx.push(0, 1 + i, 1 + ((i + 1) % seg));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
function makeBloodDecal(pos, radius) {
  // 主血泊 + 几块小溅斑 + 几滴远处血点，全合成一个几何（1 draw call），整体不规则
  const geos = [];
  const R = radius * (1.0 + Math.random() * 0.4);
  geos.push(bloodBlob(0, 0, R));
  for (let k = 0; k < 3; k++) {
    const a = Math.random() * Math.PI * 2, d = R * (0.5 + Math.random() * 0.7);
    geos.push(bloodBlob(Math.cos(a) * d, Math.sin(a) * d, R * (0.3 + Math.random() * 0.35)));
  }
  for (let k = 0; k < 4; k++) {   // 甩出去的小血滴
    const a = Math.random() * Math.PI * 2, d = R * (1.1 + Math.random() * 1.2);
    geos.push(bloodBlob(Math.cos(a) * d, Math.sin(a) * d, R * (0.08 + Math.random() * 0.14)));
  }
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  const m = new THREE.Mesh(merged, _bloodMat);
  m.position.set(pos.x, 0.02 + Math.random() * 0.01, pos.z);   // 贴地、微抬避免 z-fighting
  m.rotation.y = Math.random() * Math.PI * 2;
  m.renderOrder = 1;
  return m;
}

function addCorpse(en) {
  const baked = en.bakeCorpse();
  if (!baked) return;
  const blood = makeBloodDecal(baked.pos, baked.radius);
  const root = activeLevel.root;              // 挂在当前地图分组下：切图自动隐藏，不串图
  root.add(baked.mesh);
  root.add(blood);
  corpses.push({ mesh: baked.mesh, blood, root });
  // 超过上限：清理最旧的（连同血迹）
  while (corpses.length > 尸体上限) {
    const old = corpses.shift();
    old.root.remove(old.mesh); old.root.remove(old.blood);
    old.mesh.geometry.dispose(); old.mesh.material.dispose();
    old.blood.geometry.dispose();
  }
}

function clearCorpses() {
  for (const c of corpses) {
    c.root.remove(c.mesh); c.root.remove(c.blood);
    c.mesh.geometry.dispose(); c.mesh.material.dispose();
    c.blood.geometry.dispose();
  }
  corpses.length = 0;
}

/* ============ 命中标记 ============ */
let hitmarkerTimer = 0;
function showHitmarker(isHead) {
  hud.hitmarker.classList.toggle('head', isHead);
  hud.hitmarker.style.opacity = '1';
  hitmarkerTimer = 0.12;
}

/* ============ 玩家受伤 ============ */
let damageFlashTimer = 0;
function damagePlayer(dmg, time, srcPos) {
  player.takeDamage(dmg, time);
  playPlayerHurt();
  damageFlashTimer = 0.4;
  // 被咬抖屏（强度随伤害）
  if (打击感.镜头抖动) addShake(Math.min(0.35, 0.06 + dmg * 0.006) * 打击感.抖动强度);
  if (srcPos) showHitDirection(srcPos);
  if (!player.alive) onPlayerDeath();
}

/* ============ 受击方向指示器 ============ */
const hitDirs = [];
function showHitDirection(srcPos) {
  if (!受击指示.启用) return;
  // 伤害来源相对玩家朝向的角度（0=正前方，顺时针）
  const dx = srcPos.x - player.pos.x, dz = srcPos.z - player.pos.z;
  const world = Math.atan2(dx, dz);          // 与 player.yaw 同一约定
  const rel = world - (player.yaw + Math.PI);
  const el = document.createElement('div');
  el.className = 'hitdir';
  el.style.transform = `rotate(${-rel}rad)`;
  hud.hitDirs.appendChild(el);
  hitDirs.push({ el, life: 受击指示.持续时间, max: 受击指示.持续时间 });
}

function updateHitDirs(dt) {
  for (let i = hitDirs.length - 1; i >= 0; i--) {
    const h = hitDirs[i];
    h.life -= dt;
    if (h.life <= 0) { h.el.remove(); hitDirs.splice(i, 1); continue; }
    h.el.style.opacity = String(Math.min(1, h.life / h.max * 1.6));
  }
}

/* ============ 拾取提示 ============ */
let toastTimer = 0;
function showToast(text) {
  hud.pickupToast.textContent = text;
  toastTimer = 1.5;
}

function onPlayerDeath() {
  state = STATE.DEAD;
  stopMusic();                 // 死了就停音乐
  stopAmbient();
  hud.waypoint.style.display = 'none';
  hud.extractStatus.style.display = 'none';
  document.exitPointerLock();
  setCenterMsg(
    `<div class="big dead">你被感染了</div>
     <div class="sub">坚持到第 ${wave} 波 · 击杀 ${kills} · 得分 ${score}</div>
     <div class="restart-btn" id="restart-btn">点击重新开始</div>`
  );
  setTimeout(() => {
    const btn = el('restart-btn');
    if (btn) btn.addEventListener('click', () => {
      startOverlay.querySelector('.start-title').textContent = '丧尸围城';
      canvas.requestPointerLock();
      startFreshGame();
    });
  }, 0);
}

/* ============ 主循环 ============ */
const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const time = clock.elapsedTime;

  renderer.info.reset();   // 每帧手动清零，之后累加本帧所有 pass 的 draw call
  statsPanel.begin();
  quality.sample(dt);   // 前两秒自动测帧率、必要时降档

  if (state === STATE.PLAYING && !callInOpen) {
    // 换枪时自动收镜
    if (weapons.current !== prevWeaponName) { aimToggle = false; prevWeaponName = weapons.current; }

    // 瞄准状态（F 切换 或 右键按住）；坦克里不开镜
    aiming = (aimToggle || rightHeld) && !inTank;
    const scoped = aiming && !!weapons.cfg.是狙击;

    // 瞄准镜 / 准星 / 枪模型 显隐
    hud.scope.style.display = scoped ? 'block' : 'none';
    hud.crosshair.style.visibility = scoped ? 'hidden' : 'visible';
    weapons.viewGroup.visible = !scoped && !inTank;

    // 命中顿帧：微时停，让打击更有分量（只减慢模拟，不影响镜头灵敏度）
    const simDt = hitstopTimer > 0 ? dt * 0.06 : dt;
    hitstopTimer = Math.max(0, hitstopTimer - dt);

    // 后坐力叠加到视角（可在 gameplay 配置里关）
    player.extraPitch = 打击感.后坐力镜头 ? weapons.recoilPitch : 0;
    player.extraYaw = 打击感.后坐力镜头 ? weapons.recoilYaw : 0;

    // 背景音乐强度：交战/撤离时高，休息时低沉
    if (extractionActive) {
      setIntensity(0.85);
    } else if (waveActive) {
      const pressure = Math.min(1, (aliveCount() + toSpawn) / 12);
      setIntensity(0.35 + pressure * 0.65);
    } else {
      setIntensity(0.08);
    }

    // 开镜改 FOV（狙击枪用自己的高倍率视野）
    const adsFov = weapons.cfg.开镜视野 ?? 手感.开镜视野;
    const targetFov = aiming ? adsFov : 手感.视野角度;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
    // 放大越多，鼠标越慢（好瞄）；开镜走得更慢
    player.sensScale = camera.fov / 手感.视野角度;
    player.speedScale = scoped ? (weapons.cfg.开镜移速倍率 ?? 0.5) : 1;

    if (inTank) updateTank(simDt);
    else player.update(simDt, time);

    // 屏幕震动（在相机定位之后叠加抖动）
    if (shakeAmount > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shakeAmount;
      camera.position.y += (Math.random() - 0.5) * shakeAmount;
      camera.position.z += (Math.random() - 0.5) * shakeAmount * 0.5;
      shakeAmount *= Math.max(0, 1 - dt * 7);
    }

    const moving = (Math.abs(player.vel.x) + Math.abs(player.vel.z)) > 0.6;
    const yawDelta = player.yaw - _lastGunYaw; _lastGunYaw = player.yaw;
    const shot = inTank ? null : weapons.update(simDt, moving, aiming, yawDelta);
    if (shot) {
      if (shot.rocket) spawnRocket(shot);
      else processShot(shot);
      // 枪口火光：从对象池借一盏暖光照亮周围
      dynamicLights.muzzleFlash(muzzlePos());
      // 开火压低环境音（ducking）
      if (音效氛围.开火压低环境) duckEnv(0.5, 0.22);
      // 开火轻微抖屏（火箭的抖动在爆炸时另算）
      if (打击感.镜头抖动 && !shot.rocket) addShake(0.014 * (weapons.cfg.后坐力 || 2) * 打击感.抖动强度);
    }

    // 火箭飞行 + 爆炸
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      const res = r.update(simDt, enemies, bombers);
      if (res && res.explode) {
        explode(res.point, res.direct, time, r.cfg);
        r.remove();
        rockets.splice(i, 1);
      }
    }

    // 流场寻路：每帧从玩家位置铺一次距离场，所有僵尸共用。
    // 玩家在高台上时，把流场目标改成台阶入口，僵尸先去爬楼而不是堆在台下。
    if (enemies.length && activeLevel.flow) {
      let gx = player.pos.x, gz = player.pos.z;
      const playerFoot = player.pos.y - player.height;
      if (playerFoot > 1.0 && activeLevel.stairEntrance) { gx = activeLevel.stairEntrance.x; gz = activeLevel.stairEntrance.z; }
      activeLevel.flow.compute(gx, gz);
    }

    // 敌人
    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      // 自爆尸死亡范围伤害（死亡瞬间触发一次）
      if (en.dead && en.selfDestruct && !en._blasted) {
        en._blasted = true;
        const p = en.root.position;
        effects.addExplosion(p, en.blastRange);
        playExplosion();
        if (打击感.镜头抖动) addShake(0.3 * 打击感.抖动强度);
        const pd = player.pos.distanceTo(p);
        if (pd < en.blastRange && player.alive) damagePlayer(en.blastDmg * (1 - pd / en.blastRange), time, p);
      }
      const res = en.update(simDt, player.pos, activeLevel, enemies, i);
      if (res === false) { addCorpse(en); en.remove(); enemies.splice(i, 1); continue; }
      // 在坦克里普通僵尸打不掉血（僵尸只是骚扰）
      if (res && res.didAttack > 0 && !inTank) damagePlayer(res.didAttack, time, en.root.position);
      en.faceBar(camera);
    }

    // 大 Boss
    if (boss) {
      if (boss.dead) { if (boss.kind === 'rifle') onRifleBossKilled(); else onBossKilled(); }
      else {
        boss.update(simDt, player.pos, effects);
        hud.bossFill.style.width = `${(boss.hp / boss.maxHp) * 100}%`;
      }
    }

    // 僵尸轰炸机（投僵尸）+ 友军坦克
    for (let i = bombers.length - 1; i >= 0; i--) {
      const bm = bombers[i];
      if (bm.dead) { bm.remove(); bombers.splice(i, 1); continue; }
      const res = bm.update(simDt, player.pos);
      if (res && res.drop) spawnZombieBomb(res.drop);
    }
    // 僵尸炸弹（降落伞慢降；落地生成一堆僵尸，砸中坦克炸掉点血）
    for (let i = zombieBombs.length - 1; i >= 0; i--) {
      if (updateZombieBomb(zombieBombs[i], simDt, time)) { zombieBombs[i].root.parent && scene.remove(zombieBombs[i].root); zombieBombs.splice(i, 1); }
    }
    if (tank && !inTank) tank.update(dt);
    // 友军坦克提示（瞄准支援时不抢占提示条）
    if (tank && !aimingStrike) {
      if (inTank) { hud.tankHint.textContent = 'F 下坦克 · 左键开炮（弹药无限）'; hud.tankHint.style.display = 'block'; }
      else {
        const near = Math.hypot(player.pos.x - tank.root.position.x, player.pos.z - tank.root.position.z) <= 坦克.上车距离;
        hud.tankHint.textContent = '按 F 上坦克';
        hud.tankHint.style.display = near ? 'block' : 'none';
      }
    } else if (hud.tankHint.style.display !== 'none') hud.tankHint.style.display = 'none';

    // 技能（冰冻）：更新特效/冷却 + HUD
    abilities.update(simDt, enemies, player);
    updateSkillsHud();
    updateStrikes(simDt);
    if (aimingStrike) updateAimMarker();
    hud.dmgPoints.textContent = Math.floor(伤害积分);

    // 掉落拾取
    const got = pickups.update(dt, player.pos);
    if (got) {
      playPickup(got.kind);
      if (got.kind === 'ammo') {
        const a = weapons.ammo[weapons.current];
        const cap = (weapons.cfg.备弹 || 90) * 1.5;
        a.reserve = Math.min(cap, a.reserve + 掉落.弹药数量);
        showToast(`+${掉落.弹药数量} 弹药`);
      } else {
        player.hp = Math.min(player.maxHp, player.hp + 掉落.医疗数量);
        showToast(`+${掉落.医疗数量} 生命`);
      }
    }

    // 自动回血
    if (player.alive && time - player.lastDamageTime > PLAYER.自动回血延迟 && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + PLAYER.自动回血速度 * dt);
    }

    updateWaves(dt);
    // 超大地图：太阳(阴影相机)跟随玩家，保证脚下始终有阴影
    if (activeLevel.sunOffset && activeLevel.sun) {
      const t = activeLevel.sun.target, o = activeLevel.sunOffset;
      t.position.set(player.pos.x, 0, player.pos.z); t.updateMatrixWorld();
      activeLevel.sun.position.set(player.pos.x + o.x, o.y, player.pos.z + o.z);
    }
    extraction.update(dt);
    updateWaypoint();
    dynamicLights.update(dt);
    eyeField.update(enemies);
    effects.update(dt);
    updateHitDirs(dt);
    minimap.update(player, enemies, pickups.active, extraction);
    updateHUD(dt);
  }

  postfx.render(dt);   // 内部：开后处理走 composer，否则直接 renderer.render
  statsPanel.end(renderer, { tier: quality.tierName, enemies: enemies.length });
}

/* ============ HUD 刷新 ============ */
function updateHUD(dt) {
  const hpRatio = player.hp / player.maxHp;
  hud.hp.style.width = `${hpRatio * 100}%`;
  hud.hp.style.background = hpRatio > 0.5 ? '#4caf50' : hpRatio > 0.25 ? '#ffb300' : '#f4433a';
  hud.hpText.textContent = Math.ceil(player.hp);

  hud.ammo.textContent = weapons.ammoText();
  hud.weaponName.textContent = weapons.cfg.名字 + (weapons.reloading ? ' · 换弹中…' : '');
  hud.wave.textContent = wave;
  hud.score.textContent = score;
  hud.kills.textContent = kills;
  hud.enemiesLeft.textContent = extractionActive ? aliveCount() : (waveActive ? (aliveCount() + toSpawn) : 0);

  // 准星扩散（命中时整体弹一下变亮）
  const spread = weapons.currentSpread() + weapons.recoilPitch * 60;
  const size = 准星.基础大小 + Math.min(准星.最大扩散, spread * 3);
  hud.crosshair.style.setProperty('--gap', `${size}px`);
  const pop = 打击感.准星命中反馈 && hitmarkerTimer > 0 ? (hitmarkerTimer / 0.12) : 0;
  hud.crosshair.style.transform = `translate(-50%,-50%) scale(${1 + pop * 0.5})`;
  hud.crosshair.style.filter = pop > 0 ? `brightness(${1 + pop * 1.5})` : '';

  // 命中标记淡出
  if (hitmarkerTimer > 0) {
    hitmarkerTimer -= dt;
    hud.hitmarker.style.opacity = String(Math.max(0, hitmarkerTimer / 0.12));
  }

  // 拾取提示淡出
  if (toastTimer > 0) {
    toastTimer -= dt;
    hud.pickupToast.style.opacity = String(Math.min(1, toastTimer / 0.5));
    hud.pickupToast.style.transform = `translateX(-50%) translateY(${-(1.5 - toastTimer) * 14}px)`;
  }

  // 低血量心跳（音效 + 画面脉动）
  const hp01 = player.hp / player.maxHp;
  let pulse = 0;
  if (打击感.低血心跳 && player.alive && hp01 < 打击感.低血阈值) {
    const severity = 1 - hp01 / 打击感.低血阈值;         // 越低越强
    heartbeatTimer -= dt;
    if (heartbeatTimer <= 0) { playHeartbeat(); heartbeatTimer = 1.15 - severity * 0.5; }
    pulse = (0.5 + 0.5 * Math.sin(clock.elapsedTime * 6)) * severity * 0.5;
  }

  // 受伤红晕（被打闪红 + 低血常驻/脉动，取较大值）
  let vig = pulse;
  if (打击感.受伤血迹 && damageFlashTimer > 0) {
    damageFlashTimer -= dt;
    vig = Math.max(vig, Math.min(0.85, damageFlashTimer * 2));
  } else if (hp01 < 0.3) {
    vig = Math.max(vig, (0.3 - hp01) * 2);
  }
  hud.damageVignette.style.opacity = String(vig);
}

/* ============ 暂停 / 设置菜单接线（阶段7） ============ */
function setupPauseMenu() {
  const $ = (id) => document.getElementById(id);

  $('pm-resume').addEventListener('click', () => canvas.requestPointerLock());
  $('pm-restart').addEventListener('click', () => { startFreshGame(); canvas.requestPointerLock(); });
  $('pm-settings-btn').addEventListener('click', () => {
    const sp = $('settings-panel');
    sp.style.display = sp.style.display === 'none' ? '' : 'none';
  });

  // 画质档位分段按钮
  const tierBtns = $('set-tier').querySelectorAll('button');
  const refreshTier = () => tierBtns.forEach((b) => b.classList.toggle('active', b.dataset.tier === quality.tierName));
  tierBtns.forEach((b) => b.addEventListener('click', () => { quality.setTier(b.dataset.tier); refreshTier(); }));
  refreshTier();

  // 音量滑块
  const bind = (id, valId, fmt, apply) => {
    const inp = $(id), lab = $(valId);
    const on = () => { const v = +inp.value; if (lab) lab.textContent = fmt(v); apply(v); };
    inp.addEventListener('input', on);
    return inp;
  };
  const master = bind('set-master', 'set-master-v', (v) => v, (v) => { 声音.总音量 = v / 100; setMasterVolume(v / 100); });
  const music = bind('set-music', 'set-music-v', (v) => v, (v) => { 声音.音乐音量 = v / 100; setMusicVolume(v / 100); });
  const ambient = bind('set-ambient', 'set-ambient-v', (v) => v, (v) => setAmbientVolume(v / 100));
  const sens = bind('set-sens', 'set-sens-v', (v) => (v / 100).toFixed(2), (v) => { 手感.鼠标灵敏度 = v / 100; });
  // 用当前配置初始化滑块
  master.value = Math.round((声音.总音量 ?? 0.5) * 100); $('set-master-v').textContent = master.value;
  music.value = Math.round((声音.音乐音量 ?? 0.45) * 100); $('set-music-v').textContent = music.value;
  ambient.value = 16; $('set-ambient-v').textContent = 16;
  sens.value = Math.round((手感.鼠标灵敏度 ?? 1) * 100); $('set-sens-v').textContent = (手感.鼠标灵敏度 ?? 1).toFixed(2);

  // 画面效果开关
  const chk = (id, fn) => { const c = $(id); c.addEventListener('change', () => fn(c.checked)); };
  chk('fx-post', (on) => { GFX.后处理 = on; postfx.rebuild(quality.params); });
  chk('fx-bloom', (on) => { GFX.泛光 = on; postfx.rebuild(quality.params); });
  chk('fx-vignette', (on) => { GFX.暗角 = on; postfx.rebuild(quality.params); });
  chk('fx-ao', (on) => { GFX.环境光遮蔽 = on; postfx.rebuild(quality.params); });
  chk('fx-headlight', (on) => { GFX.玩家头灯 = on; dynamicLights.setHeadlight(on); });
  chk('fx-eyes', (on) => { GFX.丧尸红眼 = on; });
  chk('fx-stats', (on) => statsPanel.setVisible(on));
  // 初始化勾选状态
  $('fx-post').checked = GFX.后处理; $('fx-bloom').checked = GFX.泛光; $('fx-vignette').checked = GFX.暗角;
  $('fx-ao').checked = GFX.环境光遮蔽; $('fx-headlight').checked = GFX.玩家头灯; $('fx-eyes').checked = GFX.丧尸红眼;
  $('fx-stats').checked = GFX.显示性能面板;
}
setupPauseMenu();

/* ============ 启动 ============ */
setCenterMsg('', false);
frame();

// 开发调试入口（方便截图/自测，不影响正常游玩）
window.__game = {
  get state() { return state; },
  get player() { return player; },
  get enemies() { return enemies; },
  get score() { return score; },
  get wave() { return wave; },
  forceStart() { startFreshGame(); startOverlay.style.display = 'none'; },
  get extractionActive() { return extractionActive; },
  get holdProgress() { return holdProgress; },
  get extraction() { return extraction; },
  // 测试：直接开启撤离阶段
  forceExtraction() { wave = 撤离.开启波数; openExtraction(); return extraction.position.toArray(); },
  // 测试：直接召唤 Boss
  forceBoss() { wave = Math.max(wave, BOSS.出现波数); spawnBoss(); return { hp: boss.hp, maxHp: boss.maxHp }; },
  get boss() { return boss ? { kind: boss.kind, hp: boss.hp, maxHp: boss.maxHp, dead: boss.dead, pos: boss.root.position.toArray(), state: boss.state ?? null } : null; },
  bossTakeDamage(dmg, head = false) { if (boss) { const d = boss.takeDamage(dmg, head, effects); return { hp: boss.hp, killed: d }; } return null; },
  // 测试：直接撤入沙漠打第四波
  forceDesert() { wave = BOSS.出现波数; if (boss) { boss.remove(); boss = null; } bossActive = false; onBossKilled(); return { biome: scene._biome, activeIsDesert: activeLevel === desert, toSpawn, spawns: activeLevel.spawnPoints.length }; },
  // 测试：直接在沙漠召唤第五波持枪 Boss
  forceRifleBoss() { if (activeLevel !== desert) transitionToDesert(); wave = 步枪Boss.出现波数; if (boss) { boss.remove(); boss = null; } spawnRifleBoss(); return { kind: boss.kind, hp: boss.hp, maxHp: boss.maxHp, name: hud.bossName.textContent }; },
  // 测试：直接撤入军营打第六波会飞的僵尸
  forceBarracks() { if (boss) { boss.remove(); boss = null; } bossActive = false; wave = 步枪Boss.出现波数; transitionToBarracks(); startNextWave(); return { biome: scene._biome, wave, toSpawn, spawns: activeLevel.spawnPoints.length }; },
  // 测试：直接撤入军民要塞打第七波（超大图）
  forceFortress() { if (boss) { boss.remove(); boss = null; } bossActive = false; wave = 军营.波数; transitionToFortress(); startNextWave(); return { biome: scene._biome, wave, size: activeLevel.size, far: camera.far, bombers: bombers.length, tank: !!tank }; },
  get bomberCount() { return bombers.length; },
  get zombieBombCount() { return zombieBombs.length; },
  get damagePoints() { return Math.floor(伤害积分); },
  grantPoints(n) { 伤害积分 += n; return 伤害积分; },
  fireStrikeAt(type, x, z) { fireStrike(type, new THREE.Vector3(x, 0, z)); return { proj: strikeProjectiles.length, shells: artilleryShells.length, points: Math.floor(伤害积分) }; },
  detonateNow(kind, x, z) { const map = { 制导导弹: 'guided', 核弹: 'nuke', 冷冻弹药: 'freeze' }; detonateStrike(map[kind], new THREE.Vector3(x, 0, z), 支援[kind]); return true; },
  spawnTestBomb(x, z, y) { spawnZombieBomb(new THREE.Vector3(x, y ?? 17, z)); return zombieBombs.length; },
  skillState() { return abilities.state(); },
  useFreeze() { return abilities.useFreeze(enemies); },
  useIce() { return abilities.useIce(player); },
  useShock() { return abilities.useShock(player); },
  get frozenCount() { return enemies.filter((e) => e.frozen).length; },
  get icePatches() { return abilities.patches.length; },
  get inTank() { return inTank; },
  get tankPos() { return tank ? tank.root.position.toArray().map(n => +n.toFixed(1)) : null; },
  board() { if (!tank) return false; player.pos.set(tank.root.position.x + 1, player.height, tank.root.position.z); tryToggleTank(); return inTank; },
  tankFire() { mouseHeld = true; return true; },
  tankFireStop() { mouseHeld = false; return true; },
  bomberDamageAll(d) { for (const b of bombers) b.takeDamage(d, false, effects); return bombers.filter(b => !b.dead).length; },
  get biome() { return scene._biome; },
  // 测试：把玩家瞬移到撤离点内并推进停留判定
  tickExtraction(dt) { updateExtractionPhase(dt); return { holdProgress, state, extractionActive }; },
  setPlayerPos(x, z) { player.pos.x = x; player.pos.z = z; },
  get rockets() { return rockets; },
  get shake() { return shakeAmount; },
  get weapons() { return weapons; },
  get aiming() { return aiming; },
  setAim(v) { aimToggle = !!v; prevWeaponName = weapons.current; },
  // 自测/性能钩子
  stats() {
    return {
      tier: quality.tierName,
      calls: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
      enemies: enemies.length,
      auto: quality._autoResult || null,
    };
  },
  spawnTestEnemies(n = 5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 7 + Math.random() * 9;
      const pos = new THREE.Vector3(player.pos.x + Math.cos(a) * d, 0, player.pos.z + Math.sin(a) * d - 4);
      enemies.push(new Enemy(scene, pos, Math.max(1, wave || 1)));
    }
    return enemies.length;
  },
  setTier(t) { quality.setTier(t); },
  testKill() {
    let n = 0;
    for (const en of enemies) {
      if (!en.dead) { en.takeDamage(9999, new THREE.Vector3(0, 0, 1), effects, en.root.position.clone()); onKill(en, false); n++; }
    }
    return n;
  },
  get debrisActive() { return effects.debrisState ? effects.debrisState.filter((s) => s.active).length : 0; },
  get holeCount() { return effects.holes.length; },
  get corpseCount() { return corpses.length; },
  get bloodCount() { return effects.blood.length; },
  get effects() { return effects; },
  get hitstop() { return hitstopTimer; },
  get eyeCount() { return eyeField.mesh.count; },
  get pickupCount() { return pickups.active.length; },
  get pickupsActive() { return pickups.active; },
  testDamageFrom(x, z) { damagePlayer(5, clock.elapsedTime, new THREE.Vector3(x, 0, z)); return hitDirs.length; },
  simPath(sx, sz, px, pz, steps = 900) {
    const en = new Enemy(scene, new THREE.Vector3(sx, 0, sz), 1);
    en.speed = 4;
    enemies.push(en);
    const pp = new THREE.Vector3(px, 1.7, pz);
    const path = [];
    for (let i = 0; i < steps; i++) {
      if (level.flow) level.flow.compute(px, pz);
      en.update(1 / 60, pp, level, enemies, enemies.indexOf(en));
      if (i % 150 === 0) path.push([+en.root.position.x.toFixed(1), +en.root.position.z.toFixed(1)]);
    }
    const p = en.root.position;
    return { finalDist: +Math.hypot(p.x - px, p.z - pz).toFixed(2), path };
  },
  simPlatformSiege(steps = 1600) {
    const pf = new THREE.Vector3(0, 3.2 + player.height, 0);   // 玩家眼睛在平台上
    const spots = [[0, 22], [22, 2], [-22, 2], [2, -22], [16, 16], [-16, -16]];
    const zs = spots.map(([x, z]) => { const e = new Enemy(scene, new THREE.Vector3(x, 0, z), 3); e.speed = 4.2; enemies.push(e); return e; });
    for (let i = 0; i < steps; i++) {
      level.flow.compute(level.stairEntrance.x, level.stairEntrance.z);
      for (const e of zs) e.update(1 / 60, pf, level, enemies, enemies.indexOf(e));
    }
    return { climbed: zs.filter((e) => e.root.position.y > 2).length, of: zs.length,
      pos: zs.map((e) => [+e.root.position.x.toFixed(0), +e.root.position.y.toFixed(1), +e.root.position.z.toFixed(0)]) };
  },
  simClimb(steps = 500) {
    const en = new Enemy(scene, new THREE.Vector3(12, 0, 1), 1);
    enemies.push(en);
    const pp = new THREE.Vector3(0, 4.9, 0);   // 玩家站在中央平台(眼睛高)
    const trail = [];
    for (let i = 0; i < steps; i++) { en.update(1 / 60, pp, level, [en], 0); if (i % 100 === 0) trail.push(+en.root.position.y.toFixed(2)); }
    const p = en.root.position;
    return { finalY: +p.y.toFixed(2), x: +p.x.toFixed(2), z: +p.z.toFixed(2), trailY: trail };
  },
  spawnType(type, n = 4, dist = 10) {
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 2.4;
      const pos = player.pos.clone().addScaledVector(fwd, dist).addScaledVector(right, off); pos.y = 0;
      enemies.push(new Enemy(scene, pos, 9, type));
    }
    return enemies.map((e) => e.type);
  },
  spawnAhead(n = 6, dist = 12) {
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 2.2;
      const pos = player.pos.clone().addScaledVector(fwd, dist).addScaledVector(right, off); pos.y = 0;
      enemies.push(new Enemy(scene, pos, Math.max(1, wave || 1)));
    }
    return enemies.length;
  },
  // 只初始化音频、加载采样，不放音乐（测试用，保持静音）
  initAudioNoMusic() { initAudio(); resumeAudio(); const a = getAudio(); if (a) a.master.gain.value = 0; },
  soundState() { return _soundState(); },
  // 从相机方向发射一枚火箭
  spawnRocketFromCamera() {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const o = new THREE.Vector3(); camera.getWorldPosition(o);
    spawnRocket({ origin: o.addScaledVector(dir, 0.6), dir });
    return rockets.length;
  },
  tickRockets(dt) {
    for (let i = rockets.length - 1; i >= 0; i--) {
      const res = rockets[i].update(dt, enemies);
      if (res && res.explode) { explode(res.point, res.direct, 0, rockets[i].cfg); rockets[i].remove(); rockets.splice(i, 1); }
    }
    return rockets.length;
  },
  explodeAt(x, y, z) { explode(new THREE.Vector3(x, y, z), null, 0); },
  // 用游戏真实的模块实例测试音频/音乐（绕过点击手势）
  testAudio() {
    initAudio(); resumeAudio(); initMusic();
    if (声音.开背景音乐) startMusic();
    return { musicOn: isMusicOn(), music: musicDebug() };
  },
  musicDebug,
};
