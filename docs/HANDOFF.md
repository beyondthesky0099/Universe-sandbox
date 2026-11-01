# Handoff: status and next steps

This file lets a new Claude session (or a person) pick up the work. Update it at the end of
every working session: tick boxes, add notes, and move finished items to "Done".

**How to continue in Claude:** open this repository in Claude Code (claude.ai/code or the CLI)
and say something like *"Read CLAUDE.md and docs/HANDOFF.md, then continue with the next
unchecked item."*

- Working branch: `ccr-bd8228d3-85c4pq` (no PR opened yet; `main` is the Pages deploy branch).
- Project conventions and commands are in `CLAUDE.md`.

## Done so far

- MVP: N-body sandbox, procedural galaxy, physics playground, Web Worker physics,
  Barnes–Hut, collisions, shattering, tides, supernovae, climate, and 17 scenarios.
- Round 2: undo/rewind, share links, sound, tutorial, mobile, GitHub Pages deploy.
- Round 3:
  - challenges, the daily puzzle and missions
  - JPL ephemerides, NASA exoplanets and nearby stars
  - lessons and live graphs
  - relativity, gravitational waves and stellar aging
  - lensing, bloom, WebGPU and VR
  - the scripting console and plugins
  - replays, video, embeds, the gallery, multiplayer, and the Claude scene builder
    (companion server)
- Docs: README, Dockerfile, and CI for the app and server.

## Current goal: use real astronomical data everywhere

The user asked for *"all real astronomical data"*.

**Status (2026-11-01):** A, B and C are mostly done and pushed. Real data now covers:
- the Solar System: planets, dwarf planets, asteroids, comets, 4,000 small bodies, and 28
  moons in true-scale moon systems
- the nearby stars and the night sky (HYG)
- exoplanets (NASA)
- the Milky Way's structure and its named clusters and nebulae

Still procedural:
- the 30,000 explorable stars on the galaxy map
- every other seeded galaxy
- the made-up scenarios (Giant Impact, Ring Maker, …), which are deliberately fictional

**Suggested next steps:** the rest of D2 (smaller NASA maps for Mars, Mercury and Saturn); exoplanet hosts in the galaxy search and filters; carving the Encke and Keeler gaps
(this needs published widths).

Plan, in priority order:

### A. The real Solar System (source: JPL Horizons API + JPL SBDB API; both reachable)
- [x] A1. `scripts/build-solar-system.mjs` → `public/data/solar-system.json`: osculating
      elements at a fixed epoch (2026-11-01) from Horizons (`EPHEM_TYPE=ELEMENTS`, ecliptic
      J2000):
      - planets, Pluto, and the dwarf planets Ceres, Eris, Haumea and Makemake
      - large asteroids (Vesta, Pallas, Hygiea) and famous comets (Halley, Encke,
        Hale–Bopp, 67P)
      - major moons, with elements relative to their planet (`CENTER=500@<planet>`)
      - real GM, mean radius, rotation period and axial tilt
- [x] A2. `src/sim/solarSystemData.ts`: load the JSON and propagate elements from the epoch
      to any date with two-body Kepler. Planets keep the Standish tables, which are valid for
      3000 BC – 3000 AD.
- [x] A3. Presets: "Solar System (real)" with real dwarf planets, asteroids and comets
      instead of the illustrative belt. Add per-planet moon systems (Earth–Moon, Mars, Jupiter,
      Saturn, Uranus, Neptune, Pluto–Charon). The moons aren't added to the whole-system
      preset because their short periods would force tiny timesteps.
- [x] A4. Tests: compare positions with Horizons vectors at a second date (to within about
      0.01 AU for heliocentric bodies, and a few percent of the orbit for moons).
- [x] A5. "Real sizes" toggle (`src/sim/trueScale.ts`, `Simulation.trueScale` and
      `bodyRadius`, `physicalRadius` in `body.ts`). It's saved in state, undoable and shared in
      multiplayer. Real sizes also set softening to 1e-8.
- [x] A6. Saturn's rings: the ring mesh follows Saturn's IAU pole, and real ring particles
      come from `scripts/build-saturn-rings.mjs` (the NASA ring fact sheet), added by
      `addSaturnRings` in `presets.ts`. There are 6,000 in the Saturn scene and 3,000 in the
      true-scale Solar System. The Encke and Keeler gaps are in the data but not carved out,
      because the sheet gives no widths.
- [x] A7. "Solar System (true scale)" preset with the 12 largest moons (Phobos, Deimos and the
      small moons are left out to keep the timestep reasonable). It runs at about 26% of a core
      at its default 0.73 days/s.

### B. Real stars (source: HYG database v4.1, CC BY-SA 4.0)
- URL: `https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv`
  (the repo moved to codeberg.org/astronexus/hyg, but the raw GitHub file still works).
- [x] B1. `scripts/build-stars.mjs` → `public/data/stars-near.json` (all stars within 20 pc, with
      name, xyz, spectral type, magnitude and colour index) and `public/data/stars-bright.json`
      (stars of naked-eye magnitude, mag < 6.5).
- [x] B2. "Nearby stars" uses every real star, not just planet hosts. Mark planet hosts and
      give masses and colours from spectral type and B–V.
- [x] B3. The Solar System view's background sky uses the real bright stars, in the correct
      ecliptic orientation, so real constellations appear. This replaces the procedural
      `starfield.ts` there.
