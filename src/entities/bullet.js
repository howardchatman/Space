import { wrapEntity } from '../util/math.js';

export class Bullet {
  constructor(x, y, vx, vy, { life, damage, radius, hostile = false }) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.damage = damage;
    this.radius = radius;
    this.hostile = hostile;
    this.dead = false;
  }

  update(dt, width, height) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    if (!this.hostile) {
      wrapEntity(this, width, height);
    } else if (this.x < -20 || this.x > width + 20 || this.y < -20 || this.y > height + 20) {
      // Enemy fire doesn't wrap, so it can't hit you from behind the screen edge.
      this.dead = true;
    }
  }
}

/** Player shots: short glowing streaks drawn in one batch. Call with 'lighter' compositing. */
export function drawShots(ctx, shots, color) {
  if (shots.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const b of shots) {
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.022, b.y - b.vy * 0.022);
  }
  ctx.lineWidth = 7;
  ctx.globalAlpha = 0.3;
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 1;
  ctx.stroke();
}

/** Enemy shots: glowing orbs drawn in one batch. Call with 'lighter' compositing. */
export function drawOrbs(ctx, shots, color) {
  if (shots.length === 0) return;
  ctx.fillStyle = color;
  for (const [size, alpha] of [[9, 0.25], [4, 1]]) {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (const b of shots) {
      ctx.moveTo(b.x + size, b.y);
      ctx.arc(b.x, b.y, size, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
