import * as THREE from 'three';
import { 画面 } from './config.js';

/** 视觉特效：弹孔、曳光弹、火花、命中飘字 */
export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    // --- 弹孔 ---
    this.holes = [];
    this.holeGeo = new THREE.CircleGeometry(0.055, 8);
    this.holeMat = new THREE.MeshBasicMaterial({
      color: 0x0a0a0a, transparent: true, opacity: 0.9,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    });

    // --- 曳光弹 ---
    this.tracers = [];
    this.tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
    this.tracerGeo.translate(0, 0.5, 0);
    this.tracerGeo.rotateX(Math.PI / 2);   // 让圆柱沿 +Z 方向延伸

    // --- 火花 ---
    this.sparks = [];
    this.sparkGeo = new THREE.SphereGeometry(0.035, 4, 3);

    // --- 爆炸 ---
    this.explos = [];
    this.fireballGeo = new THREE.SphereGeometry(1, 16, 12);
    this.shockGeo = new THREE.RingGeometry(0.75, 1, 44);

    // --- 飘字容器 ---
    this.floaters = [];
    this.floaterLayer = document.getElementById('floaters');
    this._v = new THREE.Vector3();
  }

  /** 火箭爆炸：火球 + 地面冲击波环 + 闪光 + 火花 */
  addExplosion(point, radius = 8) {
    // 火球
    const fb = new THREE.Mesh(this.fireballGeo, new THREE.MeshBasicMaterial({
      color: 0xffcc55, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    fb.position.copy(point);
    fb.scale.setScalar(radius * 0.25);
    this.scene.add(fb);
    this.explos.push({ o: fb, kind: 'fireball', age: 0, life: 0.5, r: radius });

    // 地面冲击波环
    const ring = new THREE.Mesh(this.shockGeo, new THREE.MeshBasicMaterial({
      color: 0xffddaa, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(point.x, 0.15, point.z);
    ring.scale.setScalar(radius * 0.3);
    this.scene.add(ring);
    this.explos.push({ o: ring, kind: 'ring', age: 0, life: 0.55, r: radius });

    // 闪光灯
    const light = new THREE.PointLight(0xffaa44, 500, radius * 4, 2);
    light.position.copy(point).setY(point.y + 1.2);
    this.scene.add(light);
    this.explos.push({ o: light, kind: 'light', age: 0, life: 0.28 });

    // 向上喷的火花
    this.addSparks(point, new THREE.Vector3(0, 1, 0), 22, 0xffbb44);
  }

  addBulletHole(point, normal) {
    const m = new THREE.Mesh(this.holeGeo, this.holeMat);
    m.position.copy(point).addScaledVector(normal, 0.012);
    m.lookAt(this._v.copy(point).add(normal));
    m.userData.born = performance.now();
    this.scene.add(m);
    this.holes.push(m);
    while (this.holes.length > 画面.弹孔上限) {
      const old = this.holes.shift();
      this.scene.remove(old);
    }
  }

  addTracer(from, to, color = 0xffd98a) {
    const dist = from.distanceTo(to);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.75, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(this.tracerGeo, mat);
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, dist);
    m.userData.life = 0.06;
    m.userData.age = 0;
    this.scene.add(m);
    this.tracers.push(m);
  }

  addSparks(point, normal, count = 6, color = 0xffbb55) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const s = new THREE.Mesh(this.sparkGeo, mat);
      s.position.copy(point);
      const v = normal.clone()
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.3))
        .normalize().multiplyScalar(2.5 + Math.random() * 4);
      s.userData.vel = v;
      s.userData.life = 0.25 + Math.random() * 0.25;
      s.userData.age = 0;
      this.scene.add(s);
      this.sparks.push(s);
    }
  }

  /** 命中飘字（世界坐标 -> 屏幕坐标） */
  addFloatingNumber(worldPos, text, kind = 'hit') {
    const el = document.createElement('div');
    el.className = `floater ${kind}`;
    el.textContent = text;
    this.floaterLayer.appendChild(el);
    this.floaters.push({
      el,
      pos: worldPos.clone(),
      age: 0,
      life: 0.9,
      drift: (Math.random() - 0.5) * 26,
    });
  }

  update(dt) {
    // 曳光弹
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.userData.age += dt;
      const k = 1 - t.userData.age / t.userData.life;
      if (k <= 0) {
        this.scene.remove(t);
        t.material.dispose();
        this.tracers.splice(i, 1);
      } else {
        t.material.opacity = 0.75 * k;
      }
    }

    // 火花
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.userData.age += dt;
      const k = 1 - s.userData.age / s.userData.life;
      if (k <= 0) {
        this.scene.remove(s);
        s.material.dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      s.userData.vel.y -= 12 * dt;
      s.position.addScaledVector(s.userData.vel, dt);
      s.material.opacity = k;
      s.scale.setScalar(0.4 + k * 0.6);
    }

    // 爆炸
    for (let i = this.explos.length - 1; i >= 0; i--) {
      const e = this.explos[i];
      e.age += dt;
      const k = e.age / e.life;
      if (k >= 1) {
        this.scene.remove(e.o);
        if (e.o.material) e.o.material.dispose();
        this.explos.splice(i, 1);
        continue;
      }
      if (e.kind === 'fireball') {
        e.o.scale.setScalar(e.r * (0.25 + k * 0.55));
        e.o.material.opacity = 1 - k;
        e.o.material.color.setRGB(1, 0.8 - k * 0.6, 0.35 - k * 0.35); // 黄->红
      } else if (e.kind === 'ring') {
        e.o.scale.setScalar(e.r * (0.3 + k * 1.0));
        e.o.material.opacity = 0.9 * (1 - k);
      } else if (e.kind === 'light') {
        e.o.intensity = 500 * (1 - k);
      }
    }

    // 弹孔淡出
    const nowMs = performance.now();
    for (const h of this.holes) {
      const age = (nowMs - h.userData.born) / 1000;
      if (age > 12) h.material = this.holeMat;
    }

    // 飘字
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      if (f.age >= f.life) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const k = f.age / f.life;
      this._v.copy(f.pos).project(this.camera);
      if (this._v.z > 1) { f.el.style.opacity = '0'; continue; }
      const x = (this._v.x * 0.5 + 0.5) * window.innerWidth + f.drift * k;
      const y = (-this._v.y * 0.5 + 0.5) * window.innerHeight - k * 55;
      f.el.style.transform = `translate(-50%,-50%) translate(${x}px, ${y}px) scale(${1.15 - k * 0.35})`;
      f.el.style.opacity = String(1 - k * k);
    }
  }
}
