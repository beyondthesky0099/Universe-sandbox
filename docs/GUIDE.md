# Astrarium user guide

Astrarium is a universe sandbox that runs in your browser or as a Windows app. You can fly from
the edge of the observable universe down to a single star system, visit thousands of real
objects at their measured positions, and then experiment: fling planets, collide stars, set off
supernovae, or watch two black holes spiral together.

This guide explains how to use it. For the full list of data sources and the physics behind
each feature, see the [README](../README.md). For working on the code, see
[DEVELOPER.md](DEVELOPER.md).

**Contents**
1. [Getting started](#1-getting-started)
2. [The screen](#2-the-screen)
3. [The four views](#3-the-four-views)
4. [Things to try](#4-things-to-try)
5. [The real universe inside Astrarium](#5-the-real-universe-inside-astrarium)
6. [What the Sandbox simulates](#6-what-the-sandbox-simulates)
7. [Tools](#7-tools)
8. [Controls](#8-controls)
9. [Settings and performance](#9-settings-and-performance)
10. [How accurate is it?](#10-how-accurate-is-it)
11. [Troubleshooting and questions](#11-troubleshooting-and-questions)
12. [Glossary](#12-glossary)

---

## 1. Getting started

### In a browser
Open **https://beyondthesky0099.github.io/Universe-sandbox/**. Nothing to install. A recent
Chrome, Edge, Firefox or Safari works; Chrome and Edge are fastest. The first visit downloads
about 20 MB of real data, which the browser then keeps.

### On Windows
Download the installer (`Astrarium-Setup-<version>-x64.exe`) or the portable version
(`Astrarium-Portable-<version>-x64.exe`, no installation) from the
[Releases page](https://github.com/beyondthesky0099/Universe-sandbox/releases). Laptops with a
Snapdragon (ARM) chip take the `-arm64` files.

The files aren't code-signed, so the first time Windows SmartScreen may warn about an unknown
publisher: choose **More info → Run anyway**.

The desktop app is the same program with extras:
- it uses the laptop's dedicated graphics chip and starts at the highest quality;
- it keeps running at full speed in the background;
- it spreads the physics over all your CPU cores;
- it works offline;
- it runs its own server, so the gallery and multiplayer work with no setup.

Press **F11** for full screen.

### Your first five minutes
1. Astrarium opens on the **Solar System today**, in the **Sandbox** view. Drag to turn the
   view, scroll to zoom.
2. Click a planet to select it. Its facts appear on the right. Double-click to follow it.
3. Press **Space** to pause, and use the speed slider at the bottom to run time faster.
4. Click **Galaxy Map** at the top. You're now looking at the Milky Way; "You are here" marks
   the Sun. Scroll out, then click a star and press **Enter** to visit it.
5. Keep scrolling out of the galaxy and you reach the **Universe** view: thousands of real
   galaxies.
6. Press **?** at any time for the built-in tutorial.

### Phones and tablets
Astrarium works on phones. It starts with lighter graphics (lower quality, no bloom or lensing)
so it stays smooth. The panel rail becomes a tab bar at the bottom and panels open as sheets.
Pinch to zoom.

---

## 2. The screen

- **Top bar**
  - Left: 🔍 search, 📍 Places, 📷 photo mode.
  - Middle: the four views, **Universe**, **Galaxy Map**, **Sandbox** and **Sky**.
  - Right: 🥽 VR (only when a headset is connected) and the **⋯ menu**, which holds lessons,
    challenges, the live graph, multiplayer, the gallery, the scripting console, sound and the
    tutorial.
- **Icon rail (left):** each view's panel is split into panes; click an icon to open one. Click
  the open pane's icon again to hide the panel and use the whole screen. In the Sandbox the
  panes are Scenes, Create, Real data, Events, Physics, Display, Save & share and Settings.
- **Dock (bottom, Sandbox only):** rewind, play and fast-forward; the clock; the speed slider;
  record and undo; the **Select**, **Add** and **Nudge** tools; and switches for trails, orbits,
  labels and habitable zones.
- **Inspector (right):** the selected object's facts and actions. ✕ closes it.

Labels on the maps never pile up: where they'd overlap, the important ones stay and the rest
fade until you zoom in.

---

## 3. The four views

### Universe
The largest scale: the Milky Way's neighbourhood out to the edge of the observable universe.
- **The Local Volume:** 869 real galaxies out to 85 million light-years, each at its measured
  distance, size and tilt.
- **The cosmic web:** 38,000 galaxies from the 2MASS Redshift Survey, with the famous clusters
  labelled (Virgo, Fornax, Coma, the Great Attractor…).
- **Galaxy clusters, quasars, Seyfert galaxies and blazars**, out to the most distant galaxy
  known, each at the distance its redshift implies.
- **Radio lobes:** tick *Radio lobes* to see the giant jets' lobes of 38 radio galaxies (Cygnus A,
  Centaurus A, M87…) as real radio-survey pictures, at their true size.
- **The cosmic microwave background** on a sphere 45 billion light-years away, just inside the
  edge of the observable universe (46 billion). Zoom all the way
  out to see the whole observable universe from outside.

Click a galaxy for its facts. **Visit galaxy** flies into it (the Milky Way is modelled on its
real structure; other galaxies are procedural stand-ins shaped like the real one). Galaxies with
an active nucleus have **Visit the nucleus**: a to-scale model of the black hole, its disc, the
clouds around it, the dusty torus and the jets. NGC 4258 (M106) shows its real warped disc,
mapped by water masers.

### Galaxy Map
The Milky Way, built on its real structure: the Sun 26,700 light-years from the centre, four
spiral arms, the bar, and Sgr A*. On top of it sits real data:
- **61,673 real stars** around the Sun (Gaia DR3) and 7,193 star clusters;
- **5,676 nebulae**, drawn as glowing clouds at their real size, with real photographs for the
  bright ones; up close they become 3D volumes;
- **3,632 pulsars**, black holes, X-ray binaries, Wolf–Rayet stars, novae, cataclysmic
  variables, Cepheids and masers.

Click anything to select it, double-click (or click its name) to fly there, and zoom in or press
**Enter** to open it in the Sandbox. The 30,000 procedural star systems can all be visited too;
each one is generated the same way every time.

### Sandbox
Where the physics happens: a live simulation of whatever you've loaded, from planets around a
star to colliding galaxies. You can add, push and delete bodies, change time, and watch what
gravity does. The **Scenes** pane lists the built-in scenarios and loads the Solar System on any
date; **Real data** loads exoplanet systems, the nearby stars and Halley's return; **Events**
replays gravitational-wave mergers, asteroid flybys and Voyager's encounters; **Create** adds
bodies, builds scenes with Claude, launches a spaceship or the GPU mega-sim.

### Sky
The real sky from anywhere on Earth at any date: the Sun, the Moon with its phase, the planets,
8,900 stars, clusters and nebulae, with twilight colours. Pick a city or type a latitude and
longitude, then run time. The **eclipses** list has the 18 solar eclipses of 2024–2035: press
**Watch** to stand in the path of totality.

On a phone or tablet, **📱 Point at the sky** makes the view follow the phone: hold it up and the
screen shows what is in that part of the sky, now, from where you are. If the stars are a little
off (the compass is easily disturbed by metal nearby), drag sideways to line them up. Press
**✋ Stop pointing** to look around by dragging again.

---

## 4. Things to try

Each takes a minute or two. Use 🔍 search to find the names.

**In the Solar System**
- **Visit Saturn** and zoom in on the rings: 6,000 particles at NASA's measured radii.
- **Pick 1989** in the date box (Scenes pane) and press **Solar System** to find Voyager 2 at
  Neptune, or **2015** for New Horizons at Pluto.
- **Watch Apophis** pass inside the ring of geostationary satellites on 13 April 2029
  (Events pane → **Watch flyby**).
- **Ride with Voyager** past Jupiter, Saturn, Uranus and Neptune (Events pane → **Fly with Voyager**).
- **Land on Mars** (select Mars → 🛬 Land) and watch the Sun set in a butterscotch sky.
- **See Halley's return** in 2061 (Real data pane → ☄️ Halley 2061).
- **Fly a spaceship** to Mars (select Earth, then Create pane → 🚀 Fly a spaceship, and set the
  autopilot to Mars).
- **Turn on Real sizes** (Physics pane) to see how empty the Solar System really is.

**Break things**
- **Giant Impact:** a Mars-sized body hits the young Earth.
- **Ring Maker:** a moon strays inside the Roche limit and is torn into a ring.
- **Rogue Star Flyby:** a passing star scatters the planets.
- **The Sun's Future:** the Sun swells into a red giant and becomes a white dwarf.
- **Supernova Zoo:** six stars explode in six different ways.
- Select any star and drag its **metallicity** slider to see how it will die.

**Stars and their remains**
- **A pulsar:** search "Crab pulsar", visit it, and press 🔊 to hear it spin 30 times a second.
- **A black hole:** search "Gaia BH1", the nearest known black hole; or "Cygnus X-1", which eats
  its companion's wind.
- **A dwarf nova:** search "SS Cyg". Gas flows from the red dwarf into a disc; speed up time to
  about a day per second and watch the disc flare in an outburst. Open the live graph (📈) and
  choose **Brightness** to see the light curve.
- **An eclipse in a binary:** search "Z Cha" or "DQ Her" and watch the brightness dip once an
  orbit as the donor star passes in front of the disc.
- **A nova:** search "DQ Her": the scene replays its 1934 eruption and the shell flies out.
- **A gravitational-wave event:** Events pane → pick GW150914 → **Replay merger**, then
  **🔊 Hear the chirp**.
- **The Hulse–Taylor binary pulsar:** its orbit decays exactly as general relativity predicts.

**The galaxy and beyond**
- **Fly to the Orion Nebula** and go inside it.
- **Find the Pleiades** on the Galaxy Map: a ball of real stars at its measured distance.
- **Travel to Alpha Centauri at 99% of light speed** (the 🚀 bar at the bottom of the Galaxy
  Map): 4.41 years pass on Earth, 0.62 on board, and the sky ahead turns blue.
- **Milky Way meets Andromeda:** the coming collision, about 4 billion years from now.
- **Cygnus A's radio lobes:** in the Universe view, tick Radio lobes and search "Cygnus A".
- **The edge of everything:** in the Universe view, keep zooming out past the microwave background.

**Learn and play**
- **Lessons** (⋯ → 📚): Kepler's laws, escape velocity, resonance, tides, Lagrange points,
  gravity assists, the habitable zone and Einstein's gravity. Each checks your answer.
- **Challenges** (⋯ → 🏆): limited nudges to save the Earth, park in a Trojan point or feed a
  black hole. Fewer, smaller nudges earn more stars.
- **Daily puzzle:** the same comet-hits-planet puzzle for everyone each day.

---

## 5. The real universe inside Astrarium

| What | How many | Where to find it | Source |
| --- | --- | --- | --- |
| Planets, moons, dwarf planets, comets | all major bodies, 28 moons | Sandbox | JPL Horizons |
| Asteroids, Trojans, Kuiper belt objects | 4,000 | Solar System scenes | JPL Small-Body Database |
| Spacecraft | 16 missions | Solar System on their dates | JPL Horizons |
| Exoplanet systems | 4,847 systems, 6,451 planets | Real data pane → Exoplanets; Galaxy Map | NASA Exoplanet Archive |
| Stars near the Sun | 319 within 33 ly; 44,500 within 326 ly; 61,673 bright | Real data; Galaxy Map | HYG, Gaia DR3 |
| Star clusters | 7,193 | Galaxy Map, Sky | Hunt & Reffert 2023, Harris |
| Nebulae | 5,676 | Galaxy Map, Sky | several catalogues; DSS photographs |
| Pulsars | 3,632 | Galaxy Map | ATNF Pulsar Catalogue |
| Black holes, X-ray binaries, Wolf–Rayet stars, novae, cataclysmic variables, Cepheids, masers | thousands | Galaxy Map | discovery papers and catalogues |
| Gravitational-wave events | 11 | Events pane | LIGO/Virgo/KAGRA |
| Galaxies | 869 nearby + 38,000 in the cosmic web | Universe | Karachentsev et al.; 2MASS Redshift Survey |
| Quasars and active galaxies | thousands | Universe | Véron-Cetty & Véron |
| Radio lobes | 38 radio galaxies | Universe | NVSS, SUMSS, GLEAM, WENSS |
| Cosmic microwave background | the whole sky | Universe | WMAP 9-year |
| Night sky | 8,920 naked-eye stars | Sandbox background, Sky | HYG |
| Eclipses | 18 (2024–2035) | Sky | JPL Horizons, checked against NASA |

When a value isn't measured, Astrarium uses a typical one and the panel or scene description
says so ("Not measured, so typical values are shown for…").

---

## 6. What the Sandbox simulates

**Gravity.** Every body pulls on every other. Large scenes use the Barnes–Hut method so tens of
thousands of bodies stay fast. Asteroids, debris and gas are "test particles": they feel gravity
but don't pull back.

**Sizes.** Normally bodies are drawn bigger than life so you can see them. Tick **Real sizes** for
true radii; collisions then happen only at real contact.

**Collisions.** Slow impacts merge; fast rocky impacts shatter into fragments. A body that comes
inside another's Roche limit is torn apart by tides.

**Relativity.** Orbits precess as Einstein predicts, spinning black holes drag orbits around
(frame dragging), and tight pairs lose energy to gravitational waves, spiral in and merge. A
slider lowers the speed of light to make the effects show in seconds.

**Stars live and die.** Stars age, swell into giants, and end as white dwarfs, neutron stars or
black holes. Supernovae follow the star's mass and metallicity, with real light curves and
expanding debris.

**Black holes.** Each has a spin that changes its horizon, its disc and the shape of its shadow.
With lensing on, the disc is ray-traced around the hole.

**Neutron stars.** Light bending shows most of the surface at once, the magnetic poles glow, and
radio beams sweep around at the pulsar's real spin rate.

**Close binaries.** In novae, cataclysmic variables and X-ray binaries:
- the donor star fills its Roche lobe and gas streams through the inner Lagrange point into a disc;
- polars channel the gas along magnetic field lines;
- supergiants feed their compact companion with a wind, and Be stars with a disc of gas;
- dwarf novae flare every few weeks, novae replay their eruption, and eclipsing systems dip once
  an orbit. The scene's description gives the transfer rate and what drives it.

**Planets.** Real atmospheres scatter light (blue skies, butterscotch Mars), auroras glow around
magnetic poles, and climate sets each world's colours. The **Planet Formation** scene grows
planets from a disc of embryos.

---

## 7. Tools

**Search (🔍, `/` or Ctrl+K).** Searches about 28,000 objects at once: stars, nebulae, clusters,
galaxies, pulsars, exoplanets, scenarios, lessons, eclipses. Catalogue names work ("m42",
"ngc 7293"), and so do kinds of object ("pulsars", "black holes", "agn", "novae", "masers").

**Places (📍 or L).** Save the current view and come back later. Places can be renamed, deleted,
or copied as a link that opens the same view for anyone.

**Photo mode (📷 or P).** Hides the interface, adds sliders for exposure, contrast, colour and
field of view, and saves a PNG at up to 4× the screen's resolution.

**Live graph (📈 or G).** Plots distance, speed, eccentricity, periapsis direction, total energy,
or (for close binaries) brightness, while the simulation runs. **Pin run** keeps a curve to
compare with the next.

**Replays and video.** ● records; you can then scrub, change speed, and save or open replay
files. 🎥 records the screen as a WebM video.

**Save, share and embed** (Save & share pane). Scenes compress into a link anyone can open.
**Embed** gives an `<iframe>` for web pages.

**Scripting console (`` ` ``).** JavaScript with an `api` object: add bodies, push them, run code
every frame, or write your own force laws. Save scripts as plugins that load with the app.
**API help** lists everything.

**Travel.** On the Galaxy Map and Universe views, the 🚀 bar sets a speed from walking pace to
faster than light. Near light speed the sky shows aberration and Doppler colours, and two clocks
show Earth time and your time on board.

**Spaceship.** 🚀 Fly a spaceship (Create pane) puts a ship in orbit around the selected body,
with a chemical, ion or fusion engine and an autopilot.

**Landing.** 🛬 Land puts you on the surface of a rocky planet or moon. Walk with WASD; Esc takes
off.

**Gallery, multiplayer and Create with Claude.** 🌐 publishes scenes and browses other people's;
👥 shares a room code to edit the same universe together. "Create with Claude" builds a scene
from a sentence. These need a companion server: the desktop app has one built in; on the web,
point the app at one in the 🌐 or 👥 panel.

**VR.** With a WebXR headset connected, 🥽 enters VR: a tabletop in the Sandbox, free flight on
the maps.

---

## 8. Controls

| Input | Action |
| --- | --- |
| Drag / right-drag / scroll | Turn / pan / zoom |
| Click / double-click | Select / select and follow (Sandbox); select / fly to (maps) |
| Click a name label | Go there |
| 🔍, `/` or Ctrl+K | Search |
| `Space` | Pause or resume |
| Hold ⏩ (or `.`) / tap ⏩ | Fast-forward 10× while held / double the speed |
| Hold `R` (or ⏪) | Rewind |
| `[` / `]` | Slower / faster |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `V` / `B` / `N` | Select / Add / Nudge tool (on the Galaxy Map, `B` bookmarks) |
| `F` | Follow the selected body |
| `Del` | Delete the selected body |
| `H` / `O` / `T` | Habitable zones / orbit path / trails |
| `G` | Live graph |
| `L` | Places |
| `P` | Photo mode |
| `M` | Switch between Galaxy Map and Sandbox |
| `Enter` | Visit the selected star or object |
| `` ` `` | Scripting console |
| `?` | Tutorial |
| `Esc` | Cancel, unfollow, deselect |

**Adding and nudging bodies.** With **Add** (`B`), click to place a body; drag to give it a
velocity. With **Nudge** (`N`), press on a body and drag; a dashed line previews the new path.

**Address options.** Add these after `#` in the address, joined with `&`:

| Option | Effect |
| --- | --- |
| `preset=<id>` | Start with a scenario (`solar`, `inspiral`, `rings`, `impact`, `supernova`, `galaxies`…) |
| `galaxy=<seed>` | Open a particular galaxy |
| `room=<CODE>` | Join a multiplayer room |
| `server=<url>` | Use this companion server |
| `embed=1` | Minimal interface, for iframes |
| `tour=0` | Skip the first-run tutorial |
| `worker=0` / `threads=0` | Physics on the main thread / on one core |

---

## 9. Settings and performance

- **Quality:** Low, Medium, High (and Ultra in the desktop app). Lower quality means smaller
  textures and fewer bodies in full detail.
- **Keep it smooth** (on by default) lowers the render resolution when the frame rate drops and
  raises it again when there is room.
- **Bloom and lensing** can be turned off for speed.
- **Many bodies:** scenes with thousands of bodies (galaxy collisions, clusters) are the
  heaviest. The desktop app spreads them over your CPU cores.
- **GPU mega-sim:** with WebGPU (recent Chrome or Edge), the Create pane offers 8,000–32,000
  bodies computed on the graphics card.
- **Laptops with two graphics chips:** the desktop app asks for the fast one; Settings shows
  which chip is drawing.

---

## 10. How accurate is it?

Astrarium separates three kinds of thing, and says which is which:

- **Measured.** Positions, distances, masses, orbits, spin periods and the like come from
  catalogues and space missions. Many are checked by automated tests against JPL Horizons and
  published values: planet positions agree within 0.01 AU, the Moon within half an arcminute,
  Apophis's 2029 pass within 2%, eclipse times within a second.
- **Calculated.** Physics worked out from the measured values: orbits, tides, collisions, Roche
  lobes, disc temperatures, transfer rates, supernova light curves, gravitational waves.
- **Illustrative.** Things no one has measured, shown so the scene makes sense: the procedural
  galaxies and star systems, spiral-arm patterns inside other galaxies, a nebula's depth, a
  galaxy nucleus's torus shape. Panels and scene descriptions flag these.

Simplifications worth knowing:
- Bodies are drawn larger than life unless **Real sizes** is on.
- Relativity is approximate: right in kind and size for precession and inspirals, not to the
  precision of real observations.
- Stars evolve by simple rules, not full stellar models.
- Black-hole lensing of the background stars is a screen-space effect; the disc around the hole
  is ray-traced.
- Close-binary light curves treat each part as a simple glowing body, so eclipses come out a
  little deeper than observed.

---

## 11. Troubleshooting and questions

**It's slow.** Lower the quality in Settings, turn off bloom and lensing, or close other tabs.
On a laptop, plug it in. The desktop app is faster than a browser tab.

**The screen is black or the 3D view doesn't appear.** The browser may have WebGL turned off or
blocked for your graphics chip. Update the browser and graphics drivers, or try the desktop app.

**The gallery, multiplayer or "Create with Claude" say there's no server.** On the website these
need a companion server; set one in the 🌐 or 👥 panel. The desktop app has one built in. Create
with Claude also needs the server to have an Anthropic API key.

**Windows says the app is from an unknown publisher.** The files aren't code-signed. Choose
**More info → Run anyway**.

**Point at the sky: the stars don't match the real ones.** Drag sideways until a star you know
lines up; the compass is often a few degrees off, more near metal or with a magnetic case. On an
iPhone, allow motion access when asked (or in Settings → Safari → Motion & Orientation Access).

**"Use my location" doesn't work in the desktop app.** Type your latitude and longitude instead.

**My scene went wrong.** Press **Ctrl+Z** to undo, or hold **R** to rewind.

**Why do the planets look so big?** So they're visible. Tick **Real sizes** to see true radii.

**Is the galaxy I visited real?** The Milky Way's structure is modelled on the real one, with
real stars, clusters and nebulae around the Sun. Other galaxies are procedural stand-ins shaped
like the real galaxy; the Universe view's galaxies themselves are real.

**Can I use it in a class or on a website?** Yes: share links open the same scene, and **Embed**
gives an iframe with a minimal interface.

---

## 12. Glossary

- **AU (astronomical unit):** the Earth–Sun distance, 150 million km. The Sandbox measures in AU,
  solar masses and years.
- **Accretion disc:** gas spiralling onto a star or black hole, heated until it glows.
- **Barnes–Hut:** a method that groups distant bodies so gravity for many bodies stays fast.
- **Cataclysmic variable:** a white dwarf pulling gas from a close companion star.
- **Dwarf nova:** a cataclysmic variable whose disc flares every few weeks.
- **Eclipsing binary:** a pair whose orbit we see edge-on, so one star passes in front of the other.
- **Exoplanet:** a planet around another star.
- **Gravitational waves:** ripples in spacetime from accelerating masses, such as merging black
  holes.
- **Habitable zone:** the distances from a star where water could be liquid on a planet's surface.
- **Lagrange points:** five places where a small body can keep station with two large ones.
- **Lensing:** gravity bending light, so stars behind a black hole appear distorted.
- **Light-year / parsec:** the distance light travels in a year; a parsec is 3.26 light-years.
- **Nova:** a thermonuclear flash on a white dwarf's surface; the star survives.
- **Pulsar:** a spinning neutron star whose beams sweep past us like a lighthouse.
- **Redshift:** light stretched by the universe's expansion; it gives distant galaxies' distances.
- **Roche lobe / Roche limit:** the region a star's gravity controls in a binary; the distance
  inside which tides tear a body apart.
- **Supernova:** the explosion of a massive star, or of a white dwarf pushed past 1.4 solar masses.
- **True scale / Real sizes:** bodies at their real radii instead of enlarged.
