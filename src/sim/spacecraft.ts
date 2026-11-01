import type { V3 } from './solarSystemData';

/**
 * Real spacecraft trajectories from NASA/JPL Horizons (scripts/build-spacecraft.mjs):
 * heliocentric ecliptic J2000 state vectors sampled every `stepDays` days.
 */
export interface SpacecraftData {
  id: number;
  name: string;
  about: string;
  startJd: number;
  stepDays: number;
  /** [x, y, z (AU), vx, vy, vz (AU/day)] */
  samples: [number, number, number, number, number, number][];
}

export function coverage(c: SpacecraftData): [number, number] {
  return [c.startJd, c.startJd + (c.samples.length - 1) * c.stepDays];
}

/**
 * Heliocentric ecliptic position (AU) and velocity (AU/yr) on a Julian date, by cubic Hermite
 * interpolation between samples, or undefined outside the trajectory's coverage.
 */
export function spacecraftState(c: SpacecraftData, jd: number): { pos: V3; vel: V3 } | undefined {
  const [start, end] = coverage(c);
  if (jd < start || jd > end) return undefined;
  const f = (jd - start) / c.stepDays;
  const i = Math.min(c.samples.length - 2, Math.floor(f));
  const t = f - i;
  const a = c.samples[i];
  const b = c.samples[i + 1];
  const h = c.stepDays;
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
  const h10 = t ** 3 - 2 * t ** 2 + t;
  const h01 = -2 * t ** 3 + 3 * t ** 2;
  const h11 = t ** 3 - t ** 2;
  const d00 = 6 * t ** 2 - 6 * t;
  const d10 = 3 * t ** 2 - 4 * t + 1;
  const d01 = -6 * t ** 2 + 6 * t;
  const d11 = 3 * t ** 2 - 2 * t;
  const pos: V3 = [0, 0, 0];
  const vel: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    pos[k] = h00 * a[k] + h10 * h * a[k + 3] + h01 * b[k] + h11 * h * b[k + 3];
    // d/dt of the Hermite curve (per day) → AU/yr
    vel[k] = ((d00 * a[k] + d10 * h * a[k + 3] + d01 * b[k] + d11 * h * b[k + 3]) / h) * 365.25;
  }
  return { pos, vel };
}

export const SPACECRAFT_COLOR = 0x7fdcff;
