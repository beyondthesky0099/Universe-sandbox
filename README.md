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

### Desktop app (Windows)

Astrarium also comes as a Windows program, built with Electron from the same code. Compared
with a browser tab, it:
- asks Windows for the **high-performance GPU**, so laptops with two graphics chips use the
  dedicated one
- is never slowed down in the background
- starts at high graphics quality
- works offline, with all the real data bundled
- spreads the physics over all your CPU cores: the particles (asteroids, debris, galaxy stars),
  and in big scenes the whole Barnes–Hut gravity tree
- runs its own companion server, so the community gallery and multiplayer rooms work with no
  setup
  - It listens only on this computer (127.0.0.1) and keeps the gallery in the app's data
    folder.
  - The Claude scene builder turns on if `ANTHROPIC_API_KEY` is set.
  - A server you choose in the app's settings takes precedence.

Download `Astrarium-Setup-<version>-x64.exe` (installer) or `Astrarium-Portable-<version>-x64.exe`
(runs without installing) from the [Releases](https://github.com/beyondthesky0099/Universe-sandbox/releases)
page, or from the latest **Desktop app** run on the Actions tab. Laptops with a Snapdragon (ARM)
processor take the `-arm64` files.

**Graphics on any laptop:**
- It asks Windows for the high-performance GPU, and ignores Chromium's GPU blocklist, so older
  Intel, AMD and NVIDIA laptop chips still draw with the GPU instead of software.
- It starts at **Ultra** quality: it renders at 1.5× the screen's resolution for sharp edges, with
  the largest planet textures and more bodies in full detail.
- **Keep it smooth** (on by default) lowers the resolution when the frame rate drops below about
  55 fps, and raises it again when there is room. A strong graphics card stays above screen
  resolution; integrated graphics stay smooth. The frame-rate readout shows the resolution
  whenever it is lowered.
- Settings shows which graphics chip is drawing, so you can check that the laptop is using its
  dedicated GPU. The files aren't code-signed,
so the first time you run one, Windows SmartScreen may say it's from an unknown publisher:
choose *More info → Run anyway*. Press F11 for full screen.

**How the multi-core physics works:** the pull of the bodies on each test particle is computed in slices, one per CPU core. The cores share memory through SharedArrayBuffer and coordinate with Atomics. This needs cross-origin isolation (the COOP and COEP headers), which the desktop app and the dev and preview servers send. GitHub Pages can't send those headers, so the website keeps the single-threaded path.
- **Exact results:** the threaded result is identical to the single-threaded one (tested).
- **Measured speed-up:** in a 4-core test machine, without a renderer competing for cores, the force calculation ran 1.8× faster on 2 threads and 2.4× faster on 3.
- **Where it matters:** that calculation is about 87% of each step in the asteroid-heavy scenarios (Solar System, Rogue star, the Sun's future).
- **Big scenes:** scenes big enough for the Barnes–Hut tree (the spiral galaxy, the cluster, galaxy collisions) share the tree itself.
  - The physics thread copies the tree into shared memory each step, and every core walks it for its own bodies and particles, in the same order, so the results are identical.
  - Measured in Node with 20,000 bodies: 1.75× on 2 threads and 3.2× on 4.
- The physics panel shows how many cores are in use. Add `#threads=0` to the address to turn this off.

To build or run it yourself:

```
npm run desktop       # build the web app and open it in the desktop shell
npm run desktop:win   # build the Windows installer and portable .exe into desktop/release/
```

To publish a release, push a tag such as `v0.2.0`. GitHub Actions builds both .exe files on
Windows and attaches them to a release for that tag. "Use my location" in the Sky tab doesn't
work in the desktop app, so type your latitude and longitude instead.

## The interface

Astrarium wears the **Beyond The Sky** brand kit:
- **Colours:** Void Black, Eclipse Red for primary actions and the active view, Cosmic Blue
  accents, and Starlight and Orbit Grey text.
- **Type:** Space Grotesk for headings, Inter for text, and IBM Plex Mono for labels and numbers.
- **Shape:** sharp corners.
- **Logo:** the full animated Beyond The Sky wordmark (ported from the brand site) sits in the
  top bar and on a short opening splash. In it, a helium-4 atom traces an infinity loop through
  the eclipse "O"; helium was found in the Sun's spectrum during the 1868 eclipse. The
  eclipse-ring mark is the favicon, the phone logo and the desktop app's icon.

On the Galaxy Map and Universe views, names never pile up. Where labels would overlap, the
important ones stay and the rest fade out until you zoom in and there's room for them:
- "You are here" first;
- then well-known names like the Orion Nebula or M13, ahead of bare catalogue numbers;
- then nearer objects.


- **Top bar:** search, Places and photo mode on the left; the four views (Universe, Galaxy Map,
  Sandbox, Sky) in the middle; the ⋯ menu on the right. The menu holds lessons, challenges, the
  live graph, multiplayer, the gallery, the console, sound and the tutorial.
- **Icon rail (left):** each view's panel is split into panes, one at a time:
  - Sandbox: Scenes, Create, Real data, Events, Physics, Display, Save & share, Settings.
  - The Galaxy Map, Universe and Sky have their own panes.
  Click the open pane's icon again to fold the panel away and give the view the whole screen.
- **Dock (bottom, Sandbox):** rewind, play and fast-forward; the clock; the speed slider; record
  and undo; the Select, Add and Nudge tools; and quick toggles for trails, orbits, labels and
  habitable zones.
- **Inspector (right):** the selected body's facts and actions, with ✕ to close it.
- **Phones:** the rail becomes a tab bar along the bottom, and panes open as sheets above it.

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
  stars (with a natal kick, Hobbs et al. 2005) or black holes. White dwarfs pushed past 1.4 M☉
  explode as Type Ia supernovae.
- **Supernova physics** (`src/sim/supernovaPhysics.ts`): 10⁵¹ erg of ejecta expanding
  homologously at up to √(10E/3M) (about 3,500 km/s for a Type II, 11,000 km/s for a Type Ia);
  a light curve from ⁵⁶Ni → ⁵⁶Co decay (Nadyozhin 1994) diffused out as in Arnett's model, plus
  the Type II-P hydrogen plateau (Kasen & Woosley 2009); a blast wave in free expansion, then
  Sedov–Taylor, then the radiative snowplow (Cioffi et al. 1988). A body is blown apart when the
  energy it intercepts exceeds its gravitational binding energy; otherwise it survives, but loses
  its orbit if the star lost more than half its mass.
  **Which supernova a star makes depends on its mass and metallicity** (`src/sim/stellarFate.ts`,
  after Heger et al. 2003, Sukhbold et al. 2016 and Heger & Woosley 2002). Metal-rich stars lose
  more mass to winds (Ṁ ∝ Z^0.85), and that decides what the star looks like when it dies and how
  it explodes:
  - 8–9.5 M☉: a faint electron-capture supernova (like SN 1054, which made the Crab).
  - A red supergiant (~3,500 K, 500–1,000 R☉): a Type II-P with a ~100-day plateau and a neutron star.
  - A blue supergiant at low metallicity (~16,000 K, ~40 R☉): a fainter plateau, like SN 1987A.
  - Above ~25 M☉ at solar metallicity, winds strip the hydrogen: a Wolf–Rayet star (60,000–110,000 K) makes a Type Ib, Ic or broad-lined Ic hypernova (3×10⁵² erg), with no hydrogen in the debris.
  - Metal-poor stars of ~40–100 M☉ collapse into black holes without a supernova, just a faint red glow.
  - Helium cores of 35–64 M☉ make pulsational pair-instability supernovae: bright colliding shells, then a black hole below the ~45 M☉ mass gap.
  - Helium cores of 64–133 M☉ (around 140–260 M☉ at low metallicity) make pair-instability supernovae, which leave nothing and make up to ~57 M☉ of ⁵⁶Ni.
  - Type Ia white dwarfs make less ⁵⁶Ni the more metal-rich they are (Timmes et al. 2003).

  Every star has a metallicity slider in its panel, and the panel says how the star will die. The
  **Supernova Zoo** scenario sets off six stars with six different fates. These are single-star
  trends: real boundaries also depend on rotation and binary companions.
  The ejecta are layered as in the explosion models (Woosley & Weaver 1995; Sukhbold et al. 2016;
  the W7 Type Ia model): iron and silicon in the slow core, then oxygen and helium, then the
  hydrogen envelope outside. Each glows in its strongest emission line: gold iron, orange-red
  sulphur, teal oxygen, red hydrogen-alpha. Most of the gas is in knots, as in Cassiopeia A,
  and it piles up behind the blast wave once that slows down, instead of outrunning it.
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
- **VR:** the 🥽 button in the top bar appears when a WebXR headset is available (`src/render/vr.ts`).
  - **Sandbox:** a tabletop. The trigger pauses, the left stick turns the table and the right
    stick resizes it.
  - **Galaxy Map and Universe:** you stand where the camera was. The left stick flies where you
    look; the right stick snap-turns (left/right) and changes speed (up/down).
  - **Sky:** you stand under the real sky.
  - The thumbstick logic is unit-tested, but it hasn't been tried on a headset here.
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
  - **Zoom in to arrive.** Select a black hole or pulsar (click its name or dot), then zoom in or
    press Enter, and it opens in the Sandbox.
    - Each black hole comes with its companion star on the orbit from its paper.
    - The Gaia black holes are dormant: no disc, only their shadow and the bending of starlight.
    - The X-ray binaries feed from a disc.
  - **3,632 real pulsars** from the ATNF Pulsar Catalogue at their estimated distances: young
    pulsars in blue, millisecond pulsars in white, 13 magnetars in magenta. The famous ones are
    named, and every one can be found with search.
  - **Zoom in to about 0.2 light-years.** Even a planetary nebula under a light-year across, like
    the Ghost of Jupiter, fills the view, as a shell of glowing oxygen and hydrogen around its
    white-dwarf star.
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

### Real nebulae
The map shows **5,676 real nebulae** from professional catalogues:

| Type | How many | Catalogue |
|---|---|---|
| HII regions (where stars are being born) | 2,174 | every confirmed one in the WISE catalogue |
| Planetary nebulae (shells from dying stars) | 1,143 | the Strasbourg-ESO catalogue |
| Supernova remnants | 294 | Green's catalogue, with distances for 187 from Ranasinghe & Leahy (2023) |
| Dark nebulae | 1,907 | Barnard's 349 dark objects, plus the Lynds clouds Barnard didn't list; 442 at Gaia distances of their molecular clouds (Zucker et al. 2020) |
| Reflection nebulae | 158 | van den Bergh's catalogue |

**Galaxy Map:** the nebulae with measured distances sit at their true 3D positions, as glowing clouds at their true physical size: 945 HII regions, 790 planetary nebulae, 187 supernova remnants and 140 reflection nebulae. The HII regions trace the spiral arms.
- Colours are the light each kind really emits: HII regions glow pink-red in hydrogen-alpha, planetary nebulae teal in doubly ionised oxygen, and reflection nebulae blue from scattered starlight. Each cloud is a few overlapping puffs spread through its volume, so it has depth as you orbit it. Clouds too small to see from far away are drawn at a minimum size and dimmed to match.
- Nebulae show their **real photographs** from the Digitized Sky Survey where the plates capture them: the 55 named ones (Orion, Carina, Lagoon, Eagle, the Crab, the Helix, the Horsehead, ...) and about 200 more glowing nebulae, plus 419 dark clouds on the Sky tab. The red plate is shown in red, the blue plate in blue and the fainter of the two in green, so stars stay white and hydrogen glow stays red.
  - `node scripts/build-nebula-images.mjs` photographs every nebula with a distance that is at least 1.2′ in radius, then keeps only the fields where the plates show diffuse light.
  - Most HII regions were found by WISE in the infrared and are hidden behind dust in visible light; their photographs show only stars, so they keep their emission-colour clouds.
  - Phones load only the named nebulae's page (1 MB); desktops load all four pages (5 MB).
- **Nebulae become true volumes up close**, ray-marched on the GPU (`src/render/nebulaRaymarch.ts`). For every pixel, a ray steps through the gas, adding the light the gas emits and losing light to what it absorbs. Dust lanes darken what lies behind them, and the cloud has depth and parallax from every side.
  - **Photographed nebulae:** their photograph (with its stars removed) sets how much gas lies along each line of sight from Earth and what colour it is. The gas is spread in depth around a noise-warped mid-surface and broken into filaments by 3D noise, and dark lanes inside the nebula become absorbing dust. Their look from Earth is the real one; their depth is a model.
  - **The others, by type:**
    - HII regions: clumpy gas around a cavity blown by their stars, teal oxygen inside and red hydrogen-alpha outside, with dust lanes.
    - Planetary nebulae: ellipsoidal shells.
    - Supernova remnants: thin, filamentary shells.
    - Dark nebulae: absorbing dust, faintly lit.
    - Reflection nebulae: blue scattered light.
  - Only the nebulae near where you're looking become volumes: two at a time on desktops, one on phones, with fewer ray steps on phones.
- Dark nebulae dim the light behind them. 442 of them are placed at the distance of their molecular cloud, measured with Gaia by Zucker et al. 2020: for example the Horsehead in Orion B at 411 pc, the Pipe at 180 pc and Rho Ophiuchi at 139 pc.
- Planetary-nebula distances come from Gaia parallaxes of their central stars where those are good, and otherwise from statistical estimates.
- Some HII distances are kinematic estimates, which can be off in the outer Galaxy.
- The remnant catalogue puts the Crab Nebula at 3.4 kpc (−1.0/+4.0), from the Crab pulsar's Gaia DR2 parallax. The long-standing estimate is about 2 kpc.
- Reflection nebulae are placed at the distance of the star that lights them. That's 140 of the 158, mostly from Gaia parallaxes via SIMBAD.
- Dark nebulae have no distances in their own catalogues. A cloud takes the distance of the nearest Zucker et al. 2020 sightline within 1° of its edge; the rest (1,465) appear on the sky only.

**Sky tab:** every nebula is outlined at its real position and angular size, and fades out in daylight. The 55 named ones show their Digitized Sky Survey photographs on the sky, at their true size and orientation.

Famous nebulae are labelled: Orion, Lagoon, Eagle, Helix, Ring, Cat's Eye, the Crab, Cassiopeia A, the Veil, the Horsehead, the Pipe, the Iris and others. The names are matched to the catalogues through the SIMBAD astronomy database, not typed in by hand. The California, Crescent and Witch Head nebulae aren't in these catalogues, so they're left unlabelled. Toggle the layer with **Real nebulae** in the Galaxy Map panel, or **Nebulae** in the Sky tab.

### 326 light-years of real stars (Gaia)
Press **✨ 326 ly (Gaia)** for every star within 100 parsecs (326 light-years) brighter than Gaia magnitude 11: about 44,500 stars from ESA Gaia DR3.
- **Real positions and motions:** each star sits at its measured position and moves with its real velocity, from Gaia's proper motion plus its radial velocity. About 10% have no radial velocity, so they move only across the sky.
- **Real structure:** the Hyades show up as a clump 47 parsecs away.
- **Colours** come from Gaia's temperatures.
- **Names:** bright stars are named from HYG. The very brightest, like Sirius, Vega and Arcturus, are too bright for Gaia to measure, so they come from HYG too.
- **Speeding up time** shows the neighbourhood drifting apart over millions of years.

### Real star clusters
**7,193 real star clusters** from two catalogues:
- **Gaia census (Hunt & Reffert 2023):** 6,818 open clusters and 228 moving groups, each with its Gaia distance, size, number of member stars and age.
- **Harris catalogue:** 147 globular clusters, with distances, sizes and metal content.

**Galaxy Map:** they sit at their measured distances. Open clusters are gold and crowd around the Sun, where Gaia's census is most complete. Globular clusters are orange and scattered through the halo.

**Sky tab:** every cluster is outlined at its real size.

32 famous clusters are labelled, matched through SIMBAD by catalogue designation and position: the Pleiades, the Hyades, the Beehive, the Double Cluster, the Jewel Box, Omega Centauri, 47 Tucanae, M13 and others. Toggle them with **Real star clusters** in the Galaxy Map panel, or **Star clusters** in the Sky tab.

The 145 globular clusters with distances, and the open clusters with at least 300 Gaia members or a name, are also drawn as balls of stars at their measured sizes. Each is a Plummer sphere whose half-light radius is the catalogue's (Harris for globulars, Hunt & Reffert for open clusters), so flying to M13 or the Pleiades shows a cluster of stars rather than a dot. The stars are a representative sample: their number follows the cluster's brightness or membership, and their colours its age. They are not the cluster's real individual stars.

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
Pluto & Charon · Planet Formation · Giant Impact · Ring Maker · Binary Star ·
Figure-8 Three-Body · Rogue Star Flyby · Black Hole Feast · Supernova · The Sun's Future ·
Relativistic Precession · Black Hole Inspiral · Pulsar Planets (PSR B1257+12) · Hulse–Taylor Binary Pulsar · Galactic Core · Star Cluster Collapse ·
Self-Gravitating Disk · Galaxy Collision · Empty Space

### Phones and tablets
On a touch-screen phone or tablet, or a device with 4 or fewer CPU cores or 4 GB of memory or
less, the app starts with lighter graphics (low quality, bloom and lensing off) unless you've
chosen your own settings, and runs the orbit forecast every 2 s instead of every second. In
a phone emulation (390×844 screen, 4× slower CPU) this took the default Solar System from
about 2.5 to 17 frames per second. In the Sky tab, pinch to zoom.

## Real atmospheres

Planets with air scatter sunlight as real atmospheres do (`src/render/atmosphere.ts`): single
scattering computed per pixel, with molecules scattering blue (Rayleigh, ∝ λ⁻⁴) and haze or dust
scattering mostly forwards (Mie), and light dimmed on its way in and out. The coefficients and
scale heights are the real ones:
- **Earth:** Bruneton & Neyret 2008: a blue limb and sky, and red-orange light along the day–night line.
- **Mars:** thin CO₂ plus blue-absorbing dust: a pale butterscotch haze.
- **Venus:** thick sulphuric-acid haze: a featureless yellow-white veil, as in visible-light photos.
- **Titan:** orange tholin smog reaching 600 km.
- **The giant planets:** thin limbs.
- **Procedural worlds:** air picked from their climate.

Each atmosphere is drawn in its real proportion to the planet's radius (Earth's 100 km is 1.6%),
at least 2% so it stays visible.

## Auroras

Planets with a magnetic field and air glow around their magnetic poles (`src/render/aurora.ts`):
- **Shape:** curtains of light ride the auroral oval, with drifting rays and folds, and a diffuse
  glow beneath them. Each oval sits around the magnetic axis, which is tilted from the spin axis
  and turns with the planet.
- **Earth:** dipole tilt 9.4° (IGRF-14). The oval is at ~67° magnetic latitude on the night side
  and ~77° on the day side. The light is green oxygen at 557.7 nm (100–150 km, the brightest), red
  oxygen at 630.0 nm above 200 km, and a violet N₂⁺ lower edge.
- **Jupiter:** tilt 10.3° (Juno). Its main oval is held in place by the planet's rotation, not the
  solar wind.
- **Saturn:** aligned within 0.01°. **Uranus:** tilt 59°. **Neptune:** tilt 47°.
- The giants' auroras shine in ultraviolet and infrared. They are drawn in false colour, as in the
  Hubble and JWST images.
- Visible auroras fade on the day side, where sunlight swamps them.
- **Strength:** set by the stellar wind, which scales with (starting distance ÷ distance)². Push a
  planet towards its star and its auroras brighten and spread towards the equator, as in a
  geomagnetic storm.
- **No aurora:** Venus, Mars and the Moon have no global magnetic field.
- **Procedural worlds:** gas giants, and rocky worlds with air from 0.3 Earth masses up, get a
  modelled aurora.

## Planet formation

The **Planet Formation** scene grows a planetary system from a young star's disc
(`src/sim/planetFormation.ts`), following the core-accretion picture:
- **The disc:** 80 planetary embryos carry the solids of a disc six times the minimum-mass solar
  nebula (Hayashi 1981). Beyond the snow line at 2.7 AU ice freezes out, so there is about four
  times more solid material there. The snow line is drawn as a blue ring, and the gas disc as a
  warm glow.
- **Collisions:** embryos crash and merge into bigger bodies. Their isolation masses (Kokubo & Ida
  2002) range from about a Moon to a Mars inside the snow line, and several Earths beyond it.
- **Giants:** a core past ~10 Earth masses pulls in gas faster and faster (runaway accretion,
  Pollack et al. 1996). It stops when it opens a gap in the disc, about a Jupiter mass at 5 AU
  (Lin & Papaloizou 1993), or when the gas runs out.
- **Clearing:** after 3 million years (Haisch et al. 2001) the star blows the gas away, and what
  hasn't become a giant by then stays rocky or icy. The new giants often scatter the leftover
  embryos, and sometimes each other.
- **Speed:** bodies here are drawn and collide much larger than real ones, so growth runs about
  3,000× faster than in nature, and the gas clock is sped up to match.

## Land on planets

Select a rocky planet or moon and press **🛬 Land** to stand on its surface (`src/render/lander.ts`):
- **The sky is the planet's own atmosphere seen from inside:**
  - Earth: blue by day, red at sunset.
  - Mars: butterscotch.
  - The Moon: black, with stars even at noon.
- **The day passes for real:** the Sun rises and sets as the planet turns at its real rotation
  rate. Time runs at ten minutes a second while you're down, and the HUD shows the local time.
- **The ground uses the planet's real map:** you land in the Arabian desert's colours if that's
  where you are. Relief is added on top: hills on worlds with air, craters on airless ones.
- **By day the stars fade:** a lit sky drowns them; at night they come back.
- **Controls:** drag to look around, WASD to walk, and the wheel to zoom. Take off (or Esc)
  returns to orbit.
- Gas giants have no surface to stand on.
- The terrain's shape is a model; only its colours come from the real maps.

## Real stars around the Sun (Gaia)

The Galaxy Map shows 61,673 real stars around the Sun from ESA's Gaia DR3: every star brighter
than magnitude 8 whose parallax is measured to 20% or better.
- **Where and what:** each star sits at its measured distance (after Gaia's parallax zero-point),
  in its real colour, sized by its luminosity.
- **What you can see:** zoom in on "You are here" to find the real neighbourhood: the Pleiades and
  Hyades, the blue giants of Orion and Scorpius–Centaurus, and the Gould Belt. The procedural
  stars stand in for the billions Gaia can't show at this brightness.
- Turn them off with "Real stars (Gaia)" in the galaxy panel.

## Spinning black holes

Black holes have a spin, a* from 0 to 0.998, the most that gas can spin one up to (Thorne 1974).
It is set with a slider in the black hole's panel (`src/sim/kerr.ts`).
- **The horizon shrinks:** from 2 to about 1 GM/c².
- **The disc gets closer:** its inner edge, the innermost stable orbit, moves in from 6 to 1.24
  GM/c² (Bardeen, Press & Teukolsky 1972).
- **More energy comes out:** the disc turns 5.7% of the infalling mass into light without spin,
  and 32% at a* = 0.998.
- **The shadow changes shape:** seen from the side, it is flattened and pushed sideways, exactly
  as Bardeen (1973) calculated.
- **The accretion disc is shaded per pixel:**
  - Thin-disc temperatures.
  - The gas orbits at up to ~40% of light speed, so the side coming towards you is
    Doppler-boosted, bluer and brighter, and the other side is dimmed and reddened.
  - Gravitational redshift dims the inner edge.
  - The disc is drawn after the lensing, so its near side passes in front of the shadow.
- **Mergers leave spinning holes:** spin is worked out from the masses and spins (Rezzolla et al.
  2008). Two equal holes give 0.69; LIGO measured GW150914's remnant at 0.67.
- **Real values:** the galactic-core scene's hole spins at 0.94, as the Event Horizon Telescope's
  favoured Sgr A* models do.

## Realistic stars and planets

- **Star surfaces** (`src/render/starSurface.ts`) look as telescopes show them.
  - Stars cooler than ~7,000 K are tiled with convection cells (granulation) that slowly
    change, over larger supergranulation.
  - Red giants have only a handful of huge cells, as on Betelgeuse. Hot stars and white dwarfs
    are smooth.
  - The disc darkens and reddens towards its edge (limb darkening, per colour).
  - Sun-like stars have sunspots with filamentary penumbrae and bright faculae.
  - Close up, a faint corona surrounds the star.
- **Planets as photographed.** A planet where its star is overhead shows its map's true colour.
  - Jupiter's and Saturn's hazes absorb blue, so their limbs stay warm.
  - Gas giants without a real map get uneven belts and zones, turbulence sheared along them,
    spiralling storms, and quiet ice giants with methane streaks. Saturn has its north-polar
    hexagon.
- **Shadows and lights.**
  - Ringed planets shade their rings, and the rings band the planet with shadow.
  - Earth shows its city lights on the night side (NASA Black Marble).
  - The Sun glints off Earth's oceans.

## Neutron stars and pulsars

Zoom in on a neutron star and you see what its gravity and magnetism do (`src/sim/neutronStar.ts`,
`src/render/neutronStar.ts`):

- **Bent light.** Gravity bends its light so much that about three quarters of the surface shows
  at once, often both magnetic poles together (Beloborodov 2002).
- **Hot poles.** Heat flows along the magnetic field, so the magnetic poles glow brighter than the
  equator. The polar caps, where particles rain back down, are hottest.
- **Magnetic field and beams.** A dipole field is tilted from the spin axis.
  - Beams run along the magnetic axis, as wide as real radio beams (Rankin 1993), and sweep
    round like a lighthouse.
  - Each beam is drawn as glowing gas: a white core and a blue halo, blazing when you look down
    it. The star flashes when one crosses you.
  - Beyond the light cylinder the field can't keep up with the star and winds into a spiral (the
    striped wind), drawn as spiral streaks turning with the star.
- **Wind nebulae.** Young, powerful pulsars (the Crab, Vela and others above 10²⁹ W) sit in a
  glowing wind nebula.
  - It has a wispy torus in the spin equator, an inner ring of knots and jets along the spin
    axis: the pattern Chandra shows for both.
  - The side flowing towards you is brighter (Doppler boosting).
  - Like the wound field, it is drawn much closer to the star than to scale.
- **Real spin.** Known pulsars (the Crab, Vela, PSR J0437−4715, PSR B1257+12, the Hulse–Taylor
  pulsar) use their catalogued period and spin-down.
  - Other neutron stars, like those born in a supernova here, are typical newborn pulsars
    (Faucher-Giguère & Kaspi 2006).
  - Pulsars faster than 4 turns a second are slowed so the screen can show them.
- **Its panel** gives the period, magnetic field, age, temperature, spin-down power, light
  cylinder, density, gravity, escape speed and how much of the surface you can see.

- **Hear it.** 🔊 plays its radio pulses as sound, one click per turn, at the real spin rate.
  Slow pulsars tick, Vela buzzes, the Crab growls and millisecond pulsars hum a note.
- **Visit any of 3,632 real pulsars** from the Galaxy Map or search.
  - Click a pulsar for its catalogued period, field, age and companion. Enter opens it in the
    Sandbox spinning at its measured rate.
  - A binary pulsar brings its companion on the catalogued orbit: a white dwarf, a second neutron
    star (the Double Pulsar's companion is a pulsar too) or an evaporating star.
  - Tight binaries use real sizes.

Scenes:
- **Pulsar Planets** is PSR B1257+12, where the first planets beyond the Sun were found in 1992.
  Its three planets, Draugr, Poltergeist and Phobetor, sit on orbits from the pulsar's timing.
- **Hulse–Taylor Binary Pulsar** is PSR B1913+16 on its measured orbit (Weisberg & Huang 2016),
  at real sizes and with relativity at the real speed of light.
  - The periastron turns 4.2° a year.
  - Its panel shows the classic chart: the orbit's measured decay against general relativity's
    prediction (99.83 ± 0.16% of it), the first evidence for gravitational waves.
  - The two stars will merge in 300 million years (Peters 1964).

## More about a planet

Select a planet or moon and open **📖 More about** in its panel:
- **Measured physical values:** radius, surface gravity, escape velocity, mean density, rotation,
  axial tilt and albedo (JPL), or for exoplanets the NASA Exoplanet Archive's radius, equilibrium
  temperature and discovery year. Modelled worlds get their size from their mass, and say so.
- **Worked out from its orbit:** starlight received, equilibrium temperature, and Hill sphere.
- **Earth Similarity Index** (Schulze-Makuch et al. 2011): radius, density, escape velocity and
  temperature compared with Earth's. Earth scores 1, Mars ≈ 0.7 and Jupiter ≈ 0.3. The index
  measures likeness, not habitability.
- Links to Wikipedia, or to the NASA Exoplanet Archive for exoplanets.

## Places

Press **L** or 📍 to save the current viewpoint in any view and come back to it later:
- **Sandbox:** the scenario and the camera. When you're following a body, the camera is stored
  relative to it, in its radii, so the place still works after it has moved on its orbit or the
  real-size toggle has changed.
- **Galaxy Map and Universe:** the camera and its target.
- **Sky:** the date, your place on Earth and where you're looking.
- Each place can be renamed, deleted, or copied as a link (`#place=…`) that opens the same view
  for anyone.
- A few famous places are built in: Earth beyond the Moon, Saturn's rings from above, Jupiter and
  its moons, the Orion Nebula, the Pleiades, the Crab Nebula and the Andromeda Galaxy.

## Photo mode

Press **P** or 📷 (next to search) to hide the interface and frame a picture in any view:
- Sliders for exposure, contrast, colour and field of view.
- Labels can be shown or hidden. In the Sandbox, O and T hide orbits and trails.
- **Save picture** renders the view again at 1×, 2× or 4× the screen's resolution, within the
  GPU's limits and about 16 megapixels, and downloads it as a PNG.
- Esc or P leaves photo mode.

## Fly a spaceship

In the Sandbox, **🚀 Fly a spaceship** puts a ship in orbit around the selected body (or
Earth), three of its real radii up, and switches the scene to real sizes so the orbit is visible
outside the planet.
- **Engines:** a chemical rocket (1 g, 10 km/s of Δv), an ion drive like NASA's Dawn
  (0.08 mm/s², 11 km/s), or a hypothetical fusion torch (1 g, no fuel limit).
- **Flying:** hold Prograde, Retrograde, Out, In, Normal or Anti (or W/S, A/D, Q/E) to thrust; a
  throttle sets the power. Gravity from everything in the scene acts on the ship, and the panel
  shows its altitude, speed, orbit, period and fuel.
- **Autopilot:** flies into orbit around any body in the scene. It accelerates, turns, brakes,
  then circularises and lets go. It runs inside the physics step, so it can hold an orbit that lasts
  hours even when time runs at days per second. A 1 g torch flies from Earth to Mars in about two
  days; a chemical rocket runs out of fuel long before.
- Ships collide with a body's real surface, not its enlarged drawing.

## Travel at any speed

On the Galaxy Map and in the Universe tab, the 🚀 bar at the bottom sets a travel speed:
- Real speeds: walking, a car, an airliner, the Space Station, Voyager 1 (17 km/s), the Parker Solar Probe (192 km/s), the fastest known star (1,700 km/s).
- Fractions of light speed, up to 99.99%, and light speed itself.
- Faster than light, up to a billion light-years per second, labelled as not physically possible (shown as a camera speed).

Tick **Travel at this speed** and clicking a name, double-clicking a star or galaxy, or picking a
search result travels there at that speed instead of flying in a moment. **Cruise** travels
straight ahead. The trip plays in about 25 seconds, or in real time, or ×1,000 up to
×1 trillion. Two clocks show the trip: Earth time (the galaxy's frame) and your own time on
board, slower by the Lorentz factor γ. For example, Alpha Centauri at 99% of light takes 4.41
years of Earth time and 0.62 years on board.

**Near light speed you see what special relativity predicts** (`src/render/relativity.ts`):
- Aberration crowds the stars towards the direction of travel (cos θ′ = (cos θ + β)/(1 + β cos θ)).
- The Doppler shift turns the sky ahead blue and behind red, as a blackbody D = γ(1 + β cos θ) times hotter or cooler.
- Beaming brightens the light ahead. It is softened on screen so the colours stay visible.

## Search everything

The 🔍 button (or `/`, or Ctrl+K) searches about 28,000 things at once, and picking a result
takes you there:
- **Galaxy Map:** nebulae and star clusters with measured distances, black holes and pulsars.
- **Sky tab:** named stars, the Sun, the Moon and the planets, and nebulae or clusters without a distance.
- **Universe tab:** galaxies and galaxy clusters.
- **Sandbox:** exoplanet systems and their planets (the system loads), the bodies in the current
  scene, and scenarios, gravitational-wave events, asteroid flybys and Voyager encounters.
- **Also:** lessons and challenges start, and eclipses open in the Sky tab.

Matching ignores case, spaces, punctuation and accents, and knows catalogue names: "m42",
"ngc 7293", "LDN 1689", "trappist-1 e" and "car neb" all work. Famous objects rank first.

## Controls

| Input | Action |
| --- | --- |
| Drag / right-drag / scroll | Orbit / pan / zoom (in Spawn and Nudge modes, right-drag orbits) |
| Click / double-click | Select / select and follow (Sandbox); select / fly to (Galaxy) |
| 🔍, `/` or Ctrl+K | Search everything, then Enter or click to go there |
| Click a name label | Go there: follow the body or the Lagrange point (Sandbox), fly to it (Galaxy Map, Universe), turn and zoom to it (Sky) |
| `Space` | Pause / resume |
| Hold ⏩ (or `.`) / tap ⏩ | Fast-forward at 10× while held / double the speed |
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
- X-ray binaries: the Galactic HMXB catalogue (Fortin, García, Chaty & Coleiro 2023, A&A 671,
  A149; VizieR J/A+A/671/A149) with Gaia EDR3 distances (Bailer-Jones et al. 2021), and the
  Galactic LMXB catalogue (Fortin, Kalsi, García, Simaz-Bunzel & Chaty 2024, A&A 684, A124;
  VizieR J/A+A/684/A124). Wolf–Rayet stars: the VIIth Catalogue of Galactic Wolf–Rayet Stars
  (van der Hucht 2001, New Astron. Rev. 45, 135; VizieR III/215), photometric distances.
  Rebuild with `node scripts/build-galactic-objects.mjs`. Every one with a distance is on the
  Galaxy Map, and each opens in the Sandbox as its real pair; masses or periods the catalogue
  lacks take typical values, and the scene says so.
- Black holes and pulsars: positions from SIMBAD; masses and distances from the discovery papers,
  verified against their arXiv abstracts by `node scripts/build-compact-objects.mjs`.
- Pulsars: the ATNF Pulsar Catalogue v2.6.1 (Manchester, Hobbs, Teoh & Hobbs 2005, AJ 129, 1993;
  https://www.atnf.csiro.au/research/pulsar/psrcat/), rebuilt with
  `node scripts/build-pulsars.mjs`. The PSR B1257+12 planets' orbits come from its timing
  solution there (Konacki & Wolszczan 2003).
- Neutron stars: light bending from Beloborodov (2002), beam widths from Rankin (1993), the
  newborn-pulsar population from Faucher-Giguère & Kaspi (2006). The binary orbits of visited
  pulsars come from the ATNF catalogue too.
- Hulse–Taylor binary pulsar: Weisberg & Huang (2016, ApJ 829, 55); orbital decay from Peters &
  Mathews (1963) and the time to merge from Peters (1964).
- Saturn's ring gaps: the IAU ring nomenclature table in the USGS Gazetteer of Planetary
  Nomenclature (https://planetarynames.wr.usgs.gov/Page/Rings), rebuilt with
  `node scripts/build-saturn-rings.mjs`.
- Earth at night: NASA Earth Observatory "Black Marble 2016" (credits in
  `public/textures/CREDITS.md`).
- Io: the USGS Galileo SSI / Voyager colour-merged global mosaic (credits in
  `public/textures/CREDITS.md`).
- Cosmic microwave background: the NASA WMAP 9-year ILC map from LAMBDA (public domain),
  reprojected from HEALPix by `python3 -I scripts/build-cmb.py` (needs numpy and ImageMagick).
- Spacecraft trajectories: NASA/JPL Horizons, state vectors every 10 days (rebuild with
  `node scripts/build-spacecraft.mjs`).
- Nearby-star distances and motions: ESA **Gaia DR3** (Gaia Collaboration, Vallenari et al.
  2023), from the Gaia archive TAP service, cross-matched to HYG by `node scripts/build-stars.mjs`.
  This work has made use of data from the European Space Agency (ESA) mission Gaia, processed
  by the Gaia Data Processing and Analysis Consortium (DPAC).
- Halley's 2061 return: NASA/JPL Horizons (rebuild with `node scripts/build-halley.mjs`).
- Nebulae: the WISE Catalog of Galactic HII Regions (Anderson et al. 2014, ApJS 212, 1), the
  Strasbourg-ESO Catalogue of Galactic Planetary Nebulae (Acker et al. 1992), Gaia EDR3 distances
  of planetary-nebula central stars (Gonzalez-Santamaria et al. 2021, A&A 656, A51), statistical
  distances (Stanghellini & Haywood 2010, ApJ 714, 1096), Green's catalogue of Galactic
  supernova remnants (Green 2019) with distances from Ranasinghe & Leahy (2023, ApJS 265, 53),
  Lynds' Catalogue of Dark Nebulae (1962), Barnard's dark objects (1927) with molecular-cloud
  distances from Zucker et al. (2020, A&A 633, A51), and van den Bergh's
  reflection nebulae (1966), via VizieR (CDS), placed at the distances of their illuminating stars
  (parallaxes from SIMBAD's TAP service, mostly Gaia EDR3). Familiar names resolved with SIMBAD (rebuild
  with `node scripts/build-nebulae.mjs`).
- Nebula photographs: the Digitized Sky Survey, produced at the Space Telescope Science Institute
  under U.S. Government grant NAG W-2166, from photographic data of the Oschin Schmidt Telescope
  (Palomar) and the UK Schmidt Telescope (POSS-I, POSS-II, SERC surveys), retrieved through NASA's
  SkyView (rebuild with `node scripts/build-nebula-images.mjs`).
- Stars within 100 pc: ESA Gaia DR3 via the Gaia archive (rebuild with `node scripts/build-stars-100pc.mjs`),
  with names and the brightest stars from HYG v4.1.
- Real stars on the Galaxy Map: every star brighter than G = 8 with a parallax good to 20% (61,673
  stars), ESA Gaia DR3 (Gaia Collaboration, Vallenari et al. 2023) via the Gaia archive, with the
  Lindegren et al. (2021) parallax zero-point (rebuild with `node scripts/build-gaia-bright.mjs`).
- Star clusters: Hunt & Reffert 2023 ("Improving the open cluster census. II.", A&A 673, A114),
  based on ESA Gaia DR3, and the Harris catalogue of Milky Way globular clusters (VII/202), via
  VizieR (CDS); familiar names resolved with SIMBAD (rebuild with `node scripts/build-clusters.mjs`).
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
  ("fingers of God"). Cluster labels use approximate published positions. Each galaxy's
  position angle on the sky comes from **HyperLEDA** (Paturel et al. 2003, A&A 412, 45;
  VizieR VII/237), matched by position; the Universe view draws galaxies at that angle and
  the catalogue's inclination. Every 2MRS galaxy with a catalogue name (NGC, IC, UGC, ESO,
  MCG, Markarian…) is a named, clickable entry; the NGC/IC ones take their position angles,
  optical axis ratios and common names from **OpenNGC** (Mattia Verga,
  https://github.com/mattiaverga/OpenNGC, **CC BY-SA 4.0**).
- Deep universe (`node scripts/build-deep-universe.mjs`): rich galaxy clusters from the
  **Abell catalogue** (Abell, Corwin & Olowin 1989, ApJS 70, 1; VizieR VII/110A) with the
  redshifts of Struble & Rood (1987); quasars from the **Véron-Cetty & Véron** catalogue, 13th
  edition (2010, A&A 518, A10; VizieR VII/258), the brightest and every one beyond redshift 5;
  and record holders (JADES-GS-z14-0, GN-z11, J0313−1806, ULAS J1120+0641, TON 618, 3C 273)
  entered by hand from the papers cited in `public/data/universe-objects.json`. They sit at the
  comoving distance for their redshift in a flat ΛCDM cosmology (H0 = 70 km/s/Mpc, Ωm = 0.3;
  `src/sim/cosmology.ts`). Supercluster, wall and void labels use approximate published
  positions.
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
  app.ts      the orchestrator: simulation, views, frame loop, scenarios, history, selection
  app/        one controller per feature (places, photo, landing, VR, sky, travel, ship,
              search, body panel, galaxy map, lessons, input wiring…)
server/       companion server (gallery, multiplayer, scene builder)
scripts/      data build scripts
tests/        vitest suites
```

The physics core (`src/sim`) has no rendering dependencies, so it runs headlessly in tests and
in the Web Worker.
