import type { StarSystemSpec } from '../procgen/starSystem';
import type { Body } from './body';
import { kelvinToRgb, starColor } from './color';
import { keplerToState, OrbitalElements } from './orbits';
import type { Simulation } from './simulation';
import { EARTH_MASS, G, JUPITER_MASS } from './units';
import { julianDate, planetStates, type PlanetName } from './ephemeris';
import { setTrueScale } from './trueScale';
import { SPACECRAFT_COLOR, spacecraftState } from './spacecraft';
import { loadMilkyWayAndromeda } from './localGroup';
import { getSolarData, KM_PER_AU, poleScene, realRadiusAu, REAL_COLORS, relativeState, sampleRingRadii, smallBodyState, toScene, type SolarData } from './solarSystemData';

export interface SceneSetup {
  /** Suggested camera distance from the origin (AU). */
  cameraDistance: number;
  /** Suggested simulation speed (years per real second). */
  timeScale: number;
  /** Optional camera elevation angle (rad above the ecliptic). */
  elevation?: number;
  /** Name of a body to select and follow after loading (at `cameraDistance` from it). */
  focus?: string;
  /** Short tip shown after loading. */
  tip?: string;
  /** Fastest simulation speed the slider allows (time units per second; default 100). */
  maxTimeScale?: number;
  /** Direction from the target to the camera (scene axes), overriding `elevation`. */
  viewFrom?: [number, number, number];
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  load(sim: Simulation): SceneSetup;
}

/** Add a body on a Keplerian orbit around `parent`. */
export function addOrbiting(
  sim: Simulation,
  parent: Body,
  init: { name: string; mass: number; color?: number; kind?: Body['kind']; tag?: string; fuel?: number; age?: number },
  el: OrbitalElements,
): Body {
  const { pos, vel } = keplerToState(G * sim.gravityScale * (parent.mass + init.mass), el);
  return sim.addBody({
    ...init,
    x: parent.x + pos.x,
    y: parent.y + pos.y,
    z: parent.z + pos.z,
    vx: parent.vx + vel.x,
    vy: parent.vy + vel.y,
    vz: parent.vz + vel.z,
  });
}

/** Ring of massless particles on near-circular orbits around `parent`. */
export function addParticleDisk(
  sim: Simulation,
  parent: Body,
  opts: { count: number; inner: number; outer: number; thickness?: number; color: [number, number, number]; tilt?: number; jitter?: number },
): void {
  const { count, inner, outer, thickness = 0.02, color, tilt = 0, jitter = 0.15 } = opts;
  const mu = G * sim.gravityScale * parent.mass;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(inner * inner + Math.random() * (outer * outer - inner * inner));
    const th = Math.random() * Math.PI * 2;
    const h = (Math.random() - 0.5) * 2 * thickness * r;
    const v = Math.sqrt(mu / r) * (1 + (Math.random() - 0.5) * 0.04);
    // Local frame: disk in XZ, prograde about +Y.
    const x = Math.cos(th) * r;
    let y = h;
    let z = Math.sin(th) * r;
    const vx = Math.sin(th) * v;
    let vy = 0;
    let vz = -Math.cos(th) * v;
    // Tilt about the X axis.
    [y, z] = [y * ct - z * st, y * st + z * ct];
    [vy, vz] = [vy * ct - vz * st, vy * st + vz * ct];
    const shade = 1 - jitter + Math.random() * jitter * 2;
    sim.particles.add(
      parent.x + x,
      parent.y + y,
      parent.z + z,
      parent.vx + vx,
      parent.vy + vy,
      parent.vz + vz,
      [Math.min(1, color[0] * shade), Math.min(1, color[1] * shade), Math.min(1, color[2] * shade)],
    );
  }
}

const deg = Math.PI / 180;

/** name, mass (M⊕), a (AU), e, inc (deg), colour, kind */
/** Display colour and kind of a planet (for scenes that add one on its own). */
export function planetAppearance(name: string): { color: number; kind: Body['kind'] } {
  const p = SOLAR_PLANETS.find((x) => x[0] === name);
  return { color: p?.[5] ?? REAL_COLORS[name] ?? 0x9a9088, kind: p?.[6] ?? 'rocky' };
}

const SOLAR_PLANETS: [string, number, number, number, number, number, Body['kind']][] = [
  // name, mass (M⊕), a (AU), e, inc (deg), color
  ['Mercury', 0.055, 0.387, 0.206, 7.0, 0x9a8f86, 'rocky'],
  ['Venus', 0.815, 0.723, 0.007, 3.4, 0xe3c58a, 'rocky'],
  ['Earth', 1.0, 1.0, 0.017, 0.0, 0x3f78c8, 'rocky'],
  ['Mars', 0.107, 1.524, 0.093, 1.85, 0xc1440e, 'rocky'],
  ['Jupiter', 317.8, 5.203, 0.049, 1.3, 0xd8b48a, 'gas'],
  ['Saturn', 95.2, 9.537, 0.054, 2.5, 0xe3d2a8, 'gas'],
  ['Uranus', 14.5, 19.19, 0.047, 0.8, 0x9fd6e0, 'gas'],
  ['Neptune', 17.1, 30.07, 0.009, 1.8, 0x4b70dd, 'gas'],
];


