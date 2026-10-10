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
