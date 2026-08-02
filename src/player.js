import * as THREE from 'three';
import { PLAYER, 手感 } from './config.js';

/**
 * 第一人称玩家：WASD 移动、鼠标看、跳跃、蹲、跑。
 * 用胶囊近似身体，靠 AABB 盒子做碰撞（可以贴墙滑行）。
 */
export class Player {
  constructor(camera, level) {
    this.camera = camera;
    this.level = level;

    this.pos = level.playerSpawn();
    this.pos.y = PLAYER.身高;
    this.vel = new THREE.Vector3();
    this.onGround = true;

    this.yaw = 0;           // 朝向 -z（面向场地中心）
    this.pitch = 0;
    this.extraPitch = 0;    // 后坐力等外部叠加的视角偏移
    this.extraYaw = 0;

    this.height = PLAYER.身高;
    this.targetHeight = PLAYER.身高;
    this.crouching = false;

    this.hp = PLAYER.最大生命;
    this.maxHp = PLAYER.最大生命;
    this.lastDamageTime = -999;
    this.alive = true;

    // 视觉：走路时相机的上下摆动
    this.bobPhase = 0;
    this.bobAmount = 0;

    // 输入状态
    this.keys = {};
    this.wantJump = false;

    this._tmp = new THREE.Vector3();
  }

  onKey(code, down) {
    this.keys[code] = down;
    if (code === 'Space' && down) this.wantJump = true;
  }

  onMouseMove(dx, dy) {
    const sens = 0.0022 * 手感.鼠标灵敏度;
    this.yaw -= dx * sens;
    const invert = 手感.上下反转 ? -1 : 1;
    this.pitch -= dy * sens * invert;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  takeDamage(dmg, time) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.lastDamageTime = time;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  get moveSpeed() {
    if (this.crouching) return PLAYER.蹲下速度;
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) return PLAYER.跑步速度;
    return PLAYER.走路速度;
  }

  update(dt, time) {
    // ---- 蹲下 ----
    this.crouching = !!(this.keys['ControlLeft'] || this.keys['KeyC']);
    this.targetHeight = this.crouching ? PLAYER.蹲下身高 : PLAYER.身高;
    this.height += (this.targetHeight - this.height) * Math.min(1, dt * 12);

    // ---- 计算水平移动方向（相对视角）----
    const forward = this._tmp.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.sin(this.yaw - Math.PI / 2), 0, Math.cos(this.yaw - Math.PI / 2));
    const wish = new THREE.Vector3();
    if (this.keys['KeyW']) wish.sub(forward);
    if (this.keys['KeyS']) wish.add(forward);
    if (this.keys['KeyD']) wish.sub(right);
    if (this.keys['KeyA']) wish.add(right);
    const moving = wish.lengthSq() > 0.001;
    if (moving) wish.normalize().multiplyScalar(this.moveSpeed);

    // 地面上直接给速度；空中只给一点点操控
    const control = this.onGround ? 1 : PLAYER.空中操控;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, dt * 14 * control);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, dt * 14 * control);

    // ---- 跳跃 & 重力 ----
    if (this.wantJump && this.onGround) {
      this.vel.y = Math.sqrt(2 * PLAYER.重力 * PLAYER.跳跃高度);
      this.onGround = false;
    }
    this.wantJump = false;
    this.vel.y -= PLAYER.重力 * dt;

    // ---- 应用位移 + 碰撞 ----
    this.pos.x += this.vel.x * dt;
    this.resolveHoriz('x');
    this.pos.z += this.vel.z * dt;
    this.resolveHoriz('z');

    this.pos.y += this.vel.y * dt;
    this.resolveVert();

    // 掉出场地兜底
    if (this.pos.y < -20) { this.pos.set(0, PLAYER.身高, 20); this.vel.set(0, 0, 0); }

    // ---- 相机 ----
    this.updateCamera(dt, moving && this.onGround);
  }

  // 水平方向撞盒子 -> 把玩家推出去（滑行）
  resolveHoriz(axis) {
    const r = PLAYER.身体半径;
    const footY = this.pos.y - this.height;
    const headY = this.pos.y;
    for (const c of this.level.colliders) {
      if (headY < c.min.y || footY > c.max.y) continue;   // 高度不重叠
      const cx = Math.max(c.min.x, Math.min(this.pos.x, c.max.x));
      const cz = Math.max(c.min.z, Math.min(this.pos.z, c.max.z));
      const dx = this.pos.x - cx;
      const dz = this.pos.z - cz;
      if (dx * dx + dz * dz < r * r) {
        // 能不能踩上去（矮台阶）？留给竖直解算处理，这里只做水平阻挡
        const stepTop = c.max.y;
        if (stepTop - footY <= 0.85 && this.vel.y <= 0.01) continue; // 可跨上的台阶，不挡
        if (axis === 'x') this.pos.x = dx > 0 ? cx + r : cx - r;
        else this.pos.z = dz > 0 ? cz + r : cz - r;
      }
    }
  }

  // 竖直方向：落地 / 撞头 / 踩上平台
  resolveVert() {
    const r = PLAYER.身体半径;
    let groundY = 0;   // 默认地面高度
    for (const c of this.level.colliders) {
      // 水平范围是否重叠（考虑半径）
      const overlapX = this.pos.x > c.min.x - r && this.pos.x < c.max.x + r;
      const overlapZ = this.pos.z > c.min.z - r && this.pos.z < c.max.z + r;
      if (overlapX && overlapZ) {
        const footY = this.pos.y - this.height;
        // 站在这个盒子顶面上
        if (footY >= c.max.y - 0.6 && c.max.y > groundY) {
          groundY = c.max.y;
        }
        // 撞到盒子底面（跳起来顶头）
        if (this.vel.y > 0 && this.pos.y > c.min.y && this.pos.y - this.height < c.min.y) {
          if (this.pos.y - this.height < c.max.y && this.pos.y < c.min.y + 0.3) {
            this.pos.y = c.min.y - 0.02 + this.height;
            this.vel.y = 0;
          }
        }
      }
    }

    const feetTarget = groundY + this.height;
    if (this.pos.y <= feetTarget + 0.001) {
      this.pos.y = feetTarget;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
  }

  updateCamera(dt, walking) {
    // 走路头部摆动
    const speedRatio = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / PLAYER.跑步速度);
    this.bobAmount += ((walking ? speedRatio : 0) - this.bobAmount) * Math.min(1, dt * 8);
    this.bobPhase += dt * 11 * speedRatio;
    const bobY = Math.sin(this.bobPhase) * 0.035 * this.bobAmount * 手感.武器晃动;
    const bobX = Math.cos(this.bobPhase * 0.5) * 0.03 * this.bobAmount * 手感.武器晃动;

    this.camera.position.set(
      this.pos.x + bobX,
      this.pos.y + bobY,
      this.pos.z
    );
    const p = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, this.pitch + this.extraPitch));
    const y = this.yaw + this.extraYaw;
    const dir = new THREE.Vector3(
      Math.sin(y) * Math.cos(p),
      Math.sin(p),
      Math.cos(y) * Math.cos(p)
    );
    this.camera.lookAt(this._tmp.copy(this.camera.position).sub(dir));
  }

  respawn() {
    this.pos = this.level.playerSpawn();
    this.pos.y = PLAYER.身高;
    this.vel.set(0, 0, 0);
    this.hp = this.maxHp;
    this.alive = true;
    this.pitch = 0;
    this.yaw = 0;
  }
}
