import * as THREE from 'three';

const POINTS = 22;
const SPACING = 0.035; // seconds between trail points

const VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aEdge;
  varying float vT;
  varying float vEdge;
  void main() {
    vT = aT;
    vEdge = aEdge;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;
const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFade;
  varying float vT;
  varying float vEdge;
  void main() {
    float along = pow(1.0 - vT, 1.6);
    float across = 1.0 - vEdge * vEdge;
    gl_FragColor = vec4(uColor * along * across * uFade, 1.0);
  }
`;

/**
 * Glowing exhaust ribbons behind small craft: a strip of recent engine positions, turned to face the
 * camera and tapering to nothing. A trail follows its craft until the craft dies or leaves the scene,
 * then fades out where it is.
 */
export class Trails {
  constructor(scene) {
    this.scene = scene;
    this.trails = [];
    this.pool = [];
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color() }, uFade: { value: 1 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
    const index = [];
    for (let i = 0; i < POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.index = index;
    this.t = new Float32Array(POINTS * 2).map((_, i) => Math.floor(i / 2) / (POINTS - 1));
    this.edge = new Float32Array(POINTS * 2).map((_, i) => (i % 2 ? -1 : 1));
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._c = new THREE.Vector3();
  }

  /** Starts a trail behind `entity` (anything with `object` and `dead`), from `offset` in its local space. */
  attach(entity, { color, width, offset }) {
    let mesh = this.pool.pop();
    if (!mesh) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POINTS * 6), 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aT', new THREE.BufferAttribute(this.t, 1));
      geometry.setAttribute('aEdge', new THREE.BufferAttribute(this.edge, 1));
      geometry.setIndex(this.index);
      mesh = new THREE.Mesh(geometry, this.material.clone());
      mesh.frustumCulled = false;
    }
    mesh.material.uniforms.uColor.value.copy(color);
    mesh.material.uniforms.uFade.value = 1;
    mesh.visible = false;
    this.scene.add(mesh);
    const trail = { entity, mesh, width, offset: offset.clone(), points: [], timer: 0, fade: 1, detached: false };
    this.trails.push(trail);
    return trail;
  }

  update(dt, camera) {
    for (const t of this.trails) {
      const e = t.entity;
      if (!t.detached && (e.dead || !e.object.parent)) t.detached = true;
      if (t.detached) {
        t.fade -= dt * 1.5;
        t.mesh.material.uniforms.uFade.value = Math.max(0, t.fade);
      } else if (e.object.visible) {
        const head = e.object.localToWorld(this._a.copy(t.offset));
        t.timer -= dt;
        if (t.timer <= 0 || t.points.length < 2) {
          t.timer = SPACING;
          t.points.unshift(head.clone());
          if (t.points.length > POINTS) t.points.pop();
        } else {
          t.points[0].copy(head);
        }
      }
      this.#build(t, camera);
    }
    this.trails = this.trails.filter((t) => {
      if (t.fade > 0) return true;
      this.scene.remove(t.mesh);
      this.pool.push(t.mesh);
      return false;
    });
  }

  clear() {
    for (const t of this.trails) {
      this.scene.remove(t.mesh);
      this.pool.push(t.mesh);
    }
    this.trails = [];
  }

  #build(t, camera) {
    const pts = t.points;
    const n = pts.length;
    t.mesh.visible = n >= 2;
    if (n < 2) return;
    const pos = t.mesh.geometry.attributes.position;
    const side = this._b;
    const view = this._c;
    for (let i = 0; i < POINTS; i++) {
      const k = Math.min(i, n - 1);
      const p = pts[k];
      // Ribbon direction from neighbours, widened sideways across the line of sight.
      const prev = pts[Math.max(k - 1, 0)];
      const next = pts[Math.min(k + 1, n - 1)];
      side.subVectors(prev, next);
      view.subVectors(camera.position, p);
      side.cross(view);
      const len = side.length();
      if (len > 1e-6) side.multiplyScalar(1 / len);
      const w = i < n ? t.width * (1 - (i / (POINTS - 1)) * 0.7) : 0;
      pos.setXYZ(i * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      pos.setXYZ(i * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
    }
    pos.needsUpdate = true;
  }
}
