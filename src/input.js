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

// Helm keys on the bridge.
const HELM = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyR', 'ArrowUp'],
  down: ['KeyF', 'ArrowDown'],
  faster: ['KeyW'],
  slower: ['KeyS'],
};

const NO_DEFAULT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab']);
const STICK_RADIUS = 64; // CSS px of thumb travel for full turn rate
const CURSOR_DEADZONE = 0.06;
const TAP_SLOP = 8; // px a press can move and still count as a click

/** Shapes a raw -1..1 axis: deadzone, then a gentle curve for fine aiming near the center. */
function curve(value, deadzone) {
  const m = Math.abs(value);
  if (m < deadzone) return 0;
  return Math.sign(value) * Math.min(1, ((m - deadzone) / (1 - deadzone)) ** 1.35);
}

/**
 * Keyboard, mouse and touch input for both seats.
 * - Bridge: drag the view (mouse or finger) to look around, click or tap to pick a target, keys for
 *   the helm and the crew orders. The cursor stays free for the command bar.
 * - Scout: fighter controls. With pointer lock the mouse steers; without it, the cursor's offset from
 *   center does; on touch, the left half is a stick and Fire/Boost are buttons.
 */
export class Input {
  constructor(canvas, { fireButton, boostButton }) {
    this.canvas = canvas;
    this.mode = 'bridge';
    this.down = new Set();
    this.pressed = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.cursor = null;
    this.drag = null;
    this.mouseFire = false;
    this.mouseBoost = false;
    this.stick = null;
    this.firePointers = new Set();
    this.boostHeld = false;
    this.locked = false;
    this.touchSeen = false;
    this.onTouch = null;
    this.onLockChange = null;
    this.onTap = null;
    this.helmPad = { x: 0, y: 0 }; // touch helm pad offset, -1..1 each way
    this.helmKnob = null;
    this.throttleSet = null; // a throttle the touch slider asked for, until the game takes it

    window.addEventListener('keydown', (e) => {
      if (NO_DEFAULT.has(e.code)) e.preventDefault();
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
      } else if (e.target === canvas && this.mode === 'pilot') {
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
      if (this.mode !== 'pilot') return;
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.mouseBoost = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) this.mouseBoost = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('pointerdown', (e) => this.#pointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.#pointerMove(e));
    for (const type of ['pointerup', 'pointercancel']) {
      canvas.addEventListener(type, (e) => this.#pointerUp(e, type === 'pointercancel'));
    }
    this.#holdButton(fireButton, (on, e) => {
      if (on) this.firePointers.add(e.pointerId);
      else this.firePointers.delete(e.pointerId);
    });
    this.#holdButton(boostButton, (on) => { this.boostHeld = on; });
  }

  setMode(mode) {
    this.mode = mode;
    this.releaseAll();
    this.cursor = null;
  }

  /** Captures the mouse for direct steering in a scout. Must be called from a click or key handler. */
  requestLock() {
    if (this.touchSeen || this.locked || this.mode !== 'pilot' || !this.canvas.requestPointerLock) return;
    try {
      this.canvas.requestPointerLock()?.catch?.(() => {});
    } catch {
      // Not allowed here (some embedded frames). Cursor steering still works.
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** How far the view was dragged (radians) since the last call, for looking around the bridge. */
  readLook() {
    const k = CONFIG.warship.lookSensitivity;
    const look = { yaw: -this.lookX * k, pitch: -this.lookY * k };
    this.lookX = 0;
    this.lookY = 0;
    return look;
  }

  /** Helm keys (or the touch helm pad) on the bridge: turn, climb and throttle, each -1..1. */
  readHelm() {
    const held = (codes) => codes.some((c) => this.down.has(c));
    const axis = (plus, minus) => (held(plus) ? 1 : 0) - (held(minus) ? 1 : 0);
    const clampAxis = (v) => Math.max(-1, Math.min(1, v));
    return {
      yaw: clampAxis(axis(HELM.left, HELM.right) - curve(this.helmPad.x, 0.15)),
      pitch: clampAxis(axis(HELM.up, HELM.down) - curve(this.helmPad.y, 0.15)),
      throttle: axis(HELM.faster, HELM.slower),
    };
  }

  /** The throttle setting from the touch slider, if it moved since the last call (0..1), else null. */
  takeThrottle() {
    const value = this.throttleSet;
    this.throttleSet = null;
    return value;
  }

  /**
   * The on-screen helm for touch: dragging the pad's knob turns and climbs the warship (it springs back
   * when let go), and the slider sets the throttle.
   */
  bindHelm(pad, slider) {
    if (!pad || !slider) return;
    this.helmKnob = pad.querySelector('.helm-knob');
    const drag = (element, onMove, onEnd) => {
      let id = null;
      element.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.#markTouch();
        if (id !== null) return;
        id = e.pointerId;
        this.#capture(element, id);
        element.classList.add('active');
        onMove(e, element.getBoundingClientRect());
      });
      element.addEventListener('pointermove', (e) => {
        if (e.pointerId === id) onMove(e, element.getBoundingClientRect());
      });
      const end = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        element.classList.remove('active');
        onEnd?.();
      };
      element.addEventListener('pointerup', end);
      element.addEventListener('pointercancel', end);
      element.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    drag(pad, (e, r) => {
      const half = r.width / 2;
      let x = (e.clientX - r.left - half) / half;
      let y = (e.clientY - r.top - half) / half;
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      this.helmPad.x = x;
      this.helmPad.y = y;
      this.#placeKnob(x * half * 0.6, y * half * 0.6);
    }, () => this.#centerHelm());
    drag(slider, (e, r) => {
      const value = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
      this.throttleSet = Math.round(value * 20) / 20;
    });
  }

  #placeKnob(x, y) {
    this.helmKnob?.style.setProperty('--kx', `${x}px`);
    this.helmKnob?.style.setProperty('--ky', `${y}px`);
  }

  #centerHelm() {
    this.helmPad.x = 0;
    this.helmPad.y = 0;
    this.#placeKnob(0, 0);
  }

