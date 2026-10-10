import { Game } from './game.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';

/** Canvas colors come from the CSS tokens in styles.css, so the palette lives in one place. */
function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  return {
    void: token('--void'),
    voidRaised: token('--void-raised'),
    hull: token('--hull'),
    dim: token('--dim'),
    rock: token('--rock'),
    rockEdge: token('--rock-edge'),
    flare: token('--flare'),
    flareHot: token('--flare-hot'),
    hostile: token('--hostile'),
    ice: token('--ice'),
    fontMono: token('--font-mono'),
  };
}

const canvas = document.getElementById('field');
const ui = new UI();
const input = new Input(canvas, { fireButton: ui.fireButton, boostButton: ui.boostButton });
const sound = new Sound();
const game = new Game({ canvas, ui, input, sound, palette: readPalette() });

ui.bind({
  start: () => game.start(),
  pause: () => game.pause(),
  resume: () => game.resume(),
  quit: () => game.toTitle(),
  toggleMute: () => game.toggleMute(),
});
ui.setMuted(sound.muted);

input.onTouch = () => ui.setTouchMode(true);
if (window.matchMedia?.('(pointer: coarse)').matches) ui.setTouchMode(true);

// Browsers only start audio after the player interacts with the page.
window.addEventListener('pointerdown', () => sound.unlock());
window.addEventListener('keydown', () => sound.unlock());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
});
window.addEventListener('blur', () => game.pause());

new ResizeObserver(() => game.resize()).observe(canvas);
game.resize();

// Handy for tinkering from the browser console, e.g. game.stats.guns = 3.
window.game = game;

let last = performance.now();
function frame(now) {
  // Clamp long frames (tab switches, breakpoints) so nothing tunnels through walls.
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  game.update(dt);
  game.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
