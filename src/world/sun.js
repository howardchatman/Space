import * as THREE from 'three';
import { glowTexture, sunTexture } from '../fx/textures.js';

const SUN_DISTANCE = 120000;

/** The local star: a directional light plus a blinding disc and halo that stay at infinity. */
export class Sun {
  constructor(direction) {
    this.direction = direction.clone().normalize();

    this.light = new THREE.DirectionalLight(0xfff3e4, 3.4);
    this.light.position.copy(this.direction);

    this.group = new THREE.Group();
    // About half a degree across, as the Sun looks from Earth's distance.
    const disc = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTexture(),
      color: new THREE.Color(1, 0.95, 0.86).multiplyScalar(40),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    disc.scale.setScalar(16000);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      color: new THREE.Color(1, 0.86, 0.66).multiplyScalar(0.35),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    halo.scale.setScalar(52000);
    this.group.add(halo, disc);
    this.group.renderOrder = -5;
  }

  /** Keeps the sun at a fixed direction from the camera so it never gets closer. */
  update(camera) {
    this.group.position.copy(camera.position).addScaledVector(this.direction, SUN_DISTANCE);
  }
}
