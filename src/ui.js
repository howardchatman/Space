import { COMMANDS } from './commands.js';
import { SYSTEMS } from './engineering.js';

const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');
const formatScore = (n) => Math.round(n).toLocaleString('en-US');
const formatDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

// Orders shown on the command bar, in order. The map has its own button up top.
const BAR = ['cannons', 'deathray', 'recon', 'recall', 'course', 'pilot', 'engineering', 'full', 'stop', 'warp'];
const COMMS_LINES = 4;

/** Everything drawn in HTML rather than on the canvas: HUD panels, orders, comms, banners and menus. */
export class UI {
  constructor() {
    this.screens = {
      title: $('screen-title'),
      upgrade: $('screen-upgrade'),
      paused: $('screen-paused'),
      over: $('screen-over'),
    };
    this.hud = $('hud');
    this.touch = $('touch-controls');
    this.touchHint = $('touch-hint');
    this.fireButton = $('touch-fire');
    this.boostButton = $('touch-boost');
    this.mapOverlay = $('map-overlay');
    this.mapCanvas = $('map-canvas');
    this.engineeringRoot = $('engineering');
    this.touchMode = false;
    this.hudOn = false;
    this.mode = 'bridge';
    this.hintDismissed = false;
    this.cache = {};
    this.heardTimer = null;
    this.#buildCommandBar();
    this.#buildSystems();
  }

  bind(actions) {
    const on = (id, fn) => $(id).addEventListener('click', fn);
    on('btn-start', actions.start);
    on('btn-again', actions.start);
    on('btn-restart', actions.start);
    on('btn-pause', actions.pause);
    on('btn-resume', actions.resume);
    on('btn-quit', actions.quit);
    on('btn-over-quit', actions.quit);
    on('btn-mute', actions.toggleMute);
    on('btn-voice', actions.toggleVoice);
    on('btn-crew', actions.toggleCrewVoice);
    on('btn-map', () => actions.command('map'));
    on('btn-map-close', () => actions.command('map'));
    on('btn-return', () => actions.command('return'));
    this.mapCanvas.addEventListener('click', (e) => {
      const rect = this.mapCanvas.getBoundingClientRect();
      actions.mapClick(e.clientX - rect.left, e.clientY - rect.top);
    });
    for (const b of document.querySelectorAll('#map-mode button')) {
      b.addEventListener('click', () => actions.mapMode(b.dataset.mapMode));
    }
    for (const b of document.querySelectorAll('#hud-power button')) {
      b.addEventListener('click', () => actions.command(`power-${b.dataset.power}`));
    }
    for (const button of this.commandButtons.values()) {
      button.addEventListener('click', () => actions.command(button.dataset.cmd));
    }
  }

  /** Shows one menu screen by name, or none when given null. */
  show(name) {
    for (const [key, el] of Object.entries(this.screens)) el.hidden = key !== name;
    if (name) $('banner').classList.remove('show');
    this.screens[name]?.querySelector('[data-autofocus], .option')?.focus({ preventScroll: true });
  }

  setHudVisible(on) {
    this.hudOn = on;
    this.hud.hidden = !on;
    this.#syncTouch();
  }

  /** 'bridge' or 'pilot': swaps the panels that belong to each seat. */
  setMode(mode) {
    this.mode = mode;
    $('bridge-hud').hidden = mode !== 'bridge';
    $('pilot-hud').hidden = mode !== 'pilot';
    this.hud.dataset.mode = mode;
    this.#syncTouch();
  }

  setTouchMode(on) {
    this.touchMode = on;
    document.body.classList.toggle('is-touch', on);
    this.#syncTouch();
  }

  dismissTouchHint() {
    if (this.hintDismissed) return;
    this.hintDismissed = true;
    this.touchHint.hidden = true;
  }

  setMuted(muted) {
    const button = $('btn-mute');
    button.setAttribute('aria-pressed', String(muted));
    button.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  }

  setCrewVoice(on) {
    $('btn-crew').setAttribute('aria-pressed', String(on));
    $('btn-crew').setAttribute('aria-label', on ? 'Crew voices on' : 'Crew voices off');
  }

  /** 'listening', 'off', 'denied' or 'unsupported'. */
  setVoiceState(state) {
    const button = $('btn-voice');
    button.setAttribute('aria-pressed', String(state === 'listening'));
    button.dataset.state = state;
  }

  setBest(best) {
    $('title-best').textContent = formatScore(best);
  }

  setMapOpen(open) {
    this.mapOverlay.hidden = !open;
    $('btn-map').setAttribute('aria-pressed', String(open));
  }

