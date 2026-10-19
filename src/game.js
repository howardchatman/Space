import * as THREE from 'three';
import { CONFIG } from './config.js';
import { COMMANDS } from './commands.js';
import { Pipeline } from './engine/renderer.js';
import { bakeMilkyWay, createStars } from './world/sky.js';
import { Sun } from './world/sun.js';
import { useShadows } from './fx/shadows.js';
import { Planet } from './world/planet.js';
import { GasGiant } from './world/gasgiant.js';
import { LensFlare } from './fx/flare.js';
import { SpaceDust } from './world/dust.js';
import { AsteroidField } from './world/asteroids.js';
import { generateSector } from './world/sector.js';
import { Player, baseStats } from './entities/player.js';
import { Drone, buildDroneModel, shipTemplate } from './entities/drone.js';
import { Scout } from './entities/scout.js';
import { Flagship } from './entities/flagship.js';
import { Satellite } from './entities/satellite.js';
import { CapitalShip } from './entities/capital.js';
import { buildCapitalShip, buildCorvette } from './entities/shipmodel.js';
import { Corvette } from './entities/corvette.js';
import { Torpedo } from './entities/torpedo.js';
import { Bolts, segmentHitsSphere, sphereEntry } from './entities/bolts.js';
import { Pickups } from './entities/pickups.js';
import { Effects } from './fx/effects.js';
import { WarpTunnel } from './fx/warp.js';
import { Trails } from './fx/trails.js';
import { glowTexture } from './fx/textures.js';
import { addMuzzleFlashes, buildCockpit } from './cockpit.js';
import { buildBridge } from './bridge.js';
import { BridgeCrew } from './bridgecrew.js';
import { Hud } from './hud.js';
import { TacticalMap } from './tactical.js';
import { Engineering, SYSTEMS } from './engineering.js';
import { UPGRADES, baseShipStats, rollUpgrades } from './upgrades.js';
import { DERELICTS, FIGHTERS, SCOUT, getModel, modelsReady } from './models.js';
import { clamp, rand, randInt, randomUnit, smooth } from './util/math.js';

const BEST_KEY = 'deep-field:best';
const pad2 = (n) => String(n).padStart(2, '0');
const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const ZERO = new THREE.Vector3();
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const FOG_SIZE = 64;
const VISUAL_RANGE = 3500; // the flagship is big enough to spot by eye from here
const TITLE_SEED = 20261010;

// Scout cannon muzzles in the scout's frame (meters).
const MUZZLES = {
  left: new THREE.Vector3(-2.4, -1.4, -3.5),
  right: new THREE.Vector3(2.4, -1.4, -3.5),
  nose: new THREE.Vector3(0, -1.9, -3.5),
};

// Explosion color ramps: [flash, body, smoke].
const DUST_TINT = [new THREE.Color(1, 0.95, 0.85), new THREE.Color(0.42, 0.36, 0.3), new THREE.Color(0.12, 0.1, 0.09)];

function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(score) {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // Storage unavailable; the best score lasts for this session only.
  }
}

/**
 * Owns the 3D world and the state machine:
 * title → playing ⇄ paused, playing → warp → upgrade (refit) → playing, playing → gameover.
 * While playing you are either on the bridge commanding the warship, or flying a recon scout.
 */
export class Game {
  constructor({ canvas, hudCanvas, ui, input, sound, crew, palette }) {
    this.canvas = canvas;
    this.ui = ui;
    this.input = input;
    this.sound = sound;
    this.crew = crew;
    this.palette = palette;
    this.voice = null;
    this.lowPower = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const color = (css) => new THREE.Color(css);
    this.colors = {
      flare: color(palette.flare),
      flareHot: color(palette.flareHot),
      hostile: color(palette.hostile),
      ice: color(palette.ice),
      energy: color(palette.energy),
    };

    this.pipeline = new Pipeline(canvas, { lowPower: this.lowPower });
    const renderer = this.pipeline.renderer;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CONFIG.fov, 1, 0.3, 260000);
    this.scene.add(this.camera);
    this.pipeline.attach(this.scene, this.camera);

    // Sky and lighting. The sun direction is one shared vector the planet and sun both read.
    this.sunDirection = new THREE.Vector3(0.36, 0.27, -0.89).normalize();
    this.milkyWay = null; // baked with each sector's nebula in #buildSector
    this.stars = createStars(this.lowPower ? 6000 : 9500);
    this.scene.add(this.stars);
    this.sun = new Sun(this.sunDirection);
    this.sun.direction = this.sunDirection;
    this.scene.add(this.sun.light, this.sun.group);
    this.shadows = this.pipeline.shadows;
    if (this.shadows) this.sun.enableShadows(this.scene);
    this.planetShine = new THREE.DirectionalLight(0x5f84bd, 0.22);
    // A faint fill from the starfield and nebulae, so the night sides of the ships still show their shape.
    this.fill = new THREE.HemisphereLight(0x7d8cb0, 0x2a2420, 0.6);
    this.scene.add(this.planetShine, this.fill, new THREE.AmbientLight(0xffffff, 0.02));
    // One interior light on the camera serves both the bridge and the scout cockpit.
    this.interiorLight = new THREE.PointLight(0xffd8b0, 2, 24, 2);
    this.camera.add(this.interiorLight);
    this.flare = new LensFlare(this.camera);
    this._sunQ = new THREE.Quaternion();
    this._sunV = new THREE.Vector3();
    this.planet = null;

    this.dust = new SpaceDust(this.lowPower ? 450 : 700);
    this.scene.add(this.dust.lines);
    this.field = new AsteroidField(this.scene, { lowPower: this.lowPower, shadows: this.shadows });
    this.bolts = new Bolts(this.scene, {
      fighter: { radius: 0.07, length: 28, color: this.colors.flare.clone().multiplyScalar(1.7), glow: 2.2 },
      battery: { radius: 0.9, length: 46, color: this.colors.flare.clone().multiplyScalar(2.4), glow: 14 },
      hostile: { radius: 0.3, length: 14, color: this.colors.hostile.clone().multiplyScalar(6), glow: 6 },
      hostileBattery: { radius: 0.9, length: 40, color: this.colors.hostile.clone().multiplyScalar(4), glow: 16 },
      pd: { radius: 0.14, length: 18, color: this.colors.flare.clone().lerp(new THREE.Color(1, 1, 0.85), 0.5).multiplyScalar(2.2), glow: 3 },
      pdHostile: { radius: 0.14, length: 18, color: this.colors.hostile.clone().lerp(new THREE.Color(1, 0.9, 0.85), 0.35).multiplyScalar(2.2), glow: 3 },
    });
    this.pickups = new Pickups(this.scene, { energy: this.colors.energy, shield: this.colors.ice, overdrive: this.colors.flareHot });
    this.trails = new Trails(this.scene);
    this.effects = new Effects(this.scene, this.field.geometries.small[0], this.field.materials[1]);
    this.#buildTemplates();

    // Your warship and its bridge.
    const model = buildCapitalShip({ hostile: false, seed: 7, colors: this.colors });
    this.scene.add(model.object);
    if (this.shadows) useShadows(model.object); // before the bridge goes on: it never shades its own view
    this.warship = new CapitalShip(model, {
      hull: CONFIG.warship.hull,
      shield: CONFIG.warship.shield,
      maxSpeed: CONFIG.warship.maxSpeed,
      yawRate: CONFIG.warship.yawRate,
      pitchRate: CONFIG.warship.pitchRate,
      accel: CONFIG.warship.accel,
      turnAccel: CONFIG.warship.turnAccel,
    });
    this.warship.name = 'Your warship';
    this.bridge = buildBridge(this.colors);
    model.bridgeAnchor.add(this.bridge);
    this.bridgeCrew = new BridgeCrew(this.bridge, this.colors);
    crew.onSay = (station) => this.bridgeCrew.speak(station);
    this.beam = this.#buildBeam();

    this.cockpit = buildCockpit({ flare: this.colors.flare, ice: this.colors.ice });
    this.cockpit.visible = false;
    this.camera.add(this.cockpit);
    this.muzzleFlashes = addMuzzleFlashes(this.camera, MUZZLES, this.colors.flare, glowTexture());
    this.tunnel = new WarpTunnel(this.camera, this.colors.ice);

    this.hud = new Hud(hudCanvas, palette);
    this.map = new TacticalMap(ui.mapCanvas, palette);
    this.engineering = new Engineering(ui.engineeringRoot, {
      onRepair: (id) => this.#repair(id),
      onClose: () => this.#setEngineering(false),
      onRotate: () => this.sound.rotate(),
    });

    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.time = 0;
    this.best = loadBest();
    this.fov = CONFIG.fov;
    this.baseFov = CONFIG.fov;
    this.mode = 'bridge';
    this.look = { yaw: 0, pitch: -0.1 };
    this.mapOpen = false;
    this.mapMode = 'course';
    this.popups = [];
    this.shake = 0;
    this.hurt = 0;
    this.hitMarker = 0;
    this.damage = null;
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');

    input.onTap = (x, y) => this.#tap(x, y);

