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

**Suggested next steps:**
- a global colour map of Saturn, if one turns up (Photojournal has none);
- exoplanet hosts in the galaxy search and filters;
- the pulsar wind nebula on the Galaxy Map up close (Sandbox only so far).

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
      true-scale Solar System. The 14 named gaps (Encke, Keeler, …) come from the IAU/USGS ring
      table and are kept clear (section AG).
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
      the eye sees) and Titan (near-infrared). Io now uses the USGS colour-merged mosaic, which is
      simple cylindrical (section AG). Still procedural: Venus, Saturn, Uranus,
      Neptune, Callisto, Titan and the smaller moons. Solar System Scope serves an HTML
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
  software rendering saturates its 4 cores, so measure on a real machine. The Barnes–Hut
  tree path is threaded too now (section AG).

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

### Q. Real atmospheres
- [x] `src/render/atmosphere.ts`: ATMOSPHERES (Earth, Mars, Venus, Titan, giants), atmosphereFor
  (named or by procedural rim colour), shellScale, scatteringMaterial (single scattering, 14 view
  × 5 light samples, Rayleigh + Henyey–Greenstein-like Mie phase, premultiplied blending,
  logarithmic depth chunks — the sandbox renderer uses a log depth buffer), insideAware (front
  faces from outside, back faces from inside), aimSun (per frame from the heaviest star). Wired in
  BodyVisual.applyDetail/update. Tests: tests/atmosphere.test.ts.

### R. Auroras
- [x] `src/render/aurora.ts`. AURORAS holds the data:
  - Earth, Jupiter, Saturn, Uranus and Neptune;
  - magnetic tilt, oval colatitude, night-side shift and width;
  - emission altitudes, as fractions of the radius;
  - up to three emission layers (colour, height, width, weight).
- auroraFor: named bodies use the table; real bodies missing from it get none; procedural giants
  and rocky worlds with air of ≥ 0.3 M⊕ get one.
- auroraActivity: (d₀/d)² wind times a substorm flicker. ovalColatitude widens with activity.
- auroraMesh: 7 curtains plus a flat diffuse ribbon per hemisphere, positioned in the vertex
  shader.
  - Optically thin, so the light is brightened by path length (up to 6×) when seen edge-on.
  - The fragment shader needs `#include <logdepthbuf_fragment>`, or it fails the planet's depth
    test.
- BodyVisual adds it in applyDetail and updates it only when the planet is more than 14 px across
  and a star is present. Tests: tests/aurora.test.ts.

### AG. Pulsars in depth, and the backlog
- [x] Beams as glowing gas (render/neutronStar.ts BEAM_FRAGMENT).
  - Each pixel is the line-of-sight integral through a Gaussian tube around the axis, evaluated
    analytically at the point of closest approach, with a white core and a blue halo.
  - It is drawn on the back faces of a closed hull, once per pixel.
- [x] The wound field (striped wind): a spiral-streak disc in the spin equator (WIND_FRAGMENT).
  Its pitch is a clamped multiple of the light cylinder.
- [x] Pulsar wind nebula (PWN_FRAGMENT), ray-marched in a sphere of 45 drawn radii.
  - It has a torus, an inner ring and kinked jets, Doppler-boosted with flow β = 0.5.
  - Only when Ė > 10²⁹ W. Counter-rotated so it doesn't spin with the star.
- [x] pulsars.json carries pb_days, ecc and companion_msun (ATNF PB, ECC, MedMass).
- [x] The Galaxy Map pulsar target `{ psr: index }` (GalaxyTarget). App.pulsarMapList is in the
  order of GalaxyView.pulsarPositions.
  - The star panel shows a pulsar's facts. Enter calls loadPulsarSystem in presets.ts.
  - B1257+12 and B1913+16 open their own presets. Origin kind 'pulsar'.
  - rememberPulsar(name, P, Ṗ) registers catalogue spins for pulsarParams.
- [x] Pulsar sound (src/sim/pulsarSound.ts): playSamples. Buttons #btn-pulsar-hear (body panel)
  and #btn-star-hear (Galaxy Map).
