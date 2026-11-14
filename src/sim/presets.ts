import type { StarSystemSpec } from '../procgen/starSystem';
import { mainSequenceLifetime, radiusFor, type Body } from './body';
import { kelvinToRgb, rgbToHex, starColor } from './color';
import { keplerToState, OrbitalElements } from './orbits';
import type { Simulation } from './simulation';
import { EARTH_MASS, G, JUPITER_MASS } from './units';
import { mulberry32 } from '../procgen/rng';
import { rememberPulsar, spinDownPower } from './neutronStar';
import { HULSE_TAYLOR } from './binaryPulsar';
import type { CompactObject } from './compactObjects';
import { ARMS, cepheidMass, describeObject, whiteDwarfMasses, whiteDwarfPeriodDays, xrayMasses, xrayPeriodDays, type CataclysmicVariable, type Cepheid, type GalacticObject, type Maser, type Nova, type WolfRayet, type XrayBinary } from './galacticObjects';
import { describePulsar, pulsarName, type PulsarRecord } from './pulsars';
import { GAS_DISC_LIFETIME, planetesimals } from './planetFormation';
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

/** Planet formation: speedup of growth and gas clock, to match the enlarged collision radii. */
export const FORMATION_SPEEDUP = 3000;

const protoDisk: Preset = {
  id: 'proto',
  name: 'Planet Formation',
  description:
    'A young Sun-like star in its disc of gas and dust. 80 planetary embryos carry the solids of a disc six times the minimum-mass solar nebula, with ice beyond the snow line at 2.7 AU. They collide and grow; cores past ten Earth masses pull in gas and become giants, until the star blows the gas away after 3 million years. Growth runs 3,000× faster than in nature.',
  load(sim) {
    const rand = mulberry32(2026);
    const star = sim.addBody({ name: 'Young Sun', kind: 'star', mass: 1 });
    // Six times the minimum-mass nebula: young discs observed in the millimetre range from well
    // below to well above this. Less, and the cores here stop short of ten Earth masses.
    const enhancement = 6;
    planetesimals(rand, 80, 0.4, 8, enhancement).forEach((p, i) => {
      // Rocky inside the snow line, icy beyond it.
      const color = p.icy ? [0xb8c8d8, 0xa8b8c8, 0xc8d0dc][i % 3] : [0x8a8f99, 0xa0785a, 0xb8a58c, 0x7d6e63][i % 4];
      addOrbiting(sim, star, { name: `${p.icy ? 'Icy' : 'Rocky'} embryo ${i + 1}`, mass: p.mass, kind: 'rocky', color }, {
        a: p.a,
        e: rand() * 0.05,
        inc: (rand() - 0.5) * 0.01,
        lan: rand() * Math.PI * 2,
        argp: rand() * Math.PI * 2,
        nu: rand() * Math.PI * 2,
      });
    });
    // (The gas disc itself is drawn by the view, not simulated: dust particles would make every
    // step ~20× slower.)
    // Bodies that touch merge whole, as in N-body studies of planet formation (no debris).
    sim.debris = false;
    sim.shatter = false;
    sim.formation = { starId: star.id, enhancement, speedup: FORMATION_SPEEDUP, gasUntil: sim.time + GAS_DISC_LIFETIME / FORMATION_SPEEDUP };
    sim.recenter();
    return {
      cameraDistance: 14,
      timeScale: 3,
      elevation: 0.8,
      maxTimeScale: 40,
      tip: `Planets grow by collisions; cores past 10 Earth masses swallow gas and become giants until the star clears its gas disc (in ${GAS_DISC_LIFETIME / FORMATION_SPEEDUP} years here, 3 million in nature).`,
    };
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
    sim.addBody({ name: 'Maw', kind: 'blackhole', mass: 8, spin: 0.9, x: 18, y: 0.5, z: 18, vx: -1.6, vz: -2.2 });
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
  description:
    'A 15 M☉ red supergiant with planets, a debris belt and a distant companion explodes as a Type II supernova. The ejecta, blast wave and light curve follow the published models: 10⁵¹ erg, 3,500 km/s, a 4-month plateau.',
  load(sim) {
    const star = sim.addBody({ name: 'Kessra', kind: 'giant', mass: 15 });
    const planets: [string, number, number, Body['kind'], number][] = [
      ['Kessra b', 2 * EARTH_MASS, 8, 'rocky', 0xa0785a],
      ['Kessra c', 300 * EARTH_MASS, 25, 'gas', 0x6fa8c9],
      ['Kessra d', 60 * EARTH_MASS, 50, 'gas', 0x7fb0d0],
    ];
    for (const [name, mass, a, kind, color] of planets) {
      addOrbiting(sim, star, { name, mass, kind, color }, { a, nu: Math.random() * Math.PI * 2 });
    }
    addParticleDisk(sim, star, { count: 3000, inner: 100, outer: 130, thickness: 0.03, color: [0.62, 0.58, 0.52] });
    addOrbiting(sim, star, { name: 'Kessra B', mass: 0.9, kind: 'star' }, { a: 400, e: 0.1, nu: 2 });
    sim.recenter();
    // The ejecta travel 10⁴ AU in about 14 years: keep them in the scene.
    sim.particleCullDistance = 3e4;
    // It explodes ten days in.
    sim.scheduleSupernova(star.id, 10 / 365.25);
    return {
      cameraDistance: 420,
      // About two days per second, so the light curve and the blast wave play out over minutes.
      timeScale: 2 / 365.25,
      elevation: 0.8,
      tip:
        'Kessra explodes ten days in. Time runs at about two days per second: the ejecta leave at up to 3,500 km/s and reach the belt in seven weeks while the light stays on a ~4-month plateau (Kasen & Woosley 2009) and then fades on the radioactive cobalt tail. The inner rocky planet is blown apart; the gas giants survive the blast but, with 90% of the star’s mass gone, are no longer bound. Speed time up to watch the system fly apart.',
    };
  },
};

const supernovaZoo: Preset = {
  id: 'supernova-zoo',
  name: 'Supernova Zoo',
  description:
    'Six massive stars that die six different ways, set by their mass and metallicity: an electron-capture supernova, a red supergiant’s Type II-P, a blue supergiant like SN 1987A’s, a Wolf–Rayet star’s Type Ib, a metal-poor giant that collapses without a supernova, and a 200 M☉ pair-instability explosion that leaves nothing behind.',
  load(sim) {
    // [name, initial mass (M☉), metallicity (Z/Z☉)]: one of each fate in stellarFate.ts.
    const stars: [string, number, number][] = [
      ['Eight-Eight', 8.8, 1],
      ['Ruby (red supergiant)', 15, 1],
      ['Sapphire (blue supergiant)', 20, 0.5],
      ['Wolf (Wolf–Rayet)', 26, 1],
      ['Quiet (metal-poor)', 60, 0.1],
      ['Titan (pair instability)', 200, 0.05],
    ];
    stars.forEach(([name, mass, metallicity], i) => {
      const a = (i / stars.length) * Math.PI * 2;
      const star = sim.addBody({ name, kind: 'giant', mass, metallicity, x: Math.cos(a) * 3000, z: Math.sin(a) * 3000 });
      // One every eight days, so each one's light and debris can be told apart.
      sim.scheduleSupernova(star.id, (6 + 8 * i) / 365.25);
    });
    sim.particleCullDistance = 3e5;
    return {
      cameraDistance: 11000,
      timeScale: 4 / 365.25,
      elevation: 1.1,
      tip:
        'Each star dies differently because of its mass and metallicity (select one to see its forecast, and try the metallicity slider on it before it goes). Watch the colours and speeds of the debris: red hydrogen from the supergiants, none from the Wolf–Rayet star, almost nothing from the star that collapses quietly into a black hole, and a huge, fast, oxygen- and iron-rich cloud from the pair-instability explosion.',
    };
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
    // Sgr A*: the Event Horizon Telescope's favoured models spin fast (a* = 0.5–0.94; EHT 2022, paper V).
    const bh = sim.addBody({ name: 'Heart of the Galaxy', kind: 'blackhole', mass: M, spin: 0.94 });
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

/**
 * PSR B1257+12 (Lich) and the first planets found outside the Solar System (Wolszczan & Frail
 * 1992). Orbits from the ATNF Pulsar Catalogue (pulse-timing fit of Konacki & Wolszczan 2003):
 * periods 25.262, 66.5419 and 98.2114 days, eccentricities 0, 0.0186 and 0.0252, arguments of
 * periastron 250.4° and 108.3°, masses 0.020, 4.3 and 3.9 Earth masses (6.0 × 10⁻⁸,
 * 1.29 × 10⁻⁵ and 1.17 × 10⁻⁵ M☉). Pulsar mass 1.4 M☉ (assumed). The two big planets'
 * orbits are tilted 53° and 47° to the sky and close to one plane; here all three share one.
 * Names: IAU NameExoWorlds 2015.
 */
export const pulsarPlanets: Preset = {
  id: 'pulsar-planets',
  name: 'Pulsar Planets (PSR B1257+12)',
  description:
    'The first planets ever found beyond the Sun, in 1992, circle a dead star: the pulsar Lich, spinning 161 times a second. Its pulses arrive up to 1.3 milliseconds early or late as three planets tug it about.',
  load(sim) {
    const mass = 1.4;
    const lich = sim.addBody({ name: 'Lich (PSR B1257+12)', kind: 'neutron', mass });
    const deg = Math.PI / 180;
    const planets = [
      { name: 'Draugr', mEarth: 0.02, days: 25.262, e: 0, w: 0, color: 0x8a8580 },
      { name: 'Poltergeist', mEarth: 4.3, days: 66.5419, e: 0.0186, w: 250.4, color: 0x7d6f66 },
      { name: 'Phobetor', mEarth: 3.9, days: 98.2114, e: 0.0252, w: 108.3, color: 0x6c7480 },
    ];
    for (const p of planets) {
      const years = p.days / 365.25;
      const a = Math.cbrt(years * years * (mass + p.mEarth * EARTH_MASS));
      addOrbiting(sim, lich, { name: p.name, mass: p.mEarth * EARTH_MASS, kind: 'rocky', color: p.color }, { a, e: p.e, argp: p.w * deg, nu: p.w * deg + 1 });
    }
    sim.recenter();
    return { cameraDistance: 1.4, timeScale: 0.03, elevation: 0.9, tip: 'Click Lich and zoom in: its magnetic field, its beams, and a flash each time a beam sweeps past you.' };
  },
};

/**
 * A pulsar from the ATNF catalogue (Galaxy Map → visit): the neutron star, with its measured spin,
 * and for a binary its companion on the catalogued orbit (period, eccentricity, and the median
 * companion mass for a 60° tilt). The companion is a neutron star above 1.2 M☉, a white dwarf
 * above 0.08 M☉, and below that the stripped remnant of a star that the pulsar's wind is
 * eating away (a "black widow"), drawn as a small gas giant. Tight binaries use real sizes.
 */
export function loadPulsarSystem(sim: Simulation, p: PulsarRecord): SceneSetup {
  const name = pulsarName(p);
  rememberPulsar(name, p.period, p.pdot);
  const mass = 1.4;
  const ns = sim.addBody({ name, kind: 'neutron', mass });
  if (!p.pbDays || p.companionMass < 1e-3) {
    sim.recenter();
    // A powerful young pulsar sits in its wind nebula: stand back far enough to see it.
    const nebula = p.pdot > 0 && spinDownPower(p.period, p.pdot) > 1e29;
    return { cameraDistance: nebula ? 2.4 : 0.6, timeScale: 0.05, elevation: nebula ? 0.35 : 0.5, tip: describePulsar(p) };
  }
  const mc = p.companionMass;
  const kind: Body['kind'] = mc >= 1.2 ? 'neutron' : mc >= 0.08 ? 'whitedwarf' : 'gas';
  const years = p.pbDays / 365.25;
  const a = Math.cbrt(years * years * (mass + mc));
  const companion = addOrbiting(
    sim,
    ns,
    { name: kind === 'neutron' ? 'Companion neutron star' : kind === 'whitedwarf' ? 'White dwarf companion' : 'Companion (being evaporated)', mass: mc, kind, color: kind === 'gas' ? 0x8a4a3a : undefined },
    { a, e: Math.min(p.ecc, 0.95), nu: 1 },
  );
  // The Double Pulsar: its companion is a pulsar too (PSR J0737−3039B, 2.77 s; ATNF).
  if (p.jname === 'J0737-3039A') rememberPulsar(companion.name, 2.773, 8.9e-16);
  // Tighter than the enlarged bodies allow: show them at their real sizes.
  if (a < 0.2) setTrueScale(sim, true);
  if (kind === 'neutron') sim.relativity = true;
  sim.recenter();
  return { cameraDistance: Math.max(a * 4, 2e-4), timeScale: years / 5, elevation: 0.6, tip: describePulsar(p) };
}

/**
 * The Hulse–Taylor binary pulsar, PSR B1913+16, on its measured orbit (Weisberg & Huang 2016):
 * period 7.75 hours, eccentricity 0.617, masses 1.438 and 1.390 M☉, at real sizes and with
 * general relativity at the real speed of light. Its periastron advances 4.2° a year.
 */
export const hulseTaylor: Preset = {
  id: 'hulse-taylor',
  name: 'Hulse–Taylor Binary Pulsar',
  description:
    'Two neutron stars, 1.4 times the Sun’s mass each, whirl round each other every 7¾ hours. The orbit is shrinking, by 3.5 m a year, exactly as Einstein predicted for an orbit that radiates gravitational waves: the first evidence for them (Nobel Prize 1993). They will merge in 300 million years.',
  load(sim) {
    const H = HULSE_TAYLOR;
    sim.relativity = true;
    sim.lightSpeedScale = 1;
    const psr = sim.addBody({ name: 'PSR B1913+16', kind: 'neutron', mass: H.mp });
    const years = H.pbDays / 365.25;
    const a = Math.cbrt(years * years * (H.mp + H.mc));
    addOrbiting(sim, psr, { name: 'Companion neutron star (not seen as a pulsar)', kind: 'neutron', mass: H.mc }, { a, e: H.e, argp: (292.5 * Math.PI) / 180, nu: Math.PI });
    setTrueScale(sim, true);
    sim.recenter();
    return {
      cameraDistance: a * 3.5,
      timeScale: years / 4,
      elevation: 1.1,
      tip: 'Speed time up and open the graph (Periapsis direction) to watch the orbit turn 4.2° a year.',
    };
  },
};

/**
 * A real black hole and its companion star (Galaxy Map → visit), on the orbit from the discovery
 * paper (compact-objects.json): period, eccentricity, companion mass. Dormant black holes (the
 * Gaia ones) have no accretion disc; X-ray binaries do. Tight binaries use real sizes.
 */
export function loadBlackHoleSystem(sim: Simulation, o: CompactObject): SceneSetup {
  const hole = sim.addBody({ name: o.name, kind: 'blackhole', mass: o.mass ?? 10, tag: o.companion?.dormant ? 'dormant' : undefined });
  const c = o.companion;
  if (!c) {
    sim.recenter();
    return { cameraDistance: 3, timeScale: 0.1, elevation: 0.5, tip: o.about };
  }
  const years = c.periodDays / 365.25;
  const a = Math.cbrt(years * years * (hole.mass + c.mass));
  // Halfway through its life (a 40 M☉ supergiant lives a few million years, a Sun-like star ten billion).
  const age = Math.min(4e9, 0.5 * mainSequenceLifetime(c.mass));
  addOrbiting(sim, hole, { name: c.kind === 'giant' ? 'Companion giant star' : 'Companion star', kind: c.kind, mass: c.mass, age }, { a, e: c.ecc, nu: Math.PI * 0.6 });
  if (a < 0.5) setTrueScale(sim, true);
  sim.recenter();
  return { cameraDistance: a * 3.2, timeScale: years / 6, elevation: 0.7, tip: o.about };
}

/**
 * A real X-ray binary from the Galaxy Map: the compact object (black hole or neutron star) with its
 * donor star on the catalogued orbit. Unknown masses and periods take typical values for the
 * class, and the tip says so.
 */
export function loadXrayBinary(sim: Simulation, o: XrayBinary & { kind: 'hmxb' | 'lmxb' }): SceneSetup {
  const { compact, companion, isBlackHole } = xrayMasses(o);
  const period = xrayPeriodDays(o);
  const primary = sim.addBody({ name: o.name, kind: isBlackHole ? 'blackhole' : 'neutron', mass: compact });
  if (!isBlackHole && o.spin) rememberPulsar(o.name, o.spin, 0);
  const years = period.days / 365.25;
  const a = Math.cbrt(years * years * (compact + companion));
  // A massive donor is partway through its short life; a low-mass one is old.
  const age = o.kind === 'hmxb' ? Math.min(4e9, 0.5 * mainSequenceLifetime(companion)) : Math.min(8e9, 0.6 * mainSequenceLifetime(companion));
  const giant = o.kind === 'lmxb' && !!o.sptype && /III/.test(o.sptype);
  addOrbiting(sim, primary, { name: o.kind === 'hmxb' ? 'Donor supergiant' : 'Donor star', kind: giant ? 'giant' : 'star', mass: companion, age }, { a, e: Math.min(o.ecc ?? 0, 0.9), nu: Math.PI * 0.6 });
  if (a < 0.5) setTrueScale(sim, true);
  if (!isBlackHole) sim.relativity = true;
  sim.recenter();
  const assumed = [o.mx ? '' : `the ${isBlackHole ? 'black hole' : 'neutron star'} mass`, o.mo ? '' : 'the companion mass', period.assumed ? 'the orbit' : ''].filter(Boolean);
  const tip = `${describeObject(o)}${assumed.length ? ` Not measured, so typical values are shown for ${assumed.join(', ')}.` : ''}`;
  return { cameraDistance: Math.max(a * 3.2, 2e-4), timeScale: years / 6, elevation: 0.7, tip };
}

/** A real Wolf–Rayet star: a massive, hot, stripped star. Its mass follows its subtype (WN ~16, WC ~12, WO ~10 M☉). */
export function loadWolfRayet(sim: Simulation, o: WolfRayet): SceneSetup {
  const mass = o.sptype.startsWith('WO') ? 10 : o.sptype.startsWith('WC') ? 12 : 16;
  // Almost at the end of its life: evolved far enough to be bright and hot.
  sim.addBody({ name: o.name, kind: 'star', mass, age: 0.85 * mainSequenceLifetime(mass) });
  sim.recenter();
  return { cameraDistance: 1.2, timeScale: 0.05, elevation: 0.45, tip: describeObject({ kind: 'wr', ...o }) };
}

/**
 * A real nova or cataclysmic variable from the Galaxy Map: the white dwarf, with its accretion
 * disc unless it is magnetic, and the donor star on the catalogued orbit at real sizes. Masses
 * the catalogue lacks take typical values (whiteDwarfMasses), and the tip says so.
 */
export function loadWhiteDwarfBinary(sim: Simulation, o: ({ kind: 'nova' } & Nova) | ({ kind: 'cv' } & CataclysmicVariable)): SceneSetup {
  const { wd, donor, donorKind, assumed } = whiteDwarfMasses(o);
  const period = whiteDwarfPeriodDays(o);
  const magnetic = (o.kind === 'cv' && !!o.magnetic) || !!o.types?.some((t) => t === 'AM' || t === 'IP' || t === 'DQ');
  // Polars have no disc: the field channels the gas straight onto the poles.
  const primary = sim.addBody({ name: o.name, kind: 'whitedwarf', mass: wd, tag: magnetic && !o.types?.includes('IP') ? 'magnetic' : 'accreting' });
  const years = period.days / 365.25;
  const a = Math.cbrt(years * years * (wd + donor));
  const donorName = donorKind === 'whitedwarf' ? 'Helium white dwarf donor' : donorKind === 'giant' ? 'Red giant donor' : 'Donor star';
  // The donor is old: a red dwarf is ageless on this clock, a giant donor has left the main sequence.
  const age = donorKind === 'giant' ? 1.02 * mainSequenceLifetime(donor) : Math.min(5e9, 0.5 * mainSequenceLifetime(donor));
  addOrbiting(sim, primary, { name: donorName, kind: donorKind, mass: donor, age, color: donorKind === 'star' && donor < 0.6 ? rgbToHex(kelvinToRgb(3300)) : undefined }, { a, e: 0, nu: Math.PI * 0.6 });
  setTrueScale(sim, true);
  sim.recenter();
  const notes = [...assumed, period.assumed ? 'the orbit' : ''].filter(Boolean);
  const tip = `${describeObject(o)}${notes.length ? ` Not measured, so typical values are shown for ${notes.join(', ')}.` : ''}`;
  return { cameraDistance: Math.max(a * 3.2, 2e-4), timeScale: years / 6, elevation: 0.5, tip };
}

/**
 * A real classical Cepheid: a yellow supergiant whose mass follows its age, pulsing at its
 * catalogued period (BodyVisual reads the `cepheid:<days>` tag). One pulse takes about four
 * seconds at the scene's speed.
 */
export function loadCepheid(sim: Simulation, o: Cepheid): SceneSetup {
  const mass = cepheidMass(o);
  // Just past the main sequence, crossing the instability strip as a yellow (≈5,900 K) supergiant.
  sim.addBody({ name: o.common ? `${o.name} (${o.common})` : o.name, kind: 'giant', mass, age: 1.01 * mainSequenceLifetime(mass), color: rgbToHex(kelvinToRgb(5900)), tag: `cepheid:${o.per}` });
  sim.recenter();
  const years = o.per / 365.25;
  return { cameraDistance: radiusFor('giant', mass) * 7, timeScale: years / 4, elevation: 0.4, tip: describeObject({ kind: 'cep', ...o }) };
}

/**
 * A real maser source: a massive protostar still in its gas disc, with a few young neighbours
 * (seeded by its name; the catalogue places only the maser spots), or a red supergiant for the
 * evolved sources. The masers themselves are smaller than the Solar System and are not drawn.
 */
export function loadMaser(sim: Simulation, o: Maser): SceneSetup {
  const rand = mulberry32(o.gname.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
  if (o.evolved) {
    sim.addBody({ name: o.name, kind: 'giant', mass: 20, age: 1.05 * mainSequenceLifetime(20) });
    sim.recenter();
    return { cameraDistance: 12, timeScale: 0.05, elevation: 0.4, tip: describeObject({ kind: 'maser', ...o }) };
  }
  const star = sim.addBody({ name: `${o.name} protostar`, kind: 'star', mass: 20, age: 0 });
  for (let i = 0; i < 6; i++) {
    const mass = 0.4 + rand() * 3;
    addOrbiting(sim, star, { name: `Young star ${i + 1}`, kind: 'star', mass, age: 0 }, { a: 60 + rand() * 240, e: rand() * 0.5, inc: (rand() - 0.5) * 1.2, lan: rand() * Math.PI * 2, argp: rand() * Math.PI * 2, nu: rand() * Math.PI * 2 });
  }
  // The protostar's gas disc stays for the whole scene.
  sim.formation = { starId: star.id, enhancement: 10, speedup: FORMATION_SPEEDUP, gasUntil: sim.time + 1e9 };
  sim.recenter();
  const where = o.arm && ARMS[o.arm] ? ` in ${ARMS[o.arm]}` : '';
  return { cameraDistance: 30, focus: star.name, timeScale: 2, elevation: 0.5, tip: `${describeObject({ kind: 'maser', ...o })} The 20 M☉ protostar, its disc and its six young neighbours${where} are illustrative, not measured.` };
}

/** A Galaxy Map object of any kind, in the Sandbox. */
export function loadGalacticObject(sim: Simulation, o: GalacticObject): SceneSetup {
  switch (o.kind) {
    case 'wr':
      return loadWolfRayet(sim, o);
    case 'nova':
    case 'cv':
      return loadWhiteDwarfBinary(sim, o);
    case 'cep':
      return loadCepheid(sim, o);
    case 'maser':
      return loadMaser(sim, o);
    default:
      return loadXrayBinary(sim, o);
  }
}

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
  for (const { r: rKm, ring } of sampleRingRadii(data.rings, count, Math.random, data.ringGaps)) {
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
  protoDisk,
  giantImpact,
  ringmaker,
  binaryStar,
  figureEight,
  rogueStar,
  blackHoleFeast,
  supernova,
  supernovaZoo,
  sunsFuture,
  precession,
  inspiral,
  pulsarPlanets,
  hulseTaylor,
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
