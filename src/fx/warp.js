import * as THREE from 'three';

const COUNT = 900;
const DEPTH = 1600;

/**
 * The warp tunnel: streaks of light rushing past the camera. Lives in camera space, so it can stay
 * attached to the camera while the ship jumps. `intensity` 0..1 sets speed, length and brightness.
 */
export class WarpTunnel {
  constructor(camera, color) {
    this.color = color;
    this.intensity = 0;
    this.streaks = Array.from({ length: COUNT }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: 8 + Math.random() ** 0.6 * 160,
      z: -Math.random() * DEPTH,
      tint: 0.6 + Math.random() * 0.4,
    }));
    this.positions = new Float32Array(COUNT * 6);
    this.colors = new Float32Array(COUNT * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.lines.visible = false;
    camera.add(this.lines);
  }

  update(dt) {
    const k = this.intensity;
    this.lines.visible = k > 0.01;
    if (!this.lines.visible) return;
    const speed = 80 + k * k * 9000;
    const length = 2 + k * k * 260;
    const brightness = 3 * Math.min(1, k * 2);
    for (let i = 0; i < COUNT; i++) {
      const s = this.streaks[i];
      s.z += speed * dt;
      if (s.z > 10) s.z -= DEPTH;
      const x = Math.cos(s.angle) * s.radius;
      const y = Math.sin(s.angle) * s.radius;
      const o = i * 6;
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = s.z;
      this.positions[o + 3] = x;
      this.positions[o + 4] = y;
      this.positions[o + 5] = s.z - length;
      // Fade streaks that are far down the tunnel.
      const b = brightness * s.tint * Math.min(1, (DEPTH + s.z) / (DEPTH * 0.6));
      this.colors[o] = this.color.r * b;
      this.colors[o + 1] = this.color.g * b;
      this.colors[o + 2] = this.color.b * b;
      this.colors[o + 3] = 0;
      this.colors[o + 4] = 0;
      this.colors[o + 5] = 0;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }
}
