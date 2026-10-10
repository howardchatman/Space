// Every gameplay tunable lives here. Distances are in meters, speeds in m/s, times in seconds.
export const CONFIG = {
  maxPixelRatio: 2,
  fov: 72, // vertical field of view in degrees on a landscape screen

  // The sector you explore each level. The enemy flagship hides somewhere inside it.
  sector: {
    radius: 7000, // soft boundary around the origin
    start: 5200, // the warship arrives this far out on the +Z side, facing the center
    clusters: 5, // asteroid clusters
    satellites: 4, // derelicts with salvage
    flagshipMinDistance: 7000, // from where you arrive
  },

  // Your warship. Huge, slow, commanded rather than flown.
  warship: {
    length: 420,
    maxSpeed: 55,
    reverseSpeed: 12,
    accel: 4,
    yawRate: 0.1, // radians per second at full rudder
    pitchRate: 0.07,
    turnAccel: 0.08, // how quickly the turn rate changes
    hull: 1000,
    shield: 400,
    shieldRegen: 8, // per second, after shieldDelay without being hit
    shieldDelay: 4,
    energy: 100,
    energyRegen: 1.2,
    scanRange: 2000,
    lookSensitivity: 0.0035, // radians per pixel when dragging the view
    cannon: {
      volley: 1.8, // seconds of firing per command
      shotGap: 0.42, // seconds between shots from one barrel pair
      reload: 4,
      boltSpeed: 750,
      range: 2600,
      damage: 14,
      spread: 0.008,
    },
    deathRay: {
      cost: 50,
      charge: 1.6,
      duration: 1.1,
      damage: 650,
      range: 4500,
      arc: 0.45, // radians off the bow the ray can reach
      reload: 12,
    },
    magnetRange: 450, // tractor beam for energy cells
  },

  // Enemy capital ship.
  flagship: {
    hull: 2400,
    hullPerSector: 500,
    shield: 550,
    shieldPerSector: 150,
    shieldRegen: 12,
    shieldDelay: 6,
    parts: { gun: 120, engines: 320, hangar: 260 },
    partsPerSector: 0.2,
    speed: 30,
    yawRate: 0.08,
    noticeRange: 3600,
    engageRange: 1700,
    gunRange: 2600,
    gunInterval: [0.7, 1.3],
    boltSpeed: 520,
    boltDamage: 8,
    boltDamagePerSector: 1.5,
    spread: 0.02,
    launchInterval: 24,
    maxFighters: 4,
    score: 2500,
  },

  // Enemy corvettes: escorts and patrols that fight at range and fire homing torpedoes.
  corvette: {
    hull: 300,
    hullPerSector: 70,
    speed: 60,
    yawRate: 0.3,
    noticeRange: 3000,
    standoff: 1500,
    gunRange: 2300,
    gunInterval: [0.9, 1.5],
    boltSpeed: 480,
    boltDamage: 8,
    torpedoRange: 2800,
    torpedoInterval: [9, 14],
    score: 600,
  },

  torpedo: {
    launchSpeed: 50,
    speed: 175,
    accel: 45,
    turnRate: 0.5,
    life: 32,
    hp: 5,
    damage: 75,
  },

  // Your warship's automatic point-defense guns.
  pointDefense: {
    range: 750,
    rate: 9, // shots per second per mount
    boltSpeed: 1300,
    spread: 0.014,
  },

  // Recon craft. They launch from the hangar, fan out ahead and reveal what's around them.
  scout: {
    count: 4,
    speed: 170,
    turnRate: 1.6,
    hp: 40,
    scanRange: 1500,
    patrolDistance: 2300,
  },

  // Power distribution: multipliers while the reactor favours one system.
  power: {
    balanced: { reload: 1, damage: 1, shieldRegen: 1, speed: 1, pointDefense: 1, damageTaken: 1 },
    weapons: { reload: 0.7, damage: 1.2, shieldRegen: 0.5, speed: 0.85, pointDefense: 1.4, damageTaken: 1 },
    shields: { reload: 1.35, damage: 1, shieldRegen: 2.2, speed: 0.85, pointDefense: 1, damageTaken: 0.8 },
    engines: { reload: 1.2, damage: 1, shieldRegen: 0.6, speed: 1.4, pointDefense: 0.8, damageTaken: 1 },
  },

  systems: {
    // Share of incoming hull damage that also wears down a random system (per point of damage).
    wearPerDamage: 0.004,
    repairAmount: 0.45,
  },

  // When you pilot a recon craft yourself.
  player: {
    radius: 6,
    maxSpeed: 160,
    strafeSpeed: 55,
    accel: 90,
    turnRate: 1.9,
    rollRate: 2.4,
    mouseSensitivity: 0.0021,
    startThrottle: 0.6,
    fireInterval: 0.13,
    boltSpeed: 950,
    boltRange: 1150,
    boltDamage: 1,
    convergence: 380,
    maxShield: 100,
    invulnerable: 0.5,
    boostSpeed: 380,
    boostDuration: 1.1,
    boostCooldown: 4,
    magnetRange: 90,
  },

  // Asteroid size classes. Large rocks break into medium ones, medium into small.
  asteroid: {
    large: { radius: [42, 85], hp: 14, score: 30, breaksInto: 'medium', pieces: [2, 3], ramDamage: 40 },
    medium: { radius: [15, 26], hp: 5, score: 60, breaksInto: 'small', pieces: [2, 3], ramDamage: 14 },
    small: { radius: [5, 9], hp: 2, score: 100, breaksInto: null, pieces: [0, 0], ramDamage: 4 },
    drift: 4,
    impactDamage: [6, 45], // fighter shield damage, scaled by closing speed
    harmlessSpeed: 14,
  },

  // Small enemy fighters.
  drone: {
    hitRadius: 6.5,
    hp: 4,
    speed: 135,
    turnRate: 1.5,
    range: 800,
    aimCone: 0.18,
    burst: 3,
    burstGap: 0.11,
    fireInterval: [1.1, 2.0],
    aimError: 0.025,
    boltSpeed: 430,
    boltDamage: 6,
    ramDamage: 25,
    breakOff: 150,
    score: 150,
    warpTime: 1.1,
  },

  pickups: {
    dropChance: { asteroid: 0.06, drone: 0.7 },
    life: 40,
    energyAmount: 12,
    shieldAmount: 30,
    overdriveTime: 6,
  },

  salvage: { energy: 30, score: 300, range: 380 },

  combo: { window: 4, killsPerStep: 3, maxMultiplier: 5 },

  // After-action bonus when a sector is cleared: points for every second under par, and for a clean hull.
  report: { parTime: 480, perSecond: 4, cleanHull: 150, cleanBonus: 800 },
};
