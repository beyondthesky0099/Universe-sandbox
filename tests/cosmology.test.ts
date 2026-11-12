import { describe, expect, it } from 'vitest';
import { ageAt, comovingDistance, formatLookback, lookbackTime, luminosityDistance, UNIVERSE_AGE_GYR } from '../src/sim/cosmology';

describe('flat ΛCDM distances (H0 = 70, Ωm = 0.3)', () => {
  it('matches the standard cosmology calculator', () => {
    // Wright's calculator: z = 1 → comoving 3,303 Mpc, lookback 7.7 Gyr; z = 0.158 (3C 273) → 652 Mpc.
    expect(comovingDistance(1)).toBeCloseTo(3303, -1);
    expect(lookbackTime(1)).toBeCloseTo(7.7, 1);
    expect(comovingDistance(0.158)).toBeCloseTo(652, -1);
    expect(luminosityDistance(1)).toBeCloseTo(6606, -1);
    expect(comovingDistance(3)).toBeCloseTo(6356, -1);
    // The last-scattering surface is about 14 Gpc away (the map's CMB sphere).
    expect(comovingDistance(1100)).toBeGreaterThan(13500);
    expect(comovingDistance(1100)).toBeLessThan(14500);
  });

  it('reduces to Hubble\'s law nearby', () => {
    expect(comovingDistance(0.001)).toBeCloseTo((299792.458 / 70) * 0.001, 1);
    expect(comovingDistance(0)).toBe(0);
  });

  it('has a 13.5-billion-year-old universe and young record holders', () => {
    expect(UNIVERSE_AGE_GYR).toBeCloseTo(13.5, 0);
    expect(ageAt(14.32)).toBeLessThan(0.32); // JADES-GS-z14-0: ~290 Myr after the Big Bang
    expect(ageAt(14.32)).toBeGreaterThan(0.25);
    expect(formatLookback(lookbackTime(0.158))).toBe('2.0 billion years');
    expect(formatLookback(0.43)).toBe('430 million years');
  });
});
