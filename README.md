# Astrarium: a browser universe sandbox

Explore a procedurally generated galaxy and warp into any of its 30,000 star systems. Visit the
real Solar System on any date or 4,800 real exoplanet systems. Then break them: fling planets,
shatter worlds, tear moons into rings, detonate supernovae, age stars into white dwarfs, and
watch black holes spiral together while radiating gravitational waves.

You can also play challenges, take guided lessons with live graphs, script your own force laws,
record replays, share scenes in a community gallery, build universes with friends in real time,
or describe a scene in plain English and have Claude build it.

Everything except the optional companion server runs in the browser.

| Black hole with gravitational lensing | Lesson with a live graph |
| --- | --- |
| ![Lensing](docs/screenshots/lensing.png) | ![Lesson](docs/screenshots/lesson-graph.png) |
| **Challenge: Save the Earth** | **Real exoplanets: TRAPPIST-1** |
| ![Challenge](docs/screenshots/challenge.png) | ![TRAPPIST-1](docs/screenshots/trappist.png) |
| **Scripting console** | **Black hole inspiral (relativity on)** |
| ![Console](docs/screenshots/console.png) | ![Inspiral](docs/screenshots/inspiral.png) |
| **Galaxy map** | **A moon torn into a ring** |
| ![Galaxy map](docs/screenshots/galaxy-map.png) | ![Ring maker](docs/screenshots/ring-maker.png) |
| **Giant impact** | **2,000-star cluster (Barnes–Hut)** |
| ![Giant impact](docs/screenshots/giant-impact.png) | ![Star cluster](docs/screenshots/star-cluster.png) |
| **Real Solar System (JPL data)** | **Jupiter's moons at true scale** |
| ![Real Solar System](docs/screenshots/real-solar-system.png) | ![Jupiter's moons](docs/screenshots/jupiter-moons.png) |
| **Every star within 33 light-years (HYG)** | **The Milky Way (real structure)** |
| ![Nearby stars](docs/screenshots/nearby-stars.png) | ![Milky Way](docs/screenshots/milky-way.png) |
| **Saturn's real rings (NASA radii)** | **Solar System at true scale** |
| ![Saturn's rings](docs/screenshots/saturn-rings.png) | ![True scale](docs/screenshots/true-scale.png) |
| **The Universe map: Local Group** | **The cosmic web (2MASS Redshift Survey)** |
| ![Local Group](docs/screenshots/universe-local.png) | ![Cosmic web](docs/screenshots/universe-web.png) |
| **The observable universe: CMB (WMAP)** | **Milky Way + Andromeda = Milkomeda** |
| ![CMB](docs/screenshots/cmb.png) | ![Milkomeda](docs/screenshots/milkomeda.png) |
| **Exoplanet hosts on the Milky Way map** | **NASA maps: Earth, Moon, Jupiter** |
| ![Exoplanet hosts](docs/screenshots/milky-way-exoplanets.png) | ![Real maps](docs/screenshots/real-maps.png) |
| **More real maps: Mercury, Mars, Phobos, Europa, Ganymede, Rhea, Iapetus, Vesta** | |
| ![More real maps](docs/screenshots/real-maps-more.png) | |

## Run it

```
npm install
npm run dev        # http://localhost:5173
npm test           # physics, science, real-data, challenge, lesson and web tests
npm run typecheck
npm run build      # static site in dist/
```

The web app works fully on its own. The gallery, multiplayer and "Create with Claude" buttons
need the [companion server](#companion-server). Without one, they explain how to connect.

## Features

### Play
- **Challenges** (🏆): Bullseye, Save the Earth, Twin Earths, Lord of the Rings, Slingshot,
  Trojan Parking and Black Hole Snack. Each one gives you a limited number of velocity pushes
  (Nudge tool: press on a body and drag, and a dashed line previews the new path). You earn
  1–3 stars for using smaller pushes. Every challenge has an automated test that proves it can
  be won.
- **Daily puzzle:** a new seeded comet-hits-planet puzzle every day, the same for everyone,
  with a shareable result line.
- **Missions:** the Hohmann transfer planner shows the two burns needed to reach another orbit,
  in the body panel, and the Slingshot challenge has a fuel budget for a gravity assist.

### Real data
- **The real Solar System on any date:**
  - Planet positions come from JPL's approximate Keplerian elements, valid 3000 BC – 3000 AD.
    The tests check them against JPL Horizons, and they agree to within 0.01 AU.
  - Pluto, the dwarf planets, large asteroids (Vesta, Pallas, Hygiea, Apophis, Bennu) and
    famous comets (Halley, Encke, 67P, Hale–Bopp) come from **JPL Horizons**.
  - The **4,000 brightest real asteroids, Jupiter Trojans, Centaurs and Kuiper belt objects**
    come from the **JPL Small-Body Database**. They replace the illustrative belt.
  - Masses, radii, rotation periods and axial tilts are real. Planets are drawn with their real
    spin axes from the IAU (Uranus on its side, Venus upside down), and Saturn's rings lie in its
    true equatorial plane.
- **Real sizes:** tick **Real sizes** in the Simulation panel to switch any scene from enlarged
  bodies to true radii. Known Solar System bodies use their measured JPL radius. Everything
  else uses mass–radius relations for its kind, down to a black hole's Schwarzschild radius.
  Mergers, fragments and supernova remnants keep real sizes, and collisions only happen at
  true contact. **Solar System (true scale)** adds the 12 largest moons to the whole system.
- **Real spacecraft:** 16 missions from JPL Horizons appear at their true positions on any
  date they were flying: Voyager 1 and 2, Pioneer 10 and 11, New Horizons, Parker Solar Probe,
  JWST, Europa Clipper, JUICE, Lucy, BepiColombo, Psyche, and the historical Cassini, Galileo,
  Juno and Rosetta. Pick 1989 to catch Voyager 2 at Neptune, or 2015 for New Horizons at
  Pluto. They're drawn as cyan diamonds and can be steered with the transfer planner.
- **Real moon systems at true scale:** Earth & Moon, Mars, Jupiter, Saturn, Uranus, Neptune and
  Pluto–Charon. There are 28 moons, each at its real position for today, and the real Sun at
  its true distance lights each scene and pulls on the moons. Saturn's C, B and A
  rings, the Cassini Division and the F ring are 6,000 orbiting particles at the radii from
  NASA's ring fact sheet, with density weighted by optical depth. Moons use mean orbits
  fitted to about 200 orbits of Horizons data, and they stay within 5% of JPL's positions
  (tested).
- **Real exoplanets:** a browser for 4,847 confirmed systems (6,451 planets) from the NASA
  Exoplanet Archive. You can search them and filter for temperate worlds. Load any system as a
  live simulation; masses estimated from radii are marked.
- **Real stars:** **Nearby stars** maps all 319 catalogued stars within 10 parsecs (33
  light-years) at their true 3D positions, including red dwarfs, white dwarfs and binaries.
  Colours come from B−V, masses are estimated from spectral type, and the 29 stars with known
  exoplanets can be visited.
- **Moving stars:** the nearby stars move with their real space velocities: for three quarters
  of them, distances and motions come from ESA's **Gaia DR3**; the brightest (such as Alpha
  Centauri A and B, too bright for Gaia) keep HYG's Hipparcos-era values. Speed time up to
  millions of years per second to watch the neighbourhood rearrange. The scene lists upcoming
  close passes: Ross 248 becoming our nearest star in about 36,000 years, and Gliese 710 passing
  just 0.05 parsecs (about 10,500 AU) from the Sun in 1.29 million years, through the Oort cloud,
  as Gaia studies predict.
- **The real night sky:** the sandbox background shows the 8,920 naked-eye stars
  (magnitude ≤ 6.5) in their true directions, so the constellations are where they should be.

### Learn
- **Lessons** (📚): Kepler's laws, escape velocity, orbital resonance, tides and the Roche
  limit, Lagrange points, gravity assists, the habitable zone, and Einstein's gravity. Each
  lesson sets up a scene, explains it, and checks your task automatically.
- **Live graphs** (📈, `G`): distance, orbital speed, eccentricity, periapsis direction (to
  watch precession) and total energy. **Pin run** keeps a curve so you can compare it with the next run.

### Science
- **N-body gravity:** a kick-drift-kick leapfrog integrator with an adaptive timestep. A
  **Barnes–Hut octree** switches on above 160 bodies, and physics runs in a **Web Worker**
  (add `#worker=0` to the URL to keep it on the main thread).
- **Relativity:** a first post-Newtonian correction gives perihelion precession, and
  **gravitational-wave** emission (Peters) makes compact binaries inspiral and merge with a
  ripple. You can lower the speed of light to see these effects within seconds.
- **Collisions:** slow impacts merge; fast rocky impacts **shatter**. **Tidal disruption**
  happens inside the Roche limit.
- **Stellar evolution:** stars age along their main-sequence lifetime and become giants, then
  a planetary nebula, then a white dwarf. Massive stars go **supernova** and leave neutron
  stars or black holes. White dwarfs pushed past 1.4 M☉ explode as Type Ia supernovae.
- **Analysis:** Lagrange-point markers, near-resonance detection (for example "2:1 with
  Jupiter"), tidal locking, climate and habitable zones, and forecasts of collisions and close
  approaches.

### Visuals
- **Real surfaces:** zoom in close and 11 bodies show real spacecraft maps:
  - Earth (NASA Blue Marble, with real cloud cover), the Moon (LRO) and Jupiter (Cassini)
  - Mercury (MESSENGER) and Mars (Viking)
  - Phobos, Europa, Ganymede, Rhea, Iapetus and Vesta (USGS global mosaics from Viking,
    Voyager, Galileo, Cassini and Dawn)

  Other bodies use procedural surfaces.
- **Black-hole gravitational lensing** in screen space, plus **bloom**.
- Procedural planets with oceans, continents, ice, lava, storms, cloud layers, atmosphere glow
  and rings, all generated in more detail as you zoom in.
- **GPU mega-sim** (WebGPU): 8k–32k mutually attracting bodies, every pair computed directly
  on the GPU. It's only offered when the browser supports WebGPU.
- **VR:** the 🥽 button appears when a WebXR headset is available.
- Graphics presets: Low, Medium and High.

### Create and share
- **Scripting console** (`` ` ``): JavaScript with an `api` object. Add bodies, push them, run
  code every frame, or install **custom force laws** (drag, MOND-like gravity, anything you
  like). The force laws run inside the physics worker. Save scripts as **plugins** that load
  with the app; click **API help** for the full API.
- **Create with Claude:** type "a red dwarf with three water worlds and a gas giant on a
  comet-like orbit" and the companion server turns it into a scene.
- **Replays:** press ● to record, then scrub, change speed, and save or open replay files.
  **🎥 Video** records the canvas to WebM.
- **Save, Open and Share link:** the scene is compressed into the URL.
- **Embed:** copies an `<iframe>` snippet with a minimal interface for blogs and course pages.
- **Community gallery** (🌐): publish scenes, browse the top and newest, and vote.
- **Live multiplayer** (👥): share a room code and edit the same universe together, with chat.
  The first person in a room runs the physics.

### Explore
- **The Universe map** (**Universe** tab, or zoom far out of any galaxy):
  - **869 real galaxies** of the Local Volume, out to 85 million light-years, from the Updated
    Nearby Galaxy Catalog. Each is at its measured distance and drawn at its true diameter:
    Andromeda, Triangulum, the Magellanic Clouds, Centaurus A, M81 and M82, the Whirlpool and
    the Local Group's dwarfs.
  - **38,000 more galaxies** from the 2MASS Redshift Survey trace the **cosmic web** out to
    about 700 million light-years. The Virgo, Fornax, Centaurus, Perseus and Coma clusters and
    the Great Attractor are labelled.
  - **647 bright galaxies beyond the Local Volume** are clickable too, including M87 (Virgo A,
    home of the first black hole ever imaged), M49, M60, the Sombrero, M77 and Fornax A. They
    are placed by redshift, and their panels say so.
  - **The edge of the observable universe:** the cosmic microwave background from NASA's WMAP
    9-year map, on a sphere at its real distance, 46 billion light-years. From inside it's a
    faint backdrop; zoom all the way out to see the whole observable universe from outside,
    with every galaxy above a speck at its centre.
  - Click a galaxy for its type, distance, size, mass, gas and motion (Andromeda is
    approaching at 296 km/s). Zoom in or press **Visit** to explore it. Visited galaxies are
    procedural stand-ins shaped like the real one (spiral, elliptical, lenticular, irregular
    or dwarf), clearly labelled as such.
- **The Milky Way** is the default galaxy (seed 1). It uses an approximate model of the real
  structure, after Reid et al. 2019 and Vallée 2017:
  - the Sun 8.2 kpc from the centre and 20 pc above the plane
  - four logarithmic spiral arms (Scutum–Centaurus, Sagittarius–Carina, Perseus and Outer)
    at a 12° pitch, plus the Local (Orion) Spur
  - the central bar at 27°, and Sgr A*
  - 12 real star clusters and 10 real nebulae (Pleiades, Omega Centauri, Orion Nebula, Crab,
    Carina, …) at their real galactic coordinates and distances

  - **Real black holes and pulsars**, labelled at their true positions: Gaia BH1, the nearest
    known black hole at 1,570 light-years, plus Gaia BH2 and BH3, Cygnus X-1, V404 Cygni,
    A0620-00, the Vela Pulsar and PSR J0437-4715. Positions come from SIMBAD; masses and
    distances come from each discovery paper.
  - **4,813 real stars with known exoplanets** (NASA Exoplanet Archive), placed by their real
    galactic coordinates and distances. Click one to see its planets and visit it. The streak
    toward Cygnus is the field of view of the Kepler space telescope.

  The 30,000 explorable star systems are procedural stand-ins for its ~100 billion stars, and
  the UI says so.
- Any other seed generates a procedural spiral galaxy with clusters, nebulae, dust lanes and
  a central supermassive black hole.
- Search and filter 30,000 systems for habitable worlds, gas giants, binaries and more.
  Bookmark systems, and see which ones you've visited.
- Zoom into a star to warp into its system, and zoom out to return to the galaxy.

### Real asteroid flybys
Pick an upcoming close approach to Earth and press **Watch flyby**. There are eight, from JPL's
close-approach database: Apophis passing 38,011 km from Earth's centre on 13 April 2029
(inside the geostationary ring), 2024 YR4 in 2032, and others. Each starts four days before
closest approach, using the asteroid's, Moon's and Sun's real positions from JPL Horizons, at
true scale. The simulation then reproduces the encounter: the tests confirm Apophis's closest
distance to within 2% and its time to within an hour.

### Voyager Grand Tour
Pick a flyby and press **Fly with Voyager** to ride along on one of the six real planetary
encounters: Voyager 1 at Jupiter and Saturn, and Voyager 2 at Jupiter, Saturn, Uranus and
Neptune. Each starts two days out, with the spacecraft, the planet's major moons and the Sun
at their JPL Horizons positions, at true scale. The camera rides behind the probe looking at
the planet; press the button again to continue the tour. The simulated closest approaches
match Horizons to within 0.1% and a minute.

### Sky from Earth (planetarium)
The **Sky** tab shows the real sky from anywhere on Earth at any time: the Sun, the Moon with
its phase, the planets and 8,900 stars, with twilight colours. Pick a city, type a latitude and
longitude, or use your location, then run time forward. The Moon comes from the main terms of
the ELP-2000/82 lunar theory (Meeus), and the planets from JPL's approximate elements. The tests
check positions against JPL Horizons at three sites and four dates: the Moon is within half an
arcminute and most planets within one.

### Solar eclipses
In the Sky tab, pick one of the 18 total, annular and hybrid eclipses of 2024–2035 and press
**Watch**. You stand at the point of greatest eclipse just before totality: the sky darkens
and the corona appears. A world map shows the path of totality and the moving shadow; click
it to watch from anywhere, and the panel gives the local duration and time. The shadow is
traced from JPL Horizons Sun and Moon positions and agrees with NASA's catalogue: time of
greatest eclipse within 1 s, central duration within 1 s, and path width within 1% (about 7%
for grazing eclipses). The corona's streamers are decorative.

### Halley's return (2061)
Press **☄️ Halley 2061** for the real Solar System in April 2061 with Comet Halley on its JPL
Horizons path (an orbit solution that includes the comet's jets). The simulation reproduces
JPL's perihelion on 28 July 2061 at 0.593 AU (within half a day and 0.5%), the pass 0.477 AU
from Earth the next day, and a close pass just 0.054 AU (8 million km) from Venus on 20 August.
All comets now grow tails as they near the Sun: a straight blue ion tail pointing directly
away from the Sun and a curved dust tail trailing behind. The tail lengths are illustrative.
The selected body's forecast also became more precise: it now finds the closest point between
its samples, so fast encounters like this one are no longer missed.

### Real gravitational-wave events
Pick one of 11 famous LIGO/Virgo/KAGRA detections and press **Replay merger**. The list
includes GW150914 (the first ever), the neutron-star collision GW170817, GW190521 (the most
massive), GW190814 (a lopsided pair) and the neutron star–black hole mergers. Each replay
uses the event's published masses, and the panel shows its real distance and how much mass
became gravitational-wave energy. The orbit and speed of light are scaled so the final orbits
play out in seconds, and the pair merges at the innermost stable orbit (6GM/c²).

Press **🔊 Hear the chirp** to hear the event as the detectors heard it: the leading-order
inspiral chirp of the real masses, redshifted by the source's distance (flat ΛCDM), ending in
the final black hole's ringdown at its fundamental frequency. GW150914 sweeps up through about
0.2 s to ring near 250 Hz, as observed; GW170817 is a 12-second excerpt of a chirp that lasted
about 100 s. Tick "4× higher" to make low chirps audible on small speakers. It is a
sonification from the published parameters, not the detector recording.

### Milky Way meets Andromeda
The **Milky Way meets Andromeda (real)** scenario simulates the coming collision in
kiloparsecs and millions of years:
- Andromeda at its catalogued position, 770 kpc away
- the HST-measured relative velocity (109 km/s closing, about 17 km/s sideways; van der Marel
  et al. 2012)
- both galaxies' masses, and Andromeda's real disk tilt

The cores meet after **about 3.9 billion years**, matching that study's prediction, and merge
into "Milkomeda" with long tidal tails. Each galaxy is a single softened mass, so the final
merger comes sooner than in reality, where dynamical friction delays it by about 2 billion
years.

### Scenarios
Solar System (today) · Solar System (true scale) · Milky Way meets Andromeda (real) · Earth & Moon · Mars, Jupiter, Saturn, Uranus and Neptune with their moons ·
Pluto & Charon · Protoplanetary Disk · Giant Impact · Ring Maker · Binary Star ·
Figure-8 Three-Body · Rogue Star Flyby · Black Hole Feast · Supernova · The Sun's Future ·
Relativistic Precession · Black Hole Inspiral · Galactic Core · Star Cluster Collapse ·
Self-Gravitating Disk · Galaxy Collision · Empty Space

## Controls

| Input | Action |
| --- | --- |
| Drag / right-drag / scroll | Orbit / pan / zoom (in Spawn and Nudge modes, right-drag orbits) |
| Click / double-click | Select / select and follow (Sandbox); select / fly to (Galaxy) |
| `Space` | Pause / resume |
| Hold `R` (or ⏪) | Rewind |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `V` / `B` / `N` | Select / Spawn / Nudge tool (in the Galaxy view, `B` bookmarks) |
| `F` | Follow the selected body |
| `G` | Live graph |
| `` ` `` | Scripting console |
| `Del` | Delete the selected body |
| `H` / `O` / `T` | Toggle habitable zones / orbit path / trails |
| `[` / `]` | Slower / faster |
| `M` | Switch between Galaxy Map and Sandbox |
| `Enter` | Visit the selected star (Galaxy) |
| `?` | Tutorial |
| `Esc` | Cancel / unfollow / deselect |

### URL options

You can combine these after `#`, separated by `&`:

| Option | Effect |
| --- | --- |
| `preset=<id>` | Load a scenario on start: `solar`, `inspiral`, `precession`, `future`, `rings`, `impact`, `feast`, `supernova`, `core`, `cluster`, `spiral`, `galaxies`, … |
| `galaxy=<seed>` | Open a specific galaxy |
| `scene=<data>` | A shared scene (what **Share link** creates) |
| `embed=1` | Minimal interface for iframes |
| `room=<CODE>` | Join a multiplayer room |
| `server=<url>` | Use this companion server |
| `worker=0` | Run physics on the main thread |
| `tour=0` | Skip the first-run tutorial |

## Companion server

`server/` is a small Node service (no build step; Node 22.18+ runs the TypeScript directly). It
provides:

- `GET /api/health`: which features are enabled.
- `POST /api/describe`: the plain-English scene builder, using the Claude API through the
  official Anthropic SDK. It returns a structured scene that is validated against a schema and
  sanitised again in the browser. The model is set in `server/src/scene.ts`, with server-side
  fallbacks enabled for refused requests.
- `GET/POST /api/scenes`, `POST /api/scenes/:id/vote`: the community gallery, stored as a JSON
  file.
- `/ws`: the multiplayer relay. Rooms are host-authoritative: the host simulates and
  broadcasts, and guests send edits.
- Optionally, the built web app itself (`STATIC_DIR`), so one process serves everything.

```
cd server
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start     # http://localhost:8787
npm test                                    # API, gallery and multiplayer tests
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `DATA_DIR` | `./data` | Where `gallery.json` is kept |
| `ALLOWED_ORIGINS` | `*` | Comma-separated browser origins allowed to call the API, e.g. `https://you.github.io` |
| `STATIC_DIR` | – | Serve a built web app from this folder (e.g. `../dist`) |
| `ANTHROPIC_API_KEY` | – | Enables **Create with Claude**. Without it, the gallery and multiplayer still work |
| `DESCRIBE_PER_HOUR` | `20` | Scene-builder requests allowed per visitor per hour |

> **Cost and abuse:** every scene-builder request is a paid Claude API call on your key. On a
> public deployment, set `ALLOWED_ORIGINS` to your site, keep `DESCRIBE_PER_HOUR` low, and set a
> spending limit in the Anthropic Console. Gallery posts and votes are rate-limited per IP, but
> there is no moderation or login.

### Docker

```
docker build -t astrarium .
docker run -p 8787:8787 -v astrarium-data:/data -e ANTHROPIC_API_KEY=sk-ant-... astrarium
```

The image builds the web app and serves it together with the API on port 8787. The gallery is
stored in the `/data` volume.

## Put it online

**Static site on GitHub Pages:**
1. In the GitHub repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Optional: to connect the site to your companion server, add a repository variable
   **`ASTRARIUM_SERVER_URL`** (Settings → Secrets and variables → Actions → Variables), for
   example `https://astrarium.example.com`.
3. Push to `main`, or run the *Deploy to GitHub Pages* workflow from the **Actions** tab. The
   site appears at `https://<user>.github.io/<repo>/`.

**Server:** run the Docker image (or `npm start` in `server/`) on any host that supports
WebSockets: Fly.io, Render, Railway or a VPS. Put HTTPS in front of it, because browsers on an
HTTPS page can't open `ws://` connections. If the server also hosts the app (`STATIC_DIR`, which
the Docker image sets up), you don't need Pages at all.

Players can also point the app at any server from the 🌐 or 👥 panel. The setting is saved in
their browser.

`.github/workflows/ci.yml` type-checks, tests and builds both the app and the server on every
push and pull request.

## Units, simplifications and limitations

- Simulation units are **AU, solar masses and years**, so `G = 4π²`.
- By default, body radii are **inflated** so bodies are visible and collide at solar-system
  scales (turn on **Real sizes** for true radii). Tidal limits always use nominal densities.
- Test particles (belts, debris, gas) are massless: they feel gravity but don't exert it. Mass
  lost to tidal debris isn't tracked.
- **Relativity** is approximate: a capped 1PN correction plus orbit-averaged gravitational-wave
  energy loss. It reproduces precession and inspirals qualitatively, not to observational
  precision. The "light speed" slider exaggerates the effects on purpose.
- **Stellar evolution** uses simple mass–lifetime and mass–luminosity relations, not stellar
  models.
- Lensing is a screen-space effect, not ray tracing.
- JPL approximate elements are accurate to a few arcminutes for 1800–2050. Small bodies and
  moons use two-body Kepler motion from a 2026 epoch, so they drift slowly over decades.
  Moon systems leave out the Sun's pull and planetary oblateness. Exoplanet systems
  only include planets with a known orbit, and mutual inclinations are unknown, so orbits are
  drawn nearly coplanar.
- **Tested here:** physics, science, real-data, challenge, lesson and protocol suites, the
  server API, gallery and multiplayer (also end to end with two browsers), replays, embeds, and
  the scene-builder request and error handling against a fake client.
- **Not tested here:** live calls to the Claude API, WebGPU rendering on a real GPU (the compute
  shaders were validated, but the headless browser can't present WebGPU frames), VR headsets,
  sound output, and video recording on real hardware.

## Data credits

- *This research has made use of the NASA Exoplanet Archive, which is operated by the
  California Institute of Technology, under contract with the National Aeronautics and Space
  Administration under the Exoplanet Exploration Program.* The catalogue in
  `public/data/exoplanets.json` comes from the `pscomppars` table. Rebuild it with
  `node scripts/build-exoplanets.mjs`.
- Planet surface maps are NASA mission imagery: Visible Earth Blue Marble, the SVS CGI Moon
  Kit, Cassini PIA07782, and USGS Astrogeology global mosaics (public domain). Each source and
  processing step is listed in `public/textures/CREDITS.md`. Rebuild them with
  `node scripts/build-planet-textures.mjs`.
- Saturn's ring radii, optical depths and albedos come from the NASA Saturnian Rings Fact
  Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html). Rebuild them with
  `node scripts/build-saturn-rings.mjs`.
- Gravitational-wave events: masses and distances from the LIGO/Virgo/KAGRA discovery papers.
  `node scripts/build-gw-events.mjs` checks every number against the paper's arXiv abstract.
  The GWOSC catalogue API was unreachable from the build environment because of a TLS
  certificate-chain error.
- Asteroid flybys: the JPL Close-Approach Data API with JPL Horizons starting states (rebuild
  with `node scripts/build-flybys.mjs`).
- Black holes and pulsars: positions from SIMBAD; masses and distances from the discovery papers,
  verified against their arXiv abstracts by `node scripts/build-compact-objects.mjs`.
- Cosmic microwave background: the NASA WMAP 9-year ILC map from LAMBDA (public domain),
  reprojected from HEALPix by `python3 -I scripts/build-cmb.py` (needs numpy and ImageMagick).
- Spacecraft trajectories: NASA/JPL Horizons, state vectors every 10 days (rebuild with
  `node scripts/build-spacecraft.mjs`).
- Nearby-star distances and motions: ESA **Gaia DR3** (Gaia Collaboration, Vallenari et al.
  2023), from the Gaia archive TAP service, cross-matched to HYG by `node scripts/build-stars.mjs`.
  This work has made use of data from the European Space Agency (ESA) mission Gaia, processed
  by the Gaia Data Processing and Analysis Consortium (DPAC).
- Halley's 2061 return: NASA/JPL Horizons (rebuild with `node scripts/build-halley.mjs`).
- Voyager encounters: NASA/JPL Horizons planetocentric states of Voyager 1 and 2, the moons and
  the Sun (rebuild with `node scripts/build-voyager.mjs`).
- Solar eclipses: the list and reference values from NASA's Five Millennium Canon of Solar
  Eclipses (Espenak & Meeus, eclipse.gsfc.nasa.gov), with JPL Horizons apparent Sun and Moon
  positions (rebuild with `node scripts/build-eclipses.mjs`).
- Planetarium checks: JPL Horizons topocentric positions in `tests/fixtures/sky-reference.json`
  (rebuild with `node scripts/build-sky-reference.mjs`). The Moon's theory is from Meeus,
  *Astronomical Algorithms* (2nd ed., ch. 47).
- Galaxies: the **Updated Nearby Galaxy Catalog** (Karachentsev, Makarov & Kaisina 2013, AJ
  145, 101) and the **2MASS Redshift Survey** (Huchra et al. 2012, ApJS 199, 26), retrieved
  from VizieR (CDS). Rebuild them with `node scripts/build-galaxies.mjs`. Survey distances use
  Hubble's law (H0 = 70 km/s/Mpc), so clusters appear stretched along the line of sight
  ("fingers of God"). Cluster labels use approximate published positions.
- Star data: **HYG database v4.1** by David Nash (astronexus), licensed **CC BY-SA 4.0**
  (https://codeberg.org/astronexus/hyg). The derived files `public/data/stars-near.json` and
  `public/data/stars-bright.json` are also CC BY-SA 4.0. Rebuild them with
  `node scripts/build-stars.mjs`.
- Planet positions use E. M. Standish, *Keplerian Elements for Approximate Positions of the
  Major Planets* (JPL Solar System Dynamics).
- Dwarf planets, asteroids, comets and moons come from NASA/JPL Horizons
  (ssd.jpl.nasa.gov/horizons). The 4,000 small bodies come from the JPL Small-Body Database
  Query API. Rebuild them with `node scripts/build-solar-system.mjs` and
  `node scripts/build-small-bodies.mjs`.
- Horizons has no mass or size for Eris, Haumea or Makemake, so those values come from
  published papers, cited in the build script. The Makemake mass is an estimate. Masses of
  comets and the smallest moons are estimated from their size and an assumed density, and
  marked as estimates in the data.

## Project layout

```
src/
  sim/        physics: bodies, integrator, Barnes–Hut, collisions, tides, relativity,
              stellar evolution, climate, analysis, ephemerides, exoplanets, worker
  procgen/    seeded RNG, names, star-system and galaxy generators
  render/     Three.js views, body visuals, procedural textures, lensing + bloom
  gpu/        WebGPU N-body mega-sim
  game/       challenges, transfer planner, lessons, scene specs
  net/        companion-server and multiplayer clients
  ui/         history, sharing, graphs, replays/video, scripting console, tutorial
  audio.ts    WebAudio drone and effects
  app.ts      wires everything together
server/       companion server (gallery, multiplayer, scene builder)
scripts/      data build scripts
tests/        vitest suites
```

The physics core (`src/sim`) has no rendering dependencies, so it runs headlessly in tests and
in the Web Worker.