const solarSystem: Preset = {
  id: 'solar',
  name: 'Solar System (today)',
  description:
    'The real Solar System today: planets (JPL ephemerides), Pluto and the dwarf planets, large asteroids, famous comets, and the 4,000 brightest real asteroids, Trojans and Kuiper belt objects (JPL Small-Body Database).',
  load(sim) {
    const setup = loadSolarSystemOnDate(sim, new Date());
    return { ...setup, timeScale: 0.25, elevation: 0.6, tip: undefined };
  },
};

const binaryStar: Preset = {
  id: 'binary',
  name: 'Binary Star',
  description: 'Two stars locked in a tight orbit, with circumbinary planets and a debris ring.',
  load(sim) {
    const a = sim.addBody({ name: 'Duo A', kind: 'star', mass: 0.9 });
    const b = addOrbiting(sim, a, { name: 'Duo B', mass: 0.55, kind: 'star' }, { a: 0.7, e: 0.2 });
    sim.recenter();
    const barycenter = { ...a, mass: a.mass + b.mass, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 } as Body;
    addOrbiting(sim, barycenter, { name: 'Duo b', mass: 0.8 * EARTH_MASS, color: 0xb8a58c }, { a: 2.6, nu: 1 });
    addOrbiting(sim, barycenter, { name: 'Duo c', mass: 60 * EARTH_MASS, color: 0x6fa8c9 }, { a: 4.6, nu: 4 });
    addParticleDisk(sim, barycenter, { count: 1200, inner: 6.5, outer: 8.5, thickness: 0.02, color: [0.75, 0.72, 0.68] });
    return { cameraDistance: 14, timeScale: 0.5, elevation: 0.7 };
  },
};

const figureEight: Preset = {
  id: 'figure8',
  name: 'Figure-8 Three-Body',
  description: 'Three equal stars chasing each other along a figure-eight: a famous periodic solution.',
  load(sim) {
    // Chenciner–Montgomery solution (G = m = 1), rescaled to our units.
    const L = 3; // length scale (AU)
    const m = 1;
    const vScale = Math.sqrt((G * m) / L);
    const p1 = [0.97000436, -0.24308753];
    const v3 = [-0.93240737, -0.86473146];
    const init = [
      { p: p1, v: [-v3[0] / 2, -v3[1] / 2] },
      { p: [-p1[0], -p1[1]], v: [-v3[0] / 2, -v3[1] / 2] },
      { p: [0, 0], v: v3 },
    ];
    const names = ['Trio A', 'Trio B', 'Trio C'];
    init.forEach(({ p, v }, i) => {
      sim.addBody({
        name: names[i],
        kind: 'star',
        mass: m,
        x: p[0] * L,
        z: p[1] * L,
        vx: v[0] * vScale,
        vz: v[1] * vScale,
      });
    });
    return { cameraDistance: 9, timeScale: 0.25, elevation: 1.2 };
  },
};

const galaxyCollision: Preset = {
  id: 'galaxies',
  name: 'Galaxy Collision',
  description: 'Two black-hole-anchored disks of stars pass through each other, throwing out tidal tails.',
  load(sim) {
    sim.dtMax = 0.003;
    const mass = 1500;
    const a = sim.addBody({ name: 'Core Alpha', kind: 'blackhole', mass, x: -70, z: -40, vx: 8 });
    const b = sim.addBody({ name: 'Core Beta', kind: 'blackhole', mass, x: 70, z: 40, vx: -8 });
    addParticleDisk(sim, a, { count: 3000, inner: 4, outer: 32, thickness: 0.03, color: kelvinToRgb(9000) });
    addParticleDisk(sim, b, { count: 3000, inner: 4, outer: 32, thickness: 0.03, color: kelvinToRgb(4800), tilt: 50 * deg });
    return { cameraDistance: 200, timeScale: 1.2, elevation: 0.9 };
  },
};

const protoplanetary: Preset = {
  id: 'proto',
  name: 'Protoplanetary Disk',
  description: 'A young star surrounded by 120 colliding planetesimals. Watch planets accrete.',
  load(sim) {
    const star = sim.addBody({ name: 'Nascent', kind: 'star', mass: 1 });
    for (let i = 0; i < 120; i++) {
      const a = 0.6 + Math.pow(Math.random(), 0.8) * 4.4;
      const m = (0.2 + Math.random() * 1.5) * EARTH_MASS;
      addOrbiting(sim, star, { name: `Planetesimal ${i + 1}`, mass: m, kind: 'rocky', color: [0x8a8f99, 0xa0785a, 0xb8a58c, 0x7d6e63][i % 4] }, {
        a,
        e: Math.random() * 0.12,
        inc: (Math.random() - 0.5) * 0.03,
        lan: Math.random() * Math.PI * 2,
        argp: Math.random() * Math.PI * 2,
        nu: Math.random() * Math.PI * 2,
      });
    }
    addParticleDisk(sim, star, { count: 2500, inner: 0.5, outer: 6, thickness: 0.03, color: [0.75, 0.6, 0.45] });
    sim.recenter();
    return { cameraDistance: 10, timeScale: 0.2, elevation: 0.8 };
  },
};

const rogueStar: Preset = {
  id: 'rogue',
  name: 'Rogue Star Flyby',
  description: 'A wandering star dives through the outer Solar System. Who stays bound?',
  load(sim) {
    solarSystem.load(sim);
    sim.addBody({ name: 'Wanderer', kind: 'star', mass: 0.7, x: -60, y: 2, z: 14, vx: 6.5, vz: -0.4 });
    return { cameraDistance: 45, timeScale: 1.5, elevation: 0.9 };
  },
};

