import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { glowTexture } from '../fx/textures.js';
import { clamp, rand, randomUnit, smooth } from '../util/math.js';

const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

/** Builds the shared drone model once: a gunmetal fighter with red running lights. Forward is +Z. */
export function buildDroneModel(hostileColor) {
  const parts = [];
  const nose = new THREE.ConeGeometry(1.3, 5.5, 8);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, 2.2);
  parts.push(nose);
  const body = new THREE.CylinderGeometry(1.3, 1.05, 3, 8);
  body.rotateX(Math.PI / 2);
  body.translate(0, 0, -1.3);
  parts.push(body);
  for (const side of [-1, 1]) {
    const wing = new THREE.BoxGeometry(5, 0.22, 2.6);
    wing.translate(side * 3, 0, -1.4);
    wing.rotateZ(side * -0.18);
    parts.push(wing);
    const fin = new THREE.BoxGeometry(0.22, 2.2, 2.2);
    fin.translate(side * 5.4, 0.5, -1.9);
    parts.push(fin);
    const pod = new THREE.CylinderGeometry(0.45, 0.45, 2.6, 8);
    pod.rotateX(Math.PI / 2);
    pod.translate(side * 2.2, -0.5, -0.4);
    parts.push(pod);
  }
  const hull = new THREE.Mesh(
    mergeGeometries(parts),
    new THREE.MeshStandardMaterial({ color: 0x4a4f58, metalness: 0.55, roughness: 0.42 }),
  );

  const canopyGeometry = new THREE.SphereGeometry(0.85, 16, 10);
  canopyGeometry.scale(1, 0.6, 1.8);
  canopyGeometry.translate(0, 0.75, 0.9);
  const canopy = new THREE.Mesh(
    canopyGeometry,
    new THREE.MeshStandardMaterial({ color: 0x08090c, metalness: 0.9, roughness: 0.12 }),
  );

  const lightMaterial = new THREE.MeshBasicMaterial({ color: hostileColor.clone().multiplyScalar(5) });
  const lights = [];
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.6), lightMaterial);
    tip.position.set(side * 5.4, 1.55, -1.4);
    lights.push(tip);
  }

  const model = new THREE.Group();
  model.add(hull, canopy, ...lights);
  return model;
}

/**
 * A hostile fighter. It makes attack runs at the player, firing short bursts when its nose lines up
 * with a lead point, then breaks off past them and comes around again.
 */
export class Drone {
  constructor(template, position, wave, engineColor) {
    const d = CONFIG.drone;
    this.object = new THREE.Group();
    this.model = template.clone();
    this.object.add(this.model);

    // Engine glow, flaring brighter as the drone accelerates.
    this.engine = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      color: engineColor.clone().multiplyScalar(2.2),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    this.engine.position.set(0, 0, -3.2);
    this.engine.scale.setScalar(3);
    this.model.add(this.engine);

    this.object.position.copy(position);
    this.position = this.object.position;
    this.heading = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.radius = d.hitRadius;
    this.hp = d.hp + Math.floor((wave - 1) / 3);
    this.speed = d.speed * Math.min(1 + (wave - 1) * 0.035, 1.4);
    this.turnRate = d.turnRate * Math.min(1 + (wave - 1) * 0.03, 1.35);
    this.fireScale = Math.max(0.55, 1 - (wave - 1) * 0.05);
    this.aimError = d.aimError * Math.max(0.5, 1 - (wave - 1) * 0.06);
    this.warp = d.warpTime;
    this.state = 'engage';
    this.stateTimer = 0;
    this.evadeDir = new THREE.Vector3();
    this.fireTimer = rand(1.2, 2.2);
    this.burstLeft = 0;
    this.bank = 0;
    this.flash = 0;
    this.dead = false;
    this.object.visible = false;

    this._desired = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
  }

  get active() {
    return this.warp <= 0;
  }

  forward(out = new THREE.Vector3()) {
    return out.copy(Z).applyQuaternion(this.heading);
  }

