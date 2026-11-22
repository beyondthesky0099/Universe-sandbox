# Astrarium developer guide

How the code is organised, how to run and test it, and how to add things. For using the app, see
[GUIDE.md](GUIDE.md); for the feature list and data credits, the [README](../README.md); for the
current status and the backlog, [HANDOFF.md](HANDOFF.md).

**Contents**
1. [Overview](#1-overview)
2. [Setting up](#2-setting-up)
3. [Repository layout](#3-repository-layout)
4. [Architecture](#4-architecture)
5. [Conventions](#5-conventions)
6. [Real data and the build scripts](#6-real-data-and-the-build-scripts)
7. [Testing](#7-testing)
8. [Recipes: adding things](#8-recipes-adding-things)
9. [The companion server](#9-the-companion-server)
10. [The desktop app](#10-the-desktop-app)
11. [CI, deployment and releases](#11-ci-deployment-and-releases)
12. [Gotchas](#12-gotchas)

---

## 1. Overview

- **Stack:** TypeScript, Three.js and Vite for the app; an optional Node server (no build step)
  for the gallery, multiplayer and the Claude scene builder; Electron for the Windows app.
- **Shape:** a single-page app with four views (Universe, Galaxy Map, Sandbox, Sky). The physics
  is headless and runs in a Web Worker; rendering and UI run on the main thread.
- **Data:** real catalogues are pre-processed by scripts into `public/data/` (about 20 MB) and
  loaded with `fetch` at runtime. The app needs no backend.
- **Size:** about 60 test files and ~400 tests; the physics core has no DOM or Three.js imports,
  so it is tested directly in Node.

---

## 2. Setting up

Requirements: Node 22.18 or newer (the server runs `.ts` files directly), npm, and a browser with
WebGL 2.

```
npm install
npm run dev            # http://localhost:5173, with hot reload
npx tsc --noEmit       # typecheck the app and tests
npx vitest run         # the app's tests (about 15 s)
npm run build          # typecheck + production build into dist/
npm run preview        # serve dist/ on http://localhost:4173

cd server && npm install && npm run typecheck && npm test    # the server
```

Before every commit, run the typecheck, the app tests, the build and the server tests. CI runs
the same.

Useful address options in development: `#tour=0` (skip the tutorial), `#preset=<id>` (start in a
scenario), `#worker=0` (physics on the main thread, easier to debug), `#threads=0` (no helper
workers).

---

## 3. Repository layout

```
index.html            all UI markup; panels are <section data-pane data-icon data-title> blocks
src/
  main.ts             entry point
  app.ts              the orchestrator (App): simulation, views, frame loop, scenarios, history,
                      selection, shared state
  app/                one controller class per feature area (see 4.4)
  sim/                headless physics and astronomy: no DOM, no Three.js
  procgen/            seeded generators: RNG, names, star systems, the procedural galaxy
  render/             Three.js views and visuals
  gpu/                the WebGPU N-body "mega-sim"
  game/               challenges, lessons, the Hohmann planner, scene specs
  net/                companion-server and multiplayer clients
  ui/                 DOM helpers, graphs, replays, history, sharing, console, tutorial, search
  audio.ts            WebAudio drone and effects
  style.css           all styles
public/
  data/               bundled real datasets (built by scripts/)
  textures/           NASA/USGS surface maps, the CMB
scripts/              reproducible data builders (one per dataset) and scripts/lib/ helpers
tests/                vitest suites; tests/fixtures/ holds reference values (JPL Horizons etc.)
server/               the companion server (its own package.json and tests)
desktop/              the Electron shell, its build and icon scripts
docs/                 GUIDE.md, DEVELOPER.md, HANDOFF.md, screenshots
.github/workflows/    ci.yml, deploy.yml (GitHub Pages), desktop.yml (Windows builds)
```

---

## 4. Architecture

### 4.1 The physics core (`src/sim/`)
- **`simulation.ts`** holds the bodies and test particles and advances them: a kick-drift-kick
  leapfrog with an adaptive step; direct summation below 160 bodies, a Barnes–Hut octree above;
  collisions (merge or shatter), tidal disruption at the Roche limit, 1PN relativity,
  Lense–Thirring precession, gravitational-wave inspiral (Peters), stellar evolution and
  supernovae.
- **Units are AU, solar masses and years**, so `G = 4π²` (`units.ts`).
- **Bodies** (`body.ts`) have a kind (`rocky`, `gas`, `star`, `giant`, `whitedwarf`, `neutron`,
  `blackhole`), mass, position, velocity, radius, age, spin, colour and an optional `tag` string
  that renderers read (for example `accreting`, `magnetic`, `dormant`, `cepheid:<days>`).
- **Test particles** (`particles.ts`) are massless: belts, rings, debris, gas.
- **Scenes** are built by functions in `presets.ts` that fill a `Simulation` and return a
  `SceneSetup` (camera distance and direction, time scale, tip text).
- **Astronomy modules** sit beside the physics: `ephemeris.ts` (JPL planetary elements),
  `exoplanets.ts`, `galaxies.ts`, `cosmology.ts` (ΛCDM distances), `kerr.ts` (spinning black
  holes), `neutronStar.ts`, `agn.ts` and `maserDisc.ts` (active nuclei), `massTransfer.ts` and
  `binaryCycles.ts` (close binaries), `stellarFate.ts` and `supernovaPhysics.ts`, `sky.ts` and
  `eclipse.ts` (the planetarium), and more. Each starts with a comment giving its physics and
  sources.

### 4.2 The worker boundary
- The simulation runs in a Web Worker (`worker.ts`), driven from the main thread through
  `host.ts`. Messages are defined in `protocol.ts`.
- Body state crosses the boundary as typed arrays, `BODY_STRIDE` numbers per body. **A new
  per-body field must be added to `protocol.ts`, `state.ts` (snapshots) and the tests.**
- Registries keyed by body name (`rememberAgn`, `rememberTransfer`, `rememberPulsar`) carry
  extra scene information from the preset to the renderer on the main thread without widening
  the protocol.
- `state.ts` snapshots serve undo, share links, saves, replays and multiplayer.

### 4.3 Multi-core forces
When the page is cross-origin isolated (COOP + COEP `credentialless`, sent by the dev and preview
servers and the desktop app), `parallel.ts` splits the particle forces (`particleKernel.ts`) and
the Barnes–Hut walk (`treeKernel.ts`, a packed octree) across helper workers
(`forceWorker.ts`) through SharedArrayBuffer and Atomics. Results are identical to the
single-threaded path (tested). GitHub Pages can't send the headers, so the website stays
single-threaded.

### 4.4 The app and its controllers
- **`App`** (`src/app.ts`, about 1,200 lines) owns the simulation, the four views, the frame
  loop, the current scenario, history and selection.
- **Feature controllers** live in `src/app/`, one class per area: `places.ts`, `photo.ts`,
  `landing.ts`, `vr.ts`, `sky.ts`, `travel.ts`, `ship.ts`, `search.ts`, `bodyPanel.ts`,
  `galaxyMap.ts`, `cosmos.ts`, `learning.ts`, `graph.ts`, `input.ts` (all DOM wiring) and others.
  Each is built with the App, reaches shared state through `this.app`, and is reached as
  `this.<area>UI` (for example `this.placesUI.openPlaces()`).
- **A new feature gets its own controller** rather than more methods on App. Shared types,
  constants and helpers go in `src/app/shared.ts`.
- **Layout:** `src/app/layout.ts` builds the frame (icon rail, panes, dock, ⋯ menu). Any
  `<section data-pane data-icon data-title>` in a side panel becomes a rail pane automatically.
  Controllers bind to elements by ID, so keep IDs stable.

### 4.5 Rendering (`src/render/`)
- **Views:** `systemView.ts` (the Sandbox), `galaxyView.ts` (the Galaxy Map), `cosmosView.ts`
  (the Universe), `skyView.ts` (the Sky).
- **Per-body visuals:** `bodyVisual.ts` builds a body's mesh, glow, disc, rings, atmosphere,
  aurora and special visuals (`agn.ts`, `neutronStar.ts`, `massTransfer.ts`), and updates them
  each frame.
- **Post-processing:** `postfx.ts` does bloom and black-hole lensing, including a ray-traced
  accretion disc (`src/sim/geodesic.ts` gives the null geodesics).
- **Large scales:** a logarithmic depth buffer handles real-sized planets beside AU-scale orbits.
- **Galaxy-scale volumes:** `nebulaRaymarch.ts` ray-marches nebulae up close.
- **WebGPU** is only used by the mega-sim (`src/gpu/`); everything else is WebGL 2.

---

## 5. Conventions

- **Units:** AU, M☉, years. Use the helpers in `units.ts` (`EARTH_MASS`, `AU_PER_YEAR_IN_KMS`,
  `KMS`).
- **Radii:** by default bodies have inflated *game radii* (`radiusFor`); **Real sizes** switches
  to `physicalRadius` (`trueScale.ts`). Tides use `NOMINAL_DENSITY`, not the drawn radius.
- **Real data:** every bundled dataset has a reproducible build script in `scripts/` and a credit
  in the README's *Data credits*.
- **Honesty about models:** when a value isn't measured, use a typical one and say so in the
  panel or the scene tip ("Not measured, so typical values are shown for…"). Mark illustrative
  visuals as illustrative.
- **Physics changes need a test** in `tests/`. Real data is checked against JPL Horizons or the
  source paper where possible; challenges have solvability tests.
- **Server code** runs through Node's type stripping, so it may not use TypeScript parameter
  properties or enums (`erasableSyntaxOnly`).
- **Writing:** UI text and docs use plain British English, short sentences, and say where
  numbers come from.
- **Originality:** don't recreate any specific existing commercial game; Astrarium is its own
  thing.

---

## 6. Real data and the build scripts

Each script fetches from the original source, processes it, and writes into `public/data/` (or
`public/textures/`, or `tests/fixtures/`). Downloads are cached under `node_modules/.cache/`, so
re-runs are fast. Run one with `node scripts/<name>.mjs`.

| Script | Builds | From |
| --- | --- | --- |
| `build-solar-system.mjs` | planets, dwarf planets, moons, comets | JPL Horizons |
| `build-small-bodies.mjs` | 4,000 asteroids, Trojans, Kuiper belt objects | JPL Small-Body Database |
| `build-spacecraft.mjs` | 16 missions' trajectories | JPL Horizons |
| `build-voyager.mjs` | the Voyager planetary encounters | JPL Horizons |
| `build-flybys.mjs` | upcoming asteroid close approaches | JPL CAD API + Horizons |
| `build-halley.mjs` | Halley's 2061 return | JPL Horizons |
| `build-eclipses.mjs` | solar eclipses 2024–2035 | NASA Five Millennium Canon + Horizons |
| `build-saturn-rings.mjs` | ring radii and optical depths | NASA ring fact sheet |
| `build-planet-textures.mjs` | surface maps | NASA, USGS |
| `build-stars.mjs` | nearby and naked-eye stars | HYG v4.1 |
| `build-stars-100pc.mjs` | 44,500 stars within 100 pc | Gaia DR3 |
| `build-gaia-bright.mjs` | 62,000 bright stars (binary file) | Gaia DR3 |
| `build-exoplanets.mjs` | 4,800+ planetary systems | NASA Exoplanet Archive |
| `build-clusters.mjs` | open and globular clusters | Hunt & Reffert 2023, Harris (VizieR) |
| `build-nebulae.mjs` | 5,676 nebulae, with distances | several catalogues (VizieR) |
| `build-nebula-images.mjs` | nebula photographs | DSS2 via NASA SkyView |
| `build-pulsars.mjs` | 3,632 pulsars | ATNF Pulsar Catalogue |
| `build-compact-objects.mjs` | famous black holes and pulsars | SIMBAD + discovery papers |
| `build-galactic-objects.mjs` | X-ray binaries, Wolf–Rayet stars, novae, CVs, Cepheids, masers | Fortin et al., van der Hucht, Schaefer, Canbay et al., Skowron et al., Reid et al. (VizieR) |
| `build-gw-events.mjs` | gravitational-wave events | LIGO/Virgo/KAGRA papers |
| `build-galaxies.mjs` | nearby and 2MRS galaxies | UNGC, 2MRS, HyperLEDA (VizieR) |
| `build-deep-universe.mjs` | galaxy clusters, AGN, black-hole masses | Abell, Véron-Cetty & Véron |
| `build-radio-lobes.mjs` | radio-galaxy lobe pictures | 3CRR + NVSS/SUMSS/GLEAM/WENSS via SkyView |
| `build-cmb.py` | the microwave background map | WMAP 9-year |
| `build-sky-reference.mjs` | reference positions for the sky tests | JPL Horizons |

VizieR is reached through the Harvard mirror (`scripts/lib/vizier.mjs`), which retries the
mirror's occasional empty or error responses. Commit both the script and its output.

---

## 7. Testing

- **App tests** (`tests/*.test.ts`, vitest): physics (orbits, collisions, relativity, tides,
  supernovae), real data against JPL Horizons and papers, challenges' solvability, lessons, the
  worker protocol, search, places, travel, and each astronomy module. Run one file with
  `npx vitest run tests/<name>.test.ts`.
- **Server tests** (`server/`, `node --test`): the API, gallery, multiplayer rooms, and the scene
  builder against a fake Claude client.
- **In the browser:** Playwright with Chromium, headless (SwiftShader). It's slow, so use
  `#tour=0`, low quality and post-processing off. The app exposes `window.astrarium` (the App)
  for scripted checks. WebGPU can't present frames headlessly, so the mega-sim isn't covered.
- **Not tested automatically:** live Claude API calls, WebGPU on a real GPU, VR headsets, sound
  output and video recording.

---

## 8. Recipes: adding things

**A new scenario.** Write a `Preset` in `src/sim/presets.ts` (an `id`, `name`, `description` and
`load(sim)` that returns a `SceneSetup`) and add it to `PRESETS`. It appears in the Scenes pane,
in search, and as `#preset=<id>`. Add a test that loads it and checks what matters.

**A new real dataset.**
1. Write `scripts/build-<name>.mjs` that fetches from the source and writes `public/data/<name>.json`.
2. Add a loader in `src/sim/` (`fetch` the JSON, with types), and tests that check the data.
3. Show it from a controller in `src/app/` and a renderer in `src/render/`.
4. Credit the source in the README.

**A new feature with UI.** Add the markup in `index.html` (a `data-pane` section becomes a rail
pane), styles in `src/style.css`, and a controller class in `src/app/` built by the App. Wire DOM
events in `input.ts` or the controller. Keep the physics part in `src/sim/` with its tests.

**A new per-body property.** Add it to `Body` (`body.ts`), the typed-array layout in
`protocol.ts`, snapshots in `state.ts`, and the protocol and state tests. If only the renderer
needs it, prefer a `tag` or a name-keyed registry instead.

**A new kind of special visual for a body.** Register parameters by body name from the preset
(see `rememberTransfer` in `massTransfer.ts`), then build the visual in `bodyVisual.ts`'s
`build()` when the registry has an entry, and update it in `update()`.

**A new live-graph metric.** Add it to `METRICS` in `src/ui/graph.ts` and measure it in
`measure()` (or, for renderer-side values, in `src/app/graph.ts`).

---

## 9. The companion server

`server/` provides:
- `GET /api/health`: which features are on;
- `POST /api/describe`: the plain-English scene builder (Claude through the Anthropic SDK, with
  structured output validated against a schema and sanitised again in the browser);
- `GET/POST /api/scenes` and `POST /api/scenes/:id/vote`: the community gallery (a JSON file);
- `/ws`: multiplayer rooms (the host simulates and broadcasts; guests send edits);
- optionally the built web app (`STATIC_DIR`).

Settings: `PORT` (8787), `DATA_DIR`, `ALLOWED_ORIGINS`, `STATIC_DIR`, `ANTHROPIC_API_KEY`,
`DESCRIBE_PER_HOUR`.

Notes for the scene builder: the model it uses doesn't accept a forced `tool_choice`, so it
relies on structured outputs; keep `fallbacks: 'default'` and its beta header. Every request is a
paid API call, so on a public deployment set `ALLOWED_ORIGINS`, keep `DESCRIBE_PER_HOUR` low, and
set a spending limit.

Docker: `docker build -t astrarium .` then
`docker run -p 8787:8787 -v astrarium-data:/data -e ANTHROPIC_API_KEY=… astrarium` serves the app
and the API together.

---

## 10. The desktop app

- `desktop/main.cjs` is the Electron shell. It serves the built app (copied into `desktop/web/`)
  from an `app://` origin with the COOP/COEP headers, asks for the high-performance GPU, ignores
  the GPU blocklist and turns off background throttling.
- It runs the companion server in-process: `desktop/build-server.mjs` bundles
  `server/src/embedded.ts` into `desktop/server.cjs` (needs `server/node_modules`). The server
  listens on 127.0.0.1 on a free port and is passed to the page as `#localserver=`; a server
  chosen in the settings wins.
- The web app detects the desktop shell (`DESKTOP` in `app.ts`) and starts at Ultra quality.
- The icon comes from `desktop/icon.svg` (`node desktop/make-icon.mjs`).
- `npm run desktop` builds and opens it; `npm run desktop:win` builds the Windows installer and
  portable `.exe` into `desktop/release/`.

---

## 11. CI, deployment and releases

- **`ci.yml`:** on every push and pull request, typecheck, test and build the app and the server.
- **`deploy.yml`:** on pushes to `main`, build and publish to GitHub Pages. The optional
  repository variable `ASTRARIUM_SERVER_URL` points the site at a companion server.
- **`website.yml`:** after every push to `main`, tests and builds the app and copies `dist/`
  into the website repository (`prime-27/bhanu-Prakash-`) at `astrarium/app/`, pushing the
  commit to its `main` and `website` branches together, so
  stargazinghyderabad.com/astrarium/app/ stays current. It needs a repository secret
  `WEBSITE_TOKEN` (a fine-grained token with Contents: Read and write on that repository only);
  without it the job skips the publish step.
- **`desktop.yml`:** builds the Windows `.exe` files on `windows-latest`. Pushing a tag such as
  `v0.4.0` (or running the workflow by hand) attaches the installer and portable builds, x64 and
  arm64, to a GitHub release.

---

## 12. Gotchas

- **Killing the preview server:** `pkill -f vite` in the same shell command as other work can kill
  that shell itself. Kill the specific process instead.
- **Headless browsers** are slow with SwiftShader: low quality, `#tour=0`, post-processing off.
- **Custom shaders** must include the logarithmic-depth chunks (`logdepthbuf_pars_vertex`,
  `logdepthbuf_vertex`, and the fragment pair), or they fail the depth test against real-sized
  planets.
- **Simulation time** resets to 0 when a scene loads, so scene timelines (outbursts, eruptions)
  can start relative to the load.
- **Name-keyed registries** (AGN, mass transfer) persist across scenes; give bodies distinctive
  names in scenes that register parameters.
- **Large data:** keep `public/data/` lean. Big catalogues use compact arrays or binary files
  (`gaia-bright.bin`), and some load only when needed.
