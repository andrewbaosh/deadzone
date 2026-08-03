import * as THREE from 'three';
import { greedyMesh } from './greedyMesh.js';

/**
 * 体素僵尸部件。每个部件几何居中于原点、单位尺寸（vs=0.08），
 * 直接替换 enemy 里 6 个 box 部件的几何（头/躯干/左右腿/左右臂），
 * 位置/枢轴/动画/命中检测都不变。颜色烘进顶点色，按类型出一套。
 */
const VS = 0.08;

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2246822519) & 0x7fffffff;
  h = (h ^ (h >> 13)) * 1274126177 & 0x7fffffff;
  return (h & 0xffff) / 0xffff;
}
function shade(hex, k) {
  const r = Math.min(255, ((hex >> 16) & 255) * k) | 0, g = Math.min(255, ((hex >> 8) & 255) * k) | 0, b = Math.min(255, (hex & 255) * k) | 0;
  return (r << 16) | (g << 8) | b;
}

function palette(bodyColor, headColor) {
  return {
    skin: headColor, skinDark: shade(headColor, 0.78),
    shirt: bodyColor, shirtDark: shade(bodyColor, 0.78),
    pants: shade(bodyColor, 0.58), pantsDark: shade(bodyColor, 0.46),
    shoe: 0x2a2420, blood: 0x6e201a, belt: 0x3a2e22,
  };
}

// 居中生成几何
function build(vol) {
  const W = vol.sx * VS, H = vol.sy * VS, D = vol.sz * VS;
  return greedyMesh(vol, VS, new THREE.Vector3(-W / 2, -H / 2, -D / 2)).geometry;
}

function headVol(p) {
  const s = 5;
  return { sx: s, sy: s, sz: s, get(x, y, z) {
    // 顶角随机缺一点（残破）
    if (y === s - 1 && hash3(x, 9, z) < 0.25) return -1;
    // 嘴（前面下部中间一道黑缝）
    if (z === s - 1 && y >= 1 && y <= 2 && x >= 1 && x <= 3) return y === 1 ? 0x100a08 : p.skinDark;
    // 伤口
    if (hash3(x, y, z + 3) < 0.05) return p.blood;
    return hash3(x, y, z) < 0.15 ? p.skinDark : p.skin;
  } };
}
function torsoVol(p) {
  const sx = 7, sy = 10, sz = 4;
  return { sx, sy, sz, get(x, y, z) {
    // 破烂下摆
    if (y === 0 && hash3(x, 0, z) < 0.4) return -1;
    // 腰带
    if (y === 2) return p.belt;
    // 破洞露皮/血
    if (hash3(x, y, z) < 0.06) return (x + y) & 1 ? p.blood : p.skinDark;
    // 肩部偏皮色
    if (y >= sy - 2 && (x === 0 || x === sx - 1)) return p.skin;
    return hash3(x + 5, y, z) < 0.2 ? p.shirtDark : p.shirt;
  } };
}
function armVol(p) {
  const sx = 2, sy = 7, sz = 2;
  return { sx, sy, sz, get(x, y, z) {
    if (y >= 4) return hash3(x, y, z) < 0.2 ? p.shirtDark : p.shirt;  // 袖子
    if (y === 0) return p.skinDark;                                    // 手
    if (hash3(x, y, z + 2) < 0.08) return p.blood;
    return p.skin;
  } };
}
function legVol(p) {
  const sx = 3, sy = 8, sz = 3;
  return { sx, sy, sz, get(x, y, z) {
    if (y <= 1) return p.shoe;                                         // 鞋
    if (y === 2 && z === sz - 1 && hash3(x, y, z) < 0.5) return -1;    // 裤脚破
    return hash3(x + 3, y, z) < 0.18 ? p.pantsDark : p.pants;
  } };
}

const cache = {};

/** 取某类型的一套部件几何（共享，只建一次）。返回 {head,torso,arm,leg} */
export function zombieParts(typeName, bodyColor, headColor) {
  if (cache[typeName]) return cache[typeName];
  const p = palette(bodyColor, headColor);
  const parts = {
    head: build(headVol(p)),
    torso: build(torsoVol(p)),
    arm: build(armVol(p)),
    leg: build(legVol(p)),
  };
  cache[typeName] = parts;
  return parts;
}
