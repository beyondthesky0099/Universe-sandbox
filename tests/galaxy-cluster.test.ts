import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { namedFromSurvey, universeEntries, type LocalGalaxy } from '../src/sim/galaxies';
import { clusterMembers, loadGalaxyCluster } from '../src/sim/galaxyCluster';
import { H0 } from '../src/sim/cosmology';
import { Simulation } from '../src/sim/simulation';

const data = (f: string) => JSON.parse(readFileSync(`public/data/${f}`, 'utf8'));
const named = data('galaxies-named.json');
const galaxies: LocalGalaxy[] = [...data('galaxies-local.json').galaxies, ...namedFromSurvey(named.galaxies, H0), ...universeEntries(data('universe-objects.json'))];
const coma = galaxies.find((g) => g.name === 'Abell 1656')!;

describe('entering a galaxy cluster', () => {
  it('finds the Coma Cluster’s catalogued galaxies, with a velocity spread near the measured ~1,000 km/s', () => {
    expect(coma).toBeTruthy();
    const members = clusterMembers(coma, galaxies);
    // The survey lists its brightest galaxies (Ks < 11.75): a few dozen within 2 Mpc.
    expect(members.length).toBeGreaterThan(30);
    expect(members.some((m) => m.galaxy.name === 'NGC4889')).toBe(true);
    const v = members.filter((m) => m.vlos !== undefined).map((m) => m.vlos!);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sigma = Math.sqrt(v.reduce((t, x) => t + (x - mean) ** 2, 0) / (v.length - 1));
    expect(sigma).toBeGreaterThan(700);
    expect(sigma).toBeLessThan(1300);
  });

  it('loads them with a virial mass of about a million billion suns, in kpc/Myr units', () => {
    const sim = new Simulation();
    const setup = loadGalaxyCluster(sim, coma, clusterMembers(coma, galaxies));
    expect(sim.units).toBe('kpc-myr');
    const total = sim.bodies.reduce((t, b) => t + b.mass, 0);
    expect(total).toBeGreaterThan(3e14);
    expect(total).toBeLessThan(5e15);
    expect(sim.bodies.every((b) => b.tag === 'galaxy')).toBe(true);
    expect(setup.tip).toMatch(/catalogued galaxies/);
  });

  it('gives a cluster beyond the catalogues an illustrative swarm, and says so', () => {
    const sim = new Simulation();
    const far = galaxies.find((g) => g.kind === 'cluster' && g.d > 1500)!;
    const setup = loadGalaxyCluster(sim, far, clusterMembers(far, galaxies));
    expect(sim.bodies.length).toBeGreaterThanOrEqual(40);
    expect(setup.tip).toMatch(/illustrative/);
  });
});
