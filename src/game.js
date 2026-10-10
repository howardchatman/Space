import { CONFIG } from './config.js';
import { TAU, clamp, circlesOverlap, pick, rand, wrapEntity } from './util/math.js';
import { Ship, baseStats } from './entities/ship.js';
import { Asteroid } from './entities/asteroid.js';
import { Drone } from './entities/drone.js';
import { Bullet, drawOrbs, drawShots } from './entities/bullet.js';
import { PICKUP_KINDS, Pickup } from './entities/pickup.js';
import { Particles } from './fx/particles.js';
import { Starfield } from './world/starfield.js';
import { UPGRADES, rollUpgrades } from './upgrades.js';

const BEST_KEY = 'deep-field:best';
const pad2 = (n) => String(n).padStart(2, '0');

// Lateral offset and angle for each cannon, by number of guns fitted.
const GUN_LAYOUTS = {
  1: [[0, 0]],
  2: [[-5, 0], [5, 0]],
  3: [[0, 0], [-6, -0.12], [6, 0.12]],
};

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
 * Owns the world and the state machine:
 * title → playing ⇄ paused, playing → upgrade → playing (next sector), playing → gameover → playing.
 */
export class Game {
  constructor({ canvas, ui, input, sound, palette }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ui = ui;
    this.input = input;
    this.sound = sound;
    this.palette = palette;

    this.width = 1280;
    this.height = 720;
    this.viewScale = 1;
    this.dpr = 1;
    this.density = 1;
    this.reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    this.starfield = new Starfield(palette);
    this.particles = new Particles();
    this.time = 0;
    this.best = loadBest();

    this.clearWorld();
    this.seedBackdrop();
    this.setState('title');
    this.ui.setBest(this.best);
    this.ui.show('title');
    this.ui.setHudVisible(false);
  }

  // ---------- Setup ----------

  /** Fits the field to the canvas. Called on load and whenever the canvas changes size. */
  resize() {
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio);
    const scale = Math.max(CONFIG.minViewScale, Math.sqrt((cssW * cssH) / CONFIG.fieldArea));
    const width = cssW / scale;
    const height = cssH / scale;

    // Keep everything in the same relative spot on the new field.
    const sx = width / this.width;
    const sy = height / this.height;
    for (const e of this.#entities()) {
      e.x *= sx;
      e.y *= sy;
    }

