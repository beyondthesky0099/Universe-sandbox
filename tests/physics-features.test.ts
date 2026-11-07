import { describe, expect, it } from 'vitest';
import { stellarFate } from '../src/sim/stellarFate';
import { habitableZone, isHabitable, surfaceTemperature } from '../src/sim/climate';
import { forecast } from '../src/sim/forecast';
import { addOrbiting, PRESETS } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';
import { captureState, restoreState } from '../src/sim/state';
import { EARTH_MASS, JUPITER_MASS } from '../src/sim/units';

function load(id: string): Simulation {
  const sim = new Simulation();
  PRESETS.find((p) => p.id === id)!.load(sim);
  return sim;
}

function runUntil(sim: Simulation, years: number, done: () => boolean, slices = 200): void {
  for (let i = 0; i < slices && !done(); i++) sim.advance(years / slices, 1e6, 1e9);
}

describe('Barnes–Hut gravity', () => {
  it('matches direct summation to within a few percent', () => {
    const make = () => {
      const sim = new Simulation(0);
      let seed = 1;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 400; i++) {
        sim.addBody({ kind: 'star', mass: 0.1 + rnd(), x: rnd() * 100 - 50, y: rnd() * 100 - 50, z: rnd() * 100 - 50 });
      }
      return sim;
    };
    const direct = make();
    direct.gravityMode = 'direct';
    direct.computeForces();
    const tree = make();
    tree.gravityMode = 'tree';
    tree.computeForces();
    expect(tree.isUsingTree).toBe(true);
    const errors = direct.bodies.map((d, i) => {
      const t = tree.bodies[i];
      return Math.hypot(d.ax - t.ax, d.ay - t.ay, d.az - t.az) / Math.hypot(d.ax, d.ay, d.az);
    });
    errors.sort((a, b) => a - b);
    expect(errors[Math.floor(errors.length / 2)]).toBeLessThan(0.02);
    expect(errors[Math.floor(errors.length * 0.95)]).toBeLessThan(0.08);
  });

  it('switches to the tree automatically for large N', () => {
    const sim = load('cluster');
    sim.computeForces();
    expect(sim.isUsingTree).toBe(true);
  });
});

describe('shattering collisions', () => {
  it('fast rocky impacts make fragments and conserve mass and momentum', () => {
    const sim = new Simulation();
    sim.debris = false;
    sim.addBody({ name: 'Target', kind: 'rocky', mass: EARTH_MASS, x: 0 });
    sim.addBody({ name: 'Impactor', kind: 'rocky', mass: 0.3 * EARTH_MASS, x: 0.05, vx: -1 });
    const m0 = sim.totalMass();
    const p0 = sim.totalMomentum();
    runUntil(sim, 0.05, () => sim.bodies.length > 2);
    expect(sim.bodies.length).toBeGreaterThan(2);
    expect(sim.events.some((e) => e.type === 'shatter')).toBe(true);
    expect(sim.totalMass()).toBeCloseTo(m0, 12);
    const p1 = sim.totalMomentum();
    for (let i = 0; i < 3; i++) expect(p1[i]).toBeCloseTo(p0[i], 10);
  });

  it('slow impacts still merge', () => {
    const sim = new Simulation();
    sim.debris = false;
    sim.addBody({ name: 'A', kind: 'rocky', mass: EARTH_MASS });
    sim.addBody({ name: 'B', kind: 'rocky', mass: 0.3 * EARTH_MASS, x: 0.03, vx: -0.01 });
    runUntil(sim, 0.5, () => sim.bodies.length < 2);
    expect(sim.bodies).toHaveLength(1);
  });

  it('the Giant Impact preset shatters once', () => {
    const sim = load('impact');
    runUntil(sim, 0.6, () => false, 60);
    expect(sim.events.filter((e) => e.type === 'shatter')).toHaveLength(1);
  });
});

