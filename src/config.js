// Every gameplay tunable lives here. Distances are in field units (see fieldArea) and times in seconds.
export const CONFIG = {
  // The field always covers about this many units, whatever the screen shape, so a wide monitor
  // doesn't make the game easier. Small screens get a slightly smaller field (see minViewScale).
  fieldArea: 1280 * 720,
  // Smallest on-screen pixels per field unit, so the ship stays a readable size on phones.
  minViewScale: 0.78,
  maxPixelRatio: 2,

  ship: {
    radius: 13,
    turnRate: 4.6, // radians per second
    thrust: 460,
    maxSpeed: 430,
    drag: 0.55, // share of velocity lost per second
    fireInterval: 0.2,
    bulletSpeed: 720,
    bulletLife: 0.85,
    bulletDamage: 1,
    maxShield: 100,
    invulnerable: 1.4, // grace period after a hit
    boostImpulse: 520,
    boostDuration: 0.35,
    boostCooldown: 2.6,
    magnetRange: 110,
  },

  // Keyed by size tier: 3 splits into two 2s, a 2 splits into two 1s.
  asteroid: {
    3: { radius: 50, hp: 4, speed: [28, 60], score: 20, damage: 30 },
    2: { radius: 28, hp: 2, speed: [45, 95], score: 50, damage: 20 },
    1: { radius: 15, hp: 1, speed: [70, 140], score: 100, damage: 12 },
  },

  drone: {
    firstWave: 2,
    radius: 14,
    hp: 3,
    accel: 240,
    maxSpeed: 210,
    fireInterval: [1.6, 2.6],
    bulletSpeed: 300,
    bulletDamage: 14,
    damage: 18, // on collision
    score: 150,
    warpTime: 0.9, // harmless warp-in before it can act
  },

  pickups: {
    dropChance: { asteroid: 0.08, drone: 0.3 },
    life: 10,
    shieldAmount: 30,
    overdriveTime: 6,
  },

  combo: {
    window: 2.2, // seconds to land the next kill and keep the chain
    killsPerStep: 3,
    maxMultiplier: 5,
  },

  waveClearDelay: 1.4,
  sectorRepair: 20, // shield restored between sectors
};
