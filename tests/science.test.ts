import { describe, expect, it } from 'vitest';
import { isTidallyLocked, lagrangePoints, nearResonance, orbitalPeriod } from '../src/sim/analysis';
import { mainSequenceLifetime } from '../src/sim/body';
import { addOrbiting, PRESETS } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';
import { captureState, restoreState } from '../src/sim/state';
import { C_AU_PER_YEAR, EARTH_MASS, G, JUPITER_MASS } from '../src/sim/units';

const load = (id: string) => {
  const sim = new Simulation();
  PRESETS.find((p) => p.id === id)!.load(sim);
  return sim;
};

/** Angle of the eccentricity vector (periapsis direction) in the XZ plane. */
function periapsisAngle(sim: Simulation, body = sim.bodies[1], parent = sim.bodies[0]): number {
  const rx = body.x - parent.x, rz = body.z - parent.z, ry = body.y - parent.y;
  const vx = body.vx - parent.vx, vz = body.vz - parent.vz, vy = body.vy - parent.vy;
  const mu = G * (body.mass + parent.mass);
  const r = Math.hypot(rx, ry, rz);
  const rv = rx * vx + ry * vy + rz * vz;
  const v2 = vx * vx + vy * vy + vz * vz;
  const ex = ((v2 - mu / r) * rx - rv * vx) / mu;
  const ez = ((v2 - mu / r) * rz - rv * vz) / mu;
  return Math.atan2(ez, ex);
}

describe('general relativity', () => {
  it('precesses an orbit at the rate GR predicts', () => {
    const sim = new Simulation();
    sim.relativity = true;
    sim.lightSpeedScale = 0.01;
    sim.collisions = false;
    sim.eta = 0.005;
    const sun = sim.addBody({ kind: 'star', mass: 1 });
    addOrbiting(sim, sun, { name: 'M', mass: 1e-12 }, { a: 0.387, e: 0.206 });
    const before = periapsisAngle(sim);
    const period = 2 * Math.PI * Math.sqrt(0.387 ** 3 / G);
    const orbits = 10;
    sim.advance(period * orbits, 1e7, 1e9);
    const after = periapsisAngle(sim);
    let shift = Math.abs(after - before);
    if (shift > Math.PI) shift = 2 * Math.PI - shift;
    const c = C_AU_PER_YEAR * 0.01;
    const expected = (orbits * 6 * Math.PI * G) / (c * c * 0.387 * (1 - 0.206 ** 2));
    expect(shift).toBeGreaterThan(expected * 0.8);
    expect(shift).toBeLessThan(expected * 1.2);
  });

  it('is off by default (no precession)', () => {
    const sim = new Simulation();
    sim.collisions = false;
    sim.eta = 0.005;
    const sun = sim.addBody({ kind: 'star', mass: 1 });
    addOrbiting(sim, sun, { name: 'M', mass: 1e-12 }, { a: 0.387, e: 0.206 });
    const before = periapsisAngle(sim);
    sim.advance(2.4, 1e7, 1e9);
    expect(Math.abs(periapsisAngle(sim) - before)).toBeLessThan(2e-3);
  });

  it('black hole binaries inspiral and merge with a gravitational-wave event', () => {
    const sim = load('inspiral');
    for (let i = 0; i < 200 && sim.bodies.length > 1; i++) sim.advance(0.5, 1e7, 1e9);
    expect(sim.bodies).toHaveLength(1);
    expect(sim.bodies[0].mass).toBeCloseTo(20, 6);
    expect(sim.events.some((e) => e.type === 'gwmerger')).toBe(true);
    expect(sim.time).toBeGreaterThan(5);
  }, 60000);
});

