import * as THREE from 'three';
import { TAU, clamp } from './util/math.js';

const RADAR_RANGE = 1600;

/**
 * The heads-up display drawn over the 3D view on a 2D canvas: crosshair, flight-path marker,
 * target brackets with a lead pip, off-screen arrows, radar and hit indicators.
 */
export class Hud {
  constructor(canvas, palette) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.p = palette;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  resize(width, height, dpr) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Screen position of a world point, and whether it is in front of the camera. */
  project(camera, world) {
    const v = this._v.copy(world).applyMatrix4(camera.matrixWorldInverse);
    const front = v.z < 0;
    v.applyMatrix4(camera.projectionMatrix);
    return {
      x: (v.x * 0.5 + 0.5) * this.width,
      y: (-v.y * 0.5 + 0.5) * this.height,
      front,
      // Direction on screen even for points behind the camera.
      dx: front ? v.x : -v.x,
      dy: front ? -v.y : v.y,
    };
  }

  draw(view) {
    this.clear();
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const { camera, player } = view;
    camera.updateMatrixWorld();
    // Pixels per meter at 1 m: converts world sizes to screen sizes.
    this.focal = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));

    this.#flightPath(camera, player);
    this.#pickups(camera, view.pickups);
    const target = this.#targets(camera, player, view.drones, view.boltSpeed);
    this.#crosshair(view.hitMarker, target);
    this.#popups(camera, view.popups);
    this.#damage(camera, player, view.damage);
    this.#radar(player, view.drones, view.pickups, view.rocks, view.touch);
    if (view.cursor) this.#cursor(view.cursor);
    if (view.stick) this.#stick(view.stick);
    if (view.boundary) this.#boundary(camera);
  }

  /**
   * The captain's overlay on the bridge: labelled brackets on every known contact, a lock box on the
   * selected target, off-screen arrows, the helm's course marker and the death ray's firing arc.
   */
  drawBridge(view) {
    this.clear();
    const { ctx, p } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const { camera } = view;
    camera.updateMatrixWorld();
    this.focal = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const cx = this.width / 2;
    const cy = this.height / 2;
    const edge = Math.min(this.width, this.height) * 0.42;

    // Where the death ray can reach: a cone around the bow.
    if (view.rayArc) {
      const center = this.project(camera, view.rayArc.center);
      if (center.front) {
        const r = this.focal * Math.tan(view.rayArc.angle);
        ctx.strokeStyle = p.ice;
        ctx.globalAlpha = view.rayArc.ready ? 0.5 : 0.2;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 7]);
        ctx.beginPath();
        ctx.arc(center.x, center.y, r, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `600 10px ${p.fontMono}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = p.ice;
        ctx.fillText('DEATH RAY ARC', center.x, center.y - r - 6);
      }
    }

    ctx.font = `600 11px ${p.fontMono}`;
    ctx.textAlign = 'center';
    for (const c of view.contacts) {
      const s = this.project(camera, c.position);
      const dist = c.position.distanceTo(camera.position);
      const color = c.hostile ? p.hostile : c.kind === 'scout' ? p.ice : c.kind === 'satellite' ? p.flare : p.dim;
      const onScreen = s.front && s.x > 0 && s.x < this.width && s.y > 0 && s.y < this.height;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.95;

      if (!onScreen) {
        if (!c.hostile && !c.selected) continue;
        const a = Math.atan2(s.dy, s.dx);
        const x = cx + Math.cos(a) * edge;
        const y = cy + Math.sin(a) * edge;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 11, y + Math.sin(a) * 11);
        ctx.lineTo(x + Math.cos(a + 2.5) * 8, y + Math.sin(a + 2.5) * 8);
        ctx.lineTo(x + Math.cos(a - 2.5) * 8, y + Math.sin(a - 2.5) * 8);
        ctx.closePath();
        ctx.fill();
        if (c.selected) ctx.fillText(c.label, x - Math.cos(a) * 18, y - Math.sin(a) * 18);
        continue;
      }

      if (c.kind === 'scout') {
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 6, 0, TAU);
        ctx.stroke();
        ctx.fillText(c.label, s.x, s.y + 20);
        continue;
      }

      const size = Math.max(12, ((c.radius * this.focal) / Math.max(dist, 1)) * 1.15);
      const k = size * 0.4;
      ctx.lineWidth = c.selected ? 2.2 : 1.4;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = s.x + sx * size;
        const y = s.y + sy * size;
        ctx.moveTo(x - sx * k, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y - sy * k);
      }
      ctx.stroke();
      ctx.fillText(`${c.label} · ${formatDistance(dist)}`, s.x, s.y + size + 15);
      if (c.selected) {
        ctx.fillText('TARGET', s.x, s.y - size - 8);
        if (c.hull != null) {
          const w = Math.max(40, size * 1.6);
          ctx.globalAlpha = 0.35;
          ctx.fillRect(s.x - w / 2, s.y + size + 22, w, 3);
          ctx.globalAlpha = 1;
          ctx.fillRect(s.x - w / 2, s.y + size + 22, w * c.hull, 3);
        }
      }
    }

    if (view.waypoint) {
      const s = this.project(camera, view.waypoint);
      if (s.front) {
        ctx.strokeStyle = p.flare;
        ctx.fillStyle = p.flare;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - 9);
        ctx.lineTo(s.x + 9, s.y);
        ctx.lineTo(s.x, s.y + 9);
        ctx.lineTo(s.x - 9, s.y);
        ctx.closePath();
        ctx.stroke();
        ctx.fillText(`COURSE · ${formatDistance(view.waypoint.distanceTo(camera.position))}`, s.x, s.y + 24);
      }
    }

    // A quiet center mark: where a click picks a target.
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = p.hull;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx - 4, cy);
    ctx.moveTo(cx + 4, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy - 4);
    ctx.moveTo(cx, cy + 4);
    ctx.lineTo(cx, cy + 10);
    ctx.stroke();
    ctx.globalAlpha = 1;

    this.#damage(camera, view.ship, view.damage);
  }

  /** The contact whose bracket is nearest a screen point, within `slop` px. */
  pick(camera, contacts, x, y, slop = 60) {
    camera.updateMatrixWorld();
    let best = null;
    let bestD = slop;
    for (const c of contacts) {
      const s = this.project(camera, c.position);
      if (!s.front) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  #crosshair(hitMarker, target) {
    const { ctx, p } = this;
    const cx = this.width / 2;
    const cy = this.height / 2;
    ctx.strokeStyle = target ? p.hostile : p.hull;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(cx + dx * 7, cy + dy * 7);
      ctx.lineTo(cx + dx * 15, cy + dy * 15);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, TAU);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();

    if (hitMarker > 0) {
      ctx.globalAlpha = Math.min(1, hitMarker * 6);
      ctx.strokeStyle = p.flare;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        ctx.moveTo(cx + dx * 9, cy + dy * 9);
        ctx.lineTo(cx + dx * 16, cy + dy * 16);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  #flightPath(camera, player) {
    if (!player || player.dead || player.speed < 8) return;
    const point = this._v.copy(player.velocity).normalize().multiplyScalar(1000).add(player.position);
    const s = this.project(camera, point);
    if (!s.front) return;
    const { ctx, p } = this;
    ctx.strokeStyle = p.ice;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 6, 0, TAU);
    ctx.moveTo(s.x - 6, s.y);
    ctx.lineTo(s.x - 14, s.y);
    ctx.moveTo(s.x + 6, s.y);
    ctx.lineTo(s.x + 14, s.y);
    ctx.moveTo(s.x, s.y - 6);
    ctx.lineTo(s.x, s.y - 11);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Brackets every hostile; the one nearest the crosshair gets a lead pip. Returns that target. */
  #targets(camera, player, drones, boltSpeed) {
    const { ctx, p } = this;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const edge = Math.min(this.width, this.height) * 0.4;
    let best = null;
    let bestOff = Infinity;

    ctx.font = `600 11px ${p.fontMono}`;
    ctx.textAlign = 'center';
    for (const d of drones) {
      if (!d.active || d.dead) continue;
      const s = this.project(camera, d.position);
      const dist = player ? d.position.distanceTo(player.position) : 0;
      const onScreen = s.front && s.x > 0 && s.x < this.width && s.y > 0 && s.y < this.height;
      ctx.strokeStyle = p.hostile;
      ctx.fillStyle = p.hostile;

      if (!onScreen) {
        // Arrow on a ring around the crosshair, pointing toward the hostile.
        const a = Math.atan2(s.dy, s.dx);
        const x = cx + Math.cos(a) * edge;
        const y = cy + Math.sin(a) * edge;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
        ctx.lineTo(x + Math.cos(a + 2.5) * 8, y + Math.sin(a + 2.5) * 8);
        ctx.lineTo(x + Math.cos(a - 2.5) * 8, y + Math.sin(a - 2.5) * 8);
        ctx.closePath();
        ctx.fill();
        continue;
      }

      const size = Math.max(14, (d.radius * this.focal) / Math.max(dist, 1) * 1.5);
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const c = size * 0.45;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = s.x + sx * size;
        const y = s.y + sy * size;
        ctx.moveTo(x - sx * c, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y - sy * c);
      }
      ctx.stroke();
      ctx.fillText(formatDistance(dist), s.x, s.y + size + 14);

      const off = Math.hypot(s.x - cx, s.y - cy);
      if (off < bestOff) {
        bestOff = off;
        best = { drone: d, screen: s, size };
      }
    }

    // Lead pip: where to aim so your bolts meet the target.
    if (best && player && !player.dead && bestOff < Math.min(this.width, this.height) * 0.35) {
      const d = best.drone;
      const rel = new THREE.Vector3().subVectors(d.velocity, player.velocity);
      let t = d.position.distanceTo(player.position) / boltSpeed;
      const lead = new THREE.Vector3();
      for (let i = 0; i < 2; i++) {
        lead.copy(d.position).addScaledVector(rel, t);
        t = lead.distanceTo(player.position) / boltSpeed;
      }
      lead.copy(d.position).addScaledVector(rel, t);
      const s = this.project(camera, lead);
      if (s.front) {
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = p.flare;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - 7);
        ctx.lineTo(s.x + 7, s.y);
        ctx.lineTo(s.x, s.y + 7);
        ctx.lineTo(s.x - 7, s.y);
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(best.screen.x, best.screen.y);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }
      // Hull integrity pips above the locked target.
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = p.hostile;
      const pips = Math.max(0, Math.ceil(d.hp));
      for (let i = 0; i < pips; i++) {
        ctx.fillRect(best.screen.x - pips * 4 + i * 8, best.screen.y - best.size - 10, 6, 3);
      }
    }
    ctx.globalAlpha = 1;
    return best && bestOff < 40 ? best : null;
  }

  #pickups(camera, pickups) {
    const { ctx, p } = this;
    for (const item of pickups) {
      const s = this.project(camera, item.position);
      if (!s.front) continue;
      ctx.strokeStyle = item.kind === 'shield' ? p.ice : p.flareHot;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 11);
      ctx.lineTo(s.x + 11, s.y);
      ctx.lineTo(s.x, s.y + 11);
      ctx.lineTo(s.x - 11, s.y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  #popups(camera, popups) {
    const { ctx, p } = this;
    ctx.font = `600 13px ${p.fontMono}`;
    ctx.textAlign = 'center';
    for (const pop of popups) {
      const s = this.project(camera, pop.position);
      if (!s.front) continue;
      const t = 1 - pop.life / pop.max;
      ctx.globalAlpha = Math.min(1, (pop.life / pop.max) * 2);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, s.x, s.y - 18 - t * 24);
    }
    ctx.globalAlpha = 1;
  }

  /** A red arc around the crosshair pointing toward whatever just hit you. */
  #damage(camera, player, damage) {
    if (!damage || damage.life <= 0 || !player) return;
    const s = this.project(camera, damage.from);
    const a = Math.atan2(s.dy, s.dx);
    const { ctx, p } = this;
    const r = Math.min(this.width, this.height) * 0.16;
    ctx.globalAlpha = Math.min(1, damage.life * 1.5);
    ctx.strokeStyle = p.hostile;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(this.width / 2, this.height / 2, r, a - 0.35, a + 0.35);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Top-down scanner in the ship's frame. Stalks show whether a contact is above or below you. */
  #radar(player, drones, pickups, rocks, touch) {
    if (!player) return;
    const { ctx, p } = this;
    const R = clamp(Math.min(this.width, this.height) * 0.11, 46, 78);
    const cx = this.width / 2;
    // On narrow touch screens the Fire and Boost buttons own the bottom edge, so lift the scanner.
    const cy = this.height - R - (touch && this.width < 600 ? 150 : 18);
    const inv = this._q.copy(player.quaternion).invert();

    ctx.globalAlpha = 0.55;
    ctx.fillStyle = p.panel;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R, R * 0.62, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.5, R * 0.31, 0, 0, TAU);
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R * 0.62);
    ctx.lineTo(cx, cy + R * 0.62);
    ctx.stroke();

    const plot = (pos, color, size, range = RADAR_RANGE, stalk = true) => {
      const local = this._v.subVectors(pos, player.position).applyQuaternion(inv);
      const dist = local.length();
      if (dist > range) return;
      const k = Math.sqrt(dist / RADAR_RANGE) / Math.max(dist, 1e-3);
      const x = cx + local.x * k * R;
      const y = cy + local.z * k * R * 0.62;
      const lift = -local.y * k * R * 0.6;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      if (!stalk) {
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        return;
      }
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + lift);
      ctx.stroke();
      ctx.fillRect(x - size / 2, y + lift - size / 2, size, size);
    };

    ctx.globalAlpha = 0.4;
    for (const rock of rocks) {
      if (rock.size !== 'small') plot(rock.position, p.dim, 2, 700, false);
    }
    ctx.globalAlpha = 0.95;
    for (const item of pickups) plot(item.position, item.kind === 'shield' ? p.ice : p.flareHot, 4);
    for (const d of drones) if (d.active && !d.dead) plot(d.position, p.hostile, 5);
    ctx.globalAlpha = 1;
  }

  /** Steering indicator when the mouse isn't captured: a line from center to the cursor. */
  #cursor(cursor) {
    const { ctx, p } = this;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const r = Math.min(this.width, this.height) / 2;
    const x = cx + cursor.x * r;
    const y = cy + cursor.y * r;
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = p.flare;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  #stick(stick) {
    const { ctx, p } = this;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = p.dim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(stick.ox, stick.oy, stick.radius, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = p.flare;
    ctx.beginPath();
    ctx.arc(stick.x, stick.y, 22, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  #boundary(camera) {
    const { ctx, p } = this;
    const s = this.project(camera, new THREE.Vector3(0, 0, 0));
    const a = Math.atan2(s.dy, s.dx);
    const cx = this.width / 2;
    const cy = this.height / 2;
    const r = Math.min(this.width, this.height) * 0.22;
    ctx.fillStyle = p.flare;
    ctx.globalAlpha = 0.85 + 0.15 * Math.sin(performance.now() / 120);
    ctx.font = `600 12px ${p.fontMono}`;
    ctx.textAlign = 'center';
    ctx.fillText('LEAVING THE COMBAT ZONE', cx, cy - r - 16);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r + 12), cy + Math.sin(a) * (r + 12));
    ctx.lineTo(cx + Math.cos(a + 0.12) * r, cy + Math.sin(a + 0.12) * r);
    ctx.lineTo(cx + Math.cos(a - 0.12) * r, cy + Math.sin(a - 0.12) * r);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
