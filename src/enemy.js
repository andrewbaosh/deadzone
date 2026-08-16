import * as THREE from 'three';
import { 敌人 as CFG } from './config.js';
import { playGrowl, playDeath } from './audio.js';
import { 打击感, 丧尸种类 } from './config/gameplay.js';

import { zombieParts } from './graphics/voxel/zombie.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _navDir = new THREE.Vector3();   // 复用，避免每帧 new
const _move = new THREE.Vector3();

/**
 * 丧尸。低多边形人形，分头/身两个受击部位。
 * 会朝玩家走、绕开障碍、靠近后攻击。被打中会闪红+击退。
 */

// 按权重从"当前波数已解锁的类型"里随机挑一种（exclude=要排除的类型名数组）
function pickType(wave, exclude) {
  let avail = Object.entries(丧尸种类).filter(([, v]) => wave >= (v.出现波数 || 1));
  if (exclude && exclude.length) avail = avail.filter(([k]) => !exclude.includes(k));
  if (!avail.length) return '普通';
  const total = avail.reduce((s, [, v]) => s + (v.权重 || 0), 0) || 1;
  let r = Math.random() * total;
  for (const [k, v] of avail) { r -= (v.权重 || 0); if (r <= 0) return k; }
  return avail[0][0];
}

export class Enemy {
  constructor(scene, spawnPos, wave, forcedType, excludeTypes, worldSize = 46) {
    this.scene = scene;
    this.dead = false;
    this.wave = wave;
    this.bound = worldSize - 2;   // 活动边界（随地图大小；超大要塞时很大）

    // 决定类型（数值集中在 gameplay.js 的 丧尸种类）
    const typeName = forcedType && 丧尸种类[forcedType] ? forcedType : pickType(wave, excludeTypes);
    this.type = typeName;
    const cfg = 丧尸种类[typeName];
    const T = { colorBody: cfg.身色, colorHead: cfg.头色 };

    const waveHp = CFG.生命 * Math.pow(CFG.每波生命倍率, wave - 1);
    this.maxHp = waveHp * cfg.血量倍率;
    this.hp = this.maxHp;

    const waveSpd = CFG.速度 * Math.pow(CFG.每波速度倍率, wave - 1);
    this.speed = Math.min(CFG.速度上限, waveSpd * cfg.速度倍率);
    this.damage = CFG.攻击伤害 * cfg.伤害倍率;
    this.scaleFactor = CFG.体型 * cfg.体型;

    // 自爆尸（爆炸型死亡时范围伤害）
    this.selfDestruct = !!cfg.自爆;
    this.blastRange = cfg.自爆范围 || 0;
    this.blastDmg = cfg.自爆伤害 || 0;

    // 喷气背包·会飞
    this.flying = !!cfg.会飞;
    this.flyHeight = cfg.飞行高度 || 3.6;
    this.atkIntervalMul = cfg.攻击间隔倍率 || 1;   // 咬人冷却倍率（飞尸更慢）

    this.attackTimer = 0;
    this.growlTimer = Math.random() * 4;
    this.hurtFlash = 0;
    this.knockback = new THREE.Vector3();
    // 冰冻技能：frozen=被冻住(不能动、解冻即死)；iceTime=在冰面上站了多久
    this.frozen = false;
    this.freezeTimer = 0;
    this.iceTime = 0;

    // 被冲击波震飞用的弹道状态
    this.vel = new THREE.Vector3();
    this.airborne = false;
    this.spin = new THREE.Vector3();
    this.side = Math.random() < 0.5 ? 1 : -1;   // 绕障碍时的偏侧，破对称防卡死

    this.buildMesh(T);
    if (this.flying) this.buildJetpack();
    this.root.position.copy(spawnPos);
    this.root.position.y = this.flying ? this.flyHeight : 0;   // 会飞的直接在空中出生
    scene.add(this.root);

    // 受击盒（相对 root 的局部范围），用于射线命中
    this.headMeshes = [this.head];
    this.bodyMeshes = [this.torso, this.legL, this.legR, this.armL, this.armR];
  }

