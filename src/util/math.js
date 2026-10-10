export const TAU = Math.PI * 2;

export const rand = (min, max) => min + Math.random() * (max - min);
export const pick = (items) => items[Math.floor(Math.random() * items.length)];
export const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

/** Signed shortest turn from one angle to another, in the range [-PI, PI]. */
export function angleDiff(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function circlesOverlap(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = a.radius + b.radius;
  return dx * dx + dy * dy < r * r;
}

/** Wraps an entity around the field edges once it has fully left the screen. */
export function wrapEntity(e, width, height) {
  const m = e.radius;
  if (e.x < -m) e.x += width + 2 * m;
  else if (e.x > width + m) e.x -= width + 2 * m;
  if (e.y < -m) e.y += height + 2 * m;
  else if (e.y > height + m) e.y -= height + 2 * m;
}
