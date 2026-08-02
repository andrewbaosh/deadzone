import { getAudio } from './audio.js';
import { 声音 } from './config.js';

/**
 * 背景音乐：一段黑暗/驱动感的电子循环（techno），全部代码实时合成，没有音频文件。
 * 用前瞻式调度器（lookahead scheduler）精确排布鼓点和贝斯，不受掉帧影响。
 * 强度（intensity）会随战斗上升：休息时低沉，交战时加入军鼓和琶音。
 */

let ctx = null;
let musicBus = null;      // 音乐总线（可单独调音量/静音）
let noiseBuffer = null;

let running = false;
let enabled = true;
let step = 0;             // 当前十六分音符步数（0..15 循环）
let nextNoteTime = 0;
let timer = null;
let intensity = 0.0;      // 0 = 平静，1 = 激烈
let intensityTarget = 0.0;

const A = 55.0;           // A1，小调根音
// 频率表（A 小调音阶里几个音，单位 Hz，低八度贝斯用）
const NOTE = {
  A1: 55.00, C2: 65.41, D2: 73.42, E2: 82.41, G2: 98.00,
  A2: 110.0, C3: 130.8, E3: 164.8,
};

// 16 步贝斯riff（两小节感觉），null = 不发音
const BASS = [
  NOTE.A1, null, NOTE.A1, null, NOTE.A1, null, NOTE.C2, null,
  NOTE.G2, null, NOTE.G2, null, NOTE.E2, null, NOTE.D2, null,
];
// 琶音（高层，激烈时才明显）
const ARP = [
  NOTE.A2, NOTE.E3, NOTE.C3, NOTE.E3, NOTE.A2, NOTE.E3, NOTE.C3, NOTE.G2,
  NOTE.A2, NOTE.E3, NOTE.C3, NOTE.E3, NOTE.G2, NOTE.C3, NOTE.E3, NOTE.A2,
];

export function initMusic() {
  if (musicBus) return;          // 已初始化过就不重复建（避免叠音轨）
  const a = getAudio();
  if (!a || !a.ctx) return;
  ctx = a.ctx;

  musicBus = ctx.createGain();
  musicBus.gain.value = 声音.音乐音量;
  // 走一层柔和的低通，避免刺耳
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 6000;
  shelf.gain.value = -6;
  musicBus.connect(shelf).connect(a.master);

  // 生成白噪声（军鼓/踩镲用）
  const len = ctx.sampleRate * 1;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

export function startMusic() {
  if (!ctx || running || !enabled) return;
  running = true;
  step = 0;
  nextNoteTime = ctx.currentTime + 0.1;
  scheduler();
}

export function stopMusic() {
  running = false;
  if (timer) { clearTimeout(timer); timer = null; }
}

export function toggleMusic() {
  enabled = !enabled;
  if (enabled) startMusic();
  else stopMusic();
  return enabled;
}

export function isMusicOn() { return enabled && running; }

export function _debug() {
  return { hasCtx: !!ctx, hasBus: !!musicBus, enabled, running, step, intensity };
}

export function setMusicVolume(v) {
  if (musicBus) musicBus.gain.value = v;
}

/** 战斗强度（0平静~1激烈），主循环每帧调 */
export function setIntensity(v) {
  intensityTarget = Math.max(0, Math.min(1, v));
}

function secPerStep() {
  const bpm = 声音.音乐速度 || 128;
  return 60 / bpm / 4;   // 十六分音符
}

// 前瞻调度：每 25ms 检查一次，把未来 0.12s 内的音符排好
function scheduler() {
  if (!running) return;
  const ahead = 0.12;
  while (nextNoteTime < ctx.currentTime + ahead) {
    // 平滑靠近目标强度
    intensity += (intensityTarget - intensity) * 0.12;
    scheduleStep(step, nextNoteTime);
    nextNoteTime += secPerStep();
    step = (step + 1) % 16;
  }
  timer = setTimeout(scheduler, 25);
}

function scheduleStep(s, t) {
  const sps = secPerStep();

  // ---- 底鼓：每拍（0,4,8,12） ----
  if (s % 4 === 0) kick(t);

  // ---- 军鼓/拍手：反拍（4,12） ----
  if (s === 4 || s === 12) clap(t, 0.5 + intensity * 0.5);

  // ---- 踩镲：平静时只在偶数步，激烈时每步 ----
  if (s % 2 === 0 || intensity > 0.4) {
    hat(t, s % 4 === 2 ? 0.5 : 0.28, s % 2 === 1);
  }

  // ---- 贝斯 ----
  const bn = BASS[s];
  if (bn) bass(t, bn, sps * 1.6);

  // ---- 琶音（激烈时淡入） ----
  if (intensity > 0.25) {
    const an = ARP[s];
    if (an) arp(t, an, sps * 0.9, (intensity - 0.25) / 0.75);
  }

  // ---- 低音铺底 drone（一直在，弱） ----
  if (s === 0) drone(t, sps * 16);
}

/* ---------------- 合成乐器 ---------------- */

function noise(dur, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  src.playbackRate.value = rate;
  src.start(nextNoteTimeSafe());
  src.stop(ctx.currentTime + dur + 0.2);
  return src;
}
// 防止在过去时间 start 报错
function nextNoteTimeSafe() { return Math.max(ctx.currentTime, 0); }

function kick(t) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(1.0, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(g).connect(musicBus);
  o.start(t); o.stop(t + 0.34);
  // 咔嗒点击
  const c = ctx.createOscillator();
  c.type = 'square';
  c.frequency.value = 800;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.3, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
  c.connect(cg).connect(musicBus);
  c.start(t); c.stop(t + 0.03);
}

function clap(t, vol) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer; src.loop = true;
  src.start(t); src.stop(t + 0.2);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.35 * vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  src.connect(f).connect(g).connect(musicBus);
}

function hat(t, vol, open) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer; src.loop = true;
  src.playbackRate.value = 1.8;
  src.start(t); src.stop(t + 0.1);
  const f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 7000;
  const g = ctx.createGain();
  const dur = open ? 0.08 : 0.035;
  g.gain.setValueAtTime(0.2 * vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(musicBus);
}

function bass(t, freq, dur) {
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(freq, t);
  const sub = ctx.createOscillator();      // 加一个低八度正弦增强
  sub.type = 'sine';
  sub.frequency.setValueAtTime(freq / 2, t);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  const cutoff = 260 + intensity * 900;
  f.frequency.setValueAtTime(cutoff, t);
  f.frequency.exponentialRampToValueAtTime(cutoff * 0.5, t + dur);
  f.Q.value = 6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f); sub.connect(f); f.connect(g).connect(musicBus);
  o.start(t); o.stop(t + dur + 0.02);
  sub.start(t); sub.stop(t + dur + 0.02);
}

function arp(t, freq, dur, amt) {
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(freq, t);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 2600; f.Q.value = 3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.14 * amt, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(musicBus);
  o.start(t); o.stop(t + dur + 0.02);
}

function drone(t, dur) {
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = A;               // A1
  const o2 = ctx.createOscillator();
  o2.type = 'sawtooth';
  o2.frequency.value = A * 1.005;      // 轻微失谐，厚一点
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 220; f.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.10, t + 0.5);
  g.gain.linearRampToValueAtTime(0.10, t + dur - 0.5);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(f); o2.connect(f); f.connect(g).connect(musicBus);
  o.start(t); o.stop(t + dur);
  o2.start(t); o2.stop(t + dur);
}
