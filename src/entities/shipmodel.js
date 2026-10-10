import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture } from '../fx/textures.js';
import { mulberry32 } from '../util/math.js';

const HALF_LENGTH = 210;
const HALF_WIDTH = 35;
const HALF_HEIGHT = 18;

/** Hull taper from bow (z = -210) to stern (z = +210): the bow is narrower and lower. */
function taperAt(z) {
  const t = (z + HALF_LENGTH) / (HALF_LENGTH * 2);
  return {
    x: 0.36 + 0.64 * Math.min(1, t / 0.6),
    y: 0.55 + 0.45 * Math.min(1, t / 0.5),
  };
}

const deckY = (z) => HALF_HEIGHT * taperAt(z).y;
const sideX = (z) => HALF_WIDTH * taperAt(z).x;

/**
 * Hull plating drawn in the shader from object-space position, so every surface gets the same 8 × 4 m
 * plates without UV mapping. Plates vary slightly in tone and roughness and fade out with distance
 * to avoid shimmering.
 */
function addPlating(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObjPos;
        varying vec3 vObjNormal;
        float plateHash(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 an = abs(normalize(vObjNormal));
        vec2 puv = an.x > an.y && an.x > an.z ? vObjPos.zy : (an.y > an.z ? vObjPos.xz : vObjPos.xy);
        vec2 cellSize = vec2(8.0, 4.0);
        vec2 cell = floor(puv / cellSize);
        vec2 f = fract(puv / cellSize);
        float detail = 1.0 - smoothstep(0.25, 0.9, length(fwidth(puv / cellSize)));
        float seam = smoothstep(0.0, 0.02, f.x) * smoothstep(0.0, 0.02, 1.0 - f.x)
          * smoothstep(0.0, 0.04, f.y) * smoothstep(0.0, 0.04, 1.0 - f.y);
        float plate = plateHash(cell);
        diffuseColor.rgb *= mix(1.0, (0.86 + 0.24 * plate) * (0.5 + 0.5 * seam), detail);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= mix(1.0, 0.8 + 0.35 * plate, detail);`);
  };
}

/** A gun turret: rotating housing with two long barrels. Barrels point down -Z at rest. */
function buildTurret(hullMaterial, gunMaterial, upsideDown) {
  const base = new THREE.Group();
  if (upsideDown) base.rotation.z = Math.PI;
  const yaw = new THREE.Group();
  base.add(yaw);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 3, 24), hullMaterial);
  ring.position.y = 1.5;
  yaw.add(ring);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(13, 6, 15), hullMaterial);
  housing.position.set(0, 6, 1);
  yaw.add(housing);
  const pitch = new THREE.Group();
  pitch.position.set(0, 6, -5);
  yaw.add(pitch);
  const muzzles = [];
  for (const x of [-2.6, 2.6]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 22, 10), gunMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(x, 0, -11);
    pitch.add(barrel);
    muzzles.push(new THREE.Vector3(x, 0, -22.5));
  }
  return { base, yaw, pitch, muzzles, upsideDown };
}

/**
 * Builds a capital ship about 420 m long. Forward is -Z, up is +Y.
 * Returns the scene object plus the parts gameplay needs: turrets, the bow emitter, engine glows,
 * the bridge camera anchor, the hangar mouth and collision spheres.
 */
export function buildCapitalShip({ hostile = false, seed = 1, colors }) {
  const rng = mulberry32(seed);
  const object = new THREE.Group();

  // Matte painted plating: a shiny hull turns the whole deck into a mirror for the sun.
  const hullMaterial = new THREE.MeshStandardMaterial({
    color: hostile ? 0x3e3236 : 0x5a6069,
    metalness: 0.3,
    roughness: 0.78,
  });
  addPlating(hullMaterial);
  const gunMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2f35, metalness: 0.75, roughness: 0.38 });
  const lightColor = (hostile ? colors.hostile : colors.ice).clone();

  // Main hull, tapered toward the bow.
  const parts = [];
  const hull = new THREE.BoxGeometry(HALF_WIDTH * 2, HALF_HEIGHT * 2, HALF_LENGTH * 2, 2, 2, 14);
  const pos = hull.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = taperAt(pos.getZ(i));
    pos.setXY(i, pos.getX(i) * t.x, pos.getY(i) * t.y);
  }
  hull.computeVertexNormals();
  parts.push(hull);

  // Upper hull, bridge tower and bridge house.
  const upper = new THREE.BoxGeometry(46, 10, 250);
  upper.translate(0, HALF_HEIGHT + 5, 45);
  parts.push(upper);
  const tower = new THREE.BoxGeometry(26, 24, 42);
  tower.translate(0, HALF_HEIGHT + 10 + 12, 98);
  parts.push(tower);
  const house = new THREE.BoxGeometry(36, 9, 20);
  house.translate(0, 58, 90);
  parts.push(house);
  const roof = new THREE.BoxGeometry(30, 2, 16);
  roof.translate(0, 63.5, 92);
  parts.push(roof);

  // Bow prongs that cradle the death ray emitter.
  for (const x of [-12, 12]) {
    const prong = new THREE.BoxGeometry(6, 9, 64);
    prong.translate(x, 6, -HALF_LENGTH - 22);
    parts.push(prong);
  }

  // Engine block.
  const block = new THREE.BoxGeometry(64, 30, 14);
  block.translate(0, 0, HALF_LENGTH + 4);
  parts.push(block);

  // Greebles: vents, tanks and housings scattered over the plating.
  for (let i = 0; i < 160; i++) {
    const z = (rng() * 2 - 1) * (HALF_LENGTH - 15);
    const w = 2 + rng() * 9;
    const h = 1 + rng() * 3.5;
    const d = 3 + rng() * 14;
    const g = new THREE.BoxGeometry(w, h, d);
    const side = rng();
    if (side < 0.5) {
      const x = (rng() * 2 - 1) * (sideX(z) - w);
      g.translate(x, deckY(z) + h / 2, z);
    } else if (side < 0.8) {
      const s = rng() < 0.5 ? -1 : 1;
      g.rotateZ(Math.PI / 2);
      g.translate(s * (sideX(z) + h / 2), (rng() * 2 - 1) * deckY(z) * 0.6, z);
    } else {
      const x = (rng() * 2 - 1) * (sideX(z) - w);
      g.translate(x, -deckY(z) - h / 2, z);
    }
    parts.push(g);
  }
  // Masts on the bridge roof.
  for (const [x, h] of [[-8, 14], [5, 22], [11, 9]]) {
    const mast = new THREE.CylinderGeometry(0.35, 0.5, h, 6);
    mast.translate(x, 64 + h / 2, 94);
    parts.push(mast);
  }

  const merged = mergeGeometries(parts);
  const hullMesh = new THREE.Mesh(merged, hullMaterial);
  object.add(hullMesh);

  // Bridge windows: a lit strip across the front of the bridge house.
  // A single-sided plane facing forward, so it shows from outside but not from inside the bridge.
  const windowMaterial = new THREE.MeshBasicMaterial({ color: lightColor.clone().multiplyScalar(0.7) });
  const windows = new THREE.Mesh(new THREE.PlaneGeometry(32, 2.2), windowMaterial);
  windows.rotation.y = Math.PI;
  windows.position.set(0, 59, 79.9);
  object.add(windows);

  // Turrets: two superfiring forward, one aft, two under the keel.
  const turrets = [];
  const mount = (x, z, upsideDown, facingAft = false) => {
    const t = buildTurret(hullMaterial, gunMaterial, upsideDown);
    const y = upsideDown ? -deckY(z) : z > -90 && z < 170 ? HALF_HEIGHT + 10 : deckY(z);
    t.base.position.set(x, y, z);
    if (facingAft) t.yaw.rotation.y = Math.PI;
    t.restYaw = t.yaw.rotation.y;
    object.add(t.base);
    turrets.push(t);
  };
  mount(0, -150, false);
  mount(0, -62, false);
  mount(0, 160, false, true);
  mount(0, -95, true);
  mount(0, 90, true, true);

  // Death ray emitter at the bow: a ring with a core that glows as it charges.
  const emitter = new THREE.Group();
  emitter.position.set(0, 6, -HALF_LENGTH - 44);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 1.8, 12, 40), gunMaterial);
  emitter.add(ring);
  const coreMaterial = new THREE.MeshBasicMaterial({ color: lightColor.clone().multiplyScalar(0.6) });
  const core = new THREE.Mesh(new THREE.SphereGeometry(3.6, 20, 14), coreMaterial);
  emitter.add(core);
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(),
    color: lightColor.clone().multiplyScalar(0.4),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  }));
  coreGlow.scale.setScalar(26);
  emitter.add(coreGlow);
  object.add(emitter);

  // Engines: nozzles with glows that brighten with throttle.
  const engines = [];
  const nozzleMaterial = new THREE.MeshBasicMaterial({ color: lightColor.clone().multiplyScalar(1.4) });
  for (const [x, y] of [[-20, -3], [20, -3], [0, 9]]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 10, 20), gunMaterial);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(x, y, HALF_LENGTH + 14);
    object.add(nozzle);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(8.2, 24), nozzleMaterial);
    disc.position.set(x, y, HALF_LENGTH + 19.1);
    object.add(disc);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      color: lightColor.clone().multiplyScalar(1.2),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    glow.position.set(x, y, HALF_LENGTH + 26);
    glow.scale.setScalar(40);
    object.add(glow);
    engines.push(glow);
  }

  // Hangar bay on the port side, lit around its mouth.
  const hangarZ = 40;
  const bay = new THREE.Mesh(new THREE.BoxGeometry(1, 16, 46), new THREE.MeshBasicMaterial({ color: 0x020203 }));
  bay.position.set(-HALF_WIDTH - 0.6, 0, hangarZ);
  object.add(bay);
  const edgeMaterial = new THREE.MeshBasicMaterial({ color: colors.flare.clone().multiplyScalar(hostile ? 0.3 : 0.9) });
  for (const y of [-8.6, 8.6]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 46), edgeMaterial);
    edge.position.set(-HALF_WIDTH - 0.7, y, hangarZ);
    object.add(edge);
  }

  // Navigation lights: red to port, green to starboard, white strobe on the mast.
  const navLights = [];
  const nav = (x, y, z, color, blink) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      color,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(7);
    sprite.userData.blink = blink;
    object.add(sprite);
    navLights.push(sprite);
  };
  nav(-HALF_WIDTH - 1, 2, 120, new THREE.Color(3, 0.2, 0.2), false);
  nav(HALF_WIDTH + 1, 2, 120, new THREE.Color(0.2, 3, 0.4), false);
  nav(5, 86.5, 94, new THREE.Color(3, 3, 3), true);
  nav(0, -HALF_HEIGHT - 1, -40, hostile ? new THREE.Color(3, 0.2, 0.2) : new THREE.Color(3, 3, 3), true);

  // Deck edge lights, like a runway along both sides of the hull.
  const deckLight = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: lightColor.clone().multiplyScalar(0.9),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  for (let z = -HALF_LENGTH + 20; z < HALF_LENGTH - 10; z += 26) {
    for (const s of [-1, 1]) {
      const lamp = new THREE.Sprite(deckLight);
      lamp.position.set(s * (sideX(z) - 1.5), deckY(z) + 0.8, z);
      lamp.scale.setScalar(3.2);
      object.add(lamp);
    }
  }

  // Collision spheres along the hull.
  const colliders = [];
  for (let z = -HALF_LENGTH + 10; z <= HALF_LENGTH; z += 34) {
    colliders.push({ offset: new THREE.Vector3(0, 0, z), radius: Math.max(16, sideX(z) * 0.95) });
  }
  colliders.push({ offset: new THREE.Vector3(0, 40, 95), radius: 24 });
  colliders.push({ offset: new THREE.Vector3(0, 6, -HALF_LENGTH - 30), radius: 18 });

  const bridgeAnchor = new THREE.Object3D();
  bridgeAnchor.position.set(0, 59, 86);
  object.add(bridgeAnchor);

  return {
    object,
    turrets,
    emitter: { group: emitter, core, coreMaterial, glow: coreGlow, color: lightColor },
    engines,
    navLights,
    bridgeAnchor,
    hangar: {
      position: new THREE.Vector3(-HALF_WIDTH - 8, 0, hangarZ),
      direction: new THREE.Vector3(-1, 0, 0),
    },
    colliders,
    materials: [hullMaterial, gunMaterial],
  };
}
