import { TAU, rand } from '../util/math.js';

const LIMIT = 900;

/** Sparks (short glowing streaks) and shockwave rings. Draw with 'lighter' compositing. */
export class Particles {
  constructor() {
    this.sparks = [];
    this.rings = [];
  }

  clear() {
    this.sparks.length = 0;
    this.rings.length = 0;
  }

  emit(x, y, {
    count = 8,
    color,
    speed = [40, 160],
    life = [0.3, 0.7],
    size = [1, 2.5],
    angle = 0,
    spread = TAU,
    vx = 0,
    vy = 0,
    drag = 2.2,
  }) {
    for (let i = 0; i < count && this.sparks.length < LIMIT; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const s = rand(speed[0], speed[1]);
      const l = rand(life[0], life[1]);
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * s + vx,
        vy: Math.sin(a) * s + vy,
        life: l,
        max: l,
        size: rand(size[0], size[1]),
        color,
        drag,
      });
    }
  }

  ring(x, y, { radius = 40, life = 0.45, color, width = 2 }) {
    this.rings.push({ x, y, radius, life, max: life, color, width });
  }

  update(dt) {
    let n = 0;
    for (const p of this.sparks) {
      p.life -= dt;
      if (p.life <= 0) continue;
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      this.sparks[n++] = p;
    }
    this.sparks.length = n;

    n = 0;
    for (const r of this.rings) {
      r.life -= dt;
      if (r.life > 0) this.rings[n++] = r;
    }
    this.rings.length = n;
  }

  draw(ctx) {
    ctx.lineCap = 'round';
    for (const p of this.sparks) {
      const tx = p.vx * 0.035;
      const ty = p.vy * 0.035;
      ctx.globalAlpha = p.life / p.max;
      if (Math.abs(tx) + Math.abs(ty) < 0.5) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        continue;
      }
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - tx, p.y - ty);
      ctx.stroke();
    }

    for (const r of this.rings) {
      const t = r.life / r.max; // 1 → 0
      const grown = 1 - t * t; // ease out
      ctx.globalAlpha = t;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(0.1, r.radius * grown), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
