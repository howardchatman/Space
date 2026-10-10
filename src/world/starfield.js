import { TAU, pick, rand } from '../util/math.js';

const STAR_TINTS = ['#ffffff', '#d6e8ff', '#ffe6c4'];
// Faint dust clouds behind everything.
const DUST = ['rgb(88 54 170 / 0.22)', 'rgb(30 90 150 / 0.16)', 'rgb(160 50 120 / 0.10)', 'rgb(255 150 80 / 0.05)'];
// Distant galaxies, the signature of a deep-field image: warm ellipticals and cool spirals.
const GALAXY_TINTS = ['255 214 170', '205 195 255', '170 215 255', '255 185 155'];

/** The backdrop: a pre-rendered deep-field plate plus three parallax star layers. */
export class Starfield {
  constructor(palette) {
    this.palette = palette;
    this.layers = [];
    this.plate = null;
    this.ox = 0;
    this.oy = 0;
    this.t = 0;
  }

  build(width, height) {
    this.width = width;
    this.height = height;
    const area = width * height;

    this.layers = [
      { depth: 0.05, density: 3000, size: [0.6, 1.1], alpha: [0.25, 0.6] },
      { depth: 0.15, density: 6500, size: [0.9, 1.6], alpha: [0.4, 0.8] },
      { depth: 0.35, density: 16000, size: [1.4, 2.2], alpha: [0.6, 1] },
    ].map((layer) => ({
      depth: layer.depth,
      stars: Array.from({ length: Math.round(area / layer.density) }, () => ({
        x: rand(0, width),
        y: rand(0, height),
        size: rand(layer.size[0], layer.size[1]),
        alpha: rand(layer.alpha[0], layer.alpha[1]),
        color: pick(STAR_TINTS),
        speed: rand(0.6, 2.2),
        phase: rand(0, TAU),
      })),
    }));

    this.plate = this.#paintPlate(width, height);
  }

  /** Drifts the star layers opposite to the ship's motion for a sense of speed. */
  update(dt, vx, vy) {
    this.t += dt;
    this.ox += vx * dt;
    this.oy += vy * dt;
  }

  draw(ctx, width, height) {
    ctx.fillStyle = this.palette.void;
    ctx.fillRect(-40, -40, width + 80, height + 80);
    if (this.plate) ctx.drawImage(this.plate, 0, 0, width, height);

    for (const layer of this.layers) {
      const ox = mod(-this.ox * layer.depth, width);
      const oy = mod(-this.oy * layer.depth, height);
      for (const s of layer.stars) {
        let x = s.x + ox;
        let y = s.y + oy;
        if (x >= width) x -= width;
        if (y >= height) y -= height;
        ctx.globalAlpha = s.alpha * (0.7 + 0.3 * Math.sin(this.t * s.speed + s.phase));
        ctx.fillStyle = s.color;
        ctx.fillRect(x, y, s.size, s.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  #paintPlate(width, height) {
    // Half resolution is plenty for soft clouds and smudged galaxies.
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width / 2));
    canvas.height = Math.max(1, Math.ceil(height / 2));
    const g = canvas.getContext('2d');
    g.scale(0.5, 0.5);

    for (let i = 0; i < 6; i++) {
      const x = rand(0, width);
      const y = rand(0, height);
      const r = rand(0.25, 0.6) * Math.max(width, height);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, DUST[i % DUST.length]);
      grad.addColorStop(1, 'rgb(0 0 0 / 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, width, height);
    }

    const galaxies = Math.round((width * height) / 20000);
    for (let i = 0; i < galaxies; i++) {
      const big = Math.random() < 0.08;
      const size = big ? rand(12, 24) : rand(2, 8);
      const tint = pick(GALAXY_TINTS);
      g.save();
      g.translate(rand(0, width), rand(0, height));
      g.rotate(rand(0, Math.PI));
      g.scale(1, rand(0.25, 0.85));
      g.globalAlpha = big ? 0.5 : rand(0.35, 0.75);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, size);
      grad.addColorStop(0, `rgb(${tint} / 0.95)`);
      grad.addColorStop(0.2, `rgb(${tint} / 0.4)`);
      grad.addColorStop(1, `rgb(${tint} / 0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, size, 0, TAU);
      g.fill();
      g.restore();
    }
    return canvas;
  }
}

function mod(value, size) {
  return ((value % size) + size) % size;
}
