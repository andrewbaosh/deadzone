import * as THREE from 'three';
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
import { setupAtmosphere, setFogDensity } from './graphics/atmosphere.js';
import { PostFX } from './graphics/PostFX.js';
import { DynamicLights } from './graphics/DynamicLights.js';
import { EyeField } from './graphics/EyeField.js';
import { makeDetailNormal } from './graphics/detailTexture.js';
import { 打击感, 波次曲线, 音效氛围 } from './config/gameplay.js';
import { playHeartbeat } from './audio.js';

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

// 阶段4：动态光（玩家头灯 + 枪口/爆炸临时光对象池）+ 丧尸红眼实例场
const dynamicLights = new DynamicLights(scene, camera, quality.params);
const eyeField = new EyeField(scene, 64);

// 阶段8（轻量）：给地面贴代码生成的细节法线（不加面数/不加 draw call）
if (GFX.PBR贴图 && level.ground) {
  try {
    const detail = makeDetailNormal(256);
    detail.repeat.set(48, 48);   // 大量平铺，颗粒才细
    level.ground.material.normalMap = detail;
    level.ground.material.normalScale.set(0.6, 0.6);
    level.ground.material.roughness = 0.95;
    level.ground.material.needsUpdate = true;
  } catch (e) { console.warn('地面细节法线生成失败，跳过:', e); }
}

// 画质档变化时：调雾密度 + 阴影分辨率 + 后处理 + 头灯投影
onQualityChange = (p) => {
  setFogDensity(scene, p.fogDensity);
  if (level.sun) {
    level.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
    if (level.sun.shadow.map) { level.sun.shadow.map.dispose(); level.sun.shadow.map = null; }
  }
  if (typeof postfx !== 'undefined') postfx.rebuild(p);   // 重建效果链以匹配新档位
  dynamicLights.applyTier(p);
};
const player = new Player(camera, level);
const weapons = new WeaponSystem(camera, scene);
const effects = new Effects(scene, camera);
const extraction = new Extraction(scene);
const raycaster = new THREE.Raycaster();

let enemies = [];
let rockets = [];
let staticHitList = level.hitMeshes.slice();   // 环境可命中物
let shakeAmount = 0;                            // 屏幕震动强度
let hitstopTimer = 0;                           // 命中顿帧（微时停）
let heartbeatTimer = 0;                         // 低血心跳计时

/* ============ 游戏状态 ============ */
const STATE = { MENU: 0, PLAYING: 1, DEAD: 2, WIN: 3 };
let state = STATE.MENU;

let score = 0;
let wave = 0;
let kills = 0;
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

// 瞄准状态：切换式(F)或按住式(右键)，两者取或
let aimToggle = false;
let rightHeld = false;
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
    if (state === STATE.PLAYING) {
      // 暂停：停掉音乐 + 环境，弹出暂停菜单
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
  player.onKey(e.code, true);
  if (e.code === 'KeyR') weapons.startReload();
  // CS 风格选枪：1步枪 2手枪 3霰弹 4火箭 5狙击
  if (e.code === 'Digit1') weapons.switchTo('步枪');
  if (e.code === 'Digit2') weapons.switchTo('手枪');
  if (e.code === 'Digit3') weapons.switchTo('霰弹枪');
  if (e.code === 'Digit4') weapons.switchTo('火箭筒');
  if (e.code === 'Digit5') weapons.switchTo('狙击枪');
  if (e.code === 'KeyQ') weapons.quickSwitch();                   // CS：Q 快速切回上一把
  if (e.code === 'KeyF') aimToggle = !aimToggle;                  // 开/关瞄准镜（狙击开镜）
  if (e.code === 'KeyE') { const i = (weapons.slots.indexOf(weapons.current) + 1) % weapons.slots.length; weapons.switchByIndex(i); } // 循环换枪（备用）
  if (e.code === 'KeyM') { const on = toggleMusic(); flashWaveBanner(on ? '♪ 音乐开' : '♪ 音乐关'); }
  if (e.code === 'F7') { quality.cycleTier(); flashWaveBanner('画质 ' + quality.tierName); }
  if (e.code === 'F8') { statsPanel.toggle(); }
  if (['KeyW','KeyA','KeyS','KeyD','Space','KeyR','KeyQ','KeyE','KeyF','KeyM','Digit1','Digit2','Digit3','Digit4','Digit5'].includes(e.code)) e.preventDefault();
});
document.addEventListener('keyup', (e) => player.onKey(e.code, false));

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  player.onMouseMove(e.movementX, e.movementY);
});

document.addEventListener('mousedown', (e) => {
  if (state === STATE.DEAD) return;
  if (document.pointerLockElement !== canvas) return;
  if (e.button === 0) weapons.setTrigger(true);
  if (e.button === 2) { rightHeld = true; }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) weapons.setTrigger(false);
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
  for (const r of rockets) r.remove();
  rockets = [];
  shakeAmount = 0;
  score = 0; wave = 0; kills = 0;
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
}

// 避免和 config 的中文名冲突，这里包一层
import { 武器 as 武器Table } from './config.js';
function 武器Config(k) { return 武器Table[k]; }

function startNextWave() {
  wave++;
  waveActive = true;
  killsThisWave = 0;
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
  const pts = level.spawnPoints;
  // 尽量选离玩家较远的出生点
  let best = pts[0], bestD = -1;
  for (let t = 0; t < 4; t++) {
    const p = pts[(Math.random() * pts.length) | 0];
    const d = p.distanceToSquared(player.pos);
    if (d > bestD) { bestD = d; best = p; }
  }
  const en = new Enemy(scene, best.clone(), wave);
  enemies.push(en);
}

