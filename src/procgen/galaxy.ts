import { kelvinToRgb, starTemperature } from '../sim/color';
import { galaxyName } from './names';
import { Rng, gaussian, hash32, intRange, mulberry32, range } from './rng';
import { starSummary, type SpectralClass } from './starSystem';

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
  /** Unresolved background glow (purely visual). */
  glow: {
    count: number;
    positions: Float32Array;
    colors: Float32Array;
    sizes: Float32Array;
  };
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

export function generateGalaxy(seed: number, starCount = 30000, glowCount = 60000): GalaxyData {
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

  // Selectable stars.
  const sp = new Float32Array(starCount * 3);
  const sc = new Float32Array(starCount * 3);
  const ss = new Float32Array(starCount);
  const seeds = new Uint32Array(starCount);
  const posRng = mulberry32(hash32(seed, 3));
  for (let i = 0; i < starCount; i++) {
    const k = i * 3;
    const t = samplePosition(posRng, shape, sp, k);
    // Dim the dense core so overlapping additive sprites don't saturate to white.
    const dim = 0.35 + 0.65 * Math.min(1, t * 4);
    const s = starSeed(seed, i);
    seeds[i] = s;
    const summary = starSummary(s);
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

  return {
    seed,
    name,
    arms: shape.arms,
    radius: GALAXY_RADIUS,
    stars: { count: starCount, positions: sp, colors: sc, sizes: ss, seeds },
    glow: { count: glowCount, positions: gp, colors: gc, sizes: gs },
  };
}
