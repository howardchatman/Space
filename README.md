# Deep Field

An arcade space shooter that runs in the browser. You fly a small ship through the Hubble Ultra Deep
Field, break up drifting rocks, outfly hunter drones, and pick a refit for your ship after every sector.

No build step and no dependencies: plain JavaScript modules and an HTML canvas.

## Play it locally

The game uses ES modules, so it has to be served over HTTP (opening `index.html` straight from disk won't work).

```sh
npm start            # serves the folder on http://localhost:3000
# or
python3 -m http.server 8000
```

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Turn | ← → or A D | Drag on the left half of the screen |
| Thrust | ↑ or W | Drag further from where your thumb landed |
| Fire | Space or J | Hold **Fire**, or touch anywhere on the right half |
| Boost (short dodge) | Shift or K | Tap **Boost** |
| Pause | P or Esc | Pause button |
| Sound on/off | M | Speaker button |

## How a run works

- **Sectors.** Each sector starts with large rocks. Big rocks split into two medium ones, and medium rocks split into two small ones.
  From sector 2, drones warp in, circle you and fire leading shots. Their core flares just before they fire.
- **Shield.** Hits drain your shield and give you a short grace period. At zero, the run ends.
- **Combo.** Kills within about 2 seconds of each other build a multiplier, up to ×5. Taking a hit resets it.
- **Pickups.** Destroyed rocks and drones sometimes drop a shield cell (blue +) or overdrive (orange »), which doubles your fire rate for 6 seconds.
- **Refits.** Clearing a sector gives a score bonus and a choice of three upgrades, such as extra barrels, faster fire, more shield, or regeneration.

Your best score is saved in the browser.

## Project layout

```
index.html            page markup: canvas, HUD and menu screens
styles.css            all styling; color tokens here are also used by the canvas
src/
  main.js             boots the game and runs the frame loop
  config.js           every gameplay number (speeds, damage, scores, timings)
  game.js             world state, sector flow, collisions, rendering
  input.js            keyboard and touch controls
  audio.js            synthesized sound effects (Web Audio, no audio files)
  ui.js               HUD, banners and menus (DOM)
  upgrades.js         the refit list
  entities/           ship, asteroid, drone, bullet, pickup
  fx/particles.js     sparks and shockwave rings
  world/starfield.js  deep-field backdrop and parallax stars
```

## Tweaking

Most balance changes are one-line edits in `src/config.js`. New refits go in `src/upgrades.js`.
While the game is running, `window.game` is available in the browser console:

```js
game.stats.guns = 3        // triple cannons
game.ship.shield = 999     // effectively invincible
```

## Publish with GitHub Pages

In the repository's **Settings → Pages**, set the source to **Deploy from a branch**, pick `main` and `/ (root)`.
The game is then live at `https://<user>.github.io/<repo>/`.

## Ideas for what's next

- Boss drone every fifth sector
- More enemy types (mine layers, shielded rocks)
- Gamepad support
- A persistent hangar where scrap buys permanent upgrades between runs
- Online leaderboard
