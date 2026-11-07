# Handoff: status and next steps

This file lets a new Claude session (or a person) pick up the work. Update it at the end of
every working session: tick boxes, add notes, and move finished items to "Done".

**How to continue in Claude:** open this repository in Claude Code (claude.ai/code or the CLI)
and say something like *"Read CLAUDE.md and docs/HANDOFF.md, then continue with the next
unchecked item."*

- Working branch: `ccr-bd8228d3-85c4pq`, restarted from `main` after PR #1 merged. `main` is the
  default branch and deploys to Pages.
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

**Suggested next steps:** remaining D2 maps (Saturn and Io from NASA Photojournal; check each one by eye); exoplanet hosts in the galaxy search and filters; carving the Encke and Keeler gaps
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
- [~] D2. Real maps for 11 bodies (`scripts/build-planet-textures.mjs`, `REAL_MAPS` in
      `bodyVisual.ts`):
      - Earth with clouds, the Moon and Jupiter come from NASA.
      - Mercury (desaturated: the USGS "colour" mosaic is tinted), Mars, Phobos, Europa,
        Ganymede, Rhea, Iapetus and Vesta come from USGS Astrogeology browse JPEGs, found by
        filtering https://astrogeology.usgs.gov/search/results.
      Rejected after viewing: Callisto (missing-data stripe), Io (polar gores, not
      cylindrical), Enceladus and Triton (printed map sheets), the Venus radar maps (not what
      the eye sees) and Titan (near-infrared). Still procedural: Venus, Saturn, Uranus,
      Neptune, Io, Callisto, Titan and the smaller moons. Solar System Scope serves an HTML
      page to scripted downloads, so don't automate it.

### E. Beyond the Milky Way
- [x] E1. Universe map (`src/render/cosmosView.ts`, `src/sim/galaxies.ts`, the `cosmos` view in
      `app.ts`): 869 Local Volume galaxies (Karachentsev 2013) and 38k 2MRS galaxies, from
      `scripts/build-galaxies.mjs` via the Harvard VizieR mirror. The CDS main site was
      blocked by the proxy, and big responses sometimes drop, so the script retries and caches.
- [x] E2. Visiting a galaxy builds a procedural stand-in of its real form (`GalaxyOptions` in
      `procgen/galaxy.ts`). "You are here" is hidden in stand-ins.
- [ ] E3. The real Milky Way–Andromeda collision scenario (M31 is 0.77 Mpc away and
      approaching at about 110 km/s relative to the Milky Way). It needs a galaxy-scale preset.
- [ ] E4. Galaxies in the Virgo cluster and beyond (beyond the Local Volume) aren't clickable;
      only the 2MRS points exist for them.

### F. More real data (all done, pending merge in PR #2)
- [x] F1. Real spacecraft (JPL Horizons, 16 missions, `scripts/build-spacecraft.mjs`)
- [x] F2. Milky Way meets Andromeda (`src/sim/localGroup.ts`, kpc/Myr unit system)
- [x] F3. Real gravitational-wave events (`scripts/build-gw-events.mjs`, arXiv-verified)
- [x] F4. Moving stars (HYG velocities, `upcomingEncounters`)
- [x] F5. Clickable named galaxies beyond the Local Volume (2MRS)
- [x] F6. Real asteroid flybys (JPL CAD + Horizons, `scripts/build-flybys.mjs`)
- [x] F7. Black holes and pulsars on the Milky Way map (SIMBAD + arXiv)
- [x] F8. The CMB (WMAP 9-year ILC, `scripts/build-cmb.py`)

### G. Next round
- [x] G1. Voyager Grand Tour (`scripts/build-voyager.mjs`, `src/sim/voyager.ts`)
- [x] G2. Planetarium: Sky tab (`src/sim/sky.ts`, `src/render/skyView.ts`)
- [x] G3. Solar eclipses (`scripts/build-eclipses.mjs`, `src/sim/eclipse.ts`)
- [x] G4. Gaia DR3 distances and velocities for nearby stars (in `scripts/build-stars.mjs`)
- [x] G5. Gravitational-wave chirps as sound (`src/sim/gwChirp.ts`, button in the GW row)
- [x] G6. Halley's 2061 return (`scripts/build-halley.mjs`, `src/sim/halley.ts`) and comet tails (`bodyVisual.ts`)
- [x] G7. Phone pass: lighter defaults on low-power devices (`LOW_POWER` in `app.ts`), pinch zoom in the Sky tab

