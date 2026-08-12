/**
 * 全部声音都是代码实时合成的（WebAudio），不需要任何音频文件。
 */

import { 声音 } from './config.js';

let ctx = null;
let master = null;
let noiseBuffer = null;
let reverbIn = null;      // 卷积混响输入（枪声/爆炸的环境回声都送这里）

/** 给 music.js 共用同一个音频上下文和总线 */
export function getAudio() {
  return ctx ? { ctx, master } : null;
}

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 声音?.总音量 ?? 0.5;

  // 总线上加一点软削波，避免爆炸/齐射时破音
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.knee.value = 6;
  comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.2;
  master.connect(comp).connect(ctx.destination);

  // 预生成一段白噪声，射击/爆炸都用它
  const len = ctx.sampleRate * 2;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  // 卷积混响：用带衰减的噪声当脉冲响应，模拟废墟里的枪声回响
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulseResponse(1.1, 3.2);
  const wet = ctx.createGain();
  wet.gain.value = 0.9;
  conv.connect(wet).connect(master);
  reverbIn = conv;

  loadSounds();   // 后台加载真实枪声采样
}

/** 生成一段指数衰减的立体声噪声脉冲，给卷积混响用 */
function makeImpulseResponse(duration, decay) {
  const rate = ctx.sampleRate;
  const n = Math.floor(rate * duration);
  const buf = ctx.createBuffer(2, n, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
  }
  return buf;
}

/** 把一个节点按 amt 送入混响 */
function sendReverb(node, amt) {
  if (!reverbIn || amt <= 0) return;
  const s = ctx.createGain();
  s.gain.value = amt;
  node.connect(s);
  s.connect(reverbIn);
}

/* ---------------- 真实录音采样 ---------------- */
const buffers = {};   // 解码后的 AudioBuffer
const onsets = {};    // 每个采样的起音时刻（自动跳过前面的静音）

const SOUND_FILES = {
  pistol: '/sounds/pistol.ogg',      // Walther PPQ 手枪
  rifle: '/sounds/rifle.ogg',        // AR-15 步枪
  shotgun: '/sounds/shotgun.ogg',    // Mossberg 泵动霰弹枪
  sniper: '/sounds/sniper.ogg',      // Mosin Nagant 栓动狙击
  rocket: '/sounds/rocket.mp3',      // 火箭发射（长录音，运行时裁剪起音段）
  explosion: '/sounds/explosion.ogg',
};

/** 异步加载并解码所有采样；加载完成前 playShot 会自动回退到合成音 */
function loadSounds() {
  for (const [key, url] of Object.entries(SOUND_FILES)) {
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => { buffers[key] = buf; onsets[key] = detectOnset(buf); })
      .catch(() => { /* 加载失败就用合成音，无所谓 */ });
  }
}

/** 找到采样里第一个明显的声音（跳过录音开头的静音） */
function detectOnset(buf) {
  const d = buf.getChannelData(0);
  const thresh = 0.12;
  const step = Math.max(1, Math.floor(buf.sampleRate / 8000));
  for (let i = 0; i < d.length; i += step) {
    if (Math.abs(d[i]) > thresh) return Math.max(0, i / buf.sampleRate - 0.006);
  }
  return 0;
}

/**
 * 播放一段真实采样：从起音处开始、按 rate 调音高、用增益包络裁成 dur 秒
 * （避免录音里的长尾巴在连发时叠成一团），并送一份到混响。
 */
function playBuffer(key, rate, level, verb, dur) {
  const buf = buffers[key];
  if (!buf) return false;
  const t = now();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, t);
  g.gain.setValueAtTime(level, t + dur * 0.72);   // 保留更多枪声本体与尾音，别切太狠
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(g).connect(master);
  sendReverb(g, verb);
  src.start(t, onsets[key] || 0);
  src.stop(t + dur + 0.05);
  return true;
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

/** 调试：哪些采样已加载 + 起音时刻 */
export function _soundState() {
  return { loaded: Object.keys(buffers), onsets: { ...onsets }, ctxState: ctx?.state };
}

export function setVolume(v) {
  if (master) master.gain.value = v;
}

function now() { return ctx.currentTime; }

