import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { glowTexture } from '../fx/textures.js';
import { rand, randomUnit } from '../util/math.js';

export const PICKUP_KINDS = ['energy', 'shield', 'overdrive'];

/**
 * Floating supply crystals: energy cells (green-gold) that power the death ray and warp drive,
 * plus shield cells and overdrive cores for a piloted scout.
 */
export class Pickups {
  constructor(scene, colors) {
    this.scene = scene;
    this.items = [];
    this.geometry = new THREE.OctahedronGeometry(2.4, 0);
    this.looks = {};
    for (const kind of PICKUP_KINDS) {
      const color = colors[kind];
      this.looks[kind] = {
        core: new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(3), wireframe: true }),
        glow: new THREE.SpriteMaterial({
          map: glowTexture(),
          color: color.clone().multiplyScalar(2.5),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        }),
      };
    }
  }

  spawn(kind, position, velocity) {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(this.geometry, this.looks[kind].core));
    const glow = new THREE.Sprite(this.looks[kind].glow);
    glow.scale.setScalar(14);
    group.add(glow);
    group.position.copy(position);
    this.scene.add(group);
    this.items.push({
      kind,
      object: group,
      position: group.position,
      velocity: velocity.clone().add(randomUnit(new THREE.Vector3()).multiplyScalar(rand(3, 8))),
      life: CONFIG.pickups.life,
      radius: 9,
      dead: false,
    });
  }

  /** Drifts items, pulling them toward any collector ({ position, range }) in tractor range. */
  update(dt, collectors, time) {
    const pull = new THREE.Vector3();
    for (const p of this.items) {
      p.life -= dt;
      if (p.life <= 0) p.dead = true;
      for (const c of collectors) {
        pull.subVectors(c.position, p.position);
        const dist = pull.length();
        if (dist < c.range) p.velocity.addScaledVector(pull.normalize(), (60 + 300 * (1 - dist / c.range)) * dt);
      }
      p.velocity.multiplyScalar(Math.exp(-0.8 * dt));
      p.position.addScaledVector(p.velocity, dt);
      p.object.rotation.y += dt * 1.4;
      p.object.rotation.x += dt * 0.6;
      p.object.visible = p.life > 5 || Math.floor(time * 6) % 2 === 0;
    }
  }

  sweep() {
    this.items = this.items.filter((p) => {
      if (p.dead) this.scene.remove(p.object);
      return !p.dead;
    });
  }

  clear() {
    for (const p of this.items) p.dead = true;
    this.sweep();
  }
}
