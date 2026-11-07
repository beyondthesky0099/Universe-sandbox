import { describe, expect, it } from 'vitest';
import { earthSimilarity, esiLabel, exoplanetArchiveUrl, planetFacts, wikipediaUrl } from '../src/sim/planetFacts';
import { EARTH_MASS, JUPITER_MASS } from '../src/sim/units';

describe('planet facts', () => {
  it('reproduces Earth', () => {
    const e = planetFacts({ kind: 'rocky', mass: EARTH_MASS, radiusKm: 6371, flux: 1, surfaceK: 288, albedo: 0.306 });
    expect(e.gravity).toBeCloseTo(9.82, 1);
    expect(e.escapeKms).toBeCloseTo(11.19, 1);
    expect(e.density).toBeCloseTo(5.51, 1);
    expect(e.equilibriumK).toBeCloseTo(254, 0);
    expect(e.esi).toBeGreaterThan(0.999);
    expect(esiLabel(e.esi)).toBe('Earth');
  });

  it('matches published values for Mars and Jupiter', () => {
    const mars = planetFacts({ kind: 'rocky', mass: 0.1074 * EARTH_MASS, radiusKm: 3389.5, flux: 0.431, surfaceK: 210 });
    expect(mars.gravity).toBeCloseTo(3.72, 1);
    expect(mars.escapeKms).toBeCloseTo(5.03, 1);
    expect(mars.density).toBeCloseTo(3.93, 1);
    // Schulze-Makuch et al. list Mars at ESI ≈ 0.64–0.70 depending on the temperature used.
    expect(mars.esi).toBeGreaterThan(0.62);
    expect(mars.esi).toBeLessThan(0.72);
    const jup = planetFacts({ kind: 'gas', mass: JUPITER_MASS, radiusKm: 69911, flux: 0.037, surfaceK: 165 });
    expect(jup.gravity).toBeCloseTo(25.9, 0);
    expect(jup.escapeKms).toBeCloseTo(60.2, 0);
    expect(jup.esi).toBeLessThan(0.4);
  });

  it('weights temperature the most', () => {
    const hot = earthSimilarity(1, 1, 1, 600).esi;
    const big = earthSimilarity(2.08, 1, 1, 288).esi;
    // Doubling the temperature hurts far more than doubling the radius.
    expect(hot).toBeLessThan(big);
  });

  it('estimates the radius from the mass when it is unknown', () => {
    const f = planetFacts({ kind: 'rocky', mass: EARTH_MASS, flux: 1, surfaceK: 288 });
    expect(f.radiusEstimated).toBe(true);
    expect(f.radiusKm).toBeCloseTo(6371, -2);
  });

  it('gives the Hill sphere', () => {
    // Earth's Hill sphere is about 0.01 AU (1.5 million km).
    const f = planetFacts({ kind: 'rocky', mass: EARTH_MASS, radiusKm: 6371, flux: 1, surfaceK: 288, parentMass: 1, distance: 1 });
    expect(f.hillAU).toBeCloseTo(0.01, 2);
  });

  it('links to articles', () => {
    expect(wikipediaUrl('Mercury', false)).toBe('https://en.wikipedia.org/wiki/Mercury_(planet)');
    expect(wikipediaUrl('Titan', true)).toBe('https://en.wikipedia.org/wiki/Titan_(moon)');
    expect(wikipediaUrl('Moon', true)).toBe('https://en.wikipedia.org/wiki/Moon');
    expect(exoplanetArchiveUrl('TRAPPIST-1')).toBe('https://exoplanetarchive.ipac.caltech.edu/overview/TRAPPIST-1');
  });
});
