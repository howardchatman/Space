import { matchCommand } from './commands.js';

/**
 * Voice orders through the browser's speech recognition (Chrome, Edge and Safari). Listens
 * continuously while on and hands every recognised command id to `onCommand`.
 * Unsupported browsers, or a page without microphone access, report it through `onStatus`.
 */
export class VoiceControl {
  constructor({ onCommand, onHeard, onStatus }) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = Boolean(Recognition);
    this.listening = false;
    this.onCommand = onCommand;
    this.onHeard = onHeard;
    this.onStatus = onStatus;
    if (!this.supported) return;

    this.recognition = new Recognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';
    this.recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue;
        const transcript = event.results[i][0].transcript.trim();
        const id = matchCommand(transcript);
        this.onHeard?.(transcript, id);
        if (id) this.onCommand(id);
      }
    };
    this.recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
        this.listening = false;
        this.onStatus?.('denied');
      }
    };
    // Recognition stops itself after silence; keep it going while voice is on.
    this.recognition.onend = () => {
      if (!this.listening) return;
      try {
        this.recognition.start();
      } catch {
        this.listening = false;
        this.onStatus?.('off');
      }
    };
  }

  /** Must be called from a click or key press the first time, so the browser can ask for the mic. */
  toggle() {
    if (!this.supported) {
      this.onStatus?.('unsupported');
      return;
    }
    if (this.listening) {
      this.listening = false;
      this.recognition.stop();
      this.onStatus?.('off');
      return;
    }
    try {
      this.recognition.start();
      this.listening = true;
      this.onStatus?.('listening');
    } catch {
      this.onStatus?.('denied');
    }
  }
}