const blackHoleFeast: Preset = {
  id: 'feast',
  name: 'Black Hole Feast',
  description: 'A black hole falls toward a star and its planets.',
  load(sim) {
    solarSystem.load(sim);
    for (const b of [...sim.bodies]) if (b.kind === 'gas') sim.removeBody(b.id);
    sim.particles.clear();
    sim.addBody({ name: 'Maw', kind: 'blackhole', mass: 8, x: 18, y: 0.5, z: 18, vx: -1.6, vz: -2.2 });
    return { cameraDistance: 28, timeScale: 0.4, elevation: 0.9 };
  },
};

const empty: Preset = {
  id: 'empty',
  name: 'Empty Space',
  description: 'A lone Sun-like star. Build your own system with the spawn tool.',
  load(sim) {
    sim.addBody({ name: 'Sol Nova', kind: 'star', mass: 1 });
    return { cameraDistance: 8, timeScale: 0.3, elevation: 0.9 };
  },
};


const supernova: Preset = {
  id: 'supernova',
  name: 'Supernova',
  description: 'A 25 M☉ blue supergiant at the end of its life, with planets and a debris belt. It detonates after a few years. Watch the shockwave strip its system.',
  load(sim) {
    const star = sim.addBody({ name: 'Vela Prime', kind: 'star', mass: 25 });
    const planets: [string, number, number, Body['kind'], number][] = [
      ['Vela Prime b', 3 * EARTH_MASS, 6, 'rocky', 0xa0785a],
      ['Vela Prime c', 400 * EARTH_MASS, 11, 'gas', 0x6fa8c9],
      ['Vela Prime d', 90 * EARTH_MASS, 18, 'gas', 0xc99e6b],
    ];
    for (const [name, mass, a, kind, color] of planets) {
      addOrbiting(sim, star, { name, mass, kind, color }, { a, nu: Math.random() * Math.PI * 2 });
    }
    addParticleDisk(sim, star, { count: 2500, inner: 24, outer: 32, thickness: 0.03, color: [0.62, 0.58, 0.52] });
    addOrbiting(sim, star, { name: 'Vela Minor', mass: 0.8, kind: 'star' }, { a: 70, e: 0.1, nu: 2 });
    sim.recenter();
    sim.scheduleSupernova(star.id, 4);
    return { cameraDistance: 60, timeScale: 0.5, elevation: 0.9, tip: 'Vela Prime will explode in about 4 years…' };
  },
};

const giantImpact: Preset = {
  id: 'impact',
  name: 'Giant Impact',
  description: 'A Mars-sized protoplanet on a collision course with a young Earth. High-speed rocky impacts shatter into fragments, and some may become moons.',
  load(sim) {
    const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1 });
    const earth = addOrbiting(sim, sun, { name: 'Proto-Earth', mass: 0.9 * EARTH_MASS, kind: 'rocky', color: 0x9a5a3a }, { a: 1 });
    // Theia trails Earth on a slightly different orbit and closes in fast.
    sim.addBody({
      name: 'Theia',
      kind: 'rocky',
      mass: 0.12 * EARTH_MASS,
      color: 0x8a8f99,
      x: earth.x - 0.004,
      y: earth.y + 0.002,
      z: earth.z + 0.035,
      vx: earth.vx + 0.02,
      vy: earth.vy - 0.01,
      vz: earth.vz - 0.2,
    });
    return { cameraDistance: 0.35, timeScale: 0.02, elevation: 0.7, focus: 'Proto-Earth' };
  },
};

const ringmaker: Preset = {
  id: 'rings',
  name: 'Ring Maker',
  description: 'A moon on an eccentric orbit dips inside its gas giant’s Roche limit and is torn into a ring.',
  load(sim) {
    const sun = sim.addBody({ name: 'Helion', kind: 'star', mass: 1 });
    const giant = addOrbiting(sim, sun, { name: 'Colossus', mass: 1.2 * JUPITER_MASS, kind: 'gas', color: 0xc99e6b }, { a: 20 });
    addOrbiting(sim, giant, { name: 'Doomed Moon', mass: 0.02 * EARTH_MASS, kind: 'rocky', color: 0xb8a58c }, { a: 0.16, e: 0.45, nu: Math.PI * 1.55 });
    addOrbiting(sim, giant, { name: 'Safe Moon', mass: 0.03 * EARTH_MASS, kind: 'rocky', color: 0x7d6e63 }, { a: 0.6, nu: 1 });
    return { cameraDistance: 1.6, timeScale: 0.1, elevation: 0.5, focus: 'Colossus' };
  },
};

const starCluster: Preset = {
  id: 'cluster',
  name: 'Star Cluster Collapse',
  description: '2,000 stars that all attract each other, using the Barnes–Hut tree. A cold cloud collapses and settles into a cluster.',
  load(sim) {
    sim.softening = 0.6;
    sim.dtMax = 0.05;
    // Stars in clusters essentially never collide; this is pure stellar dynamics.
    sim.collisions = false;
    const n = 2000;
    const R = 150;
    let totalMass = 0;
    const masses: number[] = [];
    for (let i = 0; i < n; i++) {
      // Rough initial mass function: mostly small stars.
      const m = 0.1 + Math.pow(Math.random(), 3) * 4;
      masses.push(m);
      totalMass += m;
    }
    const sigma = 0.35 * Math.sqrt((G * totalMass) / (2 * R)) / Math.sqrt(3);
    for (let i = 0; i < n; i++) {
      // Uniform sphere.
      let x, y, z;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
      } while (x * x + y * y + z * z > 1);
      sim.addBody({
        name: `Cluster star ${i + 1}`,
        kind: 'star',
        mass: masses[i],
        x: x * R,
        y: y * R,
        z: z * R,
        vx: gauss() * sigma,
        vy: gauss() * sigma,
        vz: gauss() * sigma,
      });
    }
    sim.recenter();
    return { cameraDistance: 520, timeScale: 0.6, elevation: 0.5 };
  },
};

