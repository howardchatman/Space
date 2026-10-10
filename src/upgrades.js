// Refits offered between sectors. Each one mutates the ship's stats (see baseStats in entities/ship.js).
export const UPGRADES = [
  {
    id: 'cannon',
    name: 'Extra Barrel',
    desc: 'Adds a cannon. The third one fans your shots out.',
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
    name: 'Tungsten Rounds',
    desc: 'Each shot deals 1 more damage.',
    max: 3,
    apply: (s) => { s.bulletDamage += 1; },
  },
  {
    id: 'rail',
    name: 'Rail Accelerator',
    desc: 'Shots fly 20% faster and reach farther.',
    max: 3,
    apply: (s) => { s.bulletSpeed *= 1.2; s.bulletLife *= 1.1; },
  },
  {
    id: 'plating',
    name: 'Hull Plating',
    desc: 'Max shield +25, and a full repair now.',
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
    desc: 'Thrust, turning and top speed +12%.',
    max: 3,
    apply: (s) => { s.thrust *= 1.12; s.maxSpeed *= 1.12; s.turnRate *= 1.12; },
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
    desc: 'Pulls in pickups from twice as far away.',
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
