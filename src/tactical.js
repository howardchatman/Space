import { TAU } from './util/math.js';

/**
 * The tactical map: a top-down plot of the sector. Unexplored space is shaded; known contacts,
 * your warship, scouts and the helm's course are drawn on top. Clicking sets a course.
 */
export class TacticalMap {
  constructor(canvas, palette) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.p = palette;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
  }

  resize(width, height, dpr) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  /** Map scale: the sector circle fills most of the shorter side. */
  #layout(radius) {
    const size = Math.min(this.width, this.height);
    return { cx: this.width / 2, cy: this.height / 2 + 10, k: (size * 0.43) / radius };
  }

  /** World x/z under a canvas point (CSS px). */
  toWorld(x, y, radius) {
    const { cx, cy, k } = this.#layout(radius);
    return { x: (x - cx) / k, z: (y - cy) / k };
  }

  draw(view) {
    const { ctx, p } = this;
    const { radius, fog } = view;
    const { cx, cy, k } = this.#layout(radius);
    const X = (v) => cx + v.x * k;
    const Y = (v) => cy + v.z * k;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = p.mapBg;
    ctx.fillRect(0, 0, this.width, this.height);

    // Explored space is clear; unexplored is shaded, inside the sector circle only.
    const cell = (fog.extent * 2) / fog.size;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * k, 0, TAU);
    ctx.clip();
    ctx.fillStyle = p.mapFog;
    for (let j = 0; j < fog.size; j++) {
      for (let i = 0; i < fog.size; i++) {
        if (fog.cells[j * fog.size + i]) continue;
        const wx = -fog.extent + i * cell;
        const wz = -fog.extent + j * cell;
        ctx.fillRect(cx + wx * k, cy + wz * k, cell * k + 0.5, cell * k + 0.5);
      }
    }
    ctx.restore();

    // Range rings every 2 km and the sector edge.
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 1;
    for (let r = 2000; r < radius; r += 2000) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * k, 0, TAU);
      ctx.stroke();
    }
    ctx.strokeStyle = p.dim;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * k, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // Rocks in explored space.
    ctx.fillStyle = p.dim;
    ctx.globalAlpha = 0.55;
    for (const r of view.rocks) {
      const s = Math.max(1.2, r.radius * k * 0.8);
      ctx.beginPath();
      ctx.arc(X(r.position), Y(r.position), s, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Sensor ranges.
    ctx.strokeStyle = p.ice;
    ctx.globalAlpha = 0.25;
    for (const s of view.sensors) {
      ctx.beginPath();
      ctx.arc(X(s.position), Y(s.position), s.range * k, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Course line.
    if (view.waypoint) {
      ctx.strokeStyle = p.flare;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(X(view.ship.position), Y(view.ship.position));
      ctx.lineTo(X(view.waypoint), Y(view.waypoint));
      ctx.stroke();
      ctx.setLineDash([]);
      this.#diamond(X(view.waypoint), Y(view.waypoint), 7, p.flare, false);
    }

    ctx.font = `600 11px ${p.fontMono}`;
    ctx.textAlign = 'left';
    for (const c of view.contacts) {
      const x = X(c.position);
      const y = Y(c.position);
      if (c.kind === 'flagship') {
        this.#diamond(x, y, 9, p.hostile, true);
        ctx.fillStyle = p.hostile;
        ctx.fillText(c.stale ? 'FLAGSHIP (LAST SEEN)' : 'FLAGSHIP', x + 13, y + 4);
      } else if (c.kind === 'corvette') {
        this.#diamond(x, y, 6, p.hostile, false);
        ctx.fillStyle = p.hostile;
        ctx.fillText('CORVETTE', x + 10, y + 4);
      } else if (c.kind === 'torpedo' || c.kind === 'ourTorpedo') {
        ctx.fillStyle = c.kind === 'torpedo' ? p.hostile : p.ice;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, TAU);
        ctx.fill();
      } else if (c.kind === 'fighter') {
        ctx.fillStyle = p.hostile;
        ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
      } else if (c.kind === 'satellite') {
        ctx.strokeStyle = c.salvaged ? p.dim : p.flare;
        ctx.strokeRect(x - 4, y - 4, 8, 8);
      } else if (c.kind === 'energy') {
        ctx.fillStyle = p.energy;
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
    }

    // Where each scout is headed.
    ctx.strokeStyle = p.ice;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([2, 5]);
    for (const s of view.scouts) {
      if (!s.route?.length || s.state !== 'patrol') continue;
      ctx.beginPath();
      ctx.moveTo(X(s.position), Y(s.position));
      for (const r of s.route) ctx.lineTo(X(r), Y(r));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    for (const s of view.scouts) {
      ctx.fillStyle = p.ice;
      ctx.beginPath();
      ctx.arc(X(s.position), Y(s.position), 3.5, 0, TAU);
      ctx.fill();
      ctx.fillText(s.name.toUpperCase(), X(s.position) + 7, Y(s.position) + 4);
    }

    // Your warship: a heading triangle.
    const sx = X(view.ship.position);
    const sy = Y(view.ship.position);
    const h = view.ship.heading;
    const fx = -Math.sin(h);
    const fz = -Math.cos(h);
    ctx.fillStyle = p.hull;
    ctx.beginPath();
    ctx.moveTo(sx + fx * 12, sy + fz * 12);
    ctx.lineTo(sx - fx * 7 - fz * 6, sy - fz * 7 + fx * 6);
    ctx.lineTo(sx - fx * 7 + fz * 6, sy - fz * 7 - fx * 6);
    ctx.closePath();
    ctx.fill();
  }

  #diamond(x, y, r, color, fill) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }
}
