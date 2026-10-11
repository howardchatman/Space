import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { mulberry32, randomUnit } from '../util/math.js';

// Emission nebula palettes: [glowing heart, outer clouds].
const NEBULA_COLORS = [
  [[0.2, 0.75, 0.7], [0.18, 0.3, 0.85]],
  [[0.9, 0.25, 0.45], [0.75, 0.2, 0.18]],
  [[0.95, 0.55, 0.2], [0.6, 0.22, 0.4]],
  [[0.3, 0.85, 0.5], [0.15, 0.4, 0.75]],
  [[0.7, 0.4, 0.95], [0.85, 0.3, 0.55]],
];

/**
 * Lays out one sector from a seed: where you arrive, where the enemy flagship hides, asteroid clusters,
 * derelict satellites, enemy patrols, and the sun and planet on the horizon.
 */
export function generateSector(index, seed) {
  const rng = mulberry32(seed);
  const s = CONFIG.sector;
  const R = s.radius;
  const between = (a, b) => a + rng() * (b - a);
  const pointInDisc = (radius, height) => {
    const a = rng() * Math.PI * 2;
    const r = radius * Math.sqrt(rng());
    return new THREE.Vector3(Math.cos(a) * r, between(-height, height), Math.sin(a) * r);
  };

  const start = new THREE.Vector3(0, 0, s.start);

  // The flagship hides far from where you arrive.
  let flagship;
  for (let i = 0; i < 200; i++) {
    flagship = pointInDisc(R * 0.85, 300);
    if (flagship.distanceTo(start) >= s.flagshipMinDistance) break;
  }

  // Clusters: one just ahead of the arrival point, one around the flagship, the rest scattered.
  const clusters = [
    { center: new THREE.Vector3(between(-500, 500), between(-150, 150), s.start - between(1300, 1800)), radius: 600, count: 16 },
    { center: flagship.clone().add(new THREE.Vector3(between(-400, 400), 0, between(-400, 400))), radius: 750, count: 20 },
  ];
  while (clusters.length < s.clusters) {
    const center = pointInDisc(R * 0.85, 400);
    if (center.distanceTo(start) < 1500) continue;
    clusters.push({ center, radius: between(450, 850), count: Math.round(between(10, 18)) });
  }

  const satellites = [];
  while (satellites.length < s.satellites) {
    const p = pointInDisc(R * 0.8, 350);
    if (p.distanceTo(start) > 1500 && p.distanceTo(flagship) > 1200) satellites.push(p);
  }

  // Enemy fighter patrols that wake up when something comes near.
  const patrols = [];
  const patrolCount = Math.min(2 + index, 5);
  while (patrols.length < patrolCount) {
    const p = pointInDisc(R * 0.8, 300);
    if (p.distanceTo(start) > 2600) patrols.push({ position: p, size: Math.min(2 + Math.floor(index / 2), 4) });
  }

  // Sky: a sun high-ish and a planet off to one side, never in the same patch of sky.
  const sunDirection = new THREE.Vector3();
  do {
    randomUnit(sunDirection, rng);
  } while (sunDirection.y < 0.22 || sunDirection.y > 0.62 || sunDirection.z > 0.35);
  const planetDir = new THREE.Vector3();
  do {
    randomUnit(planetDir, rng);
    planetDir.y = -Math.abs(planetDir.y) * 0.6;
    planetDir.normalize();
  } while (planetDir.angleTo(sunDirection) < 0.9 || planetDir.z > 0.3);

  // A nebula somewhere in the sky that isn't behind the sun or the planet, in this sector's colors.
  const nebulaDir = new THREE.Vector3();
  do {
    randomUnit(nebulaDir, rng);
  } while (nebulaDir.angleTo(sunDirection) < 0.9 || nebulaDir.angleTo(planetDir) < 0.7);
  const [inner, outer] = NEBULA_COLORS[Math.floor(rng() * NEBULA_COLORS.length)];

  return {
    index,
    seed,
    start,
    flagship,
    clusters,
    satellites,
    patrols,
    sunDirection,
    nebula: {
      direction: nebulaDir,
      inner: new THREE.Color(...inner),
      outer: new THREE.Color(...outer),
      size: between(0.45, 0.75),
      seed: between(0, 50),
    },
    // A rocky world nearby, or a ringed gas giant farther out.
    planet: rng() < 0.45
      ? {
        type: 'gas',
        position: planetDir.multiplyScalar(between(56000, 64000)),
        radius: between(13000, 16500),
        seed: between(1, 9),
        palette: rng(),
        tilt: between(0.25, 0.6),
        rings: rng() < 0.85,
      }
      : {
        type: 'rocky',
        position: planetDir.multiplyScalar(between(30000, 38000)),
        radius: between(8000, 11500),
        seed: between(1, 9),
      },
  };
}
