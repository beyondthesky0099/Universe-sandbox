# Astrarium: notes for Claude

Browser universe sandbox: TypeScript + Three.js + Vite, with an optional Node companion
server in `server/`. Read `docs/HANDOFF.md` first. It has the current status and the next tasks.

## Commands

```
npm install && npm run dev          # http://localhost:5173
npx tsc --noEmit                    # typecheck (app + tests)
npx vitest run                      # 85+ tests, about 5 s; must stay green
npm run build                       # tsc + vite build into dist/
cd server && npm install && npm run typecheck && npm test    # server (node --test)
node scripts/build-exoplanets.mjs   # rebuild public/data/exoplanets.json from NASA
cd desktop && npm install           # desktop app (Electron); then `npm run desktop` at the root
npm run desktop:win                 # Windows .exe (CI builds it on windows-latest: desktop.yml)
```

Before every commit, run the typecheck, the app tests, the build and the server tests.

## Architecture (where things live)

- `src/sim/`: headless physics with no DOM or Three.js imports. It runs in a Web Worker
  (`worker.ts`, `host.ts`, `protocol.ts`) and in tests.
  - `simulation.ts`: integrator, collisions, tides, relativity, stellar evolution.
  - `presets.ts`: scenarios. `ephemeris.ts`: JPL planet elements. `exoplanets.ts`: NASA catalogue.
  - `state.ts`: snapshots, used by undo, share links, multiplayer and saves.
- `src/procgen/`: seeded generators for the procedural galaxy and its star systems.
- `src/render/`: Three.js views. `systemView.ts` is the sandbox, `galaxyView.ts` the galaxy map,
  `bodyVisual.ts` the per-body meshes, and `postfx.ts` the lensing and bloom passes.
- `src/game/`: challenges, lessons, the Hohmann planner, and the scene-spec builder.
- `src/ui/`, `src/net/`: graphs, replays, the console, share links, and server/multiplayer clients.
- `src/app.ts`: the big orchestrator (about 2,800 lines) that wires DOM, input, views and sim.
  UI markup is in `index.html` and styles in `src/style.css`.
- Multi-core particle forces: `src/sim/particleKernel.ts` (the force loop), `parallel.ts` (splits it
  over helper workers via SharedArrayBuffer + Atomics), `forceWorker.ts`. Only when the page is
  cross-origin isolated (COOP + COEP `credentialless`, sent by the desktop app and the Vite
  dev/preview servers); `#threads=0` turns it off.
- `desktop/`: the Electron shell (`main.cjs`) that serves the built app (copied into
  `desktop/web/`) from an `app://` origin. It requests the high-performance GPU and turns off
  background throttling. The web app detects it (`DESKTOP` in `app.ts`) and starts at high
  quality. The icon comes from `icon.svg` (`node desktop/make-icon.mjs`).
- `server/`: Node 22.18+ runs `.ts` directly (type stripping), so use **no TS parameter
  properties or enums** (`erasableSyntaxOnly`). It provides the Claude scene builder
  (`scene.ts`, Anthropic SDK, structured output via `betaZodOutputFormat`), the gallery and
  the ws rooms.
- `public/data/`: bundled real datasets, loaded with `fetch` at runtime.

## Conventions and gotchas

- Units: **AU, solar masses, years**, so `G = 4π²`. Use the helpers in `units.ts` (`EARTH_MASS`,
  `AU_PER_YEAR_IN_KMS`, `KMS`).
- Body radii are *game radii* (inflated). Tides use `NOMINAL_DENSITY`, not the radius.
- Body state crosses the worker boundary as typed arrays (`BODY_STRIDE` in `protocol.ts`). A
  new per-body field must be added to the protocol, `state.ts` and the tests.
- Physics changes need a test in `tests/`. Challenges have solvability tests, and real data
  is checked against JPL Horizons values.
- Bundled data must have a reproducible build script in `scripts/` and a credit in the README.
- Don't recreate any specific existing commercial game. Astrarium is its own thing.
- Headless browser checks (Playwright, SwiftShader) are slow: use `#tour=0`, low quality and
  postfx off. WebGPU can't present frames headlessly.
- Avoid `pkill -f vite` in the same shell command as other work, because it can kill the
  shell itself (exit 144).
- Claude API: forced `tool_choice` isn't allowed on the model the server uses, so it relies
  on structured outputs. Keep `fallbacks: 'default'` and its beta header.
