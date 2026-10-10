import * as THREE from 'three';
import { glowTexture } from '../fx/textures.js';

const Z = new THREE.Vector3(0, 0, 1);

/** Laser bolts for both sides, drawn as glowing rods from a reusable pool. */
export class Bolts {
  constructor(scene, { friendly, hostile }) {
    this.scene = scene;
    this.active = [];
    this.pool = { friendly: [], hostile: [] };
    const make = (radius, length, color, glowSize) => {
      const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, 0, -length / 2); // the head leads, the tail trails behind
      return {
        geometry,
        length,
        glowSize,
        material: new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
        glow: new THREE.SpriteMaterial({
          map: glowTexture(),
          color: color.clone().multiplyScalar(0.35),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        }),
      };
    };
    this.looks = {
      friendly: make(0.07, 28, friendly, 2.2),
      hostile: make(0.3, 14, hostile, 6),
    };
  }

  fire(origin, velocity, { hostile = false, damage, life }) {
    const side = hostile ? 'hostile' : 'friendly';
    let mesh = this.pool[side].pop();
    if (!mesh) {
      const look = this.looks[side];
      mesh = new THREE.Mesh(look.geometry, look.material);
      mesh.frustumCulled = false;
      const glow = new THREE.Sprite(look.glow);
      glow.scale.setScalar(look.glowSize);
      mesh.add(glow);
    }
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(Z, velocity.clone().normalize());
    mesh.scale.set(1, 1, 0.02);
    this.scene.add(mesh);
    const bolt = {
      mesh,
      side,
      hostile,
      position: mesh.position,
      previous: origin.clone(),
      velocity: velocity.clone(),
      speed: velocity.length(),
      length: this.looks[side].length,
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
      // The streak stretches out behind the head until it reaches full length.
      b.traveled += b.speed * dt;
      b.mesh.scale.z = Math.max(0.02, Math.min(1, b.traveled / b.length));
      b.life -= dt;
      if (b.life <= 0) b.dead = true;
    }
  }

  /** Returns dead bolts to the pool. */
  sweep() {
    const live = [];
    for (const b of this.active) {
      if (b.dead) {
        this.scene.remove(b.mesh);
        this.pool[b.side].push(b.mesh);
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
 * Whether a bolt's path this frame (previous → position) passed within `radius` of `center`.
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
