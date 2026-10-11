import * as THREE from 'three';
import { glowTexture, ringTexture } from './textures.js';
import { rand, randomUnit } from '../util/math.js';

const MAX_SPARKS = 2400;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const FIRE = [new THREE.Color(1, 0.95, 0.8), new THREE.Color(1, 0.55, 0.18), new THREE.Color(0.5, 0.12, 0.04)];
const SMOKE = new THREE.Color(0.05, 0.045, 0.04);
const EMBER = new THREE.Color(1, 0.5, 0.16);

/**
 * A billowing fireball on a camera-facing quad: value-noise flames that cool from white through orange to
 * smoke as it ages. Premultiplied blending lets the flames add light while the smoke dims what's behind.
 * The quad is pulled toward the camera by its radius so it doesn't slice into the hull it's burning on.
 */
const FIREBALL_VERTEX = /* glsl */ `
  uniform float uSize;
  uniform float uSpin;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float c = cos(uSpin);
    float s = sin(uSpin);
    mv.xy += mat2(c, s, -s, c) * position.xy * uSize;
    mv.z = min(mv.z + uSize * 0.6, -0.5);
    gl_Position = projectionMatrix * mv;
  }
`;
const FIREBALL_FRAGMENT = /* glsl */ `
  uniform float uAge;
  uniform float uSeed;
  uniform vec3 uHot;
  uniform vec3 uFlame;
  uniform vec3 uSmoke;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return v;
  }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float age = uAge;
    // Billows roll outward: sample noise in a frame that swells with age.
    vec2 q = p / (0.6 + 0.6 * age);
    float billow = fbm(q * 2.6 + uSeed);
    float detail = fbm(q * 6.0 - uSeed * 1.3 + age * 1.5);
    float radius = (0.42 + 0.5 * sqrt(age)) * (0.7 + 0.5 * billow);
    float body = 1.0 - smoothstep(radius - 0.12, radius + 0.02, r);
    if (body <= 0.001) discard;
    // Temperature falls toward the edge and with age; the noise breaks it into tongues of flame.
    float heat = (1.0 - r / max(radius, 0.01)) * 1.25 + (detail - 0.5) * 0.9 + 0.35 - age * 1.6;
    heat = clamp(heat, 0.0, 1.0);
    float fire = smoothstep(0.05, 0.4, heat);
    // Dull red at the cool edge of the flames, orange in the body, white-hot only in the core.
    vec3 flame = mix(uFlame * vec3(0.55, 0.22, 0.12), uFlame, smoothstep(0.2, 0.6, heat));
    flame = mix(flame, uHot, smoothstep(0.72, 1.0, heat));
    float fade = 1.0 - smoothstep(0.55, 1.0, age);
    float smoke = body * (1.0 - fire) * fade * (0.55 + 0.35 * billow);
    vec3 color = flame * fire * body * fade * (0.6 + 0.6 * detail) + uSmoke * smoke;
    gl_FragColor = vec4(color, smoke * 0.9 + fire * body * fade * 0.25);
  }
`;

