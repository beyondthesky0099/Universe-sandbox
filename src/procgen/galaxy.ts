import { kelvinToRgb, starTemperature } from '../sim/color';
import type { GalaxyForm } from '../sim/galaxies';
import { galaxyName, properName } from './names';
import { Rng, gaussian, hash32, intRange, mulberry32, range } from './rng';
import { generateStarSystem, starSummary, type SpectralClass } from './starSystem';

export interface GalaxyData {
  seed: number;
  name: string;
  arms: number;
  /** Overall shape (procedural galaxies are spirals unless generated as a stand-in for a real one). */
  form: GalaxyForm;
  radius: number;
  /** Selectable stars, each backed by a deterministic star system. */
  stars: {
    count: number;
    positions: Float32Array;
    colors: Float32Array;
    sizes: Float32Array;
    seeds: Uint32Array;
  };
  /** Star names, parallel to stars.seeds. */
  names: string[];
  /** Where the Sun sits ("you are here"): on an arm, about halfway out. */
  sol: [number, number, number];
  clusters: ClusterInfo[];
  nebulae: NebulaInfo[];
  /** Dark dust lanes trailing the spiral arms. */
  dust: { count: number; positions: Float32Array; sizes: Float32Array };
  /** Unresolved background glow (purely visual). */
  glow: {
    count: number;
    positions: Float32Array;
    colors: Float32Array;
    sizes: Float32Array;
  };
}

export interface ClusterInfo {
  name: string;
  kind: 'open' | 'globular';
  x: number;
  y: number;
  z: number;
  sigma: number;
}

export interface NebulaInfo {
  x: number;
  y: number;
  z: number;
  size: number;
  color: [number, number, number];
  seed: number;
  /** Real nebulae (Milky Way only) have names. */
  name?: string;
}

const CLASS_SIZE: Record<SpectralClass, number> = { O: 3.4, B: 2.7, A: 2.1, F: 1.7, G: 1.5, K: 1.25, M: 1.0 };

export const GALAXY_RADIUS = 100;

export function starSeed(galaxySeed: number, index: number): number {
  return hash32(galaxySeed, index, 0x5eed);
}

interface ShapeParams {
  arms: number;
  twist: number;
  armSpread: number;
  bulgeFraction: number;
  diskScale: number;
  thickness: number;
  /** Use the Milky Way's real structure instead of a random spiral. */
  mw?: boolean;
  /** Share of disk stars that follow the spiral arms (0 for armless disks). */
  armFraction?: number;
  /** Bulge size and height as fractions of the galaxy radius. */
  bulgeScale?: number;
  bulgeHeight?: number;
  /** Irregular galaxies: star-forming clumps as [x, z, sigma] in units of the radius. */
  clumps?: [number, number, number][];
}

/** Options for generating a stand-in for a real galaxy of a given form. */
export interface GalaxyOptions {
  name?: string;
  form?: GalaxyForm;
}

// ---------------------------------------------------------------------------
// The Milky Way: an approximate model of its real structure, after Reid et al. (2019) and
// Vallée (2017). Four logarithmic arms with a 12° pitch, the Local (Orion) Spur where the Sun
// is, and a central bar 27° from the Sun–centre line.

/** Seed of the default galaxy, which is the Milky Way. */
export const MILKY_WAY_SEED = 1;
/** Map units per kiloparsec: GALAXY_RADIUS (100) spans 15 kpc. */
export const UNITS_PER_KPC = 100 / 15;
/** Distance of the Sun from the Galactic Centre (kpc) and height above the plane. */
export const SUN_R0_KPC = 8.2;
export const SUN_Z_KPC = 0.02;
const MW_PITCH = (12 * Math.PI) / 180;
/** Each arm's radius (kpc) in the direction of the Sun (galactocentric angle π). */
export const MW_ARMS: { name: string; rSun: number; weight: number }[] = [
  { name: 'Scutum–Centaurus Arm', rSun: 5.15, weight: 1.2 },
  { name: 'Sagittarius–Carina Arm', rSun: 7.2, weight: 1 },
  { name: 'Perseus Arm', rSun: 10.05, weight: 1.2 },
  { name: 'Outer (Norma–Cygnus) Arm', rSun: 14.0, weight: 0.6 },
];
const MW_BAR_ANGLE = Math.PI - (27 * Math.PI) / 180; // the near end points toward positive l
const MW_BAR_HALF_KPC = 4.5;

