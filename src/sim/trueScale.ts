import { physicalRadius, radiusFor, type Body } from './body';
import type { Simulation } from './simulation';
import { getSolarData, realRadiusAu, type SolarData } from './solarSystemData';

/** Softening used with real sizes: ~1.5 km, so close passes between real-sized bodies stay accurate. */
export const TRUE_SCALE_SOFTENING = 1e-8;
export const GAME_SOFTENING = 1e-4;

/** Real radius of a body: the measured value for known Solar System bodies, else from kind and mass. */
export function trueRadius(body: Body, data: SolarData | undefined = getSolarData()): number {
  const real = data?.byName.get(body.name);
  if (real && real.radiusKm) {
    const r = realRadiusAu(real);
    if (r !== undefined) return r;
  }
  return physicalRadius(body.kind, body.mass);
}

/**
 * Switch every body between real sizes and the inflated game sizes. Real sizes also shrink the
 * gravitational softening, which is far larger than many real bodies.
 */
export function setTrueScale(sim: Simulation, on: boolean, data: SolarData | undefined = getSolarData()): void {
  sim.trueScale = on;
  sim.softening = on ? TRUE_SCALE_SOFTENING : GAME_SOFTENING;
  for (const b of sim.bodies) b.radius = on ? trueRadius(b, data) : radiusFor(b.kind, b.mass);
  sim.invalidate();
}
