import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { heliocentricEcliptic, julianDate, planetStates, solveKepler } from '../src/sim/ephemeris';
import { hostPosition, loadExoSystem, loadNeighbourhood, massFromRadius, parseCatalog } from '../src/sim/exoplanets';
import { loadSolarSystemOnDate } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';

const catalog = parseCatalog(JSON.parse(readFileSync(new URL('../public/data/exoplanets.json', import.meta.url), 'utf8')));

describe('JPL approximate ephemerides', () => {
  const date = new Date('2026-11-01T00:00:00Z');
  const jd = julianDate(date);

  it('converts dates to Julian dates', () => {
    expect(julianDate(new Date('2000-01-01T12:00:00Z'))).toBeCloseTo(2451545.0, 6);
  });

  it('solves Kepler’s equation', () => {
    const E = solveKepler(1, 0.5);
    expect(E - 0.5 * Math.sin(E)).toBeCloseTo(1, 12);
  });

  // Reference vectors from JPL Horizons (heliocentric, ecliptic J2000, 2026-Nov-01 00:00 TDB).
  it.each([
    ['Jupiter', [-3.666144, 3.85026, 0.066031]],
    ['Mars', [-0.288292, 1.567546, 0.039919]],
  ] as const)('%s matches JPL Horizons within 0.01 AU', (name, ref) => {
    const p = heliocentricEcliptic(name, jd);
    expect(Math.hypot(p[0] - ref[0], p[1] - ref[1], p[2] - ref[2])).toBeLessThan(0.01);
  });

  it('gives sensible velocities (Earth ≈ 2π AU/yr)', () => {
    const earth = planetStates(date).find((p) => p.name === 'Earth')!;
    expect(Math.hypot(...earth.vel)).toBeCloseTo(2 * Math.PI, 0);
  });

  it('builds a stable Solar System for a date', () => {
    const sim = new Simulation();
    loadSolarSystemOnDate(sim, date);
    expect(sim.bodies).toHaveLength(9);
    sim.advance(2, 1e7, 1e9);
    expect(sim.bodies).toHaveLength(9);
  });
});

describe('exoplanet catalogue', () => {
  it('parses thousands of real systems', () => {
    expect(catalog.hosts.length).toBeGreaterThan(4000);
    const trappist = catalog.hosts.find((h) => h.name === 'TRAPPIST-1')!;
    expect(trappist.planets).toHaveLength(7);
    expect(trappist.distancePc).toBeCloseTo(12.4, 0);
    // Sorted by distance: the nearest host is Proxima Centauri (~1.3 pc).
    expect(catalog.hosts[0].distancePc).toBeLessThan(1.5);
  });

  it('estimates masses from radii', () => {
    expect(massFromRadius(1)).toBeCloseTo(1, 5);
    expect(massFromRadius(4)).toBeGreaterThan(5);
  });

  it('loads TRAPPIST-1 with bodies that fit inside their tight orbits and stay stable', () => {
    const sim = new Simulation();
    const setup = loadExoSystem(sim, catalog.hosts.find((h) => h.name === 'TRAPPIST-1')!);
    expect(sim.bodies).toHaveLength(8);
    const star = sim.bodies[0];
    for (const p of sim.bodies.slice(1)) expect(Math.hypot(p.x - star.x, p.z - star.z)).toBeGreaterThan(star.radius * 2);
    sim.advance(setup.timeScale * 20, 1e7, 1e9);
    expect(sim.bodies).toHaveLength(8);
    expect(catalog.hosts.find((h) => h.name === 'TRAPPIST-1')!.planets.some((p) => p.habitable)).toBe(true);
  });

  it('every system loads without immediately destroying itself', () => {
    let lost = 0;
    let total = 0;
    for (const host of catalog.hosts.filter((_, i) => i % 40 === 0)) {
      const sim = new Simulation();
      const setup = loadExoSystem(sim, host);
      const n = sim.bodies.length;
      sim.advance(setup.timeScale * 3, 2e5, 1e9);
      total += n;
      lost += n - sim.bodies.length;
    }
    expect(lost / total).toBeLessThan(0.03);
  }, 60000);

  it('places nearby hosts at their real distances', () => {
    const proxima = catalog.hosts.find((h) => h.name === 'Proxima Cen')!;
    const [x, y, z] = hostPosition(proxima);
    expect(Math.hypot(x, y, z) / 206264.8).toBeCloseTo(proxima.distancePc, 3);
    const sim = new Simulation();
    loadNeighbourhood(sim, catalog, 10);
    expect(sim.bodies.length).toBeGreaterThan(20);
    expect(sim.bodies.some((b) => b.tag === 'exohost:Proxima Cen')).toBe(true);
  });
});