/** Galactocentric kpc → map units. Frame: centre at the origin, Sun at (−R0, 0, z0), y toward l = 90°, z toward the north galactic pole. */
export function galactocentricToMap(gx: number, gy: number, gz: number): [number, number, number] {
  return [gx * UNITS_PER_KPC, gz * UNITS_PER_KPC, -gy * UNITS_PER_KPC];
}

/** Galactic longitude/latitude (degrees) and distance from the Sun (kpc) → map units. */
export function galacticToMap(lDeg: number, bDeg: number, dKpc: number): [number, number, number] {
  const l = (lDeg * Math.PI) / 180, b = (bDeg * Math.PI) / 180;
  const hx = dKpc * Math.cos(b) * Math.cos(l);
  const hy = dKpc * Math.cos(b) * Math.sin(l);
  const hz = dKpc * Math.sin(b);
  return galactocentricToMap(hx - SUN_R0_KPC, hy, hz + SUN_Z_KPC);
}

/**
 * Equatorial J2000 (RA, Dec) → galactic (l, b), degrees. Uses the J2000 north galactic pole
 * (RA 192.85948°, Dec 27.12825°) and the galactic longitude of the north celestial pole
 * (122.93192°).
 */
export function equatorialToGalactic(raDeg: number, decDeg: number): [number, number] {
  const D = Math.PI / 180;
  const aG = 192.85948 * D, dG = 27.12825 * D, lNCP = 122.93192 * D;
  const a = raDeg * D, d = decDeg * D;
  const sinB = Math.sin(d) * Math.sin(dG) + Math.cos(d) * Math.cos(dG) * Math.cos(a - aG);
  const b = Math.asin(Math.max(-1, Math.min(1, sinB)));
  const y = Math.cos(d) * Math.sin(a - aG);
  const x = Math.sin(d) * Math.cos(dG) - Math.cos(d) * Math.sin(dG) * Math.cos(a - aG);
  let l = lNCP - Math.atan2(y, x);
  l = ((l % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return [l / D, b / D];
}

/** Point on arm k at radius r (kpc): galactocentric angle (trailing arms for clockwise rotation). */
function armAngle(rSun: number, r: number): number {
  return Math.PI + Math.log(r / rSun) / Math.tan(MW_PITCH);
}

function sampleMilkyWay(rng: Rng, s: ShapeParams, out: Float32Array, k: number): number {
  const R = GALAXY_RADIUS;
  const u = rng();
  let gx: number, gy: number, gz: number;
  if (u < s.bulgeFraction) {
    // Bulge and bar: a triaxial cloud along the bar axis.
    const along = gaussian(rng) * MW_BAR_HALF_KPC * 0.45;
    const across = gaussian(rng) * 0.7;
    gx = along * Math.cos(MW_BAR_ANGLE) - across * Math.sin(MW_BAR_ANGLE);
    gy = along * Math.sin(MW_BAR_ANGLE) + across * Math.cos(MW_BAR_ANGLE);
    gz = gaussian(rng) * 0.45;
  } else {
    // Exponential disk (scale length 2.6 kpc), mostly along arms, starting at the bar's end.
    let r: number;
    do r = -Math.log(1 - rng()) * 2.6 + 1.5;
    while (r > 15);
    let theta: number;
    const v = rng();
    if (r < 3.8) {
      // Inside the bar's reach the arms are not well defined: a smooth inner disk.
      theta = rng() * Math.PI * 2;
    } else if (v < 0.07 && r > 7.4 && r < 9.6) {
      // The Local (Orion) Spur: a short arm segment through the Sun.
      theta = Math.PI + Math.log(r / 8.35) / Math.tan((10 * Math.PI) / 180) + (gaussian(rng) * 0.25) / r;
    } else if (v < 0.75) {
      const total = MW_ARMS.reduce((t, a) => t + a.weight, 0);
      let pick = rng() * total;
      const arm = MW_ARMS.find((a) => (pick -= a.weight) <= 0) ?? MW_ARMS[0];
      theta = armAngle(arm.rSun, r) + (gaussian(rng) * 0.35) / Math.max(1, r * 0.25);
    } else {
      theta = rng() * Math.PI * 2;
    }
    gx = Math.cos(theta) * r;
    gy = Math.sin(theta) * r;
    // Scale height ~300 pc, flaring a little outward.
    gz = gaussian(rng) * 0.3 * (1 + r / 15);
  }
  const [x, y, z] = galactocentricToMap(gx, gy, gz);
  out[k] = x;
  out[k + 1] = y;
  out[k + 2] = z;
  return Math.hypot(x, z) / R;
}

/**
 * Real clusters with galactic coordinates (l, b in degrees) and distances (kpc), as in the bundled
 * catalogues (public/data/clusters.json): Harris (1996, 2010 edition) for the globulars, Hunt &
 * Reffert (2023) for the open clusters, so their labels sit on the clusters' stars
 * (procgen/clusterStars.ts). The Beehive has no name in Hunt & Reffert; its values are from the
 * literature.
 */
export const MW_CLUSTERS: { name: string; kind: 'open' | 'globular'; l: number; b: number; d: number; sigmaPc: number }[] = [
  { name: 'Pleiades (M45)', kind: 'open', l: 166.53, b: -23.57, d: 0.135, sigmaPc: 4 },
  { name: 'Hyades', kind: 'open', l: 179.87, b: -22.22, d: 0.047, sigmaPc: 5 },
  { name: 'Beehive (M44)', kind: 'open', l: 205.9, b: 32.5, d: 0.187, sigmaPc: 4 },
  { name: 'Double Cluster (h & χ Persei)', kind: 'open', l: 134.64, b: -3.73, d: 2.28, sigmaPc: 12 },
  { name: 'Wild Duck Cluster (M11)', kind: 'open', l: 27.3, b: -2.77, d: 2.233, sigmaPc: 6 },
  { name: 'Omega Centauri', kind: 'globular', l: 309.1, b: 14.97, d: 5.1, sigmaPc: 40 },
  { name: '47 Tucanae', kind: 'globular', l: 305.9, b: -44.89, d: 4.3, sigmaPc: 30 },
  { name: 'Hercules Cluster (M13)', kind: 'globular', l: 59.01, b: 40.91, d: 7.0, sigmaPc: 25 },
  { name: 'M4', kind: 'globular', l: 350.97, b: 15.97, d: 2.2, sigmaPc: 15 },
  { name: 'M22', kind: 'globular', l: 9.89, b: -7.55, d: 3.2, sigmaPc: 20 },
  { name: 'M3', kind: 'globular', l: 42.21, b: 78.71, d: 10.0, sigmaPc: 25 },
  { name: 'M15', kind: 'globular', l: 65.01, b: -27.31, d: 10.2, sigmaPc: 20 },
];

/** Real nebulae with approximate galactic coordinates and distances (kpc). */
export const MW_NEBULAE: { name: string; l: number; b: number; d: number; sizePc: number; color: [number, number, number] }[] = [
  { name: 'Orion Nebula (M42)', l: 209.0, b: -19.4, d: 0.41, sizePc: 60, color: [1, 0.35, 0.5] },
  { name: 'Carina Nebula', l: 287.6, b: -0.6, d: 2.3, sizePc: 150, color: [1, 0.4, 0.45] },
  { name: 'Eagle Nebula (M16)', l: 17.0, b: 0.8, d: 1.74, sizePc: 100, color: [0.95, 0.45, 0.4] },
  { name: 'Lagoon Nebula (M8)', l: 6.0, b: -1.2, d: 1.25, sizePc: 90, color: [1, 0.35, 0.55] },
  { name: 'Rosette Nebula', l: 206.3, b: -2.1, d: 1.6, sizePc: 80, color: [1, 0.3, 0.4] },
  { name: 'Cygnus X', l: 80.0, b: 0.8, d: 1.4, sizePc: 200, color: [1, 0.45, 0.5] },
  { name: 'Crab Nebula (M1)', l: 184.6, b: -5.8, d: 2.0, sizePc: 40, color: [0.45, 0.65, 1] },
  { name: 'Ring Nebula (M57)', l: 63.2, b: 14.0, d: 0.79, sizePc: 30, color: [0.55, 0.95, 0.85] },
  { name: 'North America Nebula', l: 85.6, b: -0.7, d: 0.8, sizePc: 70, color: [1, 0.35, 0.45] },
  { name: 'Trifid Nebula (M20)', l: 7.0, b: -0.3, d: 1.6, sizePc: 50, color: [0.5, 0.6, 1] },
];

function samplePosition(rng: Rng, s: ShapeParams, out: Float32Array, k: number): number {
  if (s.mw) return sampleMilkyWay(rng, s, out, k);
  const R = GALAXY_RADIUS;
  if (rng() < s.bulgeFraction) {
    const bs = s.bulgeScale ?? 0.11;
    out[k] = gaussian(rng) * R * bs;
    out[k + 1] = gaussian(rng) * R * (s.bulgeHeight ?? 0.07);
    out[k + 2] = gaussian(rng) * R * bs;
    return Math.hypot(out[k], out[k + 2]) / R;
  }
  if (s.clumps && rng() < 0.75) {
    const [cx, cz, sigma] = s.clumps[Math.floor(rng() * s.clumps.length)];
    out[k] = (cx + gaussian(rng) * sigma) * R;
    out[k + 1] = gaussian(rng) * R * s.thickness * 2;
    out[k + 2] = (cz + gaussian(rng) * sigma) * R;
    return Math.min(1, Math.hypot(out[k], out[k + 2]) / R);
  }
  let r: number;
  do r = -Math.log(1 - rng()) * s.diskScale * R + R * 0.04;
  while (r > R);
  const t = r / R;
  let theta: number;
  if (rng() < (s.armFraction ?? 0.72)) {
    const arm = Math.floor(rng() * s.arms);
    theta = (arm / s.arms) * Math.PI * 2 + t * s.twist + gaussian(rng) * s.armSpread * (1 - 0.4 * t);
  } else {
    theta = rng() * Math.PI * 2;
  }
  out[k] = Math.cos(theta) * r;
  out[k + 1] = gaussian(rng) * R * s.thickness * (1 - 0.6 * t);
  out[k + 2] = Math.sin(theta) * r;
  return t;
}

export function generateGalaxy(seed: number, starCount = 30000, glowCount = 60000, dustCount = 9000, opts: GalaxyOptions = {}): GalaxyData {
  const rng = mulberry32(hash32(seed, 1));
  const shape: ShapeParams = {
    arms: intRange(rng, 2, 5),
    twist: range(rng, 3.5, 7.5) * (rng() < 0.5 ? 1 : -1),
    armSpread: range(rng, 0.22, 0.42),
    bulgeFraction: range(rng, 0.1, 0.22),
    diskScale: range(rng, 0.25, 0.38),
    thickness: range(rng, 0.015, 0.03),
  };
  const mw = seed === MILKY_WAY_SEED;
  if (mw) Object.assign(shape, { arms: 4, bulgeFraction: 0.14, mw: true });
  const form = mw ? 'spiral' : (opts.form ?? 'spiral');
  // Stand-ins for real galaxies of other forms: no arms, little or no gas and dust.
  if (form === 'elliptical') Object.assign(shape, { bulgeFraction: 1, bulgeScale: 0.3, bulgeHeight: 0.2 });
  if (form === 'dwarf spheroidal') Object.assign(shape, { bulgeFraction: 1, bulgeScale: 0.32, bulgeHeight: 0.26 });
  if (form === 'lenticular') Object.assign(shape, { bulgeFraction: 0.45, bulgeScale: 0.16, bulgeHeight: 0.09, armFraction: 0 });
  if (form === 'irregular') {
    const clumpRng = mulberry32(hash32(seed, 9));
    const n = intRange(clumpRng, 3, 7);
    shape.clumps = Array.from({ length: n }, () => [range(clumpRng, -0.5, 0.5), range(clumpRng, -0.5, 0.5), range(clumpRng, 0.08, 0.2)] as [number, number, number]);
    Object.assign(shape, { bulgeFraction: 0.04, armFraction: 0, thickness: 0.05 });
  }
  const gasPoor = form === 'elliptical' || form === 'dwarf spheroidal' || form === 'lenticular';
  if (gasPoor) dustCount = 0;
  const name = mw ? 'Milky Way' : (opts.name ?? galaxyName(mulberry32(hash32(seed, 2))));
  const R = GALAXY_RADIUS;

  // Star clusters: open clusters in the disk, globular clusters in the halo.
  const clusterRng = mulberry32(hash32(seed, 5));
  const clusters: ClusterInfo[] = [];
  const tmp = new Float32Array(3);
  if (mw) {
    for (const c of MW_CLUSTERS) {
      const [x, y, z] = galacticToMap(c.l, c.b, c.d);
      clusters.push({ name: c.name, kind: c.kind, x, y, z, sigma: Math.max(0.08, (c.sigmaPc / 1000) * UNITS_PER_KPC * 4) });
    }
  }
  const openCount = mw || gasPoor ? 0 : intRange(clusterRng, 8, 14);
  for (let i = 0; i < openCount; i++) {
    samplePosition(clusterRng, { ...shape, bulgeFraction: 0 }, tmp, 0);
    clusters.push({ name: `${properName(clusterRng)} Cluster`, kind: 'open', x: tmp[0], y: tmp[1], z: tmp[2], sigma: range(clusterRng, 0.6, 1.6) });
  }
  const globCount = mw ? 0 : intRange(clusterRng, 5, 9);
  for (let i = 0; i < globCount; i++) {
    const u = clusterRng() * 2 - 1;
    const th = clusterRng() * Math.PI * 2;
    const r = R * range(clusterRng, 0.35, 1.1);
    const sxy = Math.sqrt(1 - u * u);
    clusters.push({
      name: `${properName(clusterRng)} Globular`,
      kind: 'globular',
      x: Math.cos(th) * sxy * r,
      y: u * r * 0.6,
      z: Math.sin(th) * sxy * r,
      sigma: range(clusterRng, 1.2, 2.4),
    });
  }

  // Selectable stars.
  const sp = new Float32Array(starCount * 3);
  const sc = new Float32Array(starCount * 3);
  const ss = new Float32Array(starCount);
  const seeds = new Uint32Array(starCount);
  const names: string[] = new Array(starCount);
  const posRng = mulberry32(hash32(seed, 3));
  for (let i = 0; i < starCount; i++) {
    const k = i * 3;
    let t: number;
    if (posRng() < (mw ? 0.02 : 0.07)) {
      const c = clusters[Math.floor(posRng() * clusters.length)];
      sp[k] = c.x + gaussian(posRng) * c.sigma;
      sp[k + 1] = c.y + gaussian(posRng) * c.sigma;
      sp[k + 2] = c.z + gaussian(posRng) * c.sigma;
      t = 1;
    } else {
      t = samplePosition(posRng, shape, sp, k);
    }
    // Dim the dense core so overlapping additive sprites don't saturate to white.
    const dim = 0.35 + 0.65 * Math.min(1, t * 4);
    const s = starSeed(seed, i);
    seeds[i] = s;
    const summary = starSummary(s);
    names[i] = summary.name;
    const [r, g, b] = kelvinToRgb(summary.temperature);
    sc[k] = r * dim;
    sc[k + 1] = g * dim;
    sc[k + 2] = b * dim;
    ss[i] = CLASS_SIZE[summary.spectralClass];
  }

  // Background glow: warm core, blue-white arms.
  const gp = new Float32Array(glowCount * 3);
  const gc = new Float32Array(glowCount * 3);
  const gs = new Float32Array(glowCount);
  const glowRng = mulberry32(hash32(seed, 4));
  const core = kelvinToRgb(4200);
  const arm = kelvinToRgb(starTemperature(4));
  for (let i = 0; i < glowCount; i++) {
    const k = i * 3;
    const t = Math.min(1, samplePosition(glowRng, shape, gp, k) * 1.6);
    const jitter = (0.75 + glowRng() * 0.25) * (0.2 + 0.8 * Math.min(1, t * 2.2));
    gc[k] = (core[0] * (1 - t) + arm[0] * t) * jitter;
    gc[k + 1] = (core[1] * (1 - t) + arm[1] * t) * jitter;
    gc[k + 2] = (core[2] * (1 - t) + arm[2] * t) * jitter;
    gs[i] = range(glowRng, 2, 6);
  }

  // Dust lanes: trail slightly behind each arm, thin and dark.
  const dustRng = mulberry32(hash32(seed, 6));
  const dp = new Float32Array(dustCount * 3);
  const ds = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    if (mw) {
      // Dust lanes on the inner (concave) edge of each arm.
      let rk: number;
      do rk = -Math.log(1 - dustRng()) * 2.6 + 3;
      while (rk > 14);
      const arm = MW_ARMS[Math.floor(dustRng() * MW_ARMS.length)];
      const th = armAngle(arm.rSun * 0.96, rk) + (gaussian(dustRng) * 0.12) / Math.max(1, rk * 0.25);
      const [x, y, z] = galactocentricToMap(Math.cos(th) * rk, Math.sin(th) * rk, gaussian(dustRng) * 0.08);
      dp[i * 3] = x;
      dp[i * 3 + 1] = y;
      dp[i * 3 + 2] = z;
      ds[i] = range(dustRng, 3, 8);
      continue;
    }
    let r: number;
    do r = -Math.log(1 - dustRng()) * shape.diskScale * R + R * 0.12;
    while (r > R * 0.95);
    const t = r / R;
    const a = Math.floor(dustRng() * shape.arms);
    const theta = (a / shape.arms) * Math.PI * 2 + t * shape.twist - 0.18 * Math.sign(shape.twist) + gaussian(dustRng) * shape.armSpread * 0.35;
    dp[i * 3] = Math.cos(theta) * r;
    dp[i * 3 + 1] = gaussian(dustRng) * R * shape.thickness * 0.4;
    dp[i * 3 + 2] = Math.sin(theta) * r;
    ds[i] = range(dustRng, 3, 8);
  }

  // Nebulae: glowing gas clouds along the arms.
  const nebRng = mulberry32(hash32(seed, 7));
  const nebulae: NebulaInfo[] = [];
  if (mw) {
    for (const n of MW_NEBULAE) {
      const [x, y, z] = galacticToMap(n.l, n.b, n.d);
      nebulae.push({ x, y, z, size: Math.max(1.2, (n.sizePc / 1000) * UNITS_PER_KPC * 5), color: n.color, seed: Math.floor(nebRng() * 1e9), name: n.name });
    }
  }
  const nebCount = mw || gasPoor ? 0 : form === 'irregular' ? intRange(nebRng, 10, 20) : intRange(nebRng, 35, 60);
  const palette: [number, number, number][] = [
    [1, 0.35, 0.5],
    [0.95, 0.3, 0.4],
    [0.45, 0.65, 1],
    [0.55, 0.95, 0.85],
    [1, 0.6, 0.35],
  ];
  for (let i = 0; i < nebCount; i++) {
    samplePosition(nebRng, { ...shape, bulgeFraction: 0, armSpread: shape.armSpread * 0.6 }, tmp, 0);
    nebulae.push({
      x: tmp[0],
      y: tmp[1],
      z: tmp[2],
      size: range(nebRng, 2.5, 9),
      color: palette[Math.floor(nebRng() * palette.length)],
      seed: Math.floor(nebRng() * 1e9),
    });
  }

  const solT = 0.55;
  const solTheta = solT * shape.twist + 0.12;
  const sol: [number, number, number] = mw ? galactocentricToMap(-SUN_R0_KPC, 0, SUN_Z_KPC) : [Math.cos(solTheta) * solT * R, 0.4, Math.sin(solTheta) * solT * R];

  return {
    seed,
    name,
    sol,
    arms: shape.arms,
    form,
    radius: GALAXY_RADIUS,
    stars: { count: starCount, positions: sp, colors: sc, sizes: ss, seeds },
    names,
    clusters,
    nebulae,
    dust: { count: dustCount, positions: dp, sizes: ds },
    glow: { count: glowCount, positions: gp, colors: gc, sizes: gs },
  };
}

/** Feature flags used by galaxy-map filters. */
export const FEATURE = {
  habitable: 1,
  gasGiant: 2,
  binary: 4,
  belt: 8,
  massive: 16,
  manyPlanets: 32,
  moons: 64,
} as const;

export type FeatureName = keyof typeof FEATURE;

/** Compute a star's feature flags from its generated system. */
export function systemFeatures(starSeedValue: number): number {
  const s = generateStarSystem(starSeedValue);
  let f = 0;
  if (s.habitableCount > 0) f |= FEATURE.habitable;
  if (s.planets.some((p) => p.kind === 'gas')) f |= FEATURE.gasGiant;
  if (s.companion) f |= FEATURE.binary;
  if (s.belt) f |= FEATURE.belt;
  if (s.star.spectralClass === 'O' || s.star.spectralClass === 'B') f |= FEATURE.massive;
  if (s.planets.length >= 6) f |= FEATURE.manyPlanets;
  if (s.planets.some((p) => p.moons.length > 0)) f |= FEATURE.moons;
  return f;
}

/**
 * Directions in the galaxy map for a picture of the sky at (l, b), as the nebula images are
 * oriented (galactic north up, increasing longitude to the left): right, up, and forward (away
 * from the Sun along the line of sight).
 */
export function pictureAxes(l: number, b: number, dKpc: number): { right: [number, number, number]; up: [number, number, number]; forward: [number, number, number] } {
  const p = galacticToMap(l, b, dKpc);
  const unit = (q: [number, number, number]): [number, number, number] => {
    const v = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n];
  };
  const e = 0.01;
  const forward = unit(galacticToMap(l, b, dKpc * 1.01));
  // Up: towards higher latitude, made exactly perpendicular to the line of sight.
  const up0 = unit(galacticToMap(l, Math.min(90, b + e), dKpc));
  const k = up0[0] * forward[0] + up0[1] * forward[1] + up0[2] * forward[2];
  const u = [up0[0] - k * forward[0], up0[1] - k * forward[1], up0[2] - k * forward[2]];
  const un = Math.hypot(u[0], u[1], u[2]);
  const up: [number, number, number] = [u[0] / un, u[1] / un, u[2] / un];
  // Right is the direction of decreasing longitude (forward × up in the map's axes; checked in
  // tests/nebula-volume.test.ts).
  const right: [number, number, number] = [forward[1] * up[2] - forward[2] * up[1], forward[2] * up[0] - forward[0] * up[2], forward[0] * up[1] - forward[1] * up[0]];
  return { right, up, forward };
}
