# Deep Field

Browser arcade space shooter. Vanilla JavaScript ES modules + Canvas 2D, no build step, no dependencies.

- Run: `npm start` (or any static server from the repo root). Opening index.html via file:// does not work.
- Gameplay numbers live in `src/config.js`; refits in `src/upgrades.js`. Prefer tuning there over hard-coding values.
- Colors are CSS tokens on `:root` in `styles.css`; the canvas reads them via `readPalette()` in `src/main.js`.
  Add new colors as tokens, not literals in drawing code.
- World units are "field units", not pixels. `Game.resize()` maps them to the screen so every display gets a
  similar play area. Don't use `canvas.width` for gameplay math; use `game.width` / `game.height`.
- Menus and HUD are DOM (`src/ui.js`); everything moving is drawn on the canvas.
- Verify changes in a real browser (Playwright/Chromium is fine): play through a sector clear, a refit and a death.