const selfGravitatingGalaxy: Preset = {
  id: 'spiral',
  name: 'Self-Gravitating Disk',
  description: '2,500 stars orbit a black hole and pull on one another. The cold disk breaks up into spiral arms and clumps.',
  load(sim) {
    sim.softening = 1.2;
    sim.dtMax = 0.03;
    sim.collisions = false;
    const core = sim.addBody({ name: 'Hub', kind: 'blackhole', mass: 400 });
    const n = 2000;
    const starMass = 0.6;
    const rMin = 6;
    const rMax = 100;
    const radii: number[] = [];
    for (let i = 0; i < n; i++) radii.push(rMin + (rMax - rMin) * Math.sqrt(Math.random()));
    radii.sort((a, b) => a - b);
    for (let i = 0; i < n; i++) {
      const r = radii[i];
      const enclosed = core.mass + i * starMass;
      const v = Math.sqrt((G * enclosed) / r);
      const th = Math.random() * Math.PI * 2;
      sim.addBody({
        name: `Disk star ${i + 1}`,
        kind: 'star',
        mass: starMass,
        x: Math.cos(th) * r,
        y: gauss() * 0.8,
        z: Math.sin(th) * r,
        vx: Math.sin(th) * v + gauss() * v * 0.1,
        vy: gauss() * v * 0.03,
        vz: -Math.cos(th) * v + gauss() * v * 0.1,
      });
    }
    return { cameraDistance: 230, timeScale: 0.5, elevation: 1.0 };
  },
};

/** Central supermassive black hole with stars on eccentric orbits; also reached from the galaxy map. */
export const galacticCore: Preset = {
  id: 'core',
  name: 'Galactic Core',
  description: 'A supermassive black hole with stars on wild, eccentric orbits and an infalling gas cloud. One star is on a path to be torn apart.',
  load(sim) {
    sim.dtMax = 0.02;
    const M = 4e5;
    const bh = sim.addBody({ name: 'Heart of the Galaxy', kind: 'blackhole', mass: M });
    for (let i = 0; i < 28; i++) {
      addOrbiting(sim, bh, { name: `S${i + 1}`, mass: 1 + Math.pow(Math.random(), 2) * 14, kind: 'star' }, {
        a: 250 + Math.random() * 1300,
        e: 0.3 + Math.random() * 0.6,
        inc: Math.random() * Math.PI,
        lan: Math.random() * Math.PI * 2,
        argp: Math.random() * Math.PI * 2,
        nu: Math.PI * (0.6 + Math.random() * 0.8),
      });
    }
    // On course for a tidal disruption: periapsis inside the tidal radius but outside the horizon.
    addOrbiting(sim, bh, { name: 'Unlucky Star', mass: 1, kind: 'star' }, { a: 400, e: 0.98, inc: 0.4, argp: 1, nu: Math.PI });
    // Infalling gas cloud.
    const cloud = { x: 900, y: 40, z: -300 };
    const vIn = Math.sqrt((G * M) / 950) * 0.35;
    for (let i = 0; i < 1500; i++) {
      sim.particles.add(
        cloud.x + gauss() * 25,
        cloud.y + gauss() * 10,
        cloud.z + gauss() * 25,
        -vIn * 0.9 + gauss() * 0.5,
        0,
        vIn * 0.6 + gauss() * 0.5,
        [0.85, 0.45 + Math.random() * 0.2, 0.5],
      );
    }
    return { cameraDistance: 2600, timeScale: 2, elevation: 0.9 };
  },
};

const precession: Preset = {
  id: 'precession',
  name: 'Relativistic Precession',
  description:
    'General relativity makes Mercury\u2019s orbit slowly rotate (43\u2033 per century in reality). Here the speed of light is lowered 600\u00d7 so the orbit traces a rosette.',
  load(sim) {
    sim.relativity = true;
    sim.lightSpeedScale = 0.0017;
    sim.collisions = false;
    const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1, age: 4.6e9 });
    addOrbiting(sim, sun, { name: 'Mercury', mass: 0.055 * EARTH_MASS, kind: 'rocky', color: 0x9a8f86 }, { a: 0.387, e: 0.206 });
    sim.recenter();
    return { cameraDistance: 1.6, timeScale: 0.4, elevation: 1.4, tip: 'Watch the orbit swing around: each loop starts a little further along.' };
  },
};

const inspiral: Preset = {
  id: 'inspiral',
  name: 'Black Hole Inspiral',
  description:
    'Two 10 M\u2609 black holes radiate gravitational waves, spiral together and merge. The speed of light is lowered so it happens in seconds, not millions of years.',
  load(sim) {
    sim.relativity = true;
    sim.lightSpeedScale = 0.0016;
    // Circular orbit including the 1PN correction (which weakens the pull at high speed):
    // v² = GM/r / (1 + 3GM/(r c²)).
    const r = 2;
    const gm = G * 20;
    const c2 = sim.lightSpeed ** 2;
    const v = Math.sqrt(gm / r / (1 + (3 * gm) / (r * c2)));
    sim.addBody({ name: 'Black Hole A', kind: 'blackhole', mass: 10, x: -r / 2, vz: v / 2 });
    sim.addBody({ name: 'Black Hole B', kind: 'blackhole', mass: 10, x: r / 2, vz: -v / 2 });
    const centre = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, mass: 20 } as Body;
    addParticleDisk(sim, centre, { count: 600, inner: 5, outer: 12, thickness: 0.02, color: [0.9, 0.7, 0.5] });
    return { cameraDistance: 9, timeScale: 0.8, elevation: 1.1, tip: 'Turn on sound to hear the merger chirp.' };
  },
};

