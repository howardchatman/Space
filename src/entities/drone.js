import { CONFIG } from '../config.js';
import { TAU, clamp, rand } from '../util/math.js';

const AIM_RANGE = 560;
const CHARGE_TELL = 0.35; // the core flares this long before a shot

/** A hostile drone that circles the ship at a standoff distance and fires leading shots. */
export class Drone {
  constructor(x, y, wave) {
    const d = CONFIG.drone;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = d.radius;
    this.hp = d.hp + Math.floor((wave - 1) / 3);
    this.maxSpeed = d.maxSpeed * Math.min(1 + (wave - 1) * 0.04, 1.5);
    this.fireScale = Math.max(0.55, 1 - (wave - 1) * 0.05);
    this.fireTimer = rand(d.fireInterval[0], d.fireInterval[1]) + 0.6;
    this.orbit = rand(0, TAU);
    this.orbitDir = Math.random() < 0.5 ? -1 : 1;
    this.standoff = rand(150, 230);
    this.warp = d.warpTime;
    this.heading = 0;
    this.flash = 0;
    this.dead = false;
  }

  get active() {
    return this.warp <= 0;
  }

  /** Moves the drone. Returns a shot { x, y, vx, vy } when it fires, otherwise null. */
  update(dt, ship, width, height) {
    this.flash = Math.max(0, this.flash - dt);
    if (this.warp > 0) {
      this.warp -= dt;
      return null;
    }

    const d = CONFIG.drone;
    const live = ship && !ship.dead;
    let tx = width / 2;
    let ty = height / 2;
    if (live) {
      this.orbit += this.orbitDir * 0.7 * dt;
      tx = ship.x + Math.cos(this.orbit) * this.standoff;
      ty = ship.y + Math.sin(this.orbit) * this.standoff;
    }

    // Steer toward the orbit point, slowing on arrival.
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    const want = Math.min(this.maxSpeed, dist * 2.2);
    const ax = (dx / dist) * want - this.vx;
    const ay = (dy / dist) * want - this.vy;
    const k = Math.min(1, (d.accel * dt) / (Math.hypot(ax, ay) || 1));
    this.vx += ax * k;
    this.vy += ay * k;
    this.x = clamp(this.x + this.vx * dt, this.radius, width - this.radius);
    this.y = clamp(this.y + this.vy * dt, this.radius, height - this.radius);

    if (!live) {
      this.heading = Math.atan2(this.vy, this.vx);
      return null;
    }
    this.heading = Math.atan2(ship.y - this.y, ship.x - this.x);

    this.fireTimer -= dt;
    if (this.fireTimer > 0) return null;
    this.fireTimer = rand(d.fireInterval[0], d.fireInterval[1]) * this.fireScale;

    const sx = ship.x - this.x;
    const sy = ship.y - this.y;
    const range = Math.hypot(sx, sy);
    if (range > AIM_RANGE) return null;
    const lead = (range / d.bulletSpeed) * 0.6;
    const aimX = sx + ship.vx * lead;
    const aimY = sy + ship.vy * lead;
    const len = Math.hypot(aimX, aimY) || 1;
    return {
      x: this.x + (aimX / len) * this.radius,
      y: this.y + (aimY / len) * this.radius,
      vx: (aimX / len) * d.bulletSpeed,
      vy: (aimY / len) * d.bulletSpeed,
    };
  }

  draw(ctx, p, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.strokeStyle = p.hostile;

    if (this.warp > 0) {
      const t = this.warp / CONFIG.drone.warpTime; // 1 → 0 as it arrives
      ctx.globalAlpha = 1 - t * 0.6;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + t * 40, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + t * 18, time * 3, time * 3 + TAU);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const r = this.radius;
    ctx.rotate(this.heading);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(0, -r * 0.8);
    ctx.lineTo(-r * 0.7, 0);
    ctx.lineTo(0, r * 0.8);
    ctx.closePath();
    ctx.fillStyle = p.voidRaised;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    if (this.flash > 0) {
      ctx.globalAlpha = Math.min(1, this.flash * 6);
      ctx.fillStyle = p.hull;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.6);
    ctx.lineTo(-r * 1.1, -r);
    ctx.moveTo(-r * 0.2, r * 0.6);
    ctx.lineTo(-r * 1.1, r);
    ctx.stroke();

    const charging = this.fireTimer < CHARGE_TELL;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = charging ? 1 : 0.6 + 0.4 * Math.sin(time * 8 + this.orbit);
    ctx.fillStyle = p.hostile;
    ctx.beginPath();
    ctx.arc(r * 0.1, 0, charging ? 4.8 : 3.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
