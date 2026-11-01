import { describe, expect, it } from 'vitest';
import { LESSONS, type LessonContext } from '../src/game/lessons';
import { nearResonance, orbitalPeriod } from '../src/sim/analysis';
import { addOrbiting } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';
import { EARTH_MASS } from '../src/sim/units';
import { measure } from '../src/ui/graph';

const lesson = (id: string) => LESSONS.find((l) => l.id === id)!;
const ctx = (sim: Simulation, extra: Partial<LessonContext> = {}): LessonContext => ({
  sim,
  events: [],
  flags: { habitableZones: false, lagrange: false, relativity: sim.relativity },
  ...extra,
});

/** Run a step's scene until `until` passes (collecting events) or time runs out. */
function runStep(stepSetup: (s: Simulation) => unknown, years: number, until: (c: LessonContext) => boolean, prepare?: (s: Simulation) => void): boolean {
  const sim = new Simulation();
  stepSetup(sim);
  prepare?.(sim);
  const events = [] as LessonContext['events'];
  for (let t = 0; t < years; t += 0.25) {
    sim.advance(0.25, 1e7, 1e9);
    events.push(...sim.events.splice(0));
    if (until(ctx(sim, { events }))) return true;
  }
  return false;
}

describe('lessons', () => {
  it('every step with a scene loads, and selected bodies exist', () => {
    for (const l of LESSONS) {
      let sim: Simulation | undefined;
      for (const step of l.steps) {
        if (step.setup) {
          sim = new Simulation();
          step.setup(sim);
          expect(sim.bodies.length, `${l.id}: ${step.title}`).toBeGreaterThan(0);
        }
        if (step.select) expect(sim!.bodies.some((b) => b.name === step.select), `${l.id}: ${step.select}`).toBe(true);
      }
    }
  });

  it('Kepler: the comet’s distance and speed vary inversely', () => {
    const sim = new Simulation();
    lesson('kepler').steps[0].setup!(sim);
    const comet = sim.bodies.find((b) => b.name === 'Comet')!;
    const far = { d: measure(sim, 'distance', comet)!, v: measure(sim, 'speed', comet)! };
    sim.advance(1.4, 1e7, 1e9); // about half an orbit: near perihelion
    const near = { d: measure(sim, 'distance', comet)!, v: measure(sim, 'speed', comet)! };
    expect(near.d).toBeLessThan(far.d);
    expect(near.v).toBeGreaterThan(far.v);
    expect(measure(sim, 'eccentricity', comet)).toBeCloseTo(0.6, 1);
  });

  it('Resonance: the planets start in a 2:1 resonance', () => {
    const sim = new Simulation();
    lesson('resonance').steps[0].setup!(sim);
    const [star, inner, outer] = sim.bodies;
    expect(nearResonance(orbitalPeriod(inner, star)!, orbitalPeriod(outer, star)!)).toEqual([2, 1]);
  });

  it('Escape velocity: a fast launch satisfies the check', () => {
    const step = lesson('escape').steps[1];
    const ok = runStep(lesson('escape').steps[0].setup!, 4, step.check!, (sim) => {
      sim.addBody({ name: 'Rock', mass: 1e-9, x: 1, vz: -10 });
    });
    expect(ok).toBe(true);
  });

  it('Roche: the moon is torn apart', () => {
    const step = lesson('roche').steps[0];
    expect(runStep(step.setup!, 3, step.check!)).toBe(true);
  });

  it('Gravity assist: the probe is flung beyond 7 AU', () => {
    const step = lesson('assist').steps[0];
    expect(runStep(step.setup!, 20, step.check!)).toBe(true);
  }, 30000);

  it('Habitable zone: an Earth at 1 AU passes; a 2 M☉ star passes the last task', () => {
    const steps = lesson('habitable').steps;
    const sim = new Simulation();
    steps[0].setup!(sim);
    expect(steps[1].check!(ctx(sim))).toBe(false);
    addOrbiting(sim, sim.bodies[0], { name: 'Home', mass: EARTH_MASS, kind: 'rocky' }, { a: 1 });
    expect(steps[1].check!(ctx(sim))).toBe(true);
    sim.setBodyMass(sim.bodies[0], 2);
    expect(steps[2].check!(ctx(sim))).toBe(true);
  });

  it('Relativity: the inspiral step completes with a merger', () => {
    const step = lesson('relativity').steps[1];
    expect(runStep(step.setup!, 80, step.check!)).toBe(true);
  }, 60000);
});
