# Deep Field

A first-person space game in the browser. You command a capital warship from its bridge: find the enemy
flagship hiding somewhere in each sector, order your crew to fire, send out recon, fly a scout yourself,
and keep the ship running. Destroy the flagship, then jump to warp to reach the next sector.

Built with [Three.js](https://threejs.org) (WebGL). There is no build step: plain JavaScript modules,
with Three.js vendored in `vendor/` so the game runs offline.

## Play it locally

The game uses ES modules, so it has to be served over HTTP (opening `index.html` from disk won't work).

```sh
npm start            # serves the folder on http://localhost:3000
# or
python3 -m http.server 8000
```

## How a sector plays

1. **Arrive.** The warship drops out of warp at the edge of a 14 km sector of asteroid clusters,
   derelict satellites, enemy fighter patrols and a planet on the horizon: a rocky world, or a gas
   giant with rings.
2. **Search.** The enemy flagship is far away and not on your scanners. **Send out the recon**: four
   scouts launch from the hangar, fan out ahead and reveal everything near them. The tactical map shows
   what's been explored; switch it to **Send recon** and tap a point to send the nearest scout there.
3. **Close in.** Pick the flagship as your target and **set course**. The helm brings the ship around and
   keeps the bow on it. Fighters and corvettes attack along the way; shooting them down drops energy cells.
   Corvettes fire homing torpedoes, which your point-defense guns try to shoot down on their own.
4. **Fight.** Order the **cannons** (the deck turrets swing round and fire volleys) and the **death ray**
   (charges from the bow emitter; costs 50 energy and only fires within its arc off the bow, so the helm
   turns the ship until it can). The flagship's **shields** soak up fire first. Once they're down, target
   its **guns** to stop them shooting, its **engines** to slow it, or its **hangar** to stop fighters.
   **Torpedoes** hit hard (half as hard on shields), but you only carry six per sector and the flagship's
   point defense shoots them down. Its point defense runs off its gun batteries, so knock those out first.
   Badly hurt, the flagship **breaks off and runs**: chase it, or take out its engines so it can't.
5. **Keep her running.** Hits drain shields, then hull, and wear down engines, weapons, shields and sensors.
   Fires break out across a badly damaged hull. **Evasive maneuvers** make about half the incoming fire
   miss for a few seconds (but spoil your own aim). **Divert power** to weapons, shields or engines for the
   situation. **Damage control** sends repair crews to patch the hull and the worst system for some
   energy; at the **engineering** station, route power through the conduits for a bigger repair.
   Derelicts hold power cells and spare torpedoes.
6. **Jump.** The flagship breaks in two. **Engage warp**: you get an after-action report with a bonus for
   speed and a clean hull, pick a refit, and arrive in a tougher sector with a new sky.

You can also **fly a scout** yourself at any time: hop into one, explore, shoot fighters, and press B to
return to the bridge. The crew still takes your orders while you fly.

## Orders

Every order works three ways: the buttons along the bottom of the bridge, a key, or your voice.

| Order | Key | Say |
| --- | --- | --- |
| Fire cannons | 1 | "Fire the cannons", "open fire" |
| Death ray | 2 | "Fire the death ray" |
| Torpedoes | 9 | "Fire torpedoes", "torpedoes away" |
| Evasive maneuvers | Z | "Evasive maneuvers", "take evasive action" |
| Send recon | 3 | "Send out the recon" |
| Recall recon | 4 | "Recall the scouts" |
| Set course for the target | C | "Set course" |
| Next target | T | "Next target", "lock on" |
| Target their guns / engines / hangar | | "Target their guns", "target their engines", "target their hangar" |
| Target the flagship itself | | "Target the flagship", "target the hull" |
| Power to weapons / shields / engines | 5 / 6 / 7 | "Power to weapons", "divert power to shields" |
| Balance power | 8 | "Balance power" |
| Fly a scout / back to bridge | B | "I'll fly", "back to the ship" |
| Engineering | G | "Engineering", "repair" |
| Damage control | H | "Damage control", "patch the hull" |
| Tactical map | Tab | "Show the map" |
| Ahead full / all stop | W / X | "Ahead full", "all stop" |
| Warp | J | "Engage warp" |

The crew answers in the comms log and out loud (turn crew voices off with the speech-bubble button).

**Voice orders** use the browser's speech recognition: press V or the microphone button and allow the
microphone. They work in Chrome, Edge and Safari when the game runs from its own address (locally or on
GitHub Pages). Pages embedded without microphone access, such as a claude.ai artifact preview, can't
listen; use the buttons and keys there.

## On the bridge

| Action | Mouse and keyboard | Touch |
| --- | --- | --- |
| Look around | Drag the view | Drag the view |
| Pick a target | Click its bracket | Tap its bracket |
| Turn / climb | A D / R F (or arrows) | Drag the helm pad (bottom right), or set a course |
| Throttle | W / S | The speed slider next to the helm pad, or Ahead full / All stop |
| Set a course anywhere | Click the tactical map | Tap the tactical map |
| Send a scout somewhere | Map in Send recon mode, click a point | Map in Send recon mode, tap a point |
| Divert power | 5–8, or the power buttons | The power buttons under Energy |
| Pause | Esc or P | Pause button |

## Flying a scout

| Action | Mouse and keyboard | Touch |
| --- | --- | --- |
| Steer | Mouse (click the view to capture it) or arrows | Drag on the left half |
| Fire | Left click or Space | Hold Fire |
| Throttle / strafe / roll | W S / A D R F / Q E | Fixed cruise speed |
| Boost | Shift | Tap Boost |
| Back to the bridge | B | Back to bridge button |

## What makes it look real

- **Stars** follow a real brightness distribution, crowd toward the Milky Way and are colored by temperature.
- **The Milky Way** is a procedural band with a bright core and dark dust lanes.
- **Each sector's planet** is generated and baked into cube maps: continents, biomes, ice caps, clouds,
  ocean glint, city lights on the night side and an atmosphere that glows at the limb. Some sectors have
  a gas giant instead, with turbulent cloud bands, a great storm and a ring system: the rings throw their
  shadow across the clouds and the planet throws its shadow across the rings.
- **The sun** is a half-degree disc with glare; looking toward it dims the faint sky, and when nothing
  blocks it (the bridge roof, a ship, a rock, the planet) it throws a lens flare across the view.
- **A faint fill light** from the starfield keeps the night sides of the ships from going pure black.
- **Each sector's sky** has its own nebula, baked into the background with the Milky Way.
- **Lighting** is harsh and one-directional, as in space. The ships, the bridge and the scout cockpit are all
  lit by the same sun, so light moves across them as you turn, and the sun casts shadows: turrets, masts
  and rocks shade the decks (on desktop; phones skip shadows to save power).
- **The warships** have shader-drawn hull plating with decks of lit windows, working turrets, engine
  plumes, a turning radar dish, deck lights and navigation lights. Shields ripple where they're hit.
- **Explosions** are billowing fireballs that cool into smoke, with shock rings and burning hull shards.
  A destroyed capital ship breaks in two and the halves drift apart, burning along the break. Damaged
  ships burn on deck; on the bridge, hits make the screens and lights stutter.
- **The death ray** draws sparks into the emitter as it charges, then fires a beam of twisting plasma that
  sets its target boiling.
- **Small craft** leave glowing engine trails; **the bridge crew** sit at their consoles and turn to report.
- **Rendering** is HDR with bloom and a filmic tone curve.

## Project layout

```
index.html               page markup: 3D view, HUD panels, command bar, map, engineering, menus
styles.css               all styling; color tokens here are also used by the 3D scene, HUD and map
src/
  main.js                boots the game, wires crew voice and voice orders, runs the frame loop
  config.js              every gameplay number (speeds, damage, ranges, timings)
  game.js                sectors, orders, weapons, sensors, damage, piloting, warp, camera
  commands.js            the orders: button labels, hotkeys and voice phrases
  crew.js                crew replies: comms log and speech synthesis
  voice.js               voice orders through speech recognition
  engineering.js         the power-routing repair puzzle
  tactical.js            the tactical map
  bridge.js              the bridge interior around the captain
  bridgecrew.js          the officers at the bridge consoles
  cockpit.js             the scout cockpit and muzzle flashes
  hud.js                 brackets, lead pip, scanner and death-ray arc over the 3D view
  ui.js                  HUD panels, command bar, comms, banners and menus (DOM)
  input.js               mouse, keyboard and touch for the bridge and the scout
  upgrades.js            warship refits between sectors
  audio.js               synthesized sound effects (Web Audio, no audio files)
  engine/renderer.js     WebGL renderer, bloom and tone mapping
  world/                 sector layout, sky, sun, rocky planets, gas giants, asteroids, space dust, noise
  entities/              capital ships (model, flight, flagship AI), corvettes, torpedoes, scouts, fighters,
                         satellites, bolts, pickups
  fx/                    explosions, shields, engine trails, lens flare, shadows, warp tunnel, generated textures
vendor/three/            Three.js r170 (MIT licence) and the few add-ons the game uses
```

## Tweaking

Most balance changes are one-line edits in `src/config.js`. Refits are in `src/upgrades.js`, orders and
their voice phrases in `src/commands.js`. While the game runs, `window.game` is available in the console:

```js
game.energy = 100                       // top up energy for the death ray
game.warship.shield = 9999              // shrug off a fight
game.photo = { position: [0, 300, 5800], target: [0, 0, 5200] }   // free camera for screenshots
game.photo = null                       // back to the bridge
```

## Publish with GitHub Pages

In the repository's **Settings → Pages**, set the source to **Deploy from a branch**, pick `main` and `/ (root)`.
The game is then live at `https://<user>.github.io/<repo>/`, where voice orders work in Chrome, Edge and Safari.

## Ideas for what's next

- Land a scout on a planet and explore the surface
- More puzzles in engineering (coolant, shield harmonics) and on salvage runs
- Allied ships that join your fleet and take orders too
- A persistent campaign: salvage buys permanent upgrades between runs
