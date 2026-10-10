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
    hull: 1600,
    hullPerSector: 450,
    speed: 30,
    yawRate: 0.08,
    noticeRange: 3600,
    engageRange: 1700,
    gunRange: 2600,
    gunInterval: [0.55, 1.1],
    boltSpeed: 520,
    boltDamage: 15,
    spread: 0.02,
    launchInterval: 24,
    maxFighters: 4,
    score: 2500,
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
};
