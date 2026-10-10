import { Game } from './game.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';

/** Colors come from the CSS tokens in styles.css, so the palette lives in one place. */
function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  return {
    void: token('--void'),
    panel: token('--panel'),
    line: token('--line'),
    hull: token('--hull'),
    dim: token('--dim'),
    flare: token('--flare'),
    flareHot: token('--flare-hot'),
    hostile: token('--hostile'),
    ice: token('--ice'),
    fontMono: token('--font-mono'),
  };
}

function showFailure(message) {
  const el = document.getElementById('failure');
  el.querySelector('p').textContent = message;
  el.hidden = false;
  document.getElementById('screen-title').hidden = true;
}

const canvas = document.getElementById('view');
const ui = new UI();
const input = new Input(canvas, { fireButton: ui.fireButton, boostButton: ui.boostButton });
const sound = new Sound();

let game;
try {
  game = new Game({ canvas, hudCanvas: document.getElementById('hud-canvas'), ui, input, sound, palette: readPalette() });
} catch (error) {
  console.error(error);
  showFailure('This browser could not start 3D graphics (WebGL 2). Try a current version of Chrome, Edge, Firefox or Safari.');
}

if (game) {
  ui.bind({
    start: () => {
      game.start();
      input.requestLock();
    },
    pause: () => game.pause(),
    resume: () => game.resume(),
    quit: () => game.toTitle(),
    toggleMute: () => game.toggleMute(),
  });
  ui.setMuted(sound.muted);

  input.onTouch = () => ui.setTouchMode(true);
  input.onLockChange = (locked) => game.onLockChange(locked);
  if (window.matchMedia?.('(pointer: coarse)').matches) input.useTouch();

  // Clicking the view while flying captures the mouse for steering.
  canvas.addEventListener('click', () => {
    if (game.state === 'playing') input.requestLock();
  });

  // Browsers only start audio after the player interacts with the page.
  window.addEventListener('pointerdown', () => sound.unlock());
  window.addEventListener('keydown', () => sound.unlock());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.pause();
  });

  new ResizeObserver(() => game.resize()).observe(canvas);
  game.resize();

  // Handy for tinkering from the browser console, e.g. game.stats.guns = 3.
  window.game = game;

  let last = performance.now();
  const frame = (now) => {
    // Clamp long frames (tab switches, breakpoints) so nothing tunnels through anything.
    const dt = Math.min(Math.max((now - last) / 1000, 0), 1 / 20);
    last = now;
    game.update(dt);
    game.render(dt);
    ui.setLockHint(game.state === 'playing' && !input.locked && !input.touchSeen);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
