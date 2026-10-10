import * as THREE from 'three';
import { glowTexture } from '../fx/textures.js';
import { rand, randomUnit } from '../util/math.js';

/** Solar cell texture: dark blue cells in a silver grid. */
function panelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#9aa0a8';
  g.fillRect(0, 0, 128, 256);
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 8; y++) {
      g.fillStyle = `rgb(${18 + Math.random() * 8}, ${30 + Math.random() * 10}, ${70 + Math.random() * 20})`;
      g.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let shared = null;

/**
 * A derelict satellite drifting in the sector: a gold-foiled bus, two solar wings and a dish. Getting
 * close with the warship or a scout salvages its energy cells once.
 */
export class Satellite {
  constructor(position, name) {
    if (!shared) {
      shared = {
        bus: new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.85, roughness: 0.35 }),
        frame: new THREE.MeshStandardMaterial({ color: 0x8b9099, metalness: 0.7, roughness: 0.4 }),
        cells: new THREE.MeshStandardMaterial({ map: panelTexture(), metalness: 0.4, roughness: 0.3 }),
      };
    }
    this.name = name;
    this.kind = 'satellite';
    this.object = new THREE.Group();
    this.object.position.copy(position);
    this.position = this.object.position;
    this.velocity = randomUnit(new THREE.Vector3()).multiplyScalar(rand(0.5, 2));
    this.radius = 28;
    this.salvaged = false;
    this.spinAxis = randomUnit(new THREE.Vector3());
    this.spinRate = rand(0.03, 0.12);

    const bus = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 9), shared.bus);
    this.object.add(bus);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 34, 6), shared.frame);
    boom.rotation.z = Math.PI / 2;
    this.object.add(boom);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.25, 6), shared.cells);
      wing.position.x = s * 11.5;
      wing.rotation.x = rand(-0.4, 0.4);
      this.object.add(wing);
    }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 8, 0, Math.PI * 2, 0, 0.9), shared.frame);
    dish.material.side = THREE.DoubleSide;
    dish.position.set(0, 3, 4.5);
    dish.rotation.x = -0.9;
    this.object.add(dish);

    this.beacon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      color: new THREE.Color(2.5, 1.6, 0.4),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    this.beacon.position.set(0, 4, 0);
    this.beacon.scale.setScalar(6);
    this.object.add(this.beacon);
    this._q = new THREE.Quaternion();
  }

  update(dt, time) {
    this.position.addScaledVector(this.velocity, dt);
    this.object.quaternion.premultiply(this._q.setFromAxisAngle(this.spinAxis, this.spinRate * dt));
    this.beacon.visible = !this.salvaged && time % 2 < 0.2;
  }
}
