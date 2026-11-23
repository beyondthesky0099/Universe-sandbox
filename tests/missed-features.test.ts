import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCELERATION_START_A, ageAtScale, compositionAt, hubbleAt, H0, LAST_SCATTERING_Z, scaleFactorAtAge, UNIVERSE_AGE_GYR } from '../src/sim/cosmology';
import { Simulation } from '../src/sim/simulation';
import { loadSStars, sStarAxisAu } from '../src/sim/sStars';
import { NANOGRAV_15YR, type GalacticExtras } from '../src/sim/galacticExtras';
import { chicxulub, shoemakerLevy9 } from '../src/sim/impacts';
import { AU_PER_YEAR_IN_KMS } from '../src/sim/units';

const json = (f: string) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const extras: GalacticExtras = json('galactic-extras.json');

describe('the expanding universe', () => {
  it('has the right ages, from the afterglow to today', () => {
    expect(ageAtScale(1)).toBeCloseTo(UNIVERSE_AGE_GYR, 2);
    // The microwave background left at ~370,000–380,000 years.
    const cmb = ageAtScale(1 / (1 + LAST_SCATTERING_Z)) * 1e9;
    expect(cmb).toBeGreaterThan(3.5e5);
    expect(cmb).toBeLessThan(3.9e5);
    for (const t of [0.5, 3, 9.2, 13.787, 25]) expect(ageAtScale(scaleFactorAtAge(t))).toBeCloseTo(t, 3);
    expect(hubbleAt(1)).toBeCloseTo(H0, 6);
  });

  it('starts speeding up about 7.7 billion years in, at redshift ~0.63', () => {
    expect(1 / ACCELERATION_START_A - 1).toBeGreaterThan(0.6);
    expect(1 / ACCELERATION_START_A - 1).toBeLessThan(0.68);
    expect(ageAtScale(ACCELERATION_START_A)).toBeGreaterThan(7.3);
    expect(ageAtScale(ACCELERATION_START_A)).toBeLessThan(8.1);
    // Today: ~69% dark energy, ~31% matter.
    expect(compositionAt(1).darkEnergy).toBeCloseTo(0.689, 2);
    // At the afterglow, matter dominates and dark energy is negligible.
    expect(compositionAt(1 / 1090).darkEnergy).toBeLessThan(1e-8);
  });
});

describe('the Milky Way extras', () => {
  it('has the datasets, with sane values', () => {
    expect(extras.sStars.length).toBeGreaterThan(30);
    expect(extras.hypervelocity.some((h) => h.name === 'S5-HVS1' && h.vKms === 1755)).toBe(true);
    expect(extras.radcliffeWave.length).toBeGreaterThan(200);
    const r = extras.localBubble.rPc;
    expect(Math.min(...r)).toBeGreaterThan(50);
    expect(Math.max(...r)).toBeLessThan(400);
    expect(new Set(NANOGRAV_15YR).size).toBe(68);
  });

  it('flies S2 round Sgr A*: 120 AU at closest, at ~7,700 km/s, as measured in 2018', () => {
    const s2 = extras.sStars.find((s) => s.name === 'S2')!;
    expect(sStarAxisAu(s2, extras.sgrA.r0Kpc)).toBeCloseTo(1044, -1);
    const sim = new Simulation();
    loadSStars(sim, { ...extras, sStars: [s2] }, new Date('2017-06-01T00:00:00Z'));
    const hole = () => sim.bodies.find((b) => b.name === 'Sgr A*')!;
    const star = () => sim.bodies.find((b) => b.name === 'S2')!;
    let closest = Infinity, fastest = 0;
    for (let t = 0; t < 2; t += 0.001) {
      sim.advance(0.001, 100000, 1e9);
      const h = hole(), s = star();
      closest = Math.min(closest, Math.hypot(s.x - h.x, s.y - h.y, s.z - h.z));
      fastest = Math.max(fastest, Math.hypot(s.vx - h.vx, s.vy - h.vy, s.vz - h.vz) * AU_PER_YEAR_IN_KMS);
    }
    expect(closest).toBeGreaterThan(105);
    expect(closest).toBeLessThan(135);
    expect(fastest).toBeGreaterThan(7000);
    expect(fastest).toBeLessThan(8300);
  }, 60_000);
});

describe('famous impacts', () => {
  const run = (preset: typeof chicxulub, years: number, step: number) => {
    const sim = new Simulation();
    preset.load(sim);
    const messages: string[] = [];
    for (let t = 0; t < years; t += step) {
      sim.advance(step, 100000, 1e9);
      for (const e of sim.events.splice(0)) if (e.type === 'merge') messages.push(e.message);
    }
    return messages;
  };

  it('Chicxulub hits Earth within about six hours, with ~100 million megatons', () => {
    const m = run(chicxulub, 9 / 8766, 1e-5);
    expect(m.length).toBe(1);
    expect(m[0]).toMatch(/Chicxulub impactor collided with Earth: \d+ million megatons/);
    const mt = Number(m[0].match(/(\d+) million/)![1]);
    expect(mt).toBeGreaterThan(40);
    expect(mt).toBeLessThan(200);
  }, 60_000);

  it('the fragments of Shoemaker–Levy 9 strike Jupiter one after another over six days', () => {
    const m = run(shoemakerLevy9, 7 / 365.25, 2e-4);
    expect(m.filter((x) => /Fragment .* collided with Jupiter/.test(x)).length).toBeGreaterThanOrEqual(18);
  }, 60_000);
});

describe('fast radio bursts', () => {
  it('has the DSA-110 hosts plus the famous two', () => {
    const b = json('frbs.json').bursts as [string, number, number, number, string?][];
    expect(b.length).toBeGreaterThanOrEqual(30);
    expect(b.find((x) => x[0] === 'FRB 20220610A')?.[3]).toBe(1.016);
    expect(b.find((x) => x[0] === 'FRB 20121102A')?.[3]).toBeCloseTo(0.193, 3);
  });
});
