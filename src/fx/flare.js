import * as THREE from 'three';
import { ghostTexture, glowTexture } from './textures.js';

// Ghosts sit along the line from the sun through the middle of the view: `at` is how far along it
// (1 = on the sun, 0 = center, negative = past the center), `size` a fraction of the view's height.
const GHOSTS = [
  { at: 0.62, size: 0.045, color: [0.55, 0.8, 1], strength: 0.12, map: 'glow' },
  { at: 0.3, size: 0.09, color: [1, 0.72, 0.42], strength: 0.05, map: 'ghost' },
  { at: -0.18, size: 0.05, color: [0.6, 1, 0.75], strength: 0.07, map: 'ghost' },
  { at: -0.52, size: 0.16, color: [0.72, 0.52, 1], strength: 0.04, map: 'ghost' },
  { at: -0.86, size: 0.07, color: [1, 0.86, 0.62], strength: 0.08, map: 'glow' },
  { at: -1.3, size: 0.26, color: [0.5, 0.72, 1], strength: 0.03, map: 'ghost' },
];
const DEPTH = 1; // meters in front of the camera; drawn over everything

/**
 * A lens flare when the sun is in view and nothing blocks it: a thin horizontal streak through the sun
 * and a row of faint aperture ghosts across the view. Kept dim, since it's drawn right at the lens.
 */
export class LensFlare {
  constructor(camera) {
    this.group = new THREE.Group();
    this.group.renderOrder = 20;
    this.group.visible = false;
    camera.add(this.group);
    const make = (map, color) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map,
        color: new THREE.Color(...color),
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }));
      sprite.renderOrder = 20;
      this.group.add(sprite);
      return sprite;
    };
    this.ghosts = GHOSTS.map((g) => ({ ...g, sprite: make(g.map === 'ghost' ? ghostTexture() : glowTexture(), g.color) }));
    this.streak = make(glowTexture(), [1, 0.86, 0.7]);
    this.visibility = 0;
    this._v = new THREE.Vector3();
    this._f = new THREE.Vector3();
  }

  /** `clear`: whether a straight line from the camera to the sun is unobstructed. */
  update(dt, camera, sunDirection, clear) {
    const ndc = this._v.copy(camera.position).addScaledVector(sunDirection, 1000).project(camera);
    const ahead = this._f.set(0, 0, -1).applyQuaternion(camera.quaternion).dot(sunDirection) > 0;
    const onScreen = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(ndc.x), Math.abs(ndc.y)), 0.85, 1.15);
    const target = clear && ahead ? onScreen : 0;
    this.visibility += (target - this.visibility) * Math.min(1, dt * 10);
    this.group.visible = this.visibility > 0.01;
    if (!this.group.visible) return;

    const halfH = DEPTH * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const halfW = halfH * camera.aspect;
    // Flares bloom brighter as the sun nears the middle of the view.
    const center = 1 - Math.min(1, Math.hypot(ndc.x, ndc.y));
    const v = this.visibility * (0.6 + 0.8 * center);
    for (const g of this.ghosts) {
      g.sprite.position.set(ndc.x * g.at * halfW, ndc.y * g.at * halfH, -DEPTH);
      g.sprite.scale.setScalar(g.size * 2 * halfH);
      g.sprite.material.color.setRGB(...g.color).multiplyScalar(g.strength * v);
    }
    this.streak.position.set(ndc.x * halfW, ndc.y * halfH, -DEPTH);
    this.streak.scale.set(halfW * 1.4, halfH * 0.025, 1);
    this.streak.material.color.setRGB(1, 0.86, 0.7).multiplyScalar(0.22 * v);
  }
}
