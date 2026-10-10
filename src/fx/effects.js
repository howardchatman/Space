import * as THREE from 'three';
import { glowTexture, puffTexture, ringTexture } from './textures.js';
import { rand, randomUnit } from '../util/math.js';

const MAX_SPARKS = 1600;
const FIRE = [new THREE.Color(1, 0.95, 0.8), new THREE.Color(1, 0.55, 0.18), new THREE.Color(0.5, 0.12, 0.04)];

/**
 * Explosions, impact sparks, debris and warp flashes. Sprites and debris are pooled so nothing is
 * allocated mid-fight, and two point lights are reused for explosion flashes (adding lights at runtime
 * would force every material to recompile).
 */
export class Effects {
  constructor(scene, rockGeometry, rockMaterial) {
    this.scene = scene;
    this.sprites = [];
    this.spritePool = [];
    this.debris = [];
    this.debrisPool = [];
    this.rockGeometry = rockGeometry;
    this.rockMaterial = rockMaterial;

    this.lights = [0, 1].map(() => {
      const light = new THREE.PointLight(0xffaa66, 0, 0, 2);
      scene.add(light);
      return { light, life: 0, max: 1, peak: 0 };
    });

    // Sparks: one Points cloud, positions and colors rewritten each frame.
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    this.sparkCol = new Float32Array(MAX_SPARKS * 3);
    this.sparkVel = new Float32Array(MAX_SPARKS * 3);
    this.sparkBase = new Float32Array(MAX_SPARKS * 3);
    this.sparkLife = new Float32Array(MAX_SPARKS);
    this.sparkMax = new Float32Array(MAX_SPARKS);
    this.sparkCount = 0;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 500 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        uniform float uScale;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(0.9 * uScale / -mv.z, 1.5, 24.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(c, c);
          if (r2 > 1.0) discard;
          gl_FragColor = vec4(vColor, exp(-r2 * 3.0));
        }
      `,
    });
    this.sparks = new THREE.Points(geometry, this.sparkMaterial);
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
  }

  /** Pixels per meter at 1 m distance, so spark sizes stay in world units. */
  setViewScale(scale) {
    this.sparkMaterial.uniforms.uScale.value = scale;
  }

  explosion(position, size, { tint = FIRE, debris = 0, light = true } = {}) {
    // Flash, fireball puffs, a shockwave and a spray of sparks.
    this.#sprite(glowTexture(), position, { size: size * 1.5, grow: 1.2, life: 0.18, color: tint[0], intensity: 2.6 });
    const puffs = Math.round(4 + size / 12);
    for (let i = 0; i < puffs; i++) {
      const offset = randomUnit(new THREE.Vector3()).multiplyScalar(size * rand(0, 0.45));
      this.#sprite(puffTexture(), offset.add(position), {
        size: size * rand(0.8, 1.4),
        grow: rand(1.6, 2.4),
        life: rand(0.45, 0.85),
        color: tint[1],
        intensity: 1.1,
        fadeTo: tint[2],
        rotation: rand(0, Math.PI * 2),
        drift: randomUnit(new THREE.Vector3()).multiplyScalar(size * 0.15),
      });
    }
    this.#sprite(ringTexture(), position, { size: size * 0.6, grow: 5, life: 0.45, color: tint[1], intensity: 0.9 });
    this.sparkBurst(position, Math.round(30 + size * 1.2), tint[1], size * 2.2);
    for (let i = 0; i < debris; i++) this.#debris(position, size);
    if (light) this.#flash(position, size);
  }

  /** Small burst where a bolt strikes something. */
  impact(position, color) {
    this.#sprite(glowTexture(), position, { size: 7, grow: 1.5, life: 0.12, color, intensity: 4 });
    this.sparkBurst(position, 10, color, 60);
  }

  /** The bright streak of a ship dropping out of warp. */
  warp(position, color) {
    this.#sprite(glowTexture(), position, { size: 30, grow: 0.2, life: 0.6, color, intensity: 5, stretch: 9 });
    this.#sprite(glowTexture(), position, { size: 70, grow: 0.3, life: 0.9, color, intensity: 1.2 });
    this.sparkBurst(position, 30, color, 120);
  }

  sparkBurst(position, count, color, speed) {
    for (let i = 0; i < count && this.sparkCount < MAX_SPARKS; i++) {
      const k = this.sparkCount++;
      const dir = randomUnit(new THREE.Vector3()).multiplyScalar(speed * rand(0.2, 1));
      this.sparkPos.set([position.x, position.y, position.z], k * 3);
      this.sparkVel.set([dir.x, dir.y, dir.z], k * 3);
      this.sparkBase.set([color.r * 3, color.g * 3, color.b * 3], k * 3);
      this.sparkLife[k] = this.sparkMax[k] = rand(0.35, 1.1);
    }
  }

  update(dt, camera) {
    for (const s of this.sprites) {
      s.life -= dt;
      const t = 1 - s.life / s.max; // 0 → 1 over its life
      s.sprite.scale.set(s.size * (1 + s.grow * t) * s.stretch, s.size * (1 + s.grow * t), 1);
      s.sprite.position.addScaledVector(s.drift, dt);
      const color = s.sprite.material.color;
      if (s.fadeTo) color.copy(s.color).lerp(s.fadeTo, Math.min(1, t * 1.3));
      else color.copy(s.color);
      color.multiplyScalar(s.intensity);
      s.sprite.material.opacity = Math.max(0, 1 - t) ** 1.5;
    }
    this.sprites = this.sprites.filter((s) => {
      if (s.life > 0) return true;
      this.scene.remove(s.sprite);
      this.spritePool.push(s.sprite);
      return false;
    });

    // Sparks: move, fade, and compact the live ones to the front of the buffers.
    let n = 0;
    const drag = Math.exp(-1.8 * dt);
    for (let i = 0; i < this.sparkCount; i++) {
      const life = this.sparkLife[i] - dt;
      if (life <= 0) continue;
      const o = i * 3;
      const d = n * 3;
      for (let a = 0; a < 3; a++) {
        const v = this.sparkVel[o + a] * drag;
        this.sparkVel[d + a] = v;
        this.sparkPos[d + a] = this.sparkPos[o + a] + v * dt;
        this.sparkBase[d + a] = this.sparkBase[o + a];
      }
      this.sparkLife[n] = life;
      this.sparkMax[n] = this.sparkMax[i];
      const f = life / this.sparkMax[n];
      for (let a = 0; a < 3; a++) this.sparkCol[d + a] = this.sparkBase[d + a] * f * f;
      n++;
    }
    this.sparkCount = n;
    const geo = this.sparks.geometry;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;

    for (const d of this.debris) {
      d.life -= dt;
      d.mesh.position.addScaledVector(d.velocity, dt);
      d.mesh.rotateOnAxis(d.axis, d.spin * dt);
      if (d.life < 0.6) d.mesh.scale.setScalar(d.size * Math.max(0.01, d.life / 0.6));
    }
    this.debris = this.debris.filter((d) => {
      if (d.life > 0) return true;
      this.scene.remove(d.mesh);
      this.debrisPool.push(d.mesh);
      return false;
    });

    for (const f of this.lights) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const t = Math.max(0, f.life / f.max);
      f.light.intensity = f.peak * t * t;
    }
  }

  clear() {
    for (const s of this.sprites) s.life = 0;
    for (const d of this.debris) d.life = 0;
    this.sparkCount = 0;
    for (const f of this.lights) {
      f.life = 0;
      f.light.intensity = 0;
    }
    this.update(0);
  }

  #sprite(map, position, { size, grow, life, color, intensity, fadeTo = null, rotation = 0, drift = null, stretch = 1 }) {
    let sprite = this.spritePool.pop();
    if (!sprite) {
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }));
    }
    sprite.material.map = map;
    sprite.material.rotation = rotation;
    sprite.material.needsUpdate = true;
    sprite.position.copy(position);
    this.scene.add(sprite);
    this.sprites.push({
      sprite,
      size,
      grow,
      life,
      max: life,
      color: color.clone(),
      fadeTo,
      intensity,
      stretch,
      drift: drift ?? new THREE.Vector3(),
    });
  }

  #debris(position, size) {
    let mesh = this.debrisPool.pop();
    if (!mesh) mesh = new THREE.Mesh(this.rockGeometry, this.rockMaterial);
    const chunk = rand(0.6, 1.6) * Math.max(1, size / 25);
    mesh.position.copy(position);
    mesh.scale.setScalar(chunk);
    this.scene.add(mesh);
    this.debris.push({
      mesh,
      size: chunk,
      velocity: randomUnit(new THREE.Vector3()).multiplyScalar(rand(10, 45)),
      axis: randomUnit(new THREE.Vector3()),
      spin: rand(-4, 4),
      life: rand(1.5, 3),
    });
  }

  #flash(position, size) {
    const slot = this.lights.reduce((a, b) => (a.life <= b.life ? a : b));
    slot.light.position.copy(position);
    slot.max = slot.life = 0.5;
    slot.peak = 12000 * Math.min(4, size / 20);
  }
}
