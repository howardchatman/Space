/**
 * Everything the captain can order. Each command has a button label, a hotkey and the phrases that
 * trigger it by voice. Phrases are matched longest first, so "fire the death ray" beats "fire".
 */
export const COMMANDS = [
  { id: 'cannons', label: 'Fire cannons', key: '1', code: 'Digit1', phrases: ['fire the cannons', 'fire cannons', 'fire the guns', 'fire the batteries', 'open fire', 'cannons', 'guns', 'fire'] },
  { id: 'deathray', label: 'Death ray', key: '2', code: 'Digit2', phrases: ['fire the death ray', 'death ray', 'deathray', 'fire the ray', 'the ray'] },
  { id: 'torpedoes', label: 'Torpedoes', key: '9', code: 'Digit9', phrases: ['fire the torpedoes', 'fire torpedoes', 'launch torpedoes', 'launch the torpedoes', 'torpedoes away', 'fire a torpedo', 'torpedoes', 'torpedo'] },
  { id: 'evasive', label: 'Evasive', key: 'Z', code: 'KeyZ', phrases: ['evasive maneuvers', 'evasive maneuver', 'evasive action', 'take evasive action', 'evade', 'evasive', 'dodge'] },
  { id: 'damage-control', label: 'Damage control', key: 'H', code: 'KeyH', phrases: ['damage control teams', 'damage control', 'patch the hull', 'patch her up', 'repair the hull', 'repair crews'] },
  { id: 'recon', label: 'Send recon', key: '3', code: 'Digit3', phrases: ['send out the recon', 'send the recon', 'send out recon', 'launch the recon', 'launch recon', 'launch the scouts', 'send scouts', 'recon', 'scouts'] },
  { id: 'recall', label: 'Recall recon', key: '4', code: 'Digit4', phrases: ['recall the recon', 'recall the scouts', 'bring them home', 'bring them back', 'recall'] },
  { id: 'course', label: 'Set course', key: 'C', code: 'KeyC', phrases: ['set course', 'plot a course', 'take us there', 'head for the target', 'helm'] },
  { id: 'pilot', label: 'Fly a scout', key: 'B', code: 'KeyB', phrases: ["i'll fly", 'i will fly', 'let me fly', 'fly a scout', 'take a scout', 'take the scout', 'hop in', 'pilot'] },
  { id: 'return', label: 'Back to bridge', key: 'B', code: null, phrases: ['back to the ship', 'return to the ship', 'back to the bridge', 'return to the bridge', 'take me back'] },
  { id: 'engineering', label: 'Engineering', key: 'G', code: 'KeyG', phrases: ['engineering', 'repair', 'fix the ship'] },
  { id: 'map', label: 'Map', key: 'Tab', code: 'Tab', phrases: ['tactical map', 'show the map', 'open the map', 'close the map', 'map'] },
  { id: 'full', label: 'Ahead full', key: 'W', code: null, phrases: ['ahead full', 'full ahead', 'full speed', 'all ahead'] },
  { id: 'stop', label: 'All stop', key: 'X', code: 'KeyX', phrases: ['all stop', 'full stop', 'stop the ship', 'stop'] },
  { id: 'power-weapons', label: 'Power to weapons', key: '5', code: 'Digit5', phrases: ['divert power to weapons', 'all power to weapons', 'power to weapons', 'power to the weapons', 'weapons power'] },
  { id: 'power-shields', label: 'Power to shields', key: '6', code: 'Digit6', phrases: ['divert power to shields', 'all power to shields', 'power to shields', 'power to the shields', 'shields power', 'raise shields'] },
  { id: 'power-engines', label: 'Power to engines', key: '7', code: 'Digit7', phrases: ['divert power to engines', 'all power to engines', 'power to engines', 'power to the engines', 'engines power'] },
  { id: 'power-balanced', label: 'Balance power', key: '8', code: 'Digit8', phrases: ['balance power', 'balanced power', 'even out the power', 'normal power'] },
  { id: 'target', label: 'Next target', key: 'T', code: 'KeyT', phrases: ['next target', 'change target', 'lock on', 'target'] },
  { id: 'target-guns', label: 'Target their guns', key: null, code: null, phrases: ['target their guns', 'target the guns', 'target their weapons', 'target their batteries', 'take out their guns'] },
  { id: 'target-engines', label: 'Target their engines', key: null, code: null, phrases: ['target their engines', 'target the engines', 'take out their engines'] },
  { id: 'target-hangar', label: 'Target their hangar', key: null, code: null, phrases: ['target their hangar', 'target the hangar', 'take out their hangar', 'target their fighter bay'] },
  { id: 'target-hull', label: 'Target their hull', key: null, code: null, phrases: ['target the flagship', 'target their hull', 'target the hull', 'target the ship', 'target their ship'] },
  { id: 'warp', label: 'Warp', key: 'J', code: 'KeyJ', phrases: ['engage warp', 'warp speed', 'warp drive', 'punch it', 'warp', 'jump', 'engage'] },
];

const byPhrase = COMMANDS
  .flatMap((c) => c.phrases.map((phrase) => ({ phrase, id: c.id })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

/** The command id a spoken sentence asks for, or null. */
export function matchCommand(transcript) {
  const text = ` ${transcript.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  for (const { phrase, id } of byPhrase) {
    if (text.includes(` ${phrase} `)) return id;
  }
  return null;
}
