import * as THREE from 'three';
import { glowTexture } from '../fx/textures.js';

const Z = new THREE.Vector3(0, 0, 1);

/**
 * Laser bolts for every weapon in the game, drawn as glowing rods with a bright head from reusable pools.
 * `looks` maps a weapon name to { radius, length, color, glow } (glow: head sprite size in meters).
 * Bolts grow from the muzzle to full length, so near-camera shots read as streaks.
 */
export class Bolts {
  constructor(scene, looks) {
    this.scene = scene;
    this.active = [];
    this.pool = {};
    this.looks = {};
    for (const [name, look] of Object.entries(looks)) {
      const geometry = new THREE.CylinderGeometry(look.radius, look.radius, look.length, 8);
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, 0, -look.length / 2); // the head leads, the tail trails behind
      this.looks[name] = {
        geometry,
        length: look.length,
        glowSize: look.glow,
        material: new THREE.MeshBasicMaterial({
          color: look.color,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
        glow: new THREE.SpriteMaterial({
          map: glowTexture(),
          color: look.color.clone().multiplyScalar(0.35),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        }),
      };
      this.pool[name] = [];
    }
  }

  /** Fires a bolt. `hostile` bolts hurt you; the rest hurt the enemy. */
  fire(origin, velocity, { look, hostile = false, damage, life }) {
    const style = this.looks[look];
    let mesh = this.pool[look].pop();
    if (!mesh) {
      mesh = new THREE.Mesh(style.geometry, style.material);
      mesh.frustumCulled = false;
      const glow = new THREE.Sprite(style.glow);
      glow.scale.setScalar(style.glowSize);
      mesh.add(glow);
    }
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(Z, velocity.clone().normalize());
    mesh.scale.set(1, 1, 0.02);
    this.scene.add(mesh);
    const bolt = {
      mesh,
      look,
      hostile,
      position: mesh.position,
      previous: origin.clone(),
      velocity: velocity.clone(),
      speed: velocity.length(),
      length: style.length,
      traveled: 0,
      damage,
      life,
      dead: false,
    };
    this.active.push(bolt);
    return bolt;
  }

  update(dt) {
    for (const b of this.active) {
      b.previous.copy(b.position);
      b.position.addScaledVector(b.velocity, dt);
      b.traveled += b.speed * dt;
      b.mesh.scale.z = Math.max(0.02, Math.min(1, b.traveled / b.length));
      b.life -= dt;
      if (b.life <= 0) b.dead = true;
    }
  }

  /** Returns dead bolts to their pools. */
  sweep() {
    const live = [];
    for (const b of this.active) {
      if (b.dead) {
        this.scene.remove(b.mesh);
        this.pool[b.look].push(b.mesh);
      } else {
        live.push(b);
      }
    }
    this.active = live;
  }

  clear() {
    for (const b of this.active) b.dead = true;
    this.sweep();
  }
}

/**
 * Whether a bolt's path this frame (from → to) passed within `radius` of `center`.
 * Testing the whole segment stops fast bolts from skipping through small targets.
 */
export function segmentHitsSphere(from, to, center, radius) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const fx = center.x - from.x;
  const fy = center.y - from.y;
  const fz = center.z - from.z;
  const len2 = dx * dx + dy * dy + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, (fx * dx + fy * dy + fz * dz) / len2));
  const px = from.x + dx * t - center.x;
  const py = from.y + dy * t - center.y;
  const pz = from.z + dz * t - center.z;
  return px * px + py * py + pz * pz <= radius * radius;
}