  /** Fighter controls for this frame, merged across devices. Consumes accumulated mouse movement. */
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
    this.drag = null;
    this.firePointers.clear();
    this.boostHeld = false;
    this.lookX = 0;
    this.lookY = 0;
    this.throttleSet = null;
    this.#centerHelm();
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

  #capture(element, pointerId) {
    try {
      element.setPointerCapture?.(pointerId);
    } catch {
      // Not capturable (pointer already released); the gesture still works without it.
    }
  }

  #pointerDown(e) {
    if (e.pointerType !== 'mouse') this.#markTouch();
    if (this.mode === 'bridge') {
      if (e.button !== 0 || this.drag) return;
      this.#capture(this.canvas, e.pointerId);
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      return;
    }
    if (e.pointerType === 'mouse') return;
    this.#capture(this.canvas, e.pointerId);
    const rect = this.canvas.getBoundingClientRect();
    if (e.clientX - rect.left < rect.width / 2) {
      if (!this.stick) this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    } else {
      this.firePointers.add(e.pointerId);
    }
  }

  #pointerMove(e) {
    if (this.drag && e.pointerId === this.drag.id) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.lookX += dx;
      this.lookY += dy;
    }
    if (this.stick && e.pointerId === this.stick.id) {
      this.stick.x = e.clientX;
      this.stick.y = e.clientY;
    }
  }

  #pointerUp(e, cancelled) {
    if (this.drag && e.pointerId === this.drag.id) {
      const tap = !cancelled && this.drag.moved < TAP_SLOP;
      this.drag = null;
      if (tap) {
        const rect = this.canvas.getBoundingClientRect();
        this.onTap?.(e.clientX - rect.left, e.clientY - rect.top);
      }
    }
    if (this.stick && this.stick.id === e.pointerId) this.stick = null;
    this.firePointers.delete(e.pointerId);
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
