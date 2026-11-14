import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agnFor, agnParams, agnType, AU_PER_LIGHT_DAY, AU_PER_PC, describeAgn, DISC_TILT, opticalLuminosity, viewAngleFor } from '../src/sim/agn';
import { markActiveHosts, namedFromSurvey, universeEntries, type LocalGalaxy, type UniverseObjects } from '../src/sim/galaxies';
import { loadActiveNucleus } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';

const raw: UniverseObjects = JSON.parse(readFileSync(new URL('../public/data/universe-objects.json', import.meta.url), 'utf8'));
const deep = universeEntries(raw);
const local: LocalGalaxy[] = JSON.parse(readFileSync(new URL('../public/data/galaxies-local.json', import.meta.url), 'utf8')).galaxies;
const namedRaw = JSON.parse(readFileSync(new URL('../public/data/galaxies-named.json', import.meta.url), 'utf8'));
const hosts = [...local, ...namedFromSurvey(namedRaw.galaxies, namedRaw.H0)];
markActiveHosts(hosts, raw);
const find = (name: string) => deep.find((g) => g.name === name) ?? hosts.find((g) => g.name === name)!;

describe('active galactic nuclei up close', () => {
  it('classifies by the unified model and picks the viewing angle', () => {
    expect(agnType('Q', 'S1.0')).toBe('quasar');
    expect(agnType('Q', 'HP')).toBe('blazar');
    expect(agnType('B', 'BL')).toBe('blazar');
    expect(agnType('B', '?')).toBe('radio'); // Centaurus A
    expect(agnType('A', 'S1h')).toBe('seyfert2'); // NGC 1068
    expect(agnType('A', 'S1.5')).toBe('seyfert1');
    expect(agnType('A', 'S3')).toBe('liner');
    expect(viewAngleFor('blazar')).toBeCloseTo((12 * Math.PI) / 180, 6);
    expect(viewAngleFor('seyfert2')).toBeGreaterThan(viewAngleFor('seyfert1'));
    // The Sun at 10 pc: M_V = 4.83, so its V-band λL_λ comes back.
    expect(opticalLuminosity(4.83, 1e-5)).toBeCloseTo(2.9e33, -31);
  });

  it('sizes 3C 273 from its measured mass and brightness', () => {
    const q = find('3C 273');
    const p = agnParams(q, '3C 273');
    expect(p.type).toBe('quasar');
    expect(p.massMeasured).toBe(true);
    expect(p.mass).toBe(8.9e8);
    // About 10⁴⁷ erg/s, near its Eddington limit; the torus a few parsecs out, the clouds light-months out.
    expect(p.lbol).toBeGreaterThan(2e46);
    expect(p.lbol).toBeLessThan(2e47);
    expect(p.eddington).toBeGreaterThan(0.2);
    expect(p.eddington).toBeLessThanOrEqual(1);
    expect(p.torusInnerAu / AU_PER_PC).toBeGreaterThan(1.5);
    expect(p.torusInnerAu / AU_PER_PC).toBeLessThan(6);
    expect(p.blrAu / AU_PER_LIGHT_DAY).toBeGreaterThan(100);
    expect(p.blrAu / AU_PER_LIGHT_DAY).toBeLessThan(600);
    expect(p.rsAu).toBeCloseTo(17.5, 0); // 2GM/c² for 8.9 × 10⁸ M☉
    expect(p.radioLoud).toBe(true);
    expect(describeAgn(p)).toContain('3C 273 as a quasar');
    expect(describeAgn(p)).not.toContain('Not measured');
  });

  it('sees M77 as a Seyfert 2 through its torus, and assumes a mass where none is measured', () => {
    const m77 = find('MESSIER077');
    const p = agnParams(m77, 'M77');
    expect(p.type).toBe('seyfert2');
    expect(p.mass).toBe(1.5e7);
    expect(p.viewAngle).toBeGreaterThan((70 * Math.PI) / 180);
    expect(describeAgn(p)).toContain('through the dusty torus');
    const anon = agnParams({ name: 'X', kind: 'seyfert', cl: 'A', sp: 'S1', vmag: 15, d: 200 });
    expect(anon.massMeasured).toBe(false);
    expect(anon.mass).toBeGreaterThanOrEqual(1e6);
    expect(anon.mass).toBeLessThan(1e10);
    expect(anon.eddington).toBeGreaterThan(0.03); // the assumed 0.05, moved by rounding the mass to one figure
    expect(anon.eddington).toBeLessThan(0.1);
    expect(describeAgn(anon)).toContain('typical values are used for the black-hole mass');
  });

  it('builds the scene: the hole, a nuclear cluster, the broad-line clouds, and a camera outside the torus', () => {
    const sim = new Simulation();
    const q = find('3C 273');
    const setup = loadActiveNucleus(sim, q, '3C 273');
    const p = agnFor('3C 273')!;
    expect(p.mass).toBe(8.9e8);
    const hole = sim.bodies.find((b) => b.kind === 'blackhole')!;
    expect(hole.name).toBe('3C 273');
    expect(hole.spin).toBeCloseTo(0.9, 6);
    expect(sim.bodies.filter((b) => b.kind === 'star').length).toBe(16);
    expect(sim.particles.count).toBe(700);
    // The clouds orbit between half and 2.2 broad-line radii, and are not culled.
    expect(sim.particleCullDistance).toBeGreaterThan(p.blrAu * 2.2);
    expect(setup.cameraDistance).toBeCloseTo(p.torusOuterAu * 2.4, 3);
    // A quasar is viewed 30° from its axis; the disc is tilted by DISC_TILT about x.
    expect(setup.elevation).toBeCloseTo(Math.PI / 2 - DISC_TILT - (30 * Math.PI) / 180, 6);
    expect(setup.tip).toContain('zoom in ten thousand times');
    // A blazar's camera looks almost down the axis.
    const sim2 = new Simulation();
    const bl = loadActiveNucleus(sim2, find('BL LAC'));
    expect(bl.elevation).toBeCloseTo(Math.PI / 2 - DISC_TILT - (12 * Math.PI) / 180, 6);
    // The camera starts outside the jets.
    expect(bl.cameraDistance).toBeGreaterThan(agnFor('BL LAC')!.jetLengthAu);
  });
});
