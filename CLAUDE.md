# Deep Field

First-person space game in the browser: the player commands a capital warship from its bridge (orders by
button, hotkey or voice), sends recon, can fly a scout, repairs systems via a puzzle, and warps between
sectors. Three.js r170 (vendored in `vendor/three/`, loaded through the import map in `index.html`), plain
ES modules, no build step, no npm dependencies.

- Run: `npm start` (or any static server from the repo root). Opening index.html via file:// does not work.
- Gameplay numbers live in `src/config.js`; refits in `src/upgrades.js`; orders and voice phrases in
  `src/commands.js`. Prefer tuning there over hard-coding values.
- `src/game.js` owns the state machine (title, playing, paused, warp, upgrade, gameover) and the two seats
  (`mode` 'bridge' or 'pilot'). New orders: add to `COMMANDS`, then handle the id in `Game.command()`.
- Units are meters and seconds. A sector is a ~7 km radius around the origin; the planet and sun are
  scenery far outside it (the sun and stars are re-centered on the camera every frame).
- Capital ships (yours and the flagship) share `entities/capital.js` (flight, turrets, damage) and
  `entities/shipmodel.js` (procedural model). Forward is -Z for capital ships and the scout cockpit,
  +Z for small-craft models (`entities/drone.js`).
- Colors are CSS tokens on `:root` in `styles.css`; `readPalette()` in `src/main.js` hands them to the 3D
  scene, HUD and map. Add new UI colors as tokens. Physical colors (stars, planet, rock) live in shaders.
- The scene renders in HDR: anything brighter than about 0.9 blooms. Keep glows near the camera (bolts,
  muzzle flashes, cockpit lamps, console screens) dim, or they flood the screen. Keep hull materials matte:
  shiny decks mirror the sun.
- Expensive procedural content (Milky Way, planet surface) is baked once into cube maps (the planet once
  per sector). Don't move per-pixel noise into per-frame shaders on large surfaces.
- Don't add or remove lights after startup, and don't put lights inside groups that get hidden: either
  changes the light count and forces every material to recompile. The interior light lives on the camera.
- Menus, HUD panels, command bar, map chrome and engineering are DOM (`src/ui.js`, `src/engineering.js`);
  brackets, lead pip, scanner and the death-ray arc are a 2D canvas (`src/hud.js`).
- Verify changes in a real browser. Headless Chromium works with
  `--enable-unsafe-swiftshader --use-angle=swiftshader` (slow, about 2 fps, so advance the game by calling
  `game.update(1 / 30)` in a loop rather than waiting). Exercise recon, the map, a flagship fight, the
  death ray, engineering, piloting a scout, warp and refit, a loss, and a phone-sized viewport with touch.
  `game.photo = { position, target }` gives a free camera for screenshots.
