import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture } from '../fx/textures.js';
import { ShieldBubble } from '../fx/shield.js';
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
 * Matte hull plating drawn in the shader from object-space position, so every surface gets the same
 * 8 × 4 m plates without UV mapping. Plates vary slightly in tone and roughness and fade out with distance
 * to avoid shimmering. With `windows`, side walls also get decks of small windows: dark glass by day, most
 * lit from inside, in runs with gaps, blurring into a faint glow when too small to see. The window color
 * and switch are uniforms: three.js keys programs on the onBeforeCompile source, so all hulls share one.
 */
function plating({ color, windowColor, windows = true, metalness = 0.3, roughness = 0.78 }) {
  const material = new THREE.MeshStandardMaterial({ color, metalness, roughness });
  const uniforms = {
    uWindowColor: { value: (windowColor ?? new THREE.Color(0, 0, 0)).clone() },
    uWindows: { value: windows ? 1 : 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uWindowColor;
        uniform float uWindows;
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
        diffuseColor.rgb *= mix(1.0, (0.86 + 0.24 * plate) * (0.5 + 0.5 * seam), detail);

        float windowNear = 0.0;
        float windowFar = 0.0;
        if (uWindows > 0.5 && (an.x > 0.7 || an.z > 0.7)) {
          vec2 wp = an.x > 0.7 ? vObjPos.zy : vObjPos.xy;
          float side = an.x > 0.7 ? sign(vObjNormal.x) : 3.0 * sign(vObjNormal.z);
          vec2 wcell = floor(wp / vec2(2.6, 4.0));
          vec2 wf = fract(wp / vec2(2.6, 4.0));
          // Only some decks have windows on a given face, in runs of a few panes with gaps between.
          float deck = step(0.5, plateHash(vec2(wcell.y, side + 7.0)));
          float run = step(0.35, plateHash(vec2(floor(wcell.x / 7.0), wcell.y + side * 13.0)));
          float pane = step(0.32, wf.x) * step(wf.x, 0.68) * step(0.45, wf.y) * step(wf.y, 0.6) * deck * run;
          float lit = step(0.3, plateHash(wcell + 17.0 + side));
          diffuseColor.rgb *= 1.0 - 0.75 * pane * detail;
          windowNear = pane * lit;
          windowFar = 0.012 * deck;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= mix(1.0, 0.8 + 0.35 * plate, detail);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uWindowColor * mix(windowFar, windowNear, detail);`);
  };
  return material;
}

/** Engine exhaust: an additive cone that fades along its length. Base at z = 0, tip at z = length. */
function buildPlume(radius, length, color) {
  const geometry = new THREE.ConeGeometry(radius, length, 24, 1, true);
  geometry.rotateX(Math.PI / 2); // tip toward +Z
  geometry.translate(0, 0, length / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color.clone() }, uIntensity: { value: 1 }, uLength: { value: length } },
    vertexShader: /* glsl */ `
      uniform float uLength;
      varying float vT;
      void main() {
        vT = clamp(position.z / uLength, 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying float vT;
      void main() {
        float a = pow(1.0 - vT, 2.2) * uIntensity;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geometry, material);
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

  // Matte painted plating: a shiny hull turns the whole deck into a mirror for the sun. Turrets and
  // fittings use the same paint without windows.
  const paint = {
    color: hostile ? 0x3e3236 : 0x5a6069,
    windowColor: hostile ? new THREE.Color(0.8, 0.24, 0.18) : new THREE.Color(0.8, 0.64, 0.42),
  };
  const hullMaterial = plating(paint);
  const fittingMaterial = plating({ ...paint, windows: false });
  const gunMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2f35, metalness: 0.75, roughness: 0.38 });
  const lightColor = (hostile ? colors.hostile : colors.ice).clone();

  // The ship is built in two sections, bow and stern, that hold together until it breaks up. Long parts
  // are cut at the break line; everything else goes to the section its center is in.
  const breakZ = -15 + rng() * 30;
  const parts = [[], []];
  const fittings = [[], []];
  const sectionOf = (z) => (z < breakZ ? 0 : 1);
  const add = (list, geometry) => {
    geometry.computeBoundingBox();
    list[sectionOf((geometry.boundingBox.min.z + geometry.boundingBox.max.z) / 2)].push(geometry);
  };
  // A box from z0 to z1, cut in two at the break line if it crosses it.
  const longBox = (list, w, h, z0, z1, x, y, taper = false) => {
    const cuts = breakZ > z0 && breakZ < z1 ? [[z0, breakZ], [breakZ, z1]] : [[z0, z1]];
    for (const [a, b] of cuts) {
      const g = new THREE.BoxGeometry(w, h, b - a, 2, 2, Math.max(1, Math.round((b - a) / 30)));
      g.translate(x, y, (a + b) / 2);
      if (taper) {
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const t = taperAt(pos.getZ(i));
          pos.setXY(i, pos.getX(i) * t.x, pos.getY(i) * t.y);
        }
        g.computeVertexNormals();
      }
      add(list, g);
    }
  };

  // Main hull, tapered toward the bow.
  longBox(parts, HALF_WIDTH * 2, HALF_HEIGHT * 2, -HALF_LENGTH, HALF_LENGTH, 0, 0, true);

  // Upper hull, bridge tower and bridge house.
  longBox(parts, 46, 10, -80, 170, 0, HALF_HEIGHT + 5);
  const tower = new THREE.BoxGeometry(26, 24, 42);
  tower.translate(0, HALF_HEIGHT + 10 + 12, 98);
  add(parts, tower);
  const house = new THREE.BoxGeometry(36, 9, 20);
  house.translate(0, 58, 90);
  add(parts, house);
  const roof = new THREE.BoxGeometry(30, 2, 16);
  roof.translate(0, 63.5, 92);
  add(parts, roof);

  // Stepped decks around the tower base.
  const step1 = new THREE.BoxGeometry(42, 5, 60);
  step1.translate(0, HALF_HEIGHT + 12.5, 112);
  add(parts, step1);
  const step2 = new THREE.BoxGeometry(32, 5, 48);
  step2.translate(0, HALF_HEIGHT + 17.5, 114);
  add(parts, step2);

  // Ventral keel between the belly turrets. Everything from here on is fittings: no windows.
  longBox(fittings, 5, 10, -60, 60, 0, -HALF_HEIGHT - 5);

  // Side sponsons carrying the point-defense guns.
  const sponsonZ = [-40, 100];
  for (const z of sponsonZ) {
    for (const s of [-1, 1]) {
      const sponson = new THREE.BoxGeometry(8, 10, 40);
      sponson.translate(s * (sideX(z) + 3.5), 2, z);
      add(fittings, sponson);
    }
  }

  // Bow prongs that cradle the death ray emitter.
  for (const x of [-12, 12]) {
    const prong = new THREE.BoxGeometry(6, 9, 64);
    prong.translate(x, 6, -HALF_LENGTH - 22);
    add(fittings, prong);
  }

  // Engine block.
  const block = new THREE.BoxGeometry(64, 30, 14);
  block.translate(0, 0, HALF_LENGTH + 4);
  add(fittings, block);

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
    add(fittings, g);
  }
  // Masts on the bridge roof.
  for (const [x, h] of [[-8, 14], [5, 22], [11, 9], [-12, 6], [0, 30]]) {
    const mast = new THREE.CylinderGeometry(0.35, 0.5, h, 6);
    mast.translate(x, 64 + h / 2, 94);
    add(fittings, mast);
  }

  const sections = [0, 1].map((i) => {
    const section = new THREE.Group();
    section.add(new THREE.Mesh(mergeGeometries(parts[i]), hullMaterial), new THREE.Mesh(mergeGeometries(fittings[i]), fittingMaterial));
    return section;
  });

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
    const t = buildTurret(fittingMaterial, gunMaterial, upsideDown);
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

  // A rotating radar dish on the aft end of the tower.
  const radar = new THREE.Group();
  radar.position.set(0, HALF_HEIGHT + 34, 112);
  const radarMast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 8, 10), gunMaterial);
  radarMast.position.y = 4;
  radar.add(radarMast);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 8, 0, Math.PI * 2, 0, 0.7), new THREE.MeshStandardMaterial({
    color: 0x9aa0aa,
    metalness: 0.6,
    roughness: 0.45,
    side: THREE.DoubleSide,
  }));
  dish.rotation.x = Math.PI / 2;
  dish.position.set(0, 9, -1.5);
  radar.add(dish);
  object.add(radar);

  // Point-defense guns on the sponsons: small twin mounts that fire tracers at torpedoes and fighters.
  const pdMounts = [];
  for (const z of sponsonZ) {
    for (const s of [-1, 1]) {
      const mount = new THREE.Group();
      const x = s * (sideX(z) + 3.5);
      mount.position.set(x, 8.2, z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 1.6, 12), gunMaterial);
      mount.add(base);
      for (const dz of [-0.7, 0.7]) {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 5, 6), gunMaterial);
        barrel.rotation.z = (s * Math.PI) / 2.6;
        barrel.position.set(s * 2.2, 1.6, dz);
        mount.add(barrel);
      }
      object.add(mount);
      pdMounts.push({ position: new THREE.Vector3(x + s * 4, 10, z), normal: new THREE.Vector3(s, 0.6, 0).normalize() });
    }
  }

  // Torpedo tubes low in the bow, one each side, angled slightly outward.
  const torpedoTubes = [-1, 1].map((s) => {
    const x = s * (sideX(-150) + 0.4);
    const mouth = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 1.2, 14), gunMaterial);
    mouth.rotation.z = Math.PI / 2;
    mouth.position.set(x, -3, -150);
    object.add(mouth);
    return { position: new THREE.Vector3(x + s * 3, -3, -150), direction: new THREE.Vector3(s * 0.35, 0, -1).normalize() };
  });

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
  const plumes = [];
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
    const plume = buildPlume(8, 90, lightColor.clone().multiplyScalar(0.55));
    plume.position.set(x, y, HALF_LENGTH + 19.5);
    object.add(plume);
    plumes.push(plume);
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

  // Everything else so far hangs straight off the ship: hand each piece to its section. The sections sit
  // at the ship's origin, so nothing moves until they're pulled apart.
  for (const child of [...object.children]) sections[sectionOf(child.position.z)].add(child);
  object.add(...sections);

  const shield = new ShieldBubble(new THREE.Vector3(62, 72, 285), new THREE.Vector3(0, 18, -10), lightColor.clone().multiplyScalar(0.9));
  object.add(shield.mesh);

  // A random point on the deck or the side plating, in the ship's space: where fires break out.
  // `forward` keeps it on the deck ahead of the bridge, where the captain can see it.
  const hullPoint = (forward = false) => {
    const z = forward ? -HALF_LENGTH + 30 + Math.random() * 230 : (Math.random() * 2 - 1) * (HALF_LENGTH - 20);
    if (forward || Math.random() < 0.6) {
      const x = (Math.random() * 2 - 1) * sideX(z) * 0.8;
      const onUpperHull = Math.abs(x) < 22 && z > -80 && z < 170; // the raised hull amidships (see above)
      return new THREE.Vector3(x, onUpperHull ? HALF_HEIGHT + 11 : deckY(z) + 1, z);
    }
    const s = Math.random() < 0.5 ? -1 : 1;
    return new THREE.Vector3(s * (sideX(z) + 1), (Math.random() * 2 - 1) * deckY(z) * 0.7, z);
  };

  return {
    object,
    sections,
    breakZ,
    hullPoint,
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
    radar,
    plumes,
    pdMounts,
    torpedoTubes,
    shield,
    materials: [hullMaterial, fittingMaterial, gunMaterial],
  };
}