const sunsFuture: Preset = {
  id: 'future',
  name: 'The Sun\u2019s Future',
  description:
    'Stellar evolution at 200 million years per simulated year: the Sun becomes a red giant, swallows the inner planets, then sheds a planetary nebula and leaves a white dwarf.',
  load(sim) {
    const setup = solarSystem.load(sim);
    sim.evolutionRate = 2e8;
    return { ...setup, cameraDistance: 7, timeScale: 1.5, tip: 'The Sun is 4.6 billion years old. Its red-giant phase begins in ~5 billion years (≈27 simulated years).' };
  },
};

/** The real Solar System on a given date, from JPL's approximate planetary elements. */
/** Particle colours for small-body orbit classes (JPL SBDB class codes). */
const SMALL_BODY_COLORS: Record<string, [number, number, number]> = {
  MBA: [0.62, 0.58, 0.52],
  IMB: [0.62, 0.58, 0.52],
  OMB: [0.58, 0.55, 0.5],
  MCA: [0.7, 0.55, 0.45],
  TJN: [0.78, 0.62, 0.45],
  CEN: [0.55, 0.7, 0.75],
  TNO: [0.55, 0.65, 0.85],
};

/** Real Solar System bodies added individually (beyond the eight planets). */
const NAMED_SMALL_BODIES = ['Pluto', 'Ceres', 'Eris', 'Haumea', 'Makemake', 'Vesta', 'Pallas', 'Hygiea', 'Apophis', 'Bennu', 'Halley', 'Encke', 'Churyumov–Gerasimenko', 'Hale–Bopp'];

export function loadSolarSystemOnDate(sim: Simulation, date: Date, opts: { trueScale?: boolean } = {}): SceneSetup {
  const data = getSolarData();
  const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1, color: starColor(1), age: 4.6e9 });
  const states = new Map(planetStates(date).map((p) => [p.name, p]));
  for (const [name, m, , , , color, kind] of SOLAR_PLANETS) {
    const st = states.get(name as PlanetName)!;
    const mass = data?.byName.get(name)?.mass ?? m * EARTH_MASS;
    sim.addBody({ name, mass, kind, color, x: st.pos[0], y: st.pos[1], z: st.pos[2], vx: st.vel[0], vy: st.vel[1], vz: st.vel[2] });
  }
  if (!data) {
    // Data not loaded (offline or tests): keep an illustrative belt.
    addParticleDisk(sim, sun, { count: 1500, inner: 2.2, outer: 3.3, thickness: 0.04, color: [0.62, 0.58, 0.52] });
    sim.recenter();
    return {
      cameraDistance: 9,
      timeScale: 0.1,
      elevation: 1.1,
      tip: `Planet positions for ${date.toISOString().slice(0, 10)} from JPL's approximate ephemerides. The asteroid belt is illustrative (real data didn't load).`,
    };
  }
  const jd = julianDate(date);
  for (const name of NAMED_SMALL_BODIES) {
    const b = data.byName.get(name);
    if (!b) continue;
    const mass = b.mass ?? 1e-15;
    const s = relativeState(b, jd, G * (1 + mass));
    const [x, y, z] = toScene(s.pos);
    const [vx, vy, vz] = toScene(s.vel);
    sim.addBody({ name, mass, kind: 'rocky', color: REAL_COLORS[name] ?? (b.kind === 'comet' ? 0xcfe6ff : 0x9a9088), x, y, z, vx, vy, vz, tag: b.kind === 'comet' ? 'comet' : undefined });
  }
  addSpacecraft(sim, data, jd, opts.trueScale ? 'true' : 'enlarged');
  const named = new Set(NAMED_SMALL_BODIES.map((n) => n.toLowerCase()));
  for (const b of data.small) {
    // "1 Ceres", "134340 Pluto (1930 BM)": skip bodies that are already added individually.
    const base = b.name.replace(/^\d+\s+/, '').replace(/\s*\(.*\)$/, '').toLowerCase();
    if (named.has(base)) continue;
    const s = smallBodyState(b, jd);
    const [x, y, z] = toScene(s.pos);
    const [vx, vy, vz] = toScene(s.vel);
    const c = SMALL_BODY_COLORS[b.cls] ?? [0.6, 0.6, 0.6];
    const shade = 0.85 + Math.random() * 0.3;
    sim.particles.add(x, y, z, vx, vy, vz, [c[0] * shade, c[1] * shade, c[2] * shade]);
  }
  sim.recenter();
  return {
    cameraDistance: 9,
    timeScale: 0.1,
    elevation: 1.1,
    tip: `The real Solar System on ${date.toISOString().slice(0, 10)}: planets from JPL's ephemerides; dwarf planets, comets and ${data.small.length.toLocaleString('en-US')} asteroids and Kuiper belt objects from JPL Horizons and the Small-Body Database, and the spacecraft that were flying on that date (cyan diamonds). Body sizes are enlarged so you can see them.`,
  };
}

