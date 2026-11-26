import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { comovingDistance } from '../src/sim/cosmology';
import { galacticToCosmos } from '../src/sim/galaxies';
import type { SaraswatiCluster } from '../src/sim/saraswati';

const members = (JSON.parse(readFileSync('public/data/saraswati.json', 'utf8')) as { members: SaraswatiCluster[] }).members;

describe('the Saraswati Supercluster (Bagchi et al. 2017)', () => {
  it('has the paper’s clusters: about 48, Abell 2631 at the centre, a five-cluster core', () => {
    expect(members.length).toBeGreaterThanOrEqual(46);
    expect(members.length).toBeLessThanOrEqual(52);
    expect(members[0].name).toBe('WHL J233739.7+001617'); // Abell 2631, the paper's cluster 1
    expect(members[0].n200).toBe(103);
    expect(members.filter((m) => m.core).length).toBe(5);
    for (const m of members) {
      expect(m.fromCentre, m.name).toBeLessThanOrEqual(90);
      expect(m.z, m.name).toBeGreaterThan(0.25);
      expect(m.z, m.name).toBeLessThan(0.31);
    }
  });

  it('is a wall some 180 Mpc across, about 1,150 Mpc away, where the app draws it', () => {
    const p = members.map((m) => galacticToCosmos(m.l, m.b, comovingDistance(m.z)));
    let span = 0;
    for (const a of p) for (const b of p) span = Math.max(span, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    expect(span).toBeGreaterThan(140);
    expect(span).toBeLessThan(200);
    const d = Math.hypot(...p[0]);
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1200);
  });
});
