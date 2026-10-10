/**
 * Everything the captain can order. Each command has a button label, a hotkey and the phrases that
 * trigger it by voice. Phrases are matched longest first, so "fire the death ray" beats "fire".
 */
export const COMMANDS = [
  { id: 'cannons', label: 'Fire cannons', key: '1', code: 'Digit1', phrases: ['fire the cannons', 'fire cannons', 'fire the guns', 'fire the batteries', 'open fire', 'cannons', 'guns', 'fire'] },
  { id: 'deathray', label: 'Death ray', key: '2', code: 'Digit2', phrases: ['fire the death ray', 'death ray', 'deathray', 'fire the ray', 'the ray'] },
  { id: 'recon', label: 'Send recon', key: '3', code: 'Digit3', phrases: ['send out the recon', 'send the recon', 'send out recon', 'launch the recon', 'launch recon', 'launch the scouts', 'send scouts', 'recon', 'scouts'] },
  { id: 'recall', label: 'Recall recon', key: '4', code: 'Digit4', phrases: ['recall the recon', 'recall the scouts', 'bring them home', 'bring them back', 'recall'] },
  { id: 'course', label: 'Set course', key: 'C', code: 'KeyC', phrases: ['set course', 'plot a course', 'take us there', 'head for the target', 'helm'] },
  { id: 'pilot', label: 'Fly a scout', key: 'B', code: 'KeyB', phrases: ["i'll fly", 'i will fly', 'let me fly', 'fly a scout', 'take a scout', 'take the scout', 'hop in', 'pilot'] },
  { id: 'return', label: 'Back to bridge', key: 'B', code: null, phrases: ['back to the ship', 'return to the ship', 'back to the bridge', 'return to the bridge', 'take me back'] },
  { id: 'engineering', label: 'Engineering', key: 'G', code: 'KeyG', phrases: ['engineering', 'damage control', 'repair', 'fix the ship'] },
  { id: 'map', label: 'Map', key: 'Tab', code: 'Tab', phrases: ['tactical map', 'show the map', 'open the map', 'close the map', 'map'] },
  { id: 'full', label: 'Ahead full', key: 'W', code: null, phrases: ['ahead full', 'full ahead', 'full speed', 'all ahead'] },
  { id: 'stop', label: 'All stop', key: 'X', code: 'KeyX', phrases: ['all stop', 'full stop', 'stop the ship', 'stop'] },
  { id: 'target', label: 'Next target', key: 'T', code: 'KeyT', phrases: ['next target', 'change target', 'target the flagship', 'lock on', 'target'] },
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
