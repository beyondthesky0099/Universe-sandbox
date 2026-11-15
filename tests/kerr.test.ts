import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { applyFrame, encodeFrame } from '../src/sim/protocol';
import { captureState, restoreState } from '../src/sim/state';
import { drawnShadowRadius, einsteinRadius, horizonRadius, iscoRadius, mergerSpin, photonOrbits, radiativeEfficiency, shadowOutline, shadowProfile, SHADOW_PER_SCHWARZSCHILD, SHADOW_RADIUS_SCHWARZSCHILD } from '../src/sim/kerr';
import { physicalRadius } from '../src/sim/body';
import { C_AU_PER_YEAR, G } from '../src/sim/units';

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

  it('draws the shadow 2.6 Schwarzschild radii wide at real sizes, from the body radius at game sizes', () => {
    // A 10 M☉ hole: the Schwarzschild radius is 2GM/c² ≈ 29.5 km, the shadow √27 GM/c² ≈ 76.7 km.
    const rs = physicalRadius('blackhole', 10);
    const M = (G * 10) / (C_AU_PER_YEAR * C_AU_PER_YEAR);
    expect(rs).toBeCloseTo(2 * M, 12);
    expect(rs * 149597870.7).toBeCloseTo(29.5, 0);
    expect(drawnShadowRadius(rs, true)).toBeCloseTo(Math.sqrt(27) * M, 12);
    expect(drawnShadowRadius(rs, true) * 149597870.7).toBeCloseTo(76.7, 0);
    expect(SHADOW_PER_SCHWARZSCHILD).toBeCloseTo(2.598, 3);
    // Game sizes are arbitrary: the radius stands for the shadow itself.
    expect(drawnShadowRadius(0.04, false)).toBe(0.04);
    // The horizon drawn inside the shadow (BodyVisual: shadow × r₊/√27) comes back to the Schwarzschild radius.
    expect((drawnShadowRadius(rs, true) * horizonRadius(0)) / SHADOW_RADIUS_SCHWARZSCHILD).toBeCloseTo(rs, 12);
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

  it('the Einstein radius grows with distance: 17 shadow radii from 1,000 Schwarzschild radii, 2.2 from 17', () => {
    const rs = physicalRadius('blackhole', 10);
    const shadow = drawnShadowRadius(rs, true);
    const ratio = (d: number) => einsteinRadius(shadow, d * rs) / (shadow / (d * rs)); // θ_E over the shadow's angular radius
    expect(ratio(1000)).toBeCloseTo(17.2, 1);
    expect(ratio(16.9)).toBeCloseTo(2.24, 1);
    // θ_E = √(2 R_s / D): a 10 M☉ hole 1 AU away bends the sky within 2.2 arcminutes.
    expect(einsteinRadius(shadow, 1) * 3437.75).toBeCloseTo(2.2, 1);
    // Never inside the photon sphere: the formula is held at 3.5 R_s.
    expect(einsteinRadius(shadow, 0.1 * rs)).toBe(einsteinRadius(shadow, 3.5 * rs));
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