  /** 'course' or 'recon': highlights the map's click mode and explains it. */
  setMapMode(mode) {
    for (const b of document.querySelectorAll('#map-mode button')) {
      b.setAttribute('aria-pressed', String(b.dataset.mapMode === mode));
    }
    $('map-hint').textContent = mode === 'recon'
      ? 'Click a point to send the nearest scout to scan it.'
      : 'Click anywhere to set a course. Shaded space is unexplored: send recon to scan it.';
    this.mapOverlay.dataset.mode = mode;
  }

  /** Shows what the voice recognizer heard for a few seconds. */
  setHeard(text, understood) {
    const el = $('heard');
    el.textContent = understood ? `“${text}”` : `“${text}” (not an order)`;
    el.dataset.understood = String(understood);
    el.hidden = false;
    clearTimeout(this.heardTimer);
    this.heardTimer = setTimeout(() => { el.hidden = true; }, 3000);
  }

  setLockHint(on) {
    this.#set('lockHint', on, (v) => { $('lock-hint').hidden = !v; });
  }

  /** Red edge glow when the ship takes a hit, 0 to 1. */
  setHurt(amount) {
    this.#set('hurt', Math.round(amount * 50) / 50, (v) => { $('hurt').style.opacity = String(v); });
  }

  /** White-out for the warp jump, 0 to 1. */
  setFlash(amount) {
    this.#set('flash', Math.round(amount * 100) / 100, (v) => { $('flash').style.opacity = String(v); });
  }

  /** Adds a crew report to the comms log. */
  addComms(station, text) {
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = station;
    li.append(who, document.createTextNode(` ${text}`));
    const log = $('comms');
    log.append(li);
    while (log.children.length > COMMS_LINES) log.firstElementChild.remove();
  }

  clearComms() {
    $('comms').replaceChildren();
  }

