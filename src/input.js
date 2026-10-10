const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  thrust: ['ArrowUp', 'KeyW'],
  fire: ['Space', 'KeyJ'],
  boost: ['ShiftLeft', 'ShiftRight', 'KeyK'],
};

const NO_SCROLL = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

// How far (CSS px) the thumb must travel from where it landed for full thrust.
const STICK_RADIUS = 60;
const STICK_DEADZONE = 0.2;

/**
 * Keyboard plus touch controls. The left half of the field is a floating thumbstick, the right half
 * fires, and the on-screen Fire/Boost buttons do what they say.
 */
export class Input {
  constructor(canvas, { fireButton, boostButton }) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set(); // keys pressed since the last frame
    this.stick = null; // { id, ox, oy, x, y } in CSS px while a thumb is on the left half
    this.firePointers = new Set();
    this.boostHeld = false;
    this.onTouch = null;
    this.touchSeen = false;

    window.addEventListener('keydown', (e) => {
      if (NO_SCROLL.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());

    canvas.addEventListener('pointerdown', (e) => this.#canvasDown(e));
    canvas.addEventListener('pointermove', (e) => this.#canvasMove(e));
    for (const type of ['pointerup', 'pointercancel']) {
      canvas.addEventListener(type, (e) => this.#release(e.pointerId));
    }
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.#holdButton(fireButton, (on, e) => {
      if (on) this.firePointers.add(e.pointerId);
      else this.firePointers.delete(e.pointerId);
    });
    this.#holdButton(boostButton, (on) => { this.boostHeld = on; });
  }

  /** The current flight controls, merged across keyboard and touch. */
  read() {
    const held = (codes) => codes.some((c) => this.down.has(c));
    const controls = {
      turn: (held(KEYS.right) ? 1 : 0) - (held(KEYS.left) ? 1 : 0),
      thrust: held(KEYS.thrust) ? 1 : 0,
      aim: null,
      fire: held(KEYS.fire) || this.firePointers.size > 0,
      boost: held(KEYS.boost) || this.boostHeld,
    };
    if (this.stick) {
      const dx = this.stick.x - this.stick.ox;
      const dy = this.stick.y - this.stick.oy;
      const amount = Math.min(1, Math.hypot(dx, dy) / STICK_RADIUS);
      if (amount > STICK_DEADZONE) {
        controls.aim = Math.atan2(dy, dx);
        controls.thrust = Math.max(controls.thrust, (amount - STICK_DEADZONE) / (1 - STICK_DEADZONE));
      }
    }
    return controls;
  }

  wasPressed(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  endFrame() {
    this.pressed.clear();
  }

  releaseAll() {
    this.down.clear();
    this.stick = null;
    this.firePointers.clear();
    this.boostHeld = false;
  }

  get stickRadius() {
    return STICK_RADIUS;
  }

  #markTouch() {
    if (this.touchSeen) return;
    this.touchSeen = true;
    this.onTouch?.();
  }

  #canvasDown(e) {
    if (e.pointerType === 'mouse') return;
    this.#markTouch();
    this.canvas.setPointerCapture?.(e.pointerId);
    const rect = this.canvas.getBoundingClientRect();
    if (e.clientX - rect.left < rect.width / 2) {
      if (!this.stick) {
        this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      }
    } else {
      this.firePointers.add(e.pointerId);
    }
  }

  #canvasMove(e) {
    if (this.stick && e.pointerId === this.stick.id) {
      this.stick.x = e.clientX;
      this.stick.y = e.clientY;
    }
  }

  #release(pointerId) {
    if (this.stick && this.stick.id === pointerId) this.stick = null;
    this.firePointers.delete(pointerId);
  }

  #holdButton(button, set) {
    if (!button) return;
    const up = (e) => {
      set(false, e);
      button.classList.remove('active');
    };
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.#markTouch();
      button.setPointerCapture?.(e.pointerId);
      set(true, e);
      button.classList.add('active');
    });
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
