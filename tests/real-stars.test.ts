import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eclipticToGalactic, galacticToEcliptic } from '../src/sim/nebulae';
import { starEntries } from '../src/ui/searchSources';
import { Simulation } from '../src/sim/simulation';
import { loadRealBinary, REAL_BINARIES } from '../src/sim/realBinaries';
import { G } from '../src/sim/units';

const bright = JSON.parse(readFileSync(new URL('../public/data/stars-bright.json', import.meta.url), 'utf8')).stars;
const near = JSON.parse(readFileSync(new URL('../public/data/stars-near.json', import.meta.url), 'utf8'));

describe('stars on the galaxy map', () => {
  it('converts ecliptic directions back to galactic ones', () => {
    for (const [l, b] of [[0, 0], [227.2, -8.9], [90, 60], [300, -45]]) {
      const [l2, b2] = eclipticToGalactic(galacticToEcliptic(l, b));
      expect(Math.abs(((l2 - l + 540) % 360) - 180)).toBeLessThan(1e-6);
      expect(b2).toBeCloseTo(b, 6);
    }
  });

  it('sends a named star to its real place near the Sun, not the sky', () => {
    const entries = starEntries(bright, Array.isArray(near) ? near : near.stars);
    const sirius = entries.find((e) => e.name === 'Sirius')!;
    // Sirius: l 227.2°, b −8.9°, 2.64 pc.
    expect(sirius.action).toMatchObject({ type: 'map' });
    const a = sirius.action as { l: number; b: number; dKpc: number };
    expect(a.l).toBeCloseTo(227.2, 0);
    expect(a.b).toBeCloseTo(-8.9, 0);
    expect(a.dKpc * 1000).toBeCloseTo(2.64, 1);
    // Betelgeuse has a distance now (HYG/Hipparcos), so it goes on the map too.
    expect(entries.find((e) => e.name === 'Betelgeuse')!.action.type).toBe('map');
    const toSky = entries.filter((e) => e.action.type === 'sky');
    expect(toSky.length).toBeLessThanOrEqual(1);
  });
});

describe('real double stars in the Sandbox', () => {
  it('starts each pair on an orbit with its measured period', () => {
    for (const p of REAL_BINARIES) {
      const sim = new Simulation();
      loadRealBinary(sim, p, new Date('2026-11-23T00:00:00Z'));
      const [A, B] = sim.bodies;
      const r = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z);
      const v2 = (B.vx - A.vx) ** 2 + (B.vy - A.vy) ** 2 + (B.vz - A.vz) ** 2;
      const mu = G * (A.mass + B.mass);
      const a = 1 / (2 / r - v2 / mu);
      const period = 2 * Math.PI * Math.sqrt(a ** 3 / mu);
      expect(a).toBeCloseTo(p.axisAu, 6);
      // Kepler's third law with the published masses gives the published period to a few per cent.
      expect(Math.abs(period - p.periodYears) / p.periodYears).toBeLessThan(0.05);
    }
  });

  it('puts Sirius B where it is now: about 30 years past periastron, far out', () => {
    const p = REAL_BINARIES.find((x) => x.id === 'sirius')!;
    const sim = new Simulation();
    loadRealBinary(sim, p, new Date('2026-11-23T00:00:00Z'));
    const [A, B] = sim.bodies;
    const r = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z);
    // Periastron 1994.6 (8.1 AU), apastron 2019.6 (31.7 AU): in late 2026 it is still wide, ~29 AU.
    expect(r).toBeGreaterThan(25);
    expect(r).toBeLessThan(31.7);
  });
});