- [x] B4. README credit: "HYG database by David Nash (astronexus), CC BY-SA 4.0". The derived
      JSON files must keep that licence.

### C. The real Milky Way on the galaxy map
- [x] C1. A "Milky Way" galaxy option using real structure: the Sun at about 8.2 kpc from the
      centre and about 20 pc above the plane, a 4-arm model plus the Local (Orion) Spur, a
      bar, and Sgr A* at 4.3 × 10⁶ M☉. Procedural stars fill the rest and are labelled as
      procedural.
- [x] C2. Real named objects at their real positions: 12 clusters and 10 nebulae (Pleiades,
      Omega Centauri, Orion Nebula, Crab, Carina, …). The l/b/d values were entered by hand
      and are approximate. Next: verify them, or extend to the full Messier list, from a
      reachable source (VizieR was blocked by the proxy on 2026-11-01).
- [x] C3. NASA exoplanet hosts on the Milky Way map (`showExoHostsOnMap` in `app.ts`,
      `setExoHosts` in `galaxyView.ts`, `equatorialToGalactic` in `galaxy.ts`). Galaxy targets
      can now be `{ exo: index }`. Not yet in the galaxy search box or filters.

### D. Real looks
- [x] D1. (spin axes from IAU poles in `scripts/build-solar-system.mjs`, applied in
      `bodyVisual.ts`; retrograde spin for Venus, Uranus and Pluto. Visual spin *rate* is still
      cosmetic, because real rates strobe at yr/s speeds.) Real planet colours, axial tilts and rotation periods from A1's data in
      `bodyVisual.ts`.
- [~] D2. Real maps for Earth (with clouds), the Moon and Jupiter, from NASA public-domain
      sources (`scripts/build-planet-textures.mjs`, `REAL_MAPS` in `bodyVisual.ts`). Still
      procedural: Mercury, Venus, Mars, Saturn, Uranus and Neptune. NASA/USGS global mosaics
      exist but are huge (Mercury is 800 MB, Mars several GB); find smaller official
      versions. Solar System Scope (CC BY 4.0) serves an HTML page to scripted downloads, so
      it isn't automated. Don't work around that.

## Notes and lessons learned
- Close-ups at real size: the camera's near plane is 1e-8 AU, and `controls.minDistance`
  follows the followed body's radius. The old 0.002 AU minimum stopped you zooming in to any
  real-sized planet. Background stars are depth-tested, otherwise they draw over close
  planets.
- Moon-system scenes include the real Sun (the planet's heliocentric state, reversed) for
  light, temperature and solar perturbation, and focus the planet with `follow(id, distance)`.
- Labels: in scenes with 31–300 bodies, the 30 most massive are labelled
  (`shouldLabel` in `systemView.ts`). Before this, only stars were labelled.
- IAU poles are hand-entered in `POLES` in `scripts/build-solar-system.mjs`. The test in
  `tests/solarsystem.test.ts` checks each planet's pole against Horizons' obliquity (±0.5°);
  that test caught a wrong Mars value. For retrograde rotators the IAU "north" pole is the
  one on the north side of the invariable plane, so the spin vector is the opposite of it.
- `Simulation.parentOf` falls back only to *heavier* bodies, so the heaviest body orbits
  nothing. Before this, Saturn showed "Orbiting Titan".
- Milky Way: `MILKY_WAY_SEED = 1` in `src/procgen/galaxy.ts` switches `samplePosition` to
  `sampleMilkyWay`. Map scale is 100 units = 15 kpc. Use `galacticToMap(l, b, dKpc)` to place
  real objects. Labels come from `labelGroup` in `galaxyView.ts`.
- Stars: `src/sim/stars.ts` (`loadStarNeighbourhood`, `starPhysics`, `skyPoints`) and
  `createRealSky` in `src/render/starfield.ts`. The near file covers 20 pc and the scene shows
  10 pc (319 stars). Showing 15 pc would mean about 940 bodies, which is heavy with labels.
- `hostPosition` (exoplanets) now converts equatorial → ecliptic, matching HYG and the Solar
  System. `tests/stars.test.ts` checks that both catalogues agree on Proxima's position.
- Real data enters through `src/sim/solarSystemData.ts`. `main.ts` preloads it with a 5 s
  timeout before the app starts, so presets can stay synchronous via `getSolarData()`. Without
  data, they fall back to built-in values.
- Moon presets set `sim.softening = 1e-8` (1.5 km). The default 1e-4 AU (15,000 km) is larger
  than Phobos's orbit and breaks it.
- Moons use *fitted mean elements*: about 200 orbits of Horizons samples, fitted to a
  constant a/e/i plus linear node, periapsis and mean-longitude rates. A single osculating
  snapshot drifted 50–65% of the orbit within months for the Moon and Io. Now the error is
  about 2% for the Moon and under 0.1% for the others (`tests/solarsystem.test.ts`).
- `scripts/build-solar-system.mjs` caches Horizons responses in `node_modules/.cache/horizons`
  because Horizons sometimes returns HTTP 503. Just rerun it.
- Run the moons in planet-centred presets. A global adaptive timestep with Phobos (7.6 h
  period) makes the full Solar System crawl.
- Horizons API: `https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND='599'&...`.
  Parse the `result` text between `$$SOE` and `$$EOE`.
- The SBDB API is at `https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=Ceres&phys-par=1`.
- Anything that isn't real data must say so in the UI tip text. Never present procedural
  values as real.
