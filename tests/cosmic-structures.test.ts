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
