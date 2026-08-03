import * as THREE from 'three';
import { 武器, 手感 } from './config.js';
import { playShot, playReload, playDryFire, playHitmarker, playRocketFire } from './audio.js';
import { makeWeaponMesh } from './graphics/voxel/weapons.js';

const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

/**
 * 武器系统：管理当前枪、弹药、换弹、后坐力、开火节奏、第一人称枪模型。
 * 真正的"子弹打中谁"由 main.js 用射线处理；这里负责决定
 * 每次开火射出几条射线、各自的方向（含扩散），并驱动手感反馈。
 */
export class WeaponSystem {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;

    this.slots = ['手枪', '步枪', '霰弹枪', '火箭筒', '狙击枪'];
    this.ammo = {};       // 每把枪的当前弹匣/备弹
    for (const k of this.slots) {
      this.ammo[k] = { mag: 武器[k].弹匣, reserve: 武器[k].备弹 };
    }
    this.current = '步枪';
    this.previous = '手枪';        // 上一把武器（Q 快速切换用）

    this.fireCooldown = 0;
    this.reloading = false;
    this.reloadTime = 0;
    this.triggerHeld = false;
    this.triggerConsumed = false;

    // 后坐力（累积的准星抬升，之后平滑恢复）
    this.recoilPitch = 0;
    this.recoilYaw = 0;

    // 枪模型（挂在相机上的"手臂"）
    this.viewGroup = new THREE.Group();
    camera.add(this.viewGroup);
    this.muzzleFlash = null;
    this.buildViewModel();

    // 后坐动画：枪往后弹
    this.kickZ = 0;

