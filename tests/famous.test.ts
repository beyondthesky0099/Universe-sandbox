import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { famousGalaxies, famousNebulae, type FamousObjects } from '../src/sim/famous';
import { COSMIC_STRUCTURES, displayName } from '../src/sim/galaxies';
import { CMB_DISTANCE_MPC } from '../src/sim/cosmology';

const famous = JSON.parse(readFileSync('public/data/famous-objects.json', 'utf8')) as FamousObjects;
const all = [...famous.map, ...famous.nebulae, ...famous.cosmos];
const byName = (name: string) => all.find((o) => o.name === name)!;
/** Angular separation (degrees) of two galactic positions. */
function sep(l1: number, b1: number, l2: number, b2: number): number {
  const D = Math.PI / 180;
  const c = Math.sin(b1 * D) * Math.sin(b2 * D) + Math.cos(b1 * D) * Math.cos(b2 * D) * Math.cos((l1 - l2) * D);
  return Math.acos(Math.min(1, c)) / D;
}

describe('famous objects (scripts/build-famous-objects.mjs)', () => {
  it('every entry has a position, a distance or redshift, and a source', () => {
    expect(famous.map.length).toBeGreaterThanOrEqual(12);
    expect(famous.nebulae.length).toBeGreaterThanOrEqual(7);
    expect(famous.cosmos.length).toBeGreaterThanOrEqual(20);
    for (const o of all) {
      expect(o.l, o.name).toBeGreaterThanOrEqual(0);
      expect(o.l, o.name).toBeLessThan(360);
      expect(Math.abs(o.b), o.name).toBeLessThanOrEqual(90);
      expect(o.ref.length, o.name).toBeGreaterThan(5);
      const d = 'z' in o && o.z !== undefined ? o.z : o.d;
      expect(d, o.name).toBeGreaterThan(0);
    }
    for (const o of [...famous.map, ...famous.cosmos]) expect(o.note.length, o.name).toBeGreaterThan(30);
    expect(new Set(all.map((o) => o.name)).size).toBe(all.length);
  });

  it('puts them where they are (galactic coordinates and distances from the literature)', () => {
    // [name, l, b, tolerance (deg)]
    const places: [string, number, number, number][] = [
      ['UY Scuti', 19.14, -0.47, 0.05],
      ['Stephenson 2-18', 26.1, -0.03, 0.2],
      ['Crater II', 282.9, 42.0, 0.2],
      ['Antlia II', 264.9, 11.2, 0.3],
      ['Smith Cloud', 38.67, -13.41, 0.01],
      ['Barnard’s Loop', 206.7, -20.5, 1],
      ['Einstein Cross', 71.8, -46.1, 0.1],
      ['Stephan’s Quintet', 93.3, -21.0, 0.1],
    ];
    for (const [name, l, b, tol] of places) {
      const o = byName(name);
      expect(sep(o.l, o.b, l, b), name).toBeLessThan(tol);
    }
    // Parallax distances: WISE 0855 at 2.3 pc, Scholz's Star at 6.7 pc, Przybylski's Star ~110 pc.
    expect(byName('WISE 0855−0714').d! * 1000).toBeCloseTo(2.28, 1);
    expect(byName('Scholz’s Star').d! * 1000).toBeCloseTo(6.7, 0);
    expect(byName('Przybylski’s Star').d! * 1000).toBeGreaterThan(100);
    expect(byName('Przybylski’s Star').d! * 1000).toBeLessThan(120);
  });

  it('become nebulae, and galaxies at their redshift or measured distance', () => {
    const nebulae = famousNebulae(famous.nebulae);
    expect(nebulae.find((n) => n.name === 'Gum Nebula')?.radiusDeg).toBe(18);
    expect(nebulae.every((n) => n.distanceKpc! > 0 && n.ref && !n.distanceNote)).toBe(true);

    const g = famousGalaxies(famous.cosmos);
    const get = (n: string) => g.find((x) => x.name === n)!;
    expect(get('Crater II').d).toBeCloseTo(0.117, 3);
    expect(get('Crater II').zd).toBeUndefined();
    // El Gordo at z = 0.87: about 3,000 Mpc away (comoving).
    expect(get('El Gordo').d).toBeGreaterThan(2800);
    expect(get('El Gordo').d).toBeLessThan(3300);
    expect(get('El Gordo').kind).toBe('cluster');
    expect(get('Einstein Cross').cl).toBe('Q');
    // A single lensed star is not a galaxy to fly into; galaxies are.
    expect(get('Earendel').noVisit).toBe(true);
    expect(get('Hoag’s Object').noVisit).toBeUndefined();
    // They keep their names on the map.
    expect(displayName(get('Hoag’s Object'))).toBe('Hoag’s Object');
  });

  it('labels the Milky Way’s streams, the LMC’s giants and the CMB Cold Spot in the Universe tab', () => {
    const s = (n: string) => COSMIC_STRUCTURES.find((x) => x.name === n)!;
    for (const n of ['Sagittarius Stream', 'Gaia–Enceladus', 'Tarantula Nebula', 'WOH G64', 'CMB Cold Spot']) expect(s(n)?.note, n).toBeTruthy();
    // The Tarantula is in the Large Magellanic Cloud (l 280.5°, b −32.9°, 50 kpc).
    expect(sep(s('Tarantula Nebula').l, s('Tarantula Nebula').b, 280.5, -32.9)).toBeLessThan(2);
    // On the CMB's sphere (just inside it, so the label draws in front).
    expect(s('CMB Cold Spot').d / CMB_DISTANCE_MPC).toBeGreaterThan(0.99);
    expect(s('CMB Cold Spot').d / CMB_DISTANCE_MPC).toBeLessThan(1);
  });
});

