# Deep Field

First-person space combat game in the browser. Three.js r170 (vendored in `vendor/three/`, loaded through
the import map in `index.html`), plain ES modules, no build step, no npm dependencies.

- Run: `npm start` (or any static server from the repo root). Opening index.html via file:// does not work.
- Gameplay numbers live in `src/config.js`; refits in `src/upgrades.js`. Prefer tuning there over hard-coding values.
- Units are meters and seconds. The player flies inside `CONFIG.field.boundary` around the origin; the planet
  and sun are scenery far outside it (the sun and stars are re-centered on the camera every frame).
- Colors are CSS tokens on `:root` in `styles.css`; `readPalette()` in `src/main.js` hands them to the 3D
  scene and HUD. Add new UI colors as tokens. Physical colors (stars, planet, rock) live in their shaders.
- The scene renders in HDR: anything brighter than about 0.9 blooms. Keep glows near the camera (bolts,
  muzzle flashes, cockpit lamps) dim, or they flood the screen.
- Expensive procedural content (Milky Way, planet surface) is baked once into cube maps at startup. Don't
  move per-pixel noise into per-frame shaders on large surfaces.
- Don't add or remove lights after startup: it forces every material to recompile. Effects reuse two pooled
  point lights.
- Menus and HUD readouts are DOM (`src/ui.js`); brackets, lead pip and scanner are a 2D canvas (`src/hud.js`).
- Verify changes in a real browser. Headless Chromium works with
  `--enable-unsafe-swiftshader --use-angle=swiftshader` (slow, about 2 fps, but fine for screenshots).
  Play through a sector clear, a refit and a death, and check a phone-sized viewport with touch.
