import * as THREE from 'three';
import { clamp, smooth } from '../util/math.js';

const TURRET_YAW_SPEED = 0.75;
const TURRET_PITCH_SPEED = 0.55;
const TURRET_PIVOT_HEIGHT = 6;
const MAX_PITCH = 1.4;
const MIN_PITCH = -0.12;
const TURRET_ARC = 2.6; // radians either side of a turret's rest direction it can traverse

/**
 * A capital ship in flight: slow heading and pitch changes (no roll beyond a little bank),
 * thrust toward a throttle-set speed, turrets that track targets, shields and hull.
 * Shared by your warship and the enemy flagship.
 */
export class CapitalShip {
  constructor(model, { hull, shield = 0, maxSpeed, yawRate, pitchRate, accel = 4, turnAccel = 0.08 }) {
    this.model = model;
    this.object = model.object;
    this.position = this.object.position;
    this.velocity = new THREE.Vector3();
    this.heading = 0; // yaw around world up; 0 faces -Z
    this.pitch = 0;
    this.bank = 0;
    this.yawRate = 0;
    this.pitchRate = 0;
    this.yawCommand = 0; // -1..1, positive turns left
    this.pitchCommand = 0; // -1..1, positive noses up
    this.throttle = 0;
    this.maxSpeed = maxSpeed;
    this.maxYawRate = yawRate;
    this.maxPitchRate = pitchRate;
    this.accel = accel;
    this.turnAccel = turnAccel;
    this.speedFactor = 1; // engines condition scales speed and turning
    this.maxHull = hull;
    this.hull = hull;
    this.maxShield = shield;
    this.shield = shield;
    this.radius = 120; // rough size for AI spacing
    this.dead = false;
    this.colliders = model.colliders.map((c) => ({ offset: c.offset, radius: c.radius, position: new THREE.Vector3() }));
    this._v = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.#applyTransform();
  }

