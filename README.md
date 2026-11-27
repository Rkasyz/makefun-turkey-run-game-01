# Biscuit's Great Escape — a Thanksgiving turkey breakout

[![make.fun](https://make.fun/badge/turkey-run-game-01.svg)](https://make.fun/bounty/turkey-run-game-01)
[![rank](https://make.fun/badge/turkey-run-game-01/Rkasyz/makefun-turkey-run-game-01/rank.svg)](https://make.fun/bounty/turkey-run-game-01)
[![reward](https://make.fun/badge/turkey-run-game-01/Rkasyz/makefun-turkey-run-game-01/reward.svg)](https://make.fun/bounty/turkey-run-game-01)

[make.fun bounty: Make the best turkey escape game](https://make.fun/bounty/turkey-run-game-01)

An original side-scrolling runner for make.fun's `turkey-run-game-01`
($250, top 20 share). Biscuit the turkey flees Old Bram's farm before
Thanksgiving dinner: flap-jump the ovens, hay bales, fences and rolling
pumpkins, duck the swinging carving knives, grab corn and cranberries,
and reach the Freedom Gate at 1500 m. Three lives — stumble and the
farmer closes in; lose them all and you're dinner.

- **Play:** desktop Chrome, keyboard + mouse. `SPACE` / click — flap-jump
  (double flap in the air), `↓` — duck under knives, `P` — pause,
  `M` — sound, `R` — run again.
- **Tech:** plain Canvas 2D + WebAudio synth, no libraries, no network,
  no external assets. All art is drawn with canvas paths; all sounds are
  synthesized. `game/index.html` + `game/src/main.js` (game) +
  `game/src/shots.js` (screenshot staging: `?shot=start|play|chase|end`).
- **Screenshots:** 4 real renders of the game's own code, staged by
  playing the real rules forward with a fixed seed (see `shots.json`).
- **Build:** `node main.ts` (Node 22) copies `game/` + `screenshots/` to
  `/output` and writes `dossier.json` via `vendor/makefun-game.ts`.
  Serve locally with `node serve.ts` → http://localhost:8080.

MIT licensed. An original game — no turkeys were harmed.
