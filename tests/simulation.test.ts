import { describe, expect, it } from 'vitest';
import { kindForMass, mergedKind } from '../src/sim/body';
import { keplerToState } from '../src/sim/orbits';
import { addOrbiting, PRESETS } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';
import { EARTH_MASS, G, JUPITER_MASS } from '../src/sim/units';

describe('orbits', () => {
  it('circular orbit has speed sqrt(mu/r) and +Y angular momentum', () => {
    const { pos, vel } = keplerToState(G, { a: 1, nu: 0.3 });
    expect(Math.hypot(pos.x, pos.y, pos.z)).toBeCloseTo(1, 10);
    expect(Math.hypot(vel.x, vel.y, vel.z)).toBeCloseTo(2 * Math.PI, 10);
    const Ly = pos.z * vel.x - pos.x * vel.z;
    expect(Ly).toBeGreaterThan(0);
  });
});

describe('Simulation', () => {
  it('keeps an Earth-like orbit closed after one year and conserves energy', () => {
    const sim = new Simulation();
    sim.collisions = false;
    const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1 });
    const earth = addOrbiting(sim, sun, { name: 'Earth', mass: EARTH_MASS }, { a: 1 });
    sim.recenter();
    const x0 = earth.x;
    const z0 = earth.z;
    const e0 = sim.totalEnergy();
    sim.advance(1, 1e7, 1e9);
    expect(Math.hypot(earth.x - x0, earth.z - z0)).toBeLessThan(0.01);
    expect(Math.abs((sim.totalEnergy() - e0) / e0)).toBeLessThan(1e-5);
  });

  it('merges colliding bodies, conserving mass and momentum', () => {
    const sim = new Simulation();
    sim.debris = false;
    sim.addBody({ name: 'A', mass: 5 * EARTH_MASS, x: -0.05, vx: 2 });
    sim.addBody({ name: 'B', mass: 3 * EARTH_MASS, x: 0.05, vx: -1 });
    const p0 = sim.totalMomentum();
    const m0 = sim.bodies.reduce((s, b) => s + b.mass, 0);
    sim.advance(0.05, 1e6, 1e9);
    expect(sim.bodies).toHaveLength(1);
    expect(sim.bodies[0].mass).toBeCloseTo(m0, 15);
    expect(sim.bodies[0].name).toBe('A');
    const p1 = sim.totalMomentum();
    for (let i = 0; i < 3; i++) expect(p1[i]).toBeCloseTo(p0[i], 12);
    expect(sim.events.some((e) => e.type === 'merge')).toBe(true);
  });

  it('ignites a star when enough gas giants merge', () => {
    const sim = new Simulation();
    sim.debris = false;
    sim.addBody({ name: 'Big', mass: 50 * JUPITER_MASS, kind: 'gas' });
    sim.addBody({ name: 'Other', mass: 40 * JUPITER_MASS, kind: 'gas', x: 0.1 });
    sim.advance(0.01, 1e6, 1e9);
    expect(sim.bodies).toHaveLength(1);
    expect(sim.bodies[0].kind).toBe('star');
    expect(sim.events.some((e) => e.type === 'ignite')).toBe(true);
  });

  it('absorbs particles that fall into a body', () => {
    const sim = new Simulation();
    sim.addBody({ name: 'Star', kind: 'star', mass: 1 });
    sim.particles.add(0.5, 0, 0, 0, 0, 0, [1, 1, 1]);
    sim.advance(1, 1e6, 1e9);
    expect(sim.particles.count).toBe(0);
  });

  it('with gravity disabled, bodies move in straight lines', () => {
    const sim = new Simulation();
    sim.gravityScale = 0;
    const a = sim.addBody({ name: 'A', mass: 1, kind: 'star', x: 0, vx: 1 });
    sim.addBody({ name: 'B', mass: 1, kind: 'star', x: 5 });
    sim.advance(2, 1e6, 1e9);
    expect(a.x).toBeCloseTo(2, 9);
  });

  it('loads every preset without error', () => {
    for (const preset of PRESETS) {
      const sim = new Simulation();
      const setup = preset.load(sim);
      expect(sim.bodies.length).toBeGreaterThan(0);
      expect(setup.cameraDistance).toBeGreaterThan(0);
      sim.advance(0.01, 200, 1e9);
      for (const b of sim.bodies) expect(Number.isFinite(b.x + b.vx)).toBe(true);
    }
  });
});

describe('body kinds', () => {
  it('classifies by mass', () => {
    expect(kindForMass(EARTH_MASS)).toBe('rocky');
    expect(kindForMass(JUPITER_MASS)).toBe('gas');
    expect(kindForMass(1)).toBe('star');
    expect(kindForMass(60)).toBe('blackhole');
  });

  it('never downgrades a black hole', () => {
    expect(mergedKind('blackhole', 'rocky', 0.001)).toBe('blackhole');
  });
});