describe('tidal disruption', () => {
  it('a moon inside the Roche limit becomes a ring of debris', () => {
    const sim = load('rings');
    const before = sim.bodies.length;
    runUntil(sim, 1.5, () => sim.bodies.length < before);
    expect(sim.bodies.find((b) => b.name === 'Doomed Moon')).toBeUndefined();
    expect(sim.bodies.find((b) => b.name === 'Safe Moon')).toBeDefined();
    expect(sim.particles.count).toBeGreaterThan(100);
    expect(sim.events.some((e) => e.type === 'disrupt')).toBe(true);
  });

  it('black holes shred stars that pass inside the tidal radius', () => {
    const sim = new Simulation();
    const bh = sim.addBody({ name: 'BH', kind: 'blackhole', mass: 1000 });
    const star = sim.addBody({ name: 'Star', kind: 'star', mass: 1, x: 3 });
    expect(sim.rocheLimit(bh, star)).toBeGreaterThan(bh.radius + star.radius);
    runUntil(sim, 1, () => sim.bodies.length < 2);
    expect(sim.bodies).toHaveLength(1);
    expect(sim.bodies[0].mass).toBeGreaterThan(1000);
  });

  it('generated planetary systems are not disrupted spontaneously', () => {
    const sim = load('solar');
    const n = sim.bodies.length;
    sim.advance(3, 1e6, 1e9);
    expect(sim.bodies.length).toBe(n);
  });
});

describe('supernovae', () => {
  it('massive stars leave a black hole, and losing most of their mass unbinds their planets', () => {
    const sim = new Simulation();
    // 45 M☉ at solar metallicity: a Wolf–Rayet star that dies as a Type Ic (stellarFate.ts).
    const star = sim.addBody({ name: 'Big', kind: 'star', mass: 45 });
    const planet = addOrbiting(sim, star, { name: 'P', mass: JUPITER_MASS, kind: 'gas' }, { a: 8 });
    expect(sim.supernova(star)).toBe(true);
    expect(star.kind).toBe('blackhole');
    expect(star.mass).toBeCloseTo(stellarFate(45).remnant!.mass);
    expect(sim.particles.count).toBeGreaterThan(500);
    sim.advance(0.5, 1e6, 1e9);
    const dx = planet.x - star.x, dy = planet.y - star.y, dz = planet.z - star.z;
    const v2 = (planet.vx - star.vx) ** 2 + (planet.vy - star.vy) ** 2 + (planet.vz - star.vz) ** 2;
    const energy = v2 / 2 - (4 * Math.PI ** 2 * (star.mass + planet.mass)) / Math.hypot(dx, dy, dz);
    expect(energy).toBeGreaterThan(0);
  });

  it('mid-mass stars leave neutron stars; small stars cannot explode', () => {
    const sim = new Simulation();
    const mid = sim.addBody({ kind: 'star', mass: 12 });
    const small = sim.addBody({ kind: 'star', mass: 1, x: 100 });
    expect(sim.supernova(mid)).toBe(true);
    expect(mid.kind).toBe('neutron');
    expect(sim.supernova(small)).toBe(false);
  });

  it('scheduled supernovae fire on time', () => {
    const sim = load('supernova');
    sim.advance(9 / 365.25, 1e6, 1e9);
    expect(sim.events.some((e) => e.type === 'supernova')).toBe(false);
    sim.advance(2 / 365.25, 1e6, 1e9);
    expect(sim.events.some((e) => e.type === 'supernova')).toBe(true);
  });

  it('stars merging past the collapse limit explode', () => {
    const sim = new Simulation();
    sim.addBody({ name: 'A', kind: 'star', mass: 30 });
    sim.addBody({ name: 'B', kind: 'star', mass: 25, x: 1 });
    runUntil(sim, 1, () => sim.bodies.length < 2);
    expect(sim.bodies[0].kind).toBe('blackhole');
    expect(sim.events.some((e) => e.type === 'supernova')).toBe(true);
  });
});

