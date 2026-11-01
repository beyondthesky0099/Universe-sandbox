import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { physicalRadius, radiusFor } from '../src/sim/body';
import { loadSolarSystemOnDate, loadSolarSystemTrueScale } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';
import { parseSolarData, setSolarData } from '../src/sim/solarSystemData';
import { captureState, restoreState } from '../src/sim/state';
import { setTrueScale } from '../src/sim/trueScale';
import { EARTH_MASS, JUPITER_MASS } from '../src/sim/units';

const KM = 149597870.7;
const km = (au: number) => au * KM;

beforeAll(() => {
  const read = (f: string) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
  setSolarData(parseSolarData(read('solar-system.json'), read('small-bodies.json')));
});
afterAll(() => setSolarData(undefined));

describe('physical radii', () => {
  it('match real bodies', () => {
    expect(km(physicalRadius('rocky', EARTH_MASS))).toBeCloseTo(6371, -1);
    expect(km(physicalRadius('gas', JUPITER_MASS))).toBeCloseTo(69911, -1);
    expect(km(physicalRadius('gas', 0.299 * JUPITER_MASS)) / 58232).toBeCloseTo(1, 1); // Saturn
    expect(km(physicalRadius('gas', 17.1 * EARTH_MASS)) / 24622).toBeCloseTo(1, 0); // Neptune
    expect(km(physicalRadius('star', 1))).toBeCloseTo(695700, -2);
    expect(km(physicalRadius('whitedwarf', 0.6))).toBeGreaterThan(7000); // about Earth-sized
    expect(km(physicalRadius('whitedwarf', 0.6))).toBeLessThan(10000);
    expect(km(physicalRadius('neutron', 1.4))).toBeCloseTo(12, 5);
    expect(km(physicalRadius('blackhole', 1))).toBeCloseTo(2.95, 1); // Schwarzschild radius
  });
});

describe('real sizes mode', () => {
  it('switches every body between real and enlarged sizes, and survives save/load', () => {
    const sim = new Simulation();
    loadSolarSystemOnDate(sim, new Date('2026-11-01T00:00:00Z'));
    const earth = () => sim.bodies.find((b) => b.name === 'Earth')!;
    setTrueScale(sim, true);
    expect(km(earth().radius)).toBeCloseTo(6371, 0); // the measured value from JPL
    expect(sim.softening).toBe(1e-8);
    const saved = captureState(sim);
    setTrueScale(sim, false);
    expect(earth().radius).toBe(radiusFor('rocky', earth().mass));
    restoreState(sim, saved);
    expect(sim.trueScale).toBe(true);
    expect(km(earth().radius)).toBeCloseTo(6371, 0);
    // Files saved before this setting existed load with enlarged sizes.
    const old = captureState(sim);
    delete old.settings.trueScale;
    restoreState(sim, old);
    expect(sim.trueScale).toBe(false);
  });

  it('keeps real sizes when bodies merge', () => {
    const sim = new Simulation();
    setTrueScale(sim, true);
    const a = sim.addBody({ name: 'A', kind: 'rocky', mass: EARTH_MASS, radius: physicalRadius('rocky', EARTH_MASS) });
    sim.addBody({ name: 'B', kind: 'rocky', mass: EARTH_MASS, radius: physicalRadius('rocky', EARTH_MASS), x: a.radius * 1.5, vx: -0.01 });
    sim.shatter = false;
    sim.advance(0.01, 1e6, 1e9);
    expect(sim.bodies.length).toBe(1);
    expect(sim.bodies[0].radius).toBeCloseTo(physicalRadius('rocky', 2 * EARTH_MASS), 12);
  });
});

describe('the true-scale Solar System', () => {
  it('includes the major moons and keeps them on their orbits', () => {
    const sim = new Simulation();
    loadSolarSystemTrueScale(sim, new Date('2026-11-01T00:00:00Z'));
    expect(sim.trueScale).toBe(true);
    const names = sim.bodies.map((b) => b.name);
    for (const n of ['Moon', 'Io', 'Ganymede', 'Titan', 'Triton', 'Charon']) expect(names).toContain(n);
    const before = sim.bodies.length;
    sim.advance(0.03, 1e7, 1e9); // ~11 days: six orbits of Io
    expect(sim.bodies.length).toBe(before);
    for (const [moon, planet] of [['Moon', 'Earth'], ['Io', 'Jupiter'], ['Titan', 'Saturn'], ['Charon', 'Pluto']]) {
      expect(sim.parentOf(sim.bodies.find((b) => b.name === moon)!)?.name, moon).toBe(planet);
    }
  }, 120000);
});
