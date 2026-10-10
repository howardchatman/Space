import { CONFIG } from '../config.js';
import { TAU, rand, wrapEntity } from '../util/math.js';

export const PICKUP_KINDS = ['shield', 'overdrive'];

export class Pickup {
  constructor(x, y, kind) {
    const heading = rand(0, TAU);
    const speed = rand(20, 50);
    this.x = x;
    this.y = y;
    this.vx = Math.cos(heading) * speed;
    this.vy = Math.sin(heading) * speed;
    this.kind = kind;
    this.radius = 12;
    this.life = CONFIG.pickups.life;
    this.spin = rand(0, TAU);
    this.dead = false;
  }

  update(dt, ship, width, height) {
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    this.spin += dt * 1.5;

    if (ship && !ship.dead) {
      const dx = ship.x - this.x;
      const dy = ship.y - this.y;
      const dist = Math.hypot(dx, dy) || 1;
      const range = ship.stats.magnetRange;
      if (dist < range) {
        const pull = 200 + 900 * (1 - dist / range);
        this.vx += (dx / dist) * pull * dt;
        this.vy += (dy / dist) * pull * dt;
      }
    }

    const damp = Math.exp(-1.5 * dt);
    this.vx *= damp;
    this.vy *= damp;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    wrapEntity(this, width, height);
  }

  draw(ctx, p, time) {
    // Blink during the last three seconds.
    if (this.life < 3 && Math.floor(time * 8) % 2 === 0) return;
    const color = this.kind === 'shield' ? p.ice : p.flareHot;
    const r = this.radius;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    ctx.save();
    ctx.rotate(this.spin);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.15;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (this.kind === 'shield') {
      ctx.moveTo(-5, 0);
      ctx.lineTo(5, 0);
      ctx.moveTo(0, -5);
      ctx.lineTo(0, 5);
    } else {
      ctx.moveTo(-5, -4);
      ctx.lineTo(-1, 0);
      ctx.lineTo(-5, 4);
      ctx.moveTo(1, -4);
      ctx.lineTo(5, 0);
      ctx.lineTo(1, 4);
    }
    ctx.stroke();
    ctx.restore();
  }
}
