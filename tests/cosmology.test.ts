import { describe, expect, it } from 'vitest';
import {
  ageAt,
  CMB_DISTANCE_MPC,
  comovingDistance,
  formatLookback,
  lookbackTime,
  luminosityDistance,
  MPC_IN_LY,
  OBSERVABLE_RADIUS_MPC,
  UNIVERSE_AGE_GYR,
} from '../src/sim/cosmology';

describe('flat ΛCDM distances (Planck 2018: H0 = 67.66, Ωm = 0.3111, with radiation)', () => {
  it('matches standard cosmology calculators for these parameters', () => {
    // Astropy's Planck18: z = 1 → comoving 3,395 Mpc, lookback 7.93 Gyr; z = 3 → 6,500 Mpc.
    expect(comovingDistance(1)).toBeCloseTo(3395, -1);
    expect(lookbackTime(1)).toBeCloseTo(7.93, 1);
    expect(luminosityDistance(1)).toBeCloseTo(2 * comovingDistance(1), 6);
    expect(comovingDistance(3)).toBeCloseTo(6500, -1);
    expect(comovingDistance(0.158)).toBeGreaterThan(665); // 3C 273
    expect(comovingDistance(0.158)).toBeLessThan(680);
  });

  it('puts the microwave background and the edge of the observable universe where Planck does', () => {
    // Planck 2018: comoving distance to last scattering χ* ≈ 13,870 Mpc (about 45.3 billion light-years).
    expect(CMB_DISTANCE_MPC).toBeGreaterThan(13800);
    expect(CMB_DISTANCE_MPC).toBeLessThan(13950);
    // The particle horizon, about 46 billion light-years: just beyond the last-scattering surface.
    const edgeGly = (OBSERVABLE_RADIUS_MPC * MPC_IN_LY) / 1e9;
    expect(edgeGly).toBeGreaterThan(45.9);
    expect(edgeGly).toBeLessThan(46.6);
    expect(OBSERVABLE_RADIUS_MPC).toBeGreaterThan(CMB_DISTANCE_MPC);
    // Converges at very high redshift instead of running away.
    expect(comovingDistance(1e6)).toBeLessThan(OBSERVABLE_RADIUS_MPC + 1);
    expect(comovingDistance(1e6)).toBeGreaterThan(comovingDistance(1e4));
  });

  it('reduces to Hubble\'s law nearby', () => {
    expect(comovingDistance(0.001)).toBeCloseTo((299792.458 / 67.66) * 0.001, 1);
    expect(comovingDistance(0)).toBe(0);
  });

  it('has a 13.8-billion-year-old universe and young record holders', () => {
    // Planck 2018: 13.787 ± 0.020 Gyr.
    expect(UNIVERSE_AGE_GYR).toBeCloseTo(13.79, 1);
    expect(ageAt(14.32)).toBeLessThan(0.32); // JADES-GS-z14-0: ~290 Myr after the Big Bang
    expect(ageAt(14.32)).toBeGreaterThan(0.25);
    expect(formatLookback(lookbackTime(0.158))).toBe('2.0 billion years');
    expect(formatLookback(0.43)).toBe('430 million years');
  });
});
