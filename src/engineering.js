// Conduit tiles store their openings as bits.
const N = 1;
const E = 2;
const S = 4;
const W = 8;
const DIRS = [
  { bit: N, dx: 0, dy: -1, opposite: S },
  { bit: E, dx: 1, dy: 0, opposite: W },
  { bit: S, dx: 0, dy: 1, opposite: N },
  { bit: W, dx: -1, dy: 0, opposite: E },
];
const COLS = 6;
const ROWS = 5;

export const SYSTEMS = [
  { id: 'engines', name: 'Engines', effect: 'Speed and turning' },
  { id: 'weapons', name: 'Weapons', effect: 'Cannon reload and the death ray' },
  { id: 'shields', name: 'Shields', effect: 'Shield recharge' },
  { id: 'sensors', name: 'Sensors', effect: 'Scanner range' },
];

/** Rotates a tile's openings a quarter turn clockwise. */
const rotate = (mask, turns = 1) => {
  let m = mask;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) m = ((m << 1) | (m >> 3)) & 15;
  return m;
};

/**
 * A power-routing puzzle: a random conduit path from the power source (left edge) to the damaged
 * system (right edge), hidden among decoy tiles, with every tile turned at random.
 */
function generatePuzzle() {
  for (;;) {
    const startRow = Math.floor(Math.random() * ROWS);
    const endRow = Math.floor(Math.random() * ROWS);
    const path = walk(0, startRow, COLS - 1, endRow);
    if (!path || path.length < COLS + 1 || path.length > 16) continue;

    const tiles = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        // Decoys: straights, corners and tees.
        const roll = Math.random();
        const base = roll < 0.35 ? N | S : roll < 0.8 ? N | E : N | E | S;
        tiles.push({ x, y, solution: rotate(base, Math.floor(Math.random() * 4)) });
      }
    }
    path.forEach((cell, i) => {
      const prev = i === 0 ? { x: -1, y: startRow } : path[i - 1];
      const next = i === path.length - 1 ? { x: COLS, y: endRow } : path[i + 1];
      let mask = 0;
      for (const d of DIRS) {
        if ((prev.x === cell.x + d.dx && prev.y === cell.y + d.dy) || (next.x === cell.x + d.dx && next.y === cell.y + d.dy)) mask |= d.bit;
      }
      tiles[cell.y * COLS + cell.x].solution = mask;
    });
    // Scramble: every tile starts turned a random number of quarter turns from its solution.
    for (const t of tiles) {
      t.base = t.solution;
      t.turns = Math.floor(Math.random() * 4);
    }
    const puzzle = { tiles, startRow, endRow };
    if (powered(puzzle).solved) continue; // scrambled into a solution by chance
    return puzzle;
  }
}

/** Random depth-first walk between two cells; returns the cell list or null. */
function walk(x0, y0, x1, y1) {
  const seen = new Set();
  const path = [];
  const visit = (x, y) => {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS || seen.has(`${x},${y}`)) return false;
    seen.add(`${x},${y}`);
    path.push({ x, y });
    if (x === x1 && y === y1) return true;
    const dirs = [...DIRS].sort(() => Math.random() - 0.5);
    for (const d of dirs) if (visit(x + d.dx, y + d.dy)) return true;
    path.pop();
    return false;
  };
  return visit(x0, y0) ? path : null;
}

const maskOf = (t) => rotate(t.base, t.turns);

/** Which tiles carry power from the source, and whether it reaches the system. */
function powered({ tiles, startRow, endRow }) {
  const on = new Set();
  const first = tiles[startRow * COLS];
  if (!(maskOf(first) & W)) return { on, solved: false };
  const queue = [first];
  on.add(first);
  while (queue.length) {
    const t = queue.shift();
    const m = maskOf(t);
    for (const d of DIRS) {
      if (!(m & d.bit)) continue;
      const nx = t.x + d.dx;
      const ny = t.y + d.dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const n = tiles[ny * COLS + nx];
      if (on.has(n) || !(maskOf(n) & d.opposite)) continue;
      on.add(n);
      queue.push(n);
    }
  }
  const last = tiles[endRow * COLS + COLS - 1];
  return { on, solved: on.has(last) && Boolean(maskOf(last) & E) };
}

