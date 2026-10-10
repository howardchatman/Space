import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';
import { TAU, mulberry32 } from '../util/math.js';

// Orientation of the galaxy in this sky: the Milky Way band circles the plane normal to GALACTIC_NORTH.
export const GALACTIC_NORTH = new THREE.Vector3(0.3, 0.84, 0.45).normalize();
export const GALACTIC_CENTER = new THREE.Vector3(0.75, -0.1, -0.65)
  .projectOnPlane(GALACTIC_NORTH)
  .normalize();
const GALACTIC_EAST = new THREE.Vector3().crossVectors(GALACTIC_NORTH, GALACTIC_CENTER).normalize();

export const STAR_DISTANCE = 150000;

/**
 * Renders the diffuse Milky Way glow, plus this sector's nebula if given, into a cube map once per sector,
 * so the expensive noise never runs per frame. The result is used as the scene background; individual
 * stars are drawn live on top of it. `nebula` is { direction, inner, outer, size (radians), seed }.
 */
export function bakeMilkyWay(renderer, size, nebula = null) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uNorth: { value: GALACTIC_NORTH },
      uCenter: { value: GALACTIC_CENTER },
      uEast: { value: GALACTIC_EAST },
      uNebulaDir: { value: nebula?.direction ?? new THREE.Vector3(0, 1, 0) },
      uNebulaInner: { value: nebula?.inner ?? new THREE.Color() },
      uNebulaOuter: { value: nebula?.outer ?? new THREE.Color() },
      uNebulaSize: { value: nebula ? nebula.size : 0 },
      uNebulaSeed: { value: nebula?.seed ?? 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uNorth;
      uniform vec3 uCenter;
      uniform vec3 uEast;
      uniform vec3 uNebulaDir;
      uniform vec3 uNebulaInner;
      uniform vec3 uNebulaOuter;
      uniform float uNebulaSize;
      uniform float uNebulaSeed;
      varying vec3 vDir;
      ${GLSL_NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float lat = asin(clamp(dot(d, uNorth), -1.0, 1.0));
        float lon = atan(dot(d, uEast), dot(d, uCenter));
        float bulge = exp(-lon * lon / 0.45);

        // The band: wider and brighter toward the galactic core.
        float width = 0.1 + 0.15 * bulge;
        float band = exp(-lat * lat / (2.0 * width * width));
        float clouds = fbm(d * 3.0, 6) * 0.5 + 0.5;
        float fine = fbm(d * 12.0 + 4.0, 5) * 0.5 + 0.5;
        float glow = band * (0.35 + 0.9 * clouds * clouds) * (0.7 + 0.6 * fine);

        // Dark dust lanes along the mid-plane.
        float laneWidth = 0.03 + 0.05 * bulge;
        float lane = exp(-pow((lat - 0.025 * sin(lon * 3.0)) / laneWidth, 2.0));
        float dust = smoothstep(-0.1, 0.45, fbm(d * 7.0 + 11.0, 6)) * lane;
        glow *= 1.0 - 0.85 * dust;

        vec3 core = vec3(1.0, 0.8, 0.6);
        vec3 arm = vec3(0.7, 0.78, 1.0);
        vec3 col = mix(arm, core, bulge * 0.9) * glow * (0.045 + 0.13 * bulge);

        // Faint red emission nebulae inside the band, and a little glow from unresolved stars everywhere.
        float ha = smoothstep(0.62, 0.9, fbm(d * 5.0 + 23.0, 5) * 0.5 + 0.5) * band;
        col += vec3(0.12, 0.02, 0.035) * ha * 0.12;
        col += vec3(0.004, 0.0045, 0.007);

        // The sector's nebula: billowing glow inside a soft envelope, with dark dust threaded through.
        float away = acos(clamp(dot(d, uNebulaDir), -1.0, 1.0));
        float envelope = uNebulaSize > 0.0 ? exp(-away * away / (uNebulaSize * uNebulaSize)) : 0.0;
        if (envelope > 0.01) {
          vec3 p = d * 2.4 + uNebulaSeed;
          float body = fbm(p, 6) * 0.5 + 0.5;
          float wisps = fbm(p * 3.1 + 7.0, 5) * 0.5 + 0.5;
          float cloud = smoothstep(0.32, 0.9, body * (0.55 + 0.9 * envelope)) * envelope;
          cloud *= 0.6 + 0.8 * wisps * wisps;
          float heart = smoothstep(0.55, 1.0, envelope * body * 1.3);
          vec3 tint = mix(uNebulaOuter, uNebulaInner, clamp(heart * 1.4 + (wisps - 0.5) * 0.6, 0.0, 1.0));
          float dark = smoothstep(0.55, 0.8, fbm(p * 5.0 + 19.0, 5) * 0.5 + 0.5) * envelope;
          col *= 1.0 - 0.6 * dark;
          col += tint * cloud * (1.0 - 0.75 * dark) * 0.11;
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const scene = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(10, 64, 32);
  scene.add(new THREE.Mesh(geometry, material));
  const target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
  new THREE.CubeCamera(1, 100, target).update(renderer, scene);
  geometry.dispose();
  material.dispose();
  return target;
}

/** Approximate color of a black body at the given temperature (Tanner Helland's fit), as sRGB 0-1. */
function kelvinToRgb(kelvin) {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.min(255, Math.max(0, v)) / 255;
  return [c(r), c(g), c(b)];
}

// Spectral classes by share of visible stars: cool orange K and M giants through hot blue B stars.
const STAR_CLASSES = [
  { kelvin: 3300, weight: 0.12 },
  { kelvin: 4300, weight: 0.24 },
  { kelvin: 5300, weight: 0.2 },
  { kelvin: 6300, weight: 0.17 },
  { kelvin: 7800, weight: 0.13 },
  { kelvin: 10500, weight: 0.09 },
  { kelvin: 17000, weight: 0.05 },
];

/**
 * Individual stars as screen-space points. Brightness follows a realistic magnitude distribution
 * (many faint stars, very few bright ones), and most stars crowd toward the Milky Way.
 */
export function createStars(count, seed = 7) {
  const rng = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const dir = new THREE.Vector3();
  const totalWeight = STAR_CLASSES.reduce((s, c) => s + c.weight, 0);

  // Inverse CDF for star counts growing about 2.6x per magnitude.
  const k = 0.42;
  const lo = Math.pow(10, k * -1.4);
  const hi = Math.pow(10, k * 7.0);

  for (let i = 0; i < count; i++) {
    if (rng() < 0.55) {
      // Concentrated toward the galactic plane.
      const g = Math.sqrt(-2 * Math.log(rng() + 1e-9)) * Math.cos(TAU * rng());
      const lat = g * 0.28;
      const lon = rng() * TAU;
      dir.copy(GALACTIC_CENTER).multiplyScalar(Math.cos(lon) * Math.cos(lat))
        .addScaledVector(GALACTIC_EAST, Math.sin(lon) * Math.cos(lat))
        .addScaledVector(GALACTIC_NORTH, Math.sin(lat));
    } else {
      const z = rng() * 2 - 1;
      const a = rng() * TAU;
      const r = Math.sqrt(1 - z * z);
      dir.set(Math.cos(a) * r, Math.sin(a) * r, z);
    }
    dir.normalize().multiplyScalar(STAR_DISTANCE);
    positions.set([dir.x, dir.y, dir.z], i * 3);

    const magnitude = Math.log10(lo + rng() * (hi - lo)) / k;
    const flux = Math.pow(10, -0.4 * (magnitude - 6.5)); // 1 at the naked-eye limit
    sizes[i] = Math.min(3.4, 1.2 + Math.log10(flux) * 0.75);
    const intensity = Math.min(2.6, 0.22 * Math.pow(flux, 0.5));

    let pickW = rng() * totalWeight;
    let kelvin = STAR_CLASSES[0].kelvin;
    for (const c of STAR_CLASSES) {
      pickW -= c.weight;
      if (pickW <= 0) {
        kelvin = c.kelvin;
        break;
      }
    }
    // Stars look paler to the eye than their black-body color, so blend toward white.
    const rgb = kelvinToRgb(kelvin).map((v) => 0.55 * v + 0.45);
    for (let c = 0; c < 3; c++) colors[i * 3 + c] = Math.pow(rgb[c], 2.2) * intensity;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uPixelRatio: { value: 1 },
      uExposure: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute vec3 aColor;
      uniform float uPixelRatio;
      uniform float uExposure;
      varying vec3 vColor;
      void main() {
        vColor = aColor * uExposure;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(c, c);
        if (r2 > 1.0) discard;
        gl_FragColor = vec4(vColor, exp(-r2 * 4.0));
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -10;
  return points;
}