function noiseSource(duration, playbackRate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  src.playbackRate.value = playbackRate;
  src.start(now());
  src.stop(now() + duration + 0.05);
  return src;
}

/**
 * 枪声：分四层合成，更接近真实枪响
 *   1) 极短的爆燃 transient（枪机/击发的"啪"）
 *   2) 主爆音 crack —— 宽带噪声，中心频率快速下扫（枪口爆炸波）
 *   3) 低频 body punch（推背的"咚"）
 *   4) 送入卷积混响，得到环境回响尾音
 * 兼容旧字段：没有新字段时回退到 频率/噪声。
 */
export function playShot(tone) {
  if (!ctx) return;

  // 优先播放真实录音采样；采样没加载好再回退到合成音
  if (tone.样本 && playBuffer(tone.样本, tone.音高 ?? 1, tone.音量 ?? 0.9, tone.混响 ?? 0.3, tone.长度 ?? 0.25)) {
    return;
  }

  const t = now();
  const dur = tone.长度 ?? 0.16;
  const bright = tone.亮度 ?? (tone.频率 ? tone.频率 * 6 : 2000);
  const bodyHz = tone.低频 ?? (tone.频率 ?? 140);
  const level = tone.音量 ?? 0.8;
  const verb = tone.混响 ?? 0.3;

  const out = ctx.createGain();
  out.gain.value = level;
  out.connect(master);
  sendReverb(out, verb);

  // 1) 起始 transient：极短高频噪声"啪"
  const clk = noiseSource(0.01);
  const cf = ctx.createBiquadFilter();
  cf.type = 'highpass'; cf.frequency.value = 3500;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.9, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
  clk.connect(cf).connect(cg).connect(out);

  // 2) 主爆音 crack：宽带噪声 + 带通中心快速下扫 + 快衰减
  const n = noiseSource(dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(bright, t);
  bp.frequency.exponentialRampToValueAtTime(Math.max(180, bright * 0.35), t + dur * 0.7);
  bp.Q.value = 0.9;
  const lp = ctx.createBiquadFilter();     // 再叠一层低通，去掉太尖的毛刺
  lp.type = 'lowpass'; lp.frequency.value = bright * 1.6;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(1.0, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
  n.connect(bp).connect(lp).connect(ng).connect(out);

  // 3) 低频 body punch
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(bodyHz * 2.2, t);
  o.frequency.exponentialRampToValueAtTime(bodyHz * 0.5, t + dur * 0.5);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.7, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.9);
  o.connect(og).connect(out);
  o.start(t); o.stop(t + dur + 0.02);
}

/** 命中反馈：清脆的"叮" */
export function playHitmarker(headshot) {
  if (!ctx) return;
  const t = now();
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(headshot ? 1750 : 1150, t);
  o.frequency.exponentialRampToValueAtTime(headshot ? 2400 : 1450, t + 0.05);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.1);
}

/** 换弹：两声机械咔哒 */
export function playReload(stage) {
  if (!ctx) return;
  const t = now();
  const n = noiseSource(0.06, stage === 0 ? 1.6 : 1.1);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = stage === 0 ? 2600 : 1500;
  f.Q.value = 2.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  n.connect(f).connect(g).connect(master);
}

/** 空仓：咔 */
export function playDryFire() {
  if (!ctx) return;
  const t = now();
  const n = noiseSource(0.04, 2.2);
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 2200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  n.connect(f).connect(g).connect(master);
}

/** 挥刀破空声：短促的"咻"（高 Q 带通向下扫 + 低通去毛刺，像刀划过空气而不是刷子） */
export function playMelee() {
  if (!ctx) return;
  const t = now();
  const n = noiseSource(0.13, 1.0);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 6;                                      // 高 Q → 更"咻"而非"刷"
  bp.frequency.setValueAtTime(2300, t);
  bp.frequency.exponentialRampToValueAtTime(650, t + 0.11);   // 向下扫（破空感）
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3600;                           // 削掉尖锐嘶声
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);  // 快起
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12); // 快落
  n.connect(bp).connect(lp).connect(g).connect(master);
}

