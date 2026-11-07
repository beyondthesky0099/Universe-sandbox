import { describe, expect, it } from 'vitest';
import { aberrate, doppler, gamma } from '../src/render/relativity';
import { autoWarp, C_KMS, formatDuration, formatSpeed, lorentz, SPEEDS, Trip, tripTimes, YEAR_S } from '../src/sim/travel';

describe('travel at any speed', () => {
  it('lists speeds from walking pace to light, then faster-than-light marked as impossible', () => {
    const cs = SPEEDS.map((s) => s.c);
    expect([...cs].sort((a, b) => a - b)).toEqual(cs);
    expect(SPEEDS[0].c * C_KMS * 3600).toBeCloseTo(5, 6);
    expect(SPEEDS.find((s) => s.c === 1)?.label).toBe('Speed of light');
    for (const s of SPEEDS.filter((x) => x.c > 1)) expect(s.label).toMatch(/not possible/);
    expect(SPEEDS.find((s) => /Voyager/.test(s.label))!.c * C_KMS).toBeCloseTo(16.95, 2);
  });

  it('times trips in both frames: Alpha Centauri (4.37 ly) at 99% of light takes 4.41 years, 0.62 on board', () => {
    const t = tripTimes(4.37, 0.99);
    expect(t.earthYears).toBeCloseTo(4.414, 3);
    expect(t.shipYears).toBeCloseTo(4.414 / 7.0888, 3);
    // Voyager's speed: about 77,000 years.
    expect(tripTimes(4.37, 16.95 / C_KMS).earthYears).toBeGreaterThan(75000);
    // A photon's trip takes no time for the photon; faster than light has no ship time at all.
    expect(tripTimes(4.37, 1).shipYears).toBe(0);
    expect(tripTimes(4.37, 10).shipYears).toBeUndefined();
    expect(lorentz(0.6)).toBeCloseTo(1.25, 12);
  });

  it('a Trip advances with time warp and stops at the destination', () => {
    const trip = new Trip(0.5, autoWarp(10, 0.5, 20), 10);
    let t = 0;
    while (t < 100 && !trip.step(0.25).arrived) t += 0.25;
    expect(t).toBeGreaterThan(18);
    expect(t).toBeLessThan(21);
    expect(trip.coveredLy).toBeCloseTo(10, 9);
    expect(trip.earthYears).toBeCloseTo(20, 9);
    expect(trip.shipYears).toBeCloseTo(20 / gamma(0.5), 9);
    // Real time at 1 ly/s: one second covers one light-year.
    const fast = new Trip(YEAR_S, 1, Infinity);
    expect(fast.step(1).ly).toBeCloseTo(1, 12);
  });

  it('formats speeds and durations readably', () => {
    expect(formatSpeed(17 / C_KMS)).toBe('17 km/s');
    expect(formatSpeed(0.99)).toBe('0.99 c');
    expect(formatSpeed(1000 * YEAR_S)).toBe('1,000 ly/s');
    expect(formatDuration(4.414)).toBe('4.41 years');
    expect(formatDuration(2 / 365.25)).toBe('2.00 days');
    expect(formatDuration(13.8e9)).toBe('13.8 billion years');
  });
});

describe('what a fast traveller sees (special relativity)', () => {
  it('aberration crowds the sky forward: at 0.9 c a star 90° off appears 26° from straight ahead', () => {
    expect((Math.acos(aberrate(0, 0.9)) * 180) / Math.PI).toBeCloseTo(25.84, 1);
    expect(aberrate(1, 0.9)).toBeCloseTo(1, 12);
    expect(aberrate(-1, 0.9)).toBeCloseTo(-1, 12);
  });

  it('Doppler: blue ahead, red behind, √((1+β)/(1−β)) straight ahead', () => {
    expect(doppler(1, 0.6)).toBeCloseTo(2, 12);
    expect(doppler(-1, 0.6)).toBeCloseTo(0.5, 12);
    expect(doppler(0, 0.6)).toBeCloseTo(1.25, 12); // transverse: time dilation alone
  });
});
