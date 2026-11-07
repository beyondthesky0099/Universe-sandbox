import { describe, expect, it } from 'vitest';
import { addOrbiting } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';
import { ENGINES, G0, KMS_TO_AU_YR, MS2_TO_AU_YR2, orbitAround } from '../src/sim/spaceship';
import { EARTH_MASS } from '../src/sim/units';

function scene() {
  const sim = new Simulation();
  const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1 });
  const earth = addOrbiting(sim, sun, { name: 'Earth', mass: EARTH_MASS, kind: 'rocky' }, { a: 1 });
  return { sim, sun, earth };
}

describe('spacecraft', () => {
  it('converts engine units: 1 g is about 65,000 AU/yr²; 1 km/s is 0.211 AU/yr', () => {
    expect(G0 * MS2_TO_AU_YR2).toBeCloseTo(65264, -2);
    expect(KMS_TO_AU_YR).toBeCloseTo(0.2109, 4);
    expect(ENGINES.find((e) => e.id === 'torch')!.hypothetical).toBe(true);
  });

  it('thrust changes velocity at the set acceleration and burns exactly that much Δv', () => {
    const sim = new Simulation();
    const ship = sim.addBody({ name: 'Ship', kind: 'rocky', mass: 1e-20, fuel: 10 * KMS_TO_AU_YR, tag: 'ship' });
    const a = 0.5 * G0 * MS2_TO_AU_YR2;
    sim.setThrust(ship.id, [a, 0, 0]);
    const t = (2 * KMS_TO_AU_YR) / a; // time to gain 2 km/s
    sim.advance(t, 1e6, 1e9);
    expect(ship.vx / KMS_TO_AU_YR).toBeCloseTo(2, 1);
    expect(ship.fuel! / KMS_TO_AU_YR).toBeCloseTo(8, 1);
    // Out of fuel: the engine stops by itself.
    sim.advance(t * 5, 1e6, 1e9);
    expect(ship.fuel).toBe(0);
    expect(ship.vx / KMS_TO_AU_YR).toBeCloseTo(10, 1);
    expect(sim.thrust.has(ship.id)).toBe(false);
    expect(sim.events.some((e) => /out of fuel/.test(e.message))).toBe(true);
  });

  it('the autopilot flies from 0.2 AU away into a stable orbit around Earth, then lets go', () => {
    const { sim, earth } = scene();
    sim.collisions = false;
    const ship = sim.addBody({ name: 'Ship', kind: 'rocky', mass: 1e-20, tag: 'ship', x: earth.x + 0.2, y: 0.01, z: earth.z, vx: earth.vx, vy: earth.vy, vz: earth.vz });
    const radius = 3e-3; // about 450,000 km
    sim.setAutopilot(ship.id, { target: earth.id, radius, maxAccel: G0 * MS2_TO_AU_YR2 });
    for (let i = 0; i < 400 && sim.autopilot.size; i++) sim.advance(0.002, 1e6, 1e9);
    expect(sim.autopilot.size).toBe(0);
    expect(sim.events.some((e) => /in orbit around Earth/.test(e.message))).toBe(true);
    // Coasting afterwards: still bound, close to the chosen radius, for many orbits.
    sim.advance(0.05, 1e6, 1e9);
    const o = orbitAround(ship, earth, sim.effectiveG);
    expect(o.apoapsis).toBeLessThan(radius * 1.4);
    expect(o.periapsis).toBeGreaterThan(radius * 0.7);
  });

  it('a chemical rocket can run out on a long trip: the autopilot stops when the tank is empty', () => {
    const { sim, earth } = scene();
    sim.collisions = false;
    const ship = sim.addBody({ name: 'Ship', kind: 'rocky', mass: 1e-20, tag: 'ship', fuel: 1 * KMS_TO_AU_YR, x: earth.x + 0.5, z: earth.z });
    sim.setAutopilot(ship.id, { target: earth.id, radius: 3e-3, maxAccel: G0 * MS2_TO_AU_YR2 });
    sim.advance(0.05, 1e6, 1e9);
    expect(ship.fuel).toBe(0);
    expect(sim.autopilot.size).toBe(0);
  });
});

describe('spacecraft in the Solar System', () => {
  it('the autopilot flies a fusion-torch ship from Earth orbit into orbit around Mars, at a steady pace', async () => {
    const { PRESETS } = await import('../src/sim/presets');
    const { physicalRadius } = await import('../src/sim/body');
    const { PARTICLE_CAPACITY } = await import('../src/sim/simulation');
    const sim = new Simulation(PARTICLE_CAPACITY);
    PRESETS.find((p) => p.id === 'solar')!.load(sim);
    const earth = sim.bodies.find((b) => b.name === 'Earth')!;
    const mars = sim.bodies.find((b) => b.name === 'Mars')!;
    const ship = addOrbiting(sim, earth, { name: 'Ship', mass: 1e-20, kind: 'rocky', tag: 'ship' }, { a: 3 * physicalRadius('rocky', earth.mass) });
    expect(sim.parentOf(ship)).toBe(earth);
    sim.setAutopilot(ship.id, { target: mars.id, radius: 3 * physicalRadius('rocky', mars.mass), maxAccel: G0 * MS2_TO_AU_YR2 });
    const t0 = sim.time;
    let calls = 0;
    while (sim.autopilot.size && calls < 200) {
      sim.advance(0.01, 20000, 1e9);
      calls++;
    }
    expect(sim.autopilot.size).toBe(0);
    expect(sim.parentOf(ship)).toBe(mars);
    // A 1 g torch crosses the ~1.4 AU in days (then circularises), not the months a coasting probe needs.
    expect(sim.time - t0).toBeLessThan(0.3);
    expect(sim.bodies.includes(ship)).toBe(true);
  });

  it('ships hit a planet’s real surface, not its enlarged drawing', () => {
    const { sim, earth } = scene();
    // Inside Earth's drawn sphere (0.012 AU) but far above its real surface.
    const ship = sim.addBody({ name: 'Ship', kind: 'rocky', mass: 1e-20, tag: 'ship', x: earth.x + 0.005, z: earth.z, vx: earth.vx, vz: earth.vz + 0.4 });
    sim.advance(0.0005, 1e6, 1e9);
    expect(sim.bodies.includes(ship)).toBe(true);
  });
});