  /** Flies the drone. Returns an array of shots ({ origin, velocity }) fired this frame. */
  update(dt, player, rocks) {
    const d = CONFIG.drone;
    const shots = [];
    this.flash = Math.max(0, this.flash - dt);

    if (this.warp > 0) {
      this.warp -= dt;
      if (this.warp <= 0) {
        this.object.visible = true;
        // Arrive already pointed at the player.
        if (player) this.#face(this._v.subVectors(player.position, this.position).normalize());
      }
      return shots;
    }

    const live = player && !player.dead;
    const toPlayer = live ? this._v.subVectors(player.position, this.position) : this._v.set(0, 0, 0);
    const dist = toPlayer.length();
    const desired = this._desired;
    let throttle = 1;

    // Where to aim so a bolt meets the player.
    const lead = new THREE.Vector3();
    if (live) {
      lead.copy(player.position).addScaledVector(player.velocity, dist / d.boltSpeed);
    }

    if (!live) {
      desired.copy(this.position).negate().normalize(); // drift home toward the field center
      throttle = 0.6;
    } else if (this.state === 'engage') {
      desired.subVectors(lead, this.position).normalize();
      throttle = dist > 900 ? 1.35 : 1;
      if (dist < d.breakOff) {
        this.state = 'evade';
        this.stateTimer = rand(1.6, 2.8);
        // Peel off sideways and carry on past the player.
        const side = randomUnit(new THREE.Vector3()).projectOnPlane(toPlayer.clone().normalize()).normalize();
        this.evadeDir.copy(this.forward(new THREE.Vector3())).multiplyScalar(1.2).add(side).normalize();
      }
    } else {
      desired.copy(this.evadeDir);
      throttle = 1.3;
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.state = 'engage';
    }

    // Steer around rocks in the flight path.
    for (const rock of rocks) {
      const away = new THREE.Vector3().subVectors(this.position, rock.position);
      const gap = away.length() - rock.radius;
      if (gap > 70) continue;
      const strength = (1 - Math.max(gap, 0) / 70) * 2.2;
      desired.addScaledVector(away.normalize(), strength);
    }
    desired.normalize();

    // Turn toward the desired heading at a limited rate, banking into the turn.
    const before = this.forward(new THREE.Vector3());
    this.#turnToward(desired, this.turnRate * dt);
    const after = this.forward(new THREE.Vector3());
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.heading);
    const turn = after.sub(before).dot(right) / Math.max(dt, 1e-3);
    this.bank += (clamp(turn * 1.4, -1.1, 1.1) - this.bank) * smooth(4, dt);

    const speed = this.speed * throttle;
    this.velocity.copy(this.forward(new THREE.Vector3())).multiplyScalar(speed);
    this.position.addScaledVector(this.velocity, dt);
    this.object.quaternion.copy(this.heading).multiply(this._q.setFromAxisAngle(Z, this.bank));
    this.engine.scale.setScalar(2.4 + throttle * 1.6 + Math.random() * 0.4);

    // Weapons: short bursts when the shot line is on the player.
    if (!live) return shots;
    this.fireTimer -= dt;
    if (this.burstLeft > 0 && this.fireTimer <= 0) {
      shots.push(this.#shoot(lead));
      this.burstLeft -= 1;
      this.fireTimer = this.burstLeft > 0 ? d.burstGap : rand(d.fireInterval[0], d.fireInterval[1]) * this.fireScale;
    } else if (this.burstLeft === 0 && this.fireTimer <= 0 && this.state === 'engage' && dist < d.range) {
      const aim = new THREE.Vector3().subVectors(lead, this.position).normalize();
      if (aim.angleTo(this.forward(new THREE.Vector3())) < d.aimCone) {
        this.burstLeft = d.burst;
        this.fireTimer = 0;
      }
    }
    return shots;
  }

  #shoot(lead) {
    const d = CONFIG.drone;
    const origin = this.forward(new THREE.Vector3()).multiplyScalar(5).add(this.position);
    const dir = new THREE.Vector3().subVectors(lead, origin).normalize();
    dir.add(randomUnit(new THREE.Vector3()).multiplyScalar(this.aimError)).normalize();
    return { origin, velocity: dir.multiplyScalar(d.boltSpeed).addScaledVector(this.velocity, 0.3) };
  }

  #turnToward(dir, maxAngle) {
    // A matrix whose +Z axis points along dir, with world up as the reference for roll.
    this._m.lookAt(dir, ORIGIN, Math.abs(dir.y) > 0.98 ? Z : UP);
    this._q.setFromRotationMatrix(this._m);
    this.heading.rotateTowards(this._q, maxAngle);
  }

  #face(dir) {
    this._m.lookAt(dir, ORIGIN, UP);
    this.heading.setFromRotationMatrix(this._m);
  }
}
