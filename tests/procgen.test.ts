import { describe, expect, it } from 'vitest';
import { generateGalaxy } from '../src/procgen/galaxy';
import { hash32, mulberry32, seedFromString } from '../src/procgen/rng';
import { generateStarSystem, starSummary } from '../src/procgen/starSystem';
import { loadStarSystem } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';

describe('rng', () => {
  it('is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('hash32 differs for different inputs', () => {
    expect(hash32(1, 2)).not.toBe(hash32(2, 1));
    expect(seedFromString('123')).toBe(123);
    expect(seedFromString('andromeda')).toBe(seedFromString('andromeda'));
  });
});

describe('star systems', () => {
  it('are reproducible from a seed', () => {
    expect(generateStarSystem(1234)).toEqual(generateStarSystem(1234));
  });

  it('agree with the galaxy-map summary for the same seed', () => {
    for (let seed = 0; seed < 200; seed++) {
      const summary = starSummary(seed);
      const system = generateStarSystem(seed);
      expect(system.star.name).toBe(summary.name);
      expect(system.star.mass).toBe(summary.mass);
    }
  });

  it('place planets in increasing orbits inside any companion orbit', () => {
    for (let seed = 0; seed < 300; seed++) {
      const s = generateStarSystem(seed);
      for (let i = 1; i < s.planets.length; i++) expect(s.planets[i].a).toBeGreaterThan(s.planets[i - 1].a);
      if (s.companion) for (const p of s.planets) expect(p.a).toBeLessThan(s.companion.a);
    }
  });

  it('stay mostly intact over a few orbits of the inner planet', () => {
    let lost = 0;
    let total = 0;
    for (let seed = 0; seed < 25; seed++) {
      const spec = generateStarSystem(seed * 7919);
      const sim = new Simulation();
      const setup = loadStarSystem(sim, spec);
      const before = sim.bodies.length;
      sim.advance(setup.timeScale * 10, 2e5, 1e9);
      total += before;
      lost += before - sim.bodies.length;
    }
    expect(lost / total).toBeLessThan(0.1);
  });
});

describe('galaxy', () => {
  it('is reproducible and sized as requested', () => {
    const a = generateGalaxy(7, 2000, 1000);
    const b = generateGalaxy(7, 2000, 1000);
    expect(a.name).toBe(b.name);
    expect(a.stars.positions).toEqual(b.stars.positions);
    expect(a.stars.count).toBe(2000);
    expect(a.glow.count).toBe(1000);
  });
});