/**
 * Saturn's real rings as test particles on circular orbits in Saturn's true equatorial plane
 * (from its IAU pole), at the radii from NASA's ring fact sheet. Returns how many were added.
 */
export function addSaturnRings(sim: Simulation, saturn: Body, data: SolarData, count: number): number {
  const sd = data.byName.get('Saturn');
  const pole = sd && poleScene(sd);
  if (!data.rings?.length || !pole) return 0;
  const [px, py, pz] = pole;
  // Orthonormal basis (u, w) of the ring plane with w = pole × u.
  let ux = -pz, uy = 0, uz = px;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const wx = py * uz - pz * uy, wy = pz * ux - px * uz, wz = px * uy - py * ux;
  const mu = G * sim.gravityScale * saturn.mass;
  let added = 0;
  for (const { r: rKm, ring } of sampleRingRadii(data.rings, count)) {
    const r = rKm / KM_PER_AU;
    const th = Math.random() * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    const v = Math.sqrt(mu / r);
    const shade = (0.45 + (ring.albedo ?? 0.4)) * (0.85 + Math.random() * 0.3);
    const grey = ring.name.startsWith('C') ? 0.9 : 1; // the C ring is greyer
    const ok = sim.particles.add(
      saturn.x + r * (ux * c + wx * s),
      saturn.y + r * (uy * c + wy * s),
      saturn.z + r * (uz * c + wz * s),
      saturn.vx + v * (wx * c - ux * s),
      saturn.vy + v * (wy * c - uy * s),
      saturn.vz + v * (wz * c - uz * s),
      [0.86 * shade, 0.79 * shade * grey, 0.66 * shade * grey],
    );
    if (ok < 0) break;
    added++;
  }
  return added;
}

/** Moons shown in the true-scale Solar System: the large ones (with periods of 1.8 days or more). */
const TRUE_SCALE_MOONS = ['Moon', 'Io', 'Europa', 'Ganymede', 'Callisto', 'Titan', 'Rhea', 'Iapetus', 'Titania', 'Oberon', 'Triton', 'Charon'];

/**
 * The whole real Solar System at true scale: real radii, plus the major moons (which the
 * inflated game sizes would swallow). Moons are placed around their planet's position, which is
 * treated as the planet–moon barycentre.
 */
export function loadSolarSystemTrueScale(sim: Simulation, date: Date): SceneSetup {
  const base = loadSolarSystemOnDate(sim, date, { trueScale: true });
  const data = getSolarData();
  if (data) {
    const jd = julianDate(date);
    for (const name of TRUE_SCALE_MOONS) {
      const m = data.byName.get(name);
      const planet = m && sim.bodies.find((b) => b.name === m.parent);
      if (!m || !planet || !m.mass) continue;
      const s = relativeState(m, jd, G * (planet.mass + m.mass));
      const [x, y, z] = toScene(s.pos);
      const [vx, vy, vz] = toScene(s.vel);
      const f = m.mass / (planet.mass + m.mass);
      sim.addBody({
        name, kind: 'rocky', mass: m.mass, color: REAL_COLORS[name],
        x: planet.x + x * (1 - f), y: planet.y + y * (1 - f), z: planet.z + z * (1 - f),
        vx: planet.vx + vx * (1 - f), vy: planet.vy + vy * (1 - f), vz: planet.vz + vz * (1 - f),
      });
      planet.x -= x * f;
      planet.y -= y * f;
      planet.z -= z * f;
      planet.vx -= vx * f;
      planet.vy -= vy * f;
      planet.vz -= vz * f;
    }
  }
  const saturn = sim.bodies.find((b) => b.name === 'Saturn');
  if (data && saturn) addSaturnRings(sim, saturn, data, 3000);
  setTrueScale(sim, true);
  return {
    cameraDistance: 0.012,
    timeScale: 0.002,
    elevation: 0.5,
    focus: 'Earth',
    tip: `The real Solar System at true scale on ${date.toISOString().slice(0, 10)}, with its major moons. Everything is its real size, so planets are tiny dots. Zoom out to see how empty space is. ${
      data ? '' : base.tip ?? ''
    }`,
  };
}

const solarTrueScale: Preset = {
  id: 'solar-true',
  name: 'Solar System (true scale)',
  description: 'The real Solar System with real sizes and its 12 largest moons. Everything is tiny compared with the distances between them.',
  load: (sim) => loadSolarSystemTrueScale(sim, new Date()),
};

/**
 * Real spacecraft at their actual positions on this Julian date (JPL Horizons), as massless
 * probes. Craft orbiting a giant planet (Juno, Cassini, Galileo) are left out because their
 * tight orbits would force tiny timesteps. With enlarged sizes, craft that would sit inside a
 * planet's enlarged radius (JWST near Earth) are left out too. Returns how many were added.
 */
export function addSpacecraft(sim: Simulation, data: SolarData, jd: number, sizes: 'enlarged' | 'true'): number {
  let added = 0;
  const sun = sim.bodies.find((b) => b.name === 'Sun');
  const ox = sun?.x ?? 0, oy = sun?.y ?? 0, oz = sun?.z ?? 0;
  const others = sim.bodies.filter((b) => b.kind !== 'star');
  for (const c of data.spacecraft ?? []) {
    const st = spacecraftState(c, jd);
    if (!st) continue;
    const [x, y, z] = toScene(st.pos);
    const blocked = others.some((b) => {
      const d = Math.hypot(b.x - ox - x, b.y - oy - y, b.z - oz - z);
      if (b.kind === 'gas' && d < 0.06) return true; // in orbit around a giant planet
      return sizes === 'enlarged' && d < b.radius * 3;
    });
    if (blocked) continue;
    const [vx, vy, vz] = toScene(st.vel);
    sim.addBody({
      name: c.name, kind: 'rocky', mass: 1e-20, color: SPACECRAFT_COLOR, tag: 'probe',
      x: ox + x, y: oy + y, z: oz + z,
      vx: (sun?.vx ?? 0) + vx, vy: (sun?.vy ?? 0) + vy, vz: (sun?.vz ?? 0) + vz,
    });
    added++;
  }
  return added;
}

