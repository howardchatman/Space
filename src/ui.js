const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');
const formatScore = (n) => Math.round(n).toLocaleString('en-US');

/** Everything drawn in HTML rather than on the canvas: HUD, banners, menus and touch buttons. */
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
    this.touchMode = false;
    this.hudOn = false;
    this.hintDismissed = false;
    this.cache = {};
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
  }

  /** Shows one menu screen by name, or none when given null. */
  show(name) {
    for (const [key, el] of Object.entries(this.screens)) el.hidden = key !== name;
    if (name) $('banner').classList.remove('show');
    const screen = this.screens[name];
    screen?.querySelector('[data-autofocus], .option')?.focus({ preventScroll: true });
  }

  setHudVisible(on) {
    this.hudOn = on;
    this.hud.hidden = !on;
    this.touch.hidden = !(on && this.touchMode);
    this.touchHint.hidden = !(on && this.touchMode && !this.hintDismissed);
  }

  setTouchMode(on) {
    this.touchMode = on;
    document.body.classList.toggle('is-touch', on);
    this.setHudVisible(this.hudOn);
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

  setBest(best) {
    $('title-best').textContent = formatScore(best);
  }

  updateHud({ score, multiplier, overdrive, wave, shield, maxShield, boost }) {
    this.#set('score', formatScore(score), (v) => { $('hud-score').textContent = v; });
    this.#set('mult', multiplier, (v) => {
      const el = $('hud-mult');
      el.hidden = v <= 1;
      el.textContent = `×${v}`;
    });
    this.#set('overdrive', overdrive, (v) => { $('hud-overdrive').hidden = !v; });
    this.#set('wave', pad2(wave), (v) => { $('hud-wave').textContent = v; });
    const shieldPct = Math.max(0, Math.round((shield / maxShield) * 200) / 200);
    this.#set('shield', shieldPct, (v) => {
      $('hud-shield').style.transform = `scaleX(${v})`;
      $('meter-shield').classList.toggle('low', v < 0.3);
    });
    this.#set('boost', Math.round(boost * 50) / 50, (v) => {
      $('hud-boost').style.transform = `scaleX(${v})`;
    });
  }

  banner(title, sub) {
    const el = $('banner');
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub;
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
  }

  showUpgrades(wave, options, levels, onPick) {
    $('upgrade-eyebrow').textContent = `Sector ${pad2(wave)} clear`;
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

  showGameOver({ score, wave, best, newBest }) {
    $('over-score').textContent = formatScore(score);
    $('over-wave').textContent = pad2(wave);
    $('over-best').textContent = formatScore(best);
    $('over-note').hidden = !newBest;
    this.show('over');
  }

  #set(key, value, apply) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    apply(value);
  }
}
