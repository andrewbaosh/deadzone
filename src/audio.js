/**
 * 全部声音都是代码实时合成的（WebAudio），不需要任何音频文件。
 */

import { 声音 } from './config.js';

let ctx = null;
let master = null;
let noiseBuffer = null;

/** 给 music.js 共用同一个音频上下文和总线 */
export function getAudio() {
  return ctx ? { ctx, master } : null;
}

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 声音?.总音量 ?? 0.5;
  master.connect(ctx.destination);

  // 预生成一段白噪声，射击/爆炸都用它
  const len = ctx.sampleRate * 2;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
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

/** 枪声：低频"砰" + 噪声爆裂 + 尾音 */
export function playShot(tone) {
  if (!ctx) return;
  const t = now();
  const dur = tone.长度;

  // 噪声爆裂
  const n = noiseSource(dur);
  const nf = ctx.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = tone.频率 * 4;
  nf.Q.value = 0.7;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.85 * tone.噪声, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
  n.connect(nf).connect(ng).connect(master);

  // 低频冲击
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(tone.频率, t);
  o.frequency.exponentialRampToValueAtTime(tone.频率 * 0.35, t + dur * 0.8);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.5, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.9);
  o.connect(og).connect(master);
  o.start(t); o.stop(t + dur + 0.02);

  // 房间尾音
  const tail = noiseSource(0.35, 0.6);
  const tf = ctx.createBiquadFilter();
  tf.type = 'lowpass';
  tf.frequency.value = 900;
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.16, t + 0.02);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  tail.connect(tf).connect(tg).connect(master);
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

/** 火箭发射：低沉的"咚"+ 喷射嘶声 */
export function playRocketFire() {
  if (!ctx) return;
  const t = now();
  // 点火冲击
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(50, t + 0.25);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.6, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  o.connect(og).connect(master);
  o.start(t); o.stop(t + 0.32);
  // 喷射嘶声
  const n = noiseSource(0.35, 0.7);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 0.6;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.5, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  n.connect(f).connect(ng).connect(master);
}

/** 爆炸：大低频轰响 + 碎裂噪声 + 回声尾 */
export function playExplosion() {
  if (!ctx) return;
  const t = now();
  // 低频轰
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
  const og = ctx.createGain();
  og.gain.setValueAtTime(1.0, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  o.connect(og).connect(master);
  o.start(t); o.stop(t + 0.72);
  // 碎裂噪声
  const n = noiseSource(0.5);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(2200, t);
  f.frequency.exponentialRampToValueAtTime(200, t + 0.5);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.9, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
  n.connect(f).connect(ng).connect(master);
  // 回声尾
  const tail = noiseSource(0.6, 0.5);
  const tf = ctx.createBiquadFilter();
  tf.type = 'lowpass'; tf.frequency.value = 600;
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.25, t + 0.05);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
  tail.connect(tf).connect(tg).connect(master);
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
