import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Pipeline } from './engine/renderer.js';
import { bakeMilkyWay, createStars } from './world/sky.js';
import { Sun } from './world/sun.js';
import { Planet } from './world/planet.js';
import { SpaceDust } from './world/dust.js';
import { AsteroidField } from './world/asteroids.js';
import { Player, baseStats } from './entities/player.js';
import { Drone, buildDroneModel } from './entities/drone.js';
import { Bolts, segmentHitsSphere } from './entities/bolts.js';
import { PICKUP_KINDS, Pickups } from './entities/pickups.js';
import { Effects } from './fx/effects.js';
import { addMuzzleFlashes, buildCockpit } from './cockpit.js';
import { glowTexture } from './fx/textures.js';
import { Hud } from './hud.js';
import { UPGRADES, rollUpgrades } from './upgrades.js';
import { clamp, rand, randInt, randomUnit, smooth } from './util/math.js';

const BEST_KEY = 'deep-field:best';
const pad2 = (n) => String(n).padStart(2, '0');

// The scene's fixed geography: a sun ahead and to the right, a blue world below and to the left.
const SUN_DIRECTION = new THREE.Vector3(0.36, 0.27, -0.89).normalize();
const PLANET_POSITION = new THREE.Vector3(-7400, -3300, -14500);
const PLANET_RADIUS = 4800;
const START_POSITION = new THREE.Vector3(0, 0, 250);

// Cannon muzzles in the ship's frame (meters): under each wing root, and a nose gun.
const MUZZLES = {
  left: new THREE.Vector3(-2.4, -1.4, -3.5),
  right: new THREE.Vector3(2.4, -1.4, -3.5),
  nose: new THREE.Vector3(0, -1.9, -3.5),
};

// Explosion color ramps: [flash, body, smoke].
const DUST_TINT = [new THREE.Color(1, 0.95, 0.85), new THREE.Color(0.42, 0.36, 0.3), new THREE.Color(0.12, 0.1, 0.09)];

function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(score) {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // Storage unavailable; the best score lasts for this session only.
  }
}

/**
 * Owns the 3D world and the state machine:
 * title → playing ⇄ paused, playing → upgrade → playing (next sector), playing → gameover → playing.
 */
export class Game {
  constructor({ canvas, hudCanvas, ui, input, sound, palette }) {
    this.canvas = canvas;
    this.ui = ui;
    this.input = input;
    this.sound = sound;
    this.palette = palette;
    this.lowPower = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const color = (css) => new THREE.Color(css);
    this.colors = {
      flare: color(palette.flare),
      flareHot: color(palette.flareHot),
      hostile: color(palette.hostile),
      ice: color(palette.ice),
    };

    this.pipeline = new Pipeline(canvas, { lowPower: this.lowPower });
    const renderer = this.pipeline.renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CONFIG.fov, 1, 0.3, 200000);
    this.camera.position.copy(START_POSITION);
    this.scene.add(this.camera);
    this.pipeline.attach(this.scene, this.camera);

    // Sky: baked Milky Way glow, live stars, the sun and a planet.
    this.milkyWay = bakeMilkyWay(renderer, this.lowPower ? 256 : 512);
    this.scene.background = this.milkyWay.texture;
    this.stars = createStars(this.lowPower ? 6000 : 9500);
    this.scene.add(this.stars);
    this.sun = new Sun(SUN_DIRECTION);
    this.scene.add(this.sun.light, this.sun.group);
    // Light reflected off the planet, and a trace of ambient so shadowed rock isn't pure black.
    const planetShine = new THREE.DirectionalLight(0x5f84bd, 0.22);
    planetShine.position.copy(PLANET_POSITION).normalize();
    this.scene.add(planetShine, new THREE.AmbientLight(0xffffff, 0.02));
    this.planet = new Planet({
      renderer,
      radius: PLANET_RADIUS,
      position: PLANET_POSITION,
      sunDirection: SUN_DIRECTION,
      bakeSize: this.lowPower ? 512 : 1024,
    });
    this.scene.add(this.planet.group);

