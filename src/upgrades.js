// Refits offered between sectors. Each one mutates the ship's stats (see baseStats in entities/player.js).
export const UPGRADES = [
  {
    id: 'cannon',
    name: 'Linked Cannons',
    desc: 'Both wing cannons fire together. Second level adds a nose cannon.',
    max: 2,
    apply: (s) => { s.guns += 1; },
  },
  {
    id: 'capacitors',
    name: 'Rapid Capacitors',
    desc: 'Fire 18% faster.',
    max: 4,
    apply: (s) => { s.fireInterval *= 0.82; },
  },
  {
    id: 'rounds',
    name: 'Heavy Bolts',
    desc: 'Each bolt deals 1 more damage.',
    max: 3,
    apply: (s) => { s.boltDamage += 1; },
  },
  {
    id: 'rail',
    name: 'Focusing Coils',
    desc: 'Bolts fly 20% faster and reach farther.',
    max: 3,
    apply: (s) => { s.boltSpeed *= 1.2; s.boltRange *= 1.12; },
  },
  {
    id: 'plating',
    name: 'Shield Emitters',
    desc: 'Max shield +25, and a full recharge now.',
    max: 4,
    apply: (s, ship) => { s.maxShield += 25; ship.shield = s.maxShield; },
  },
  {
    id: 'regen',
    name: 'Field Regenerator',
    desc: 'Shield recharges 1.5 points every second.',
    max: 3,
    apply: (s) => { s.regen += 1.5; },
  },
  {
    id: 'ion',
    name: 'Ion Thrusters',
    desc: 'Top speed, acceleration and turning +12%.',
    max: 3,
    apply: (s) => {
      s.maxSpeed *= 1.12;
      s.accel *= 1.12;
      s.turnRate *= 1.12;
      s.rollRate *= 1.12;
    },
  },
  {
    id: 'afterburner',
    name: 'Afterburner Coils',
    desc: 'Boost recharges 30% faster.',
    max: 3,
    apply: (s) => { s.boostCooldown *= 0.7; },
  },
  {
    id: 'tractor',
    name: 'Tractor Beam',
    desc: 'Pulls in supply crystals from twice as far away.',
    max: 2,
    apply: (s) => { s.magnetRange *= 2; },
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