    this.movementFactor = 0;   // 移动量，用来加大扩散
  }

  get cfg() { return 武器[this.current]; }

  buildViewModel() {
    // 清掉旧的
    while (this.viewGroup.children.length) this.viewGroup.remove(this.viewGroup.children[0]);

    // 体素枪：body + mag + slide 三部件（顶点色，一个材质）
    const W = makeWeaponMesh(this.current);
    const gunMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.72, metalness: 0.1,   // 低金属度，避免头灯把枪面打成惨白
      emissive: 0x24272d, emissiveIntensity: 0.55,           // 暗处也看得清枪身细节
    });
    const gun = new THREE.Group();
    const body = new THREE.Mesh(W.body, gunMat);
    const mag = new THREE.Mesh(W.mag, gunMat);
    const slide = new THREE.Mesh(W.slide, gunMat);
    gun.add(body, mag, slide);
    this.gun = gun;
    this.mag = mag; this.magHome = mag.position.clone();
    this.slide = slide; this.slideHome = slide.position.clone();
    this.viewGroup.add(gun);

    // 枪口火光（默认隐藏）
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffdd88, transparent: true, blending: THREE.AdditiveBlending, depthTest: false,
    });
    this.muzzleFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), flashMat);
    this.muzzleFlash.position.copy(W.muzzle);
    this.muzzleFlash.visible = false;
    gun.add(this.muzzleFlash);

    // 摆放到屏幕右下（体素枪较长，缩小到合适手持大小）
    this.viewGroup.scale.setScalar(0.5);
    this.viewGroup.position.set(0.19, -0.2, -0.32);
    this.viewGroup.rotation.set(0, 0.08, 0);   // 略微内旋，看得到侧面细节
    this.gun.rotation.set(0, 0, 0);
    this.baseGunPos = this.viewGroup.position.clone();

    // 动画状态
    this.kickRot = 0;          // 开火时枪口上翻
    this.slidePull = 0;        // 套筒后拉量 0~1
    this.drawT = 1;            // 掏枪动画进度（1=完成）
    this.swayX = 0; this.swayY = 0;
  }

  switchTo(name) {
    if (name === this.current || this.reloading) return;
    if (!this.slots.includes(name)) return;
    this.previous = this.current;    // 记住上一把
    this.current = name;
    this.fireCooldown = 0.22;
    this.buildViewModel();
    this.drawT = 0;                  // 触发掏枪动画（从下方抬起）
  }

  switchByIndex(i) {
    if (this.slots[i]) this.switchTo(this.slots[i]);
  }

  /** CS 风格：快速切回上一把武器 */
  quickSwitch() {
    if (this.previous) this.switchTo(this.previous);
  }

  startReload() {
    const a = this.ammo[this.current];
    if (this.reloading) return;
    if (a.mag >= this.cfg.弹匣 || a.reserve <= 0) return;
    this.reloading = true;
    this.reloadTime = this.cfg.换弹时间;
    playReload(0);
  }

  finishReload() {
    const a = this.ammo[this.current];
    // 换弹丢弃弹夹里剩余的子弹（相当于抛弃），从备弹里换一整夹
    const load = Math.min(this.cfg.弹匣, a.reserve);
    a.mag = load;
    a.reserve -= load;
    this.reloading = false;
    playReload(1);
  }

  setTrigger(down) {
    this.triggerHeld = down;
    if (down) this.triggerConsumed = false;
  }

  /**
   * 每帧调用。返回本帧需要处理的射击（可能为 null）：
   *   { rays: [方向...], damage, headMul, range }
   * rays 是若干个已带扩散的世界方向向量。
   */
  update(dt, moving, aiming, yawDelta = 0) {
    this.fireCooldown -= dt;

    // 后坐力恢复
    this.recoilPitch *= Math.max(0, 1 - dt * 6);
    this.recoilYaw *= Math.max(0, 1 - dt * 6);

    // ---- 换弹动画：枪下沉倾斜 + 弹匣掉出再插入 + 上膛拉套筒 ----
    if (this.reloading) {
      this.reloadTime -= dt;
      const t = 1 - this.reloadTime / this.cfg.换弹时间;    // 0→1
      const dip = Math.sin(Math.min(Math.PI, t * Math.PI));  // 下沉包络
      this.viewGroup.position.y = this.baseGunPos.y - 0.14 * dip;
      this.gun.rotation.x = 0.55 * dip;
      this.gun.rotation.z = 0.35 * dip;
      // 弹匣：0.15~0.4 掉出，0.5~0.72 插回
      let magDrop = 0;
      if (t < 0.4) magDrop = smooth((t - 0.15) / 0.25);          // 掉出
      else if (t < 0.72) magDrop = 1 - smooth((t - 0.5) / 0.22); // 插回
      this.mag.position.y = this.magHome.y - magDrop * 0.16;
      this.mag.visible = magDrop < 0.98;
      // 收尾拉套筒上膛
      this.slidePull = t > 0.82 ? Math.sin((t - 0.82) / 0.18 * Math.PI) : 0;
      if (this.reloadTime <= 0) this.finishReload();
    } else {
      this.gun.rotation.x += (this.kickRot - this.gun.rotation.x) * Math.min(1, dt * 14);
      this.gun.rotation.z += (0 - this.gun.rotation.z) * Math.min(1, dt * 12);
      this.mag.position.y += (this.magHome.y - this.mag.position.y) * Math.min(1, dt * 20);
      this.mag.visible = true;
    }

    // ---- 开火后坐恢复 ----
    this.kickZ *= Math.max(0, 1 - dt * 12);
    this.kickRot *= Math.max(0, 1 - dt * 14);
    this.slidePull *= Math.max(0, 1 - dt * 22);
    // 套筒后拉
    this.slide.position.z = this.slideHome.z + this.slidePull * 0.08;

    // ---- 掏枪动画：从下方抬起 ----
    this.drawT = Math.min(1, this.drawT + dt * 4.5);
    const drawOff = (1 - this.drawT);

    // ---- 转视角时枪身滞后摆动（sway）----
    this.swayX += (-yawDelta * 4 - this.swayX) * Math.min(1, dt * 8);
    this.swayX = Math.max(-0.25, Math.min(0.25, this.swayX));

    this.viewGroup.position.z = this.baseGunPos.z + this.kickZ;
    if (!this.reloading) {
      this.viewGroup.position.y += (this.baseGunPos.y - 0.5 * drawOff - this.viewGroup.position.y) * Math.min(1, dt * 12);
    }
    this.viewGroup.rotation.z += (this.swayX * 0.5 - this.viewGroup.rotation.z) * Math.min(1, dt * 10);
    // 开镜时枪往中间收（掏枪时也从右下抬进来）
    const aimX = aiming ? 0.0 : 0.16;
    this.viewGroup.position.x += (aimX + this.swayX * 0.12 + drawOff * 0.15 - this.viewGroup.position.x) * Math.min(1, dt * 12);

    // 火光淡出
    if (this.muzzleFlash.visible) {
      this.muzzleFlash.material.opacity -= dt * 22;
      this.muzzleFlash.scale.multiplyScalar(1 + dt * 6);
      if (this.muzzleFlash.material.opacity <= 0) this.muzzleFlash.visible = false;
    }

    this.movementFactor = moving ? 1 : 0;

    // 能不能开火
    const c = this.cfg;
    const wantFire = this.triggerHeld && (c.连发 || !this.triggerConsumed);
    if (!wantFire || this.reloading || this.fireCooldown > 0) return null;

    const a = this.ammo[this.current];
    if (a.mag <= 0) {
      // 空仓：有备弹就自动换弹，没备弹才空响
      if (a.reserve > 0) this.startReload();
      else if (!this.triggerConsumed) { playDryFire(); this.triggerConsumed = true; }
      return null;
    }

    // ---- 开火 ----
    this.triggerConsumed = true;
    a.mag--;
    this.fireCooldown = 60 / c.射速;
    // 打空最后一发：自动换弹
    if (a.mag <= 0 && a.reserve > 0) this.startReload();

    // 火光
    this.muzzleFlash.visible = true;
    this.muzzleFlash.material.opacity = 1;
    this.muzzleFlash.scale.setScalar(0.7 + Math.random() * 0.5);
    this.muzzleFlash.rotation.z = Math.random() * Math.PI;

    // 后坐动画：枪后座 + 枪口上翻 + 拉套筒
    this.kickZ = 0.05 * c.后坐力;
    this.kickRot = -Math.min(0.5, 0.05 * c.后坐力);   // 枪口上翻（绕 x 负向）
    if (!c.是火箭) this.slidePull = 1;                 // 套筒瞬间后拉

    // 后坐力：抬准星（火箭筒踢得很猛）
    this.recoilPitch += c.后坐力 * 0.006 * (0.7 + Math.random() * 0.6);
    this.recoilYaw += (Math.random() - 0.5) * c.后坐力水平 * 0.004;

    // ---- 火箭筒：发射一枚会飞的火箭，交给 main 生成 ----
    if (c.是火箭) {
      playRocketFire();
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const origin = new THREE.Vector3();
      this.muzzleFlash.getWorldPosition(origin);
      return { rocket: true, origin, dir };
    }

    playShot(c.音色);

    // 扩散：基础 + 移动惩罚，开镜减半
    let spreadDeg = c.扩散 + this.movementFactor * c.移动扩散;
    if (aiming) spreadDeg *= 0.4;
    // 狙击枪不开镜时腰射极不准，逼你开镜
    if (c.是狙击 && !aiming) spreadDeg += c.腰射惩罚 ?? 9;

    // 计算相机前方
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    const rays = [];
    const pellets = c.霰弹数;
    for (let i = 0; i < pellets; i++) {
      rays.push(this.spreadDir(camDir, spreadDeg));
    }

    return {
      rays,
      damage: c.伤害,
      headMul: c.爆头倍率,
      range: c.射程,
      onHit: (isHead) => playHitmarker(isHead),
    };
  }

  // 在给定方向上加一个圆锥内的随机扰动
  spreadDir(baseDir, spreadDeg) {
    const rad = THREE.MathUtils.degToRad(spreadDeg);
    const dir = baseDir.clone();
    // 构造与 dir 垂直的两个轴
    const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, dir).normalize();
    const ang = Math.random() * Math.PI * 2;
    const mag = Math.random() * rad;
    dir.addScaledVector(right, Math.cos(ang) * Math.tan(mag));
    dir.addScaledVector(realUp, Math.sin(ang) * Math.tan(mag));
    return dir.normalize();
  }

  // 当前扩散（准星大小用）
  currentSpread() {
    let s = this.cfg.扩散 + this.movementFactor * this.cfg.移动扩散;
    return s;
  }

  ammoText() {
    const a = this.ammo[this.current];
    return `${a.mag} / ${a.reserve}`;
  }
}
