const MUTE_KEY = 'deep-field:muted';
const VOLUME = 0.45;

/**
 * Every sound is synthesized with Web Audio, so the game ships no audio files.
 * Browsers only allow audio after the player interacts, so call unlock() from an input handler.
 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // Storage can be unavailable (private windows, sandboxed frames). Sound defaults to on.
    }
  }

  unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : VOLUME;
      this.master.connect(this.ctx.destination);

      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      this.#startEngine();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Not persisted; the setting still applies for this session.
    }
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : VOLUME, this.ctx.currentTime, 0.02);
  }

  /** Engine rumble, 0 (off) to 1 (full thrust). */
  setThrust(level) {
    if (!this.ctx) return;
    this.engine.gain.setTargetAtTime(level * 0.12, this.ctx.currentTime, 0.06);
  }

  laser() { this.#tone({ type: 'square', freq: 1100, to: 280, dur: 0.08, vol: 0.035 }); }
  enemyShot() { this.#tone({ type: 'sawtooth', freq: 420, to: 140, dur: 0.16, vol: 0.04 }); }
  chip() { this.#noise({ dur: 0.06, vol: 0.06, from: 3000, to: 900, type: 'bandpass', q: 2 }); }
  boost() { this.#noise({ dur: 0.4, vol: 0.14, from: 300, to: 2400, type: 'bandpass', q: 1.2 }); }
  warp() {
    this.#noise({ dur: 0.7, vol: 0.12, from: 200, to: 3800, type: 'bandpass', q: 3 });
    this.#tone({ type: 'sine', freq: 90, to: 360, dur: 0.6, vol: 0.08 });
  }

  /** Main battery: a heavy thump with a crack on top. */
  cannon(level = 1) {
    this.#tone({ type: 'sine', freq: 110, to: 38, dur: 0.45, vol: 0.2 * level });
    this.#noise({ dur: 0.25, vol: 0.12 * level, from: 2200, to: 180 });
  }

  rayCharge(seconds = 1.6) {
    this.#tone({ type: 'sawtooth', freq: 70, to: 900, dur: seconds, vol: 0.05 });
    this.#tone({ type: 'sine', freq: 140, to: 1800, dur: seconds, vol: 0.05 });
  }

  rayFire(seconds = 1.1) {
    this.#noise({ dur: seconds, vol: 0.32, from: 900, to: 120, type: 'lowpass', q: 4 });
    this.#tone({ type: 'sawtooth', freq: 55, to: 42, dur: seconds, vol: 0.16 });
    this.#tone({ type: 'square', freq: 220, to: 180, dur: seconds, vol: 0.03 });
  }

  warpSpool(seconds = 1.6) {
    this.#tone({ type: 'sine', freq: 60, to: 420, dur: seconds, vol: 0.12 });
    this.#noise({ dur: seconds, vol: 0.08, from: 200, to: 2600, type: 'bandpass', q: 2 });
  }

  warpJump() {
    this.#noise({ dur: 1.8, vol: 0.3, from: 3000, to: 120 });
    this.#tone({ type: 'sine', freq: 300, to: 40, dur: 1.6, vol: 0.18 });
  }

  /** Two-tone klaxon for a flagship contact or critical damage. */
  alert() {
    for (let i = 0; i < 3; i++) {
      this.#tone({ type: 'square', freq: 640, dur: 0.18, vol: 0.05, delay: i * 0.42 });
      this.#tone({ type: 'square', freq: 480, dur: 0.18, vol: 0.05, delay: i * 0.42 + 0.2 });
    }
  }

  launch() { this.#noise({ dur: 0.9, vol: 0.12, from: 400, to: 3000, type: 'bandpass', q: 1.5 }); }
  shieldHit() { this.#tone({ type: 'sine', freq: 900, to: 300, dur: 0.18, vol: 0.06 }); }
  rotate() { this.#tone({ type: 'triangle', freq: 1400, dur: 0.04, vol: 0.06 }); }

  salvage() {
    [784, 988, 1175].forEach((freq, i) => this.#tone({ type: 'sine', freq, dur: 0.18, vol: 0.1, delay: i * 0.08 }));
  }

  repair() {
    [392, 523, 659, 784].forEach((freq, i) => this.#tone({ type: 'triangle', freq, dur: 0.2, vol: 0.1, delay: i * 0.07 }));
  }

  select() { this.#tone({ type: 'triangle', freq: 520, to: 780, dur: 0.12, vol: 0.12 }); }

  explode(size = 1) {
    this.#noise({ dur: 0.25 + size * 0.45, vol: 0.18 + size * 0.2, from: 2400, to: 60 });
    this.#tone({ type: 'sine', freq: 140, to: 38, dur: 0.2 + size * 0.3, vol: 0.12 + size * 0.15 });
  }

  hit() {
    this.#tone({ type: 'sawtooth', freq: 240, to: 50, dur: 0.3, vol: 0.12 });
    this.#noise({ dur: 0.2, vol: 0.15, from: 1200, to: 200 });
  }

  pickup() {
    this.#tone({ type: 'sine', freq: 660, dur: 0.09, vol: 0.12 });
    this.#tone({ type: 'sine', freq: 990, dur: 0.14, vol: 0.12, delay: 0.07 });
  }

  sectorClear() {
    [523, 659, 784, 1047].forEach((freq, i) => {
      this.#tone({ type: 'triangle', freq, dur: 0.22, vol: 0.12, delay: i * 0.09 });
    });
  }

  gameOver() {
    [392, 330, 262, 196].forEach((freq, i) => {
      this.#tone({ type: 'triangle', freq, dur: 0.35, vol: 0.13, delay: 0.3 + i * 0.18 });
    });
  }

  #startEngine() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    this.engine = this.ctx.createGain();
    this.engine.gain.value = 0;
    src.connect(filter).connect(this.engine).connect(this.master);
    src.start();
  }

  #envelope(gain, t, vol, dur) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  #tone({ type, freq, to, dur, vol, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    this.#envelope(gain, t, vol, dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  #noise({ dur, vol, from, to, type = 'lowpass', q = 0.8, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const gain = this.ctx.createGain();
    this.#envelope(gain, t, vol, dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }
}