function tileSvg(mask) {
  const ends = { [N]: '50,0', [E]: '100,50', [S]: '50,100', [W]: '0,50' };
  const lines = DIRS.filter((d) => mask & d.bit).map((d) => `<line x1="50" y1="50" x2="${ends[d.bit].split(',')[0]}" y2="${ends[d.bit].split(',')[1]}" />`);
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${lines.join('')}<circle cx="50" cy="50" r="9" /></svg>`;
}

/**
 * The engineering station: pick a damaged system, then route power to it by turning conduit tiles.
 * Solving a puzzle repairs the system by `repairAmount`. The game keeps running while you work.
 */
export class Engineering {
  constructor(root, { onRepair, onClose, onRotate }) {
    this.root = root;
    this.onRepair = onRepair;
    this.onClose = onClose;
    this.onRotate = onRotate;
    this.systemList = root.querySelector('[data-systems]');
    this.grid = root.querySelector('[data-grid]');
    this.status = root.querySelector('[data-status]');
    this.sourceMarks = root.querySelector('[data-source]');
    this.sinkMarks = root.querySelector('[data-sink]');
    this.selected = null;
    this.puzzle = null;
    this.locked = false;
    root.querySelector('[data-close]').addEventListener('click', () => this.onClose());
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open(systems) {
    this.root.hidden = false;
    this.refresh(systems);
    if (!this.selected) {
      const worst = SYSTEMS.reduce((a, b) => (systems[b.id] < systems[a.id] ? b : a));
      this.select(worst.id, systems);
    }
    this.root.querySelector('.system-btn[aria-pressed="true"]')?.focus({ preventScroll: true });
  }

  close() {
    this.root.hidden = true;
  }

  /** Redraws the system list with current conditions. */
  refresh(systems) {
    this.systems = systems;
    this.systemList.replaceChildren(...SYSTEMS.map((sys) => {
      const pct = Math.round(systems[sys.id] * 100);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'system-btn';
      b.setAttribute('aria-pressed', String(sys.id === this.selected));
      b.dataset.state = pct >= 75 ? 'ok' : pct >= 40 ? 'worn' : 'critical';
      b.innerHTML = '<span class="sys-name"></span><span class="sys-pct"></span><span class="sys-bar"><span></span></span><span class="sys-effect"></span>';
      b.querySelector('.sys-name').textContent = sys.name;
      b.querySelector('.sys-pct').textContent = `${pct}%`;
      b.querySelector('.sys-bar span').style.transform = `scaleX(${pct / 100})`;
      b.querySelector('.sys-effect').textContent = sys.effect;
      b.addEventListener('click', () => this.select(sys.id, this.systems));
      return b;
    }));
  }

  select(id, systems) {
    this.selected = id;
    this.puzzle = generatePuzzle();
    this.locked = false;
    this.refresh(systems);
    this.#render();
    const name = SYSTEMS.find((s) => s.id === id).name;
    this.status.textContent = systems[id] >= 1
      ? `${name} are at full strength. Routing power anyway keeps the crew sharp.`
      : `Turn the conduits to route power from the reactor to the ${name.toLowerCase()}.`;
  }

  #render() {
    const { tiles, startRow, endRow } = this.puzzle;
    const { on } = powered(this.puzzle);
    this.grid.style.setProperty('--cols', COLS);
    this.grid.replaceChildren(...tiles.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile';
      b.dataset.powered = String(on.has(t));
      b.setAttribute('aria-label', `Conduit at row ${t.y + 1}, column ${t.x + 1}`);
      b.innerHTML = tileSvg(t.base);
      b.firstChild.style.transform = `rotate(${t.turns * 90}deg)`;
      b.addEventListener('click', () => this.#turn(t, b));
      return b;
    }));
    const marks = (el, row) => {
      el.replaceChildren(...Array.from({ length: ROWS }, (_, i) => {
        const m = document.createElement('span');
        m.className = i === row ? 'port live' : 'port';
        return m;
      }));
    };
    marks(this.sourceMarks, startRow);
    marks(this.sinkMarks, endRow);
  }

  #turn(tile, button) {
    if (this.locked) return;
    tile.turns += 1;
    button.firstChild.style.transform = `rotate(${tile.turns * 90}deg)`;
    this.onRotate?.();
    const { on, solved } = powered(this.puzzle);
    for (const [i, b] of [...this.grid.children].entries()) b.dataset.powered = String(on.has(this.puzzle.tiles[i]));
    if (!solved) return;
    this.locked = true;
    const name = SYSTEMS.find((s) => s.id === this.selected).name;
    this.status.textContent = `Power restored to the ${name.toLowerCase()}.`;
    this.onRepair(this.selected);
    setTimeout(() => {
      if (this.isOpen) this.select(this.selected, this.systems);
    }, 1400);
  }
}