describe('stellar evolution', () => {
  it('lifetimes scale steeply with mass', () => {
    expect(mainSequenceLifetime(1)).toBeCloseTo(1e10, -6);
    expect(mainSequenceLifetime(10)).toBeLessThan(5e7);
  });

  it('a Sun-like star becomes a red giant, then a white dwarf with a nebula', () => {
    const sim = new Simulation();
    const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1, age: 4.6e9 });
    sim.ageBy(6e9);
    expect(sun.kind).toBe('giant');
    expect(sun.radius).toBeGreaterThan(0.5);
    sim.ageBy(1e9);
    expect(sun.kind).toBe('whitedwarf');
    expect(sun.mass).toBeLessThan(0.7);
    expect(sim.particles.count).toBeGreaterThan(500);
    expect(sim.events.map((e) => e.type)).toEqual(expect.arrayContaining(['redgiant', 'nebula']));
  });

  it('massive stars skip straight to a supernova', () => {
    const sim = new Simulation();
    const star = sim.addBody({ kind: 'star', mass: 15 });
    sim.ageBy(mainSequenceLifetime(15) * 1.01);
    expect(star.kind).toBe('neutron');
  });

  it('the red giant Sun engulfs the inner planets', () => {
    const sim = load('future');
    sim.particles.clear(); // the asteroid belt only slows the test down
    for (let i = 0; i < 60; i++) sim.advance(0.5, 1e7, 1e9);
    const names = sim.bodies.map((b) => b.name);
    expect(names).not.toContain('Mercury');
    expect(sim.bodies.find((b) => b.name === 'Sun')!.kind).toBe('giant');
  }, 60000);

  it('a white dwarf pushed past 1.4 M☉ explodes completely', () => {
    const sim = new Simulation();
    sim.debris = false;
    const wd = sim.addBody({ name: 'WD', kind: 'whitedwarf', mass: 1.3 });
    sim.addBody({ name: 'Donor', kind: 'star', mass: 0.3, x: 0.05 });
    sim.advance(0.01, 1e6, 1e9);
    expect(sim.getBody(wd.id)).toBeUndefined();
    expect(sim.bodies).toHaveLength(0);
    expect(sim.events.some((e) => e.type === 'supernova')).toBe(true);
  });
});

describe('orbital analysis', () => {
  it('a Trojan placed at L4 stays near it', () => {
    const sim = new Simulation();
    sim.collisions = false;
    const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1 });
    const jup = addOrbiting(sim, sun, { name: 'Jupiter', mass: JUPITER_MASS, kind: 'gas' }, { a: 5.2 });
    const l4 = lagrangePoints(sun, jup).find((p) => p.name === 'L4')!;
    const r = Math.hypot(l4.x, l4.z);
    const v = Math.sqrt(G / r);
    // Same angular velocity as Jupiter.
    const trojan = sim.addBody({ name: 'Trojan', mass: 1e-12, x: l4.x, y: l4.y, z: l4.z, vx: (l4.z / r) * v, vz: (-l4.x / r) * v });
    sim.advance(60, 1e7, 1e9);
    const now = lagrangePoints(sun, jup).find((p) => p.name === 'L4')!;
    expect(Math.hypot(trojan.x - now.x, trojan.z - now.z)).toBeLessThan(1.5);
  });

  it('detects the Neptune–Pluto 3:2 resonance', () => {
    expect(nearResonance(164.8, 247.9)).toEqual([3, 2]);
    expect(nearResonance(1, 1.37)).toBeUndefined();
  });

  it('computes periods and tidal locking', () => {
    const sim = load('solar');
    const sun = sim.bodies.find((b) => b.name === 'Sun')!;
    const earth = sim.bodies.find((b) => b.name === 'Earth')!;
    expect(orbitalPeriod(earth, sun)).toBeCloseTo(1, 1);
    expect(isTidallyLocked(earth, sun, 1)).toBe(false);
    const dwarf = { ...sun, mass: 0.2 };
    expect(isTidallyLocked(earth, dwarf, 0.1)).toBe(true);
  });

  it('state snapshots keep ages, tags, fuel and relativity settings', () => {
    const sim = new Simulation();
    sim.relativity = true;
    sim.lightSpeedScale = 0.01;
    sim.addBody({ name: 'Probe', mass: 1e-15, tag: 'probe', fuel: 2, age: 5 });
    const copy = new Simulation();
    restoreState(copy, JSON.parse(JSON.stringify(captureState(sim, { json: true }))));
    expect(copy.relativity).toBe(true);
    expect(copy.lightSpeedScale).toBe(0.01);
    expect(copy.bodies[0]).toMatchObject({ tag: 'probe', fuel: 2, age: 5 });
    void EARTH_MASS;
  });
});
