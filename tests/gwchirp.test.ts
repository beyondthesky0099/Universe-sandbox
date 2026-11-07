import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chirpMass, frequencyAt, redshiftFromDistance, ringdown, synthesizeChirp, T_SUN, timeToMerger } from '../src/sim/gwChirp';
import type { GwEvent } from '../src/sim/gwEvents';

const events: GwEvent[] = JSON.parse(readFileSync(new URL('../public/data/gw-events.json', import.meta.url), 'utf8')).events;
const ev = (name: string) => events.find((e) => e.name === name)!;

describe('gravitational-wave chirps', () => {
  it('gets the redshift of GW150914 from its distance (paper: 410 Mpc, z = 0.09)', () => {
    expect(redshiftFromDistance(410)).toBeCloseTo(0.088, 2);
    expect(redshiftFromDistance(40)).toBeCloseTo(0.0093, 3);
  });

  it('sweeps GW150914 from 35 Hz to about 250 Hz in about 0.2 s, as observed', () => {
    const e = ev('GW150914');
    const z = redshiftFromDistance(e.distanceMpc!);
    const mc = chirpMass(e.m1 * (1 + z), e.m2 * (1 + z)) * T_SUN;
    expect(mc / T_SUN).toBeGreaterThan(29); // detector-frame chirp mass ≈ 30 M☉
    expect(mc / T_SUN).toBeLessThan(32);
    // Abbott et al. 2016: "over 0.2 s, the signal increases in frequency and amplitude in about 8 cycles from 35 to 150 Hz".
    const t = timeToMerger(35, mc) - timeToMerger(150, mc);
    expect(t).toBeGreaterThan(0.15);
    expect(t).toBeLessThan(0.25);
    // The final 62 M☉ black hole rings near 250 Hz (the abstract's top frequency).
    const ring = ringdown(e.final! * (1 + z) * T_SUN);
    expect(ring.f).toBeGreaterThan(230);
    expect(ring.f).toBeLessThan(280);
    const c = synthesizeChirp(e, { sampleRate: 8000, fLow: 35 });
    expect(c.fRing).toBeCloseTo(ring.f, 6);
    expect(c.samples.length / 8000).toBeLessThan(0.5);
  });

  it('gives GW170817 its long chirp (about 100 s in the detectors from 24 Hz)', () => {
    const e = ev('GW170817');
    const z = redshiftFromDistance(e.distanceMpc!);
    const mc = chirpMass(e.m1 * (1 + z), e.m2 * (1 + z)) * T_SUN;
    const t = timeToMerger(24, mc);
    expect(t).toBeGreaterThan(80);
    expect(t).toBeLessThan(120);
    // Played as a 12-second excerpt ending at the neutron stars' contact.
    const c = synthesizeChirp(e, { sampleRate: 8000, maxSeconds: 12 });
    expect(c.inspiralSeconds).toBeLessThanOrEqual(12.001);
    expect(c.fRing).toBeUndefined();
    expect(c.fStart).toBeCloseTo(frequencyAt(12, mc), 6);
  });

  it('writes a clean waveform for every event', () => {
    for (const e of events) {
      const c = synthesizeChirp(e, { sampleRate: 8000 });
      let peak = 0;
      for (const s of c.samples) {
        expect(Number.isFinite(s)).toBe(true);
        peak = Math.max(peak, Math.abs(s));
      }
      expect(peak, e.name).toBeGreaterThan(0.3);
      expect(peak, e.name).toBeLessThanOrEqual(0.81);
    }
  });
});
