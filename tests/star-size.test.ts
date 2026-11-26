import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bolometricCorrection, estimateStar } from '../src/sim/starSize';
import { starEntries } from '../src/ui/searchSources';

const bright = JSON.parse(readFileSync('public/data/stars-bright.json', 'utf8')).stars;
const near = JSON.parse(readFileSync('public/data/stars-near.json', 'utf8')).stars;
const est = (name: string) => {
  const s = bright.find((x: unknown[]) => x[5] === name);
  return estimateStar(s[3], s[4], s[6]);
};

describe('star sizes from brightness, colour and distance', () => {
  it('uses the Flower/Torres bolometric correction (the Sun about −0.08)', () => {
    expect(bolometricCorrection(5772)).toBeCloseTo(-0.08, 1);
    expect(bolometricCorrection(3500)).toBeLessThan(-1.5);
  });

  it('gets well-known stars about right (within the spread of published radii)', () => {
    // [name, published radius (R☉), allowed factor]
    const cases: [string, number, number][] = [
      ['Sirius', 1.71, 1.15], ['Vega', 2.6, 1.3], ['Procyon', 2.05, 1.2], ['Altair', 1.8, 1.25],
      ['Rigel', 79, 1.3], ['Polaris', 46, 1.3], ['Arcturus', 25, 1.3], ['Betelgeuse', 750, 1.6],
    ];
    for (const [name, r, f] of cases) {
      const e = est(name);
      expect(e.radius, name).toBeGreaterThan(r / f);
      expect(e.radius, name).toBeLessThan(r * f);
    }
    expect(est('Betelgeuse').type).toBe('Red supergiant');
    expect(est('Rigel').type).toBe('Blue supergiant');
    expect(est('Sirius').type).toBe('Main-sequence star');
  });

  it('search gives named stars their photometry, so their card can show a size', () => {
    const e = starEntries(bright, near).find((x) => x.name === 'Betelgeuse')!;
    expect(e.action.type === 'map' && e.action.star).toEqual({ vmag: 0.45, bv: 1.5, pc: 152.7 });
  });

  it('shows a small star up close with the Sun beside it, clear of both surfaces', async () => {
    const { Simulation } = await import('../src/sim/simulation');
    const { loadStarToScale } = await import('../src/sim/presets');
    const sim = new Simulation();
    const setup = loadStarToScale(sim, { name: 'Proxima Centauri', note: 'A red dwarf.', visit: { radiusSun: 0.15, temperature: 3040, mass: 0.12, ref: 'test' } });
    const star = sim.bodies.find((b) => b.name === 'Proxima Centauri')!;
    expect(star.kind).toBe('star');
    for (let i = 0; i < 20; i++) sim.advance(1e-4);
    expect(sim.bodies.length).toBe(2);
    expect(setup.tip).toMatch(/The star circling it is the Sun/);
  });
});