- [x] Hulse–Taylor (src/sim/binaryPulsar.ts, preset 'hulse-taylor', src/ui/hulseTaylorChart.ts
  into #preset-extra).
  - Covers Ṗb, ω̇ and the time to merge (Peters' equations integrated, 300 Myr).
  - A test checks that the scene precesses at the GR rate.
- [x] Saturn: the named gaps (14, from the IAU/USGS table) are in saturn-rings.json.
  - sampleRingRadii skips them.
  - Saturn's ring mesh uses the real radii and realRingTexture (τ → opacity, albedo →
    brightness).
- [x] Io's real map (USGS colour-merged mosaic, desaturated). No NASA global cylindrical colour
  map of Saturn was found, so Saturn stays procedural.
- [x] Multi-core Barnes–Hut: treeKernel.ts and Octree.pack.
  - ParallelForces.runTree uses CTRL.MODE 1/2 and shares 32,768 bodies and 131,072 nodes
    (about 16 MB).
  - Results are identical (tests/parallel.test.ts). Node benchmark: 3.2× on 4 threads.
- [x] Desktop server: desktop/build-server.mjs bundles server/src/embedded.ts into
  desktop/server.cjs. main.cjs starts it on 127.0.0.1 and passes `#localserver=`. The CI job
  installs server deps.
- Tests: tests/neutron-star.test.ts, tests/saturn-rings.test.ts, tests/parallel.test.ts.

### AF. Pulsars and neutron stars; zooming in on small nebulae
- [x] Galaxy Map zoom goes down to 0.0004 units (about 0.2 light-years; it stopped at 0.2 units,
  about 100 ly).
  - The near plane follows the camera in (GalaxyView.update).
  - Label "go to" distances scale with the object's true size, from 0.003 units.
- [x] Small photographed nebulae (galaxyMap.showNebulaeOnMap).
  - The survey picture is never less than 3′ across, so a planetary nebula fills only its middle.
    The flat picture is now drawn at its true field.
  - Up close, a nebula whose picture is much bigger than it becomes its modelled ray-marched
    shape, not the burnt-out photo.
  - Planetary nebulae get their central star (nebulaRaymarch, uShape 2).
- [x] Real pulsars: `scripts/build-pulsars.mjs` writes `public/data/pulsars.json` from the ATNF
  Pulsar Catalogue v2.6.1.
  - 3,632 Milky Way pulsars with a period, distance and position, plus flags (magnetar, binary,
    high-energy, globular, RRAT) and the supernova remnant each sits in.
  - `src/sim/pulsars.ts` loads it.
  - It is a Galaxy Map real layer (#opt-real-pulsars) and a search source.
- [x] `src/sim/neutronStar.ts` (headless): compactness, Beloborodov light bending, the visible
  fraction, redshift, gravity, density, light cylinder, polar cap, Rankin beam width, spin-down
  (B, age, Ė), and a rough cooling curve.
  - `pulsarParams(name, id)`: catalogued values for known pulsars (KNOWN_PULSARS; a test keeps
    them in step with pulsars.json), else a newborn pulsar from Faucher-Giguère & Kaspi 2006,
    seeded by the body id.
  - `neutronFacts()` feeds the body panel.
- [x] `src/render/neutronStar.ts` (NeutronStarVisual, used by BodyVisual for kind 'neutron').
  - A surface shader that bends light: each pixel's true surface point comes from Beloborodov.
  - Warm magnetic poles (flux ∝ cos²θ + 0.25 sin²θ) and hot polar caps.
  - Dipole field lines and hollow-cone beams, all on a magnetic axis tilted by the obliquity.
  - It turns at the real period, slowed to at most 4 turns a second (displayPeriod).
  - The glow flashes when a beam points at the camera. BodyVisual.update now takes the camera
    position.
- [x] Preset 'pulsar-planets': PSR B1257+12 (Lich) with Draugr, Poltergeist and Phobetor. Orbits
  are from the ATNF timing solution.
- [x] Bug fix: tidal disruption of planets by compact stars used the planet's game radius, so a
  neutron star tore planets apart 0.7 AU away.
  - It now uses (3M / 4πρ)^⅓ with the nominal density.
  - Stars still use the old formula, so black holes shred them before contact.
- Tests: tests/neutron-star.test.ts.

### AE. Fixes from phone testing
- [x] Travel controls fold into a 🚀 button (#travel-toggle and #travel-close; the state is
  kept in prefs 'travelOpen').
- Trails at high speed: when a frame covers more than 1/40 of a body's period around its parent
  (SystemView.fastOrbit, parents cached for 30 frames), BodyVisual.orbitTrail draws the two-body
  conic (orbitPath), rotated to end at the body. Before, chords made star polygons.
- Fragment names: Simulation.fragmentName numbers pieces of pieces from the root name ("Theia
  fragment 7"). Tested in tests/physics-features.test.ts.
- Phone: in the Sandbox the inspector sheet sits above the dock.
- Notifications: SimEvent gets an optional `title` (one-line headline; supernova events set it,
  e.g. "💥 Rich: Type Ib supernova → a 1.8 M☉ neutron star").
  - toast(message, kind, title) shows the title, or the first two lines of a long message.
    Tapping toggles the full text; an opened toast stays until tapped again.
  - Phones: toasts sit at the top, at most 2 at a time.

### AD. Animated wordmark and label declutter
- [x] `src/ui/wordmark.ts`: the brand site's BrandWordmark.jsx ported to plain DOM.
  - DEFS and ARTWORK are copied verbatim (by script) from the JSX; the motion is the same.
  - mountWordmark(container, segments) returns a stop function. It pauses off screen and when
    the tab is hidden, and slows for prefers-reduced-motion.
  - Mounted in the top bar (40 segments) and on #splash, which fades after 2.5 s or on any
    input and is skipped in embeds.
- `src/render/labelDeclutter.ts`: every 3 frames, label rects are placed greedily by priority
  (userData.priority, then size, then non-catalogue names, then depth), on a grid hash. Labels
  that overlap fade out by opacity (baseOpacity is kept).
  - Used by GalaxyView.update and CosmosView.update.
  - pickLabel ignores labels below 0.3 opacity. "You are here" has priority 1000.
- Tests: tests/label-declutter.test.ts.

### AC. Beyond The Sky brand kit
- [x] Brand kit from beyondthesky0099/beyondthesky_new (horizons-export/apps/web:
  tailwind.config.js, src/index.css, public/favicon.svg).
- `public/brand-mark.svg` (the favicon mark) is used in the top bar and as the favicon;
  desktop/icon.svg is the same mark at 512 px (icon.png regenerated with make-icon.mjs).
- Fonts are Space Grotesk, Inter and IBM Plex Mono, loaded from Google Fonts in index.html with
  system fallbacks.
- style.css: the old cyan and blue literals are mapped onto the brand palette. A closing
  "brand kit" block sets the tokens (--accent-strong is Eclipse Red, --accent Cosmic Blue),
  type, corners and primary states.
- In the 3D scene, the selection ring, orbit line and predicted path are Cosmic Blue.

### AB. Interface frame
- [x] `src/app/layout.ts` (LayoutUI):
  - Builds the icon rail from the current view's `.panel.left section[data-pane]` (data-icon,
    data-title). One pane at a time; each view's last pane is kept in prefs. Clicking the open
    pane folds the panel (`body.rail-collapsed`).
  - The ⋯ menu (#more-menu). Items are the old top-bar buttons with the same IDs, labelled via
    CSS `attr(data-label)` so code that rewrites their text keeps the label. `data-proxy` items
    press another button.
  - The dock toggles mirror the Display checkboxes. #body-close deselects.
  - Sets `body[data-screen]` for CSS. It must not be `data-view`: App.setView hides every
    [data-view] that isn't current.
- index.html:
  - The Sandbox panel is split into panes. All old element IDs are kept (checked by diffing
    them), and the tutorial targets still resolve; Tutorial now reveals the pane holding a
    target.
  - The clock, the speed slider and the tools moved into #dock.
- style.css "Interface frame" block: rail, panes, dock, menu. Phones get a bottom tab bar, sheet
  panes, a compact dock, and Places and Photo moved into the menu.

### AA. Planet formation
- [x] `src/sim/planetFormation.ts`:
  - Disc: MMSN densities (solid/ice/gas) and the snow line at 2.7 AU; solidMass, gasMass,
    isolationMass (Kokubo & Ida, b = 10), planetesimals (equal √r steps, so each body carries its
    annulus).
  - Gas: gasAccretionTime (KH, 10⁸ (M/M⊕)^−2.5 yr), gasSupply (min of the gas within ±30% and the
    gap-opening mass 3(h/r)³ M*), accreteGas.
- Simulation.formation ({starId, enhancement, speedup, gasUntil, dispersed}) is saved in
  state.ts.
  - growPlanets: cores ≥ 10 M⊕ grow in gas while the disc lasts; an event fires at 95 M⊕.
  - Dispersal: an event, and the particles are cleared.
- Preset 'proto' (Planet Formation):
  - Seeded with mulberry32(2026): 80 embryos, 6× MMSN, 0.4–8 AU, e ≤ 0.05.
  - Speedup 3000, so the gas lasts 1,000 simulated years. Debris and shatter are off (perfect
    merging).
  - No dust particles: 2,500 made each step ~18× slower. The view draws the gas disc and the
    snow line instead.
- Tuned headlessly. A 4× disc stalled at 9.3 M⊕ cores. With 6×, giants were born at ~4–5 AU
  after ~350 years, ending near 1.3 MJ (the gap limit); later scattering can push them in or
  out.
- Tests: tests/planet-formation.test.ts.

### Z. App split into feature controllers
- [x] App went from about 4,900 lines to about 1,200 in `src/app.ts`, plus 22 controllers in
  `src/app/` (classes taking `app: App`) and `src/app/shared.ts` (types, constants, helpers).
  The App's members became public so the controllers can use them.
- Done mechanically with the TypeScript compiler API:
  - Methods were moved by name.
  - `this.x` became `this.app.x`, or `this.app.<area>UI.x` for a method that moved elsewhere.
  - Unused imports were pruned.
- Behaviour is unchanged: tests, typecheck, build, and browser smoke runs of tabs, landing,
  places, photo, the body wiki, travel, the ship autopilot and search.

### Y. VR everywhere
- [x] `src/render/vr.ts`:
  - deadZone, flyStep, scaleStep, SnapTurn, readSticks (xr-standard axes 2/3).
  - offsetTransform / VrRig: moves the viewer by an offset XR reference space, re-derived from
    the base space each frame, so the camera stays in world coordinates and views work unchanged.
  - tabletopStep.
- App: btn-vr moved to the top bar. enterVR: tabletop for the Sandbox, enterImmersiveVR for the
  others (controls disabled). tickVR runs before frame() each animation frame.
- Untested on a real headset (no WebXR device here). Tests: tests/vr.test.ts.

### X. Land on planets
- [x] `src/render/lander.ts` Lander:
  - The camera rides the planet mesh's frame at EYE_HEIGHT.
  - The planet spins at its real rate (rotationAngle from the JPL rotationHours) while landed.
  - The terrain patch is a polar grid of radius PATCH_RADIUS around the site: fbm/ridged relief,
    craters (many if airless), uv matching SphereGeometry (sphereUv, unwrapped at the seam), and
    an edge fade into the sphere. It is rebuilt when you walk away from the centre.
  - Look, walk and zoom controls; localSolarTime; sunElevation.
- SystemView.land/takeOff:
  - Skips follow and OrbitControls while landed; hides the orbit line, marker and HZ rings.
  - Fades the starfield, body dots and particles by Sun elevation if the world has air.
- Atmosphere: the ground sphere is at 0.996 so hollows stay above it; groundExposure is used from
  inside (Mars 4).
- App: the Land button (rocky bodies), #land-hud, keys (WASD/arrows, Esc). Time is 10 min/s
  while landed and is restored on take-off.
- Tests: tests/lander.test.ts.

### W. More Gaia stars
- [x] `scripts/build-gaia-bright.mjs` writes public/data/gaia-bright.bin (602 KB).
  - Query: Gaia DR3, G < 8, parallax_over_error > 5; MAXREC raised past the 50,000 default.
  - Binary struct of arrays: l, b, d (pc), Teff, G.
- `src/sim/gaiaBright.ts`: decode/encode, loadGaiaBright, gaiaPoints.
- Wiring: GalaxyView.setGaiaStars / setGaiaVisible, App.showGaiaOnMap (Milky Way only), checkbox
  opt-gaia-stars.
- Tests: tests/gaia-bright.test.ts, including the Pleiades at l 166.6°, b −23.5°, ~135 pc.

### V. Spinning (Kerr) black holes
- [x] `src/sim/kerr.ts`:
  - horizonRadius, iscoRadius (BPT 1972), photonOrbits, radiativeEfficiency.
  - shadowOutline / shadowProfile: Bardeen 1973, 32 bins relative to √27 M, +x = approaching
    side.
  - mergerSpin: Rezzolla+ 2008, aligned spins.
- Body field `spin` added to body.ts, protocol (BODY_STRIDE 15) and state.ts.
  Simulation.merge sets the remnant's spin.
- Rendering:
  - `render/accretionDisk.ts`: ShaderMaterial disc on DISK_LAYER (2). Unit = √27 M. It has the
    ISCO inner edge, a thin-disc T profile, Doppler D³ beaming and gravitational redshift, and
    hides far-side light directly behind the hole.
  - postfx: LensInfo, with the D-shaped shadow from the uShadow table, a beamed photon ring, and
    an Einstein ring that takes light from just outside the hole. A LayerPass draws the discs
    after the lens; it must null scene.background.
  - BodyVisual: with the lens on, the sphere shrinks to the horizon and the glow is hidden.
- UI: spin slider and facts (horizon, ISCO, efficiency). Tests: tests/kerr.test.ts.

### U. Planet "More about" section
- [x] `src/sim/planetFacts.ts`:
  - planetFacts: gravity, escape velocity, density, insolation, equilibrium T and Hill radius.
    The radius is measured where known, otherwise from physicalRadius.
  - earthSimilarity: ESI with weights 0.57, 1.07, 0.70 and 5.58 (n = 4; Earth 288 K). esiLabel.
  - wikipediaUrl (disambiguation table) and exoplanetArchiveUrl.
- App.updateBodyWiki fills `<details id="body-wiki">`, only while it is open.
  - It uses real data when the mass still matches the catalogue to within 1%.
  - Exoplanets use the scenario's ExoHost.
- Tests: tests/planet-facts.test.ts.

### T. Places
- [x] `src/ui/places.ts`:
  - Place / PlaceView: system, galaxy, cosmos, sky, or a built-in "search" query.
  - BUILT_IN_PLACES. Two optional fields: `lookAt` (camera behind the followed body, tilted so
    the other shows above its limb; the sim pauses) and `poleFrame` (offsets in the body's spin
    frame).
  - validPlace: places from storage and links are untrusted.
  - encodePlace / decodePlace: base64url JSON. PlaceStore: localStorage, newest first, max 200.
- App: capturePlace / goToPlace / renderPlaces / bindPlaces. Key L. `#place=` is read at startup.
  SkyView.look gives alt, az and fov. Tests: tests/places.test.ts.

### S. Photo mode
- [x] `src/ui/photo.ts` PhotoMode:
  - enter/exit toggles `body.photo-mode`, which hides everything but the canvas, labels and
    #photo-bar.
  - The grade is a CSS filter on the canvas, and the same filter goes through ctx.filter on
    capture.
  - The FOV is applied per camera in beforeRender, called from App.renderView, and restored on
    exit.
  - Hiding labels hides in-scene text sprites (userData.labelText) and the CSS2D layer.
  - capture(scale) sets the pixel ratio, resizes, calls frame(0), copies to a 2D canvas in the same
    task, restores, then downloads the PNG.
- captureRatio caps the long side at 8192 or the GPU limit, and the size at 16 MP.
- Key P; Esc leaves. Tests: tests/photo.test.ts.

### P. Spaceships
- [x] `src/sim/spaceship.ts` (ENGINES, autopilotAccel: brachistochrone approach, then steer to
  the local circular orbit; settles when near-circular within 20% of the radius; orbitAround).
  `Simulation.thrust/autopilot/appliedThrust`, applied in computeForces, fuel burned per step,
  `thrustStepLimit` caps the step by fuel and by 2% of the manoeuvre's speed scale. Protocol
  messages `thrust` and `autopilot` (SimHost.setThrust/setAutopilot); events of type 'ship'.
  Ships (tag 'ship') collide with real radii (overlaps()). App: spawnShip, hold-to-thrust
  buttons and WASDQE, ship panel readout; autopilot raises the time scale so the flight takes
  about 25 s and lowers it on arrival. Tests: tests/spaceship.test.ts (incl. Earth → Mars).

### O. Travel at any speed
- [x] `src/sim/travel.ts` (SPEEDS, Trip with Earth/ship clocks, autoWarp, formatting),
  `src/render/relativity.ts` (shared `uBeta` uniform, GLSL aberration + Doppler + beaming in
  every galaxy/cosmos point, cloud, volume, starfield and label material),
  `App.startTrip/tickTrip` (go* helpers route label clicks, double-clicks, star/galaxy lists and
  search through travel when "Travel at this speed" is ticked). Auto-enter/exit transitions
  pause during a trip. Tests: tests/travel.test.ts.

### N. Search everything
- [x] `src/ui/search.ts` (SearchIndex, normalize, ranking: exact 650 / prefix / word starts /
  substring, + 1.5 × rank), `src/ui/searchSources.ts` (entries per catalogue, each with an
  action), `App.goToSearchResult` (map / sky / galaxy / cosmos / body / exo / preset / lesson /
  challenge / gw / flyby / voyager / eclipse). Built lazily on first open. Tests:
  tests/search.test.ts on the real data files. `isTyping` now covers search inputs.

### M. Supernovae by mass and metallicity
- [x] `src/sim/stellarFate.ts`: winds (Z^0.85), stripping mass 25 M☉·Z^−1.2, helium core
  0.1 M^1.32, fates ECSN / II-P / II-L / IIb / Ib / Ic / Ic-BL / PPISN / PISN / failed, progenitor
  T, R, L, explosion and remnant. `Body.metallicity` (Z/Z☉; protocol BODY_STRIDE 14, state,
  shock frames carry subtype, envelope, interaction: SHOCK_STRIDE 19). Light curves: plateau from
  the hydrogen envelope only; Arnett otherwise. Tests: tests/stellar-fate.test.ts. Body panel:
  metallicity slider and fate line. Preset `supernova-zoo`.

### L. Ray-marched nebulae
- [x] `src/render/nebulaRaymarch.ts`: `makeNoiseVolume` (tileable 64³ RG noise: fBm + ridged,
  a Data3DTexture), `starlessGas` (star clipping + blur of a photo tile), `NebulaRaymarch`
  (BackSide sphere, front-to-back emission/absorption, premultiplied blending, per-type fields:
  photo / HII / PN / SNR / dark / refl). `GalaxyView.setCloudLayer(..., volumes)` takes
  `VolumeItem`s (centre, radius, shape, photo set + rect, axes, the billboard clouds to fade);
  `updateVolumes` picks those nearest the camera's aim within 10 radii (`volumeBudget`:
  2 × 72 steps desktop, 1 × 32 phone). Tests: tests/nebula-raymarch.test.ts.

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
