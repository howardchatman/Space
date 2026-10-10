import { CONFIG } from './config.js';

const KEYS = {
  pitchUp: ['ArrowUp'],
  pitchDown: ['ArrowDown'],
  yawLeft: ['ArrowLeft'],
  yawRight: ['ArrowRight'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  throttleUp: ['KeyW'],
  throttleDown: ['KeyS'],
  strafeLeft: ['KeyA'],
  strafeRight: ['KeyD'],
  strafeUp: ['KeyR'],
  strafeDown: ['KeyF'],
  fire: ['Space'],
  boost: ['ShiftLeft', 'ShiftRight'],
};

const NO_SCROLL = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

const STICK_RADIUS = 64; // CSS px of thumb travel for full turn rate
const CURSOR_DEADZONE = 0.06;

/** Shapes a raw -1..1 axis: deadzone, then a gentle curve for fine aiming near the center. */
function curve(value, deadzone) {
  const m = Math.abs(value);
  if (m < deadzone) return 0;
  return Math.sign(value) * Math.min(1, ((m - deadzone) / (1 - deadzone)) ** 1.35);
}

/**
 * Keyboard, mouse and touch flight controls.
 * - Mouse with pointer lock: moving the mouse turns the ship directly, like looking around.
 * - Mouse without pointer lock: the cursor's offset from center sets the turn rate.
 * - Touch: the left half of the screen is a floating stick; Fire and Boost buttons on the right.
 */
export class Input {
  constructor(canvas, { fireButton, boostButton }) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.cursor = null; // { x, y } offset from center, in half-screens, when steering by cursor
    this.mouseFire = false;
    this.mouseBoost = false;
    this.stick = null;
    this.firePointers = new Set();
    this.boostHeld = false;
    this.locked = false;
    this.touchSeen = false;
    this.onTouch = null;
    this.onLockChange = null;

    window.addEventListener('keydown', (e) => {
      if (NO_SCROLL.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.lookX = 0;
      this.lookY = 0;
      this.onLockChange?.(this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      } else if (e.target === canvas) {
        const rect = canvas.getBoundingClientRect();
        const half = Math.min(rect.width, rect.height) / 2;
        this.cursor = {
          x: (e.clientX - rect.left - rect.width / 2) / half,
          y: (e.clientY - rect.top - rect.height / 2) / half,
        };
      }
    });
    canvas.addEventListener('mouseleave', () => { this.cursor = null; });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.mouseBoost = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) this.mouseBoost = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('pointerdown', (e) => this.#touchDown(e));
    canvas.addEventListener('pointermove', (e) => this.#touchMove(e));
    for (const type of ['pointerup', 'pointercancel']) {
      canvas.addEventListener(type, (e) => this.#touchUp(e.pointerId));
    }
    this.#holdButton(fireButton, (on, e) => {
      if (on) this.firePointers.add(e.pointerId);
      else this.firePointers.delete(e.pointerId);
    });
    this.#holdButton(boostButton, (on) => { this.boostHeld = on; });
  }

  /** Captures the mouse for direct steering. Must be called from a click or key handler. */
  requestLock() {
    if (this.touchSeen || this.locked || !this.canvas.requestPointerLock) return;
    try {
      this.canvas.requestPointerLock()?.catch?.(() => {});
    } catch {
      // Not allowed here (some embedded frames). Cursor steering still works.
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** The flight controls for this frame, merged across devices. Consumes accumulated mouse movement. */
  read() {
    const held = (codes) => codes.some((c) => this.down.has(c));
    const axis = (plus, minus) => (held(plus) ? 1 : 0) - (held(minus) ? 1 : 0);
    const sens = CONFIG.player.mouseSensitivity;

    const c = {
      pitch: axis(KEYS.pitchUp, KEYS.pitchDown),
      yaw: axis(KEYS.yawLeft, KEYS.yawRight),
      roll: axis(KEYS.rollLeft, KEYS.rollRight),
      throttle: axis(KEYS.throttleUp, KEYS.throttleDown),
      strafeX: axis(KEYS.strafeRight, KEYS.strafeLeft),
      strafeY: axis(KEYS.strafeUp, KEYS.strafeDown),
      lookX: -this.lookX * sens,
      lookY: -this.lookY * sens,
      fire: held(KEYS.fire) || this.mouseFire || this.firePointers.size > 0,
      boost: held(KEYS.boost) || this.mouseBoost || this.boostHeld,
    };
    this.lookX = 0;
    this.lookY = 0;

    if (!this.locked && this.cursor && !this.touchSeen) {
      c.yaw += -curve(this.cursor.x / 0.7, CURSOR_DEADZONE);
      c.pitch += -curve(this.cursor.y / 0.7, CURSOR_DEADZONE);
    }
    if (this.stick) {
      c.yaw += -curve((this.stick.x - this.stick.ox) / STICK_RADIUS, 0.12);
      c.pitch += -curve((this.stick.y - this.stick.oy) / STICK_RADIUS, 0.12);
    }
    c.pitch = Math.max(-1, Math.min(1, c.pitch));
    c.yaw = Math.max(-1, Math.min(1, c.yaw));
    return c;
  }

  /** The touch stick in canvas CSS pixels, for drawing. */
  get stickView() {
    if (!this.stick) return null;
    const rect = this.canvas.getBoundingClientRect();
    let dx = this.stick.x - this.stick.ox;
    let dy = this.stick.y - this.stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx *= STICK_RADIUS / len;
      dy *= STICK_RADIUS / len;
    }
    const ox = this.stick.ox - rect.left;
    const oy = this.stick.oy - rect.top;
    return { ox, oy, x: ox + dx, y: oy + dy, radius: STICK_RADIUS };
  }

  wasPressed(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  endFrame() {
    this.pressed.clear();
  }

  releaseAll() {
    this.down.clear();
    this.mouseFire = false;
    this.mouseBoost = false;
    this.stick = null;
    this.firePointers.clear();
    this.boostHeld = false;
    this.lookX = 0;
    this.lookY = 0;
  }

  /** Pointer capture keeps a drag alive past element edges; some browsers refuse it, which is fine. */
  #capture(element, pointerId) {
    try {
      element.setPointerCapture?.(pointerId);
    } catch {
      // Not capturable (pointer already released); the gesture still works without it.
    }
  }

  /** Switches to touch controls: no mouse steering, no pointer lock. */
  useTouch() {
    this.#markTouch();
  }

  #markTouch() {
    if (this.touchSeen) return;
    this.touchSeen = true;
    this.cursor = null;
    this.onTouch?.();
  }

  #touchDown(e) {
    if (e.pointerType === 'mouse') return;
    this.#markTouch();
    this.#capture(this.canvas, e.pointerId);
    const rect = this.canvas.getBoundingClientRect();
    if (e.clientX - rect.left < rect.width / 2) {
      if (!this.stick) this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    } else {
      this.firePointers.add(e.pointerId);
    }
  }

  #touchMove(e) {
    if (this.stick && e.pointerId === this.stick.id) {
      this.stick.x = e.clientX;
      this.stick.y = e.clientY;
    }
  }

  #touchUp(pointerId) {
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
      this.#capture(button, e.pointerId);
      set(true, e);
      button.classList.add('active');
    });
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
