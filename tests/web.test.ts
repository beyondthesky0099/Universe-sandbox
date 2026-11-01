import { describe, expect, it } from 'vitest';
import { buildFromSpec, type SceneSpec } from '../src/game/sceneSpec';
import { addOrbiting, PRESETS } from '../src/sim/presets';
import { Simulation, type CustomForce } from '../src/sim/simulation';
import { EARTH_MASS } from '../src/sim/units';
import { ScriptRunner, type ScriptHost } from '../src/ui/console';
import { parseReplay, ReplayPlayer, ReplayRecorder, serializeReplay } from '../src/ui/replay';

describe('scene specs from the scene builder', () => {
  const spec: SceneSpec = {
    title: 'Test',
    summary: 'A star, a giant with a moon, and a rogue.',
    timeScale: 0.5,
    cameraDistance: 15,
    relativity: false,
    bodies: [
      { name: 'Sol', kind: 'star', mass: 1, massUnit: 'sun', orbits: '', a: 0, e: 0, inclinationDeg: 0, phaseDeg: 0, x: 0, z: 0, vx: 0, vz: 0, color: '' },
      { name: 'Big', kind: 'gas', mass: 1, massUnit: 'jupiter', orbits: 'Sol', a: 5, e: 0.05, inclinationDeg: 1, phaseDeg: 30, x: 0, z: 0, vx: 0, vz: 0, color: '#d8b48a' },
      { name: 'Little', kind: 'rocky', mass: 0.01, massUnit: 'earth', orbits: 'Big', a: 0.14, e: 0, inclinationDeg: 0, phaseDeg: 0, x: 0, z: 0, vx: 0, vz: 0, color: 'not-a-colour' },
      { name: 'Orphan', kind: 'rocky', mass: 1, massUnit: 'earth', orbits: 'Missing', a: 2, e: 0, inclinationDeg: 0, phaseDeg: 0, x: 20, z: -5, vx: 1, vz: 0, color: '' },
      { name: 'Sol', kind: 'star', mass: 9, massUnit: 'sun', orbits: '', a: 0, e: 0, inclinationDeg: 0, phaseDeg: 0, x: 0, z: 0, vx: 0, vz: 0, color: '' },
    ],
  };

  it('builds bodies, resolves parents, drops duplicates and keeps orbits stable', () => {
    const sim = new Simulation();
    const setup = buildFromSpec(sim, spec);
    expect(sim.bodies.map((b) => b.name)).toEqual(['Sol', 'Big', 'Little', 'Orphan']);
    const big = sim.bodies[1];
    expect(big.color).toBe(0xd8b48a);
    expect(sim.parentOf(sim.bodies[2])?.name).toBe('Big');
    expect(setup.tip).toContain('giant');
    sim.advance(5, 1e7, 1e9);
    expect(sim.bodies.find((b) => b.name === 'Little')).toBeDefined();
  });

  it('survives garbage input', () => {
    const sim = new Simulation();
    buildFromSpec(sim, { ...spec, timeScale: NaN, bodies: [{ ...spec.bodies[0], kind: 'unicorn' as never, mass: NaN }] });
    expect(sim.bodies).toHaveLength(1);
    expect(sim.bodies[0].kind).toBe('rocky');
    expect(sim.bodies[0].mass).toBeGreaterThan(0);
  });
});

describe('custom force laws', () => {
  it('a drag force makes an orbit decay', () => {
    const sim = new Simulation();
    sim.collisions = false;
    const sun = sim.addBody({ kind: 'star', mass: 1 });
    const p = addOrbiting(sim, sun, { name: 'P', mass: EARTH_MASS }, { a: 1 });
    sim.customForces = [{ name: 'drag', code: 'return body.mass < 1e-3 ? [-0.3 * body.vx, -0.3 * body.vy, -0.3 * body.vz] : undefined;' }];
    sim.advance(2, 1e7, 1e9);
    expect(Math.hypot(p.x - sun.x, p.z - sun.z)).toBeLessThan(0.8);
  });

  it('a broken force is removed and reported', () => {
    const sim = new Simulation();
    sim.addBody({ kind: 'star', mass: 1 });
    sim.customForces = [{ name: 'oops', code: 'throw new Error("nope")' }];
    sim.advance(0.01, 1e5, 1e9);
    expect(sim.customForces).toHaveLength(0);
    expect(sim.events.some((e) => e.type === 'script' && e.message.includes('oops'))).toBe(true);
  });
});

describe('replays', () => {
  it('records, serializes, and plays back with interpolation', () => {
    const sim = new Simulation();
    PRESETS.find((p) => p.id === 'solar')!.load(sim);
    const rec = new ReplayRecorder();
    rec.start('test');
    for (let i = 0; i < 30; i++) {
      sim.advance(0.02, 1e6, 1e9);
      rec.tick(sim, 1 / 15);
    }
    const replay = parseReplay(serializeReplay(rec.stop()!));
    expect(replay.frames.length).toBe(30);
    const view = new Simulation();
    const player = new ReplayPlayer(replay);
    player.seek(0.5);
    player.apply(view);
    expect(view.bodies.length).toBe(sim.bodies.length);
    expect(view.particles.count).toBeGreaterThan(500);
    player.seek(1);
    player.apply(view);
    const earth = view.bodies.find((b) => b.name === 'Earth')!;
    const real = sim.bodies.find((b) => b.name === 'Earth')!;
    expect(Math.hypot(earth.x - real.x, earth.z - real.z)).toBeLessThan(0.05);
  });
});

describe('scripting console', () => {
  function host(sim: Simulation) {
    const logs: string[] = [];
    let forces: CustomForce[] = [];
    let commits = 0;
    const h: ScriptHost = {
      sim,
      commit: () => commits++,
      setRunning: () => {},
      setTimeScale: () => {},
      select: () => {},
      follow: () => {},
      setForces: (f) => (forces = f),
      getForces: () => forces,
      log: (t, kind) => logs.push(`${kind ?? 'out'}:${t}`),
    };
    return { h, logs, forces: () => forces, commits: () => commits };
  }

  it('runs scripts against the API, installs forces and frame hooks, and reports errors', () => {
    const sim = new Simulation();
    sim.addBody({ name: 'Sun', kind: 'star', mass: 1 });
    const t = host(sim);
    const runner = new ScriptRunner(t.h);
    expect(runner.run(`api.orbit('Sun', { name: 'X', mass: api.EARTH }, { a: 1 }); api.log('n', api.bodies().length);`)).toBe(true);
    expect(sim.bodies).toHaveLength(2);
    expect(t.logs).toContain('out:n 2');
    expect(runner.run(`api.force('push', (b) => [1, 0, 0]);`)).toBe(true);
    expect(t.forces()[0].name).toBe('push');
    sim.customForces = t.forces();
    sim.computeForces();
    expect(sim.bodies[0].ax).toBeGreaterThan(0.5);
    let ticks = 0;
    (globalThis as { tick?: () => void }).tick = () => ticks++;
    runner.run(`api.onFrame(() => globalThis.tick());`);
    runner.frame(0.016);
    runner.frame(0.016);
    expect(ticks).toBe(2);
    expect(runner.run(`api.remove('Nobody')`)).toBe(false);
    expect(t.logs.some((l) => l.startsWith('error:') && l.includes('Nobody'))).toBe(true);
    expect(runner.run(`api.force('bad', 'this is not javascript')`)).toBe(false);
  });
});