    this.dust = new SpaceDust(this.lowPower ? 450 : 700);
    this.scene.add(this.dust.lines);
    this.field = new AsteroidField(this.scene, { lowPower: this.lowPower });
    this.bolts = new Bolts(this.scene, {
      friendly: this.colors.flare.clone().multiplyScalar(1.7),
      hostile: this.colors.hostile.clone().multiplyScalar(6),
    });
    this.pickups = new Pickups(this.scene, { shield: this.colors.ice, overdrive: this.colors.flareHot });
    this.effects = new Effects(this.scene, this.field.geometries.small[0], this.field.materials[1]);
    this.droneTemplate = buildDroneModel(this.colors.hostile);
    this.cockpit = buildCockpit({ flare: this.colors.flare, ice: this.colors.ice });
    this.cockpit.visible = false;
    this.camera.add(this.cockpit);
    this.muzzleFlashes = addMuzzleFlashes(this.camera, MUZZLES, this.colors.flare, glowTexture());
    this.hud = new Hud(hudCanvas, palette);

    this.width = 1;
    this.height = 1;
    this.time = 0;
    this.best = loadBest();
    this.player = null;
    this.drones = [];
    this.popups = [];
    this.shake = 0;
    this.hurt = 0;
    this.hitMarker = 0;
    this.damage = null;
    this.fov = CONFIG.fov;
    this.baseFov = CONFIG.fov;
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();

