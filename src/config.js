// Every gameplay tunable lives here. Distances are in meters, speeds in m/s, times in seconds.
export const CONFIG = {
  maxPixelRatio: 2,
  fov: 72, // vertical field of view in degrees on a landscape screen

  player: {
    radius: 6,
    maxSpeed: 140, // at full throttle
    strafeSpeed: 55,
    accel: 85,
    turnRate: 1.9, // pitch/yaw, radians per second at full stick
    rollRate: 2.4,
    mouseSensitivity: 0.0021, // radians per mouse pixel
    startThrottle: 0.55,
    fireInterval: 0.13,
    boltSpeed: 950,
    boltRange: 1150,
    boltDamage: 1,
    convergence: 380, // where the two wing cannons cross
    maxShield: 100,
    invulnerable: 0.5, // grace period after a hit
    boostSpeed: 360,
    boostDuration: 1.1,
    boostCooldown: 4,
    magnetRange: 70,
  },

  field: {
    radius: 1500, // asteroids are scattered inside this sphere
    flatten: 0.45, // squashes the field into a belt
    count: 64,
    safeRadius: 260, // no rocks spawn this close to the player
    boundary: 2100, // beyond this the HUD warns and the ship is pushed back
  },

  // Asteroid size classes. Large rocks break into medium ones, medium into small.
  asteroid: {
    large: { radius: [42, 85], hp: 14, score: 30, breaksInto: 'medium', pieces: [2, 3] },
    medium: { radius: [15, 26], hp: 5, score: 60, breaksInto: 'small', pieces: [2, 3] },
    small: { radius: [5, 9], hp: 2, score: 100, breaksInto: null, pieces: [0, 0] },
    drift: 6, // max drift speed of a large rock
    impactDamage: [6, 45], // shield damage when you hit one, scaled by closing speed
    harmlessSpeed: 14, // bumps slower than this don't hurt
  },

  drone: {
    hitRadius: 6.5,
    hp: 4,
    speed: 125,
    turnRate: 1.5,
    range: 750,
    aimCone: 0.18, // radians; fires when the shot line is this close to you
    burst: 3,
    burstGap: 0.11,
    fireInterval: [1.1, 2.0],
    aimError: 0.025, // radians of random spread
    boltSpeed: 430,
    boltDamage: 7,
    ramDamage: 25,
    breakOff: 150, // distance at which it peels away after an attack run
    score: 250,
    warpTime: 1.1,
  },

  pickups: {
    dropChance: { asteroid: 0.07, drone: 0.35 },
    life: 25,
    shieldAmount: 30,
    overdriveTime: 6,
  },

  combo: {
    window: 3, // seconds to land the next kill and keep the chain
    killsPerStep: 3,
    maxMultiplier: 5,
  },

  sectorClearDelay: 2,
  sectorRepair: 20, // shield restored between sectors
};