  updateTop({ score, sector, objective, multiplier, overdrive }) {
    this.#set('score', formatScore(score), (v) => { $('hud-score').textContent = v; });
    this.#set('sector', sector, (v) => { $('hud-sector').textContent = `Sector ${pad2(v)}`; });
    this.#set('objective', objective, (v) => { $('hud-objective').textContent = v; });
    this.#set('mult', multiplier, (v) => {
      $('hud-mult').hidden = v <= 1;
      $('hud-mult').textContent = `×${v}`;
    });
    this.#set('overdrive', overdrive, (v) => { $('hud-overdrive').hidden = !v; });
  }

  updateBridge({ hull, maxHull, shield, maxShield, energy, maxEnergy, systems, target, speed, throttle, course, commands, power }) {
    this.#set('power', power, (v) => {
      for (const b of document.querySelectorAll('#hud-power button')) b.setAttribute('aria-pressed', String(b.dataset.power === v));
    });
    this.#meter('hull', hull, maxHull, 'hud-hull', 'hud-hull-bar', 'meter-hull');
    this.#meter('shield', shield, maxShield, 'hud-shield', 'hud-shield-bar', 'meter-shield');
    this.#meter('energy', energy, maxEnergy, 'hud-energy', 'hud-energy-bar', null);
    for (const sys of SYSTEMS) {
      const pct = Math.round(systems[sys.id] * 100);
      this.#set(`sys-${sys.id}`, pct, (v) => {
        const row = this.systemRows[sys.id];
        row.value.textContent = `${v}%`;
        row.wrap.dataset.state = v >= 75 ? 'ok' : v >= 40 ? 'worn' : 'critical';
      });
    }
    const targetKey = target ? `${target.name}|${Math.round(target.distance / 10)}|${Math.round((target.hull ?? -1) * 100)}` : 'none';
    this.#set('target', targetKey, () => {
      $('hud-target').textContent = target ? target.name : 'None';
      $('hud-target-detail').textContent = target ? `${formatDistance(target.distance)}${target.note ? ` · ${target.note}` : ''}` : 'Tap or click a contact';
      $('meter-target').hidden = !target || target.hull == null;
      if (target?.hull != null) $('hud-target-bar').style.transform = `scaleX(${target.hull})`;
    });
    this.#set('speed', Math.round(speed), (v) => { $('hud-speed').textContent = String(v); });
    this.#set('throttle', Math.round(Math.max(0, throttle) * 50) / 50, (v) => { $('hud-throttle').style.transform = `scaleX(${v})`; });
    this.#set('course', course ?? '', (v) => { $('hud-course').textContent = v || 'Holding course'; });
    for (const [id, state] of Object.entries(commands)) {
      this.#set(`cmd-${id}`, `${state.state}|${Math.round((state.progress ?? 1) * 20)}`, () => {
        const b = this.commandButtons.get(id);
        if (!b) return;
        b.dataset.state = state.state;
        b.style.setProperty('--progress', String(state.progress ?? 1));
      });
    }
  }

  updatePilot({ shield, maxShield, boost, speed, throttle }) {
    this.#meter('pshield', shield, maxShield, 'hud-pshield', 'hud-pshield-bar', 'meter-pshield');
    this.#set('boost', Math.round(boost * 50) / 50, (v) => { $('hud-boost').style.transform = `scaleX(${v})`; });
    this.#set('pspeed', Math.round(speed), (v) => { $('hud-pspeed').textContent = String(v); });
    this.#set('pthrottle', Math.round(throttle * 100) / 100, (v) => { $('hud-pthrottle').style.transform = `scaleX(${v})`; });
  }

  banner(title, sub) {
    const el = $('banner');
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub;
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
  }

  showUpgrades(sector, options, levels, onPick, report = null) {
    $('upgrade-eyebrow').textContent = report
      ? `Sector ${pad2(report.sector)} cleared · Arrived in sector ${pad2(sector)}`
      : `Arrived in sector ${pad2(sector)}`;
    this.#showReport(report);
    const buttons = options.map((upgrade, i) => {
      const level = levels[upgrade.id] ?? 0;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'option';
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(i + 1);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = upgrade.name;
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = upgrade.desc;
      const pips = document.createElement('span');
      pips.className = 'pips';
      pips.setAttribute('aria-label', `Level ${level} of ${upgrade.max}`);
      for (let k = 0; k < upgrade.max; k++) {
        const pip = document.createElement('span');
        pip.className = k < level ? 'pip on' : k === level ? 'pip next' : 'pip';
        pips.append(pip);
      }
      button.append(key, name, desc, pips);
      button.addEventListener('click', () => onPick(upgrade.id));
      return button;
    });
    $('upgrade-options').replaceChildren(...buttons);
    this.show('upgrade');
  }

  #showReport(report) {
    const el = $('report');
    el.hidden = !report;
    if (!report) return;
    const minutes = Math.floor(report.seconds / 60);
    const seconds = String(Math.floor(report.seconds % 60)).padStart(2, '0');
    const rows = [
      ['Time', `${minutes}:${seconds}`],
      ['Fighters', report.fighters],
      ['Corvettes', report.corvettes],
      ['Torpedoes stopped', report.torpedoes],
      ['Hull lost', Math.round(report.hullLost)],
      ['Bonus', `+${formatScore(report.bonus)}`],
    ];
    el.replaceChildren(...rows.map(([label, value]) => {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = String(value);
      div.append(dt, dd);
      return div;
    }));
    el.title = [
      report.timeBonus ? `Speed bonus +${formatScore(report.timeBonus)}` : 'No speed bonus',
      report.cleanBonus ? `Clean hull +${formatScore(report.cleanBonus)}` : null,
    ].filter(Boolean).join(' · ');
  }

  showGameOver({ score, wave, best, newBest }) {
    $('over-score').textContent = formatScore(score);
    $('over-wave').textContent = pad2(wave);
    $('over-best').textContent = formatScore(best);
    $('over-note').hidden = !newBest;
    this.show('over');
  }

  #buildCommandBar() {
    this.commandButtons = new Map();
    const bar = $('command-bar');
    for (const id of BAR) {
      const c = COMMANDS.find((x) => x.id === id);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cmd';
      b.dataset.cmd = id;
      b.dataset.state = 'ready';
      b.innerHTML = '<span class="cmd-key"></span><span class="cmd-label"></span><span class="cmd-cool" aria-hidden="true"></span>';
      b.querySelector('.cmd-key').textContent = c.key;
      b.querySelector('.cmd-label').textContent = c.label;
      b.title = `${c.label} (${c.key}) · say “${c.phrases[0]}”`;
      bar.append(b);
      this.commandButtons.set(id, b);
    }
  }

  #buildSystems() {
    this.systemRows = {};
    const list = $('hud-systems');
    for (const sys of SYSTEMS) {
      const wrap = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = sys.name;
      const dd = document.createElement('dd');
      dd.textContent = '100%';
      wrap.append(dt, dd);
      wrap.dataset.state = 'ok';
      list.append(wrap);
      this.systemRows[sys.id] = { wrap, value: dd };
    }
  }

  #meter(key, value, max, valueId, barId, meterId) {
    const pct = Math.max(0, Math.round((value / max) * 200) / 200);
    this.#set(`${key}-v`, Math.max(0, Math.ceil(value)), (v) => { $(valueId).textContent = String(v); });
    this.#set(`${key}-b`, pct, (v) => {
      $(barId).style.transform = `scaleX(${v})`;
      if (meterId) $(meterId).classList.toggle('low', v < 0.3);
    });
  }

  #syncTouch() {
    const pilot = this.hudOn && this.touchMode && this.mode === 'pilot';
    this.touch.hidden = !pilot;
    this.touchHint.hidden = !(pilot && !this.hintDismissed);
  }

  #set(key, value, apply) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    apply(value);
  }
}
