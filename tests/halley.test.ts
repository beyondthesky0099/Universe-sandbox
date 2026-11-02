import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadHalley2061, type HalleyReturn } from '../src/sim/halley';
import { Simulation } from '../src/sim/simulation';
import { parseSolarData, setSolarData } from '../src/sim/solarSystemData';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const h: HalleyReturn = read('halley-2061.json');

beforeAll(() => setSolarData(parseSolarData(read('solar-system.json'))));

describe("Halley's 2061 return", () => {
  it('has JPL’s perihelion and Earth approach', () => {
    expect(h.perihelion.date.startsWith('2061-07-28')).toBe(true);
    expect(h.perihelion.au).toBeCloseTo(0.593, 2);
    expect(h.earthApproach.date.startsWith('2061-07-29')).toBe(true);
    expect(h.earthApproach.au).toBeCloseTo(0.477, 2);
    expect(h.venusApproach.date.startsWith('2061-08-20')).toBe(true);
    expect(h.venusApproach.au).toBeCloseTo(0.054, 3);
  });

  it('reproduces the perihelion and the Earth approach from its April 2061 position', () => {
    const sim = new Simulation();
    loadHalley2061(sim, h);
    sim.particles.clear();
    const sun = sim.bodies.find((b) => b.name === 'Sun')!;
    const earth = sim.bodies.find((b) => b.name === 'Earth')!;
    const comet = sim.bodies.find((b) => b.name === 'Halley')!;
    const day = 1 / 365.25;
    let peri = { r: Infinity, jd: 0 };
    let near = { d: Infinity, jd: 0 };
    for (let t = 0; t < 160 * 24; t++) {
      sim.advance(day / 24, 1e7, 1e9);
      const jd = h.startJd + sim.time * 365.25;
      const r = Math.hypot(comet.x - sun.x, comet.y - sun.y, comet.z - sun.z);
      if (r < peri.r) peri = { r, jd };
      const d = Math.hypot(comet.x - earth.x, comet.y - earth.y, comet.z - earth.z);
      if (d < near.d) near = { d, jd };
    }
    expect(Math.abs(peri.jd - h.perihelion.jd)).toBeLessThan(0.5); // within half a day
    expect(Math.abs(peri.r - h.perihelion.au) / h.perihelion.au).toBeLessThan(0.005);
    expect(Math.abs(near.jd - h.earthApproach.jd)).toBeLessThan(1);
    expect(Math.abs(near.d - h.earthApproach.au) / h.earthApproach.au).toBeLessThan(0.02);
  }, 60000);
});

describe('forecast refinement', () => {
  it('finds Halley’s close pass by Venus (JPL: 0.054 AU on 20 August 2061) in the body forecast', async () => {
    const { forecast } = await import('../src/sim/forecast');
    const sim = new Simulation();
    loadHalley2061(sim, h);
    const comet = sim.bodies.find((b) => b.name === 'Halley')!;
    // A one-year look-ahead pins it down closely...
    const f = forecast(sim, comet.id, 1, 25, 6000);
    expect(f.closest?.otherName).toBe('Venus');
    expect(Math.abs(f.closest!.distance - h.venusApproach.au) / h.venusApproach.au).toBeLessThan(0.03);
    expect(Math.abs(f.closest!.time * 365.25 - (h.venusApproach.jd - h.startJd))).toBeLessThan(1);
    // ...and a whole orbit (74.6 yr, as the app asks for the selected body) still finds it, within 6%.
    const orbit = forecast(sim, comet.id, 74.6, 25, 6000);
    expect(orbit.closest?.otherName).toBe('Venus');
    expect(Math.abs(orbit.closest!.distance - h.venusApproach.au) / h.venusApproach.au).toBeLessThan(0.06);
  }, 60000);
});