describe('climate', () => {
  it('Earth is temperate and the habitable zone brackets 1 AU', () => {
    const t = surfaceTemperature('rocky', EARTH_MASS, 1);
    expect(t).toBeGreaterThan(280);
    expect(t).toBeLessThan(295);
    expect(isHabitable('rocky', EARTH_MASS, t)).toBe(true);
    const [inner, outer] = habitableZone(1);
    expect(inner).toBeLessThan(1);
    expect(outer).toBeGreaterThan(1);
    // Edges agree with the temperature model.
    expect(surfaceTemperature('rocky', EARTH_MASS, 1 / (inner * inner))).toBeCloseTo(330, 0);
    expect(surfaceTemperature('rocky', EARTH_MASS, 1 / (outer * outer))).toBeCloseTo(250, 0);
  });
});

describe('state snapshots', () => {
  it('round-trip bodies, particles, settings and ids', () => {
    const sim = load('solar');
    sim.gravityScale = 1.5;
    sim.advance(0.3, 1e6, 1e9);
    const state = captureState(sim);
    const json = JSON.parse(JSON.stringify(captureState(sim, { json: true })));
    const copy = new Simulation();
    restoreState(copy, state);
    expect(copy.bodies.map((b) => b.id)).toEqual(sim.bodies.map((b) => b.id));
    expect(copy.particles.count).toBe(sim.particles.count);
    expect(copy.gravityScale).toBe(1.5);
    expect(copy.time).toBe(sim.time);
    const fromJson = new Simulation();
    restoreState(fromJson, json);
    expect(fromJson.bodies[3].x).toBeCloseTo(sim.bodies[3].x, 5);
  });
});

describe('forecast', () => {
  it('predicts the Giant Impact collision', () => {
    const sim = load('impact');
    const theia = sim.bodies.find((b) => b.name === 'Theia')!;
    const f = forecast(sim, theia.id, 0.5);
    expect(f.impact?.otherName).toBe('Proto-Earth');
    expect(f.impact!.time).toBeGreaterThan(0);
  });

  it('reports a closest approach without an impact for stable planets', () => {
    const sim = load('solar');
    const earth = sim.bodies.find((b) => b.name === 'Earth')!;
    const f = forecast(sim, earth.id, 1);
    expect(f.impact).toBeUndefined();
    expect(f.closest).toBeDefined();
  });
});

describe('orbit path', () => {
  it('samples a closed ellipse with the right periapsis and apoapsis', async () => {
    const { keplerToState, orbitPath } = await import('../src/sim/orbits');
    const { pos, vel } = keplerToState(39.48, { a: 2, e: 0.5, inc: 0.3, nu: 1 });
    const path = orbitPath(39.48, pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, 721)!;
    let min = Infinity, max = 0;
    for (let i = 0; i < path.length; i += 3) {
      const r = Math.hypot(path[i], path[i + 1], path[i + 2]);
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
    expect(min).toBeCloseTo(1, 3);
    expect(max).toBeCloseTo(3, 3);
    expect(orbitPath(39.48, 1, 0, 0, 0, 0, 20)).toBeNull();
  });
});

describe('fragment names', () => {
  it('numbers pieces of pieces from the original body instead of nesting names', async () => {
    const { Simulation } = await import('../src/sim/simulation');
    const sim = new Simulation();
    sim.addBody({ name: 'Theia fragment 1', mass: 1e-7 });
    sim.addBody({ name: 'Theia fragment 2', mass: 1e-7 });
    expect(sim.fragmentName('Theia')).toBe('Theia fragment 3');
    expect(sim.fragmentName('Theia fragment 4 fragment 5')).toBe('Theia fragment 3');
    expect(sim.fragmentName('Theia fragment 2', [{ name: 'Theia fragment 3' } as never])).toBe('Theia fragment 4');
    expect(sim.fragmentName('Proto-Earth')).toBe('Proto-Earth fragment 1');
  });
});
