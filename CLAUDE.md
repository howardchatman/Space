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
- Capital ships (yours and the flagship) share `entities/capital.js` (flight, turrets, shields, damage) and
  `entities/shipmodel.js` (procedural model). Forward is -Z for capital ships, corvettes and the scout
  cockpit, +Z for small-craft models (`entities/drone.js`) and torpedoes. A capital ship model is two
  sections (bow and stern groups at the ship's origin) so it can break up when destroyed; add new parts as
  children of `object` before the end of `buildCapitalShip`, which sorts them into sections by z.
- `game.torpedoes` holds both sides' torpedoes: check `t.hostile` (corvettes' are hostile; yours aren't).
  The flagship's point defense rate scales with its working gun batteries.
- Ready-made 3D models (Quaternius ships, NASA spacecraft, Bennu) live in `assets/models` as `.gltf` +
  `.bin` + `.webp`, never GLB with embedded images: those decode through blob: URLs, which strict page
  policies (like the claude.ai artifact) can block. `src/models.js` loads them, swaps in matte materials and
  hands out sized copies; credit new ones in `assets/models/README.md`. Fighters and scouts are
  `shipTemplate()` in `drone.js`, corvette hulls are baked once in `corvetteHull()` in `shipmodel.js` (in
  meters, bow to -Z, so plating panels come out right), derelicts are `Satellite`s and Bennu is the
  landmark. Every use falls back to the procedural model if a file doesn't load; Start waits for loading.
- `game.field.landmark` is a giant asteroid nothing can break. Code that handles rocks usually needs it
  too: bolts, the death ray, torpedoes, fighters, the scout you fly, ships (pushed out; capital ships steer
  around anything in their `avoid` list), the map and `#sunClear`.
- Planets come in two kinds with the same interface (`group`, `radius`, `shineColor`, `update`, `dispose`):
  `world/planet.js` (rocky) and `world/gasgiant.js` (bands and rings). `sector.js` picks one per sector.
- The lens flare hides when the sun is blocked; on the bridge, `#sunClear` in `game.js` uses the room's
  dimensions from `bridge.js`, so update both together if the bridge changes shape.
- Hull materials come from `plating()` in `shipmodel.js`. Its options are uniforms, not shader text:
  three.js keys programs on the `onBeforeCompile` source, so per-material GLSL would be silently shared.
- Colors are CSS tokens on `:root` in `styles.css`; `readPalette()` in `src/main.js` hands them to the 3D
  scene, HUD and map. Add new UI colors as tokens. Physical colors (stars, planet, rock) live in shaders.
- The scene renders in HDR: anything brighter than about 0.9 blooms. Keep glows near the camera (bolts,
  muzzle flashes, cockpit lamps, console screens) dim, or they flood the screen. Keep hull materials matte:
  shiny decks mirror the sun.
- Never strobe the view: no per-frame random brightness, and nothing that flashes more than about three
  times a second (it's hard on the eyes and reads as screen flicker). Hit reactions on the bridge are one
  smooth dip and recovery; the red damage vignette eases in; the warship's own shield is faint from inside.
- Expensive procedural content (Milky Way, planet surface) is baked once into cube maps (the planet once
  per sector). Don't move per-pixel noise into per-frame shaders on large surfaces.
- Don't add or remove lights after startup, and don't put lights inside groups that get hidden: either
  changes the light count and forces every material to recompile. The interior light lives on the camera.
  The same goes for shadows: `renderer.shadowMap` is fixed at startup (off on phones). Mark new solid
  meshes with `useShadows()` from `fx/shadows.js`; the sun's shadow box follows the warship (or the scout
  you fly). The bridge interior neither casts nor receives, so it never shades its own view.
- Menus, HUD panels, command bar, map chrome and engineering are DOM (`src/ui.js`, `src/engineering.js`);
  brackets, lead pip, scanner and the death-ray arc are a 2D canvas (`src/hud.js`).
- Verify changes in a real browser. Headless Chromium works with
  `--enable-unsafe-swiftshader --use-angle=swiftshader` (slow, about 2 fps, so advance the game by calling
  `game.update(1 / 30)` in a loop rather than waiting). Exercise recon, the map, a flagship fight, the
  death ray, power orders, corvettes and torpedoes (theirs and yours), evasive maneuvers, damage control,
  the flagship's retreat, subsystem targeting, engineering, piloting a scout, the touch helm pad, warp,
  the after-action report and refit, a loss (the warship breaks up; a new run must mend it), the giant
  asteroid (ramming it, a course around it, firing at something behind it), loading with the model files
  blocked (procedural fallbacks), and phone-sized viewports with touch in both orientations.
  `game.photo = { position, target }` gives a free camera for screenshots.
