import * as THREE from 'three';

const MAX_HITS = 8;
const LIFE = 1.2; // seconds a ripple lasts

/**
 * A ship's shield bubble: invisible until something hits it, then a ripple runs out across a faint
 * lattice from the impact point. Built on a unit sphere scaled into an ellipsoid around the hull, so
 * hit positions are stored as directions on the unit sphere. Visible from inside too (the bridge).
 */
export class ShieldBubble {
  constructor(radii, center, color) {
    this.hits = Array.from({ length: MAX_HITS }, () => new THREE.Vector4(0, 0, 0, -1));
    this.next = 0;
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uHits: { value: this.hits },
        uColor: { value: color.clone() },
        uStrength: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        varying vec3 vNormalW;
        varying vec3 vWorld;
        void main() {
          vDir = normalize(position);
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec4 uHits[${MAX_HITS}];
        uniform vec3 uColor;
        uniform float uStrength;
        varying vec3 vDir;
        varying vec3 vNormalW;
        varying vec3 vWorld;
        void main() {
          float glow = 0.0;
          for (int i = 0; i < ${MAX_HITS}; i++) {
            vec4 h = uHits[i];
            if (h.w < 0.0 || h.w > 1.0) continue;
            float d = distance(vDir, h.xyz);
            float fade = 1.0 - h.w;
            float ring = exp(-pow((d - h.w * 0.85) / 0.05, 2.0)) * fade * fade;
            float flash = exp(-d * d / 0.006) * max(0.0, 1.0 - h.w * 4.0);
            float wash = exp(-d * d / 0.08) * fade * 0.25;
            glow += ring * 0.9 + flash * 2.0 + wash;
          }
          if (glow < 0.002) discard;
          // A faint lattice in the field, brightest at grazing angles.
          vec3 g = abs(fract(vDir * 18.0) - 0.5);
          float lattice = 0.45 + 0.55 * smoothstep(0.4, 0.5, max(g.x, max(g.y, g.z)));
          vec3 view = normalize(cameraPosition - vWorld);
          float rim = pow(1.0 - abs(dot(normalize(vNormalW), view)), 2.0);
          gl_FragColor = vec4(uColor * glow * lattice * (0.55 + 1.2 * rim) * uStrength, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), this.material);
    this.mesh.scale.copy(radii);
    this.mesh.position.copy(center);
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this._local = new THREE.Vector3();
  }

  /** Starts a ripple where a world-space point meets the bubble. */
  hit(worldPoint) {
    const local = this.mesh.worldToLocal(worldPoint.clone()).normalize();
    this.hits[this.next].set(local.x, local.y, local.z, 0);
    this.next = (this.next + 1) % MAX_HITS;
    this.mesh.visible = true;
  }

  /**
   * Seen from inside (the bridge sits inside its own ship's shield), a ripple sweeps across much of the view,
   * so it's drawn fainter there.
   */
  view(camera) {
    const inside = this.mesh.worldToLocal(this._local.copy(camera.position)).length() < 1;
    this.material.uniforms.uStrength.value = inside ? 0.3 : 1;
  }

  update(dt) {
    let active = false;
    for (const h of this.hits) {
      if (h.w < 0) continue;
      h.w += dt / LIFE;
      if (h.w > 1) h.w = -1;
      else active = true;
    }
    this.mesh.visible = active;
  }
}