  forward(out = new THREE.Vector3()) {
    return out.set(
      -Math.sin(this.heading) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.heading) * Math.cos(this.pitch),
    );
  }

  get speed() {
    return this.velocity.length();
  }

  setHeading(heading, pitch = 0) {
    this.heading = heading;
    this.pitch = pitch;
    this.#applyTransform();
  }

  /** Sets yaw and pitch commands that turn the ship toward a world point. Returns the angle still to go. */
  steerToward(point) {
    const local = this._v.copy(point).sub(this.position);
    const yawTo = Math.atan2(-local.x, -local.z);
    const pitchTo = Math.atan2(local.y, Math.hypot(local.x, local.z));
    let yawErr = yawTo - this.heading;
    yawErr = Math.atan2(Math.sin(yawErr), Math.cos(yawErr));
    const pitchErr = clamp(pitchTo, -0.6, 0.6) - this.pitch;
    this.yawCommand = clamp(yawErr * 3, -1, 1);
    this.pitchCommand = clamp(pitchErr * 3, -1, 1);
    return Math.hypot(yawErr, pitchErr);
  }

  update(dt, time) {
    const f = this.speedFactor;
    // Turn rates ease toward the command: big ships take a while to start and stop turning.
    const step = this.turnAccel * dt;
    this.yawRate += clamp(this.yawCommand * this.maxYawRate * f - this.yawRate, -step, step);
    this.pitchRate += clamp(this.pitchCommand * this.maxPitchRate * f - this.pitchRate, -step, step);
    this.heading += this.yawRate * dt;
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -0.7, 0.7);
    // Level out slowly when not climbing or diving.
    if (Math.abs(this.pitchCommand) < 0.05) this.pitch *= Math.exp(-0.15 * dt);
    this.bank += (clamp(-this.yawRate * 1.6, -0.08, 0.08) - this.bank) * smooth(1.5, dt);

    const cruise = this.throttle * this.maxSpeed * f;
    const want = this.forward(this._v).multiplyScalar(cruise);
    const diff = want.sub(this.velocity);
    const len = diff.length();
    if (len > 0) this.velocity.addScaledVector(diff, Math.min(1, (this.accel * dt) / len));
    this.position.addScaledVector(this.velocity, dt);
    this.#applyTransform();

    const thrust = Math.max(0.15, Math.abs(this.throttle));
    for (const glow of this.model.engines) glow.scale.setScalar(26 + thrust * 30 + Math.random() * 3);
    for (const light of this.model.navLights) {
      if (light.userData.blink) light.visible = Math.floor(time * 1.25) % 2 === 0 && (time * 1.25) % 1 < 0.15;
    }
  }

  /** Points every turret that can bear toward `point`. Returns turrets aligned well enough to fire. */
  aimTurrets(point, dt) {
    const ready = [];
    for (const t of this.model.turrets) {
      const local = t.base.worldToLocal(this._v.copy(point));
      let yaw = Math.atan2(-local.x, -local.z);
      const h = Math.hypot(local.x, local.z);
      const pitch = Math.atan2(local.y - TURRET_PIVOT_HEIGHT, h);
      // Stay inside the turret's traverse arc, measured from its rest direction.
      let fromRest = Math.atan2(Math.sin(yaw - t.restYaw), Math.cos(yaw - t.restYaw));
      const inArc = Math.abs(fromRest) <= TURRET_ARC && pitch >= MIN_PITCH - 0.05;
      if (!inArc) {
        fromRest = 0; // return to rest
        yaw = t.restYaw;
      }
      const targetPitch = inArc ? clamp(pitch, MIN_PITCH, MAX_PITCH) : 0;
      const currentFromRest = Math.atan2(Math.sin(t.yaw.rotation.y - t.restYaw), Math.cos(t.yaw.rotation.y - t.restYaw));
      const dy = clamp(fromRest - currentFromRest, -TURRET_YAW_SPEED * dt, TURRET_YAW_SPEED * dt);
      t.yaw.rotation.y = t.restYaw + currentFromRest + dy;
      const dp = clamp(targetPitch - t.pitch.rotation.x, -TURRET_PITCH_SPEED * dt, TURRET_PITCH_SPEED * dt);
      t.pitch.rotation.x += dp;
      const aligned = Math.abs(fromRest - currentFromRest - dy) < 0.05 && Math.abs(targetPitch - t.pitch.rotation.x) < 0.05;
      if (inArc && aligned) ready.push(t);
    }
    return ready;
  }

  /** Swings turrets back to their rest positions. */
  restTurrets(dt) {
    for (const t of this.model.turrets) {
      const fromRest = Math.atan2(Math.sin(t.yaw.rotation.y - t.restYaw), Math.cos(t.yaw.rotation.y - t.restYaw));
      t.yaw.rotation.y -= clamp(fromRest, -TURRET_YAW_SPEED * dt * 0.5, TURRET_YAW_SPEED * dt * 0.5);
      t.pitch.rotation.x -= clamp(t.pitch.rotation.x, -TURRET_PITCH_SPEED * dt * 0.5, TURRET_PITCH_SPEED * dt * 0.5);
    }
  }

  /** World position of one of a turret's barrel tips. */
  muzzle(turret, index, out = new THREE.Vector3()) {
    return turret.pitch.localToWorld(out.copy(turret.muzzles[index]));
  }

  /** Absorbs damage with shields first. Returns the damage that reached the hull. */
  takeDamage(amount) {
    const absorbed = Math.min(this.shield, amount);
    this.shield -= absorbed;
    const rest = amount - absorbed;
    this.hull = Math.max(0, this.hull - rest);
    if (this.hull <= 0) this.dead = true;
    return rest;
  }

  /** Closest collision sphere overlapping a sphere at `point`, or null. */
  hitSphere(point, radius) {
    for (const c of this.colliders) {
      const r = c.radius + radius;
      if (c.position.distanceToSquared(point) < r * r) return c;
    }
    return null;
  }

  #applyTransform() {
    this._euler.set(this.pitch, this.heading, this.bank);
    this.object.quaternion.setFromEuler(this._euler);
    this.object.updateMatrixWorld(true);
    for (const c of this.colliders) c.position.copy(c.offset).applyMatrix4(this.object.matrixWorld);
  }
}