    this.field.populate(CONFIG.field.count, START_POSITION, CONFIG.field.safeRadius);
    this.setState('title');
    this.ui.setBest(this.best);
    this.ui.show('title');
    this.ui.setHudVisible(false);
  }

  // ---------- Setup ----------

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.lowPower ? 1.5 : CONFIG.maxPixelRatio);
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.pipeline.setSize(width, height, dpr);
    this.hud.resize(width, height, dpr);

    // Keep at least ~75 degrees of horizontal view on portrait screens.
    const aspect = width / height;
    const minHorizontal = THREE.MathUtils.degToRad(75);
    const portraitFov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minHorizontal / 2) / aspect));
    this.baseFov = clamp(Math.max(CONFIG.fov, portraitFov), CONFIG.fov, 100);
    this.camera.aspect = aspect;
    this.#applyFov(this.baseFov);
    this.stars.material.uniforms.uPixelRatio.value = dpr;
  }

  setState(state) {
    this.state = state;
    this.stateTime = 0;
  }

  // ---------- Flow ----------

  start() {
    this.#clearCombat();
    this.field.clear();
    this.field.populate(CONFIG.field.count, START_POSITION, CONFIG.field.safeRadius);
    this.stats = baseStats();
    this.levels = {};
    this.player = new Player(this.stats);
    this.player.position.copy(START_POSITION);
    if (this.input.touchSeen) this.player.throttle = 0.75;
    this.score = 0;
    this.wave = 0;
    this.chain = 0;
    this.multiplier = 1;
    this.comboTimer = 0;
    this.deathTimer = 0;
    this.cockpit.visible = true;
    this.setState('playing');
    this.ui.show(null);
    this.ui.setHudVisible(true);
    this.sound.select();
    this.nextWave();
  }

  nextWave() {
    this.wave += 1;
    this.sectorCleared = false;
    this.clearTimer = 0;
    this.field.populate(CONFIG.field.count, this.player.position, 350);
    this.dronesToSpawn = Math.min(1 + this.wave, 10);
    this.droneTimer = 2.5;
    const n = this.dronesToSpawn;
    this.ui.banner(`Sector ${pad2(this.wave)}`, `${n} hostile${n === 1 ? '' : 's'} inbound`);
  }

  openUpgrade() {
    const p = this.player;
    p.shield = Math.min(this.stats.maxShield, p.shield + CONFIG.sectorRepair);
    this.sound.setThrust(0);
    const options = rollUpgrades(this.levels);
    if (options.length === 0) {
      this.nextWave();
      return;
    }
    this.setState('upgrade');
    this.input.releaseLock();
    this.ui.setHudVisible(false);
    this.upgradeOptions = options;
    this.ui.showUpgrades(this.wave, options, this.levels, (id) => this.chooseUpgrade(id));
  }

  chooseUpgrade(id) {
    if (this.state !== 'upgrade') return;
    UPGRADES.find((u) => u.id === id).apply(this.stats, this.player);
    this.levels[id] = (this.levels[id] ?? 0) + 1;
    this.sound.select();
    this.setState('playing');
    this.input.requestLock();
    this.ui.show(null);
    this.ui.setHudVisible(true);
    this.player.invulnerable = Math.max(this.player.invulnerable, 1);
    this.nextWave();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.sound.setThrust(0);
    this.input.releaseAll();
    this.input.releaseLock();
    this.ui.show('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.setState('playing');
    this.input.requestLock();
    this.ui.show(null);
  }

  toTitle() {
    this.#clearCombat();
    this.player = null;
    this.cockpit.visible = false;
    this.input.releaseLock();
    this.setState('title');
    this.sound.setThrust(0);
    this.ui.setHudVisible(false);
    this.ui.setBest(this.best);
    this.ui.show('title');
  }

  endRun() {
    const newBest = this.score > this.best;
    if (newBest) {
      this.best = this.score;
      saveBest(this.best);
    }
    this.setState('gameover');
    this.input.releaseLock();
    this.ui.setHudVisible(false);
    this.ui.showGameOver({ score: this.score, wave: this.wave, best: this.best, newBest });
  }

  toggleMute() {
    this.sound.setMuted(!this.sound.muted);
    this.ui.setMuted(this.sound.muted);
  }

  /** The mouse was released (Esc or focus loss): stop the action rather than fly blind. */
  onLockChange(locked) {
    if (!locked && this.state === 'playing') this.pause();
  }

  // ---------- Update ----------

  update(dt) {
    this.time += dt;
    this.stateTime += dt;
    const input = this.input;
    const settled = this.stateTime > 0.6;

    if (input.wasPressed('KeyM')) this.toggleMute();

    switch (this.state) {
      case 'title':
      case 'gameover':
        if (settled && input.wasPressed('Enter')) {
          this.start();
          input.requestLock();
        } else {
          this.#updateWorld(dt);
        }
        break;
      case 'paused':
        if (input.wasPressed('KeyP')) this.resume();
        break;
      case 'upgrade': {
        const index = ['Digit1', 'Digit2', 'Digit3'].findIndex((k, i) => input.wasPressed(k, `Numpad${i + 1}`));
        if (settled && index >= 0 && this.upgradeOptions[index]) this.chooseUpgrade(this.upgradeOptions[index].id);
        else this.#updateWorld(dt);
        break;
      }
      case 'playing':
        if (input.wasPressed('KeyP', 'Escape')) this.pause();
        else this.#updatePlay(dt);
        break;
    }
    input.endFrame();
  }

  #updatePlay(dt) {
    const p = this.player;
    if (!p.dead) {
      const controls = this.input.read();
      if (this.input.stick) this.ui.dismissTouchHint();
      p.update(dt, controls);
      this.#enforceBoundary(dt);
      if (controls.fire && p.fireTimer <= 0) this.#fire();
      if (controls.boost && p.boostTimer <= 0) this.#boost();
      this.sound.setThrust(Math.min(1.2, p.speed / p.stats.maxSpeed) * 0.6 + (p.boosting > 0 ? 0.5 : 0));
    } else {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.endRun();
    }

    this.#updateWorld(dt);
    this.#collide();
    this.#sweep();
    this.#updateCombo(dt);
    this.#updateSpawns(dt);
    this.#checkSectorClear(dt);

    this.ui.updateHud({
      score: this.score,
      multiplier: this.multiplier,
      overdrive: p.overdrive > 0,
      wave: this.wave,
      hostiles: this.drones.length + this.dronesToSpawn,
      shield: p.shield,
      maxShield: this.stats.maxShield,
      boost: p.boostCharge,
      speed: p.speed,
      throttle: p.boosting > 0 ? 1 : p.throttle,
    });
  }

  /** Everything that moves on its own, in every state. */
  #updateWorld(dt) {
    this.field.update(dt);
    this.planet.update(dt);
    for (const d of this.drones) {
      for (const shot of d.update(dt, this.player, this.field.rocks)) {
        this.bolts.fire(shot.origin, shot.velocity, {
          hostile: true,
          damage: CONFIG.drone.boltDamage,
          life: CONFIG.drone.range * 1.6 / CONFIG.drone.boltSpeed,
        });
        this.#playAt('enemyShot', d.position, 0.9);
      }
    }
    this.bolts.update(dt);
    this.pickups.update(dt, this.player, this.time);
    this.effects.update(dt);
    for (const flash of Object.values(this.muzzleFlashes)) {
      flash.userData.life -= dt;
      flash.visible = flash.userData.life > 0 && this.state === 'playing';
      if (flash.visible) flash.material.rotation = Math.random() * Math.PI;
    }
    for (const pop of this.popups) pop.life -= dt;
    this.popups = this.popups.filter((pop) => pop.life > 0);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.hurt = Math.max(0, this.hurt - dt * 1.8);
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    if (this.damage) this.damage.life -= dt;
  }

  #updateCombo(dt) {
    if (this.chain === 0) return;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) {
      this.chain = 0;
      this.multiplier = 1;
    }
  }

  #updateSpawns(dt) {
    if (this.dronesToSpawn <= 0 || this.player.dead) return;
    this.droneTimer -= dt;
    if (this.droneTimer > 0) return;
    const group = Math.min(this.dronesToSpawn, this.wave >= 3 ? 2 : 1);
    for (let i = 0; i < group; i++) this.#spawnDrone();
    this.dronesToSpawn -= group;
    this.droneTimer = rand(3.5, 6.5) - Math.min(this.wave * 0.15, 1.5);
  }

  #spawnDrone() {
    const p = this.player;
    // Mostly ahead of the player so the warp-in is seen, at combat range.
    const dir = p.forward(new THREE.Vector3()).multiplyScalar(0.9).add(randomUnit(new THREE.Vector3()).multiplyScalar(0.8)).normalize();
    const pos = dir.multiplyScalar(rand(650, 950)).add(p.position);
    if (pos.length() > CONFIG.field.boundary) pos.setLength(CONFIG.field.boundary * 0.8);
    const drone = new Drone(this.droneTemplate, pos, this.wave, this.colors.flareHot);
    this.scene.add(drone.object);
    this.drones.push(drone);
    this.effects.warp(pos, this.colors.ice);
    this.#playAt('warp', pos, 1);
  }

  #checkSectorClear(dt) {
    if (this.player.dead) return;
    if (!this.sectorCleared) {
      if (this.drones.length || this.dronesToSpawn) return;
      this.sectorCleared = true;
      this.clearTimer = CONFIG.sectorClearDelay;
      const bonus = 250 * this.wave;
      this.score += bonus;
      this.sound.sectorClear();
      this.ui.banner(`Sector ${pad2(this.wave)} clear`, `Bonus +${bonus.toLocaleString('en-US')}`);
      return;
    }
    this.clearTimer -= dt;
    if (this.clearTimer <= 0) this.openUpgrade();
  }

  #enforceBoundary(dt) {
    const p = this.player;
    const dist = p.position.length();
    const limit = CONFIG.field.boundary;
    this.outOfBounds = dist > limit;
    if (dist > limit + 150) {
      const push = Math.min(1, (dist - limit - 150) / 300) * 120 * dt;
      p.velocity.addScaledVector(this._v.copy(p.position).normalize(), -push);
    }
  }

  // ---------- Actions ----------

  #fire() {
    const p = this.player;
    const s = this.stats;
    p.fireTimer = s.fireInterval * (p.overdrive > 0 ? 0.5 : 1);
    const names = s.guns >= 3
      ? ['left', 'right', 'nose']
      : s.guns === 2
        ? ['left', 'right']
        : [p.gunIndex++ % 2 === 0 ? 'left' : 'right'];
    const muzzles = names.map((name) => [name, MUZZLES[name]]);
    const aim = p.forward(new THREE.Vector3()).multiplyScalar(CONFIG.player.convergence).add(p.position);
    for (const [name, m] of muzzles) {
      this.muzzleFlashes[name].userData.life = 0.05;
      const origin = m.clone().applyQuaternion(p.quaternion).add(p.position);
      const velocity = aim.clone().sub(origin).normalize().multiplyScalar(s.boltSpeed).add(p.velocity);
      this.bolts.fire(origin, velocity, { damage: s.boltDamage, life: s.boltRange / s.boltSpeed });
    }
    this.sound.laser();
  }

  #boost() {
    const p = this.player;
    p.boostTimer = this.stats.boostCooldown;
    p.boosting = CONFIG.player.boostDuration;
    p.invulnerable = Math.max(p.invulnerable, 0.35);
    this.sound.boost();
  }

  // ---------- Collisions and damage ----------

  #collide() {
    const p = this.player;
    const alive = p && !p.dead;
    const rocks = this.field.rocks;

    for (const b of this.bolts.active) {
      if (b.dead) continue;
      if (b.hostile && alive && segmentHitsSphere(b.previous, b.position, p.position, p.radius)) {
        b.dead = true;
        this.#damagePlayer(b.damage, b.previous);
        continue;
      }
      // Rocks stop everyone's bolts, so they work as cover.
      for (const rock of rocks) {
        if (rock.dead) continue;
        const reach = rock.radius + 25;
        if (b.position.distanceToSquared(rock.position) > reach * reach) continue;
        if (segmentHitsSphere(b.previous, b.position, rock.position, rock.radius)) {
          b.dead = true;
          if (!b.hostile) this.#hitRock(rock, b.damage, b.position);
          else this.effects.impact(b.position, this.colors.hostile);
          break;
        }
      }
      if (b.dead || b.hostile) continue;
      for (const d of this.drones) {
        if (d.dead || !d.active) continue;
        if (segmentHitsSphere(b.previous, b.position, d.position, d.radius)) {
          b.dead = true;
          this.#hitDrone(d, b.damage, b.position);
          break;
        }
      }
    }

    // Drones that fly into rocks don't survive it.
    for (const d of this.drones) {
      if (d.dead || !d.active) continue;
      for (const rock of rocks) {
        if (!rock.dead && d.position.distanceTo(rock.position) < rock.radius + 2) {
          this.#destroyDrone(d, false);
          break;
        }
      }
    }

    if (!alive) return;

    for (const rock of rocks) {
      if (rock.dead) continue;
      const gap = p.position.distanceTo(rock.position) - rock.radius - p.radius;
      if (gap >= 0) continue;
      const normal = this._v.subVectors(p.position, rock.position).normalize();
      p.position.addScaledVector(normal, -gap);
      const closing = -new THREE.Vector3().subVectors(p.velocity, rock.velocity).dot(normal);
      if (closing > 0) {
        p.velocity.addScaledVector(normal, closing * 1.4);
        const { impactDamage, harmlessSpeed } = CONFIG.asteroid;
        if (closing > harmlessSpeed) {
          const amount = clamp(closing * 0.3, impactDamage[0], impactDamage[1]);
          if (this.#damagePlayer(amount, rock.position)) this.#hitRock(rock, 2, p.position);
          this.shake = Math.max(this.shake, 0.6);
        }
      }
      if (p.dead) return;
    }

    for (const d of this.drones) {
      if (d.dead || !d.active) continue;
      if (p.position.distanceTo(d.position) < p.radius + d.radius) {
        this.#damagePlayer(CONFIG.drone.ramDamage, d.position);
        this.#destroyDrone(d, true);
        if (p.dead) return;
      }
    }

    for (const item of this.pickups.items) {
      if (!item.dead && p.position.distanceTo(item.position) < p.radius + item.radius) {
        item.dead = true;
        this.#collect(item);
      }
    }
  }

  #sweep() {
    this.field.sweep();
    this.bolts.sweep();
    this.pickups.sweep();
    this.drones = this.drones.filter((d) => !d.dead);
  }

  #hitRock(rock, damage, at) {
    rock.hp -= damage;
    this.effects.impact(at, DUST_TINT[0]);
    this.hitMarker = 0.12;
    if (rock.hp > 0) {
      this.#playAt('chip', at, 0.8);
      return;
    }

    const def = CONFIG.asteroid[rock.size];
    this.field.remove(rock);
    this.#addScore(def.score, rock.position);
    const big = rock.size === 'large';
    this.effects.explosion(rock.position, rock.radius * 1.1, {
      tint: DUST_TINT,
      debris: big ? 10 : rock.size === 'medium' ? 6 : 3,
      light: big,
    });
    this.#playAt('explode', rock.position, big ? 1 : 0.5);
    this.#shakeFrom(rock.position, big ? 1 : 0.4);

    if (def.breaksInto) {
      const pieces = randInt(def.pieces[0], def.pieces[1]);
      for (let i = 0; i < pieces; i++) {
        const dir = randomUnit(new THREE.Vector3());
        const pos = dir.clone().multiplyScalar(rock.radius * 0.45).add(rock.position);
        const vel = dir.multiplyScalar(rand(6, 18)).add(rock.velocity);
        this.field.spawn(def.breaksInto, pos, vel);
      }
    }
    if (rock.size !== 'large' && Math.random() < CONFIG.pickups.dropChance.asteroid) this.#dropPickup(rock);
  }

  #hitDrone(d, damage, at) {
    d.hp -= damage;
    d.flash = 0.1;
    this.effects.impact(at, this.colors.flareHot);
    this.hitMarker = 0.15;
    if (d.hp <= 0) this.#destroyDrone(d, true);
    else this.#playAt('chip', at, 1);
  }

  #destroyDrone(d, byPlayer) {
    d.dead = true;
    this.scene.remove(d.object);
    if (byPlayer) this.#addScore(CONFIG.drone.score, d.position);
    this.effects.explosion(d.position, 16, { debris: 5 });
    this.#playAt('explode', d.position, 0.8);
    this.#shakeFrom(d.position, 0.7);
    if (byPlayer && Math.random() < CONFIG.pickups.dropChance.drone) this.#dropPickup(d);
  }

  /** Applies damage unless the shield is in its grace period. Returns whether it landed. */
  #damagePlayer(amount, from) {
    const p = this.player;
    if (p.invulnerable > 0 || p.dead) return false;
    p.shield -= amount;
    p.invulnerable = CONFIG.player.invulnerable;
    this.chain = 0;
    this.multiplier = 1;
    this.hurt = Math.min(1, this.hurt + 0.6);
    this.shake = Math.max(this.shake, 0.5);
    this.damage = { from: from.clone(), life: 1.2 };
    this.sound.hit();
    if (p.shield <= 0) this.#destroyPlayer();
    return true;
  }

  #destroyPlayer() {
    const p = this.player;
    p.dead = true;
    p.shield = 0;
    this.deathTimer = 2.8;
    this.deathSpin = randomUnit(new THREE.Vector3()).multiplyScalar(1.2);
    this.cockpit.visible = false;
    this.sound.setThrust(0);
    const ahead = p.forward(new THREE.Vector3()).multiplyScalar(14).add(p.position);
    this.effects.explosion(ahead, 22, { debris: 8 });
    this.hurt = 1;
    this.shake = 1.5;
    this.sound.explode(1);
    this.sound.gameOver();
  }

  #dropPickup(source) {
    const kind = Math.random() < 0.65 ? PICKUP_KINDS[0] : PICKUP_KINDS[1];
    this.pickups.spawn(kind, source.position, source.velocity ?? new THREE.Vector3());
  }

  #collect(item) {
    const p = this.player;
    if (item.kind === 'shield') {
      p.shield = Math.min(this.stats.maxShield, p.shield + CONFIG.pickups.shieldAmount);
      this.#popup(item.position, `+${CONFIG.pickups.shieldAmount} shield`, this.palette.ice);
    } else {
      p.overdrive = CONFIG.pickups.overdriveTime;
      this.#popup(item.position, 'Overdrive', this.palette.flareHot);
    }
    this.sound.pickup();
  }

  #addScore(points, at) {
    const { window: comboWindow, killsPerStep, maxMultiplier } = CONFIG.combo;
    this.chain += 1;
    this.comboTimer = comboWindow;
    this.multiplier = Math.min(maxMultiplier, 1 + Math.floor(this.chain / killsPerStep));
    const gained = points * this.multiplier;
    this.score += gained;
    this.#popup(at, `+${gained}`, this.multiplier > 1 ? this.palette.flare : this.palette.hull);
  }

  #popup(at, text, color) {
    this.popups.push({ position: at.clone(), text, color, life: 1.1, max: 1.1 });
  }

  /** Camera shake that falls off with distance from the blast. */
  #shakeFrom(position, strength) {
    const from = this.player ? this.player.position : this.camera.position;
    const falloff = clamp(1 - position.distanceTo(from) / 500, 0, 1);
    this.shake = Math.max(this.shake, strength * falloff);
  }

  /** Plays a sound effect, quieter the farther away it happens. */
  #playAt(name, position, weight) {
    const dist = position.distanceTo(this.camera.position);
    const level = weight * clamp(1 - dist / 1400, 0.08, 1);
    if (name === 'explode') this.sound.explode(level);
    else if (level > 0.15) this.sound[name]?.(level);
  }

  #clearCombat() {
    for (const d of this.drones) this.scene.remove(d.object);
    this.drones = [];
    this.dronesToSpawn = 0;
    this.bolts.clear();
    this.pickups.clear();
    this.effects.clear();
    this.popups = [];
    this.damage = null;
    this.hurt = 0;
    this.shake = 0;
  }

  // ---------- Render ----------

  render(dt) {
    this.#placeCamera(dt);
    const cam = this.camera;
    this.stars.position.copy(cam.position);
    this.sun.update(cam);

    // Looking toward the sun washes out the faint sky, like a real eye or camera.
    const forward = this._v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const glare = THREE.MathUtils.smoothstep(forward.dot(SUN_DIRECTION), 0.8, 0.995);
    const exposure = 1 - 0.8 * glare;
    this.stars.material.uniforms.uExposure.value = exposure;
    this.scene.backgroundIntensity = exposure;

    const velocity = this.player && !this.player.dead ? this.player.velocity : this._v.set(0, 0, -6);
    this.dust.update(cam.position, velocity);

    this.pipeline.render();
    this.ui.setHurt(this.hurt);

    if (this.state === 'playing' && this.player) {
      const p = this.player;
      this.hud.draw({
        camera: cam,
        player: p.dead ? null : p,
        drones: this.drones,
        pickups: this.pickups.items,
        rocks: this.field.rocks,
        popups: this.popups,
        boltSpeed: this.stats.boltSpeed,
        hitMarker: this.hitMarker,
        damage: this.damage,
        cursor: !this.input.locked && !this.input.touchSeen ? this.input.cursor : null,
        stick: this.input.stickView,
        touch: this.input.touchSeen,
        boundary: this.outOfBounds && !p.dead,
      });
    } else {
      this.hud.clear();
    }
  }

  #placeCamera(dt) {
    const cam = this.camera;
    const p = this.player;
    if (this.state === 'title' || !p) {
      // A slow drift through the belt, looking out toward the planet and the sun.
      const t = this.time;
      cam.position.set(Math.sin(t * 0.03) * 160, 25 + Math.sin(t * 0.05) * 20, 330 + Math.cos(t * 0.03) * 90);
      cam.quaternion.setFromEuler(new THREE.Euler(-0.04 + Math.sin(t * 0.04) * 0.03, 0.06 + Math.sin(t * 0.025) * 0.1, 0, 'YXZ'));
      this.#applyFov(this.baseFov);
      return;
    }

    if (p.dead) {
      // Tumble with the wreck.
      p.position.addScaledVector(p.velocity, dt * 0.3);
      p.quaternion.multiply(this._q.setFromAxisAngle(this._v.copy(this.deathSpin).normalize(), this.deathSpin.length() * dt));
    }
    cam.position.copy(p.position);
    cam.quaternion.copy(p.quaternion);

    if (this.shake > 0 && !this.reduceMotion) {
      const s = this.shake * this.shake;
      cam.position.add(randomUnit(this._v).multiplyScalar(s * 0.35));
      cam.rotateX(rand(-1, 1) * s * 0.012);
      cam.rotateY(rand(-1, 1) * s * 0.012);
    }

    // Widen the view a little with speed, and more under boost.
    const boost = p.boosting > 0 ? 1 : 0;
    const target = this.baseFov + Math.min(p.speed / 400, 1) * 4 + boost * 6;
    this.#applyFov(this.fov + (target - this.fov) * smooth(5, dt));
  }

  #applyFov(fov) {
    this.fov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    const viewScale = (this.height * (this.dpr || 1)) / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    this.effects.setViewScale(viewScale);
  }
}