    this.#resetRun();
    this.#buildSector(1, TITLE_SEED);
    this.setState('title');
    this.ui.setBest(this.best);
    this.ui.show('title');
    this.ui.setHudVisible(false);
    this.ui.setMode('bridge');
  }

  // ---------- Setup ----------

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.lowPower ? 1.5 : CONFIG.maxPixelRatio);
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.pipeline.setSize(width, height, dpr);
    this.hud.resize(width, height, dpr);
    this.map.resize(width, height, dpr);

    // Keep at least ~75 degrees of horizontal view on portrait screens.
    const aspect = width / height;
    const minHorizontal = THREE.MathUtils.degToRad(75);
    const portraitFov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minHorizontal / 2) / aspect));
    this.baseFov = clamp(Math.max(CONFIG.fov, portraitFov), CONFIG.fov, 100);
    this.camera.aspect = aspect;
    this.#applyFov(this.baseFov);
    this.stars.material.uniforms.uPixelRatio.value = dpr;
  }

  setState(state) {
    this.state = state;
    this.stateTime = 0;
  }

  #resetRun() {
    this.runSeed = Math.floor(Math.random() * 1e6);
    this.shipStats = baseShipStats();
    this.levels = {};
    this.systems = Object.fromEntries(SYSTEMS.map((s) => [s.id, 1]));
    this.energy = this.shipStats.maxEnergy;
    this.power = 'balanced';
    this.score = 0;
    this.chain = 0;
    this.multiplier = 1;
    this.comboTimer = 0;
    const w = this.warship;
    w.maxHull = w.hull = this.shipStats.maxHull;
    w.maxShield = w.shield = this.shipStats.maxShield;
    w.dead = false;
    w.object.visible = true;
    this.wrecks = this.wrecks?.filter((wreck) => wreck.ship !== w) ?? [];
    this.#mend(w);
    w.fires = [];
    this.brownout = null; // a brief dip in the bridge lights after a heavy hit
    this.brownoutReady = 0;
    this.hurtShown = 0;
    this.lastHit = -10;
    this.alerts = {};
    this.deathTimer = 0;
  }

  /**
   * Small-craft templates: the ship models once they've loaded (fighters in three designs), the built-in
   * ones before that or if they fail.
   */
  #buildTemplates() {
    if (this.templatesFromModels) return;
    const fighters = FIGHTERS.map((name) => shipTemplate(name, this.colors.hostile, 11)).filter(Boolean);
    this.droneTemplates = fighters.length ? fighters : [buildDroneModel(this.colors.hostile)];
    this.scoutTemplate = shipTemplate(SCOUT, this.colors.ice, 10) ?? buildDroneModel(this.colors.ice, 0xb9bec7);
    if (this.shadows) for (const t of [...this.droneTemplates, this.scoutTemplate]) useShadows(t);
    this.templatesFromModels = modelsReady() && fighters.length > 0;
  }

  /** Clears the sector and lays out a new one around the warship. */
  #buildSector(index, seed) {
    this.#clearSector();
    this.#buildTemplates();
    this.sectorIndex = index;
    const spec = generateSector(index, seed);
    this.spec = spec;

    // Sky.
    this.milkyWay?.dispose();
    this.milkyWay = bakeMilkyWay(this.renderer, this.lowPower ? 256 : 512, spec.nebula);
    this.scene.background = this.milkyWay.texture;
    this.sunDirection.copy(spec.sunDirection);
    this.sun.light.position.copy(this.sunDirection);
    if (this.planet) {
      this.scene.remove(this.planet.group);
      this.planet.dispose?.();
    }
    const World = spec.planet.type === 'gas' ? GasGiant : Planet;
    this.planet = new World({
      ...spec.planet,
      renderer: this.renderer,
      sunDirection: this.sunDirection,
      bakeSize: this.lowPower ? 512 : 1024,
    });
    this.scene.add(this.planet.group);
    this.planetShine.position.copy(spec.planet.position).normalize();
    this.planetShine.color.copy(this.planet.shineColor);

    if (spec.landmark) this.field.placeLandmark(spec.landmark.position, spec.landmark.radius);
    for (const c of spec.clusters) this.field.populateCluster(c.center, c.radius, c.count);
    this.satellites = spec.satellites.map((p, i) => {
      const model = getModel(DERELICTS[(seed + i) % DERELICTS.length]);
      const sat = new Satellite(p, `Derelict ${String.fromCharCode(65 + i)}`, model);
      this.scene.add(sat.object);
      if (this.shadows) useShadows(sat.object);
      return sat;
    });

    const flagModel = buildCapitalShip({ hostile: true, seed: seed + 1, colors: this.colors });
    if (this.shadows) useShadows(flagModel.object);
    this.scene.add(flagModel.object);
    this.flagship = new Flagship(flagModel, index);
    this.flagship.avoid = this.#avoid();
    this.warship.avoid = this.#avoid();
    this.flagship.position.copy(spec.flagship);
    this.flagship.setHeading(rand(0, Math.PI * 2));

    // Corvette escorts around the flagship, and a roaming corvette from sector 2 on.
    for (let i = 0; i < Math.min(index, 3); i++) {
      const offset = new THREE.Vector3(Math.cos(i * 2.1), 0, Math.sin(i * 2.1)).multiplyScalar(650);
      this.#spawnCorvette(offset.add(spec.flagship), this.flagship, seed + 10 + i);
    }
    if (index >= 2 && spec.patrols.length) {
      this.#spawnCorvette(spec.patrols[0].position.clone().add(new THREE.Vector3(250, 0, 0)), null, seed + 20);
    }

    for (const patrol of spec.patrols) {
      for (let i = 0; i < patrol.size; i++) {
        const p = randomUnit(new THREE.Vector3()).multiplyScalar(120).add(patrol.position);
        const d = this.#spawnDrone(p, false);
        d.home.copy(patrol.position);
        d.face(randomUnit(new THREE.Vector3()));
      }
    }

    const w = this.warship;
    w.position.copy(spec.start);
    w.velocity.set(0, 0, 0);
    w.throttle = 0;
    w.yawRate = w.pitchRate = 0;
    w.setHeading(0, 0);

    this.fog = new Uint8Array(FOG_SIZE * FOG_SIZE);
    this.fogExtent = CONFIG.sector.radius * 1.1;
    this.scoutsDocked = this.shipStats.scouts;
    this.scoutNames = Array.from({ length: this.shipStats.scouts }, (_, i) => `Recon ${i + 1}`);
    this.flagshipKnown = false;
    this.flagshipSeen = false;
    this.flagshipLastSeen = null;
    this.flagshipDeath = null;
    this.warpReady = false;
    this.target = null;
    this.course = null;
    this.cannon = { volley: 0, reload: 0, reloadTotal: 1, timers: w.model.turrets.map(() => 0), barrel: 0 };
    this.ray = { phase: 'idle', t: 0, cooldown: 0, cooldownTotal: 1, pending: 0, target: null };
    this.senseTimer = 0;
    this.targetTimer = 0;
    this.pdTimer = 0;
    this.torpedoStock = this.shipStats.torpedoes;
    this.tubes = { reload: 0, total: 1 };
    this.evasive = { t: 0, cooldown: 0, total: 1, phase: 0 };
    this.dc = { t: 0, cooldown: 0, total: 1, system: null };
    this.report = { start: this.time, fighters: 0, corvettes: 0, torpedoes: 0, parts: 0, hullLost: 0, salvage: 0 };
  }

  #spawnCorvette(position, escort, seed) {
    const model = buildCorvette({ seed, colors: this.colors });
    if (this.shadows) useShadows(model.object);
    this.scene.add(model.object);
    const c = new Corvette(model, this.sectorIndex, escort);
    c.avoid = this.#avoid();
    c.position.copy(position);
    c.home.copy(position);
    c.setHeading(rand(0, Math.PI * 2), 0);
    this.corvettes.push(c);
    return c;
  }

  /** What capital ships steer around: the sector's giant asteroid, if it has one. */
  #avoid() {
    return this.field.landmark ? [this.field.landmark] : [];
  }

  #clearSector() {
    this.#exitPilot(true);
    for (const d of this.drones ?? []) this.scene.remove(d.object);
    for (const s of this.scouts ?? []) this.scene.remove(s.object);
    for (const s of this.satellites ?? []) this.scene.remove(s.object);
    if (this.flagship) this.scene.remove(this.flagship.object);
    for (const c of this.corvettes ?? []) this.scene.remove(c.object);
    for (const t of this.torpedoes ?? []) this.scene.remove(t.object);
    this.corvettes = [];
    this.torpedoes = [];
    this.burning = [];
    this.wrecks = this.wrecks.filter((wreck) => wreck.ship === this.warship);
    this.drones = [];
    this.scouts = [];
    this.launchQueue = [];
    this.satellites = [];
    this.flagship = null;
    this.field.clear();
    this.bolts.clear();
    this.pickups.clear();
    this.effects.clear();
    this.trails.clear();
    this.popups = [];
    this.damage = null;
    this.beam.group.visible = false;
  }

  // ---------- Flow ----------

  start() {
    if (!modelsReady()) return; // the start button waits for the 3D models
    this.#resetRun();
    this.#buildSector(1, this.runSeed);
    this.#setMap(false);
    this.#setEngineering(false);
    this.setState('playing');
    this.ui.show(null);
    this.ui.setHudVisible(true);
    this.ui.setMode('bridge');
    this.ui.clearComms();
    this.look = { yaw: 0, pitch: -0.1 };
    this.sound.select();
    this.#arrive();
  }

  /** Crew chatter and objective when a sector begins. */
  #arrive() {
    this.ui.banner(`Sector ${pad2(this.sectorIndex)}`, 'Find the enemy flagship');
    this.crew.say('Helm', `We've arrived in sector ${this.sectorIndex}, Captain.`, { speak: false });
    this.crew.say('Sensors', 'No sign of the enemy flagship. Recommend sending out the recon.');
  }

  chooseUpgrade(id) {
    if (this.state !== 'upgrade') return;
    const upgrade = UPGRADES.find((u) => u.id === id);
    if (upgrade) {
      upgrade.apply(this.shipStats, this.warship);
      this.levels[id] = (this.levels[id] ?? 0) + 1;
    }
    this.scoutsDocked = this.shipStats.scouts;
    this.scoutNames = Array.from({ length: this.shipStats.scouts }, (_, i) => `Recon ${i + 1}`);
    this.torpedoStock = this.shipStats.torpedoes;
    this.sound.select();
    this.setState('playing');
    this.ui.show(null);
    this.ui.setHudVisible(true);
    this.#arrive();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.sound.setThrust(0);
    this.input.releaseAll();
    this.input.releaseLock();
    this.ui.show('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.setState('playing');
    this.input.requestLock();
    this.ui.show(null);
  }

  toTitle() {
    this.#exitPilot(true);
    this.#setMap(false);
    this.#setEngineering(false);
    this.#resetRun();
    this.#buildSector(1, TITLE_SEED);
    this.setState('title');
    this.sound.setThrust(0);
    this.ui.setHudVisible(false);
    this.ui.setBest(this.best);
    this.ui.show('title');
  }

  endRun() {
    const newBest = this.score > this.best;
    if (newBest) {
      this.best = this.score;
      saveBest(this.best);
    }
    this.setState('gameover');
    this.input.releaseLock();
    this.#setMap(false);
    this.#setEngineering(false);
    this.ui.setHudVisible(false);
    this.ui.showGameOver({ score: this.score, wave: this.sectorIndex, best: this.best, newBest });
  }

  toggleMute() {
    this.sound.setMuted(!this.sound.muted);
    this.ui.setMuted(this.sound.muted);
  }

  toggleCrewVoice() {
    this.crew.setVoice(!this.crew.voiceOn);
    this.ui.setCrewVoice(this.crew.voiceOn);
  }

  /** The mouse was released while flying a scout: stop rather than fly blind. */
  onLockChange(locked) {
    if (!locked && this.state === 'playing' && this.mode === 'pilot') this.pause();
  }

  /** A click on the tactical map: set a course there. */
  mapClick(x, y) {
    if (this.state !== 'playing') return;
    const p = this.map.toWorld(x, y, CONFIG.sector.radius);
    const point = new THREE.Vector3(p.x, this.warship.position.y, p.z);
    if (point.length() > CONFIG.sector.radius * 1.05) {
      this.crew.say('Helm', "That's outside the sector, Captain.");
      return;
    }
    // A point on the giant asteroid moves out beside it.
    const lm = this.field.landmark;
    const off = lm && point.clone().sub(lm.position).setY(0);
    if (off && off.length() < lm.radius + 450) {
      if (off.lengthSq() < 1) off.set(1, 0, 0);
      point.copy(lm.position).addScaledVector(off.normalize(), lm.radius + 450).setY(point.y);
    }
    if (this.mapMode === 'recon') {
      this.#sendRecon(point);
      return;
    }
    this.course = { point, arrive: 250, label: 'waypoint' };
    if (this.warship.throttle < 0.6) this.warship.throttle = 0.85;
    this.crew.say('Helm', `Course laid in. ${km(point.distanceTo(this.warship.position))} to go.`);
  }

  /** 'course' or 'recon': what a click on the tactical map does. */
  setMapMode(mode) {
    this.mapMode = mode;
    this.ui.setMapMode(mode);
  }

  /** Sends the nearest free scout (launching one if needed) to scout a point. */
  #sendRecon(point) {
    let scout = this.scouts
      .filter((s) => !s.dead && !s.piloted && s.state !== 'docking')
      .sort((a, b) => a.position.distanceTo(point) - b.position.distanceTo(point))[0];
    if (!scout && this.scoutsDocked > 0) {
      scout = this.#launchScout();
      this.scoutsDocked -= 1;
    }
    if (!scout) {
      this.crew.say('Flight deck', 'No scouts free, Captain.');
      return;
    }
    point.y += rand(-120, 120);
    scout.setRoute([point]);
    this.crew.say('Flight deck', `${scout.name} heading for the marked point, ${km(point.distanceTo(scout.position))} out.`);
  }

  // ---------- Orders ----------

  /** Carries out an order from a button, hotkey or voice. */
  command(id, source = 'key') {
    if (this.state !== 'playing') return;
    if (this.warship.dead) return;
    if (source === 'voice') this.sound.select();
    switch (id) {
      case 'cannons': return this.#orderCannons();
      case 'deathray': return this.#orderDeathRay();
      case 'torpedoes': return this.#orderTorpedoes();
      case 'evasive': return this.#orderEvasive();
      case 'damage-control': return this.#orderDamageControl();
      case 'recon': return this.#orderRecon();
      case 'recall': return this.#orderRecall();
      case 'course': return this.#orderCourse();
      case 'pilot': return this.mode === 'pilot' ? this.#exitPilot() : this.#enterPilot();
      case 'return': return this.#exitPilot();
      case 'engineering': return this.#setEngineering(!this.engineering.isOpen);
      case 'map': return this.#setMap(!this.mapOpen);
      case 'full':
        this.warship.throttle = 1;
        return this.crew.say('Helm', 'Ahead full.');
      case 'stop':
        this.warship.throttle = 0;
        this.course = null;
        return this.crew.say('Helm', 'All stop.');
      case 'target': return this.#cycleTarget();
      case 'target-guns': return this.#targetPart('gun');
      case 'target-engines': return this.#targetPart('engines');
      case 'target-hangar': return this.#targetPart('hangar');
      case 'target-hull': return this.#targetPart(null);
      case 'power-weapons':
      case 'power-shields':
      case 'power-engines':
      case 'power-balanced': return this.#setPower(id.slice(6));
      case 'warp': return this.#orderWarp();
      default: return undefined;
    }
  }

  toggleVoice() {
    this.voice?.toggle();
  }

  #orderCannons() {
    const c = this.cannon;
    if (this.systems.weapons < 0.1) return this.crew.say('Weapons', 'The batteries are offline. We need engineering on it.');
    const target = this.#weaponsTarget();
    if (!target) return this.crew.say('Weapons', 'No target, Captain. Pick one out for us.');
    if (target.kind === 'satellite') return this.crew.say('Weapons', "That's a derelict, Captain. Nothing to shoot.");
    if (c.volley > 0) return undefined;
    if (c.reload > 0) return this.crew.say('Weapons', `Batteries reloading, ${Math.ceil(c.reload)} seconds.`);
    const dist = target.position.distanceTo(this.warship.position);
    if (dist > CONFIG.warship.cannon.range) {
      return this.crew.say('Weapons', `Target's out of range at ${km(dist)}. Get us inside ${km(CONFIG.warship.cannon.range)}.`);
    }
    this.target = target;
    c.volley = CONFIG.warship.cannon.volley;
    c.reloadTotal = (this.shipStats.reload * this.#pf('reload')) / (0.4 + 0.6 * this.systems.weapons);
    c.reload = c.reloadTotal;
    return this.crew.say('Weapons', 'Firing main batteries!');
  }

  #orderDeathRay() {
    const r = this.ray;
    const cfg = CONFIG.warship.deathRay;
    if (r.phase !== 'idle') return undefined;
    if (this.systems.weapons < 0.25) return this.crew.say('Weapons', "The ray emitter's damaged. Repair weapons first.");
    if (r.cooldown > 0) return this.crew.say('Weapons', `Ray capacitors recharging, ${Math.ceil(r.cooldown)} seconds.`);
    if (this.evasive.t > 0) return this.crew.say('Weapons', "Can't hold the ray steady while we're evading, Captain.");
    const cost = this.shipStats.rayCost;
    if (this.energy < cost) return this.crew.say('Engineering', `Not enough energy for the ray. We need ${cost}, we have ${Math.floor(this.energy)}.`);
    const target = this.#weaponsTarget();
    if (!target) return this.crew.say('Weapons', 'No target for the ray, Captain.');
    if (target.kind === 'satellite') return this.crew.say('Weapons', "That's a derelict, Captain. Not worth the energy.");
    const dist = target.position.distanceTo(this.warship.position);
    if (dist > cfg.range) return this.crew.say('Weapons', `Target's out of ray range at ${km(dist)}.`);
    this.target = target;
    if (!this.#inRayArc(target)) {
      r.pending = 25;
      r.target = target;
      this.course = { entity: target, arrive: 900, label: target.name };
      return this.crew.say('Helm', "Target's outside the ray's arc. Bringing us about. The ray fires when we're lined up.");
    }
    return this.#chargeRay(target);
  }

  /** A salvo from the bow tubes. Torpedoes home on the target and hit hard, but point defense can stop them. */
  #orderTorpedoes() {
    const cfg = CONFIG.warship.torpedo;
    if (this.systems.weapons < 0.1) return this.crew.say('Weapons', 'Torpedo control is offline. We need engineering on it.');
    if (this.torpedoStock <= 0) return this.crew.say('Weapons', "We're out of torpedoes, Captain. Derelicts may carry some, or we restock at the next jump.");
    if (this.tubes.reload > 0) return this.crew.say('Weapons', `Tubes reloading, ${Math.ceil(this.tubes.reload)} seconds.`);
    const target = this.#weaponsTarget();
    if (!target) return this.crew.say('Weapons', 'No target for the torpedoes, Captain.');
    if (target.kind === 'satellite') return this.crew.say('Weapons', "That's a derelict, Captain. Not worth a torpedo.");
    const w = this.warship;
    const dist = target.position.distanceTo(w.position);
    if (dist > cfg.range) return this.crew.say('Weapons', `Target's out of torpedo range at ${km(dist)}. Get us inside ${km(cfg.range)}.`);
    this.target = target;
    const count = Math.min(cfg.salvo, this.torpedoStock);
    const damage = this.shipStats.torpedoDamage * this.#pf('damage');
    for (let i = 0; i < count; i++) {
      const tube = w.model.torpedoTubes[i % w.model.torpedoTubes.length];
      const origin = w.object.localToWorld(tube.position.clone());
      const dir = tube.direction.clone().transformDirection(w.object.matrixWorld);
      const t = new Torpedo(origin, dir, target, this.colors.ice, { spec: CONFIG.ourTorpedo, hostile: false, damage });
      this.scene.add(t.object);
      this.torpedoes.push(t);
      this.trails.attach(t, { color: this.colors.ice.clone().multiplyScalar(0.5), width: 1.2, offset: new THREE.Vector3(0, 0, -3.5) });
      this.effects.flash(origin, this.colors.ice, 10, 0.25, 1.5);
    }
    this.torpedoStock -= count;
    this.tubes.total = (cfg.reload * this.#pf('reload')) / (0.4 + 0.6 * this.systems.weapons);
    this.tubes.reload = this.tubes.total;
    this.sound.torpedo();
    this.shake = Math.max(this.shake, 0.2);
    const left = this.torpedoStock === 0 ? 'That was our last.' : `${this.torpedoStock} left.`;
    return this.crew.say('Weapons', `${count > 1 ? 'Torpedoes' : 'Torpedo'} away! ${left}`);
  }

  /** The helm weaves for a few seconds: half the shots and torpedoes aimed at us miss, but our aim suffers. */
  #orderEvasive() {
    const e = this.evasive;
    if (e.t > 0) return undefined;
    if (e.cooldown > 0) return this.crew.say('Helm', `The helm needs a moment, ${Math.ceil(e.cooldown)} seconds.`);
    if (this.systems.engines < 0.2) return this.crew.say('Helm', "The engines are too weak to evade, Captain.");
    e.t = CONFIG.evasive.duration;
    e.phase = rand(0, Math.PI * 2);
    this.ray.pending = 0;
    return this.crew.say('Helm', 'Evasive maneuvers! Hold on to something!');
  }

  /** Repair crews patch the hull and the worst-hit system over a few seconds, for some energy. */
  #orderDamageControl() {
    const d = this.dc;
    const cfg = CONFIG.damageControl;
    if (d.t > 0) return this.crew.say('Damage control', 'Teams are already working on it, Captain.');
    if (d.cooldown > 0) return this.crew.say('Damage control', `Teams are regrouping, ${Math.ceil(d.cooldown)} seconds.`);
    const w = this.warship;
    const worst = SYSTEMS.reduce((a, b) => (this.systems[b.id] < this.systems[a.id] ? b : a));
    if (w.hull >= w.maxHull - 1 && this.systems[worst.id] >= 0.99) return this.crew.say('Damage control', "Nothing to patch, Captain. She's in one piece.");
    if (this.energy < cfg.cost) return this.crew.say('Engineering', `Damage control needs ${cfg.cost} energy. We have ${Math.floor(this.energy)}.`);
    this.energy -= cfg.cost;
    d.t = cfg.duration;
    d.system = worst.id;
    return this.crew.say('Damage control', `Damage control teams on it. Patching the hull and the ${worst.name.toLowerCase()}.`);
  }

  #chargeRay(target) {
    const r = this.ray;
    const cfg = CONFIG.warship.deathRay;
    r.phase = 'charge';
    r.t = cfg.charge;
    r.target = target;
    r.pending = 0;
    this.energy -= this.shipStats.rayCost;
    this.sound.rayCharge(cfg.charge);
    this.crew.say('Weapons', 'Charging the death ray!');
  }

  #orderRecon() {
    const n = this.scoutsDocked;
    if (n === 0) {
      return this.crew.say('Flight deck', this.scouts.length ? 'All our scouts are already out, Captain.' : 'No scouts left in the hangar.');
    }
    const w = this.warship;
    const forward = w.forward(new THREE.Vector3());
    forward.y = 0;
    forward.normalize();
    const R = CONFIG.sector.radius * 0.95;
    for (let i = 0; i < n; i++) {
      const angle = n === 1 ? 0 : -1.15 + (2.3 * i) / (n - 1);
      const dir = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      const route = [1, 2].map((k) => {
        const p = dir.clone().multiplyScalar(CONFIG.scout.patrolDistance * k).add(w.position);
        p.y = w.position.y + rand(-150, 150);
        if (p.length() > R) p.setLength(R);
        return p;
      });
      this.launchQueue.push({ at: this.time + i * 0.7, route });
    }
    this.scoutsDocked = 0;
    return this.crew.say('Flight deck', `Launching the recon flight. ${n === 1 ? 'One bird' : `${n} birds`} away.`);
  }

  #orderRecall() {
    const out = this.scouts.filter((s) => !s.piloted);
    this.launchQueue.length = 0;
    if (!out.length) return this.crew.say('Flight deck', 'No scouts are out, Captain.');
    for (const s of out) s.recall();
    return this.crew.say('Flight deck', 'Recalling the recon flight.');
  }

  #orderCourse() {
    const target = this.target && !this.target.dead ? this.target : null;
    if (!target) return this.crew.say('Helm', 'Course to where, Captain? Pick a target, or a point on the map.');
    const arrive = target.kind === 'flagship' ? 1300 : target.kind === 'satellite' ? 200 : 500;
    this.course = { entity: target, arrive, label: target.name };
    if (this.warship.throttle < 0.6) this.warship.throttle = 0.9;
    return this.crew.say('Helm', `Setting course for the ${target.name.toLowerCase()}, ${km(target.position.distanceTo(this.warship.position))}.`);
  }

  #orderWarp() {
    if (this.state !== 'playing') return undefined;
    if (!this.warpReady) {
      return this.crew.say('Engineering', this.flagship && !this.flagship.dead
        ? "The warp drive won't spool with the enemy flagship still out there."
        : 'Warp drive is still spooling, Captain.');
    }
    this.#exitPilot(true);
    this.#setMap(false);
    this.#setEngineering(false);
    // Scouts come aboard for the jump.
    for (const s of this.scouts) this.scene.remove(s.object);
    this.scouts = [];
    this.launchQueue = [];
    this.setState('warp');
    this.warpT = 0;
    this.warpSwapped = false;
    this.sound.warpSpool(2);
    this.crew.say('Helm', 'Engaging warp drive. Hold on to something.');
    return undefined;
  }

  #setPower(mode) {
    if (this.power === mode) return;
    this.power = mode;
    const lines = {
      weapons: 'Diverting power to weapons. Batteries will cycle faster, shields will be slow to recover.',
      shields: 'Diverting power to shields. They will soak more and recharge fast.',
      engines: 'All power to engines. She will move, but the guns will be slow.',
      balanced: 'Power balanced across all systems.',
    };
    this.crew.say('Engineering', lines[mode]);
  }

  /** Multiplier for one effect under the current power distribution. */
  #pf(effect) {
    return CONFIG.power[this.power][effect];
  }

  #cycleTarget() {
    const options = this.#targetables().filter((c) => c.hostile).map((c) => c.entity);
    if (!options.length) return this.crew.say('Weapons', 'No hostiles on the scope.', { speak: false });
    const w = this.warship.position;
    options.sort((a, b) => (a.kind === 'flagship' ? -1 : b.kind === 'flagship' ? 1 : a.position.distanceTo(w) - b.position.distanceTo(w)));
    const i = options.indexOf(this.target);
    this.target = options[(i + 1) % options.length];
    return this.crew.say('Weapons', `Target: ${this.target.name.toLowerCase()}, ${km(this.target.position.distanceTo(w))}.`, { speak: false });
  }

  #setMap(open) {
    this.mapOpen = open;
    this.ui.setMapOpen(open);
  }

  #setEngineering(open) {
    if (open && this.mode === 'pilot') {
      this.crew.say('Engineering', "You're out in a scout, Captain. We'll keep her together till you're back.");
      return;
    }
    if (open) this.engineering.open(this.systems);
    else this.engineering.close();
  }

  // ---------- Update ----------

  update(dt) {
    this.time += dt;
    this.stateTime += dt;
    const input = this.input;
    const settled = this.stateTime > 0.6;

    if (input.wasPressed('KeyM')) this.toggleMute();

    switch (this.state) {
      case 'title':
      case 'gameover':
        if (settled && input.wasPressed('Enter')) this.start();
        this.#updateWorld(dt);
        break;
      case 'paused':
        if (input.wasPressed('KeyP')) this.resume();
        break;
      case 'upgrade': {
        const index = ['Digit1', 'Digit2', 'Digit3'].findIndex((k, i) => input.wasPressed(k, `Numpad${i + 1}`));
        if (settled && index >= 0 && this.upgradeOptions[index]) this.chooseUpgrade(this.upgradeOptions[index].id);
        this.#updateWorld(dt);
        break;
      }
      case 'warp':
        this.#updateWarp(dt);
        break;
      case 'playing':
        if (input.wasPressed('Escape', 'KeyP')) {
          if (this.mapOpen) this.#setMap(false);
          else if (this.engineering.isOpen) this.#setEngineering(false);
          else this.pause();
          break;
        }
        if (input.wasPressed('KeyV')) this.toggleVoice();
        for (const c of COMMANDS) if (c.code && input.wasPressed(c.code)) this.command(c.id, 'key');
        if (this.state === 'playing') this.#updatePlay(dt);
        break;
    }
    input.endFrame();
  }

  #updatePlay(dt) {
    const w = this.warship;
    if (!w.dead) {
      this.#helm(dt);
      w.speedFactor = (0.35 + 0.65 * this.systems.engines) * this.shipStats.speed * this.#pf('speed');
      w.update(dt, this.time);
      this.#weapons(dt);
      this.#pointDefense(dt);
      this.#flagshipPointDefense(dt);
      this.#shipSystems(dt);
      this.#launches();
    } else {
      w.velocity.multiplyScalar(Math.exp(-0.3 * dt));
      w.position.addScaledVector(w.velocity, dt);
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this.endRun();
        return;
      }
    }
    if (this.mode === 'pilot') this.#updatePilot(dt);
    else if (this.mode === 'bridge' && !this.mapOpen) this.#updateLook(dt);

    this.#updateWorld(dt);
    this.#collide();
    this.#sweep();
    this.senseTimer -= dt;
    if (this.senseTimer <= 0) {
      this.senseTimer = 0.25;
      this.#sense();
    }
    this.targetTimer -= dt;
    if (this.targetTimer <= 0) {
      this.targetTimer = 0.5;
      this.#assignTargets();
    }
    this.#updateCombo(dt);
    this.#updateFlagshipDeath(dt);
    this.#updateHud();
  }

  #updateLook(dt) {
    const look = this.input.readLook();
    this.look.yaw = clamp(this.look.yaw + look.yaw, -2.7, 2.7);
    this.look.pitch = clamp(this.look.pitch + look.pitch, -1.2, 1.0);
    // Ease back toward the bow after a while of not looking around.
    if (!look.yaw && !look.pitch && !this.input.drag && this.stateTime > 1) {
      this.lookIdle = (this.lookIdle ?? 0) + dt;
      if (this.lookIdle > 6) {
        this.look.yaw *= Math.exp(-0.6 * dt);
        this.look.pitch += (-0.1 - this.look.pitch) * smooth(0.6, dt);
      }
    } else {
      this.lookIdle = 0;
    }
  }

  #helm(dt) {
    const w = this.warship;
    const manual = this.mode === 'bridge' && !this.engineering.isOpen;
    const h = manual ? this.input.readHelm() : { yaw: 0, pitch: 0, throttle: 0 };
    if ((h.yaw || h.pitch) && this.course) {
      this.course = null;
      this.crew.say('Helm', 'Manual helm, aye.', { speak: false });
    }
    if (h.throttle) w.throttle = clamp(w.throttle + h.throttle * dt * 0.35, -0.25, 1);
    const slider = manual ? this.input.takeThrottle() : null;
    if (slider !== null) w.throttle = slider;

    // Evasive maneuvers: weave in yaw and pitch at speed. A course resumes afterwards.
    if (this.evasive.t > 0) {
      const k = this.time * 1.3 + this.evasive.phase;
      w.yawCommand = Math.sin(k);
      w.pitchCommand = Math.sin(k * 0.7 + 1) * 0.6;
      w.throttle = Math.max(w.throttle, 0.75);
      return;
    }

    if (!this.course) {
      w.yawCommand = h.yaw;
      w.pitchCommand = h.pitch;
      return;
    }
    const point = this.course.entity ? (this.course.entity.dead ? null : this.course.entity.position) : this.course.point;
    if (!point) {
      this.course = null;
      return;
    }
    w.steerToward(point);
    const dist = point.distanceTo(w.position);
    if (dist < this.course.arrive) {
      if (this.course.entity?.kind === 'flagship' || this.course.entity?.kind === 'fighter') {
        // Keep the bow on a hostile, at fighting speed.
        w.throttle = Math.min(w.throttle, 0.25);
        if (!this.course.arrived) this.crew.say('Helm', `In position, ${km(dist)} off the ${this.course.label.toLowerCase()}. Bow on target.`);
        this.course.arrived = true;
      } else {
        this.crew.say('Helm', `We've arrived at the ${this.course.label.toLowerCase()}.`);
        w.throttle = Math.min(w.throttle, 0.15);
        this.course = null;
      }
    }
  }

  #weaponsTarget() {
    if (this.target && !this.target.dead && this.#isKnown(this.target)) return this.target;
    // Pick the nearest known hostile in range for the crew.
    const options = this.#targetables().filter((c) => c.hostile);
    if (!options.length) return null;
    const w = this.warship.position;
    options.sort((a, b) => a.entity.position.distanceTo(w) - b.entity.position.distanceTo(w));
    this.target = options[0].entity;
    return this.target;
  }

  #weapons(dt) {
    const w = this.warship;
    const c = this.cannon;
    const cfg = CONFIG.warship.cannon;
    c.reload = Math.max(0, c.reload - dt);
    this.tubes.reload = Math.max(0, this.tubes.reload - dt);
    const spread = cfg.spread * (this.evasive.t > 0 ? 2.5 : 1);
    const target = this.target && !this.target.dead && this.target.kind !== 'satellite' ? this.target : null;
    if (target) {
      const dist = target.position.distanceTo(w.position);
      const lead = target.position.clone().addScaledVector(target.velocity ?? ZERO, dist / cfg.boltSpeed);
      const ready = w.aimTurrets(lead, dt);
      if (c.volley > 0) {
        c.volley -= dt;
        w.model.turrets.forEach((t, i) => {
          c.timers[i] -= dt;
          if (!ready.includes(t) || c.timers[i] > 0) return;
          c.timers[i] = cfg.shotGap * rand(0.85, 1.15);
          for (let b = 0; b < t.muzzles.length; b++) {
            const origin = w.muzzle(t, b);
            const dir = lead.clone().sub(origin).normalize();
            dir.add(randomUnit(new THREE.Vector3()).multiplyScalar(spread)).normalize();
            this.bolts.fire(origin, dir.multiplyScalar(cfg.boltSpeed).add(w.velocity), {
              look: 'battery',
              damage: this.shipStats.cannonDamage * this.#pf('damage'),
              life: (cfg.range / cfg.boltSpeed) * 1.15,
            });
            this.effects.flash(origin, this.colors.flare, 9, 0.12, 2.2);
          }
          this.sound.cannon(this.mode === 'bridge' ? 1 : 0.4);
          this.shake = Math.max(this.shake, 0.12);
        });
      }
    } else {
      c.volley = 0;
      w.restTurrets(dt);
    }
    this.#updateRay(dt);
  }

  #inRayArc(target) {
    const emitter = this.warship.model.emitter.group.getWorldPosition(new THREE.Vector3());
    const to = target.position.clone().sub(emitter);
    return to.angleTo(this.warship.forward(new THREE.Vector3())) < CONFIG.warship.deathRay.arc;
  }

  #updateRay(dt) {
    const r = this.ray;
    const cfg = CONFIG.warship.deathRay;
    const w = this.warship;
    const em = w.model.emitter;
    r.cooldown = Math.max(0, r.cooldown - dt);

    if (r.phase === 'idle' && r.pending > 0) {
      r.pending -= dt;
      const t = r.target;
      if (!t || t.dead) r.pending = 0;
      else if (this.evasive.t <= 0 && this.#inRayArc(t) && t.position.distanceTo(w.position) < cfg.range) {
        if (this.energy >= this.shipStats.rayCost && r.cooldown <= 0) this.#chargeRay(t);
        else r.pending = 0;
      }
    }

    let glow = 0.25;
    if (r.phase === 'charge') {
      r.t -= dt;
      glow = 0.25 + 2.5 * (1 - r.t / cfg.charge);
      this.effects.implode(em.group.getWorldPosition(this._v), 40, 3, em.color, 0.5);
      if (r.t <= 0) {
        r.phase = 'fire';
        r.t = cfg.duration;
        this.sound.rayFire(cfg.duration);
      }
    } else if (r.phase === 'fire') {
      r.t -= dt;
      glow = 3;
      this.#fireBeam(dt);
      if (r.t <= 0) {
        r.phase = 'idle';
        r.cooldownTotal = cfg.reload / (0.4 + 0.6 * this.systems.weapons);
        r.cooldown = r.cooldownTotal;
        this.beam.group.visible = false;
      }
    }
    em.coreMaterial.color.copy(em.color).multiplyScalar(0.6 + glow * 1.5);
    em.glow.material.color.copy(em.color).multiplyScalar(0.4 + glow * 1.2);
    em.glow.scale.setScalar(26 + glow * 22);
  }

  /** One frame of the death ray: draw the beam to the target and burn everything along it. */
  #fireBeam(dt) {
    const r = this.ray;
    const cfg = CONFIG.warship.deathRay;
    const w = this.warship;
    const origin = w.model.emitter.group.getWorldPosition(new THREE.Vector3());
    const t = r.target && !r.target.dead ? r.target : null;
    let end;
    if (t && this.#inRayArc(t)) end = t.position.clone();
    else end = w.forward(new THREE.Vector3()).multiplyScalar(cfg.range).add(origin);
    // The giant asteroid stops the beam, sparing whatever is behind it.
    const lm = this.field.landmark;
    const blocked = lm ? sphereEntry(origin, end, lm.position, lm.radius * 0.97) : null;
    if (blocked) end = blocked;
    const length = end.distanceTo(origin);
    const dir = end.clone().sub(origin).normalize();

    const b = this.beam;
    b.group.visible = true;
    b.group.position.copy(origin);
    b.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    const flicker = 1 + Math.sin(this.time * 9) * 0.04;
    b.core.scale.set(2.4 * flicker, 2.4 * flicker, length);
    b.glow.scale.set(9 * flicker, 9 * flicker, length);
    b.glow.material.uniforms.uTime.value = this.time;
    b.glow.material.uniforms.uLength.value = length;
    b.impact.position.set(0, 0, -length);
    b.impact.scale.setScalar(90 * flicker);
    // Whatever it touches boils.
    if ((t || blocked) && Math.random() < 0.6) this.effects.fire(end.clone().addScaledVector(dir, -rand(0, 20)), rand(14, 30), rand(0.5, 0.9));

    const share = (this.shipStats.rayDamage * this.#pf('damage') * dt) / cfg.duration;
    if (t && this.#inRayArc(t) && !blocked) {
      if (t.kind === 'flagship') this.#damageFlagship(share, end);
      else if (t.kind === 'subsystem') this.#damageFlagship(share, end, t);
      else if (t.kind === 'corvette') this.#damageCorvette(t, share, end);
      else if (t.kind === 'fighter') this.#hitDrone(t, share, end);
    }
    // Rocks in the beam's path are vaporized.
    for (const rock of this.field.rocks) {
      if (rock.dead) continue;
      if (segmentHitsSphere(origin, end, rock.position, rock.radius)) this.#hitRock(rock, 999, rock.position, false);
    }
    if (Math.random() < 0.5) this.effects.sparkBurst(end, 8, this.colors.ice, 220);
    this.shake = Math.max(this.shake, 0.35);
  }

  #buildBeam() {
    const group = new THREE.Group();
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0, -0.5);
    const make = (color, opacity) => new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    const core = make(this.colors.ice.clone().lerp(new THREE.Color(1, 1, 1), 0.6).multiplyScalar(4.5), 1);
    // The sheath: plasma twisting in a helix and racing out along the beam, brightest down its middle.
    const glow = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: this.colors.ice.clone().multiplyScalar(0.8) },
        uTime: { value: 0 },
        uLength: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying float vAlong;
        varying float vAround;
        varying float vFacing;
        void main() {
          vAlong = -position.z; // 0 at the emitter, 1 at the far end
          vAround = atan(position.y, position.x);
          vec3 n = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vFacing = abs(dot(n, normalize(-mv.xyz)));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uLength;
        varying float vAlong;
        varying float vAround;
        varying float vFacing;
        void main() {
          float s = vAlong * uLength; // meters from the emitter
          float helix = sin(vAround * 3.0 + s * 0.09 - uTime * 38.0) * 0.5 + 0.5;
          float surge = sin(s * 0.025 - uTime * 22.0) * 0.5 + 0.5;
          float body = pow(vFacing, 1.6);
          float tip = 1.0 - smoothstep(0.92, 1.0, vAlong);
          gl_FragColor = vec4(uColor * body * tip * (0.35 + 0.65 * helix) * (0.75 + 0.5 * surge), 1.0);
        }
      `,
    }));
    const impact = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      color: this.colors.ice.clone().multiplyScalar(5),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    core.frustumCulled = glow.frustumCulled = false;
    group.add(core, glow, impact);
    group.visible = false;
    this.scene.add(group);
    return { group, core, glow, impact };
  }

  #shipSystems(dt) {
    const w = this.warship;
    const s = this.shipStats;
    this.energy = Math.min(s.maxEnergy, this.energy + s.energyRegen * dt);
    if (this.time - this.lastHit > CONFIG.warship.shieldDelay) {
      w.shield = Math.min(w.maxShield, w.shield + s.shieldRegen * this.#pf('shieldRegen') * this.systems.shields * dt);
      if (w.shield > w.maxShield * 0.5) this.alerts.shieldsDown = false;
    }
    const e = this.evasive;
    if (e.t > 0) {
      e.t -= dt;
      if (e.t <= 0) {
        e.cooldown = e.total = CONFIG.evasive.cooldown;
        this.crew.say('Helm', 'Steady as she goes.', { speak: false });
      }
    } else {
      e.cooldown = Math.max(0, e.cooldown - dt);
    }
    const d = this.dc;
    if (d.t > 0) {
      const cfg = CONFIG.damageControl;
      const step = Math.min(dt, d.t);
      d.t -= dt;
      w.hull = Math.min(w.maxHull, w.hull + (cfg.hull / cfg.duration) * step);
      this.systems[d.system] = Math.min(1, this.systems[d.system] + (cfg.system / cfg.duration) * step);
      if (w.hull > w.maxHull * 0.6) this.alerts.hullHalf = false;
      if (w.hull > w.maxHull * 0.35) this.alerts.hullCritical = false;
      if (d.t <= 0) {
        d.cooldown = d.total = cfg.cooldown;
        const sys = SYSTEMS.find((x) => x.id === d.system);
        this.crew.say('Damage control', `Repairs done. Hull at ${Math.round((w.hull / w.maxHull) * 100)} percent, ${sys.name.toLowerCase()} at ${Math.round(this.systems[d.system] * 100)}.`);
        if (this.engineering.isOpen) this.engineering.refresh(this.systems);
      }
    } else {
      d.cooldown = Math.max(0, d.cooldown - dt);
    }
    // Engine hum on the bridge follows speed.
    if (this.mode === 'bridge') this.sound.setThrust(0.15 + Math.min(1, w.speed / CONFIG.warship.maxSpeed) * 0.35);
  }

  #launches() {
    while (this.launchQueue.length && this.launchQueue[0].at <= this.time) {
      const { route } = this.launchQueue.shift();
      const scout = this.#launchScout();
      if (scout) scout.setRoute(route);
    }
  }

  #launchScout() {
    const w = this.warship;
    const name = this.scoutNames.find((n) => !this.scouts.some((s) => s.name === n)) ?? `Recon ${this.scouts.length + 1}`;
    const position = w.object.localToWorld(w.model.hangar.position.clone());
    const dir = w.model.hangar.direction.clone().transformDirection(w.object.matrixWorld);
    const scout = new Scout(this.scoutTemplate, name, position, dir, this.colors.ice);
    scout.hp = this.shipStats.scoutHp;
    scout.maxHp = this.shipStats.scoutHp;
    scout.velocity.copy(w.velocity);
    this.scene.add(scout.object);
    this.scouts.push(scout);
    this.trails.attach(scout, { color: this.colors.ice.clone().multiplyScalar(0.45), width: 0.9, offset: scout.tail });
    this.sound.launch();
    return scout;
  }

  #spawnDrone(position, fromFlagship) {
    const template = this.droneTemplates[randInt(0, this.droneTemplates.length - 1)];
    const d = new Drone(template, position, this.sectorIndex, this.colors.flareHot);
    d.warp = 0;
    d.object.visible = true;
    d.kind = 'fighter';
    d.name = 'Enemy fighter';
    d.fromFlagship = fromFlagship;
    this.scene.add(d.object);
    this.drones.push(d);
    this.trails.attach(d, { color: this.colors.flareHot.clone().multiplyScalar(0.5), width: 0.9, offset: d.tail });
    return d;
  }

  /** Everything that moves on its own, in every state. */
  #updateWorld(dt) {
    this.field.update(dt);
    this.planet?.update(dt);
    for (const s of this.satellites) s.update(dt, this.time);
    const obstacles = this.#obstacles();

    const f = this.flagship;
    if (f && !f.dead && (this.state === 'playing') && !this.warship.dead) {
      const result = f.think(dt, this.warship, this.drones.filter((d) => d.fromFlagship).length);
      if (result.noticed) {
        this.sound.alert();
        this.crew.say('Sensors', this.flagshipKnown ? 'The flagship is turning toward us!' : 'Enemy flagship has spotted us, Captain!');
        this.flagshipKnown = true;
        this.flagshipLastSeen = f.position.clone();
      }
      for (const shot of result.shots) {
        this.bolts.fire(shot.origin, shot.velocity, { look: 'hostileBattery', hostile: true, damage: CONFIG.flagship.boltDamage + CONFIG.flagship.boltDamagePerSector * (this.sectorIndex - 1), life: 6 });
        this.effects.flash(shot.origin, this.colors.hostile, 8, 0.12, 2);
      }
      if (result.launch) this.#launchFighters(2);
      if (result.retreat) {
        this.sound.alert();
        this.crew.say('Sensors', "The flagship is breaking off! It's making a run for it!");
        this.ui.banner('Flagship retreating', 'Chase it down, or knock out its engines');
      }
      if (result.rejoin && !f.enginesDown) this.crew.say('Sensors', 'The flagship is turning back to fight!');
      f.update(dt, this.time);
    } else if (f && !f.dead) {
      f.update(dt, this.time);
    }

    for (const c of this.corvettes) {
      if (c.dead) continue;
      if (this.state === 'playing' && !this.warship.dead) {
        const r = c.think(dt, this.warship);
        if (r.noticed && this.#isKnown(c)) this.crew.say('Sensors', 'Enemy corvette moving to attack!', { speak: false });
        for (const shot of r.shots) {
          this.bolts.fire(shot.origin, shot.velocity, { look: 'hostile', hostile: true, damage: CONFIG.corvette.boltDamage, life: 6 });
        }
        if (r.torpedo) this.#launchTorpedo(r.torpedo);
      }
      c.update(dt, this.time);
    }
    for (const t of this.torpedoes) t.update(dt);
    this.#updateFires(dt);
    this.#updateHullFires(dt);
    this.#updateWrecks(dt);

    for (const d of this.drones) {
      for (const shot of d.update(dt, obstacles)) {
        this.bolts.fire(shot.origin, shot.velocity, {
          look: 'hostile',
          hostile: true,
          damage: CONFIG.drone.boltDamage,
          life: (CONFIG.drone.range * 1.6) / CONFIG.drone.boltSpeed,
        });
      }
    }

    const w = this.warship;
    const hangar = w.object.localToWorld(w.model.hangar.position.clone());
    const hangarDir = w.model.hangar.direction.clone().transformDirection(w.object.matrixWorld);
    const hullObstacles = w.colliders;
    for (const s of this.scouts) {
      if (s.update(dt, { hangar, hangarDir, obstacles, hullObstacles }) === 'docked') {
        s.dead = true;
        s.docked = true;
        this.scene.remove(s.object);
        this.scoutsDocked += 1;
        this.crew.say('Flight deck', `${s.name} is aboard.`, { speak: false });
      }
    }

    this.bolts.update(dt);
    const collectors = [{ position: w.position, range: CONFIG.warship.magnetRange }];
    if (this.pilot && !this.pilot.dead) collectors.push({ position: this.pilot.position, range: this.pilot.stats.magnetRange });
    this.pickups.update(dt, collectors, this.time);
    this.effects.update(dt);
    this.trails.update(dt, this.camera);
    for (const pop of this.popups) pop.life -= dt;
    this.popups = this.popups.filter((pop) => pop.life > 0);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.hurt = Math.max(0, this.hurt - dt * 1.8);
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    if (this.damage) this.damage.life -= dt;
  }

  #obstacles() {
    const list = this.field.rocks.slice();
    if (this.field.landmark) list.push(this.field.landmark);
    if (!this.warship.dead) list.push(...this.warship.colliders);
    if (this.flagship && !this.flagship.dead) list.push(...this.flagship.colliders);
    for (const c of this.corvettes) if (!c.dead) list.push(...c.colliders);
    return list;
  }

  #launchTorpedo({ origin, direction }) {
    const t = new Torpedo(origin, direction, this.warship, this.colors.hostile);
    this.scene.add(t.object);
    this.torpedoes.push(t);
    this.trails.attach(t, { color: this.colors.hostile.clone().multiplyScalar(0.55), width: 1.4, offset: new THREE.Vector3(0, 0, -3.5) });
    this.#playAt('launch', origin, 0.8);
    if (this.time - (this.alerts.torpedoAt ?? -99) > 12 && origin.distanceTo(this.warship.position) < 3500) {
      this.alerts.torpedoAt = this.time;
      this.crew.say('Sensors', 'Torpedo launched! Point defense, stand by.');
    }
  }

  /** The point-defense guns fire on their own at torpedoes first, then fighters that come close. */
  #pointDefense(dt) {
    const w = this.warship;
    if (this.systems.weapons < 0.1) return;
    this.pdTimer -= dt;
    if (this.pdTimer > 0) return;
    const cfg = CONFIG.pointDefense;
    this.pdTimer = 1 / (cfg.rate * this.#pf('pointDefense') * (0.4 + 0.6 * this.systems.weapons));
    const reach = (cfg.range + 260) ** 2;
    const threats = [];
    for (const t of this.torpedoes) if (!t.dead && t.hostile && t.position.distanceToSquared(w.position) < reach) threats.push(t);
    for (const d of this.drones) if (!d.dead && d.position.distanceToSquared(w.position) < reach) threats.push(d);
    if (!threats.length) return;
    let fired = false;
    for (const m of w.model.pdMounts) {
      const origin = w.object.localToWorld(m.position.clone());
      const normal = m.normal.clone().transformDirection(w.object.matrixWorld);
      let best = null;
      let bestScore = Infinity;
      for (const t of threats) {
        const to = t.position.clone().sub(origin);
        const d = to.length();
        if (d > cfg.range || to.dot(normal) < -0.25 * d) continue;
        const score = t.kind === 'torpedo' ? d * 0.4 : d;
        if (score < bestScore) {
          bestScore = score;
          best = t;
        }
      }
      if (!best) continue;
      const dist = best.position.distanceTo(origin);
      const dir = best.position.clone().addScaledVector(best.velocity, dist / cfg.boltSpeed).sub(origin).normalize();
      dir.add(randomUnit(new THREE.Vector3()).multiplyScalar(cfg.spread)).normalize();
      this.bolts.fire(origin, dir.multiplyScalar(cfg.boltSpeed).add(w.velocity), { look: 'pd', damage: 1, life: (cfg.range / cfg.boltSpeed) * 1.2 });
      fired = true;
      if (best.kind === 'torpedo' && this.time - (this.alerts.pdAt ?? -99) > 15) {
        this.alerts.pdAt = this.time;
        this.crew.say('Weapons', 'Point defense tracking the torpedo!', { speak: false });
      }
    }
    if (fired && this.mode === 'bridge') this.sound.pd();
  }

  /**
   * Fires break out across a badly damaged capital ship: one below 75% hull, three below half, six below
   * a quarter. Repairs put them out again.
   */
  #updateHullFires(dt) {
    for (const ship of [this.warship, this.flagship]) {
      if (!ship || ship.dead) continue;
      const frac = ship.hull / ship.maxHull;
      const want = frac < 0.25 ? 6 : frac < 0.5 ? 3 : frac < 0.75 ? 1 : 0;
      ship.fires ??= [];
      while (ship.fires.length < want) ship.fires.push({ local: ship.model.hullPoint(ship === this.warship && Math.random() < 0.7), timer: 0 });
      if (ship.fires.length > want) ship.fires.length = want;
      for (const fire of ship.fires) {
        fire.timer -= dt;
        if (fire.timer > 0) continue;
        fire.timer = rand(0.2, 0.4);
        const at = ship.object.localToWorld(this._v.copy(fire.local));
        this.effects.fire(at, rand(7, 13), rand(1, 1.8));
        if (Math.random() < 0.3) this.effects.sparkBurst(at, 3, this.colors.flareHot, 15);
      }
    }
  }

  /** Fires and sparks at the flagship's knocked-out parts. */
  #updateFires(dt) {
    for (const b of this.burning) {
      if (b.part.ship.dead && !this.flagshipDeath) continue;
      b.timer -= dt;
      if (b.timer > 0) continue;
      b.timer = rand(0.2, 0.45);
      const at = b.part.position.clone().add(randomUnit(new THREE.Vector3()).multiplyScalar(b.part.radius * 0.4));
      this.effects.flash(at, this.colors.flareHot, rand(10, 22), 0.5, 1.3);
      this.effects.sparkBurst(at, 4, this.colors.flareHot, 30);
    }
  }

  #launchFighters(count) {
    const f = this.flagship;
    const position = f.object.localToWorld(f.model.hangar.position.clone());
    const dir = f.model.hangar.direction.clone().transformDirection(f.object.matrixWorld);
    for (let i = 0; i < count; i++) {
      const d = this.#spawnDrone(position.clone().addScaledVector(dir, 20 + i * 18), true);
      d.face(dir);
      d.target = this.warship;
    }
    if (this.#isKnown(f)) this.crew.say('Sensors', 'The flagship is launching fighters!', { speak: !this.alerts.launchSpoken });
    this.alerts.launchSpoken = true;
  }

  /** Points each fighter at the nearest thing worth attacking: you in a scout, a scout, or the warship. */
  #assignTargets() {
    const w = this.warship;
    const pilot = this.pilot && !this.pilot.dead ? this.pilot : null;
    const scouts = this.scouts.filter((s) => !s.dead && !s.piloted);
    let woke = false;
    for (const d of this.drones) {
      if (d.dead) continue;
      let target = null;
      if (pilot && d.position.distanceTo(pilot.position) < 1100) target = pilot;
      else {
        const near = scouts.find((s) => d.position.distanceTo(s.position) < 800);
        if (near) target = near;
        else if (!w.dead && (d.fromFlagship || d.target === w || d.position.distanceTo(w.position) < 1900)) target = w;
      }
      if (target && !d.target) woke = true;
      d.target = target;
    }
    if (woke && this.time - (this.alerts.fightersAt ?? -99) > 20) {
      this.alerts.fightersAt = this.time;
      this.crew.say('Sensors', 'Enemy fighters inbound!');
    }
  }

  // ---------- Scout piloting ----------

  #enterPilot() {
    if (this.mode === 'pilot') return;
    const w = this.warship.position;
    let scout = this.scouts
      .filter((s) => !s.dead && !s.piloted)
      .sort((a, b) => a.position.distanceTo(w) - b.position.distanceTo(w))[0];
    if (!scout && this.scoutsDocked > 0) {
      scout = this.#launchScout();
      this.scoutsDocked -= 1;
      scout.state = 'hold';
      scout.holdCenter.copy(scout.position);
    }
    if (!scout) {
      this.crew.say('Flight deck', 'No scouts available, Captain.');
      return;
    }
    this.#setMap(false);
    this.#setEngineering(false);
    const pilot = new Player(baseStats());
    pilot.shield = 100 * (scout.hp / (scout.maxHp ?? CONFIG.scout.hp));
    pilot.position.copy(scout.position);
    pilot.quaternion.copy(scout.heading).multiply(FLIP);
    pilot.velocity.copy(scout.velocity);
    pilot.throttle = this.input.touchSeen ? 0.75 : 0.6;
    pilot.radius = 6;
    pilot.kind = 'pilot';
    this.pilot = pilot;
    this.pilotScout = scout;
    scout.piloted = true;
    scout.object.visible = false;
    this.mode = 'pilot';
    this.input.setMode('pilot');
    this.input.requestLock();
    this.ui.setMode('pilot');
    this.cockpit.visible = true;
    this.crew.say('Flight deck', `${scout.name} is yours, Captain. Bring her home in one piece.`);
  }

  /** Back to the bridge. The scout flies itself home unless it was lost. */
  #exitPilot(silent = false) {
    if (this.mode !== 'pilot') return;
    const scout = this.pilotScout;
    const pilot = this.pilot;
    if (scout && !scout.dead && pilot && !pilot.dead) {
      scout.position.copy(pilot.position);
      scout.heading.copy(pilot.quaternion).multiply(FLIP);
      scout.object.quaternion.copy(scout.heading);
      scout.hp = Math.max(1, (pilot.shield / 100) * (scout.maxHp ?? CONFIG.scout.hp));
      scout.piloted = false;
      scout.object.visible = true;
      scout.recall();
    }
    this.pilot = null;
    this.pilotScout = null;
    this.mode = 'bridge';
    this.input.setMode('bridge');
    this.input.releaseLock();
    this.ui.setMode('bridge');
    this.cockpit.visible = false;
    for (const flash of Object.values(this.muzzleFlashes)) flash.visible = false;
    this.look = { yaw: 0, pitch: -0.1 };
    if (!silent) this.crew.say('Helm', 'Welcome back to the bridge, Captain.', { speak: false });
  }

  #updatePilot(dt) {
    const p = this.pilot;
    if (!p || p.dead) return;
    const controls = this.input.read();
    if (this.input.stick) this.ui.dismissTouchHint();
    p.update(dt, controls);
    if (controls.fire && p.fireTimer <= 0) this.#firePilot();
    if (controls.boost && p.boostTimer <= 0) {
      p.boostTimer = p.stats.boostCooldown;
      p.boosting = CONFIG.player.boostDuration;
      p.invulnerable = Math.max(p.invulnerable, 0.35);
      this.sound.boost();
    }
    this.sound.setThrust(Math.min(1.2, p.speed / p.stats.maxSpeed) * 0.6 + (p.boosting > 0 ? 0.5 : 0));
    // Keep the scout entity with you so sensors and enemies treat you as that scout.
    const s = this.pilotScout;
    if (s) {
      s.position.copy(p.position);
      s.velocity.copy(p.velocity);
    }
    // Soft boundary.
    const dist = p.position.length();
    if (dist > CONFIG.sector.radius + 400) p.velocity.addScaledVector(this._v.copy(p.position).normalize(), -120 * dt);
    for (const flash of Object.values(this.muzzleFlashes)) {
      flash.userData.life -= dt;
      flash.visible = flash.userData.life > 0;
      if (flash.visible) flash.material.rotation = Math.random() * Math.PI;
    }
  }

  #firePilot() {
    const p = this.pilot;
    const s = p.stats;
    p.fireTimer = s.fireInterval * (p.overdrive > 0 ? 0.5 : 1);
    const names = s.guns >= 3 ? ['left', 'right', 'nose'] : s.guns === 2 ? ['left', 'right'] : [p.gunIndex++ % 2 === 0 ? 'left' : 'right'];
    const aim = p.forward(new THREE.Vector3()).multiplyScalar(CONFIG.player.convergence).add(p.position);
    for (const name of names) {
      this.muzzleFlashes[name].userData.life = 0.05;
      const origin = MUZZLES[name].clone().applyQuaternion(p.quaternion).add(p.position);
      const velocity = aim.clone().sub(origin).normalize().multiplyScalar(s.boltSpeed).add(p.velocity);
      this.bolts.fire(origin, velocity, { look: 'fighter', damage: s.boltDamage, life: s.boltRange / s.boltSpeed });
    }
    this.sound.laser();
  }

  // ---------- Sensors ----------

  #sensors() {
    const list = [{ position: this.warship.position, range: this.shipStats.scanRange * (0.5 + 0.5 * this.systems.sensors) }];
    for (const s of this.scouts) if (!s.dead) list.push({ position: s.position, range: CONFIG.scout.scanRange });
    return list;
  }

  #inSensorRange(position, sensors = this.#sensors()) {
    return sensors.some((s) => s.position.distanceToSquared(position) < s.range * s.range);
  }

  #isKnown(entity) {
    if (entity.kind === 'flagship') {
      return this.#inSensorRange(entity.position) || entity.position.distanceTo(this.#viewpoint()) < VISUAL_RANGE;
    }
    if (entity.kind === 'corvette') {
      return this.#inSensorRange(entity.position) || entity.position.distanceTo(this.#viewpoint()) < VISUAL_RANGE * 0.7;
    }
    if (entity.kind === 'subsystem') return this.#isKnown(entity.ship);
    if (entity.kind === 'satellite') return entity.discovered;
    return entity.detected;
  }

  /** Where the captain is looking from: the scout being flown, or the warship's bridge. */
  #viewpoint() {
    return this.pilot && !this.pilot.dead ? this.pilot.position : this.warship.position;
  }

  /** Updates what the ship knows: explored space, contacts, salvage. */
  #sense() {
    const sensors = this.#sensors();
    // Explored space.
    const cell = (this.fogExtent * 2) / FOG_SIZE;
    for (const s of sensors) {
      const r = s.range;
      const i0 = Math.max(0, Math.floor((s.position.x - r + this.fogExtent) / cell));
      const i1 = Math.min(FOG_SIZE - 1, Math.floor((s.position.x + r + this.fogExtent) / cell));
      const j0 = Math.max(0, Math.floor((s.position.z - r + this.fogExtent) / cell));
      const j1 = Math.min(FOG_SIZE - 1, Math.floor((s.position.z + r + this.fogExtent) / cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = -this.fogExtent + (i + 0.5) * cell - s.position.x;
          const z = -this.fogExtent + (j + 0.5) * cell - s.position.z;
          if (x * x + z * z < r * r) this.fog[j * FOG_SIZE + i] = 1;
        }
      }
    }

    for (const d of this.drones) d.detected = this.#inSensorRange(d.position, sensors) || (this.pilot && d.position.distanceTo(this.pilot.position) < 1500);

    const f = this.flagship;
    if (f && !f.dead) {
      const seen = this.#inSensorRange(f.position, sensors) || f.position.distanceTo(this.#viewpoint()) < VISUAL_RANGE;
      if (seen) {
        this.flagshipLastSeen = f.position.clone();
        if (!this.flagshipSeen) {
          this.flagshipSeen = true;
          this.flagshipKnown = true;
          const finder = sensors.find((s) => s.position.distanceTo(f.position) < s.range);
          const scout = this.scouts.find((s) => s.position === finder?.position);
          const by = scout ? `${scout.name} has found it! ` : '';
          const bearing = this.#bearing(f.position);
          this.sound.alert();
          this.crew.say('Sensors', `Contact! ${by}Enemy flagship, bearing ${bearing}, range ${km(f.position.distanceTo(this.warship.position))}.`);
          this.ui.banner('Enemy flagship located', `Bearing ${bearing} · ${km(f.position.distanceTo(this.warship.position))}`);
          if (!this.target || this.target.kind !== 'flagship') this.target = f;
        }
      }
    }

    for (const sat of this.satellites) {
      if (!sat.discovered && this.#inSensorRange(sat.position, sensors)) {
        sat.discovered = true;
        this.crew.say('Sensors', `${sat.name} on the scope. Could be power cells aboard.`, { speak: false });
      }
      if (sat.salvaged) continue;
      const nearShip = this.warship.hitSphere(sat.position, CONFIG.salvage.range);
      const nearScout = this.scouts.some((s) => !s.dead && s.position.distanceTo(sat.position) < 160);
      if (nearShip || nearScout) this.#salvage(sat, nearScout && !nearShip);
    }
  }

  /** Compass bearing to a point, relative to the ship's bow (000 dead ahead, 090 to starboard). */
  #bearing(point) {
    const w = this.warship;
    const to = point.clone().sub(w.position);
    const angle = Math.atan2(-to.x, -to.z) - w.heading;
    const deg = Math.round(((-angle * 180) / Math.PI + 720) % 360);
    return String(deg).padStart(3, '0');
  }

  #salvage(sat, byScout) {
    sat.salvaged = true;
    this.report.salvage += 1;
    this.energy = Math.min(this.shipStats.maxEnergy, this.energy + CONFIG.salvage.energy);
    const torpedoes = Math.min(CONFIG.salvage.torpedoes, this.shipStats.torpedoes - this.torpedoStock);
    this.torpedoStock += torpedoes;
    this.score += CONFIG.salvage.score;
    this.sound.salvage();
    this.#popup(sat.position, `+${CONFIG.salvage.energy} energy`, this.palette.energy);
    const haul = torpedoes ? `power cells and ${torpedoes} torpedoes` : 'power cells';
    this.crew.say(byScout ? 'Flight deck' : 'Engineering', `Salvaged ${haul} from ${sat.name}. Energy plus ${CONFIG.salvage.energy}.`);
  }

  // ---------- Collisions and damage ----------

  #collide() {
    const w = this.warship;
    const f = this.flagship && !this.flagship.dead ? this.flagship : null;
    const pilot = this.pilot && !this.pilot.dead ? this.pilot : null;
    const rocks = this.field.rocks;
    const lm = this.field.landmark;

    for (const b of this.bolts.active) {
      if (b.dead) continue;
      if (b.hostile) {
        if (pilot && segmentHitsSphere(b.previous, b.position, pilot.position, pilot.radius)) {
          b.dead = true;
          this.#damagePilot(b.damage, b.previous);
          continue;
        }
        for (const s of this.scouts) {
          if (s.dead || s.piloted) continue;
          if (segmentHitsSphere(b.previous, b.position, s.position, s.radius + 1)) {
            b.dead = true;
            this.#damageScout(s, b.damage, b.position);
            break;
          }
        }
        if (b.dead) continue;
        for (const t of this.torpedoes) {
          if (t.dead || t.hostile || !segmentHitsSphere(b.previous, b.position, t.position, t.radius + 2)) continue;
          b.dead = true;
          t.hp -= b.damage;
          if (t.hp <= 0) this.#destroyTorpedo(t, true);
          break;
        }
        if (b.dead) continue;
        if (!w.dead && b.position.distanceToSquared(w.position) < 300 * 300) {
          for (const c of w.colliders) {
            if (segmentHitsSphere(b.previous, b.position, c.position, c.radius)) {
              b.dead = true;
              // Evading, many shots go wide.
              if (this.evasive.t <= 0 || Math.random() >= CONFIG.evasive.missChance) this.#damageWarship(b.damage, b.position.clone());
              break;
            }
          }
        }
      } else {
        if (f && b.position.distanceToSquared(f.position) < 300 * 300) {
          for (const c of f.colliders) {
            if (segmentHitsSphere(b.previous, b.position, c.position, c.radius)) {
              b.dead = true;
              this.#damageFlagship(b.damage * (b.look === 'fighter' ? 3 : 1), b.position.clone());
              break;
            }
          }
        }
        for (const c of this.corvettes) {
          if (b.dead) break;
          if (c.dead || b.position.distanceToSquared(c.position) > 90 * 90) continue;
          for (const col of c.colliders) {
            if (segmentHitsSphere(b.previous, b.position, col.position, col.radius)) {
              b.dead = true;
              this.#damageCorvette(c, b.damage * (b.look === 'fighter' ? 3 : 1), b.position.clone());
              break;
            }
          }
        }
        for (const t of this.torpedoes) {
          if (b.dead) break;
          if (t.dead || !t.hostile || !segmentHitsSphere(b.previous, b.position, t.position, t.radius + (b.look === 'pd' ? 2 : 0))) continue;
          b.dead = true;
          t.hp -= b.look === 'battery' ? 99 : b.damage;
          if (t.hp <= 0) this.#destroyTorpedo(t, true);
          else this.effects.impact(b.position, this.colors.flare);
        }
      }
      if (b.dead) continue;
      // Rocks stop everyone's bolts, so they work as cover.
      for (const rock of rocks) {
        if (rock.dead) continue;
        const reach = rock.radius + 50;
        if (b.position.distanceToSquared(rock.position) > reach * reach) continue;
        if (segmentHitsSphere(b.previous, b.position, rock.position, rock.radius)) {
          b.dead = true;
          if (!b.hostile) this.#hitRock(rock, b.damage, b.position, b.look === 'fighter');
          else this.effects.impact(b.position, this.colors.hostile);
          break;
        }
      }
      // So does the giant asteroid, which nothing breaks.
      if (!b.dead && lm && segmentHitsSphere(b.previous, b.position, lm.position, lm.radius)) {
        b.dead = true;
        const at = sphereEntry(b.previous, b.position, lm.position, lm.radius) ?? b.position;
        this.effects.impact(at, b.hostile ? this.colors.hostile : DUST_TINT[0]);
      }
      if (b.dead || b.hostile) continue;
      for (const d of this.drones) {
        if (d.dead) continue;
        if (segmentHitsSphere(b.previous, b.position, d.position, d.radius + (b.look === 'battery' ? 4 : 0))) {
          b.dead = true;
          this.#hitDrone(d, b.look === 'battery' ? 99 : b.damage, b.position);
          break;
        }
      }
    }

    // Capital ships plow through rocks; yours takes damage doing it.
    for (const rock of rocks) {
      if (rock.dead) continue;
      if (lm && rock.position.distanceTo(lm.position) < lm.radius + rock.radius * 0.8) {
        this.#shatterRock(rock, rock.position.clone().sub(lm.position).normalize());
        continue;
      }
      if (!w.dead && rock.position.distanceToSquared(w.position) < (rock.radius + 260) ** 2) {
        const c = w.hitSphere(rock.position, rock.radius * 0.9);
        if (c) {
          const push = rock.position.clone().sub(c.position).normalize();
          this.#shatterRock(rock, push);
          this.#damageWarship(CONFIG.asteroid[rock.size].ramDamage * clamp(w.speed / 25, 0.3, 1.5), rock.position.clone());
          if (this.time - (this.alerts.rockAt ?? -99) > 8) {
            this.alerts.rockAt = this.time;
            this.crew.say('Damage control', 'Asteroid impact on the hull!');
          }
          continue;
        }
      }
      if (f && rock.position.distanceToSquared(f.position) < (rock.radius + 260) ** 2) {
        const c = f.hitSphere(rock.position, rock.radius * 0.9);
        if (c) {
          this.#shatterRock(rock, rock.position.clone().sub(c.position).normalize());
          continue;
        }
      }
      for (const cv of this.corvettes) {
        if (cv.dead || rock.position.distanceToSquared(cv.position) > (rock.radius + 70) ** 2) continue;
        const c = cv.hitSphere(rock.position, rock.radius * 0.9);
        if (c) {
          this.#shatterRock(rock, rock.position.clone().sub(c.position).normalize());
          break;
        }
      }
    }

    // The giant asteroid shoves capital ships back out; yours is damaged if it hits hard.
    if (lm) {
      for (const ship of [w, f, ...this.corvettes]) {
        if (!ship || ship.dead || ship.position.distanceTo(lm.position) > lm.radius + ship.extent) continue;
        const c = ship.hitSphere(lm.position, lm.radius);
        if (!c) continue;
        const normal = new THREE.Vector3().subVectors(c.position, lm.position).normalize();
        ship.position.addScaledVector(normal, lm.radius + c.radius - c.position.distanceTo(lm.position));
        const closing = -ship.velocity.dot(normal);
        if (closing > 0) ship.velocity.addScaledVector(normal, closing);
        if (ship === w && closing > 4 && this.time - (this.alerts.landmarkAt ?? -99) > 4) {
          this.alerts.landmarkAt = this.time;
          this.#damageWarship(clamp(closing * 2.5, 10, 60), c.position.clone().addScaledVector(normal, -c.radius));
          this.crew.say('Damage control', "We've struck the asteroid! Helm, take us off it.");
        }
      }
    }

    for (const t of this.torpedoes) {
      if (t.dead) continue;
      if (!t.hostile) {
        if (this.#ourTorpedoStrike(t)) continue;
      } else if (!t.missed && !w.dead && t.position.distanceToSquared(w.position) < 300 * 300 && w.hitSphere(t.position, 3)) {
        // Evading, a torpedo can overshoot: it loses its lock and flies on.
        if (this.evasive.t > 0 && Math.random() < CONFIG.evasive.missChance) {
          t.missed = true;
          t.target = null;
          continue;
        }
        this.#torpedoHit(t);
        continue;
      }
      for (const rock of rocks) {
        if (!rock.dead && t.position.distanceTo(rock.position) < rock.radius + 2) {
          this.#destroyTorpedo(t, false);
          break;
        }
      }
      if (!t.dead && lm && t.position.distanceTo(lm.position) < lm.radius + 2) this.#destroyTorpedo(t, false);
    }

    // Fighters that fly into hulls or rocks don't survive it.
    for (const d of this.drones) {
      if (d.dead) continue;
      if (!w.dead && d.position.distanceToSquared(w.position) < 300 * 300 && w.hitSphere(d.position, 3)) {
        this.#destroyDrone(d, false);
        this.#damageWarship(10, d.position.clone());
        continue;
      }
      if (f && d.position.distanceToSquared(f.position) < 300 * 300 && f.hitSphere(d.position, 3)) {
        this.#destroyDrone(d, false);
        continue;
      }
      if (this.corvettes.some((c) => !c.dead && d.position.distanceToSquared(c.position) < 90 * 90 && c.hitSphere(d.position, 3))) {
        this.#destroyDrone(d, false);
        continue;
      }
      for (const rock of rocks) {
        if (!rock.dead && d.position.distanceTo(rock.position) < rock.radius + 2) {
          this.#destroyDrone(d, false);
          break;
        }
      }
      if (!d.dead && lm && d.position.distanceTo(lm.position) < lm.radius + 2) this.#destroyDrone(d, false);
    }

    if (pilot) this.#collidePilot(pilot);

    // Supply crystals.
    for (const item of this.pickups.items) {
      if (item.dead) continue;
      if (pilot && pilot.position.distanceTo(item.position) < pilot.radius + item.radius) {
        item.dead = true;
        this.#collect(item, 'pilot');
      } else if (!w.dead && item.position.distanceToSquared(w.position) < 300 * 300 && w.hitSphere(item.position, item.radius)) {
        item.dead = true;
        this.#collect(item, 'ship');
      }
    }
  }

  #collidePilot(p) {
    const lm = this.field.landmark;
    for (const rock of lm ? [...this.field.rocks, lm] : this.field.rocks) {
      if (rock.dead) continue;
      const gap = p.position.distanceTo(rock.position) - rock.radius - p.radius;
      if (gap >= 0) continue;
      const normal = this._v.subVectors(p.position, rock.position).normalize();
      p.position.addScaledVector(normal, -gap);
      const closing = -new THREE.Vector3().subVectors(p.velocity, rock.velocity).dot(normal);
      if (closing > 0) {
        p.velocity.addScaledVector(normal, closing * 1.4);
        const { impactDamage, harmlessSpeed } = CONFIG.asteroid;
        if (closing > harmlessSpeed) this.#damagePilot(clamp(closing * 0.3, impactDamage[0], impactDamage[1]), rock.position);
      }
      if (p.dead) return;
    }
    // Bounce off capital ship hulls.
    for (const ship of [this.warship, this.flagship]) {
      if (!ship || ship.dead) continue;
      if (p.position.distanceToSquared(ship.position) > 300 * 300) continue;
      const c = ship.hitSphere(p.position, p.radius);
      if (!c) continue;
      const normal = this._v.subVectors(p.position, c.position).normalize();
      p.position.copy(c.position).addScaledVector(normal, c.radius + p.radius + 0.5);
      const closing = -p.velocity.dot(normal);
      if (closing > 0) {
        p.velocity.addScaledVector(normal, closing * 1.3);
        if (closing > 25) this.#damagePilot(clamp(closing * 0.25, 5, 40), c.position);
      }
      if (p.dead) return;
    }
    for (const d of this.drones) {
      if (d.dead) continue;
      if (p.position.distanceTo(d.position) < p.radius + d.radius) {
        this.#damagePilot(CONFIG.drone.ramDamage, d.position);
        this.#destroyDrone(d, true);
        if (p.dead) return;
      }
    }
  }

  #sweep() {
    this.field.sweep();
    this.bolts.sweep();
    this.pickups.sweep();
    this.drones = this.drones.filter((d) => {
      if (d.dead) this.scene.remove(d.object);
      return !d.dead;
    });
    this.scouts = this.scouts.filter((s) => !s.dead);
    this.corvettes = this.corvettes.filter((c) => !c.dead);
    this.torpedoes = this.torpedoes.filter((t) => {
      if (t.dead) this.scene.remove(t.object);
      return !t.dead;
    });
    if (this.target?.dead) this.target = this.target.kind === 'subsystem' && !this.target.ship.dead ? this.target.ship : null;
  }

  #hitRock(rock, damage, at, quiet) {
    rock.hp -= damage;
    this.effects.impact(at, DUST_TINT[0]);
    if (this.mode === 'pilot') this.hitMarker = 0.12;
    if (rock.hp > 0) {
      if (quiet) this.#playAt('chip', at, 0.8);
      return;
    }
    const def = CONFIG.asteroid[rock.size];
    this.field.remove(rock);
    this.#addScore(def.score, rock.position);
    const big = rock.size === 'large';
    this.effects.explosion(rock.position, rock.radius * 1.1, { tint: DUST_TINT, debris: big ? 10 : rock.size === 'medium' ? 6 : 3, light: big, rock: true, shockwave: false });
    this.#playAt('explode', rock.position, big ? 1 : 0.5);
    this.#shakeFrom(rock.position, big ? 1 : 0.4);
    if (def.breaksInto && damage < 900) this.#splitRock(rock, def, rock.velocity);
    if (rock.size !== 'large' && Math.random() < CONFIG.pickups.dropChance.asteroid) this.#drop('energy', rock);
  }

  /** A rock rammed by a capital ship: it breaks apart and the pieces are shoved aside. */
  #shatterRock(rock, push) {
    const def = CONFIG.asteroid[rock.size];
    this.field.remove(rock);
    this.effects.explosion(rock.position, rock.radius * 0.9, { tint: DUST_TINT, debris: 6, light: false, rock: true, shockwave: false });
    this.#playAt('explode', rock.position, 0.6);
    if (def.breaksInto) this.#splitRock(rock, def, push.multiplyScalar(18).add(rock.velocity));
  }

  #splitRock(rock, def, baseVelocity) {
    const pieces = randInt(def.pieces[0], def.pieces[1]);
    for (let i = 0; i < pieces; i++) {
      const dir = randomUnit(new THREE.Vector3());
      const pos = dir.clone().multiplyScalar(rock.radius * 0.45).add(rock.position);
      this.field.spawn(def.breaksInto, pos, dir.multiplyScalar(rand(6, 18)).add(baseVelocity));
    }
  }

  #hitDrone(d, damage, at) {
    d.hp -= damage;
    d.flash = 0.1;
    this.effects.impact(at, this.colors.flareHot);
    if (this.mode === 'pilot') this.hitMarker = 0.15;
    if (d.hp <= 0) this.#destroyDrone(d, true);
    else this.#playAt('chip', at, 1);
  }

  #destroyDrone(d, byPlayer) {
    if (d.dead) return;
    d.dead = true;
    if (byPlayer) {
      this.#addScore(CONFIG.drone.score, d.position);
      this.report.fighters += 1;
    }
    this.effects.explosion(d.position, 16, { debris: 5 });
    this.#playAt('explode', d.position, 0.8);
    this.#shakeFrom(d.position, 0.5);
    if (byPlayer && Math.random() < CONFIG.pickups.dropChance.drone) this.#drop('energy', d);
  }

  #damageFlagship(amount, at, part = null) {
    const f = this.flagship;
    if (!f || f.dead) return;
    f.sinceHit = 0;
    if (f.state === 'dormant') f.state = 'hunting';
    if (f.shield > 0) {
      const absorbed = Math.min(f.shield, amount);
      f.shield -= absorbed;
      amount -= absorbed;
      f.shieldHit(at);
      if (f.shield <= 0) {
        this.sound.alert();
        this.crew.say('Weapons', 'Their shields are down! Hit their guns, engines or hangar, or go for the hull.');
        this.ui.banner('Flagship shields down', 'Target its guns, engines or hangar');
      }
      if (amount <= 0) return;
    }
    if (amount > 2) this.effects.impact(at, this.colors.flareHot);
    const hitPart = part && !part.destroyed ? part : f.parts.find((p) => !p.destroyed && p.position.distanceTo(at) < p.radius + 12);
    if (hitPart) {
      hitPart.hp -= amount;
      if (hitPart.hp <= 0) this.#partDestroyed(hitPart);
      f.hull -= amount * 0.4;
    } else {
      f.hull -= amount;
    }
    if (!this.alerts.flagHalf && f.hull < f.maxHull * 0.5) {
      this.alerts.flagHalf = true;
      this.crew.say('Weapons', "The flagship's hull is buckling. Keep it up!");
    }
    if (f.hull <= 0) {
      f.dead = true;
      this.flagshipDeath = { t: 3.4, next: 0 };
      this.#addScore(CONFIG.flagship.score * this.sectorIndex, f.position);
      this.sound.alert();
      this.crew.say('Sensors', 'The flagship is breaking up!');
      if (this.course?.entity === f) this.course = null;
      if (this.ray.target === f) this.ray.pending = 0;
    }
  }

  #partDestroyed(part) {
    const f = this.flagship;
    f.disable(part);
    const at = part.position.clone();
    this.effects.explosion(at, part.type === 'gun' ? 34 : 55, { debris: 8 });
    this.#playAt('explode', at, 1);
    this.#shakeFrom(at, 0.8);
    this.burning.push({ part, timer: 0 });
    this.report.parts += 1;
    this.#addScore(300, at);
    const lines = {
      gun: 'Knocked out one of their gun batteries!',
      engines: "Their engines are down! She's crawling.",
      hangar: 'Their hangar is wrecked. No more fighters from her.',
    };
    this.crew.say('Weapons', lines[part.type]);
    if (this.target === part) this.target = f;
  }

  #damageCorvette(c, amount, at) {
    if (c.dead) return;
    c.hull -= amount;
    if (amount > 2) this.effects.impact(at, this.colors.flareHot);
    if (c.state === 'dormant') c.state = 'attack';
    if (c.hull > 0) return;
    c.dead = true;
    this.scene.remove(c.object);
    this.effects.explosion(c.position, 70, { debris: 12 });
    this.#playAt('explode', c.position, 1);
    this.#shakeFrom(c.position, 1);
    this.#addScore(CONFIG.corvette.score, c.position);
    this.report.corvettes += 1;
    for (let i = 0; i < 3; i++) this.#drop('energy', c);
    this.crew.say('Weapons', 'Corvette destroyed!');
    if (this.course?.entity === c) this.course = null;
  }

  /**
   * Our torpedo reaching something: the flagship (or the part it was aimed at) or a corvette. It only
   * goes off on a fighter that it was aimed at, so fighters crossing its path don't waste it.
   */
  #ourTorpedoStrike(t) {
    const f = this.flagship && !this.flagship.dead ? this.flagship : null;
    let victim = null;
    if (f && t.position.distanceToSquared(f.position) < 300 * 300 && f.hitSphere(t.position, 4)) victim = f;
    victim ??= this.corvettes.find((c) => !c.dead && t.position.distanceToSquared(c.position) < 90 * 90 && c.hitSphere(t.position, 3));
    if (t.target?.kind === 'fighter' && !t.target.dead && t.position.distanceTo(t.target.position) < t.target.radius + 4) victim = t.target;
    if (!victim) return false;
    t.dead = true;
    const at = t.position.clone();
    this.effects.explosion(at, 46, { debris: 6 });
    this.#playAt('explode', at, 1);
    this.#shakeFrom(at, 0.5);
    if (victim === f) {
      const part = t.target?.kind === 'subsystem' && t.target.ship === f && !t.target.destroyed ? t.target : null;
      this.#damageFlagship(f.shield > 0 ? t.damage * 0.5 : t.damage, at, part);
    } else if (victim.kind === 'corvette') {
      this.#damageCorvette(victim, t.damage, at);
    } else {
      this.#hitDrone(victim, t.damage, at);
    }
    return true;
  }

  /**
   * The flagship's point defense shoots at our torpedoes. It runs off the gun batteries, so every battery
   * knocked out weakens it, and with all of them gone it falls silent.
   */
  #flagshipPointDefense(dt) {
    const f = this.flagship;
    if (!f || f.dead || f.state === 'dormant') return;
    const guns = f.parts.filter((p) => p.type === 'gun');
    const working = guns.filter((p) => !p.destroyed).length;
    if (!working) return;
    f.pdTimer -= dt;
    if (f.pdTimer > 0) return;
    const cfg = CONFIG.flagship.pointDefense;
    f.pdTimer = 1 / (cfg.rate * (working / guns.length));
    const reach = (cfg.range + 300) ** 2;
    const threats = this.torpedoes.filter((t) => !t.dead && !t.hostile && t.position.distanceToSquared(f.position) < reach);
    if (!threats.length) return;
    for (const m of f.model.pdMounts) {
      const origin = f.object.localToWorld(m.position.clone());
      const normal = m.normal.clone().transformDirection(f.object.matrixWorld);
      let best = null;
      let bestDist = Infinity;
      for (const t of threats) {
        const to = t.position.clone().sub(origin);
        const d = to.length();
        if (d > cfg.range || to.dot(normal) < -0.25 * d || d >= bestDist) continue;
        best = t;
        bestDist = d;
      }
      if (!best) continue;
      const dir = best.position.clone().addScaledVector(best.velocity, bestDist / cfg.boltSpeed).sub(origin).normalize();
      dir.add(randomUnit(new THREE.Vector3()).multiplyScalar(cfg.spread)).normalize();
      this.bolts.fire(origin, dir.multiplyScalar(cfg.boltSpeed).add(f.velocity), { look: 'pdHostile', hostile: true, damage: 1, life: (cfg.range / cfg.boltSpeed) * 1.2 });
    }
  }

  #torpedoHit(t) {
    t.dead = true;
    this.effects.explosion(t.position, 38, { debris: 4 });
    this.#playAt('explode', t.position, 1);
    this.#damageWarship(CONFIG.torpedo.damage, t.position.clone());
    if (this.time - (this.alerts.torpedoHitAt ?? -99) > 6) {
      this.alerts.torpedoHitAt = this.time;
      this.crew.say('Damage control', 'Torpedo impact!');
    }
  }

  #destroyTorpedo(t, shotDown) {
    t.dead = true;
    this.effects.explosion(t.position, 16, { debris: 0, light: false });
    this.#playAt('explode', t.position, 0.4);
    if (!t.hostile) {
      if (shotDown && this.time - (this.alerts.ourTorpedoDownAt ?? -99) > 8) {
        this.alerts.ourTorpedoDownAt = this.time;
        this.crew.say('Weapons', 'Their point defense got one of our torpedoes.', { speak: false });
      }
      return;
    }
    if (!shotDown) return;
    this.report.torpedoes += 1;
    this.#addScore(100, t.position);
    if (this.time - (this.alerts.torpedoDownAt ?? -99) > 10) {
      this.alerts.torpedoDownAt = this.time;
      this.crew.say('Weapons', 'Torpedo destroyed.', { speak: false });
    }
  }

  #targetPart(type) {
    const f = this.flagship;
    if (!f || f.dead || !this.#isKnown(f)) return this.crew.say('Weapons', "We don't have the flagship on our scopes yet.");
    if (!type) {
      this.target = f;
      return this.crew.say('Weapons', 'Targeting the flagship.');
    }
    const parts = f.parts.filter((p) => p.type === type && !p.destroyed);
    const names = { gun: 'gun batteries', engines: 'engines', hangar: 'hangar' };
    if (!parts.length) return this.crew.say('Weapons', `Their ${names[type]} ${type === 'hangar' ? 'is' : 'are'} already knocked out.`);
    const w = this.warship.position;
    parts.sort((a, b) => a.position.distanceTo(w) - b.position.distanceTo(w));
    this.target = parts[0];
    const note = f.shield > 0 ? ' Their shields are still up, so those come down first.' : '';
    return this.crew.say('Weapons', `Targeting their ${type === 'gun' ? 'nearest gun battery' : names[type]}.${note}`);
  }

  /** Secondary explosions along the dying flagship, then one huge blast. */
  #updateFlagshipDeath(dt) {
    const death = this.flagshipDeath;
    const f = this.flagship;
    if (!death || !f) return;
    death.t -= dt;
    death.next -= dt;
    if (death.t > 0 && death.next <= 0) {
      death.next = rand(0.15, 0.3);
      const c = f.colliders[randInt(0, f.colliders.length - 1)];
      const at = c.position.clone().add(randomUnit(new THREE.Vector3()).multiplyScalar(c.radius));
      this.effects.explosion(at, rand(30, 60), { debris: 4 });
      this.#playAt('explode', at, 0.8);
      this.#shakeFrom(at, 0.6);
    }
    if (death.t <= 0) {
      this.effects.explosion(f.position, 240, { debris: 30, plane: this._v.set(0, 1, 0).applyQuaternion(f.object.quaternion) });
      this.sound.explode(1);
      this.#shakeFrom(f.position, 1.4);
      this.#breakUp(f);
      for (let i = 0; i < 6; i++) this.#drop('energy', { position: f.position.clone().add(randomUnit(new THREE.Vector3()).multiplyScalar(120)), velocity: ZERO });
      this.flagshipDeath = null;
      this.warpReady = true;
      this.report.end = this.time;
      this.sound.sectorClear();
      this.ui.banner('Flagship destroyed', 'Warp drive ready');
      this.crew.say('Engineering', 'Warp drive is spooled up. Say the word, Captain.');
    }
  }

  /**
   * Splits a dead capital ship into its bow and stern sections, which tumble slowly apart with fires
   * burning along the break. Its engines, lights and shield go dark.
   */
  #breakUp(ship) {
    const m = ship.model;
    for (const o of [...m.engines, ...m.plumes, ...m.navLights, m.shield.mesh]) o.visible = false;
    const sections = m.sections.map((group, i) => {
      const hull = group.children[0].geometry;
      hull.computeBoundingBox();
      const away = i === 0 ? -1 : 1;
      return {
        group,
        pivot: new THREE.Vector3(0, 0, (hull.boundingBox.min.z + hull.boundingBox.max.z) / 2),
        cut: new THREE.Vector3(0, 0, m.breakZ),
        drift: new THREE.Vector3(),
        velocity: new THREE.Vector3(rand(-1.5, 1.5), rand(-2, 2), away * rand(5, 8)),
        euler: new THREE.Euler(),
        spin: new THREE.Vector3(away * rand(0.012, 0.025), rand(-0.012, 0.012), rand(-0.02, 0.02)),
        fireTimer: 0,
      };
    });
    this.wrecks.push({ ship, t: 0, sections });
  }

  /** Puts a broken ship back together (a new run reuses the same warship). */
  #mend(ship) {
    const m = ship.model;
    for (const g of m.sections) {
      g.position.set(0, 0, 0);
      g.rotation.set(0, 0, 0);
    }
    for (const o of [...m.engines, ...m.plumes, ...m.navLights]) o.visible = true;
  }

  #updateWrecks(dt) {
    for (const w of this.wrecks) {
      w.t += dt;
      const heat = Math.max(0, 1 - w.t / 24);
      for (const s of w.sections) {
        s.drift.addScaledVector(s.velocity, dt);
        s.euler.x += s.spin.x * dt;
        s.euler.y += s.spin.y * dt;
        s.euler.z += s.spin.z * dt;
        // Turn about the section's own middle, not the ship's.
        s.group.quaternion.setFromEuler(s.euler);
        s.group.position.copy(s.pivot).sub(this._v.copy(s.pivot).applyQuaternion(s.group.quaternion)).add(s.drift);
        if (heat <= 0 || (s.fireTimer -= dt) > 0) continue;
        s.fireTimer = 0.1 + (1 - heat) * 0.6;
        const at = this._v.set(rand(-26, 26), rand(-14, 14), s.cut.z);
        s.group.updateMatrixWorld();
        s.group.localToWorld(at);
        this.effects.fire(at, rand(12, 30) * (0.4 + 0.6 * heat), rand(0.8, 1.4));
        if (Math.random() < 0.35) this.effects.sparkBurst(at, 8, this.colors.flareHot, 45);
        if (w.t < 8 && Math.random() < 0.08) {
          const along = this._v.set(rand(-20, 20), rand(-10, 16), s.pivot.z + rand(-80, 80));
          s.group.localToWorld(along);
          this.effects.explosion(along, rand(25, 50), { debris: 3, light: false, shockwave: false });
          this.#playAt('explode', along, 0.5);
        }
      }
    }
  }

  #damageWarship(amount, at) {
    const w = this.warship;
    if (w.dead) return;
    const hadShield = w.shield > 0;
    const hullDamage = w.takeDamage(amount * this.#pf('damageTaken'));
    this.lastHit = this.time;
    if (hadShield) {
      w.shieldHit(at);
      this.effects.flash(at, this.colors.ice, 12, 0.2, 1);
      if (this.mode === 'bridge') this.sound.shieldHit();
      if (w.shield <= 0 && !this.alerts.shieldsDown) {
        this.alerts.shieldsDown = true;
        this.crew.say('Damage control', 'Shields are down! We are taking hull damage.');
      }
    }
    if (hullDamage > 0) {
      this.report.hullLost += hullDamage;
      this.effects.impact(at, this.colors.flareHot);
      if (this.mode === 'bridge') {
        if (hullDamage >= 20 && !this.brownout && this.time > this.brownoutReady && !this.reduceMotion) {
          this.brownout = { t: 0, depth: Math.min(0.5, 0.2 + hullDamage / 200) };
          this.brownoutReady = this.time + 3;
        }
        this.hurt = Math.min(1, this.hurt + Math.min(0.5, hullDamage / 40));
        this.shake = Math.max(this.shake, Math.min(1, hullDamage / 25));
        this.sound.hit();
        this.damage = { from: at.clone(), life: 1.2 };
      }
      this.#wearSystems(hullDamage);
      const frac = w.hull / w.maxHull;
      if (frac < 0.5 && !this.alerts.hullHalf) {
        this.alerts.hullHalf = true;
        this.crew.say('Damage control', 'Hull integrity at fifty percent.');
      }
      if (frac < 0.25 && !this.alerts.hullCritical) {
        this.alerts.hullCritical = true;
        this.sound.alert();
        this.crew.say('Damage control', 'Hull integrity critical, Captain! We cannot take much more.');
      }
    }
    if (w.dead) this.#destroyWarship();
  }

  /** Hull damage also wears down a random system. */
  #wearSystems(hullDamage) {
    const sys = SYSTEMS[randInt(0, SYSTEMS.length - 1)];
    const before = this.systems[sys.id];
    const after = Math.max(0, before - hullDamage * CONFIG.systems.wearPerDamage * rand(0.5, 1.5));
    this.systems[sys.id] = after;
    for (const line of [0.5, 0.25]) {
      if (before >= line && after < line) {
        const effects = {
          engines: "We're losing speed.",
          weapons: line < 0.3 ? 'The death ray is offline.' : 'Batteries are slow to reload.',
          shields: 'Shields will be slow to recover.',
          sensors: 'Our scanner range is dropping.',
        };
        this.crew.say('Engineering', `${sys.name} down to ${Math.round(after * 100)} percent. ${effects[sys.id]} Get me some power down here.`);
      }
    }
    if (this.engineering.isOpen) this.engineering.refresh(this.systems);
  }

  #repair(id) {
    this.systems[id] = Math.min(1, this.systems[id] + CONFIG.systems.repairAmount);
    this.sound.repair();
    const sys = SYSTEMS.find((s) => s.id === id);
    this.crew.say('Engineering', `Power's back to the ${sys.name.toLowerCase()}. ${sys.name} at ${Math.round(this.systems[id] * 100)} percent.`);
    this.#addScore(50, this.warship.position);
    this.engineering.refresh(this.systems);
  }

  #destroyWarship() {
    const w = this.warship;
    this.#exitPilot(true);
    this.#setMap(false);
    this.#setEngineering(false);
    this.deathTimer = 4.5;
    this.sound.setThrust(0);
    this.sound.alert();
    this.crew.say('Damage control', 'Reactor breach! All hands, abandon ship!');
    for (let i = 0; i < 8; i++) {
      const c = w.colliders[randInt(0, w.colliders.length - 1)];
      this.effects.explosion(c.position.clone().add(randomUnit(new THREE.Vector3()).multiplyScalar(c.radius)), rand(40, 90), { debris: 6 });
    }
    this.effects.explosion(w.position, 220, { debris: 24, plane: this._v.set(0, 1, 0).applyQuaternion(w.object.quaternion) });
    this.#breakUp(w);
    this.sound.explode(1);
    this.sound.gameOver();
    this.hurt = 1;
    this.shake = 1.6;
    this.deathOrbit = 0;
  }

  #damageScout(s, amount, at) {
    s.hp -= amount;
    this.effects.impact(at, this.colors.ice);
    if (s.hp > 0) return;
    s.dead = true;
    this.scene.remove(s.object);
    this.effects.explosion(s.position, 14, { debris: 3 });
    this.crew.say('Flight deck', `We lost ${s.name}!`);
  }

  #damagePilot(amount, from) {
    const p = this.pilot;
    if (!p || p.invulnerable > 0 || p.dead) return false;
    p.shield -= amount;
    p.invulnerable = CONFIG.player.invulnerable;
    this.hurt = Math.min(1, this.hurt + 0.6);
    this.shake = Math.max(this.shake, 0.5);
    this.damage = { from: from.clone(), life: 1.2 };
    this.sound.hit();
    if (p.shield <= 0) {
      p.dead = true;
      const ahead = p.forward(new THREE.Vector3()).multiplyScalar(14).add(p.position);
      this.effects.explosion(ahead, 22, { debris: 8 });
      this.sound.explode(1);
      const scout = this.pilotScout;
      if (scout) {
        scout.dead = true;
        this.scene.remove(scout.object);
      }
      this.#exitPilot(true);
      this.crew.say('Flight deck', `${scout?.name ?? 'Your scout'} is down! We pulled you back to the bridge, Captain.`);
    }
    return true;
  }

  #drop(kind, source) {
    this.pickups.spawn(kind, source.position, source.velocity ?? ZERO);
  }

  #collect(item, by) {
    if (item.kind === 'energy' || by === 'ship') {
      const amount = CONFIG.pickups.energyAmount;
      this.energy = Math.min(this.shipStats.maxEnergy, this.energy + amount);
      this.#popup(item.position, `+${amount} energy`, this.palette.energy);
    } else if (item.kind === 'shield') {
      this.pilot.shield = Math.min(100, this.pilot.shield + CONFIG.pickups.shieldAmount);
      this.#popup(item.position, `+${CONFIG.pickups.shieldAmount} shield`, this.palette.ice);
    } else {
      this.pilot.overdrive = CONFIG.pickups.overdriveTime;
      this.#popup(item.position, 'Overdrive', this.palette.flareHot);
    }
    this.sound.pickup();
  }

  #addScore(points, at) {
    const { window: comboWindow, killsPerStep, maxMultiplier } = CONFIG.combo;
    this.chain += 1;
    this.comboTimer = comboWindow;
    this.multiplier = Math.min(maxMultiplier, 1 + Math.floor(this.chain / killsPerStep));
    const gained = Math.round(points * this.multiplier);
    this.score += gained;
    this.#popup(at, `+${gained}`, this.multiplier > 1 ? this.palette.flare : this.palette.hull);
  }

  #updateCombo(dt) {
    if (this.chain === 0) return;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) {
      this.chain = 0;
      this.multiplier = 1;
    }
  }

  #popup(at, text, color) {
    this.popups.push({ position: at.clone(), text, color, life: 1.4, max: 1.4 });
  }

  #shakeFrom(position, strength) {
    const falloff = clamp(1 - position.distanceTo(this.camera.position) / 900, 0, 1);
    this.shake = Math.max(this.shake, strength * falloff);
  }

  #playAt(name, position, weight) {
    const dist = position.distanceTo(this.camera.position);
    const level = weight * clamp(1 - dist / 2500, 0.06, 1);
    if (name === 'explode') this.sound.explode(level);
    else if (level > 0.2) this.sound[name]?.(level);
  }

  // ---------- Warp ----------

  #updateWarp(dt) {
    this.warpT += dt;
    const t = this.warpT;
    const w = this.warship;
    // Spool (0-2 s), jump (2-4 s), arrive (4-6 s).
    if (t < 2) {
      this.tunnel.intensity = 0.25 * (t / 2);
      w.throttle = 1;
      w.yawCommand = w.pitchCommand = 0;
      w.update(dt, this.time);
    } else if (t < 4) {
      if (!this.warpJumped) {
        this.warpJumped = true;
        this.sound.warpJump();
      }
      this.tunnel.intensity = 0.25 + 0.75 * Math.min(1, (t - 2) / 0.6);
      this.ui.setFlash(clamp((t - 3.4) / 0.6, 0, 1));
    } else {
      if (!this.warpSwapped) {
        this.warpSwapped = true;
        this.warpJumped = false;
        this.lastReport = this.#closeReport();
        this.#buildSector(this.sectorIndex + 1, this.runSeed + (this.sectorIndex + 1) * 7919);
      }
      this.tunnel.intensity = Math.max(0, 1 - (t - 4) / 2);
      this.ui.setFlash(clamp(1 - (t - 4) / 0.8, 0, 1));
      w.throttle = 0.3;
      w.update(dt, this.time);
    }
    this.look.yaw *= Math.exp(-3 * dt);
    this.look.pitch += (-0.05 - this.look.pitch) * smooth(3, dt);
    this.tunnel.update(dt);
    this.#updateWorld(dt);
    if (t >= 6) {
      this.tunnel.intensity = 0;
      this.tunnel.update(0);
      this.ui.setFlash(0);
      const options = rollUpgrades(this.levels);
      this.#updateHud();
      this.setState('upgrade');
      this.upgradeOptions = options;
      this.ui.showUpgrades(this.sectorIndex, options, this.levels, (id) => this.chooseUpgrade(id), this.lastReport);
      if (!options.length) this.chooseUpgrade(null);
    }
  }

  /** The after-action report for the sector just cleared, with its bonus added to the score. */
  #closeReport() {
    const r = this.report;
    const cfg = CONFIG.report;
    const seconds = Math.max(0, (r.end ?? this.time) - r.start);
    const timeBonus = Math.round(Math.max(0, cfg.parTime - seconds) * cfg.perSecond * this.sectorIndex);
    const cleanBonus = r.hullLost <= cfg.cleanHull ? cfg.cleanBonus * this.sectorIndex : 0;
    const bonus = timeBonus + cleanBonus;
    this.score += bonus;
    return { ...r, sector: this.sectorIndex, seconds, timeBonus, cleanBonus, bonus };
  }

  // ---------- HUD ----------

  #targetables() {
    const list = [];
    const f = this.flagship;
    if (f && !f.dead && this.#isKnown(f)) {
      list.push({ entity: f, hostile: true });
      // Its weak points are listed once it's big enough on screen to pick them apart, or when targeted.
      const near = f.position.distanceTo(this.#viewpoint()) < Math.min(3800, 2.6 * (this.hud.focal ?? 500));
      for (const p of f.parts) if (!p.destroyed && (near || p === this.target)) list.push({ entity: p, hostile: true });
    }
    for (const c of this.corvettes) if (!c.dead && this.#isKnown(c)) list.push({ entity: c, hostile: true });
    for (const d of this.drones) if (!d.dead && d.detected) list.push({ entity: d, hostile: true });
    for (const s of this.satellites) if (s.discovered && !s.salvaged) list.push({ entity: s, hostile: false });
    return list;
  }

  #tap(x, y) {
    if (this.state !== 'playing' || this.mode !== 'bridge') return;
    const contacts = this.#targetables().map((c) => ({ position: c.entity.position, entity: c.entity }));
    const hit = this.hud.pick(this.camera, contacts, x, y, this.input.touchSeen ? 70 : 50);
    if (!hit) return;
    this.target = hit.entity;
    this.sound.select();
    const dist = km(hit.entity.position.distanceTo(this.warship.position));
    this.crew.say(hit.entity.kind === 'satellite' ? 'Sensors' : 'Weapons', `Target: ${hit.entity.name.toLowerCase()}, ${dist}.`, { speak: false });
  }

  #objective() {
    const f = this.flagship;
    if (this.warpReady) return 'Engage warp to jump to the next sector';
    if (!f || f.dead) return 'The flagship is breaking up';
    if (!this.flagshipKnown) return 'Find the enemy flagship. Send out recon to search.';
    const dist = km(f.position.distanceTo(this.warship.position));
    if (f.state === 'retreat') return `The flagship is running! Chase it, or knock out its engines · ${dist}`;
    if (f.shield > 0) return `Break the flagship's shields · ${dist}`;
    return `Destroy the flagship: hit its guns, engines or hangar · ${dist}`;
  }

  #commandStates() {
    const c = this.cannon;
    const r = this.ray;
    const w = this.warship;
    const target = this.target && !this.target.dead ? this.target : null;
    const hostileTarget = target && target.kind !== 'satellite';
    const lowSystem = SYSTEMS.some((s) => this.systems[s.id] < 0.6);
    return {
      cannons: {
        state: c.volley > 0 ? 'active' : c.reload > 0 ? 'cooling' : hostileTarget ? 'ready' : 'unavailable',
        progress: c.reload > 0 ? 1 - c.reload / c.reloadTotal : 1,
      },
      deathray: {
        state: r.phase !== 'idle' || r.pending > 0 ? 'active' : r.cooldown > 0 ? 'cooling'
          : this.energy < this.shipStats.rayCost || this.systems.weapons < 0.25 ? 'unavailable' : hostileTarget ? 'ready' : 'unavailable',
        progress: r.cooldown > 0 ? 1 - r.cooldown / r.cooldownTotal : Math.min(1, this.energy / this.shipStats.rayCost),
      },
      torpedoes: {
        state: this.torpedoStock <= 0 || this.systems.weapons < 0.1 ? 'unavailable' : this.tubes.reload > 0 ? 'cooling' : hostileTarget ? 'ready' : 'unavailable',
        progress: this.tubes.reload > 0 ? 1 - this.tubes.reload / this.tubes.total : 1,
      },
      evasive: {
        state: this.evasive.t > 0 ? 'active' : this.evasive.cooldown > 0 ? 'cooling' : 'ready',
        progress: this.evasive.t > 0 ? this.evasive.t / CONFIG.evasive.duration : this.evasive.cooldown > 0 ? 1 - this.evasive.cooldown / this.evasive.total : 1,
      },
      'damage-control': {
        state: this.dc.t > 0 ? 'active' : this.dc.cooldown > 0 ? 'cooling'
          : this.energy < CONFIG.damageControl.cost || (w.hull >= w.maxHull - 1 && !SYSTEMS.some((s) => this.systems[s.id] < 0.99)) ? 'unavailable'
            : w.hull < w.maxHull * 0.4 ? 'alert' : 'ready',
        progress: this.dc.t > 0 ? this.dc.t / CONFIG.damageControl.duration : this.dc.cooldown > 0 ? 1 - this.dc.cooldown / this.dc.total : 1,
      },
      recon: { state: this.scoutsDocked > 0 ? 'ready' : 'unavailable' },
      recall: { state: this.scouts.some((s) => !s.piloted && s.state !== 'return' && s.state !== 'docking') ? 'ready' : 'unavailable' },
      course: { state: this.course ? 'active' : target ? 'ready' : 'unavailable' },
      pilot: { state: this.mode === 'pilot' ? 'active' : this.scouts.length || this.scoutsDocked ? 'ready' : 'unavailable' },
      engineering: { state: this.engineering.isOpen ? 'active' : lowSystem ? 'alert' : 'ready' },
      full: { state: w.throttle >= 0.99 ? 'active' : 'ready' },
      stop: { state: Math.abs(w.throttle) < 0.01 ? 'active' : 'ready' },
      warp: { state: this.warpReady ? 'alert' : 'unavailable' },
    };
  }

  #targetNote(t) {
    if (t.kind === 'satellite') return 'salvage';
    const arc = this.#inRayArc(t) ? 'in ray arc' : 'outside ray arc';
    const ship = t.kind === 'subsystem' ? t.ship : t;
    if (ship.kind === 'flagship' && ship.shield > 0) return `shields ${Math.round((ship.shield / ship.maxShield) * 100)}% · ${arc}`;
    return t.kind === 'fighter' ? null : arc;
  }

  #updateHud() {
    const w = this.warship;
    this.ui.updateTop({
      score: this.score,
      sector: this.sectorIndex,
      objective: this.#objective(),
      multiplier: this.multiplier,
      overdrive: this.pilot?.overdrive > 0,
    });
    if (this.mode === 'bridge') {
      const t = this.target && !this.target.dead ? this.target : null;
      let course = null;
      if (this.course) {
        const point = this.course.entity ? this.course.entity.position : this.course.point;
        course = `Course: ${this.course.label.toLowerCase()} · ${km(point.distanceTo(w.position))}`;
      }
      this.ui.updateBridge({
        hull: w.hull,
        maxHull: w.maxHull,
        shield: w.shield,
        maxShield: w.maxShield,
        energy: this.energy,
        maxEnergy: this.shipStats.maxEnergy,
        systems: this.systems,
        target: t ? {
          name: t.name,
          distance: t.position.distanceTo(w.position),
          hull: t.kind === 'flagship' || t.kind === 'corvette' ? Math.max(0, t.hull / t.maxHull)
            : t.kind === 'subsystem' ? Math.max(0, t.hp / t.maxHp) : null,
          note: this.#targetNote(t),
        } : null,
        speed: w.speed,
        throttle: w.throttle,
        course,
        commands: this.#commandStates(),
        power: this.power,
        torpedoes: { stock: this.torpedoStock, max: this.shipStats.torpedoes },
      });
    } else if (this.pilot) {
      const p = this.pilot;
      this.ui.updatePilot({
        shield: Math.max(0, p.shield),
        maxShield: 100,
        boost: p.boostCharge,
        speed: p.speed,
        throttle: p.boosting > 0 ? 1 : p.throttle,
      });
    }
  }

  // ---------- Render ----------

  render(dt) {
    this.#placeCamera(dt);
    const cam = this.camera;
    this.stars.position.copy(cam.position);
    this.sun.update(cam);
    if (this.shadows) {
      const flying = this.mode === 'pilot' && this.pilot && !this.pilot.dead;
      this.sun.focusShadows(this.photo ? this._v.fromArray(this.photo.target) : flying ? cam.position : this.warship.position);
    }

    // Looking toward the sun washes out the faint sky, like a real eye or camera.
    const forward = this._v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const glare = THREE.MathUtils.smoothstep(forward.dot(this.sunDirection), 0.8, 0.995);
    const exposure = 1 - 0.8 * glare;
    this.stars.material.uniforms.uExposure.value = exposure;
    this.scene.backgroundIntensity = exposure;

    const pilot = this.mode === 'pilot' && this.pilot && !this.pilot.dead;
    this.flare.update(dt, cam, this.sunDirection, this.state !== 'warp' && this.#sunClear(cam));
    this.warship.model.shield.view(cam);
    const velocity = pilot ? this.pilot.velocity : this.warship.velocity;
    this.dust.update(cam.position, velocity);
    if (!pilot) this.bridgeCrew.update(dt, this.time);
    // A heavy hit makes the bridge's screens and lights dip once and come back: a smooth brownout, never a
    // strobe (rapid flashing is hard on the eyes).
    let power = 1;
    if (this.brownout) {
      this.brownout.t += dt;
      const k = this.brownout.t / 0.6;
      if (k >= 1) this.brownout = null;
      else power = 1 - this.brownout.depth * Math.sin(Math.PI * k);
    }
    for (const g of this.bridge.userData.glows) g.material.color.copy(g.color).multiplyScalar(power);
    this.interiorLight.intensity = (pilot ? 0.35 : this.state === 'title' || this.state === 'gameover' ? 0 : 2) * power;
    this.interiorLight.distance = pilot ? 4 : 24;
    this.interiorLight.position.set(0, pilot ? 0.3 : 2.6, pilot ? -0.4 : 4);

    this.pipeline.render();
    this.hurtShown += (Math.min(0.75, this.hurt) - this.hurtShown) * Math.min(1, dt * 5);
    this.ui.setHurt(this.hurtShown);

    const playing = this.state === 'playing' || this.state === 'warp';
    if (playing && this.mode === 'pilot' && this.pilot) {
      const p = this.pilot;
      const hostiles = this.drones.filter((d) => !d.dead && d.detected);
      if (this.flagship && !this.flagship.dead && this.#isKnown(this.flagship)) hostiles.push(this.flagship);
      this.hud.draw({
        camera: cam,
        player: p.dead ? null : p,
        drones: hostiles,
        pickups: this.pickups.items,
        rocks: this.field.rocks,
        popups: this.popups,
        boltSpeed: p.stats.boltSpeed,
        hitMarker: this.hitMarker,
        damage: this.damage,
        cursor: !this.input.locked && !this.input.touchSeen ? this.input.cursor : null,
        stick: this.input.stickView,
        touch: this.input.touchSeen,
        boundary: p.position.length() > CONFIG.sector.radius,
      });
    } else if (playing && !this.warship.dead) {
      this.hud.drawBridge({
        camera: cam,
        ship: this.warship,
        contacts: this.#hudContacts(),
        waypoint: this.course?.point ?? null,
        rayArc: this.#rayArcView(),
        damage: this.damage,
      });
    } else {
      this.hud.clear();
    }

    if (this.mapOpen) this.#drawMap();
  }

  /** Whether a straight line from the camera to the sun is clear of the planet, rocks, ships and the bridge's own walls. */
  #sunClear(cam) {
    const d = this.sunDirection;
    const o = cam.position;
    const blocks = (center, radius) => {
      const x = center.x - o.x;
      const y = center.y - o.y;
      const z = center.z - o.z;
      const along = x * d.x + y * d.y + z * d.z;
      const dist2 = x * x + y * y + z * z;
      // Ahead of us and close enough to the line, unless we're inside it.
      return along > 0 && dist2 > radius * radius && dist2 - along * along < radius * radius;
    };
    if (this.planet && blocks(this.planet.group.position, this.planet.radius)) return false;
    for (const r of this.field.rocks) if (!r.dead && blocks(r.position, r.radius * 0.85)) return false;
    const lm = this.field.landmark;
    if (lm && blocks(lm.position, lm.radius)) return false;
    for (const s of [this.warship, this.flagship, ...this.corvettes]) {
      if (!s || s.dead) continue;
      for (const c of s.colliders) if (blocks(c.position, c.radius)) return false;
    }
    const onBridge = this.mode === 'bridge' && !this.photo && !this.warship.dead && (this.state === 'playing' || this.state === 'paused');
    if (!onBridge) return true;
    // On the bridge the sun has to be in a window: find where the line leaves the room (bridge.js layout).
    const l = this._sunV.copy(d).applyQuaternion(this.warship.model.bridgeAnchor.getWorldQuaternion(this._sunQ).invert());
    const tx = l.x === 0 ? Infinity : (l.x > 0 ? 15 : -15) / l.x;
    const ty = l.y === 0 ? Infinity : (l.y > 0 ? 3.4 : -4.8) / l.y;
    const tz = l.z === 0 ? Infinity : (l.z > 0 ? 14 : -6) / l.z;
    const t = Math.min(tx, ty, tz);
    if (t === ty) return false; // ceiling or floor
    if (t === tz) return l.z < 0 && l.y * t > -3.1; // the forward window, above the sill
    return l.y * t > -3.1 && l.z * t < 10; // a side window
  }

  #hudContacts() {
    const list = [];
    const t = this.target;
    for (const { entity, hostile } of this.#targetables()) {
      const labels = { flagship: 'FLAGSHIP', fighter: 'FIGHTER', corvette: 'CORVETTE' };
      list.push({
        position: entity.position,
        kind: entity.kind,
        label: labels[entity.kind] ?? entity.label ?? entity.name.toUpperCase(),
        radius: entity.kind === 'flagship' ? 220 : entity.radius,
        hostile,
        selected: entity === t,
        hull: entity.kind === 'flagship' || entity.kind === 'corvette' ? Math.max(0, entity.hull / entity.maxHull)
          : entity.kind === 'subsystem' ? Math.max(0, entity.hp / entity.maxHp) : null,
        shield: entity.kind === 'flagship' && entity.maxShield ? Math.max(0, entity.shield / entity.maxShield) : null,
      });
    }
    const w = this.warship.position;
    for (const tp of this.torpedoes) {
      if (!tp.dead && tp.hostile && tp.position.distanceTo(w) < 3500) list.push({ position: tp.position, kind: 'torpedo', label: 'TORPEDO', radius: 4, hostile: true });
    }
    for (const s of this.scouts) {
      if (!s.dead && !s.piloted) list.push({ position: s.position, kind: 'scout', label: s.name.replace('Recon ', 'R'), radius: 7, hostile: false });
    }
    return list;
  }

  #rayArcView() {
    const r = this.ray;
    if (this.systems.weapons < 0.25) return null;
    const t = this.target;
    if (!t || t.dead || t.kind === 'satellite') return null;
    const w = this.warship;
    const origin = w.model.emitter.group.getWorldPosition(new THREE.Vector3());
    return {
      center: w.forward(new THREE.Vector3()).multiplyScalar(4000).add(origin),
      angle: CONFIG.warship.deathRay.arc,
      ready: r.cooldown <= 0 && this.energy >= this.shipStats.rayCost,
    };
  }

  #drawMap() {
    const cell = (this.fogExtent * 2) / FOG_SIZE;
    const explored = (p) => {
      const i = Math.floor((p.x + this.fogExtent) / cell);
      const j = Math.floor((p.z + this.fogExtent) / cell);
      return i >= 0 && j >= 0 && i < FOG_SIZE && j < FOG_SIZE && this.fog[j * FOG_SIZE + i] === 1;
    };
    const contacts = [];
    const f = this.flagship;
    if (f && !f.dead && this.flagshipLastSeen) {
      const live = this.#isKnown(f);
      contacts.push({ kind: 'flagship', position: live ? f.position : this.flagshipLastSeen, stale: !live });
    }
    for (const d of this.drones) if (d.detected) contacts.push({ kind: 'fighter', position: d.position });
    for (const c of this.corvettes) if (!c.dead && this.#isKnown(c)) contacts.push({ kind: 'corvette', position: c.position });
    for (const t of this.torpedoes) if (!t.dead) contacts.push({ kind: t.hostile ? 'torpedo' : 'ourTorpedo', position: t.position });
    for (const s of this.satellites) if (s.discovered) contacts.push({ kind: 'satellite', position: s.position, salvaged: s.salvaged });
    for (const p of this.pickups.items) if (explored(p.position)) contacts.push({ kind: 'energy', position: p.position });
    this.map.draw({
      radius: CONFIG.sector.radius,
      fog: { cells: this.fog, size: FOG_SIZE, extent: this.fogExtent },
      rocks: this.field.rocks
        .filter((r) => r.size === 'large' && explored(r.position))
        .concat(this.field.landmark && explored(this.field.landmark.position) ? [this.field.landmark] : []),
      sensors: this.#sensors(),
      contacts,
      scouts: this.scouts.filter((s) => !s.dead),
      ship: { position: this.warship.position, heading: this.warship.heading },
      waypoint: this.course ? (this.course.entity ? this.course.entity.position : this.course.point) : null,
    });
  }

  #placeCamera(dt) {
    const cam = this.camera;
    const w = this.warship;

    // Photo mode from the console: game.photo = { position: [x, y, z], target: [x, y, z] }.
    if (this.photo) {
      cam.position.fromArray(this.photo.position);
      cam.lookAt(...this.photo.target);
      return;
    }

    if (this.state === 'title' || (this.state === 'gameover' && w.dead) || (w.dead && this.state === 'playing')) {
      // Orbit the warship (or its wreck) from outside.
      const a = this.time * 0.035 + 0.6;
      const dist = w.dead ? 900 : 640;
      cam.position.set(w.position.x + Math.sin(a) * dist, w.position.y + 120, w.position.z + Math.cos(a) * dist);
      cam.lookAt(w.position.x, w.position.y + 25, w.position.z - 40);
      this.#applyFov(this.baseFov);
      return;
    }

    if (this.mode === 'pilot' && this.pilot) {
      const p = this.pilot;
      cam.position.copy(p.position);
      cam.quaternion.copy(p.quaternion);
      this.#shakeCamera();
      const boost = p.boosting > 0 ? 1 : 0;
      const target = this.baseFov + Math.min(p.speed / 400, 1) * 4 + boost * 6;
      this.#applyFov(this.fov + (target - this.fov) * smooth(5, dt));
      return;
    }

    // On the bridge: the anchor moves with the ship; you look around from it.
    const anchor = w.model.bridgeAnchor;
    anchor.getWorldPosition(cam.position);
    anchor.getWorldQuaternion(cam.quaternion);
    this._e.set(this.look.pitch, this.look.yaw, 0, 'YXZ');
    cam.quaternion.multiply(this._q.setFromEuler(this._e));
    this.#shakeCamera();
    const warp = this.state === 'warp' ? this.tunnel.intensity : 0;
    const target = this.baseFov + warp * 28;
    this.#applyFov(this.fov + (target - this.fov) * smooth(4, dt));
  }

  #shakeCamera() {
    if (this.shake <= 0 || this.reduceMotion) return;
    const s = this.shake * this.shake;
    this.camera.position.add(randomUnit(this._v).multiplyScalar(s * 0.35));
    this.camera.rotateX(rand(-1, 1) * s * 0.01);
    this.camera.rotateY(rand(-1, 1) * s * 0.01);
  }

  #applyFov(fov) {
    this.fov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    const viewScale = (this.height * (this.dpr || 1)) / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    this.effects.setViewScale(viewScale);
  }
}
