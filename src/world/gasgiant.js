import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';
import { mulberry32 } from '../util/math.js';

// Cloud palettes in display tones (the live shader squares them into linear albedo):
// zone = the pale bands, belt = the dark bands, accent = storms and streaks.
const PALETTES = [
  { zone: [0.86, 0.78, 0.64], belt: [0.58, 0.42, 0.28], accent: [0.7, 0.36, 0.2], ring: [0.82, 0.76, 0.66], haze: [1.0, 0.82, 0.58] },
  { zone: [0.88, 0.83, 0.64], belt: [0.74, 0.64, 0.44], accent: [0.84, 0.7, 0.44], ring: [0.86, 0.8, 0.68], haze: [1.0, 0.9, 0.66] },
  { zone: [0.62, 0.8, 0.86], belt: [0.38, 0.58, 0.76], accent: [0.86, 0.93, 0.97], ring: [0.72, 0.78, 0.82], haze: [0.55, 0.8, 1.0] },
  { zone: [0.76, 0.72, 0.86], belt: [0.5, 0.44, 0.68], accent: [0.88, 0.62, 0.72], ring: [0.8, 0.76, 0.84], haze: [0.8, 0.7, 1.0] },
];

const SUN = 'vec3(1.0, 0.96, 0.9) * 2.0';

