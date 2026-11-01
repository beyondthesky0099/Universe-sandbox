import type { StarSystemSpec } from '../procgen/starSystem';
import type { Body } from './body';
import { kelvinToRgb, starColor } from './color';
import { keplerToState, OrbitalElements } from './orbits';
import type { Simulation } from './simulation';
import { EARTH_MASS, G, JUPITER_MASS } from './units';

export interface SceneSetup {
  /** Suggested camera distance from the origin (AU). */
  cameraDistance: number;
  /** Suggested simulation speed (years per real second). */
  timeScale: number;
  /** Optional camera elevation angle (rad above the ecliptic). */
  elevation?: number;
  /** Name of a body to select and follow after loading. */
  focus?: string;
  /** Short tip shown after loading. */
  tip?: string;
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
  init: { name: string; mass: number; color?: number; kind?: Body['kind'] },
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

const solarSystem: Preset = {
  id: 'solar',
  name: 'Solar System',
  description: 'The Sun and eight planets with real masses and orbits, plus an asteroid belt.',
  load(sim) {
    const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1, color: starColor(1) });
    const planets: [string, number, number, number, number, number, Body['kind']][] = [
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
    for (const [name, m, a, e, inc, color, kind] of planets) {
      addOrbiting(sim, sun, { name, mass: m * EARTH_MASS, color, kind }, {
        a,
        e,
        inc: inc * deg,
        lan: Math.random() * Math.PI * 2,
        argp: Math.random() * Math.PI * 2,
        nu: Math.random() * Math.PI * 2,
      });
    }
    addParticleDisk(sim, sun, { count: 1500, inner: 2.2, outer: 3.3, thickness: 0.04, color: [0.62, 0.58, 0.52] });
    sim.recenter();
    return { cameraDistance: 9, timeScale: 0.4, elevation: 0.6 };
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

export const PRESETS: Preset[] = [
  solarSystem,
  protoplanetary,
  giantImpact,
  ringmaker,
  binaryStar,
  figureEight,
  rogueStar,
  blackHoleFeast,
  supernova,
  galacticCore,
  starCluster,
  selfGravitatingGalaxy,
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
  const star = sim.addBody({ name: spec.star.name, kind: 'star', mass: spec.star.mass, color: spec.star.color });
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
