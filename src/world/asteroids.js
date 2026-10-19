import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { GLSL_NOISE, createNoise3D, fbm3 } from './noise.js';
import { mulberry32, rand, randInt, randomUnit } from '../util/math.js';
import { getModel } from '../models.js';

// Geometry detail by size class: big rocks get more vertices because you see them up close.
const DETAIL = { large: 5, medium: 4, small: 2 };
const VARIANTS = { large: 5, medium: 4, small: 4 };
// Average visual radius of a unit rock after stretching, used to size the collision sphere.
const COLLISION_SCALE = 0.86;

/**
 * Adds per-pixel surface detail to a rock material: a noise-driven bump on the lighting normal and
 * mottled albedo, so rocks stay craggy up close without millions of vertices.
 */
function addSurfaceDetail(material, octaves) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRockPos;
        uniform mat3 normalMatrix;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 0.8 + 0.4 * (snoise(vRockPos * 11.0) * 0.5 + 0.5);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 rp = vRockPos * 6.0;
        vec3 bump = vec3(snoise(rp), snoise(rp + 17.3), snoise(rp + 31.7));
        #if ${octaves} > 1
          vec3 rq = vRockPos * 19.0;
          bump += 0.5 * vec3(snoise(rq), snoise(rq + 5.1), snoise(rq + 9.4));
        #endif
        normal = normalize(normal + normalMatrix * bump * 0.3);`);
  };
}

/** One lumpy, cratered rock of roughly unit radius with per-vertex albedo variation. */
function makeRockGeometry(rng, noise, detail) {
  let geometry = new THREE.IcosahedronGeometry(1, detail);
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry = mergeVertices(geometry);

  const ox = rng() * 100;
  const oy = rng() * 100;
  const oz = rng() * 100;
  const stretch = new THREE.Vector3(1, 0.62 + rng() * 0.33, 0.55 + rng() * 0.4);
  const craters = Array.from({ length: randInt(4, 10) }, () => ({
    center: randomUnit(new THREE.Vector3(), rng),
    size: 0.18 + rng() * 0.35,
    depth: 0.04 + rng() * 0.08,
  }));

  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let d = 1
      + 0.3 * fbm3(noise, v.x * 1.1 + ox, v.y * 1.1 + oy, v.z * 1.1 + oz, 4)
      + 0.07 * fbm3(noise, v.x * 4.5 + ox, v.y * 4.5 + oy, v.z * 4.5 + oz, 3)
      + 0.02 * noise(v.x * 16 + ox, v.y * 16 + oy, v.z * 16 + oz);
    let crater = 0;
    for (const c of craters) {
      const t = Math.acos(Math.min(1, Math.max(-1, v.dot(c.center)))) / c.size;
      if (t < 1) crater += c.depth * (1 - t * t);
      crater -= c.depth * 0.35 * Math.exp(-(((t - 1) / 0.2) ** 2)); // raised rim
    }
    d -= crater;
    pos.setXYZ(i, v.x * d * stretch.x, v.y * d * stretch.y, v.z * d * stretch.z);

    // Albedo: mottled regolith, darker crater floors, brighter fresh rims.
    const mottle = 0.78 + 0.22 * fbm3(noise, v.x * 3 + oz, v.y * 3 + ox, v.z * 3 + oy, 3);
    const tone = Math.max(0.4, mottle - crater * 2.2);
    colors[i * 3] = tone;
    colors[i * 3 + 1] = tone * 0.97;
    colors[i * 3 + 2] = tone * 0.93;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export class Asteroid {
  constructor(size, mesh, radius, velocity) {
    const def = CONFIG.asteroid[size];
    this.size = size;
    this.mesh = mesh;
    this.radius = radius * COLLISION_SCALE;
    this.position = mesh.position;
    this.velocity = velocity;
    this.hp = def.hp;
    this.spinAxis = randomUnit(new THREE.Vector3());
    this.spinRate = rand(-0.25, 0.25) * (size === 'large' ? 0.4 : size === 'medium' ? 1 : 2);
    this.flash = 0;
    this.dead = false;
  }
}

/**
 * The giant asteroid some sectors are built around: too big to break, it's a landmark to steer by and
 * cover to hide behind. Ships steer around it, shots splash on it and fighters that fly into it are lost.
 */
export class Landmark {
  constructor(mesh, radius) {
    this.kind = 'landmark';
    this.mesh = mesh;
    this.position = mesh.position;
    this.radius = radius; // collision sphere: inside the equatorial ridge, outside the poles
    this.velocity = new THREE.Vector3();
  }
}

/** Owns the rock meshes: shared geometry variants, a few material tints, spawning and removal. */
export class AsteroidField {
  constructor(scene, { seed = 11, lowPower = false, shadows = false } = {}) {
    this.scene = scene;
    this.shadows = shadows;
    this.rocks = [];
    this.landmark = null;
    this.bennu = null;
    const rng = mulberry32(seed);
    const noise = createNoise3D(seed);
    this.noise = noise;
    this.geometries = {};
    for (const size of Object.keys(DETAIL)) {
      this.geometries[size] = Array.from({ length: VARIANTS[size] }, () => makeRockGeometry(rng, noise, DETAIL[size]));
    }
    // Dark, slightly warm grays: carbonaceous and stony rock.
    this.materials = [0x6b625a, 0x58544f, 0x75685c, 0x4f4a46].map((color) => {
      const material = new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.96, metalness: 0 });
      addSurfaceDetail(material, lowPower ? 1 : 2);
      return material;
    });
  }

  spawn(size, position, velocity = randomUnit(new THREE.Vector3()).multiplyScalar(rand(0.5, 1) * CONFIG.asteroid.drift)) {
    const def = CONFIG.asteroid[size];
    const radius = rand(def.radius[0], def.radius[1]);
    const geometry = this.geometries[size][Math.floor(Math.random() * this.geometries[size].length)];
    const mesh = new THREE.Mesh(geometry, this.materials[Math.floor(Math.random() * this.materials.length)]);
    mesh.position.copy(position);
    mesh.scale.setScalar(radius);
    mesh.quaternion.setFromAxisAngle(randomUnit(new THREE.Vector3()), rand(0, Math.PI * 2));
    mesh.castShadow = mesh.receiveShadow = this.shadows;
    this.scene.add(mesh);
    const rock = new Asteroid(size, mesh, radius, velocity);
    this.rocks.push(rock);
    return rock;
  }

  /** Scatters a cluster of rocks around `center`, mostly large, within `radius`. */
  populateCluster(center, radius, count, rng = Math.random) {
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      randomUnit(p, rng).multiplyScalar(radius * Math.cbrt(rng()));
      p.y *= 0.5;
      p.add(center);
      const roll = rng();
      if (this.landmark && p.distanceTo(this.landmark.position) < this.landmark.radius * 1.15 + 90) continue;
      this.spawn(roll < 0.55 ? 'large' : roll < 0.85 ? 'medium' : 'small', p);
    }
  }

  update(dt) {
    const q = new THREE.Quaternion();
    for (const rock of this.rocks) {
      rock.position.addScaledVector(rock.velocity, dt);
      q.setFromAxisAngle(rock.spinAxis, rock.spinRate * dt);
      rock.mesh.quaternion.premultiply(q);
    }
    this.landmark?.mesh.rotateY(0.006 * dt);
  }

  /** Places the sector's giant asteroid, `radius` meters to its equator. Rocks placed after it keep clear. */
  placeLandmark(position, radius) {
    const mesh = new THREE.Mesh(this.#landmarkGeometry(), this.materials[1]);
    mesh.position.copy(position);
    mesh.scale.setScalar(radius);
    mesh.rotation.set(rand(-0.4, 0.4), rand(0, Math.PI * 2), rand(-0.4, 0.4));
    mesh.castShadow = mesh.receiveShadow = this.shadows;
    this.scene.add(mesh);
    this.landmark = new Landmark(mesh, radius * 0.9);
    return this.landmark;
  }

  /**
   * NASA's shape model of the asteroid Bennu (models.js) at unit radius, mottled like the other rocks,
   * made once. A big procedural rock stands in if the model didn't load.
   */
  #landmarkGeometry() {
    if (this.bennu) return this.bennu;
    const model = getModel('bennu', 2);
    if (!model) return this.geometries.large[0];
    model.updateMatrixWorld(true);
    let geometry = null;
    model.traverse((o) => {
      if (o.isMesh && !geometry) geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    });
    for (const key of Object.keys(geometry.attributes)) if (key !== 'position' && key !== 'normal') geometry.deleteAttribute(key);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const tone = 0.74 + 0.26 * fbm3(this.noise, v.x * 3 + 41, v.y * 3 + 7, v.z * 3 + 19, 3);
      colors.set([tone, tone * 0.97, tone * 0.93], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    this.bennu = geometry;
    return geometry;
  }

  remove(rock) {
    rock.dead = true;
    this.scene.remove(rock.mesh);
  }

  /** Drops dead rocks from the list. */
  sweep() {
    this.rocks = this.rocks.filter((r) => !r.dead);
  }

  clear() {
    for (const rock of this.rocks) this.scene.remove(rock.mesh);
    this.rocks = [];
    if (this.landmark) this.scene.remove(this.landmark.mesh);
    this.landmark = null;
  }
}
