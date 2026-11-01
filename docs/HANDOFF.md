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

The user asked for *"all real astronomical data"*. Today, real data covers planet positions
(JPL approximate elements) and exoplanet systems (NASA Exoplanet Archive). Everything else is
procedural or illustrative. Plan, in priority order:

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
- [ ] A3. Presets: "Solar System (real)" with real dwarf planets, asteroids and comets
      instead of the illustrative belt. Add per-planet moon systems (Earth–Moon, Mars, Jupiter,
      Saturn, Uranus, Neptune, Pluto–Charon). The moons aren't added to the whole-system
      preset because their short periods would force tiny timesteps.
- [x] A4. Tests: compare positions with Horizons vectors at a second date (to within about
      0.01 AU for heliocentric bodies, and a few percent of the orbit for moons).
- [ ] A5. Real radii in the body panel, and an optional "true scale" toggle that uses real radii
      instead of the inflated game radii.

### B. Real stars (source: HYG database v4.1, CC BY-SA 4.0)
- URL: `https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv`
  (the repo moved to codeberg.org/astronexus/hyg, but the raw GitHub file still works).
- [ ] B1. `scripts/build-stars.mjs` → `public/data/stars-near.json` (all stars within 25 pc, with
      name, xyz, spectral type, magnitude and colour index) and `public/data/stars-bright.json`
      (stars of naked-eye magnitude, mag < 6.5).
- [ ] B2. "Nearby stars" uses every real star, not just planet hosts. Mark planet hosts and
      give masses and colours from spectral type and B–V.
- [ ] B3. The Solar System view's background sky uses the real bright stars, in the correct
      ecliptic orientation, so real constellations appear. This replaces the procedural
      `starfield.ts` there.
- [ ] B4. README credit: "HYG database by David Nash (astronexus), CC BY-SA 4.0". The derived
      JSON files must keep that licence.

### C. The real Milky Way on the galaxy map
- [ ] C1. A "Milky Way" galaxy option using real structure: the Sun at about 8.2 kpc from the
      centre and about 20 pc above the plane, a 4-arm model plus the Local (Orion) Spur, a
      bar, and Sgr A* at 4.3 × 10⁶ M☉. Procedural stars fill the rest and are labelled as
      procedural.
- [ ] C2. Real named objects at their real positions: Messier objects and famous nebulae and
      clusters (Orion Nebula, Pleiades, Crab, …). This needs a data source with distances;
      check SIMBAD/VizieR reachability first (VizieR was blocked by the proxy on 2026-11-01).
- [ ] C3. NASA exoplanet hosts placed on the Milky Way map near the Sun.

### D. Real looks
- [ ] D1. Real planet colours, axial tilts and rotation periods from A1's data in
      `bodyVisual.ts`.
- [ ] D2. Optional real planet texture maps. They need a licence-compatible source (for
      example NASA public-domain maps), and must be fetched at build time, not hot-linked.

## Notes and lessons learned
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
