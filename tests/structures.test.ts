import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { equatorialToGalactic } from '../src/procgen/galaxy';
import { COSMIC_STRUCTURES, universeEntries } from '../src/sim/galaxies';
import { galacticToEquatorial, type LqgQuasar, VOIDS, WALLS, wallMembers } from '../src/sim/structures';
import { sagittariusDistance, sagittariusToGalactic } from '../src/render/localStructures';
import { loadRealCluster } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';

const data = (f: string) => JSON.parse(readFileSync(`public/data/${f}`, 'utf8'));
const clusters = universeEntries(data('universe-objects.json')).filter((g) => g.kind === 'cluster');

describe('the Huge-LQG (Clowes et al. 2013)', () => {
  const members = (data('huge-lqg.json') as { members: LqgQuasar[] }).members;
  it('is the paper’s 73 quasars, found again by linking SDSS DR7 quasars at 100 Mpc', () => {
    expect(members.length).toBe(73);
    // Quasars of the paper's Table 1.
    const names = members.map((m) => m.name);
    expect(names).toContain('SDSS J104139.15+143530.2');
    expect(names).toContain('SDSS J112109.76+075958.6');
    for (const m of members) {
      expect(m.z, m.name).toBeGreaterThanOrEqual(1);
      expect(m.z, m.name).toBeLessThanOrEqual(1.8);
    }
    // Its mean redshift is the 1.27 of its name.
    expect(members.reduce((t, m) => t + m.z, 0) / members.length).toBeCloseTo(1.27, 2);
  });
});

describe('walls of galaxy clusters', () => {
  it('finds the famous clusters of each wall', () => {
    const names = (wall: string) => wallMembers(WALLS.find((w) => w.name === wall)!, clusters).map((g) => g.name);
    expect(names('Sloan Great Wall')).toEqual(expect.arrayContaining(['Abell 1650', 'Abell 1651', 'Abell 1750']));
    expect(names('Horologium–Reticulum Supercluster')).toEqual(expect.arrayContaining(['Abell 3128', 'Abell 3158', 'Abell 3266']));
    for (const w of WALLS) expect(names(w.name).length, w.name).toBeGreaterThanOrEqual(10);
  });

  it('converts galactic to equatorial coordinates and back', () => {
    for (const [ra, dec] of [[10, 20], [200, -60], [354.4, 0.27], [83.6, 22]]) {
      const [l, b] = equatorialToGalactic(ra, dec);
      const [ra2, dec2] = galacticToEquatorial(l, b);
      expect(ra2).toBeCloseTo(ra, 3);
      expect(dec2).toBeCloseTo(dec, 3);
    }
  });
});

describe('voids and streams', () => {
  it('places every void bubble at its structure’s label', () => {
    for (const v of VOIDS) {
      const s = COSMIC_STRUCTURES.find((x) => x.name === v.name)!;
      expect(s, v.name).toBeDefined();
      if (v.name !== 'KBC Void') expect(Math.abs(s.d - v.d)).toBeLessThan(1);
    }
  });

  it('runs the Sagittarius Stream from the dwarf, its leading arm over the north Galactic pole', () => {
    // The dwarf sits about 1.5° off the stream's great circle.
    const [l, b] = sagittariusToGalactic(0, 0);
    expect(Math.hypot(l - 5.57, b + 14.17)).toBeLessThan(2);
    expect(sagittariusToGalactic(90, 0)[1]).toBeGreaterThan(60);
    expect(sagittariusDistance(0)).toBe(28);
    expect(sagittariusDistance(71)).toBe(48);
    expect(sagittariusDistance(-170)).toBe(102);
  });
});

describe('R136, the Tarantula’s cluster', () => {
  it('scales gravity to its published mass and reaches heavier stars than the Gaia clusters', () => {
    const sim = new Simulation();
    loadRealCluster(sim, { id: 'R136', name: 'R136', kind: 'open', members: 2000, logAge: Math.log10(1.5e6), radiusPc: 1.5, totalMass: 1e5, maxStarMass: 30 });
    const shown = sim.bodies.reduce((t, b) => t + b.mass, 0);
    expect(sim.gravityScale * shown).toBeCloseTo(1e5, -2);
    expect(Math.max(...sim.bodies.map((b) => b.mass))).toBeGreaterThan(20); // up to the 30 M☉ cap; Gaia-era clusters stop at 20
    expect(sim.bodies.every((b) => b.kind === 'star')).toBe(true); // 1.5 million years: none has died yet
  });
});