  buildMesh(T) {
    const s = this.scaleFactor;
    this.root = new THREE.Group();

    // 顶点色由体素几何提供；材质基色白，emissive 留给受击闪红
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85 });
    this.bodyMat = bodyMat;
    this.headMat = headMat;

    // 体素部件几何（按类型共享，只建一次）
    const P = zombieParts(this.type, T.colorBody, T.colorHead);

    // 躯干
    this.torso = new THREE.Mesh(P.torso, bodyMat);
    this.torso.position.y = 1.0 * s; this.torso.scale.setScalar(s);
    // 头
    this.head = new THREE.Mesh(P.head, headMat);
    this.head.position.y = 1.6 * s; this.head.scale.setScalar(s);
    // 眼睛由 EyeField(InstancedMesh) 统一渲染
    // 腿
    this.legL = new THREE.Mesh(P.leg, bodyMat); this.legL.position.set(-0.15 * s, 0.31 * s, 0); this.legL.scale.setScalar(s);
    this.legR = new THREE.Mesh(P.leg, bodyMat); this.legR.position.set(0.15 * s, 0.31 * s, 0); this.legR.scale.setScalar(s);
    // 手臂（前伸的丧尸姿势）
    this.armL = new THREE.Mesh(P.arm, bodyMat);
    this.armL.position.set(-0.36 * s, 1.15 * s, 0.15 * s); this.armL.rotation.x = -1.3; this.armL.scale.setScalar(s);
    this.armR = new THREE.Mesh(P.arm, bodyMat);
    this.armR.position.set(0.36 * s, 1.15 * s, 0.15 * s); this.armR.rotation.x = -1.3; this.armR.scale.setScalar(s);

    // 只有躯干/头投影：四肢阴影几乎看不出来，但会在每个阴影 pass 里重画一遍（省 draw call）
    for (const m of [this.torso, this.head, this.legL, this.legR, this.armL, this.armR]) {
      m.castShadow = (m === this.torso || m === this.head);
      this.root.add(m);
    }

    this.root.traverse((o) => { if (o.isMesh) o.userData.enemy = this; });

    // 血条（漂在头顶的小面片）
    this.hpBarBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7 * s, 0.09),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthTest: false })
    );
    this.hpBar = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68 * s, 0.07),
      new THREE.MeshBasicMaterial({ color: 0x33ff55, depthTest: false })
    );
    this.hpBarBg.position.y = 1.95 * s;
    this.hpBar.position.y = 1.95 * s;
    this.hpBar.position.z = 0.001;
    this.hpBar.renderOrder = 999;
    this.hpBarBg.renderOrder = 998;
    this.hpBarBg.visible = false;
    this.hpBar.visible = false;
    this.root.add(this.hpBarBg, this.hpBar);

    this.phase = Math.random() * Math.PI * 2;   // 走路摆动相位
  }

  /** 背上的喷气背包（两个推进罐 + 背板 + 两束蓝色火焰） */
  buildJetpack() {
    const s = this.scaleFactor;
    const metal = new THREE.MeshStandardMaterial({ color: 0x2f343b, roughness: 0.55, metalness: 0.6 });
    const grp = new THREE.Group();
    for (const sx of [-0.13, 0.13]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 8), metal);
      tank.position.set(sx * s, 1.05 * s, -0.22 * s);
      grp.add(tank);
      const noz = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 8), metal);
      noz.position.set(sx * s, 0.84 * s, -0.22 * s); noz.rotation.x = Math.PI;
      grp.add(noz);
    }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34 * s, 0.4 * s, 0.08 * s), metal);
    plate.position.set(0, 1.02 * s, -0.28 * s);
    grp.add(plate);
    // 火焰（additive 发光，运行时脉动）
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x66b0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.jetFlames = [];
    for (const sx of [-0.13, 0.13]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5, 7), flameMat.clone());
      f.position.set(sx * s, 0.6 * s, -0.22 * s); f.rotation.x = Math.PI;   // 尖朝下
      grp.add(f);
      this.jetFlames.push(f);
    }
    this.root.add(grp);
    this.jetpack = grp;
  }

  /** 飞行 AI：无视地形，3D 朝玩家飞，逼近时下压去咬；喷气火焰脉动 */
  updateFlying(dt, playerPos, allEnemies, idx) {
    const pos = this.root.position;
    const to = _move.set(playerPos.x - pos.x, 0, playerPos.z - pos.z);
    const distXZ = to.length() || 1;
    to.divideScalar(distXZ);
    this.root.rotation.y = Math.atan2(to.x, to.z);

    // 悬停高度：远处高空巡航，逼近时压到玩家胸口
    const hoverH = distXZ > 4 ? this.flyHeight : 1.2;
    const wantY = hoverH + Math.sin(performance.now() * 0.004 + this.phase) * 0.25;

    // 分离（只在 XZ，避免飞尸叠一起）
    let px = 0, pz = 0;
    for (let j = 0; j < allEnemies.length; j++) {
      if (j === idx) continue;
      const o = allEnemies[j];
      if (o.dead || !o.flying) continue;
      const dx = pos.x - o.root.position.x, dz = pos.z - o.root.position.z;
      const d = Math.hypot(dx, dz);
      const minD = (this.scaleFactor + o.scaleFactor) * 0.6;
      if (d < minD && d > 0.001) { px += (dx / d) * (minD - d); pz += (dz / d) * (minD - d); }
    }

    const stop = distXZ <= CFG.攻击距离 + 0.4;
    const fwd = stop ? 0 : this.speed;
    pos.x += (to.x * fwd + px * 3) * dt;
    pos.z += (to.z * fwd + pz * 3) * dt;
    pos.y += (wantY - pos.y) * Math.min(1, dt * 3);
    pos.x = Math.max(-this.bound, Math.min(this.bound, pos.x));
    pos.z = Math.max(-this.bound, Math.min(this.bound, pos.z));

    // 喷气火焰脉动
    if (this.jetFlames) for (const f of this.jetFlames) { f.scale.set(1, 0.7 + Math.random() * 0.7, 1); f.material.opacity = 0.6 + Math.random() * 0.4; }

    // 攻击（3D 距离近就咬）
    this.attackTimer -= dt;
    let didAttack = 0;
    const d3 = Math.hypot(playerPos.x - pos.x, playerPos.y - pos.y, playerPos.z - pos.z);
    if (d3 <= CFG.攻击距离 + 0.7 && this.attackTimer <= 0) {
      this.attackTimer = CFG.攻击间隔 * this.atkIntervalMul;
      didAttack = this.damage;
      this.armL.rotation.x = -2.4; this.armR.rotation.x = -2.4;
    }
    this.armL.rotation.x += (-1.6 - this.armL.rotation.x) * Math.min(1, dt * 6);
    this.armR.rotation.x += (-1.6 - this.armR.rotation.x) * Math.min(1, dt * 6);
    this.phase += dt * 6;
    this.legL.rotation.x = 0.3 + Math.sin(this.phase) * 0.12;   // 腿垂着晃
    this.legR.rotation.x = 0.3 - Math.sin(this.phase) * 0.12;

    if (this.hpBar.visible) {
      const ratio = Math.max(0, this.hp / this.maxHp);
      this.hpBar.scale.x = ratio;
      this.hpBar.position.x = -(1 - ratio) * 0.34 * this.scaleFactor;
      this.hpBar.material.color.setRGB(1 - ratio, ratio, 0.15);
    }
    this.growlTimer -= dt;
    if (this.growlTimer <= 0) { this.growlTimer = 3 + Math.random() * 5; playGrowl(distXZ); }

    return { didAttack };
  }

  /** 冻住：不能动，freezeTimer 秒后解冻即死 */
  freeze(dur) {
    if (this.dead) return;
    this.frozen = true;
    this.freezeTimer = Math.max(this.freezeTimer, dur);
  }

  /** 受到伤害。返回是否致死。 */
  takeDamage(dmg, fromDir, effects, worldHitPoint) {
    if (this.dead) return false;
    this.hp -= dmg;
    this.hurtFlash = 0.12;
    if (打击感.击退) this.knockback.addScaledVector(fromDir, Math.min(3.2, dmg * 0.05) * 打击感.击退强度);

    this.hpBar.visible = true;
    this.hpBarBg.visible = true;

    if (this.hp <= 0) {
      this.die(effects);
      return true;
    }
    return false;
  }

  die(effects) {
    this.dead = true;
    playDeath();
    // 简单的"倒下"标记，让主循环做散架动画
    this.deathTimer = 0.6;
    this.hpBar.visible = false;
    this.hpBarBg.visible = false;
    if (this.jetFlames) for (const f of this.jetFlames) f.visible = false;   // 熄火
    // 空中死亡：抛射下坠，落地后再倒地成尸（updateAirborne 接管）
    if (this.flying && this.root.position.y > 0.3) {
      this.airborne = true;
      this.vel.set((Math.random() - 0.5) * 2, 1.4, (Math.random() - 0.5) * 2);
      this.spin.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);
    }
    // 死亡碎裂碎片（用身体颜色）
    if (effects && 打击感.死亡碎裂粒子) {
      effects.addDebris(this.root.position, this.bodyMat.color.getHex(), Math.round(11 * this.scaleFactor));
    }
  }

  /**
   * 受到爆炸冲击波：范围内造成伤害 + 把身体斜向上震飞。
   * bonus = 直接命中的额外伤害。返回 {killed, wasAlive} 或 null（不在范围内）。
   */
  applyBlast(center, radius, maxDmg, impulse, effects, bonus = 0) {
    const pos = this.root.position;
    const dx = pos.x - center.x, dz = pos.z - center.z;
    const dy = (1.0 * this.scaleFactor) - center.y;
    const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
    if (dist > radius) return null;

    const f = 1 - dist / radius;                 // 0（边缘）~ 1（爆心）
    const wasAlive = !this.dead;

    // 震飞：水平朝外 + 一个向上的分量
    let hx = dx, hz = dz;
    if (hx * hx + hz * hz < 0.0004) { hx = Math.random() - 0.5; hz = Math.random() - 0.5; }
    const hl = Math.hypot(hx, hz) || 1;
    const power = impulse * (0.45 + f);
    this.vel.set((hx / hl) * power, 7 + f * 11, (hz / hl) * power);
    this.airborne = true;
    this.spin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);

    // 伤害（只对活着的结算）
    let killed = false;
    if (wasAlive) {
      const dmg = maxDmg * (0.35 + 0.65 * f) + bonus;
      this.hp -= dmg;
      this.hpBar.visible = true;
      this.hpBarBg.visible = true;
      if (this.hp <= 0) { this.die(effects); killed = true; }
    }
    return { killed, wasAlive, dist };
  }

  /** 被震飞后的弹道运动（飞行、翻滚、落地） */
  updateAirborne(dt) {
    const G = 22;
    const pos = this.root.position;
    this.vel.y -= G * dt;
    pos.x += this.vel.x * dt;
    pos.y += this.vel.y * dt;
    pos.z += this.vel.z * dt;

    // 翻滚
    this.root.rotation.x += this.spin.x * dt;
    this.root.rotation.y += this.spin.y * dt;
    this.root.rotation.z += this.spin.z * dt;

    // 别飞出场地
    const B = this.bound;
    pos.x = Math.max(-B, Math.min(B, pos.x));
    pos.z = Math.max(-B, Math.min(B, pos.z));

    if (pos.y <= 0) {
      pos.y = 0;
      const hard = Math.abs(this.vel.y) > 7;
      this.vel.set(0, 0, 0);
      this.airborne = false;
      if (this.dead) {
        this.deathTimer = 0.6;                 // 落地后开始下沉消失
      } else {
        this.root.rotation.set(0, 0, 0);       // 站回来
        if (hard) {                            // 摔得重就掉血
          this.hp -= 12;
          if (this.hp <= 0) this.die();
        }
      }
    }
    return { didAttack: 0 };
  }

  update(dt, playerPos, level, allEnemies, idx) {
    // 被震飞时走弹道，跳过一切正常 AI
    if (this.airborne) return this.updateAirborne(dt);

    if (this.dead) {
      // 死亡：向后仰倒贴地（不再缩小/消失；倒下后交给主循环转成永久尸体）
      this.deathTimer -= dt;
      this.root.rotation.x = Math.min(Math.PI / 2, this.root.rotation.x + dt * 4);
      if (this.root.position.y > 0.05) this.root.position.y = Math.max(0.05, this.root.position.y - dt * 0.5);
      return this.deathTimer > 0;   // false = 倒地完成，主循环把它烘焙成尸体
    }

    // 被冻住：定住不动、冰蓝发光；解冻(freezeTimer<=0)即死
    if (this.frozen) {
      this.freezeTimer -= dt;
      this.bodyMat.emissive.setRGB(0.12, 0.46, 0.72);
      this.headMat.emissive.setRGB(0.12, 0.46, 0.72);
      this.knockback.set(0, 0, 0);
      if (this.freezeTimer <= 0) {
        this.frozen = false;
        this.bodyMat.emissive.setRGB(0, 0, 0);
        this.headMat.emissive.setRGB(0, 0, 0);
        this.die();                 // 解冻即死
      }
      return { didAttack: 0 };
    }

    // 受击闪红
    if (this.hurtFlash > 0) {
      this.hurtFlash -= dt;
      const f = Math.max(0, this.hurtFlash / 0.12);
      // 受击瞬间偏白热，随后回落到红（更有打击感）
      const g = 打击感.受击闪白 ? f * 0.6 : 0;
      this.bodyMat.emissive.setRGB(f, g, g * 0.9);
      this.headMat.emissive.setRGB(f, g, g * 0.9);
    }

    // 会飞的走独立飞行 AI（无视地形/流场/台阶）
    if (this.flying) return this.updateFlying(dt, playerPos, allEnemies, idx);

    const pos = this.root.position;
    const toPlayer = new THREE.Vector3().subVectors(playerPos, pos);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    toPlayer.normalize();

    // 面向玩家
    const targetAngle = Math.atan2(toPlayer.x, toPlayer.z);
    this.root.rotation.y = targetAngle;

    // 是否和玩家在同一层（playerPos 是眼睛高度，减去约 1.7 得脚下楼层）
    const sameLevel = Math.abs((playerPos.y - 1.7) - pos.y) < 1.4;

    // 攻击（必须同层，避免从楼下/楼上隔空咬）
    this.attackTimer -= dt;
    let didAttack = 0;
    if (sameLevel && dist <= CFG.攻击距离 + this.scaleFactor * 0.3) {
      if (this.attackTimer <= 0) {
        this.attackTimer = CFG.攻击间隔;
        didAttack = this.damage;
        // 攻击摆臂
        this.armL.rotation.x = -2.4;
        this.armR.rotation.x = -2.4;
      }
    }

    // 导航：默认直冲玩家。玩家在高台上时，处于东侧台阶通道的僵尸主动沿台阶往上爬（朝 -x + 归中线）；
    // 其余远处用流场绕障碍找通路。
    let navX = toPlayer.x, navZ = toPlayer.z;
    const onStair = pos.x > 3.5 && pos.x < 12.5 && Math.abs(pos.z) < 3.6;
    const nearPlatform = Math.abs(pos.x) < 9 && Math.abs(pos.z) < 9;
    if (onStair && !sameLevel && pos.y < 3.0) {
      navX = -1; navZ = -pos.z * 0.6;                       // 在台阶：向平台爬 + 归中线
    } else if (nearPlatform && !sameLevel && pos.y < 0.5 && level.stairEntrance) {
      navX = level.stairEntrance.x - pos.x;                 // 玩家在台上→先去东侧台阶口
      navZ = level.stairEntrance.z - pos.z;
    } else if (level.flow && dist > 3 && pos.y < 0.5 && level.flow.dir(pos.x, pos.z, _navDir)) {
      navX = _navDir.x * 0.8 + toPlayer.x * 0.2;            // 流场为主+一点直冲，走位更顺
      navZ = _navDir.z * 0.8 + toPlayer.z * 0.2;
    }

    // 移动：沿导航方向 + 避开其它丧尸（防止全部挤成一坨）
    const move = _move.set(navX, 0, navZ);
    for (let j = 0; j < allEnemies.length; j++) {
      if (j === idx) continue;
      const other = allEnemies[j];
      if (other.dead) continue;
      const d = pos.distanceTo(other.root.position);
      const minD = (this.scaleFactor + other.scaleFactor) * 0.5;
      if (d < minD && d > 0.001) {
        const push = new THREE.Vector3().subVectors(pos, other.root.position);
        push.y = 0;
        move.addScaledVector(push.normalize(), (minD - d) / minD * 0.8);
      }
    }
    move.normalize();

    // 只有"同层且已贴近"才停下打；玩家在楼上时继续移动去爬楼
    const speed = (dist <= CFG.攻击距离 && sameLevel) ? 0 : this.speed;
    const prev = pos.clone();
    pos.x += move.x * speed * dt + this.knockback.x * dt;
    pos.z += move.z * speed * dt + this.knockback.z * dt;
    this.knockback.multiplyScalar(1 - Math.min(1, dt * 8));

    // 撞墙检测：滑动（可跨上矮台阶）
    this.resolveCollision(level, prev);

    // 跟随地面高度：踩台阶上高台，走下边缘会落下
    const gy = this.groundHeight(level);
    if (gy >= pos.y - 0.02) { pos.y = gy; this.fallV = 0; }        // 站上/踏台阶
    else { this.fallV = (this.fallV || 0) - 22 * dt; pos.y = Math.max(gy, pos.y + this.fallV * dt); }

    // 走路动画（腿和身体上下晃）
    this.phase += dt * speed * 2.2;
    const swing = Math.sin(this.phase) * 0.5;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.torso.position.y = 1.0 * this.scaleFactor + Math.abs(Math.sin(this.phase)) * 0.04;
    // 手臂回位
    this.armL.rotation.x += (-1.3 - this.armL.rotation.x) * Math.min(1, dt * 6);
    this.armR.rotation.x += (-1.3 - this.armR.rotation.x) * Math.min(1, dt * 6);

    // 血条更新
    if (this.hpBar.visible) {
      const ratio = Math.max(0, this.hp / this.maxHp);
      this.hpBar.scale.x = ratio;
      this.hpBar.position.x = -(1 - ratio) * 0.34 * this.scaleFactor;
      this.hpBar.material.color.setRGB(1 - ratio, ratio, 0.15);
    }

    // 吼叫
    this.growlTimer -= dt;
    if (this.growlTimer <= 0) {
      this.growlTimer = 3 + Math.random() * 5;
      playGrowl(dist);
    }

    return { didAttack };
  }

  resolveCollision(level, prev) {
    const pos = this.root.position;
    const r = this.scaleFactor * 0.3;
    const footY = pos.y;
    for (const c of level.colliders) {
      if (c.max.y <= 0.5) continue;                    // 地面级，忽略
      if (footY >= c.max.y - 0.02) continue;           // 已站在其上/更高，可横穿顶面
      if (c.max.y - footY <= 0.9) continue;            // 可跨上的矮台阶，不挡
      const cx = Math.max(c.min.x, Math.min(pos.x, c.max.x));
      const cz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 0.0001;
        pos.x = cx + (dx / d) * r;
        pos.z = cz + (dz / d) * r;
      }
    }
  }

  /** 脚下地面高度：踩在其上/可跨上的最高碰撞盒顶面（否则 0） */
  groundHeight(level) {
    const pos = this.root.position;
    const r = this.scaleFactor * 0.3;
    let g = 0;
    for (const c of level.colliders) {
      if (pos.x > c.min.x - r && pos.x < c.max.x + r && pos.z > c.min.z - r && pos.z < c.max.z + r) {
        if (pos.y >= c.max.y - 0.9 && c.max.y > g) g = c.max.y;
      }
    }
    return g;
  }

  // 让血条永远面向相机
  faceBar(camera) {
    if (!this.hpBar.visible) return;
    this.hpBar.quaternion.copy(camera.quaternion);
    this.hpBarBg.quaternion.copy(camera.quaternion);
  }

  remove() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose?.(); }
    });
  }

  /**
   * 把身体各部件烘焙成一个"躺平的尸体"网格（合并=1 draw call），供主循环长期保留。
   * 返回 { mesh, pos, radius }，主循环负责放进当前地图分组。返回后本 enemy 可 remove()。
   */
  bakeCorpse() {
    const parts = [this.torso, this.head, this.legL, this.legR, this.armL, this.armR];
    const geos = [];
    for (const m of parts) {
      m.updateMatrix();
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrix);      // 把部件在 root 内的位姿烘进几何
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) return null;
    // 尸体材质：顶点色 × 暗灰，看起来发暗（死气）
    const mat = new THREE.MeshStandardMaterial({ color: 0x8f9488, vertexColors: true, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.position.set(this.root.position.x, 0.06, this.root.position.z);
    mesh.rotation.y = this.root.rotation.y;
    mesh.rotation.x = Math.PI / 2;   // 仰面躺倒
    return { mesh, pos: mesh.position.clone(), radius: 0.7 * this.scaleFactor };
  }
}