    this.width = width;
    this.height = height;
    this.viewScale = scale;
    this.dpr = dpr;
    this.density = clamp((width * height) / CONFIG.fieldArea, 0.5, 1);
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.starfield.build(width, height);
  }

  clearWorld() {
    this.ship = null;
    this.asteroids = [];
    this.drones = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.pickups = [];
    this.texts = [];
    this.particles.clear();
    this.shake = 0;
    this.hurtFlash = 0;
  }

  /** Slow rocks drifting behind the menus. */
  seedBackdrop() {
    for (let i = 0; i < 7; i++) {
      this.asteroids.push(new Asteroid(rand(0, this.width), rand(0, this.height), pick([1, 2, 2, 3]), rand(0, TAU), 0.6));
    }
  }

  setState(state) {
    this.state = state;
    this.stateTime = 0;
  }

  // ---------- Flow ----------

  start() {
    this.clearWorld();
    this.stats = baseStats();
    this.levels = {};
    this.ship = new Ship(this.width / 2, this.height / 2, this.stats);
    this.score = 0;
    this.wave = 0;
    this.chain = 0;
    this.multiplier = 1;
    this.comboTimer = 0;
    this.deathTimer = 0;
    this.thrustEmit = 0;
    this.setState('playing');
    this.ui.show(null);
    this.ui.setHudVisible(true);
    this.sound.select();
    this.nextWave();
  }

  nextWave() {
    this.wave += 1;
    this.waveCleared = false;
    this.clearTimer = 0;

    const rocks = Math.max(3, Math.round(Math.min(2 + this.wave, 10) * this.density));
    const speedScale = 1 + Math.min(this.wave - 1, 10) * 0.05;
    for (let i = 0; i < rocks; i++) {
      const p = this.#spawnPoint(240);
      this.asteroids.push(new Asteroid(p.x, p.y, 3, rand(0, TAU), speedScale));
    }

    this.dronesToSpawn = this.wave >= CONFIG.drone.firstWave ? Math.min(Math.floor(this.wave * 0.7), 8) : 0;
    this.droneTimer = 3.5;

    const drones = this.dronesToSpawn;
    const sub = drones > 0
      ? `${rocks} rocks · ${drones} drone${drones === 1 ? '' : 's'} inbound`
      : `${rocks} rocks on scope`;
    this.ui.banner(`Sector ${pad2(this.wave)}`, sub);
  }

  openUpgrade() {
    this.ship.shield = Math.min(this.stats.maxShield, this.ship.shield + CONFIG.sectorRepair);
    this.sound.setThrust(0);
    const options = rollUpgrades(this.levels);
    if (options.length === 0) {
      this.nextWave();
      return;
    }
    this.setState('upgrade');
    this.ui.setHudVisible(false);
    this.upgradeOptions = options;
    this.ui.showUpgrades(this.wave, options, this.levels, (id) => this.chooseUpgrade(id));
  }

  chooseUpgrade(id) {
    if (this.state !== 'upgrade') return;
    const upgrade = UPGRADES.find((u) => u.id === id);
    upgrade.apply(this.stats, this.ship);
    this.levels[id] = (this.levels[id] ?? 0) + 1;
    this.sound.select();
    this.setState('playing');
    this.ui.show(null);
    this.ui.setHudVisible(true);
    this.ship.invulnerable = Math.max(this.ship.invulnerable, 1);
    this.nextWave();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.sound.setThrust(0);
    this.input.releaseAll();
    this.ui.show('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.setState('playing');
    this.ui.show(null);
  }

  toTitle() {
    this.clearWorld();
    this.seedBackdrop();
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
    this.ui.setHudVisible(false);
    this.ui.showGameOver({ score: this.score, wave: this.wave, best: this.best, newBest });
  }

  toggleMute() {
    this.sound.setMuted(!this.sound.muted);
    this.ui.setMuted(this.sound.muted);
  }

  // ---------- Update ----------

  update(dt) {
    this.time += dt;
    this.stateTime += dt;
    const input = this.input;
    // Menus ignore keys for a moment so a held fire button doesn't skip them.
    const settled = this.stateTime > 0.6;

    if (input.wasPressed('KeyM')) this.toggleMute();

    switch (this.state) {
      case 'title':
      case 'gameover':
        if (settled && input.wasPressed('Enter', 'Space')) this.start();
        else this.#updateAmbient(dt);
        break;
      case 'paused':
        if (input.wasPressed('KeyP', 'Escape')) this.resume();
        break;
      case 'upgrade': {
        const index = ['Digit1', 'Digit2', 'Digit3'].findIndex((k, i) => input.wasPressed(k, `Numpad${i + 1}`));
        if (settled && index >= 0 && this.upgradeOptions[index]) this.chooseUpgrade(this.upgradeOptions[index].id);
        else this.#updateAmbient(dt);
        break;
      }
      case 'playing':
        if (input.wasPressed('KeyP', 'Escape')) this.pause();
        else this.#updatePlay(dt);
        break;
    }

    input.endFrame();
  }

  /** Keeps the field alive behind menus: rocks drift, drones idle, nothing can hurt you. */
  #updateAmbient(dt) {
    const { width, height } = this;
    for (const a of this.asteroids) a.update(dt, width, height);
    for (const d of this.drones) d.update(dt, null, width, height);
    for (const b of this.bullets) b.update(dt, width, height);
    for (const b of this.enemyBullets) b.update(dt, width, height);
    for (const p of this.pickups) p.update(dt, null, width, height);
    this.bullets = this.bullets.filter((e) => !e.dead);
    this.enemyBullets = this.enemyBullets.filter((e) => !e.dead);
    this.pickups = this.pickups.filter((e) => !e.dead);
    this.particles.update(dt);
    this.#updateTexts(dt);
    this.starfield.update(dt, 14, 5);
    this.shake = 0;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
  }

  #updatePlay(dt) {
    const ship = this.ship;
    const { width, height } = this;

    if (!ship.dead) {
      const controls = this.input.read();
      if (controls.aim !== null) this.ui.dismissTouchHint();
      ship.update(dt, controls);
      wrapEntity(ship, width, height);
      if (controls.fire && ship.fireTimer <= 0) this.#fire();
      if (controls.boost && ship.boostTimer <= 0) this.#boost();
      this.#emitThrust(dt);
      this.sound.setThrust(ship.thrusting);
    } else {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.endRun();
    }

    for (const a of this.asteroids) a.update(dt, width, height);
    for (const d of this.drones) {
      const shot = d.update(dt, ship, width, height);
      if (shot) {
        this.enemyBullets.push(new Bullet(shot.x, shot.y, shot.vx, shot.vy, {
          life: 3,
          damage: CONFIG.drone.bulletDamage,
          radius: 5,
          hostile: true,
        }));
        this.sound.enemyShot();
      }
    }
    for (const b of this.bullets) b.update(dt, width, height);
    for (const b of this.enemyBullets) b.update(dt, width, height);
    for (const p of this.pickups) p.update(dt, ship, width, height);

    this.#collide();

    this.asteroids = this.asteroids.filter((e) => !e.dead);
    this.drones = this.drones.filter((e) => !e.dead);
    this.bullets = this.bullets.filter((e) => !e.dead);
    this.enemyBullets = this.enemyBullets.filter((e) => !e.dead);
    this.pickups = this.pickups.filter((e) => !e.dead);

    this.particles.update(dt);
    this.#updateTexts(dt);
    this.#updateCombo(dt);
    this.#updateSpawns(dt);
    this.#checkSectorClear(dt);

    this.starfield.update(dt, ship.vx * 0.5, ship.vy * 0.5);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);

    this.ui.updateHud({
      score: this.score,
      multiplier: this.multiplier,
      overdrive: ship.overdrive > 0,
      wave: this.wave,
      shield: ship.shield,
      maxShield: this.stats.maxShield,
      boost: ship.boostCharge,
    });
  }

  #updateTexts(dt) {
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 28 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
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
    if (this.dronesToSpawn <= 0 || this.ship.dead) return;
    this.droneTimer -= dt;
    if (this.droneTimer > 0) return;
    const p = this.#spawnPoint(260);
    this.drones.push(new Drone(p.x, p.y, this.wave));
    this.dronesToSpawn -= 1;
    this.droneTimer = rand(2.2, 4.2) - Math.min(this.wave * 0.1, 1);
  }

  #checkSectorClear(dt) {
    if (this.ship.dead) return;
    if (!this.waveCleared) {
      if (this.asteroids.length || this.drones.length || this.dronesToSpawn) return;
      this.waveCleared = true;
      this.clearTimer = CONFIG.waveClearDelay;
      const bonus = 100 * this.wave;
      this.score += bonus;
      this.sound.sectorClear();
      this.ui.banner(`Sector ${pad2(this.wave)} clear`, `Bonus +${bonus.toLocaleString('en-US')}`);
      return;
    }
    this.clearTimer -= dt;
    if (this.clearTimer <= 0) this.openUpgrade();
  }

  // ---------- Actions ----------

  #fire() {
    const ship = this.ship;
    const s = this.stats;
    ship.fireTimer = s.fireInterval * (ship.overdrive > 0 ? 0.5 : 1);
    const cos = Math.cos(ship.angle);
    const sin = Math.sin(ship.angle);
    const noseX = ship.x + cos * 16;
    const noseY = ship.y + sin * 16;

    for (const [lateral, spread] of GUN_LAYOUTS[Math.min(s.guns, 3)]) {
      const a = ship.angle + spread;
      const x = noseX - sin * lateral;
      const y = noseY + cos * lateral;
      this.bullets.push(new Bullet(
        x,
        y,
        Math.cos(a) * s.bulletSpeed + ship.vx * 0.5,
        Math.sin(a) * s.bulletSpeed + ship.vy * 0.5,
        { life: s.bulletLife, damage: s.bulletDamage, radius: 3 },
      ));
    }
    ship.vx -= cos * 5; // a little recoil
    ship.vy -= sin * 5;
    this.particles.emit(noseX, noseY, {
      count: 3,
      color: this.palette.flare,
      angle: ship.angle,
      spread: 0.8,
      speed: [80, 180],
      life: [0.05, 0.12],
      size: [1, 2],
      vx: ship.vx,
      vy: ship.vy,
    });
    this.sound.laser();
  }

  #boost() {
    const ship = this.ship;
    ship.boostTimer = this.stats.boostCooldown;
    ship.boosting = CONFIG.ship.boostDuration;
    ship.vx += Math.cos(ship.angle) * CONFIG.ship.boostImpulse;
    ship.vy += Math.sin(ship.angle) * CONFIG.ship.boostImpulse;
    // A short dodge window, without the hit flicker.
    ship.invulnerable = Math.max(ship.invulnerable, 0.3);
    this.particles.emit(ship.x, ship.y, {
      count: 18,
      color: this.palette.ice,
      angle: ship.angle + Math.PI,
      spread: 1.2,
      speed: [120, 300],
      life: [0.2, 0.45],
      size: [1, 2.2],
    });
    this.particles.ring(ship.x, ship.y, { radius: 34, life: 0.35, color: this.palette.ice, width: 1.5 });
    this.sound.boost();
  }

  #emitThrust(dt) {
    const ship = this.ship;
    const burn = ship.boosting > 0 ? 1.5 : ship.thrusting;
    if (burn < 0.05) return;
    this.thrustEmit += 70 * burn * dt;
    const back = ship.angle + Math.PI;
    while (this.thrustEmit >= 1) {
      this.thrustEmit -= 1;
      this.particles.emit(ship.x + Math.cos(back) * 9, ship.y + Math.sin(back) * 9, {
        count: 1,
        color: Math.random() < 0.5 ? this.palette.flare : this.palette.flareHot,
        angle: back,
        spread: 0.5,
        speed: [120, 220],
        life: [0.18, 0.38],
        size: [1.5, 2.8],
        vx: ship.vx * 0.5,
        vy: ship.vy * 0.5,
      });
    }
  }

  // ---------- Collisions and damage ----------

  #collide() {
    for (const b of this.bullets) {
      if (b.dead) continue;
      for (const a of this.asteroids) {
        if (!a.dead && circlesOverlap(b, a)) {
          b.dead = true;
          this.#hitAsteroid(a, b.damage, b);
          break;
        }
      }
      if (b.dead) continue;
      for (const d of this.drones) {
        if (!d.dead && d.active && circlesOverlap(b, d)) {
          b.dead = true;
          this.#hitDrone(d, b.damage, b);
          break;
        }
      }
    }

    const ship = this.ship;
    if (ship.dead) return;

    for (const a of this.asteroids) {
      if (a.dead || !circlesOverlap(ship, a)) continue;
      this.#bounce(ship, a);
      if (this.#damageShip(CONFIG.asteroid[a.tier].damage)) this.#hitAsteroid(a, 2, ship);
      if (ship.dead) return;
    }
    for (const d of this.drones) {
      if (d.dead || !d.active || !circlesOverlap(ship, d)) continue;
      this.#bounce(ship, d);
      if (this.#damageShip(CONFIG.drone.damage)) this.#hitDrone(d, 3, ship);
      if (ship.dead) return;
    }
    for (const b of this.enemyBullets) {
      if (b.dead || !circlesOverlap(ship, b)) continue;
      b.dead = true;
      this.#damageShip(b.damage);
      if (ship.dead) return;
    }
    for (const p of this.pickups) {
      if (!p.dead && circlesOverlap(ship, p)) {
        p.dead = true;
        this.#collect(p);
      }
    }
  }

  /** Pushes the ship out of a heavier body and reflects its velocity. */
  #bounce(ship, body) {
    const dx = ship.x - body.x;
    const dy = ship.y - body.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    ship.x = body.x + nx * (ship.radius + body.radius + 0.5);
    ship.y = body.y + ny * (ship.radius + body.radius + 0.5);
    const closing = (ship.vx - body.vx) * nx + (ship.vy - body.vy) * ny;
    if (closing < 0) {
      ship.vx -= 1.6 * closing * nx;
      ship.vy -= 1.6 * closing * ny;
    }
  }

  #hitAsteroid(a, damage, source) {
    a.hp -= damage;
    a.flash = 1;
    this.particles.emit(source.x, source.y, {
      count: 4,
      color: this.palette.rockEdge,
      speed: [60, 160],
      life: [0.15, 0.35],
      size: [1, 2],
    });
    if (a.hp > 0) {
      this.sound.chip();
      return;
    }

    a.dead = true;
    this.#addScore(CONFIG.asteroid[a.tier].score, a.x, a.y);
    this.#explode(a.x, a.y, a.radius, this.palette.rockEdge, this.palette.flare);
    this.sound.explode(a.tier / 3);
    this.#addShake(a.tier * 2.5);

    if (a.tier > 1) {
      const heading = Math.atan2(a.vy, a.vx);
      for (const side of [-1, 1]) {
        const dir = heading + side * rand(0.35, 0.9);
        const offset = a.radius * 0.35;
        this.asteroids.push(new Asteroid(
          a.x + Math.cos(dir) * offset,
          a.y + Math.sin(dir) * offset,
          a.tier - 1,
          dir,
          a.speedScale,
        ));
      }
    }
    if (Math.random() < CONFIG.pickups.dropChance.asteroid) this.#dropPickup(a.x, a.y);
  }

  #hitDrone(d, damage, source) {
    d.hp -= damage;
    d.flash = 0.15;
    this.particles.emit(source.x, source.y, {
      count: 5,
      color: this.palette.hostile,
      speed: [60, 180],
      life: [0.15, 0.35],
      size: [1, 2],
    });
    if (d.hp > 0) {
      this.sound.chip();
      return;
    }

    d.dead = true;
    this.#addScore(CONFIG.drone.score, d.x, d.y);
    this.#explode(d.x, d.y, 26, this.palette.hostile, this.palette.flare);
    this.sound.explode(0.6);
    this.#addShake(5);
    if (Math.random() < CONFIG.pickups.dropChance.drone) this.#dropPickup(d.x, d.y);
  }

  /** Applies damage unless the ship is in its grace period. Returns whether damage landed. */
  #damageShip(amount) {
    const ship = this.ship;
    if (ship.invulnerable > 0 || ship.dead) return false;
    ship.shield -= amount;
    ship.invulnerable = CONFIG.ship.invulnerable;
    ship.blink = CONFIG.ship.invulnerable;
    this.chain = 0;
    this.multiplier = 1;
    this.hurtFlash = 1;
    this.#addShake(9);
    this.sound.hit();
    this.particles.emit(ship.x, ship.y, {
      count: 14,
      color: this.palette.ice,
      speed: [80, 220],
      life: [0.2, 0.5],
      size: [1, 2.5],
    });
    if (ship.shield <= 0) this.#destroyShip();
    return true;
  }

  #destroyShip() {
    const ship = this.ship;
    ship.dead = true;
    ship.shield = 0;
    this.deathTimer = 2;
    this.sound.setThrust(0);
    this.#explode(ship.x, ship.y, 60, this.palette.hull, this.palette.flareHot);
    this.particles.emit(ship.x, ship.y, {
      count: 40,
      color: this.palette.ice,
      speed: [60, 340],
      life: [0.6, 1.4],
      size: [1, 3],
      drag: 1.2,
    });
    this.particles.ring(ship.x, ship.y, { radius: 160, life: 0.9, color: this.palette.flare, width: 3 });
    this.#addShake(18);
    this.sound.explode(1);
    this.sound.gameOver();
  }

  #dropPickup(x, y) {
    this.pickups.push(new Pickup(x, y, Math.random() < 0.65 ? PICKUP_KINDS[0] : PICKUP_KINDS[1]));
  }

  #collect(p) {
    const ship = this.ship;
    if (p.kind === 'shield') {
      ship.shield = Math.min(this.stats.maxShield, ship.shield + CONFIG.pickups.shieldAmount);
      this.#floatText(p.x, p.y, `+${CONFIG.pickups.shieldAmount} shield`, this.palette.ice);
    } else {
      ship.overdrive = CONFIG.pickups.overdriveTime;
      this.#floatText(p.x, p.y, 'Overdrive', this.palette.flareHot);
    }
    const color = p.kind === 'shield' ? this.palette.ice : this.palette.flareHot;
    this.particles.ring(p.x, p.y, { radius: 30, life: 0.35, color, width: 2 });
    this.sound.pickup();
  }

  #addScore(points, x, y) {
    const { window: comboWindow, killsPerStep, maxMultiplier } = CONFIG.combo;
    this.chain += 1;
    this.comboTimer = comboWindow;
    this.multiplier = Math.min(maxMultiplier, 1 + Math.floor(this.chain / killsPerStep));
    const gained = points * this.multiplier;
    this.score += gained;
    this.#floatText(x, y, `+${gained}`, this.multiplier > 1 ? this.palette.flare : this.palette.hull);
  }

  #explode(x, y, radius, color, accent) {
    const n = Math.round(10 + radius * 0.6);
    this.particles.emit(x, y, { count: n, color, speed: [40, 120 + radius * 3], life: [0.4, 0.9], size: [1.5, 3] });
    this.particles.emit(x, y, { count: Math.round(n / 2), color: accent, speed: [80, 260], life: [0.2, 0.5], size: [1, 2.5] });
    this.particles.ring(x, y, { radius: radius * 1.8, life: 0.45, color: accent, width: 2 });
  }

  #addShake(amount) {
    if (!this.reduceMotion) this.shake = Math.max(this.shake, amount);
  }

  #floatText(x, y, text, color) {
    this.texts.push({ x, y, text, color, life: 0.9, max: 0.9 });
  }

  #spawnPoint(minDistance) {
    let p = { x: rand(0, this.width), y: rand(0, this.height) };
    if (!this.ship) return p;
    for (let i = 0; i < 30; i++) {
      if (Math.hypot(p.x - this.ship.x, p.y - this.ship.y) >= minDistance) break;
      p = { x: rand(0, this.width), y: rand(0, this.height) };
    }
    return p;
  }

  *#entities() {
    if (this.ship) yield this.ship;
    yield* this.asteroids;
    yield* this.drones;
    yield* this.bullets;
    yield* this.enemyBullets;
    yield* this.pickups;
  }

  // ---------- Render ----------

  render() {
    const { ctx, palette: p, width, height } = this;
    const k = this.dpr * this.viewScale;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.shake > 0.1) ctx.translate(rand(-this.shake, this.shake), rand(-this.shake, this.shake));

    this.starfield.draw(ctx, width, height);
    for (const pk of this.pickups) pk.draw(ctx, p, this.time);
    for (const a of this.asteroids) a.draw(ctx, p);
    for (const d of this.drones) d.draw(ctx, p, this.time);
    if (this.ship && !this.ship.dead) this.ship.draw(ctx, p, this.time);

    ctx.globalCompositeOperation = 'lighter';
    drawShots(ctx, this.bullets, p.flare);
    drawOrbs(ctx, this.enemyBullets, p.hostile);
    this.particles.draw(ctx);
    ctx.globalCompositeOperation = 'source-over';

    ctx.font = `600 13px ${p.fontMono}`;
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, (t.life / t.max) * 1.6);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    if (this.hurtFlash > 0) {
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.globalAlpha = this.hurtFlash * 0.16;
      ctx.fillStyle = p.hostile;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }

    this.#drawStick();
  }

  /** The floating thumbstick, drawn in CSS pixels where the thumb landed. */
  #drawStick() {
    const stick = this.input.stick;
    if (!stick || this.state !== 'playing') return;
    const { ctx, palette: p } = this;
    const rect = this.canvas.getBoundingClientRect();
    const ox = stick.ox - rect.left;
    const oy = stick.oy - rect.top;
    const radius = this.input.stickRadius;
    let dx = stick.x - stick.ox;
    let dy = stick.y - stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > radius) {
      dx *= radius / len;
      dy *= radius / len;
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = p.dim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ox, oy, radius, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = p.flare;
    ctx.beginPath();
    ctx.arc(ox + dx, oy + dy, 22, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
