/**
 * Real double stars near the Sun, on their measured orbits, for the Sandbox (and the search):
 *
 * - Sirius A and its white-dwarf companion Sirius B (Bond et al. 2017, ApJ 840, 70): P = 50.128 yr,
 *   a = 7.4957″ at a parallax of 376.68 mas (19.9 AU), e = 0.5914, periastron 1994.572; masses
 *   2.063 and 1.018 M☉.
 * - Alpha Centauri A and B (Pourbaix & Boffin 2016, A&A 586, A90): P = 79.91 yr, a = 17.66″ at
 *   747.17 mas (23.6 AU), e = 0.524, periastron 1955.66; masses 1.133 and 0.972 M☉. Proxima
 *   Centauri orbits the pair at a = 8,700 AU, e = 0.50, now near its farthest (Kervella, Thévenin
 *   & Lovis 2017, A&A 598, L7); 0.122 M☉.
 * - Procyon A and its white-dwarf companion Procyon B (Bond et al. 2015, ApJ 813, 106):
 *   P = 40.84 yr, a = 4.3075″ at 284.56 mas (15.1 AU), e = 0.398, periastron 1967.97; masses 1.478
 *   and 0.592 M☉.
 *
 * Each pair starts where it is on its orbit today (from the periastron time), in the orbit's
 * own plane (its tilt to our line of sight doesn't matter in the Sandbox).
 */
import type { SceneSetup, Preset } from './presets';
import type { Simulation } from './simulation';
import type { BodyKind } from './body';
import { keplerToState } from './orbits';
import { G } from './units';

interface Pair {
  id: string;
  name: string;
  description: string;
  a: [string, number, BodyKind, number]; // name, mass (M☉), kind, age (years)
  b: [string, number, BodyKind];
  axisAu: number;
  e: number;
  periodYears: number;
  periastronYear: number;
  distanceLy: number;
  third?: { name: string; mass: number; axisAu: number; e: number; nuRad: number };
  tip: string;
}

const PAIRS: Pair[] = [
  {
    id: 'sirius',
    name: 'Sirius A and B',
    description: 'The brightest star in our sky and its white-dwarf companion, on their measured 50-year orbit, 8.6 light-years away.',
    a: ['Sirius A', 2.063, 'star', 2.3e8],
    b: ['Sirius B', 1.018, 'whitedwarf'],
    axisAu: 19.9,
    e: 0.5914,
    periodYears: 50.128,
    periastronYear: 1994.572,
    distanceLy: 8.6,
    tip: 'Sirius B is a white dwarf: the core left when a star once bigger than Sirius A shed its outer layers, now a Sun’s mass packed into a ball the size of Earth. Their orbit takes 50.1 years (Bond et al. 2017).',
  },
  {
    id: 'alpha-centauri',
    name: 'Alpha Centauri A and B',
    description: 'The nearest stars: two Sun-like stars on an 80-year orbit, with Proxima Centauri far out around them, 4.3 light-years away.',
    a: ['Alpha Centauri A', 1.133, 'star', 5e9],
    b: ['Alpha Centauri B', 0.972, 'star'],
    axisAu: 23.6,
    e: 0.524,
    periodYears: 79.91,
    periastronYear: 1955.66,
    distanceLy: 4.37,
    third: { name: 'Proxima Centauri', mass: 0.122, axisAu: 8700, e: 0.5, nuRad: Math.PI * 0.92 },
    tip: 'Alpha Centauri A and B swing between 11 and 36 AU apart every 80 years (Pourbaix & Boffin 2016). Proxima, the nearest star to the Sun, circles them 8,700 AU out, taking over half a million years (Kervella et al. 2017): zoom out to find it.',
  },
  {
    id: 'procyon',
    name: 'Procyon A and B',
    description: 'A bright star and its faint white-dwarf companion on their 41-year orbit, 11.5 light-years away.',
    a: ['Procyon A', 1.478, 'star', 1.9e9],
    b: ['Procyon B', 0.592, 'whitedwarf'],
    axisAu: 15.1,
    e: 0.398,
    periodYears: 40.84,
    periastronYear: 1967.97,
    distanceLy: 11.5,
    tip: 'Procyon A is starting to swell into a subgiant; its companion Procyon B is a white dwarf of 0.59 Suns. Their orbit takes 40.8 years (Bond et al. 2015).',
  },
];

/** Kepler's equation for the true anomaly at a fraction of the orbit since periastron. */
function trueAnomaly(phase: number, e: number): number {
  const M = 2 * Math.PI * (phase - Math.floor(phase));
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 50; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
}

export function loadRealBinary(sim: Simulation, p: Pair, date = new Date()): SceneSetup {
  const year = 1970 + date.getTime() / (365.25 * 86400000);
  const [an, am, ak, age] = p.a;
  const [bn, bm, bk] = p.b;
  sim.addBody({ name: an, mass: am, kind: ak, age });
  const nu = trueAnomaly((year - p.periastronYear) / p.periodYears, p.e);
  const { pos, vel } = keplerToState(G * sim.gravityScale * (am + bm), { a: p.axisAu, e: p.e, nu });
  sim.addBody({ name: bn, mass: bm, kind: bk, age, x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z });
  if (p.third) {
    const t = p.third;
    const s = keplerToState(G * sim.gravityScale * (am + bm + t.mass), { a: t.axisAu, e: t.e, nu: t.nuRad, inc: 0.6 });
    // Around the pair's centre of mass.
    const f = bm / (am + bm);
    sim.addBody({ name: t.name, mass: t.mass, kind: 'star', age, x: pos.x * f + s.pos.x, y: pos.y * f + s.pos.y, z: pos.z * f + s.pos.z, vx: vel.x * f + s.vel.x, vy: vel.y * f + s.vel.y, vz: vel.z * f + s.vel.z });
  }
  sim.recenter();
  return { cameraDistance: p.axisAu * 3, timeScale: p.periodYears / 40, elevation: 0.6, tip: p.tip };
}

/** As Sandbox scenarios (the Scenes pane, and search). */
export const REAL_BINARY_PRESETS: Preset[] = PAIRS.map((p) => ({ id: p.id, name: p.name, description: p.description, load: (sim: Simulation) => loadRealBinary(sim, p) }));

export const REAL_BINARIES = PAIRS;
