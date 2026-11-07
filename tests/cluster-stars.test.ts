import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clusterSwarms, plummerRadius, swarmSize } from '../src/procgen/clusterStars';
import { galacticToMap, UNITS_PER_KPC } from '../src/procgen/galaxy';
import { parseClusters } from '../src/sim/clusters';

const clusters = parseClusters(JSON.parse(readFileSync('public/data/clusters.json', 'utf8')));

describe('cluster star swarms', () => {
  it('samples the Plummer profile: half the mass within 1.305 a in 3D', () => {
    const r = Array.from({ length: 20000 }, (_, i) => plummerRadius((i + 0.5) / 20000)).sort((a, b) => a - b);
    expect(r[10000]).toBeCloseTo(1.305, 2);
  });

  it('draws M13 as a ball whose projected half-number radius is its Harris half-light radius', () => {
    const m13 = clusters.find((c) => c.name?.startsWith('Hercules Cluster'))!;
    expect(m13.kind).toBe('globular');
    const s = clusterSwarms([m13]);
    expect(s.count).toBe(swarmSize(m13));
    expect(s.count).toBeGreaterThan(500);
    const [cx, cy, cz] = galacticToMap(m13.l, m13.b, m13.distancePc! / 1000);
    // Project along a random-ish axis (y): the half-number radius in the x–z plane should be a.
    const proj = Array.from({ length: s.count }, (_, i) => Math.hypot(s.positions[i * 3] - cx, s.positions[i * 3 + 2] - cz)).sort((a, b) => a - b);
    const a = (m13.radiusPc! / 1000) * UNITS_PER_KPC;
    expect(proj[Math.floor(s.count / 2)] / a).toBeGreaterThan(0.85);
    expect(proj[Math.floor(s.count / 2)] / a).toBeLessThan(1.15);
    // All within the 12 a cut.
    for (let i = 0; i < s.count; i++) expect(Math.hypot(s.positions[i * 3] - cx, s.positions[i * 3 + 1] - cy, s.positions[i * 3 + 2] - cz)).toBeLessThanOrEqual(12 * a * 1.0001);
  });

  it('covers every globular with a distance and the rich or named open clusters, within a phone-friendly budget', () => {
    const all = clusterSwarms(clusters);
    const globulars = clusters.filter((c) => c.kind === 'globular' && c.distancePc && c.radiusPc).length;
    expect(clusters.filter((c) => c.kind === 'globular' && swarmSize(c) > 0).length).toBe(globulars);
    expect(globulars).toBeGreaterThan(140);
    expect(swarmSize(clusters.find((c) => c.name?.startsWith('Pleiades'))!)).toBeGreaterThan(0);
    expect(all.count).toBeLessThan(150000);
    expect(clusterSwarms(clusters, 0.5).count).toBeLessThan(all.count * 0.55);
    // Brighter globulars get more stars: Omega Centauri more than a faint one.
    const omega = clusters.find((c) => c.name === 'Omega Centauri')!;
    const faint = clusters.filter((c) => c.kind === 'globular' && (c.absMag ?? 0) > -6)[0];
    expect(swarmSize(omega)).toBeGreaterThan(5 * swarmSize(faint));
  });
});
