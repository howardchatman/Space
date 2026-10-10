import * as THREE from 'three';
import { glowTexture, sunTexture } from '../fx/textures.js';

const SUN_DISTANCE = 120000;
const ORIGIN = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

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

  /**
   * Turns on sun shadows inside a box `extent` meters either side of a focus point (see focusShadows).
   * The light's target must be in the scene so its position is picked up each frame.
   */
  enableShadows(scene, { size = 2048, extent = 300, depth = 2000 } = {}) {
    const light = this.light;
    light.castShadow = true;
    light.shadow.mapSize.set(size, size);
    const cam = light.shadow.camera;
    cam.left = cam.bottom = -extent;
    cam.right = cam.top = extent;
    cam.near = 10;
    cam.far = depth * 2;
    cam.updateProjectionMatrix();
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.3;
    scene.add(light.target);
    this.shadowDepth = depth;
    this.texel = (extent * 2) / size;
    this._basis = new THREE.Matrix4();
    this._inverse = new THREE.Matrix4();
    this._focus = new THREE.Vector3();
  }

  /** Centers the shadow box on a point, snapped to whole shadow texels so edges don't crawl as it moves. */
  focusShadows(point) {
    if (!this.light.castShadow) return;
    const basis = this._basis.lookAt(this.direction, ORIGIN, UP);
    const p = this._focus.copy(point).applyMatrix4(this._inverse.copy(basis).transpose());
    p.x = Math.round(p.x / this.texel) * this.texel;
    p.y = Math.round(p.y / this.texel) * this.texel;
    p.applyMatrix4(basis);
    this.light.target.position.copy(p);
    this.light.position.copy(p).addScaledVector(this.direction, this.shadowDepth);
  }

  /** Keeps the sun at a fixed direction from the camera so it never gets closer. */
  update(camera) {
    this.group.position.copy(camera.position).addScaledVector(this.direction, SUN_DISTANCE);
  }
}