/** 砍中身体：闷响"噗嗤"（低频肉响 + 短切肉噪声），爆头额外脆一点 */
export function playMeleeHit(headshot) {
  if (!ctx) return;
  const t = now();
  // 低频闷响（砍进身体的"噗"）
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(headshot ? 240 : 190, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.10);
  const go = ctx.createGain();
  go.gain.setValueAtTime(0.36, t);
  go.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o.connect(go).connect(master);
  o.start(t); o.stop(t + 0.14);
  // 切肉的短噪声（"嗤"）
  const n = noiseSource(0.08, 1.1);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = headshot ? 1600 : 1100;
  bp.Q.value = 0.9;
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0.3, t);
  gn.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  n.connect(bp).connect(gn).connect(master);
}

/** 丧尸吼叫 */
export function playGrowl(distance = 10) {
  if (!ctx) return;
  const t = now();
  const vol = Math.max(0, 1 - distance / 35) * 0.35;
  if (vol <= 0.01) return;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const base = 70 + Math.random() * 45;
  o.frequency.setValueAtTime(base, t);
  o.frequency.linearRampToValueAtTime(base * 0.65, t + 0.45);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(650, t);
  f.frequency.linearRampToValueAtTime(220, t + 0.45);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  o.connect(f).connect(g).connect(master);
  o.start(t); o.stop(t + 0.55);
}

/** 玩家挨打 */
export function playPlayerHurt() {
  if (!ctx) return;
  const t = now();
  const n = noiseSource(0.25, 0.4);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(500, t);
  f.frequency.exponentialRampToValueAtTime(120, t + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  n.connect(f).connect(g).connect(master);
}

/** 敌人死亡 */
export function playDeath() {
  if (!ctx) return;
  const t = now();
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.7);
}

/** 火箭发射：真实发射录音（裁掉起音后 ~0.8 秒）；没采样时用合成喷射声 */
export function playRocketFire() {
  if (!ctx) return;
  // 真实录音的火箭发射；和爆炸是两个完全不同的声音
  if (playBuffer('rocket', 1.0, 0.95, 0.4, 0.8)) return;

  const t = now();
  const out = ctx.createGain(); out.gain.value = 0.9; out.connect(master);
  sendReverb(out, 0.35);
  // 点火冲击
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.28);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.7, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
  o.connect(og).connect(out);
  o.start(t); o.stop(t + 0.34);
  // 喷射嘶声（下扫）
  const n = noiseSource(0.4, 0.7);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.setValueAtTime(1600, t);
  f.frequency.exponentialRampToValueAtTime(600, t + 0.4); f.Q.value = 0.5;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.55, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  n.connect(f).connect(ng).connect(out);
}

/** 爆炸：真实爆炸录音 + 合成深低频胸腔冲击；没采样时全用合成 */
export function playExplosion() {
  if (!ctx) return;
  const t = now();
  const usedSample = playBuffer('explosion', 1.0, 1.0, 0.7, 0.9);

  const out = ctx.createGain(); out.gain.value = 1.0; out.connect(master);
  sendReverb(out, 0.7);

  // 有采样时只补一层深低频让它更有冲击；没采样时补齐尖锐炸裂+碎片声
  if (!usedSample) {
    const clk = noiseSource(0.03);
    const cf = ctx.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 1800;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(1.0, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    clk.connect(cf).connect(cg).connect(out);
  }

  // 深低频轰（两层，一层更低）
  const subLevel = usedSample ? 0.55 : 1.0;
  for (const [f0, f1, lvBase, len] of [[130, 26, subLevel, 0.75], [70, 20, subLevel * 0.7, 0.55]]) {
    const lv = lvBase;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + len);
    const og = ctx.createGain();
    og.gain.setValueAtTime(lv, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + len + 0.02);
  }

  // 碎片/火焰噪声（真实采样自带碎裂声，就不再叠了）
  if (!usedSample) {
    const n = noiseSource(0.6);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.55);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.95, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    n.connect(f).connect(ng).connect(out);
  }
}