### J. Next round (clusters, reflection-nebula distances, 100 pc stars, multi-core physics)
- [x] J1. Star clusters: Hunt & Reffert 2023 (Gaia DR3) and Harris globulars (`scripts/build-clusters.mjs`,
  `src/sim/clusters.ts`), on the galaxy map and the Sky tab. Westerlund 1 isn't labelled: the Gaia
  census doesn't seem to contain it, and the only shared alias was on an unrelated cluster.
- [x] J4. Reflection-nebula distances from their illuminating stars (SIMBAD TAP parallaxes, 140 of 158)
- [x] J5. Stars within 100 pc from Gaia (`scripts/build-stars-100pc.mjs`, `src/sim/gaia100.ts`): 44,529
  stars as particles. Particles now have per-scene `particleCullDistance` and `absorbParticles`
  settings (saved with the scene), since the old fixed 5,000 AU cull deleted distant stars.
- [x] J6. Multi-core particle forces (`src/sim/particleKernel.ts`, `parallel.ts`, `forceWorker.ts`): the
  physics worker splits the particle–body loop with helper workers over SharedArrayBuffer +
  Atomics when the page is cross-origin isolated (desktop app; dev/preview servers; not GitHub
  Pages). Identical results (tests). Node benchmark of the same kernel: 2.4× on 3 threads of a
  4-core VM; the in-browser benchmark in this container showed no gain because SwiftShader
  software rendering saturates its 4 cores, so measure on a real machine. Next: the Barnes–Hut
  tree path (cluster/spiral presets) is still single-threaded.

### J. Real supernovae
- [x] `src/sim/supernovaPhysics.ts` (tests in `tests/supernova-physics.test.ts`): ejecta speeds,
  ⁵⁶Ni/⁵⁶Co light curves (Arnett; Type II-P plateau from Kasen & Woosley 2009), blast-wave radius
  (free expansion → Sedov–Taylor → snowplow), body destruction by energy vs binding energy,
  neutron-star kicks. Shockwaves carry `t0` and `explosion` (protocol SHOCK_STRIDE = 15, saved in
  state); `systemView` draws the light from the light curve with the photosphere's colour. The
  Supernova scenario is a 15 M☉ red supergiant at about two days per second.
- [x] Layered, clumpy ejecta (`ejectaLayers`): particles and a seeded puff cloud
  (`remnantClouds` in systemView, scaled to the ejecta edge each frame) coloured by element;
  ejecta are capped at the decelerating shock's speed (reverse shock).

### M. Supernovae by mass and metallicity
- [x] `src/sim/stellarFate.ts`: winds (Z^0.85), stripping mass 25 M☉·Z^−1.2, helium core
  0.1 M^1.32, fates ECSN / II-P / II-L / IIb / Ib / Ic / Ic-BL / PPISN / PISN / failed, progenitor
  T, R, L, explosion and remnant. `Body.metallicity` (Z/Z☉; protocol BODY_STRIDE 14, state,
  shock frames carry subtype, envelope, interaction: SHOCK_STRIDE 19). Light curves: plateau from
  the hydrogen envelope only; Arnett otherwise. Tests: tests/stellar-fate.test.ts. Body panel:
  metallicity slider and fate line. Preset `supernova-zoo`.

### L. 3D nebulae from photographs
- [x] `src/render/nebulaVolume.ts`: `gasBrightness` (sky subtraction, star clipping against a 9×9
  box blur), `volumeParticles` (sampling ∝ brightness, spheroidal depth around a noise-warped
  mid-surface, colour per unit brightness, `opacity` so the blobs add up to the picture),
  `NebulaVolume` (premultiplied additive points: colours above 1 would be clamped otherwise).