/** A flat shock ring that races out from a big explosion, ragged and fading as it grows. */
const SHOCK_FRAGMENT = /* glsl */ `
  uniform float uAge;
  uniform vec3 uColor;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    float k = floor((a + 3.14159) * 9.0);
    float rag = mix(hash(k), hash(k + 1.0), fract((a + 3.14159) * 9.0)) * 0.08;
    float width = 0.035 + 0.07 * uAge;
    float ring = exp(-pow((r - 0.86 + rag) / width, 2.0));
    float fade = pow(1.0 - uAge, 2.0);
    gl_FragColor = vec4(uColor * ring * fade, 1.0);
  }
`;
const SHOCK_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

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
    this.fireballs = [];
    this.fireballPool = [];
    this.shocks = [];
    this.shockPool = [];
    this.quad = new THREE.PlaneGeometry(2, 2);
    this.fireballMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      uniforms: {
        uAge: { value: 0 },
        uSeed: { value: 0 },
        uSize: { value: 1 },
        uSpin: { value: 0 },
        uHot: { value: new THREE.Color() },
        uFlame: { value: new THREE.Color() },
        uSmoke: { value: new THREE.Color() },
      },
      vertexShader: FIREBALL_VERTEX,
      fragmentShader: FIREBALL_FRAGMENT,
    });
    this.shockMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uAge: { value: 0 }, uColor: { value: new THREE.Color() } },
      vertexShader: SHOCK_VERTEX,
      fragmentShader: SHOCK_FRAGMENT,
    });
    // Torn hull plating for ship explosions: flat shards that tumble away trailing embers.
    this.shardGeometries = [
      new THREE.BoxGeometry(1, 0.22, 1.6),
      new THREE.BoxGeometry(0.6, 0.3, 2.2),
      new THREE.TetrahedronGeometry(0.9),
    ];
    this.shardMaterial = new THREE.MeshStandardMaterial({ color: 0x3c3f46, metalness: 0.4, roughness: 0.7 });
    this.shardPool = [];

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

  /**
   * Flash, rolling fireballs, a spray of sparks and debris. `rock` explosions throw rock chunks and dust;
   * the rest throw burning hull shards. Big ones (or `shockwave`) also send out a ring along `plane`.
   */
  explosion(position, size, { tint = FIRE, debris = 0, light = true, rock = false, shockwave = size >= 90, plane = null } = {}) {
    this.#sprite(glowTexture(), position, { size: size * 1.5, grow: 1.2, life: 0.18, color: tint[0], intensity: 2.6 });
    const hot = tint[0].clone().multiplyScalar(rock ? 1.1 : 1.8);
    const flame = tint[1].clone().multiplyScalar(rock ? 0.8 : 1.2);
    const smoke = rock ? tint[2].clone().multiplyScalar(0.6) : SMOKE;
    const life = 0.9 + 0.35 * Math.sqrt(size / 20);
    this.#fireball(position, size * 0.75, { life, hot, flame, smoke });
    const extra = Math.min(5, Math.round(1 + size / 40));
    for (let i = 0; i < extra; i++) {
      const offset = randomUnit(new THREE.Vector3()).multiplyScalar(size * rand(0.25, 0.6));
      this.#fireball(offset.add(position), size * rand(0.35, 0.6), {
        life: life * rand(0.7, 1.1),
        delay: rand(0.03, 0.25),
        hot,
        flame,
        smoke,
        drift: offset.clone().sub(position).multiplyScalar(0.4),
      });
    }
    if (shockwave) this.#shock(position, size, tint[1], plane);
    else this.#sprite(ringTexture(), position, { size: size * 0.6, grow: 5, life: 0.45, color: tint[1], intensity: 0.9 });
    this.sparkBurst(position, Math.round(30 + size * 1.2), tint[1], size * 2.2);
    for (let i = 0; i < debris; i++) {
      if (rock) this.#debris(position, size);
      else this.#shard(position, size);
    }
    if (light) this.#flash(position, size);
  }

  /** A patch of fire, e.g. burning at a hull breach. */
  fire(position, size, life = 0.8) {
    this.#fireball(position, size, {
      life,
      hot: FIRE[0].clone().multiplyScalar(1.6),
      flame: FIRE[1].clone().multiplyScalar(1.2),
      smoke: SMOKE,
      drift: randomUnit(new THREE.Vector3()).multiplyScalar(size * 0.3),
    });
  }

  /** A brief glow, e.g. a muzzle flash or a shield ripple. */
  flash(position, color, size, life = 0.12, intensity = 3) {
    this.#sprite(glowTexture(), position, { size, grow: 0.6, life, color, intensity });
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

  /** Sparks streaming in from a shell around `position` to its center over about `time` seconds. */
  implode(position, radius, count, color, time) {
    // Sparks slow down with drag, so start them fast enough to arrive.
    const drag = 1.8;
    const speed = (radius * drag) / (1 - Math.exp(-drag * time));
    for (let i = 0; i < count && this.sparkCount < MAX_SPARKS; i++) {
      const k = this.sparkCount++;
      const dir = randomUnit(new THREE.Vector3());
      this.sparkPos.set([position.x + dir.x * radius, position.y + dir.y * radius, position.z + dir.z * radius], k * 3);
      this.sparkVel.set([-dir.x * speed, -dir.y * speed, -dir.z * speed], k * 3);
      this.sparkBase.set([color.r * 2, color.g * 2, color.b * 2], k * 3);
      this.sparkLife[k] = this.sparkMax[k] = time;
    }
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
    for (const f of this.fireballs) {
      if (f.delay > 0) {
        f.delay -= dt;
        f.mesh.visible = f.delay <= 0;
        continue;
      }
      f.age += dt / f.life;
      f.mesh.position.addScaledVector(f.drift, dt);
      f.mesh.material.uniforms.uAge.value = Math.min(f.age, 1);
      f.mesh.material.uniforms.uSize.value = f.size * (0.55 + 0.75 * Math.sqrt(Math.min(f.age, 1)));
    }
    this.fireballs = this.fireballs.filter((f) => {
      if (f.age < 1) return true;
      this.scene.remove(f.mesh);
      this.fireballPool.push(f.mesh);
      return false;
    });

    for (const s of this.shocks) {
      s.age += dt / s.life;
      const t = Math.min(s.age, 1);
      s.mesh.scale.setScalar(s.size * (0.3 + 6 * (1 - (1 - t) ** 2.4)));
      s.mesh.material.uniforms.uAge.value = t;
    }
    this.shocks = this.shocks.filter((s) => {
      if (s.age < 1) return true;
      this.scene.remove(s.mesh);
      this.shockPool.push(s.mesh);
      return false;
    });

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
      if (d.life < 0.6) d.mesh.scale.copy(d.scale).multiplyScalar(Math.max(0.01, d.life / 0.6));
      // Burning shards leave a trail of embers.
      if (d.embers > 0 && (d.emberTimer -= dt) <= 0) {
        d.emberTimer = 0.05;
        d.embers -= 0.05;
        this.sparkBurst(d.mesh.position, 1, EMBER, 4);
      }
    }
    this.debris = this.debris.filter((d) => {
      if (d.life > 0) return true;
      this.scene.remove(d.mesh);
      (d.shard ? this.shardPool : this.debrisPool).push(d.mesh);
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
    for (const f of this.fireballs) f.age = f.delay = 1;
    for (const s of this.shocks) s.age = 1;
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

  #fireball(position, size, { life, hot, flame, smoke, delay = 0, drift = null }) {
    let mesh = this.fireballPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(this.quad, this.fireballMaterial.clone());
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
    }
    const u = mesh.material.uniforms;
    u.uAge.value = 0;
    u.uSeed.value = rand(0, 100);
    u.uSpin.value = rand(0, Math.PI * 2);
    u.uSize.value = size * 0.55;
    u.uHot.value.copy(hot);
    u.uFlame.value.copy(flame);
    u.uSmoke.value.copy(smoke);
    mesh.position.copy(position);
    mesh.visible = delay <= 0;
    this.scene.add(mesh);
    this.fireballs.push({ mesh, size, life, age: 0, delay, drift: drift ?? new THREE.Vector3() });
  }

  #shock(position, size, color, plane) {
    let mesh = this.shockPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(this.quad, this.shockMaterial.clone());
      mesh.frustumCulled = false;
    }
    mesh.material.uniforms.uColor.value.copy(color);
    mesh.material.uniforms.uAge.value = 0;
    mesh.position.copy(position);
    // Lie in the given plane (its normal), tilted a little so it never shows edge-on as a line.
    const normal = (plane ?? randomUnit(new THREE.Vector3())).clone().add(randomUnit(new THREE.Vector3()).multiplyScalar(0.25)).normalize();
    mesh.quaternion.setFromUnitVectors(Z_AXIS, normal);
    mesh.scale.setScalar(size * 0.3);
    this.scene.add(mesh);
    this.shocks.push({ mesh, size, life: 1.2 + size / 200, age: 0 });
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
      scale: mesh.scale.clone(),
      velocity: randomUnit(new THREE.Vector3()).multiplyScalar(rand(10, 45)),
      axis: randomUnit(new THREE.Vector3()),
      spin: rand(-4, 4),
      life: rand(1.5, 3),
      embers: 0,
    });
  }

  #shard(position, size) {
    let mesh = this.shardPool.pop();
    if (!mesh) mesh = new THREE.Mesh(this.shardGeometries[Math.floor(Math.random() * this.shardGeometries.length)], this.shardMaterial);
    const k = rand(0.6, 1.8) * Math.max(1.2, size / 14);
    mesh.position.copy(position).addScaledVector(randomUnit(new THREE.Vector3()), size * 0.2);
    mesh.scale.set(k * rand(0.7, 1.3), k * rand(0.7, 1.3), k * rand(0.7, 1.3));
    this.scene.add(mesh);
    const life = rand(2.5, 4.5);
    this.debris.push({
      mesh,
      shard: true,
      scale: mesh.scale.clone(),
      velocity: randomUnit(new THREE.Vector3()).multiplyScalar(rand(15, 55) * Math.max(1, size / 60)),
      axis: randomUnit(new THREE.Vector3()),
      spin: rand(-3, 3),
      life,
      embers: Math.random() < 0.7 ? life * rand(0.4, 0.8) : 0,
      emberTimer: 0,
    });
  }

  #flash(position, size) {
    const slot = this.lights.reduce((a, b) => (a.life <= b.life ? a : b));
    slot.light.position.copy(position);
    slot.max = slot.life = 0.5;
    slot.peak = 12000 * Math.min(4, size / 20);
  }
}