/** Bakes the cloud bands into a cube map once, so the turbulence noise never runs per frame. */
function bakeBands(renderer, size, seed, palette, storm) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uSeed: { value: seed },
      uZone: { value: new THREE.Vector3(...palette.zone) },
      uBelt: { value: new THREE.Vector3(...palette.belt) },
      uAccent: { value: new THREE.Vector3(...palette.accent) },
      uStorm: { value: storm },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uSeed;
      uniform vec3 uZone;
      uniform vec3 uBelt;
      uniform vec3 uAccent;
      uniform vec3 uStorm;
      varying vec3 vDir;
      ${GLSL_NOISE}
      void main() {
        vec3 p = normalize(vDir);
        vec3 s = vec3(uSeed, uSeed * 1.3, uSeed * 0.7);

        // Latitude, wobbled by turbulence so the bands meander and curl at their edges.
        float turb = fbm(p * 4.0 + s, 5);
        float shear = fbm(vec3(p.x * 2.0, p.y * 28.0, p.z * 2.0) + s, 4);
        float l = p.y + turb * 0.035 + shear * 0.012;

        // Broad belts and zones, with finer bands inside them.
        float broad = sin(l * 9.0 + uSeed);
        float narrow = sin(l * 31.0 + uSeed * 2.1);
        float zone = smoothstep(-0.3, 0.3, broad + 0.35 * narrow);
        vec3 col = mix(uBelt, uZone, zone);

        // Streaks of accent color along the belts, stretched by the winds.
        float streak = fbm(vec3(p.x * 3.0, l * 64.0, p.z * 3.0) + s * 2.0, 4) * 0.5 + 0.5;
        col = mix(col, uAccent, smoothstep(0.55, 0.85, streak) * 0.4 * (1.0 - zone));
        col *= 0.9 + 0.2 * (fbm(vec3(p.x * 6.0, l * 120.0, p.z * 6.0) + s, 3) * 0.5 + 0.5);

        // Hazy, darker poles.
        col *= mix(1.0, 0.72, smoothstep(0.62, 0.96, abs(p.y)));

        // One great storm: an oval swirl in the accent color.
        vec3 c = normalize(uStorm);
        vec3 north = normalize(vec3(0.0, 1.0, 0.0) - c * c.y);
        vec3 east = cross(north, c);
        vec2 q = vec2(dot(p - c, east), dot(p - c, north) * 1.9);
        float r = length(q);
        float spiral = sin(r * 120.0 - atan(q.y, q.x) * 2.0) * 0.5 + 0.5;
        float eye = 1.0 - smoothstep(0.05, 0.11, r);
        col = mix(col, mix(uAccent, uZone, 0.35 + 0.4 * spiral), eye * 0.85);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const target = new THREE.WebGLCubeRenderTarget(size, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const scene = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(10, 64, 32);
  scene.add(new THREE.Mesh(geometry, material));
  new THREE.CubeCamera(1, 100, target).update(renderer, scene);
  geometry.dispose();
  material.dispose();
  return target;
}

/** The ring system's radial profile: rgb = brightness variation, a = density, with a few clean gaps. */
function ringProfile(rng) {
  const N = 1024;
  const knots = (count) => Array.from({ length: count + 1 }, () => rng());
  const sample = (k, u) => {
    const x = u * (k.length - 1);
    const i = Math.min(k.length - 2, Math.floor(x));
    const f = x - i;
    const t = f * f * (3 - 2 * f);
    return k[i] + (k[i + 1] - k[i]) * t;
  };
  const coarse = knots(12);
  const mid = knots(60);
  const fine = knots(260);
  const tone = knots(30);
  const gaps = Array.from({ length: 2 + Math.floor(rng() * 2) }, () => {
    const at = 0.2 + rng() * 0.65;
    return [at, at + 0.012 + rng() * 0.03];
  });
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    let density = 0.15 + 0.55 * sample(coarse, u) + 0.3 * sample(mid, u) + 0.25 * sample(fine, u);
    density *= Math.min(1, u / 0.04) * Math.min(1, (1 - u) / 0.08);
    for (const [a, b] of gaps) if (u > a && u < b) density *= 0.06;
    const brightness = 0.7 + 0.3 * sample(tone, u);
    data.set([brightness * 255, brightness * 250, brightness * 240, Math.min(1, density) * 255].map(Math.round), i * 4);
  }
  const texture = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A banded gas giant with a ring system. Same interface as Planet: { group, radius, update, dispose }.
 * The rings cast their shadow across the cloud tops and the planet casts its shadow across the rings;
 * both are worked out per pixel with a ray toward the sun, which is cheap next to the baked clouds.
 */
export class GasGiant {
  constructor({ renderer, radius, position, sunDirection, bakeSize = 512, seed = 3.7, palette = 0, tilt = 0.4, rings = true }) {
    const rng = mulberry32(Math.floor(seed * 1000) + 17);
    const colors = PALETTES[Math.floor(palette * PALETTES.length) % PALETTES.length]; // palette: 0..1
    this.radius = radius;
    this.shineColor = new THREE.Color(...colors.zone).multiplyScalar(0.8); // light it throws back onto the ships
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.tilt = new THREE.Group();
    this.tilt.rotation.set(rng() * 0.3 - 0.15, rng() * Math.PI, tilt);
    this.group.add(this.tilt);

    const storm = new THREE.Vector3(rng() * 2 - 1, (rng() * 2 - 1) * 0.5, rng() * 2 - 1).normalize();
    this.bands = bakeBands(renderer, bakeSize, seed, colors, storm);
    this.ringTexture = rings ? ringProfile(rng) : null;
    const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    blank.needsUpdate = true;
    this.blank = blank;
    const inner = radius * 1.32;
    const outer = radius * (2.05 + rng() * 0.35);
    this.ringNormal = new THREE.Vector3();

    this.surfaceMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uBands: { value: this.bands.texture },
        uSunDir: { value: sunDirection },
        uCenter: { value: this.group.position },
        uRingNormal: { value: this.ringNormal },
        uRingInner: { value: inner },
        uRingOuter: { value: rings ? outer : inner },
        uRingTex: { value: this.ringTexture ?? blank },
        uHaze: { value: new THREE.Vector3(...colors.haze) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main() {
          vDir = normalize(position);
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform samplerCube uBands;
        uniform vec3 uSunDir;
        uniform vec3 uCenter;
        uniform vec3 uRingNormal;
        uniform float uRingInner;
        uniform float uRingOuter;
        uniform sampler2D uRingTex;
        uniform vec3 uHaze;
        varying vec3 vDir;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main() {
          vec3 c = textureCube(uBands, normalize(vDir)).rgb;
          vec3 albedo = c * c;
          vec3 n = normalize(vNormalW);
          vec3 v = normalize(cameraPosition - vWorldPos);
          float ndl = dot(n, uSunDir);
          // The deep atmosphere scatters a little light past the terminator.
          float diffuse = clamp((ndl + 0.06) / 1.06, 0.0, 1.0);
          float limb = mix(0.55, 1.0, pow(max(dot(n, v), 0.0), 0.45));

          // The rings' shadow: follow the ray toward the sun to the ring plane.
          float ringShadow = 0.0;
          float denom = dot(uSunDir, uRingNormal);
          if (abs(denom) > 1e-4) {
            float t = dot(uCenter - vWorldPos, uRingNormal) / denom;
            if (t > 0.0) {
              float r = length(vWorldPos + uSunDir * t - uCenter);
              float u = (r - uRingInner) / (uRingOuter - uRingInner);
              if (u > 0.0 && u < 1.0) ringShadow = texture2D(uRingTex, vec2(u, 0.5)).a;
            }
          }

          vec3 col = albedo * ${SUN} * diffuse * limb * (1.0 - 0.8 * ringShadow);
          // Haze glowing along the sunlit limb.
          float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          col += uHaze * rim * smoothstep(-0.1, 0.4, ndl) * 0.45;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(radius, 160, 120), this.surfaceMaterial);
    this.tilt.add(this.surface);

    if (rings) {
      const geometry = new THREE.RingGeometry(inner, outer, 256, 4);
      geometry.rotateX(-Math.PI / 2); // into the equatorial plane
      this.ringMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uRingTex: { value: this.ringTexture },
          uInner: { value: inner },
          uOuter: { value: outer },
          uSunDir: { value: sunDirection },
          uCenter: { value: this.group.position },
          uRadius: { value: radius },
          uNormal: { value: this.ringNormal },
          uTint: { value: new THREE.Vector3(...colors.ring) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vLocal;
          varying vec3 vWorldPos;
          void main() {
            vLocal = position;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uRingTex;
          uniform float uInner;
          uniform float uOuter;
          uniform vec3 uSunDir;
          uniform vec3 uCenter;
          uniform float uRadius;
          uniform vec3 uNormal;
          uniform vec3 uTint;
          varying vec3 vLocal;
          varying vec3 vWorldPos;
          void main() {
            float u = (length(vLocal.xz) - uInner) / (uOuter - uInner);
            vec4 ring = texture2D(uRingTex, vec2(clamp(u, 0.0, 1.0), 0.5));
            if (ring.a < 0.01) discard;

            // The planet's shadow: does the ray toward the sun hit the planet?
            vec3 oc = vWorldPos - uCenter;
            float b = dot(oc, uSunDir);
            float h = b * b - (dot(oc, oc) - uRadius * uRadius);
            float shadow = b < 0.0 ? smoothstep(0.0, uRadius * uRadius * 0.03, h) : 0.0;

            // Lit face shines; seen from the dark face, light leaks through, most of all toward the sun.
            vec3 v = normalize(cameraPosition - vWorldPos);
            float ndl = dot(uNormal, uSunDir);
            float ndv = dot(uNormal, v);
            float through = pow(max(dot(-v, uSunDir), 0.0), 6.0);
            float light = ndl * ndv > 0.0 ? 0.12 + abs(ndl) : abs(ndl) * (0.25 + 1.5 * through) * (1.0 - ring.a * 0.6);
            vec3 col = uTint * uTint * ring.rgb * ${SUN} * light * (1.0 - 0.92 * shadow) * 0.75;
            gl_FragColor = vec4(col, ring.a * 0.85);
          }
        `,
      });
      this.rings = new THREE.Mesh(geometry, this.ringMaterial);
      this.tilt.add(this.rings);
    }
    this.group.updateMatrixWorld(true);
    this.ringNormal.set(0, 1, 0).transformDirection(this.tilt.matrixWorld);
  }

  dispose() {
    this.bands.dispose();
    this.ringTexture?.dispose();
    this.blank.dispose();
    this.surface.geometry.dispose();
    this.surfaceMaterial.dispose();
    this.rings?.geometry.dispose();
    this.ringMaterial?.dispose();
  }

  update(dt) {
    this.surface.rotation.y += dt * 0.006; // gas giants spin fast
  }
}