- [x] `GalaxyView.updateVolumes`: within 8 picture-widths the nearest photographed nebulae
  (`volumeBudget`: 2 desktop, 1 phone) fade from the photo billboard (`NebulaClouds.setFade`) to
  the cloud by 4 widths, except within ~10–30° of the view from Earth. Axes from
  `pictureAxes` (procgen/galaxy.ts), tested in tests/nebula-volume.test.ts.

### K. Click a label to go there
- [x] `labelHitDepth` (galaxyView.ts) hit-tests textSprite labels; `userData.goto` on a label
  makes it a destination (GalaxyView.pickLabel / flyToPoint, SkyView.pickLabel / goToLabel,
  SystemView.pickLabel for the CSS2D body labels).
- [x] Clusters as Plummer-sphere star swarms at their catalogue radii
  (`src/procgen/clusterStars.ts`): all 145 globulars with distances, open clusters with ≥ 300
  Gaia members or a name. MW_CLUSTERS now uses the catalogue positions so labels sit on them.

### I. Real nebulae
- [x] 5,676 nebulae from VizieR catalogues (`scripts/build-nebulae.mjs`, `src/sim/nebulae.ts`):
  HII regions, planetary nebulae and supernova remnants (with Ranasinghe & Leahy 2023
  distances) in 3D where distances exist; dark (Lynds, Barnard) and reflection (van den Bergh)
  nebulae on the Sky tab. The Harvard VizieR mirror drops connections often: the script retries
  and caches in `node_modules/.cache/nebulae/`.

- [x] Real-colour 3D clouds (`src/render/nebulaClouds.ts`, instanced camera-facing quads at true
  size with a minimum pixel size): emission-line colours per kind, and the 55 named nebulae as
  DSS photographs (`scripts/build-nebula-images.mjs` → `public/data/nebula-images.{jpg,json}`,
  `src/sim/nebulaImages.ts`). The images are in galactic orientation; the Sky tab pins them to
  the sphere (`SkyView.setImages`). DSS2 Blue has gaps: the script falls back to DSS1 Blue, then
  the SERC-J plates (first-generation DSS south of −17.5°), then the Mellinger mosaic.
- [x] Photographs for 3D nebulae ≥ 1.2′ in radius whose plates show diffuse light
  (`nebulosity()`: 20th-percentile brightness of 8×8 blocks; plate-edge fields dropped; dark
  clouds always kept), 128-px tiles on atlas pages 1–3; phones load page 0 only. Images match
  catalogue rows by `nebulaKey` (kind, id and position: WISE reuses ids within complexes). Dark nebulae at Zucker et al. 2020 cloud distances, drawn as absorbing
  puffs (`NebulaClouds` with `absorb`).

### H. Desktop app (Windows)
- [x] Electron shell in `desktop/`, Windows installer and portable .exe built by
  `.github/workflows/desktop.yml` on windows-latest (unsigned). Tags `v*` attach them to a
  release.
- [ ] Run the companion server inside the desktop app (Electron's Node can run `server/`).
- [ ] Code signing (needs a certificate) to remove the SmartScreen warning.

Ideas for later: pulsars from the ATNF catalogue when reachable;
dynamical friction for galaxy mergers; Virgo-cluster distances from redshift-independent
measurements.

## Notes and lessons learned
- Unreachable sources: the GWOSC catalogue (gwosc.org) fails with a TLS chain error, and CDS
  (Strasbourg) and ATNF are blocked by the proxy. The Harvard VizieR mirror sometimes returns
  empty bodies for a while. Workarounds used: arXiv abstracts to verify hand-transcribed
  values, and the Harvard SIMBAD mirror (simbad.cfa.harvard.edu) for positions.
- Site deployment: GitHub Pages is live at https://beyondthesky0099.github.io/Universe-sandbox/
  and deploys from `main`. The `github-pages` environment's branch rule must say `main`
  (lowercase). A capitalised `Main` silently blocked deploys.
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
