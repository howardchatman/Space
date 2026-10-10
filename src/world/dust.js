import * as THREE from 'three';

/**
 * Faint motes drifting around the camera. They streak with your velocity, which is the main cue
 * for speed when everything else in the sky is effectively at infinity.
 */
export class SpaceDust {
  constructor(count = 700, extent = 280) {
    this.count = count;
    this.extent = extent;
    this.motes = new Float32Array(count * 3);
    for (let i = 0; i < this.motes.length; i++) this.motes[i] = (Math.random() - 0.5) * extent;

    this.positions = new Float32Array(count * 6);
    this.colors = new Float32Array(count * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.lines.frustumCulled = false;
  }

  update(cameraPosition, velocity) {
    const half = this.extent / 2;
    const speed = velocity.length();
    const visibility = Math.min(1, 0.2 + speed / 120);
    const sx = velocity.x * 0.035;
    const sy = velocity.y * 0.035;
    const sz = velocity.z * 0.035;
    const { motes, positions, colors } = this;

    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      // Wrap each mote into the box centered on the camera.
      for (let a = 0; a < 3; a++) {
        const c = a === 0 ? cameraPosition.x : a === 1 ? cameraPosition.y : cameraPosition.z;
        const d = motes[o + a] - c;
        if (d > half) motes[o + a] -= this.extent;
        else if (d < -half) motes[o + a] += this.extent;
      }
      const x = motes[o];
      const y = motes[o + 1];
      const z = motes[o + 2];
      const dx = x - cameraPosition.x;
      const dy = y - cameraPosition.y;
      const dz = z - cameraPosition.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const fade = Math.max(0, 1 - dist / half);
      const b = fade * fade * 0.32 * visibility;

      const p = i * 6;
      positions[p] = x;
      positions[p + 1] = y;
      positions[p + 2] = z;
      positions[p + 3] = x - sx - 0.15;
      positions[p + 4] = y - sy;
      positions[p + 5] = z - sz;
      colors[p] = b * 0.85;
      colors[p + 1] = b * 0.9;
      colors[p + 2] = b;
      colors[p + 3] = 0;
      colors[p + 4] = 0;
      colors[p + 5] = 0;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }
}
