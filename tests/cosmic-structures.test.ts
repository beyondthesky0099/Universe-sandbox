import { describe, expect, it } from 'vitest';
import { magellanicToGalactic } from '../src/render/localStructures';
import { COSMIC_STRUCTURES } from '../src/sim/galaxies';
import { structureEntries } from '../src/ui/searchSources';
import { comovingDistance } from '../src/sim/cosmology';

describe('structures beyond the galaxy map', () => {
  it('runs the Magellanic Stream along the Magellanic coordinate system (Nidever et al. 2008)', () => {
    // Longitude 0 is the LMC (l 280.5°, b −32.8°)…
    const [l0, b0] = magellanicToGalactic(0, 0);
    expect(Math.abs(l0 - 280.5)).toBeLessThan(4);
    expect(Math.abs(b0 + 32.8)).toBeLessThan(2);
    // …the trailing Stream passes near the south galactic pole…
    expect(magellanicToGalactic(-60, 0)[1]).toBeLessThan(-75);
    // …and the Leading Arm crosses the Galactic plane ahead of the Clouds.
    expect(Math.abs(magellanicToGalactic(30, 0)[1])).toBeLessThan(8);
  });

  it('labels the new structures, searchable by kind', () => {
    const names = COSMIC_STRUCTURES.map((s) => s.name);
    for (const n of ['Quipu superstructure', 'Giant Arc (claimed)', 'Big Ring (claimed)', 'Hercules–Corona Borealis Great Wall (claimed)', 'Magellanic Stream', 'Milky Way’s dark matter halo', 'Bullet Cluster: dark matter'])
      expect(names).toContain(n);
    const kind = (n: string) => structureEntries().find((e) => e.name === n)?.kind;
    expect(kind('Quipu superstructure')).toBe('Supercluster');
    expect(kind('Big Ring (claimed)')).toBe('Large-scale structure');
    expect(kind('Bullet Cluster: dark matter')).toBe('Dark matter');
    expect(kind('Magellanic Stream')).toBe('Gas stream');
    // The Bullet Cluster at z = 0.296 and the Big Ring at z ≈ 0.8, at their comoving distances.
    expect(COSMIC_STRUCTURES.find((s) => s.name.startsWith('Bullet'))!.d).toBeCloseTo(comovingDistance(0.296), 6);
    expect(COSMIC_STRUCTURES.find((s) => s.name.startsWith('Big Ring'))!.d).toBeCloseTo(comovingDistance(0.802), -1);
  });
});

describe('finding the structures by search', () => {
  it('finds them by a name word plus what they are, by nickname, and says billions', async () => {
    const { SearchIndex, lightYears } = await import('../src/ui/search');
    const index = new SearchIndex();
    index.add(structureEntries());
    const top = (q: string) => index.search(q, 3).map((e) => e.name);
    expect(top('hercules structure')).toContain('Hercules–Corona Borealis Great Wall (claimed)');
    expect(top('hercules wall')[0]).toBe('Hercules–Corona Borealis Great Wall (claimed)');
    expect(top('HCB')[0]).toBe('Hercules–Corona Borealis Great Wall (claimed)');
    expect(top('largest structure')).toContain('Hercules–Corona Borealis Great Wall (claimed)');
    expect(lightYears(5080 * 1000)).toBe('16.6 billion ly');
    expect(lightYears(330 * 1000)).toBe('1.1 billion ly');
    expect(lightYears(200 * 1000)).toBe('652 million ly');
  });
});

describe('the Boötes Void, and typos', () => {
  it('is nearly empty in the survey: about a quarter of the normal density', async () => {
    const { readFileSync } = await import('node:fs');
    const { voidCensus, bootesVoid } = await import('../src/sim/voids');
    const { H0 } = await import('../src/sim/cosmology');
    const web = JSON.parse(readFileSync(new URL('../public/data/galaxies-2mrs.json', import.meta.url), 'utf8'));
    const c = voidCensus(web.galaxies, H0);
    expect(c.inside).toBeLessThan(15);
    expect(c.expected).toBeGreaterThan(25);
    expect(c.ratio).toBeLessThan(0.4);
    // Radius 3,100 km/s: ~46 Mpc with the map's H0.
    expect(bootesVoid(H0).radius).toBeCloseTo(3100 / H0, 6);
  });

  it('finds things through a typo, but not nonsense', async () => {
    const { SearchIndex, nearWord } = await import('../src/ui/search');
    expect(nearWord('boots', 'bootes')).toBe(true);
    expect(nearWord('corana', 'corona')).toBe(true);
    expect(nearWord('herclues', 'hercules')).toBe(true);
    expect(nearWord('void', 'veil')).toBe(false);
    const index = new SearchIndex();
    index.add(structureEntries());
    expect(index.search('boots void')[0]?.name).toBe('Boötes Void');
    expect(index.search('hercules corana')[0]?.name).toBe('Hercules–Corona Borealis Great Wall (claimed)');
    expect(index.search('xqzzv')).toHaveLength(0);
  });
});
