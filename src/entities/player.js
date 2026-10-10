import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, smooth } from '../util/math.js';

/** A fresh copy of the ship's upgradeable stats. Upgrades mutate this object. */
export function baseStats() {
  const p = CONFIG.player;
  return {
    maxSpeed: p.maxSpeed,
    strafeSpeed: p.strafeSpeed,
    accel: p.accel,
    turnRate: p.turnRate,
    rollRate: p.rollRate,
    fireInterval: p.fireInterval,
    boltSpeed: p.boltSpeed,
    boltRange: p.boltRange,
    boltDamage: p.boltDamage,
    guns: 1, // 1: wing cannons alternate, 2: they fire together, 3: plus a nose cannon
    maxShield: p.maxShield,
    regen: 0,
    magnetRange: p.magnetRange,
    boostCooldown: p.boostCooldown,
  };
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const MAX_PENDING_LOOK = 0.7; // radians of mouse movement the ship can lag behind

/**
 * The player's ship: position, orientation and an assisted flight model. Throttle sets a cruise speed
 * and the thrusters work to hold it, so the ship drifts and slides through turns but stays controllable.
 */
export class Player {
  constructor(stats) {
    this.stats = stats;
    this.radius = CONFIG.player.radius;
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.angular = new THREE.Vector3(); // current pitch, yaw, roll rates
    this.pendingLook = new THREE.Vector2();
    this.throttle = CONFIG.player.startThrottle;
    this.shield = stats.maxShield;
    this.fireTimer = 0;
    this.gunIndex = 0;
    this.boostTimer = 0;
    this.boosting = 0;
    this.invulnerable = 1.5;
    this.overdrive = 0;
    this.dead = false;
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.quaternion);
  }

  right(out = new THREE.Vector3()) {
    return out.set(1, 0, 0).applyQuaternion(this.quaternion);
  }

  up(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.quaternion);
  }

  get speed() {
    return this.velocity.length();
  }

  /** 0 right after a boost, 1 when the next boost is ready. */
  get boostCharge() {
    return clamp(1 - this.boostTimer / this.stats.boostCooldown, 0, 1);
  }

  update(dt, c) {
    const s = this.stats;

    // Stick and keys set turn rates; the ship eases into them.
    const target = this._v.set(c.pitch * s.turnRate, c.yaw * s.turnRate, c.roll * s.rollRate);
    this.angular.lerp(target, smooth(7, dt));

    // Mouse movement turns the ship directly, but no faster than its thrusters allow.
    this.pendingLook.x = clamp(this.pendingLook.x + c.lookX, -MAX_PENDING_LOOK, MAX_PENDING_LOOK);
    this.pendingLook.y = clamp(this.pendingLook.y + c.lookY, -MAX_PENDING_LOOK, MAX_PENDING_LOOK);
    const maxStep = s.turnRate * 1.7 * dt;
    const k = smooth(16, dt);
    const lookYaw = clamp(this.pendingLook.x * k, -maxStep, maxStep);
    const lookPitch = clamp(this.pendingLook.y * k, -maxStep, maxStep);
    this.pendingLook.x -= lookYaw;
    this.pendingLook.y -= lookPitch;

    const q = this.quaternion;
    q.multiply(this._q.setFromAxisAngle(X, this.angular.x * dt + lookPitch));
    q.multiply(this._q.setFromAxisAngle(Y, this.angular.y * dt + lookYaw));
    q.multiply(this._q.setFromAxisAngle(Z, this.angular.z * dt));
    q.normalize();

    this.throttle = clamp(this.throttle + c.throttle * dt * 0.7, 0, 1);

    // Flight assist: thrust toward the velocity the controls ask for.
    const boosting = this.boosting > 0;
    const cruise = boosting ? CONFIG.player.boostSpeed : this.throttle * s.maxSpeed;
    const want = this.forward(this._v).multiplyScalar(cruise);
    const lateral = new THREE.Vector3();
    want.addScaledVector(this.right(lateral), c.strafeX * s.strafeSpeed);
    want.addScaledVector(this.up(lateral), c.strafeY * s.strafeSpeed);
    const diff = want.sub(this.velocity);
    const maxDv = s.accel * (boosting ? 4 : 1) * dt;
    const len = diff.length();
    if (len > 0) this.velocity.addScaledVector(diff, Math.min(1, maxDv / len));

    this.position.addScaledVector(this.velocity, dt);

    this.fireTimer -= dt;
    this.boostTimer -= dt;
    this.boosting -= dt;
    this.invulnerable -= dt;
    this.overdrive -= dt;
    if (s.regen > 0) this.shield = Math.min(s.maxShield, this.shield + s.regen * dt);
  }
}
