import { Game } from './game.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { Crew } from './crew.js';
import { VoiceControl } from './voice.js';

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
    energy: token('--energy'),
    mapBg: token('--map-bg'),
    mapFog: token('--map-fog'),
    fontMono: token('--font-mono'),
  };
}

function showFailure(message) {
  const el = document.getElementById('failure');
  el.querySelector('p').textContent = message;
  el.hidden = false;
  document.getElementById('screen-title').hidden = true;
}

const VOICE_MESSAGES = {
  unsupported: 'Voice orders need Chrome, Edge or Safari.',
  denied: "Voice orders need microphone access, which this page doesn't have. Use the buttons or keys.",
};

const canvas = document.getElementById('view');
const ui = new UI();
const input = new Input(canvas, { fireButton: ui.fireButton, boostButton: ui.boostButton });
input.bindHelm(ui.helmPad, ui.helmThrottle);
const sound = new Sound();
const crew = new Crew(ui);

let game;
try {
  game = new Game({ canvas, hudCanvas: document.getElementById('hud-canvas'), ui, input, sound, crew, palette: readPalette() });
} catch (error) {
  console.error(error);
  showFailure('This browser could not start 3D graphics (WebGL 2). Try a current version of Chrome, Edge, Firefox or Safari.');
}

if (game) {
  game.voice = new VoiceControl({
    onCommand: (id) => game.command(id, 'voice'),
    onHeard: (text, id) => ui.setHeard(text, Boolean(id)),
    onStatus: (state) => {
      ui.setVoiceState(state);
      if (VOICE_MESSAGES[state]) crew.say('Comms', VOICE_MESSAGES[state], { speak: false });
      if (state === 'listening') crew.say('Comms', "Listening for your orders, Captain. Try 'fire the cannons' or 'send out the recon'.", { speak: false });
    },
  });
  if (!game.voice.supported) ui.setVoiceState('unsupported');

  ui.bind({
    start: () => game.start(),
    pause: () => game.pause(),
    resume: () => game.resume(),
    quit: () => game.toTitle(),
    toggleMute: () => game.toggleMute(),
    toggleVoice: () => game.toggleVoice(),
    toggleCrewVoice: () => game.toggleCrewVoice(),
    command: (id) => game.command(id, 'button'),
    mapClick: (x, y) => game.mapClick(x, y),
    mapMode: (mode) => game.setMapMode(mode),
  });
  ui.setMuted(sound.muted);
  ui.setCrewVoice(crew.voiceOn);

  input.onTouch = () => ui.setTouchMode(true);
  input.onLockChange = (locked) => game.onLockChange(locked);
  if (window.matchMedia?.('(pointer: coarse)').matches) input.useTouch();

  // Clicking the view while flying a scout captures the mouse for steering.
  canvas.addEventListener('click', () => {
    if (game.state === 'playing' && game.mode === 'pilot') input.requestLock();
  });

  // Browsers only start audio after the player interacts with the page.
  window.addEventListener('pointerdown', () => sound.unlock());
  window.addEventListener('keydown', () => sound.unlock());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.pause();
  });

  new ResizeObserver(() => game.resize()).observe(canvas);
  game.resize();

  // Handy for tinkering from the browser console, e.g. game.energy = 100.
  window.game = game;

  let last = performance.now();
  const frame = (now) => {
    // Clamp long frames (tab switches, breakpoints) so nothing tunnels through anything.
    const dt = Math.min(Math.max((now - last) / 1000, 0), 1 / 20);
    last = now;
    game.update(dt);
    game.render(dt);
    ui.setLockHint(game.state === 'playing' && game.mode === 'pilot' && !input.locked && !input.touchSeen);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
