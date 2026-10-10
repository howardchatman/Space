import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { CapitalShip } from './capital.js';
import { rand, randomUnit } from '../util/math.js';

/**
 * An enemy corvette. Escorts stay with the flagship until something comes near; then the corvette
 * circles its target at torpedo range, fires its turret and launches homing torpedoes.
 */
export class Corvette extends CapitalShip {
  constructor(model, sectorIndex, escortOf = null) {
    const c = CONFIG.corvette;
    super(model, {
      hull: c.hull + c.hullPerSector * (sectorIndex - 1),
      maxSpeed: c.speed,
      yawRate: c.yawRate,
      pitchRate: 0.18,
      accel: 12,
      turnAccel: 0.35,
    });
    this.model.engineGlowSize = 0.32;
    this.kind = 'corvette';
    this.name = 'Enemy corvette';
    this.radius = 50;
    this.state = 'dormant';
    this.escortOf = escortOf;
    this.home = new THREE.Vector3();
    this.orbit = rand(0, Math.PI * 2);
    this.orbitDir = Math.random() < 0.5 ? -1 : 1;
    this.gunTimer = rand(1, 2);
    this.torpedoTimer = rand(4, 8);
    this.flash = 0;
  }

  get active() {
    return !this.dead;
  }

  /** Runs the corvette's tactics. Returns { shots, torpedo, noticed } for this frame. */
  think(dt, enemy) {
    const c = CONFIG.corvette;
    const result = { shots: [], torpedo: null, noticed: false };
    if (this.dead) return result;
    const toEnemy = new THREE.Vector3().subVectors(enemy.position, this.position);
    const dist = toEnemy.length();

    if (this.state === 'dormant') {
      this.orbit += this.orbitDir * 0.05 * dt;
      const center = this.escortOf && !this.escortOf.dead ? this.escortOf.position : this.home;
      const point = new THREE.Vector3(Math.cos(this.orbit) * 650, 60, Math.sin(this.orbit) * 650).add(center);
      this.steerToward(point);
      this.throttle = 0.5;
      this.restTurrets(dt);
      const alarmed = this.escortOf && !this.escortOf.dead && this.escortOf.state === 'hunting';
      if (dist < c.noticeRange || alarmed || this.hull < this.maxHull) {
        this.state = 'attack';
        result.noticed = true;
      }
      return result;
    }

    // Circle the target at torpedo range.
    this.orbit += this.orbitDir * 0.07 * dt;
    const away = toEnemy.clone().negate().setY(0).normalize();
    const around = away.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.orbitDir * 0.9);
    this.steerToward(around.multiplyScalar(c.standoff).add(enemy.position));
    this.throttle = 1;

    const lead = enemy.position.clone().addScaledVector(enemy.velocity, dist / c.boltSpeed);
    const ready = this.aimTurrets(lead, dt);
    this.gunTimer -= dt;
    if (ready.length && this.gunTimer <= 0 && dist < c.gunRange) {
      this.gunTimer = rand(c.gunInterval[0], c.gunInterval[1]);
      const t = ready[0];
      for (let b = 0; b < t.muzzles.length; b++) {
        const origin = this.muzzle(t, b);
        const dir = lead.clone().sub(origin).normalize();
        dir.add(randomUnit(new THREE.Vector3()).multiplyScalar(0.02)).normalize();
        result.shots.push({ origin, velocity: dir.multiplyScalar(c.boltSpeed) });
      }
    }

    this.torpedoTimer -= dt;
    if (this.torpedoTimer <= 0 && dist < c.torpedoRange) {
      this.torpedoTimer = rand(c.torpedoInterval[0], c.torpedoInterval[1]);
      const origin = this.object.localToWorld(this.model.torpedoTube.clone());
      result.torpedo = { origin, direction: this.forward(new THREE.Vector3()) };
    }
    return result;
  }
}
