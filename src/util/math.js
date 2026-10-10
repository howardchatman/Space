export const TAU = Math.PI * 2;

export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const pick = (items) => items[Math.floor(Math.random() * items.length)];
export const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

/** Frame-rate independent smoothing factor: how far to move toward a target this frame. */
export const smooth = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Small deterministic PRNG, so procedural content can be reproduced from a seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniformly random unit vector, written into `out` ({x, y, z} or THREE.Vector3). */
export function randomUnit(out, rng = Math.random) {
  const z = rng() * 2 - 1;
  const a = rng() * TAU;
  const r = Math.sqrt(1 - z * z);
  out.x = Math.cos(a) * r;
  out.y = Math.sin(a) * r;
  out.z = z;
  return out;
}
