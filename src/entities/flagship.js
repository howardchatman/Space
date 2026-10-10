import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { CapitalShip } from './capital.js';
import { rand, randomUnit } from '../util/math.js';

/**
 * A weak point on the flagship you can target: one of its gun turrets, its engines or its hangar.
 * Exposes the same shape as other targets (position, velocity, dead, name).
 */
export class FlagshipPart {
  constructor(ship, { type, name, label, local, radius, hp, turret = null }) {
    this.ship = ship;
    this.kind = 'subsystem';
    this.type = type;
    this.name = name;
    this.label = label;
    this.local = local;
    this.radius = radius;
    this.maxHp = hp;
    this.hp = hp;
    this.turret = turret;
    this._p = new THREE.Vector3();
  }

  get position() {
    return this.ship.object.localToWorld(this._p.copy(this.local));
  }

  get velocity() {
    return this.ship.velocity;
  }

  get destroyed() {
    return this.hp <= 0;
  }

  get dead() {
    return this.ship.dead || this.hp <= 0;
  }
}

/**
 * The enemy capital ship each sector is built around. Shields absorb fire until they collapse; then its
 * guns, engines and hangar can be knocked out one by one. It idles until it notices you, then closes to
 * gun range, turns broadside so its batteries bear, and launches fighters.
 */
export class Flagship extends CapitalShip {
  constructor(model, sectorIndex) {
    const f = CONFIG.flagship;
    const k = sectorIndex - 1;
    super(model, {
      hull: f.hull + f.hullPerSector * k,
      shield: f.shield + f.shieldPerSector * k,
      maxSpeed: f.speed,
      yawRate: f.yawRate,
      pitchRate: 0.05,
    });
    this.name = 'Enemy flagship';
    this.kind = 'flagship';
    this.state = 'dormant';
    this.gunTimers = model.turrets.map(() => rand(0, 1));
    this.barrel = model.turrets.map(() => 0);
    this.launchTimer = 6;
    this.sinceHit = 99;
    this.flash = 0;
    this.orbitSide = Math.random() < 0.5 ? -1 : 1;
    const scale = 1 + f.partsPerSector * k;
    this.parts = [
      ...model.turrets.map((t, i) => new FlagshipPart(this, {
        type: 'gun',
        name: 'Flagship gun battery',
        label: `GUN ${i + 1}`,
        local: t.base.position.clone(),
        radius: 18,
        hp: f.parts.gun * scale,
        turret: t,
      })),
      new FlagshipPart(this, { type: 'engines', name: 'Flagship engines', label: 'ENGINES', local: new THREE.Vector3(0, 0, 214), radius: 42, hp: f.parts.engines * scale }),
      new FlagshipPart(this, { type: 'hangar', name: 'Flagship hangar', label: 'HANGAR', local: model.hangar.position.clone(), radius: 28, hp: f.parts.hangar * scale }),
    ];
  }

  get active() {
    return !this.dead;
  }

  get enginesDown() {
    return this.parts.some((p) => p.type === 'engines' && p.destroyed);
  }

  get hangarDown() {
    return this.parts.some((p) => p.type === 'hangar' && p.destroyed);
  }

  /** Marks a knocked-out part's effect on the ship. */
  disable(part) {
    if (part.turret) {
      part.turret.disabled = true;
      part.turret.pitch.rotation.x = -0.08; // barrels slump
    }
    if (part.type === 'engines') this.speedFactor = 0.2;
  }

  /**
   * Runs the flagship's tactics against your warship. Returns { shots, launch, noticed } for this frame.
   */
  think(dt, enemy, fighters) {
    const f = CONFIG.flagship;
    const result = { shots: [], launch: false, noticed: false };
    if (this.dead) return result;

    this.sinceHit += dt;
    if (this.sinceHit > f.shieldDelay) this.shield = Math.min(this.maxShield, this.shield + f.shieldRegen * dt);

    const toEnemy = new THREE.Vector3().subVectors(enemy.position, this.position);
    const dist = toEnemy.length();

    if (this.state === 'dormant') {
      this.throttle = 0.12;
      this.yawCommand = 0.15;
      this.pitchCommand = 0;
      this.restTurrets(dt);
      if (dist < f.noticeRange || this.hull < this.maxHull || this.shield < this.maxShield) {
        this.state = 'hunting';
        result.noticed = true;
      }
      return result;
    }

    // Close in, then swing broadside so more turrets bear.
    if (dist > f.engageRange) {
      this.steerToward(enemy.position);
      this.throttle = 1;
    } else {
      const side = new THREE.Vector3(-toEnemy.z, 0, toEnemy.x).normalize().multiplyScalar(this.orbitSide * 600);
      this.steerToward(side.add(enemy.position).addScaledVector(toEnemy, -0.15));
      this.throttle = 0.45;
    }

    const lead = enemy.position.clone().addScaledVector(enemy.velocity, dist / f.boltSpeed);
    const ready = this.aimTurrets(lead, dt);
    if (dist < f.gunRange) {
      this.model.turrets.forEach((t, i) => {
        this.gunTimers[i] -= dt;
        if (t.disabled || !ready.includes(t) || this.gunTimers[i] > 0) return;
        this.gunTimers[i] = rand(f.gunInterval[0], f.gunInterval[1]);
        const b = (this.barrel[i] = (this.barrel[i] + 1) % t.muzzles.length);
        const origin = this.muzzle(t, b);
        const dir = lead.clone().sub(origin).normalize();
        dir.add(randomUnit(new THREE.Vector3()).multiplyScalar(f.spread)).normalize();
        result.shots.push({ origin, velocity: dir.multiplyScalar(f.boltSpeed) });
      });
    }

    this.launchTimer -= dt;
    if (this.launchTimer <= 0) {
      this.launchTimer = f.launchInterval;
      if (fighters < f.maxFighters && !this.hangarDown) result.launch = true;
    }
    return result;
  }
}
