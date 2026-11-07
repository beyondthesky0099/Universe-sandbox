import { describe, expect, it } from 'vitest';
import { accreteGas, CRITICAL_CORE, gasAccretionTime, gasSupply, isolationMass, planetesimals, solidDensity, solidMass } from '../src/sim/planetFormation';
import { mulberry32 } from '../src/procgen/rng';
import { Simulation } from '../src/sim/simulation';
import { captureState, restoreState } from '../src/sim/state';
import { EARTH_MASS, JUPITER_MASS } from '../src/sim/units';

describe('planet formation (core accretion)', () => {
  it('uses the minimum-mass solar nebula, with ice beyond the snow line', () => {
    expect(solidDensity(1)).toBeCloseTo(7.1, 6);
    // Across the snow line, ice multiplies the solids about fourfold.
    expect(solidDensity(2.71) / solidDensity(2.69)).toBeGreaterThan(4);
    // Hayashi's nebula holds a few Earth masses of rock inside the snow line.
    const rock = solidMass(0.4, 2.7) / EARTH_MASS;
    expect(rock).toBeGreaterThan(2.5);
    expect(rock).toBeLessThan(5);
  });

  it('gives Kokubo & Ida isolation masses: about a tenth of an Earth at 1 AU, several Earths at Jupiter', () => {
    expect(isolationMass(1) / EARTH_MASS).toBeGreaterThan(0.05);
    expect(isolationMass(1) / EARTH_MASS).toBeLessThan(0.2);
    expect(isolationMass(5.2) / EARTH_MASS).toBeGreaterThan(2);
    // A 4× disc (Pollack et al. 1996) makes cores past the critical mass at Jupiter's distance.
    expect(isolationMass(5.2, 1, 4)).toBeGreaterThan(CRITICAL_CORE);
  });

  it('runs away only past the critical core mass, and stops when the gas is used up or gone', () => {
    const s = { enhancement: 4, speedup: 1 };
    expect(accreteGas(5 * EARTH_MASS, 5, 1e6, s, true)).toBe(5 * EARTH_MASS);
    const grown = accreteGas(12 * EARTH_MASS, 5, 1e5, s, true);
    expect(grown).toBeGreaterThan(12 * EARTH_MASS);
    expect(accreteGas(12 * EARTH_MASS, 5, 1e5, s, false)).toBe(12 * EARTH_MASS);
    // Given time, it grows until it opens a gap: about a Jupiter mass at 5 AU.
    const full = accreteGas(30 * EARTH_MASS, 5.2, 1e8, s, true);
    expect(full).toBeCloseTo(gasSupply(5.2, 4), 12);
    expect(full / JUPITER_MASS).toBeGreaterThan(1);
    expect(full / JUPITER_MASS).toBeLessThan(3);
    // Faster for bigger cores (Kelvin–Helmholtz time ∝ M^−2.5).
    expect(gasAccretionTime(20 * EARTH_MASS)).toBeLessThan(gasAccretionTime(10 * EARTH_MASS) / 5);
  });

  it('lays out planetesimals that carry the disc mass', () => {
    const ps = planetesimals(mulberry32(1), 200, 0.4, 8, 4);
    const total = ps.reduce((m, p) => m + p.mass, 0);
    expect(total).toBeCloseTo(solidMass(0.4, 8, 4), 12);
    expect(ps.every((p) => p.a >= 0.4 && p.a <= 8)).toBe(true);
    // Icy bodies beyond the snow line are heavier than rocky ones inside it.
    const rocky = ps.find((p) => !p.icy)!, icy = ps.find((p) => p.icy)!;
    expect(icy.mass).toBeGreaterThan(rocky.mass * 3);
  });

  it('grows a gas giant in the simulation, then the disc disperses and clears; settings survive saving', () => {
    const sim = new Simulation();
    const star = sim.addBody({ name: 'Young Sun', kind: 'star', mass: 1 });
    const core = sim.addBody({ name: 'Core', kind: 'gas', mass: 15 * EARTH_MASS, x: 5.2, vz: Math.sqrt((4 * Math.PI * Math.PI) / 5.2) });
    sim.particles.add(3, 0, 0, 0, 0, 3, [1, 1, 1]);
    sim.formation = { starId: star.id, enhancement: 4, speedup: 1e5, gasUntil: 30 };
    const copy = new Simulation();
    restoreState(copy, JSON.parse(JSON.stringify(captureState(sim))));
    expect(copy.formation).toEqual(sim.formation);
    for (let i = 0; i < 40; i++) sim.advance(1, 1e6, 1e9);
    expect(core.mass / JUPITER_MASS).toBeGreaterThan(0.3);
    expect(sim.formation.dispersed).toBe(true);
    expect(sim.particles.count).toBe(0);
    const grownAt30 = core.mass;
    sim.advance(5, 1e6, 1e9);
    expect(core.mass).toBe(grownAt30);
  });
});

describe('the Planet Formation scene', () => {
  it('lays out a seeded six-times nebula with formation physics and merging collisions', async () => {
    const { PRESETS, FORMATION_SPEEDUP } = await import('../src/sim/presets');
    const preset = PRESETS.find((p) => p.id === 'proto')!;
    const a = new Simulation();
    preset.load(a);
    const b = new Simulation();
    preset.load(b);
    const embryos = a.bodies.filter((x) => x.kind === 'rocky');
    expect(embryos.length).toBe(80);
    expect(embryos.reduce((m, x) => m + x.mass, 0) / solidMass(0.4, 8, 6)).toBeCloseTo(1, 9);
    // The same every time (seeded).
    expect(b.bodies.map((x) => x.x)).toEqual(a.bodies.map((x) => x.x));
    expect(a.debris).toBe(false);
    expect(a.shatter).toBe(false);
    expect(a.formation?.gasUntil).toBeCloseTo(3e6 / FORMATION_SPEEDUP, 9);
  });
});