function aliveCount() {
  let n = 0;
  for (const e of enemies) if (!e.dead) n++;
  return n;
}

function updateWaves(dt) {
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

  // 本波清完
  if (toSpawn <= 0 && aliveCount() === 0) {
    score += 分数.过波奖励;
    waveActive = false;
    // 撑够波数 -> 开启撤离；否则继续下一波
    if (wave >= 撤离.开启波数) {
      openExtraction();
    } else {
      restTimer = 波次.波间休息;
      flashWaveBanner(`第 ${wave} 波 完成 +${分数.过波奖励}`);
    }
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

function spawnRocket(shot) {
  const r = new Rocket(scene, shot.origin, shot.dir, 武器Config('火箭筒'), staticHitList);
  rockets.push(r);
}

function explode(center, direct, time) {
  const cfg = 武器Config('火箭筒');
  effects.addExplosion(center, cfg.爆炸半径);
  playExplosion();
  if (音效氛围.开火压低环境) duckEnv(0.7, 0.4);
  addShake(0.5 * 手感.屏幕震动);

  // 对所有敌人施加冲击波
  for (const en of enemies) {
    const bonus = (en === direct) ? cfg.直接伤害 : 0;
    const r = en.applyBlast(center, cfg.爆炸半径, cfg.爆炸伤害, cfg.冲击力, effects, bonus);
    if (r && r.killed) onKill(en, false);
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

  for (const dir of shot.rays) {
    raycaster.set(_origin, dir);
    raycaster.far = shot.range;
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) {
      // 打空：画一条飞向远方的曳光弹
      const end = _origin.clone().addScaledVector(dir, shot.range);
      effects.addTracer(muzzlePos(), end);
      continue;
    }
    const hit = hits[0];
    effects.addTracer(muzzlePos(), hit.point);

    const en = hit.object.userData.enemy;
    if (en && !en.dead) {
      const isHead = hit.object === en.head;
      const dmg = shot.damage * (isHead ? shot.headMul : 1);
      const fromDir = dir.clone(); fromDir.y = 0; fromDir.normalize();
      const killed = en.takeDamage(dmg, fromDir, effects, hit.point);
      effects.addSparks(hit.point, dir.clone().negate(), isHead ? 8 : 5, isHead ? 0xff6644 : 0xaa3322);
      shot.onHit(isHead);
      showHitmarker(isHead);
      if (手感.显示伤害数字) {
        effects.addFloatingNumber(hit.point, String(Math.round(dmg)), isHead ? 'headshot' : 'hit');
      }
      if (killed) onKill(en, isHead);
    } else {
      // 环境命中：弹孔 + 火花
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
      effects.addBulletHole(hit.point, n);
      effects.addSparks(hit.point, n, 4, 0xffcc66);
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
function damagePlayer(dmg, time) {
  player.takeDamage(dmg, time);
  playPlayerHurt();
  damageFlashTimer = 0.4;
  // 被咬抖屏（强度随伤害）
  if (打击感.镜头抖动) addShake(Math.min(0.35, 0.06 + dmg * 0.006) * 打击感.抖动强度);
  if (!player.alive) onPlayerDeath();
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

  if (state === STATE.PLAYING) {
    // 换枪时自动收镜
    if (weapons.current !== prevWeaponName) { aimToggle = false; prevWeaponName = weapons.current; }

    // 瞄准状态（F 切换 或 右键按住）
    aiming = aimToggle || rightHeld;
    const scoped = aiming && !!weapons.cfg.是狙击;

    // 瞄准镜 / 准星 / 枪模型 显隐
    hud.scope.style.display = scoped ? 'block' : 'none';
    hud.crosshair.style.visibility = scoped ? 'hidden' : 'visible';
    weapons.viewGroup.visible = !scoped;

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

    player.update(simDt, time);

    // 屏幕震动（在相机定位之后叠加抖动）
    if (shakeAmount > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shakeAmount;
      camera.position.y += (Math.random() - 0.5) * shakeAmount;
      camera.position.z += (Math.random() - 0.5) * shakeAmount * 0.5;
      shakeAmount *= Math.max(0, 1 - dt * 7);
    }

    const moving = (Math.abs(player.vel.x) + Math.abs(player.vel.z)) > 0.6;
    const shot = weapons.update(simDt, moving, aiming);
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
      const res = r.update(simDt, enemies);
      if (res && res.explode) {
        explode(res.point, res.direct, time);
        r.remove();
        rockets.splice(i, 1);
      }
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
        if (pd < en.blastRange && player.alive) damagePlayer(en.blastDmg * (1 - pd / en.blastRange), time);
      }
      const res = en.update(simDt, player.pos, level, enemies, i);
      if (res === false) { en.remove(); enemies.splice(i, 1); continue; }
      if (res && res.didAttack > 0) damagePlayer(res.didAttack, time);
      en.faceBar(camera);
    }

    // 自动回血
    if (player.alive && time - player.lastDamageTime > PLAYER.自动回血延迟 && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + PLAYER.自动回血速度 * dt);
    }

    updateWaves(dt);
    extraction.update(dt);
    updateWaypoint();
    dynamicLights.update(dt);
    eyeField.update(enemies);
    effects.update(dt);
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
  get hitstop() { return hitstopTimer; },
  get eyeCount() { return eyeField.mesh.count; },
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
      if (res && res.explode) { explode(res.point, res.direct, 0); rockets[i].remove(); rockets.splice(i, 1); }
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
