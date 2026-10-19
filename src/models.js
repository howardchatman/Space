import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Ready-made 3D models from assets/models, loaded once at startup (credits in assets/models/README.md).
 * Each is a .gltf with its geometry in a .bin and textures as separate .webp files: every piece loads by
 * plain URL, which works anywhere the game's own files do.
 * Quaternius spaceships fly as enemy fighters, recon scouts and corvette hulls; NASA spacecraft drift as
 * derelicts; NASA's shape model of the asteroid Bennu is a landmark. Ships face +Z, as glTF does.
 *
 * `engines` are exhaust positions as fractions of the model's bounds (-0.5 to 0.5 on each axis), and
 * `exhaust` the plume radius as a fraction of its width, read off renders of the ships from behind.
 * If a file can't load, the game keeps its procedural model.
 */
const MODELS = {
  striker: { file: 'ship-striker.gltf', engines: [[0, 0.15, -0.5]] },
  dispatcher: { file: 'ship-dispatcher.gltf', engines: [[0, 0.15, -0.5]] },
  omen: { file: 'ship-omen.gltf', engines: [[0, 0, -0.5]] },
  bob: { file: 'ship-bob.gltf', engines: [[0, 0.1, -0.5]] },
  insurgent: { file: 'ship-insurgent.gltf', engines: [[-0.15, 0.04, -0.5], [0.15, 0.04, -0.5]], exhaust: 0.08 },
  imperial: { file: 'ship-imperial.gltf', engines: [[-0.18, 0, -0.5], [0.18, 0, -0.5]], exhaust: 0.065 },
  // Derelicts, with how big each one floats in the game (meters across its longest side).
  hubble: { file: 'derelict-hubble.gltf', size: 50, derelict: true },
  station: { file: 'derelict-station.gltf', size: 110, derelict: true },
  skylab: { file: 'derelict-skylab.gltf', size: 55, derelict: true },
  relay: { file: 'derelict-relay.gltf', size: 50, derelict: true },
  cassini: { file: 'derelict-cassini.gltf', size: 45, derelict: true },
  juno: { file: 'derelict-juno.gltf', size: 50, derelict: true },
  bennu: { file: 'asteroid-bennu.gltf' },
};

export const FIGHTERS = ['striker', 'dispatcher', 'omen'];
export const SCOUT = 'bob';
export const CORVETTES = ['insurgent', 'imperial'];
export const DERELICTS = Object.keys(MODELS).filter((name) => MODELS[name].derelict);

const library = new Map(); // name -> { object, size }
let ready = false;

/**
 * Starts loading every model. Resolves once they've all arrived or failed, or after `timeout` ms, so a
 * slow connection never keeps the player from starting (models that arrive later are used from then on).
 */
export function loadModels({ base = 'assets/models/', timeout = 20000 } = {}) {
  const loader = new GLTFLoader();
  const jobs = Object.entries(MODELS).map(([name, spec]) => loader.loadAsync(base + spec.file).then(
    (gltf) => library.set(name, prepare(gltf.scene, spec)),
    (error) => console.warn(`Couldn't load ${spec.file}; using the built-in model instead.`, error),
  ));
  const late = new Promise((resolve) => setTimeout(resolve, timeout));
  return Promise.race([Promise.all(jobs), late]).then(() => {
    ready = true;
  });
}

export const modelsReady = () => ready;

/**
 * A copy of a loaded model, centered on the origin and scaled so its longest side is `size` meters
 * (the derelict's own size if left out), or null if it didn't load. Copies share geometry and materials.
 */
export function getModel(name, size = MODELS[name]?.size) {
  const entry = library.get(name);
  if (!entry) return null;
  const copy = entry.object.clone();
  copy.scale.setScalar(size / Math.max(entry.size.x, entry.size.y, entry.size.z));
  return copy;
}

/** Engine positions for a model scaled as `getModel(name, size)` returns it, in its own space. */
export function enginePoints(name, size) {
  const entry = library.get(name);
  if (!entry) return [];
  const s = entry.size;
  const k = size / Math.max(s.x, s.y, s.z);
  return MODELS[name].engines.map(([x, y, z]) => new THREE.Vector3(x * s.x * k, y * s.y * k, z * s.z * k));
}

export const exhaustRadius = (name) => MODELS[name]?.exhaust ?? 0.1;

/** The model's vertex farthest along `direction`, in the space of `object` (a getModel copy). */
export function farthestPoint(object, direction) {
  object.updateMatrixWorld(true);
  const toObject = new THREE.Matrix4().copy(object.matrixWorld).invert();
  const v = new THREE.Vector3();
  const best = new THREE.Vector3();
  let bestDot = -Infinity;
  object.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Matrix4().multiplyMatrices(toObject, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      const d = v.dot(direction);
      if (d > bestDot) {
        bestDot = d;
        best.copy(v);
      }
    }
  });
  return best.multiply(object.scale);
}

/**
 * Centers the model on its bounds and swaps its materials for plain, matte MeshStandardMaterials: some
 * files ask for physical materials (a separate, costlier shader) or polished metal that would mirror the
 * sun. NASA's thin solar panels are single planes, so derelicts draw both sides.
 */
function prepare(scene, spec) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  scene.position.sub(center);
  const object = new THREE.Group();
  object.add(scene);

  const swapped = new Map();
  const matte = (m) => {
    if (!swapped.has(m)) {
      const plain = new THREE.MeshStandardMaterial({
        name: m.name,
        color: m.color,
        map: m.map,
        normalMap: m.normalMap,
        vertexColors: m.vertexColors,
        transparent: m.transparent,
        opacity: m.opacity,
        alphaTest: m.alphaTest,
        side: spec.derelict ? THREE.DoubleSide : m.side,
        metalness: Math.min(m.metalness ?? 0, 0.4),
        roughness: Math.max(m.roughness ?? 1, 0.55),
      });
      if (m.normalMap) plain.normalScale.copy(m.normalScale);
      swapped.set(m, plain);
      m.dispose();
    }
    return swapped.get(m);
  };
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(matte) : matte(o.material);
  });
  return { object, size };
}