/** Planet + real moons, at true scale (real radii), positioned for `date` from JPL data. */
export function loadMoonSystem(sim: Simulation, planetName: string, date: Date, data: SolarData | undefined = getSolarData()): SceneSetup {
  const planetData = data?.byName.get(planetName);
  if (!data || !planetData?.mass) {
    sim.addBody({ name: planetName, kind: 'rocky', mass: EARTH_MASS });
    return { cameraDistance: 0.05, timeScale: 0.01, tip: 'Real moon data could not be loaded.' };
  }
  const planetColor = SOLAR_PLANETS.find((p) => p[0] === planetName)?.[5] ?? REAL_COLORS[planetName] ?? 0x9a9088;
  const planetKind = SOLAR_PLANETS.find((p) => p[0] === planetName)?.[6] ?? 'rocky';
  // Real sizes: soften gravity only at ~1.5 km instead of the default 15,000 km, which is larger
  // than Phobos's whole orbit.
  sim.softening = 1e-8;
  const planet = sim.addBody({ name: planetName, kind: planetKind, mass: planetData.mass, radius: realRadiusAu(planetData), color: planetColor });
  const jd = julianDate(date);
  const moons = data.bodies.filter((b) => b.parent === planetName && b.kind === 'moon');
  // Moons orbiting the parent itself first, so barycentric ones (Nix, Hydra) can use them.
  moons.sort((a, b) => Number(!!a.barycentric) - Number(!!b.barycentric));
  let innerPeriod = Infinity;
  let regularExtent = 0;
  for (const m of moons) {
    const mass = m.mass ?? 1e-15;
    let cx = planet.x, cy = planet.y, cz = planet.z, cvx = planet.vx, cvy = planet.vy, cvz = planet.vz;
    let centralMass = planet.mass;
    if (m.barycentric) {
      // Elements are relative to the barycentre of the planet and its big moon(s) added so far.
      const sys = sim.bodies;
      const M = sys.reduce((t, b) => t + b.mass, 0);
      cx = sys.reduce((t, b) => t + b.x * b.mass, 0) / M;
      cy = sys.reduce((t, b) => t + b.y * b.mass, 0) / M;
      cz = sys.reduce((t, b) => t + b.z * b.mass, 0) / M;
      cvx = sys.reduce((t, b) => t + b.vx * b.mass, 0) / M;
      cvy = sys.reduce((t, b) => t + b.vy * b.mass, 0) / M;
      cvz = sys.reduce((t, b) => t + b.vz * b.mass, 0) / M;
      centralMass = M;
    }
    const s = relativeState(m, jd, G * (centralMass + mass));
    const [x, y, z] = toScene(s.pos);
    const [vx, vy, vz] = toScene(s.vel);
    if (!m.barycentric && mass > 1e-3 * planet.mass) {
      // A heavy moon (Charon, ~12% of Pluto): place both around their common barycentre.
      const f = mass / (planet.mass + mass);
      sim.addBody({ name: m.name, kind: 'rocky', mass, radius: realRadiusAu(m), color: REAL_COLORS[m.name], x: planet.x + x * (1 - f), y: planet.y + y * (1 - f), z: planet.z + z * (1 - f), vx: planet.vx + vx * (1 - f), vy: planet.vy + vy * (1 - f), vz: planet.vz + vz * (1 - f) });
      planet.x -= x * f;
      planet.y -= y * f;
      planet.z -= z * f;
      planet.vx -= vx * f;
      planet.vy -= vy * f;
      planet.vz -= vz * f;
    } else {
      sim.addBody({ name: m.name, kind: 'rocky', mass, radius: realRadiusAu(m), color: REAL_COLORS[m.name], x: cx + x, y: cy + y, z: cz + z, vx: cvx + vx, vy: cvy + vy, vz: cvz + vz });
    }
    const period = 360 / m.elements.n / 365.25; // years
    innerPeriod = Math.min(innerPeriod, period);
  }
  // Frame the major moons: those with at least 5% of the largest moon's mass, on regular orbits.
  const biggest = Math.max(...moons.map((m) => m.mass ?? 0));
  for (const m of moons) {
    if ((m.mass ?? 0) >= 0.05 * biggest && m.elements.e < 0.3) regularExtent = Math.max(regularExtent, m.elements.a);
  }
  const ringCount = planetName === 'Saturn' ? addSaturnRings(sim, planet, data, 6000) : 0;
  // Moon systems are true scale: this also ticks "Real sizes" and keeps merged bodies real-sized.
  // The real Sun, at its true direction and distance from the planet on this date: it lights the
  // scene, sets real temperatures, and adds its pull on the moons. The planet's heliocentric
  // state is reversed, so nothing already placed needs to move.
  const helio = SOLAR_PLANETS.some((p) => p[0] === planetName)
    ? planetStates(date).find((p) => p.name === planetName)
    : (() => {
        const st = relativeState(planetData, jd, G * (1 + planetData.mass!));
        return { pos: toScene(st.pos), vel: toScene(st.vel) };
      })();
  if (helio) {
    sim.addBody({
      name: 'Sun', kind: 'star', mass: 1, color: starColor(1), age: 4.6e9,
      x: planet.x - helio.pos[0], y: planet.y - helio.pos[1], z: planet.z - helio.pos[2],
      vx: planet.vx - helio.vel[0], vy: planet.vy - helio.vel[1], vz: planet.vz - helio.vel[2],
    });
  }
  setTrueScale(sim, true, data);
  sim.recenter();
  const outer = regularExtent || Math.max(...moons.map((m) => m.elements.a));
  return {
    cameraDistance: outer * 2.6,
    focus: planetName,
    timeScale: Math.max(1e-5, innerPeriod / 6),
    elevation: 0.5,
    tip: `${planetName} and its moons on ${date.toISOString().slice(0, 10)}, at true scale, from JPL Horizons mean orbits.${
      ringCount ? ` The rings are ${ringCount.toLocaleString('en-US')} particles at the real radii from NASA's ring fact sheet, in Saturn's true equatorial plane.` : ''
    } The Sun is at its real distance; the planet's oblateness is left out, so orbits slowly drift from reality.`,
  };
}

