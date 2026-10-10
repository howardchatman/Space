import { CONFIG } from '../config.js';
import { TAU, angleDiff, clamp } from '../util/math.js';

/** A fresh copy of the ship's upgradeable stats. Upgrades mutate this object. */
export function baseStats() {
  const s = CONFIG.ship;
  return {
    turnRate: s.turnRate,
    thrust: s.thrust,
    maxSpeed: s.maxSpeed,
    fireInterval: s.fireInterval,
    bulletSpeed: s.bulletSpeed,
    bulletLife: s.bulletLife,
    bulletDamage: s.bulletDamage,
    guns: 1,
    maxShield: s.maxShield,
    regen: 0,
    magnetRange: s.magnetRange,
    boostCooldown: s.boostCooldown,
  };
}

export class Ship {
  constructor(x, y, stats) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = -Math.PI / 2;
    this.radius = CONFIG.ship.radius;
    this.stats = stats;
    this.shield = stats.maxShield;
    this.fireTimer = 0;
    this.boostTimer = 0;
    this.boosting = 0; // seconds left in the current boost burst
    this.invulnerable = 2; // spawn grace
    this.blink = 0; // seconds left of the hit flicker
    this.overdrive = 0;
    this.thrusting = 0;
    this.dead = false;
  }

  update(dt, controls) {
    const s = this.stats;
    let thrust = controls.thrust;

    if (controls.aim !== null) {
      const diff = angleDiff(this.angle, controls.aim);
      const step = s.turnRate * dt;
      this.angle += clamp(diff, -step, step);
      // Only push once the nose is roughly where the thumb points.
      thrust *= Math.max(0, Math.cos(diff));
    } else {
      this.angle += controls.turn * s.turnRate * dt;
    }

    this.thrusting = thrust;
    this.vx += Math.cos(this.angle) * s.thrust * thrust * dt;
    this.vy += Math.sin(this.angle) * s.thrust * thrust * dt;

    const damp = Math.pow(1 - CONFIG.ship.drag, dt);
    this.vx *= damp;
    this.vy *= damp;

    // Ease back under the speed cap after a boost instead of snapping to it.
    const cap = s.maxSpeed * (this.boosting > 0 ? 2.2 : 1);
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > cap) {
      const target = Math.max(cap, speed - 700 * dt);
      this.vx *= target / speed;
      this.vy *= target / speed;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.fireTimer -= dt;
    this.boostTimer -= dt;
    this.boosting -= dt;
    this.invulnerable -= dt;
    this.blink -= dt;
    this.overdrive -= dt;
    if (s.regen > 0) this.shield = Math.min(s.maxShield, this.shield + s.regen * dt);
  }

  /** 0 right after a boost, 1 when the next boost is ready. */
  get boostCharge() {
    return clamp(1 - this.boostTimer / this.stats.boostCooldown, 0, 1);
  }

  draw(ctx, p, time) {
    if (this.blink > 0 && Math.floor(time * 18) % 2 === 0) return;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const burn = this.boosting > 0 ? 1.6 : this.thrusting;
    if (burn > 0.05) {
      const len = 8 + 16 * burn + Math.random() * 5;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = p.flareHot;
      ctx.beginPath();
      ctx.moveTo(-6, -4.5);
      ctx.lineTo(-6 - len, 0);
      ctx.lineTo(-6, 4.5);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = p.flare;
      ctx.beginPath();
      ctx.moveTo(-6, -2.5);
      ctx.lineTo(-6 - len * 0.55, 0);
      ctx.lineTo(-6, 2.5);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.beginPath();
    ctx.moveTo(17, 0);
    ctx.lineTo(-9, -11);
    ctx.lineTo(-5, -4);
    ctx.lineTo(-7, 0);
    ctx.lineTo(-5, 4);
    ctx.lineTo(-9, 11);
    ctx.closePath();
    ctx.fillStyle = p.voidRaised;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = p.hull;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(1, -2.5);
    ctx.lineTo(1, 2.5);
    ctx.closePath();
    ctx.fillStyle = p.ice;
    ctx.fill();
    ctx.restore();

    if (this.invulnerable > 0) {
      ctx.globalAlpha = clamp(this.invulnerable, 0, 1) * 0.5;
      ctx.strokeStyle = p.ice;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 22, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
