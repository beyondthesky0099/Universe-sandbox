import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { applyFrame, encodeFrame } from '../src/sim/protocol';
import { captureState, restoreState } from '../src/sim/state';
import { horizonRadius, iscoRadius, mergerSpin, photonOrbits, radiativeEfficiency, shadowOutline, shadowProfile, SHADOW_RADIUS_SCHWARZSCHILD } from '../src/sim/kerr';

describe('Kerr black holes', () => {
  it('horizon and ISCO follow Bardeen, Press & Teukolsky (1972)', () => {
    expect(horizonRadius(0)).toBe(2);
    expect(horizonRadius(0.998)).toBeCloseTo(1.063, 2);
    expect(iscoRadius(0)).toBeCloseTo(6, 6);
    expect(iscoRadius(0.998)).toBeCloseTo(1.237, 2);
    expect(iscoRadius(0.999999, false)).toBeCloseTo(9, 2);
    expect(iscoRadius(0.5)).toBeCloseTo(4.233, 2);
  });

  it('photon orbits and efficiency', () => {
    expect(photonOrbits(0)).toEqual([expect.closeTo(3, 6), expect.closeTo(3, 6)]);
    const [pro, retro] = photonOrbits(0.9999);
    expect(pro).toBeCloseTo(1, 1);
    expect(retro).toBeCloseTo(4, 2);
    expect(radiativeEfficiency(0)).toBeCloseTo(0.0572, 3);
    expect(radiativeEfficiency(0.998)).toBeCloseTo(0.32, 2);
  });

  it('a non-spinning shadow is a circle of radius √27 M', () => {
    const p = shadowProfile(0, Math.PI / 2);
    for (const r of p) expect(r).toBeCloseTo(1, 5);
    expect(SHADOW_RADIUS_SCHWARZSCHILD).toBeCloseTo(5.196, 3);
  });

  it('a fast-spinning shadow seen edge-on is flattened on the approaching side and shifted the other way', () => {
    const pts = shadowOutline(0.998, Math.PI / 2);
    const xs = pts.map(([x]) => x);
    // Bardeen (1973): from α ≈ −2 M (prograde edge) to ≈ +7 M at maximal spin.
    expect(Math.max(...xs)).toBeCloseTo(2, 0);
    expect(Math.min(...xs)).toBeCloseTo(-7, 0);
    const prof = shadowProfile(0.998, Math.PI / 2);
    // Bin 0 points to the approaching side, bin 16 the opposite way.
    expect(prof[0]).toBeLessThan(0.5);
    expect(prof[16]).toBeGreaterThan(1.2);
    // Seen from near the pole it is round again.
    const top = shadowProfile(0.998, 0.05);
    expect(Math.max(...top) - Math.min(...top)).toBeLessThan(0.05);
  });

  it('mergers leave spinning holes', () => {
    // Equal non-spinning masses: 0.69; GW150914 (36 + 29 M☉) was measured at 0.67 (+0.05/−0.07).
    expect(mergerSpin(1, 1)).toBeCloseTo(0.687, 2);
    expect(mergerSpin(36, 29)).toBeGreaterThan(0.62);
    expect(mergerSpin(36, 29)).toBeLessThan(0.72);
    // A tiny partner barely changes the big hole's spin.
    expect(mergerSpin(100, 0.01, 0.5)).toBeCloseTo(0.5, 2);
    expect(mergerSpin(1, 1, 0.998, 0.998)).toBeLessThanOrEqual(0.998);
  });

  it('a black-hole merger in the simulation leaves a spinning hole, and spin crosses the worker boundary and saves', () => {
    const sim = new Simulation();
    sim.addBody({ name: 'A', kind: 'blackhole', mass: 30, x: -0.5, vy: 0.01 });
    sim.addBody({ name: 'B', kind: 'blackhole', mass: 30, x: 0.5, vy: -0.01 });
    for (let i = 0; i < 400 && sim.bodies.length > 1; i++) sim.advance(0.01, 1e6, 1e9);
    expect(sim.bodies.length).toBe(1);
    const hole = sim.bodies[0];
    expect(hole.spin).toBeCloseTo(0.687, 2);
    const mirror = new Simulation();
    applyFrame(mirror, encodeFrame(sim, 1, sim.advance(0, 1, 1), true));
    expect(mirror.bodies[0].spin).toBeCloseTo(hole.spin!, 12);
    const copy = new Simulation();
    restoreState(copy, JSON.parse(JSON.stringify(captureState(sim))));
    expect(copy.bodies[0].spin).toBeCloseTo(hole.spin!, 5);
  });
});
