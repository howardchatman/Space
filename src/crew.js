const VOICE_KEY = 'deep-field:crew-voice';

// Each station speaks with a slightly different voice.
const STATIONS = {
  Weapons: { pitch: 0.85, rate: 1.08 },
  Helm: { pitch: 1.0, rate: 1.05 },
  Sensors: { pitch: 1.15, rate: 1.1 },
  'Flight deck': { pitch: 0.95, rate: 1.1 },
  Engineering: { pitch: 0.75, rate: 1.0 },
  'Damage control': { pitch: 0.9, rate: 1.12 },
  Comms: { pitch: 1.05, rate: 1.05 },
};

/**
 * The bridge crew's replies: shown in the comms log and, when crew voice is on, spoken aloud with the
 * browser's speech synthesis. Newer reports interrupt older ones so the crew never lags behind.
 */
export class Crew {
  constructor(ui) {
    this.ui = ui;
    this.synth = window.speechSynthesis ?? null;
    this.voices = [];
    this.voiceOn = true;
    try {
      this.voiceOn = localStorage.getItem(VOICE_KEY) !== '0';
    } catch {
      // Storage unavailable; crew voice defaults to on.
    }
    if (this.synth) {
      const load = () => {
        this.voices = this.synth.getVoices().filter((v) => v.lang?.startsWith('en'));
      };
      load();
      this.synth.addEventListener?.('voiceschanged', load);
    }
    this.lastSpoken = 0;
    this.onSay = null; // called with the station name on every report
  }

  get canSpeak() {
    return Boolean(this.synth);
  }

  setVoice(on) {
    this.voiceOn = on;
    if (!on) this.synth?.cancel();
    try {
      localStorage.setItem(VOICE_KEY, on ? '1' : '0');
    } catch {
      // Not persisted.
    }
  }

  /** A report from a station. `speak: false` keeps routine chatter off the speakers. */
  say(station, text, { speak = true } = {}) {
    this.ui.addComms(station, text);
    this.onSay?.(station);
    if (!speak || !this.voiceOn || !this.synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    if (this.synth.speaking || this.synth.pending) this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const style = STATIONS[station] ?? STATIONS.Comms;
    u.pitch = style.pitch;
    u.rate = style.rate;
    u.volume = 0.9;
    if (this.voices.length) {
      const names = Object.keys(STATIONS);
      u.voice = this.voices[Math.max(0, names.indexOf(station)) % this.voices.length];
    }
    this.synth.speak(u);
  }
}
