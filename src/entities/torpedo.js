import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { glowTexture } from '../fx/textures.js';

const Z = new THREE.Vector3(0, 0, 1);
let shared = null;

/**
 * A homing torpedo: slow off the tube, then accelerating and curving toward its target. It can be shot
 * down; point defense tries to. Pulses so you can track it. `spec` holds its flight numbers (the
 * corvettes' by default); `hostile` torpedoes are aimed at you, the rest are yours.
 */
export class Torpedo {
  constructor(position, direction, target, color, { spec = CONFIG.torpedo, hostile = true, damage = spec.damage ?? 0 } = {}) {
    if (!shared) {
      const body = new THREE.CylinderGeometry(0.7, 0.9, 6, 10);
      body.rotateX(Math.PI / 2);
      shared = {
        body,
        material: new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.7, roughness: 0.4 }),
      };
    }
    const t = spec;
    this.spec = spec;
    this.hostile = hostile;
    this.damage = damage;
    this.kind = 'torpedo';
    this.name = 'Torpedo';
    this.object = new THREE.Group();
    this.object.add(new THREE.Mesh(shared.body, shared.material));
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      color: color.clone().multiplyScalar(4),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    this.glow.position.z = -3.5;
    this.object.add(this.glow);
    this.object.position.copy(position);
    this.position = this.object.position;
    this.velocity = direction.clone().normalize().multiplyScalar(t.launchSpeed);
    this.speed = t.launchSpeed;
    this.target = target;
    this.life = t.life;
    this.hp = t.hp;
    this.radius = 4;
    this.age = 0;
    this.dead = false;
  }

  update(dt) {
    const t = this.spec;
    this.age += dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    this.speed = Math.min(t.speed, this.speed + t.accel * dt);
    const dir = this.velocity.clone().normalize();
    if (this.target && !this.target.dead && this.age > 0.8) {
      const dist = this.target.position.distanceTo(this.position);
      const lead = this.target.position.clone().addScaledVector(this.target.velocity, (dist / this.speed) * 0.6);
      const want = lead.sub(this.position).normalize();
      const angle = dir.angleTo(want);
      if (angle > 1e-4) {
        const axis = new THREE.Vector3().crossVectors(dir, want).normalize();
        dir.applyAxisAngle(axis, Math.min(angle, t.turnRate * dt));
      }
    }
    this.velocity.copy(dir).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);
    this.object.quaternion.setFromUnitVectors(Z, dir);
    this.glow.scale.setScalar(9 + Math.sin(this.age * 14) * 3);
  }
}
