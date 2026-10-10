import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Craft } from './drone.js';

/**
 * A recon craft. It launches out of the hangar, flies a route of patrol points revealing what's around
 * it, holds station at the end, and flies home to dock when recalled. The captain can take one over.
 */
export class Scout extends Craft {
  constructor(template, name, position, direction, engineColor) {
    super(template, position, engineColor, { speed: CONFIG.scout.speed, turnRate: CONFIG.scout.turnRate });
    this.name = name;
    this.radius = 7;
    this.hp = CONFIG.scout.hp;
    this.state = 'launch';
    this.timer = 1.8;
    this.route = [];
    this.holdCenter = new THREE.Vector3();
    this.launchDir = direction.clone();
    this.piloted = false;
    this.face(direction);
  }

  setRoute(points) {
    this.route = points;
    if (this.state !== 'launch') this.state = 'patrol';
  }

  recall() {
    if (this.state !== 'docking') this.state = 'return';
  }

  /** Flies the scout. Returns 'docked' when it is back aboard. */
  update(dt, { hangar, hangarDir, obstacles, hullObstacles }) {
    if (this.piloted || this.dead) return null;
    const desired = new THREE.Vector3();
    let throttle = 1;
    let avoid = obstacles;

    switch (this.state) {
      case 'launch':
        desired.copy(this.launchDir);
        throttle = 0.55;
        this.timer -= dt;
        avoid = obstacles.filter((o) => !hullObstacles.includes(o));
        if (this.timer <= 0) this.state = this.route.length ? 'patrol' : 'hold';
        if (this.state === 'hold') this.holdCenter.copy(this.position);
        break;
      case 'patrol': {
        const next = this.route[0];
        if (!next) {
          this.state = 'hold';
          this.holdCenter.copy(this.position);
          break;
        }
        desired.subVectors(next, this.position);
        if (desired.length() < 180) this.route.shift();
        desired.normalize();
        break;
      }
      case 'hold': {
        // Circle the last patrol point.
        const out = new THREE.Vector3().subVectors(this.position, this.holdCenter);
        const r = out.length() || 1;
        const tangent = new THREE.Vector3(-out.z, 0, out.x).normalize();
        desired.copy(tangent).addScaledVector(out.normalize(), (260 - r) / 150).normalize();
        throttle = 0.6;
        break;
      }
      case 'return': {
        // Line up off the hangar mouth, then fly in.
        const approach = hangar.clone().addScaledVector(hangarDir, 140);
        desired.subVectors(approach, this.position);
        if (desired.length() < 60) this.state = 'docking';
        desired.normalize();
        break;
      }
      case 'docking': {
        desired.subVectors(hangar, this.position);
        const dist = desired.length();
        desired.normalize();
        throttle = Math.max(0.25, Math.min(1, dist / 150));
        avoid = obstacles.filter((o) => !hullObstacles.includes(o));
        if (dist < 22) return 'docked';
        break;
      }
    }
    this.steer(dt, desired, throttle, avoid);
    return null;
  }
}
