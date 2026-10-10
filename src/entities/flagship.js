import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { CapitalShip } from './capital.js';
import { rand, randomUnit } from '../util/math.js';

/**
 * The enemy capital ship each sector is built around. It idles until it notices you, then closes to
 * gun range, turns to bring its batteries to bear, and launches fighters.
 */
export class Flagship extends CapitalShip {
  constructor(model, sectorIndex) {
    const f = CONFIG.flagship;
    super(model, {
      hull: f.hull + f.hullPerSector * (sectorIndex - 1),
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
    this.flash = 0;
    this.orbitSide = Math.random() < 0.5 ? -1 : 1;
  }

  get active() {
    return !this.dead;
  }

  /**
   * Runs the flagship's tactics against your warship. Returns { shots, launch, noticed } for this frame.
   */
  think(dt, enemy, fighters) {
    const f = CONFIG.flagship;
    const result = { shots: [], launch: false, noticed: false };
    if (this.dead) return result;

    const toEnemy = new THREE.Vector3().subVectors(enemy.position, this.position);
    const dist = toEnemy.length();

    if (this.state === 'dormant') {
      this.throttle = 0.12;
      this.yawCommand = 0.15;
      this.pitchCommand = 0;
      this.restTurrets(dt);
      if (dist < f.noticeRange || this.hull < this.maxHull) {
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
        if (!ready.includes(t) || this.gunTimers[i] > 0) return;
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
      if (fighters < f.maxFighters) result.launch = true;
    }
    return result;
  }
}