/**
 * An enemy corvette, about 90 m long: a wedge hull with engine pods, one turret and a torpedo tube
 * under the bow. Same conventions as buildCapitalShip.
 */
export function buildCorvette({ seed = 1, colors }) {
  const rng = mulberry32(seed);
  const object = new THREE.Group();
  const paint = { color: 0x40353a, windowColor: new THREE.Color(0.8, 0.24, 0.18), roughness: 0.75 };
  const hullMaterial = plating(paint);
  const fittingMaterial = plating({ ...paint, windows: false });
  const gunMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2f35, metalness: 0.75, roughness: 0.38 });
  const red = colors.hostile.clone();

  const parts = [];
  const hull = new THREE.BoxGeometry(22, 12, 90, 1, 1, 6);
  const pos = hull.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getZ(i) + 45) / 90;
    pos.setXY(i, pos.getX(i) * (0.35 + 0.65 * Math.min(1, t / 0.55)), pos.getY(i) * (0.6 + 0.4 * Math.min(1, t / 0.5)));
  }
  hull.computeVertexNormals();
  parts.push(hull);
  const dorsal = new THREE.BoxGeometry(10, 5, 34);
  dorsal.translate(0, 8.5, 12);
  parts.push(dorsal);
  const house = new THREE.BoxGeometry(7, 4, 9);
  house.translate(0, 13, 18);
  parts.push(house);
  const fin = new THREE.BoxGeometry(1.5, 9, 18);
  fin.translate(0, 15, 30);
  parts.push(fin);
  for (const s of [-1, 1]) {
    const pod = new THREE.CylinderGeometry(4, 4.5, 40, 14);
    pod.rotateX(Math.PI / 2);
    pod.translate(s * 15, -1, 20);
    parts.push(pod);
    const pylon = new THREE.BoxGeometry(8, 2, 16);
    pylon.translate(s * 10, -1, 20);
    parts.push(pylon);
  }
  for (let i = 0; i < 30; i++) {
    const z = (rng() * 2 - 1) * 38;
    const g = new THREE.BoxGeometry(1 + rng() * 3, 0.6 + rng() * 1.4, 2 + rng() * 6);
    g.translate((rng() * 2 - 1) * 5, 6 * (0.6 + 0.4 * Math.min(1, ((z + 45) / 90) / 0.5)) + 0.5, z);
    parts.push(g);
  }
  object.add(new THREE.Mesh(mergeGeometries(parts), hullMaterial));

  const turret = buildTurret(fittingMaterial, gunMaterial, false);
  turret.base.scale.setScalar(0.55);
  turret.base.position.set(0, 4.5, -16);
  turret.restYaw = 0;
  object.add(turret.base);

  const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 9, 12), gunMaterial);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, -5, -42);
  object.add(tube);

  const engines = [];
  const plumes = [];
  for (const s of [-1, 1]) {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      color: colors.flareHot.clone().multiplyScalar(1.2),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    glow.position.set(s * 15, -1, 42);
    object.add(glow);
    engines.push(glow);
    const plume = buildPlume(3.6, 34, colors.flareHot.clone().multiplyScalar(0.6));
    plume.position.set(s * 15, -1, 40.5);
    object.add(plume);
    plumes.push(plume);
  }

  const navLights = [];
  for (const [x, y, z, blink] of [[-19, -1, 20, false], [19, -1, 20, false], [0, 19.5, 30, true]]) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      color: red.clone().multiplyScalar(3),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(4);
    sprite.userData.blink = blink;
    object.add(sprite);
    navLights.push(sprite);
  }

  return {
    object,
    turrets: [turret],
    engines,
    navLights,
    plumes,
    colliders: [
      { offset: new THREE.Vector3(0, 0, -30), radius: 9 },
      { offset: new THREE.Vector3(0, 2, -5), radius: 12 },
      { offset: new THREE.Vector3(0, 0, 22), radius: 17 },
    ],
    torpedoTube: new THREE.Vector3(0, -5, -48),
    materials: [hullMaterial, gunMaterial],
  };
}