describe('famous stars up close', () => {
  it('shows a supergiant at its real size with the Sun to scale beside it, and keeps them apart', async () => {
    const { Simulation } = await import('../src/sim/simulation');
    const { loadStarToScale } = await import('../src/sim/presets');
    const f = famous.map.find((o) => o.name === 'Stephenson 2-18')!;
    expect(f.visit?.radiusSun).toBe(2150);
    const sim = new Simulation();
    const setup = loadStarToScale(sim, { ...f, visit: f.visit! });
    const R_SUN = 695700 / 149597870.7;
    const star = sim.bodies.find((b) => b.name === 'Stephenson 2-18')!;
    const sun = sim.bodies.find((b) => b.name === 'The Sun (to scale)')!;
    // 2,150 solar radii is 10 AU: Saturn's orbit would fit inside.
    expect(star.radius).toBeCloseTo(2150 * R_SUN, 6);
    expect(star.radius).toBeGreaterThan(9.5);
    expect(sun.radius).toBeCloseTo(R_SUN, 9);
    expect(setup.tip).toMatch(/2,150 times the Sun/);
    // A few orbits of the Sun: nothing merges or explodes, and the sizes stay real.
    const period = Math.sqrt((star.radius * 1.6) ** 3 / 16);
    for (let i = 0; i < 40; i++) sim.advance(period / 10);
    expect(sim.bodies.map((b) => b.name).sort()).toEqual(['Stephenson 2-18', 'The Sun (to scale)']);
    const s = sim.bodies.find((b) => b.name === 'Stephenson 2-18')!;
    const sunNow = sim.bodies.find((b) => b.name === 'The Sun (to scale)')!;
    expect(s.kind).toBe('giant');
    expect(s.radius).toBeCloseTo(2150 * R_SUN, 6);
    expect(Math.hypot(sunNow.x - s.x, sunNow.y - s.y, sunNow.z - s.z)).toBeGreaterThan(s.radius);
  });
});

describe('the second "what did we miss" pass', () => {
  it('names catalogue nebulae by position, adds stars, clusters, asterisms, galaxies and structures', async () => {
    const { nameNebulae } = await import('../src/sim/famous');
    const { parseNebulae } = await import('../src/sim/nebulae');
    const named = nameNebulae(parseNebulae(JSON.parse(readFileSync('public/data/nebulae.json', 'utf8'))), famous.nebulaNames);
    for (const n of ['Thor’s Helmet (NGC 2359)', 'Red Spider Nebula (NGC 6537)', 'Ant Nebula (Mz 3)', 'Manatee Nebula (W50, around SS 433)']) expect(named.some((x) => x.name === n), n).toBe(true);
    expect(famous.nebulaNames!.length).toBe(9);
    // Stars and clusters where they are: Eta Carinae in Carina, Westerlund 1 about 13,000 light-years away.
    expect(sep(byName('Eta Carinae').l, byName('Eta Carinae').b, 287.6, -0.6)).toBeLessThan(0.1);
    expect(byName('Westerlund 1').d! * 3261.56).toBeGreaterThan(11000);
    for (const n of ['Pistol Star', 'R136a1', 'Arches Cluster']) expect(n === 'R136a1' || byName(n), n).toBeTruthy();
    // Asterisms are sky-only.
    expect(famous.sky!.map((s) => s.name)).toEqual(['Kemble’s Cascade', 'Coathanger (Collinder 399)']);
    // Galaxies the catalogues list by number get their names.
    expect(displayName({ name: 'NGC3628' })).toBe('Hamburger Galaxy (NGC 3628)');
    expect(displayName({ name: 'H 1413+117' })).toBe('Cloverleaf Quasar (H1413+117)');
    for (const n of ['Mayall’s Object', 'MACS0647-JD', 'Abell S1063', 'Hercules A']) expect(famousGalaxies(famous.cosmos).some((g) => g.name === n), n).toBe(true);
    // Large-scale structure, with the Saraswati Supercluster at z ≈ 0.28 (about 1,150 Mpc).
    const s = (n: string) => COSMIC_STRUCTURES.find((x) => x.name === n)!;
    for (const n of ['Saraswati Supercluster', 'Dipole Repeller', 'KBC Void', 'South Pole Wall', 'Eridanus Supervoid', 'Huge-LQG', 'R136a1']) expect(s(n)?.note, n).toBeTruthy();
    expect(s('Saraswati Supercluster').d).toBeGreaterThan(1100);
    expect(s('Saraswati Supercluster').d).toBeLessThan(1200);
  });
});
