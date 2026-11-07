import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ageText, parseClusters } from '../src/sim/clusters';

const clusters = parseClusters(JSON.parse(readFileSync(new URL('../public/data/clusters.json', import.meta.url), 'utf8')));
const byName = (n: string) => clusters.find((c) => c.name === n)!;

describe('real star clusters', () => {
  it('has the Gaia DR3 census (Hunt & Reffert 2023) and Harris’s globular clusters', () => {
    expect(clusters.filter((c) => c.kind === 'open').length).toBe(6818);
    expect(clusters.filter((c) => c.kind === 'group').length).toBe(228);
    expect(clusters.filter((c) => c.kind === 'globular').length).toBe(147);
    expect(clusters.filter((c) => c.kind !== 'globular').every((c) => c.distancePc! > 0)).toBe(true);
    expect(clusters.filter((c) => c.kind === 'globular' && c.distancePc).length).toBe(145); // two have no distance in Harris 1997
  });

  it('puts famous clusters at their measured distances', () => {
    // Pleiades ≈ 136 pc (Gaia), Hyades ≈ 47 pc, Beehive ≈ 183 pc, Alpha Persei ≈ 175 pc.
    expect(byName('Pleiades (M45)').distancePc!).toBeGreaterThan(130);
    expect(byName('Pleiades (M45)').distancePc!).toBeLessThan(140);
    expect(byName('Hyades').distancePc).toBeCloseTo(47, -1);
    expect(byName('Beehive Cluster (M44)').distancePc).toBeCloseTo(183, -1);
    expect(byName('Alpha Persei Cluster').distancePc).toBeCloseTo(175, -1);
    // The Double Cluster: two clusters side by side about 2.3 kpc away.
    expect(byName('Double Cluster (h Persei)').distancePc).toBeCloseTo(2300, -2);
    expect(byName('Double Cluster (χ Persei)').distancePc).toBeCloseTo(2300, -2);
    // Globulars (Harris): Omega Centauri ≈ 5.2 kpc, 47 Tucanae ≈ 4.5 kpc, M4 ≈ 2.2 kpc.
    expect(byName('Omega Centauri').distancePc).toBeCloseTo(5100, -3);
    expect(byName('47 Tucanae').kind).toBe('globular');
    expect(byName('M4').kind).toBe('globular');
    expect(byName('M4').distancePc).toBeCloseTo(2200, -2);
  });

  it('gives ages: the Pleiades are young, M67 is old', () => {
    const pleiades = byName('Pleiades (M45)');
    expect(10 ** pleiades.logAge!).toBeGreaterThan(5e7);
    expect(10 ** pleiades.logAge!).toBeLessThan(2.5e8); // about 100–150 million years
    expect(10 ** byName('M67').logAge!).toBeGreaterThan(1e9); // a few billion years
    expect(ageText(8.08)).toBe('120 million years');
    expect(ageText(9.6)).toBe('4.0 billion years');
  });
});
