import { CONFIG } from '../config.js';
import { TAU, rand, wrapEntity } from '../util/math.js';

export class Asteroid {
  constructor(x, y, tier, heading = rand(0, TAU), speedScale = 1) {
    const def = CONFIG.asteroid[tier];
    this.x = x;
    this.y = y;
    this.tier = tier;
    this.radius = def.radius * rand(0.9, 1.1);
    this.hp = def.hp;
    this.speedScale = speedScale;
    const speed = rand(def.speed[0], def.speed[1]) * speedScale;
    this.vx = Math.cos(heading) * speed;
    this.vy = Math.sin(heading) * speed;
    this.rot = rand(0, TAU);
    this.spin = rand(-1, 1) * (1.4 / tier);
    this.flash = 0;
    this.dead = false;

    // A jagged outline, built once at this rock's size.
    const r = this.radius;
    const points = 8 + tier * 2;
    this.outline = new Path2D();
    for (let i = 0; i < points; i++) {
      const a = (i / points) * TAU + rand(-0.15, 0.15);
      const d = r * rand(0.72, 1.05);
      if (i === 0) this.outline.moveTo(Math.cos(a) * d, Math.sin(a) * d);
      else this.outline.lineTo(Math.cos(a) * d, Math.sin(a) * d);
    }
    this.outline.closePath();

    this.craters = new Path2D();
    for (let i = 1; i < tier; i++) {
      const cx = rand(-0.4, 0.4) * r;
      const cy = rand(-0.4, 0.4) * r;
      const cr = rand(0.12, 0.22) * r;
      this.craters.moveTo(cx + cr, cy);
      this.craters.arc(cx, cy, cr, 0, TAU);
    }
  }

  update(dt, width, height) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += this.spin * dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    wrapEntity(this, width, height);
  }

  draw(ctx, p) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.fillStyle = p.rock;
    ctx.fill(this.outline);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = p.rockEdge;
    ctx.stroke(this.outline);
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.stroke(this.craters);
    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.7;
      ctx.fillStyle = p.hull;
      ctx.fill(this.outline);
    }
    ctx.restore();
  }
}
