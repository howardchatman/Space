# Deep Field

A first-person space combat game that runs in the browser. You fly an interceptor from the cockpit
through an asteroid belt above an unnamed blue world, hunting drones that drop out of warp, and refit
your ship between sectors.

Built with [Three.js](https://threejs.org) (WebGL). There is no build step: plain JavaScript modules,
with Three.js vendored in `vendor/` so the game runs offline.

## Play it locally

The game uses ES modules, so it has to be served over HTTP (opening `index.html` from disk won't work).

```sh
npm start            # serves the folder on http://localhost:3000
# or
python3 -m http.server 8000
```

Click **Launch**. The game captures your mouse so you can steer; press Esc to release it and pause.

## Controls

| Action | Mouse and keyboard | Touch |
| --- | --- | --- |
| Steer (pitch and yaw) | Move the mouse, or the arrow keys | Drag on the left half of the screen |
| Fire | Left click or Space | Hold **Fire**, or touch anywhere on the right half |
| Throttle up / down | W / S | Fixed cruise speed |
| Strafe left / right | A / D | |
| Strafe up / down | R / F | |
| Roll | Q / E | |
| Boost (short dodge) | Shift or right click | Tap **Boost** |
| Pause | Esc or P | Pause button |
| Sound on/off | M | Speaker button |

If your browser won't let the game capture the mouse, it falls back to cursor steering: the farther the
cursor is from the center, the faster you turn.

## How a run works

- **Sectors.** Each sector sends a wave of drones. They warp in, make attack runs, fire short bursts, then
  break off and come around again. Destroy them all to clear the sector.
- **The HUD.** Red brackets mark hostiles with their range. The orange diamond is the lead pip: aim there
  and your bolts meet the target. The blue circle with wings shows where you're actually drifting.
  The scanner at the bottom shows contacts around you; stalks show whether they're above or below.
- **Asteroids.** Large rocks break into medium ones, and medium into small. Rocks block everyone's fire,
  so use them as cover. Hitting one at speed damages your shield.
- **Shield.** Hits drain it. At zero, the run ends.
- **Combo.** Kills within about 3 seconds of each other build a multiplier, up to ×5. Taking a hit resets it.
- **Supplies.** Destroyed drones and broken rock sometimes drop crystals: blue restores shield, orange
  (overdrive) doubles your fire rate for 6 seconds.
- **Refits.** Clearing a sector gives a score bonus and a choice of three upgrades, such as linked cannons,
  faster fire, stronger shields or better thrusters.

Your best score is saved in the browser.

## What makes it look real

- **Stars** follow a real brightness distribution (many faint, few bright), crowd toward the Milky Way,
  and are colored by temperature, from orange K stars to blue-white B stars.
- **The Milky Way** is a procedural band with a brighter core and dark dust lanes, baked once into a cube map.
- **The planet** is generated with noise and baked into cube maps: continents, biomes, ice caps and clouds.
  It's lit live, with ocean sun glint, cloud shadows, city lights on the night side, and an atmosphere that
  glows blue at the limb and orange at the terminator.
- **The sun** is a half-degree disc with glare. Looking toward it dims the faint sky, like a real eye or camera.
- **Lighting** is harsh and one-directional, as in space: no air to soften shadows, just faint blue light
  reflected off the planet. The cockpit frame is lit by the same sun, so it changes as you turn.
- **Rendering** is HDR with bloom and a filmic tone curve.

## Project layout

```
index.html              page markup: 3D view, HUD readouts and menu screens
styles.css              all styling; color tokens here are also used by the 3D scene and HUD
src/
  main.js               boots the game and runs the frame loop
  config.js             every gameplay number (speeds, damage, scores, timings)
  game.js               scene setup, sector flow, combat, collisions, camera
  input.js              mouse (pointer lock), keyboard and touch controls
  hud.js                crosshair, target brackets, lead pip, scanner (2D canvas over the 3D view)
  cockpit.js            cockpit frame, dashboard and muzzle flashes
  ui.js                 HUD readouts, banners and menus (DOM)
  audio.js              synthesized sound effects (Web Audio, no audio files)
  upgrades.js           the refit list
  engine/renderer.js    WebGL renderer, bloom and tone mapping
  world/                sky (stars, Milky Way), sun, planet, asteroids, space dust, noise
  entities/             player ship, drones, laser bolts, supply pickups
  fx/                   explosions, sparks, debris, generated textures
vendor/three/           Three.js r170 (MIT licence) and the few add-ons the game uses
```

## Tweaking

Most balance changes are one-line edits in `src/config.js`. New refits go in `src/upgrades.js`.
While the game is running, `window.game` is available in the browser console:

```js
game.stats.guns = 3          // all three cannons
game.player.shield = 9999    // effectively invincible
```

## Publish with GitHub Pages

In the repository's **Settings → Pages**, set the source to **Deploy from a branch**, pick `main` and `/ (root)`.
The game is then live at `https://<user>.github.io/<repo>/`.

## Ideas for what's next

- A capital ship or boss every fifth sector
- Missiles with a lock-on tone
- Gamepad and flight-stick support
- Cockpit instruments that show live data
- A hangar between runs where salvage buys permanent upgrades
