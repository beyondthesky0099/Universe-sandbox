import { describe, expect, it } from 'vitest';
import { BHANU_PRAKASH_STAR, generateGalaxy, galacticToMap, MILKY_WAY_SEED, starSeed, UNITS_PER_KPC } from '../src/procgen/galaxy';
import { BHANU_PRAKASH_SEED, generateStarSystem, starSummary } from '../src/procgen/starSystem';
import { inSkyAction, secretStarEntry } from '../src/ui/searchSources';

describe('the hidden star (Easter egg)', () => {
  it('is a near twin of the Sun with a rich system, all named for Bhanu Prakash', () => {
    const sys = generateStarSystem(BHANU_PRAKASH_SEED);
    expect(sys.star.name).toBe('Bhanu Prakash');
    expect(starSummary(BHANU_PRAKASH_SEED).name).toBe('Bhanu Prakash');
    expect(sys.star.spectralClass).toBe('G');
    expect(sys.star.temperature).toBeGreaterThan(5700);
    expect(sys.star.temperature).toBeLessThan(6000);
    expect(sys.planets.length).toBeGreaterThanOrEqual(7);
    expect(sys.habitableCount).toBeGreaterThanOrEqual(2);
    expect(sys.belt).toBeDefined();
    expect(sys.companion).toBeUndefined();
    expect(sys.planets[0].name).toBe('Bhanu Prakash b');
    // Every other seed keeps its generated name.
    expect(generateStarSystem(BHANU_PRAKASH_SEED + 1).star.name).not.toBe('Bhanu Prakash');
  });

  it('sits 108 light-years from the Sun on the Milky Way map, and every other star keeps its place', () => {
    const n = 3000;
    const g = generateGalaxy(MILKY_WAY_SEED, n, 3000, 500);
    const i = g.stars.seeds.indexOf(BHANU_PRAKASH_SEED);
    expect(i).toBe(n - 1);
    expect(g.names[i]).toBe('Bhanu Prakash');
    const at = [0, 1, 2].map((k) => g.stars.positions[i * 3 + k]);
    expect(at[0]).toBeCloseTo(galacticToMap(BHANU_PRAKASH_STAR.l, BHANU_PRAKASH_STAR.b, BHANU_PRAKASH_STAR.dKpc)[0], 4);
    const ly = (Math.hypot(at[0] - g.sol[0], at[1] - g.sol[1], at[2] - g.sol[2]) / UNITS_PER_KPC) * 3261.56;
    expect(ly).toBeCloseTo(108, 0);
    expect(g.stars.seeds[0]).toBe(starSeed(MILKY_WAY_SEED, 0));
    expect(g.stars.seeds[n - 2]).toBe(starSeed(MILKY_WAY_SEED, n - 2));
    // Other galaxies don't have it.
    expect(generateGalaxy(12345, n, 3000, 500).stars.seeds.indexOf(BHANU_PRAKASH_SEED)).toBe(-1);
  });

  it('is found only by searching the name, and goes to the Galaxy map even from the Sky tab', () => {
    for (const q of ['Bhanu Prakash', 'bhanu', 'BHANU PRAKASH', 'prakash']) expect(secretStarEntry(q)?.name, q).toBe('Bhanu Prakash');
    for (const q of ['b', 'bh', 'bhan', 'star', 'sun', 'hidden']) expect(secretStarEntry(q), q).toBeUndefined();
    const a = secretStarEntry('bhanu')!.action;
    expect(a.type === 'map' && a.starSeed).toBe(BHANU_PRAKASH_SEED);
    expect(inSkyAction(a, true)).toBe(a);
  });
});