/** 拾取：上扬的两声"叮咚"（kind: 'ammo' | 'health'） */
export function playPickup(kind = 'ammo') {
  if (!ctx) return;
  const t = now();
  const base = kind === 'health' ? 520 : 700;
  [0, 0.07].forEach((off, i) => {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(base * (i ? 1.5 : 1), t + off);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + off);
    g.gain.linearRampToValueAtTime(0.22, t + off + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.16);
    o.connect(g).connect(master);
    o.start(t + off); o.stop(t + off + 0.18);
  });
}

/** 低血量心跳（两下"咚·咚"） */
export function playHeartbeat() {
  if (!ctx) return;
  const t = now();
  for (const off of [0, 0.16]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(70, t + off);
    o.frequency.exponentialRampToValueAtTime(38, t + off + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + off);
    g.gain.linearRampToValueAtTime(off === 0 ? 0.5 : 0.34, t + off + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.16);
    o.connect(g).connect(master);
    o.start(t + off); o.stop(t + off + 0.18);
  }
}

/* ---------------- 环境底噪 drone + 音频 ducking ---------------- */
let ambientGain = null;    // 环境音量（渐入渐出）
let duckGain = null;       // 开火时压低环境用
let ambientNodes = [];
let ambientOn = false;
let ambientTarget = 0.16;

function ensureAmbient() {
  if (ambientGain || !ctx) return;
  ambientGain = ctx.createGain(); ambientGain.gain.value = 0;
  duckGain = ctx.createGain(); duckGain.gain.value = 1;
  ambientGain.connect(duckGain).connect(master);

  // 低沉不和谐的 drone：几个失谐锯齿过低通
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass'; filt.frequency.value = 190; filt.Q.value = 3;
  filt.connect(ambientGain);
  for (const f of [41.2, 55, 61.7]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = 0.25;
    o.connect(g).connect(filt); o.start(); ambientNodes.push(o);
  }
  // 超低 sub
  const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 32;
  const sg = ctx.createGain(); sg.gain.value = 0.4;
  sub.connect(sg).connect(ambientGain); sub.start(); ambientNodes.push(sub);
  // 慢速 LFO 扫滤波，让 drone 有呼吸感
  const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.05;
  const lg = ctx.createGain(); lg.gain.value = 70;
  lfo.connect(lg).connect(filt.frequency); lfo.start(); ambientNodes.push(lfo);
  // 一层极轻的低频风噪
  const n = noiseSource(99999, 0.2);
  const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 420;
  const ng = ctx.createGain(); ng.gain.value = 0.05;
  n.connect(nf).connect(ng).connect(ambientGain); ambientNodes.push(n);
}

export function startAmbient() {
  if (!ctx) return;
  ensureAmbient();
  ambientOn = true;
  const t = now();
  ambientGain.gain.cancelScheduledValues(t);
  ambientGain.gain.linearRampToValueAtTime(ambientTarget, t + 1.5);
}

export function stopAmbient() {
  if (!ambientGain) return;
  ambientOn = false;
  const t = now();
  ambientGain.gain.cancelScheduledValues(t);
  ambientGain.gain.linearRampToValueAtTime(0, t + 0.4);
}

/** 开火/爆炸时短暂压低环境音（ducking） */
export function duckEnv(amount = 0.5, dur = 0.25) {
  if (!duckGain) return;
  const t = now();
  duckGain.gain.cancelScheduledValues(t);
  duckGain.gain.setValueAtTime(duckGain.gain.value, t);
  duckGain.gain.linearRampToValueAtTime(Math.max(0.1, 1 - amount), t + 0.02);
  duckGain.gain.linearRampToValueAtTime(1, t + dur);
}

export function setAmbientVolume(v) {
  ambientTarget = v;
  if (ambientOn && ambientGain) {
    ambientGain.gain.cancelScheduledValues(now());
    ambientGain.gain.linearRampToValueAtTime(v, now() + 0.2);
  }
}

/** 新一波开始的警报 */
export function playWaveStart() {
  if (!ctx) return;
  const t = now();
  [0, 0.22].forEach((offset, i) => {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(i === 0 ? 440 : 660, t + offset);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t + offset);
    g.gain.linearRampToValueAtTime(0.15, t + offset + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.2);
    o.connect(g).connect(master);
    o.start(t + offset); o.stop(t + offset + 0.25);
  });
}
