import { CONFIG } from './config.js';

/** A fresh copy of the warship's upgradeable stats. Refits mutate this object. */
export function baseShipStats() {
  const w = CONFIG.warship;
  return {
    maxHull: w.hull,
    maxShield: w.shield,
    shieldRegen: w.shieldRegen,
    maxEnergy: w.energy,
    energyRegen: w.energyRegen,
    reload: w.cannon.reload,
    cannonDamage: w.cannon.damage,
    rayDamage: w.deathRay.damage,
    rayCost: w.deathRay.cost,
    speed: 1,
    scanRange: w.scanRange,
    scouts: CONFIG.scout.count,
    scoutHp: CONFIG.scout.hp,
  };
}

// Refits offered after each warp jump.
export const UPGRADES = [
  {
    id: 'armor',
    name: 'Reinforced Armor',
    desc: 'Hull +200, and the yard repairs 200 damage now.',
    max: 4,
    apply: (s, ship) => {
      s.maxHull += 200;
      ship.maxHull = s.maxHull;
      ship.hull = Math.min(ship.maxHull, ship.hull + 200);
    },
  },
  {
    id: 'shields',
    name: 'Shield Capacitors',
    desc: 'Shields hold 150 more and recharge 25% faster.',
    max: 3,
    apply: (s, ship) => {
      s.maxShield += 150;
      s.shieldRegen *= 1.25;
      ship.maxShield = s.maxShield;
    },
  },
  {
    id: 'autoloaders',
    name: 'Autoloaders',
    desc: 'Main batteries reload 20% faster.',
    max: 3,
    apply: (s) => { s.reload *= 0.8; },
  },
  {
    id: 'shells',
    name: 'Heavy Bolts',
    desc: 'Main battery hits deal 30% more damage.',
    max: 3,
    apply: (s) => { s.cannonDamage *= 1.3; },
  },
  {
    id: 'array',
    name: 'Focusing Array',
    desc: 'The death ray deals 30% more damage.',
    max: 3,
    apply: (s) => { s.rayDamage *= 1.3; },
  },
  {
    id: 'reactor',
    name: 'Reactor Tuning',
    desc: 'Energy recharges 60% faster and the ray costs 5 less.',
    max: 3,
    apply: (s) => {
      s.energyRegen *= 1.6;
      s.rayCost -= 5;
    },
  },
  {
    id: 'engines',
    name: 'Engine Overhaul',
    desc: 'Top speed and turning +15%.',
    max: 2,
    apply: (s) => { s.speed *= 1.15; },
  },
  {
    id: 'sensors',
    name: 'Long-Range Sensors',
    desc: 'Scanner range +30%.',
    max: 2,
    apply: (s) => { s.scanRange *= 1.3; },
  },
  {
    id: 'hangar',
    name: 'Expanded Hangar',
    desc: 'One more recon craft, and all of them get 50% more armor.',
    max: 2,
    apply: (s) => {
      s.scouts += 1;
      s.scoutHp *= 1.5;
    },
  },
];

/** Up to `count` random upgrades that aren't maxed out yet. */
export function rollUpgrades(levels, count = 3) {
  const pool = UPGRADES.filter((u) => (levels[u.id] ?? 0) < u.max);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
