import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';

/**
 * Bakes the planet's surface into two cube maps once (the noise is far too expensive to run per pixel
 * every frame), then shades them live with sun lighting, ocean glint, cloud shadows and city lights.
 *   surface cube: rgb = albedo, a = land mask
 *   detail cube:  r = clouds, g = city lights, b = ice
 */
function bakePlanet(renderer, size, seed) {
  const bakeShader = (outputs) => new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uSeed: { value: seed } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uSeed;
      varying vec3 vDir;
      ${GLSL_NOISE}
      void main() {
        vec3 p = normalize(vDir);
        vec3 s = vec3(uSeed, uSeed * 1.7, uSeed * 2.3);
        float lat = abs(p.y);

        // Continents from domain-warped fractal noise.
        vec3 q = p * 1.5 + s;
        q += 0.5 * vec3(snoise(q + 3.1), snoise(q + 7.7), snoise(q + 12.9));
        float h = fbm(q * 1.2, 8);
        float seaLevel = 0.03;
        float land = smoothstep(seaLevel - 0.003, seaLevel + 0.003, h);
        float elev = clamp((h - seaLevel) / 0.38, 0.0, 1.0);

        float depth = clamp((seaLevel - h) / 0.25, 0.0, 1.0);
        vec3 ocean = mix(vec3(0.02, 0.09, 0.13), vec3(0.004, 0.02, 0.06), sqrt(depth));

        // Biomes from moisture and latitude: deserts near 25 degrees, forest and grassland elsewhere.
        float moist = fbm(p * 3.2 + s + 40.0, 5) * 0.5 + 0.5;
        float desertBelt = 1.0 - smoothstep(0.1, 0.35, abs(lat - 0.38));
        vec3 forest = vec3(0.03, 0.065, 0.022);
        vec3 grass = vec3(0.1, 0.11, 0.045);
        vec3 desert = vec3(0.36, 0.27, 0.16);
        vec3 rock = vec3(0.17, 0.14, 0.12);
        vec3 ground = mix(forest, grass, smoothstep(0.38, 0.62, moist));
        ground = mix(ground, desert, smoothstep(0.3, 0.6, desertBelt * (1.1 - moist)));
        ground = mix(ground, rock, smoothstep(0.3, 0.7, elev));
        float snowLine = 0.72 - 0.55 * lat;
        ground = mix(ground, vec3(0.78, 0.8, 0.84), smoothstep(snowLine, snowLine + 0.06, elev));
        ground *= 0.85 + 0.3 * (fbm(p * 24.0 + s, 4) * 0.5 + 0.5);

        float ice = smoothstep(0.83, 0.88, lat + 0.07 * fbm(p * 5.0 + s, 4));
        vec3 albedo = mix(mix(ocean, ground, land), vec3(0.84, 0.88, 0.92), ice);

        // Clouds: banded by latitude like real weather, with swirling detail.
        vec3 c = p * 2.1 + s * 0.5;
        c += 0.7 * vec3(snoise(c * 1.3 + 2.0), snoise(c * 1.3 + 5.0), snoise(c * 1.3 + 8.0));
        float cloud = fbm(c * 1.5, 7) * 0.5 + 0.5;
        float bands = 0.78 + 0.22 * sin(lat * 10.0 + 0.6);
        cloud = smoothstep(0.48, 0.78, cloud * bands + 0.06);

        // City lights cluster on habitable land near coasts.
        float coast = 1.0 - smoothstep(0.0, 0.08, h - seaLevel);
        float clusters = smoothstep(0.55, 0.85, snoise(p * 9.0 + s) * 0.5 + 0.5);
        float towns = smoothstep(0.72, 0.95, snoise(p * 70.0 + s) * 0.5 + 0.5);
        float habitable = land * (1.0 - ice) * (1.0 - smoothstep(0.4, 0.7, elev)) * (1.0 - desertBelt * 0.7);
        float city = towns * (0.35 + 0.65 * max(clusters, coast)) * habitable;

        gl_FragColor = ${outputs};
      }
    `,
  });

  const geometry = new THREE.SphereGeometry(10, 64, 32);
  const bake = (outputs) => {
    const target = new THREE.WebGLCubeRenderTarget(size, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    const material = bakeShader(outputs);
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, material));
    new THREE.CubeCamera(1, 100, target).update(renderer, scene);
    material.dispose();
    return target;
  };

  const surface = bake('vec4(sqrt(albedo), land)'); // sqrt keeps dark ocean tones out of 8-bit banding
  const detail = bake('vec4(cloud, city, ice, 1.0)');
  geometry.dispose();
  return { surface, detail };
}

export class Planet {
  constructor({ renderer, radius, position, sunDirection, bakeSize = 512, seed = 3.7 }) {
    this.radius = radius;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.tilt = new THREE.Group();
    this.tilt.rotation.z = 0.38; // axial tilt
    this.group.add(this.tilt);

    const maps = bakePlanet(renderer, bakeSize, seed);
    this.maps = maps;

    this.surfaceMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSurface: { value: maps.surface.texture },
        uDetail: { value: maps.detail.texture },
        uSunDir: { value: sunDirection },
        uCloudSpin: { value: 0 },
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
        uniform samplerCube uSurface;
        uniform samplerCube uDetail;
        uniform vec3 uSunDir;
        uniform float uCloudSpin;
        varying vec3 vDir;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;

        vec3 spinY(vec3 p, float a) {
          float c = cos(a), s = sin(a);
          return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
        }

        void main() {
          vec3 p = normalize(vDir);
          vec3 n = normalize(vNormalW);
          vec3 v = normalize(cameraPosition - vWorldPos);

          vec4 surf = textureCube(uSurface, p);
          vec3 albedo = surf.rgb * surf.rgb;
          float land = surf.a;
          vec4 det = textureCube(uDetail, p);
          float ice = det.b;
          float city = det.g;
          vec3 cp = spinY(p, uCloudSpin);
          float cloud = textureCube(uDetail, cp).r;

          float ndl = dot(n, uSunDir);
          float diffuse = max(ndl, 0.0);
          float twilight = smoothstep(-0.15, 0.12, ndl);
          vec3 sun = vec3(1.0, 0.96, 0.9) * 2.4;

          // Clouds cast soft shadows on the ground a little way from where they sit.
          float shadow = textureCube(uDetail, normalize(cp + uSunDir * 0.012)).r;
          vec3 ground = albedo * diffuse * sun * (1.0 - 0.55 * shadow);

          // Sun glint on open water.
          vec3 hv = normalize(uSunDir + v);
          float glint = pow(max(dot(n, hv), 0.0), 90.0) * (1.0 - land) * (1.0 - ice);
          ground += vec3(1.0, 0.9, 0.75) * glint * 2.2 * step(0.0, ndl) * (1.0 - cloud);

          vec3 cloudLit = vec3(0.95) * sun * (diffuse * 0.97 + 0.015);
          vec3 col = mix(ground, cloudLit, cloud * 0.95);

          // City lights show through on the night side.
          col += vec3(1.0, 0.62, 0.3) * city * (1.0 - twilight) * (1.0 - cloud * 0.85) * 0.28;

          // Atmospheric haze: thin blue overhead, thick toward the limb, warm along the terminator.
          float limb = pow(1.0 - max(dot(n, v), 0.0), 2.2);
          vec3 haze = mix(vec3(1.0, 0.38, 0.14), vec3(0.28, 0.52, 1.0), smoothstep(-0.02, 0.28, ndl));
          haze *= 1.5 * smoothstep(-0.12, 0.35, ndl);
          float hazeAmount = (0.06 + 0.94 * limb) * smoothstep(-0.14, 0.08, ndl);
          col = mix(col, haze, clamp(hazeAmount * 0.55, 0.0, 1.0));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.surface = new THREE.Mesh(new THREE.SphereGeometry(radius, 160, 120), this.surfaceMaterial);
    this.tilt.add(this.surface);

    const atmosphereScale = 1.035;
    this.atmosphereMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uCenter: { value: this.group.position },
        uRadius: { value: radius },
        uThickness: { value: radius * (atmosphereScale - 1) },
        uSunDir: { value: sunDirection },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCenter;
        uniform float uRadius;
        uniform float uThickness;
        uniform vec3 uSunDir;
        varying vec3 vWorldPos;
        void main() {
          // How close does this view ray pass to the planet? That sets how much air it crosses.
          vec3 rd = normalize(vWorldPos - cameraPosition);
          float t = dot(uCenter - cameraPosition, rd);
          vec3 closest = cameraPosition + rd * t;
          float h = (length(closest - uCenter) - uRadius) / uThickness;
          if (h > 1.0 || t < 0.0) discard;
          float density = exp(-max(h, 0.0) * 4.5) * (1.0 - smoothstep(0.8, 1.0, h));

          vec3 up = normalize(closest - uCenter);
          float sun = dot(up, uSunDir);
          float lit = smoothstep(-0.32, 0.25, sun);
          vec3 color = mix(vec3(1.0, 0.4, 0.15), vec3(0.32, 0.58, 1.0), smoothstep(-0.12, 0.35, sun));
          gl_FragColor = vec4(color * density * lit * 2.2, 1.0);
        }
      `,
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(radius * atmosphereScale, 128, 96), this.atmosphereMaterial);
    this.group.add(this.atmosphere);
  }

  update(dt) {
    this.surface.rotation.y += dt * 0.0035;
    this.surfaceMaterial.uniforms.uCloudSpin.value += dt * 0.0012;
  }
}
