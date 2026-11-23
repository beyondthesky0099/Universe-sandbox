import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { greatWallCount, grbYear, inGreatWall, type Grb } from '../src/sim/grbs';

const bursts: Grb[] = JSON.parse(readFileSync(new URL('../public/data/grbs.json', import.meta.url), 'utf8')).bursts;

describe('gamma-ray bursts and the claimed Hercules–Corona Borealis Great Wall', () => {
  it('has the bursts with measured redshifts, with sane values', () => {
    expect(bursts.length).toBeGreaterThan(500);
    for (const [name, ra, dec, z] of bursts) {
      expect(name).toMatch(/^GRB \d{6}/);
      expect(ra).toBeGreaterThanOrEqual(0);
      expect(ra).toBeLessThan(360);
      expect(Math.abs(dec)).toBeLessThanOrEqual(90);
      expect(z).toBeGreaterThan(0);
      expect(z).toBeLessThan(10);
    }
    // GRB 090423 at z = 8.26, among the most distant objects known when it went off.
    expect(bursts.find((b) => b[0] === 'GRB 090423')?.[3]).toBeCloseTo(8.26, 2);
    expect(grbYear('GRB 970508')).toBe(1997);
    expect(grbYear('GRB 250702B')).toBe(2025);
  });

  it('reproduces the excess Horváth et al. (2014) found: 14 bursts where chance gives a few', () => {
    const then = greatWallCount(bursts, 2012);
    // Their 31 has grown as redshifts of older bursts were measured, but the 14 holds.
    expect(then.inside).toBe(14);
    expect(then.inside).toBeGreaterThan(2 * then.expected);
    // Today the excess is weaker, but still there.
    const now = greatWallCount(bursts);
    expect(now.total).toBeGreaterThan(then.total);
    expect(now.inside).toBeGreaterThan(now.expected);
    expect(bursts.filter(inGreatWall).length).toBe(now.inside);
  });
});
