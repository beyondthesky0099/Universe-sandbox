import { kelvinToRgb, starTemperature } from '../sim/color';
import { galaxyName, properName } from './names';
import { Rng, gaussian, hash32, intRange, mulberry32, range } from './rng';
import { generateStarSystem, starSummary, type SpectralClass } from './starSystem';

export interface GalaxyData {
  seed: number;
  name: string;
  arms: number;
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
}

function samplePosition(rng: Rng, s: ShapeParams, out: Float32Array, k: number): number {
  const R = GALAXY_RADIUS;
  if (rng() < s.bulgeFraction) {
    out[k] = gaussian(rng) * R * 0.11;
    out[k + 1] = gaussian(rng) * R * 0.07;
    out[k + 2] = gaussian(rng) * R * 0.11;
    return Math.hypot(out[k], out[k + 2]) / R;
  }
  let r: number;
  do r = -Math.log(1 - rng()) * s.diskScale * R + R * 0.04;
  while (r > R);
  const t = r / R;
  let theta: number;
  if (rng() < 0.72) {
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

export function generateGalaxy(seed: number, starCount = 30000, glowCount = 60000, dustCount = 9000): GalaxyData {
  const rng = mulberry32(hash32(seed, 1));
  const shape: ShapeParams = {
    arms: intRange(rng, 2, 5),
    twist: range(rng, 3.5, 7.5) * (rng() < 0.5 ? 1 : -1),
    armSpread: range(rng, 0.22, 0.42),
    bulgeFraction: range(rng, 0.1, 0.22),
    diskScale: range(rng, 0.25, 0.38),
    thickness: range(rng, 0.015, 0.03),
  };
  const name = galaxyName(mulberry32(hash32(seed, 2)));
  const R = GALAXY_RADIUS;

  // Star clusters: open clusters in the disk, globular clusters in the halo.
  const clusterRng = mulberry32(hash32(seed, 5));
  const clusters: ClusterInfo[] = [];
  const tmp = new Float32Array(3);
  const openCount = intRange(clusterRng, 8, 14);
  for (let i = 0; i < openCount; i++) {
    samplePosition(clusterRng, { ...shape, bulgeFraction: 0 }, tmp, 0);
    clusters.push({ name: `${properName(clusterRng)} Cluster`, kind: 'open', x: tmp[0], y: tmp[1], z: tmp[2], sigma: range(clusterRng, 0.6, 1.6) });
  }
  const globCount = intRange(clusterRng, 5, 9);
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
    if (posRng() < 0.07) {
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
  const nebCount = intRange(nebRng, 35, 60);
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

  return {
    seed,
    name,
    arms: shape.arms,
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