const milkyWayAndromeda: Preset = {
  id: 'mw-m31',
  name: 'Milky Way meets Andromeda (real)',
  description: 'The real collision ahead: Andromeda at its measured distance and HST-measured velocity, with both galaxies’ real masses and disk orientations. Time runs in millions of years.',
  load: (sim) => loadMilkyWayAndromeda(sim),
};

const moonSystem = (id: string, planet: string, name: string, description: string): Preset => ({
  id,
  name,
  description,
  load: (sim) => loadMoonSystem(sim, planet, new Date()),
});

const earthMoon = moonSystem('earth-moon', 'Earth', 'Earth & Moon (real)', 'The Earth and Moon at true scale and their real positions today.');
const marsMoons = moonSystem('mars-moons', 'Mars', 'Mars & moons (real)', 'Phobos and Deimos, Mars’s tiny captured-looking moons, at true scale.');
const jupiterMoons = moonSystem('jupiter-moons', 'Jupiter', 'Jupiter & moons (real)', 'Io, Europa, Ganymede, Callisto and Amalthea at their real positions today. Watch the 1:2:4 Laplace resonance.');
const saturnMoons = moonSystem('saturn-moons', 'Saturn', 'Saturn & moons (real)', 'Nine of Saturn’s moons, from Mimas to distant retrograde Phoebe, at true scale.');
const uranusMoons = moonSystem('uranus-moons', 'Uranus', 'Uranus & moons (real)', 'The five major moons of Uranus, orbiting on their side like the planet itself.');
const neptuneMoons = moonSystem('neptune-moons', 'Neptune', 'Neptune & moons (real)', 'Triton on its retrograde orbit, Proteus, and Nereid on a wildly eccentric one.');
const plutoCharon = moonSystem('pluto-charon', 'Pluto', 'Pluto & Charon (real)', 'Pluto and Charon orbit a point in empty space between them; Nix and Hydra circle both.');

export const PRESETS: Preset[] = [
  solarSystem,
  solarTrueScale,
  earthMoon,
  marsMoons,
  jupiterMoons,
  saturnMoons,
  uranusMoons,
  neptuneMoons,
  plutoCharon,
  protoplanetary,
  giantImpact,
  ringmaker,
  binaryStar,
  figureEight,
  rogueStar,
  blackHoleFeast,
  supernova,
  sunsFuture,
  precession,
  inspiral,
  galacticCore,
  starCluster,
  selfGravitatingGalaxy,
  milkyWayAndromeda,
  galaxyCollision,
  empty,
];

function gauss(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Populate the simulation from a procedurally generated star system. */
export function loadStarSystem(sim: Simulation, spec: StarSystemSpec): SceneSetup {
  const star = sim.addBody({ name: spec.star.name, kind: 'star', mass: spec.star.mass, color: spec.star.color, age: spec.star.age ?? 0 });
  let outermost = 2;
  for (const p of spec.planets) {
    const planet = addOrbiting(sim, star, { name: p.name, mass: p.mass, kind: p.kind, color: p.color }, p);
    outermost = Math.max(outermost, p.a);
    for (const m of p.moons) {
      addOrbiting(sim, planet, { name: m.name, mass: m.mass, kind: 'rocky', color: m.color }, { a: m.a, inc: m.inc, nu: m.nu });
    }
  }
  if (spec.belt) {
    addParticleDisk(sim, star, { count: spec.belt.count, inner: spec.belt.inner, outer: spec.belt.outer, thickness: 0.04, color: [0.62, 0.58, 0.52] });
  }
  if (spec.companion) {
    const c = spec.companion;
    addOrbiting(sim, star, { name: c.name, mass: c.mass, kind: 'star', color: c.color }, { a: c.a, e: c.e, nu: c.nu });
  }
  sim.recenter();
  const inner = spec.planets[0]?.a ?? 1;
  // Frame the inner system; slow enough to watch the innermost planet.
  const innerPeriod = Math.sqrt((inner * inner * inner) / spec.star.mass);
  return {
    cameraDistance: Math.min(outermost * 1.6, Math.max(6, inner * 12)),
    timeScale: Math.min(2, Math.max(0.02, innerPeriod / 3)),
    elevation: 0.7,
  };
}
