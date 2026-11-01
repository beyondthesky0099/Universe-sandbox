import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/sim/presets';
import { applyFrame, encodeFrame } from '../src/sim/protocol';
import { Simulation } from '../src/sim/simulation';
import { captureState, restoreState } from '../src/sim/state';

describe('worker protocol', () => {
  it('mirrors the worker simulation exactly and keeps Body objects stable', () => {
    const worker = new Simulation();
    PRESETS.find((p) => p.id === 'supernova')!.load(worker);
    const mirror = new Simulation();
    restoreState(mirror, captureState(worker));
    const star = mirror.bodies[0];

    let first = true;
    for (let i = 0; i < 30; i++) {
      const r = worker.advance(0.2, 1e6, 1e9);
      applyFrame(mirror, encodeFrame(worker, 1, r, first));
      first = false;
    }
    expect(mirror.bodies.length).toBe(worker.bodies.length);
    expect(mirror.bodies[0]).toBe(star); // same object, updated in place
    expect(star.kind).toBe('blackhole'); // the supernova happened in the "worker"
    expect(mirror.time).toBeCloseTo(worker.time, 12);
    expect(mirror.particles.count).toBe(worker.particles.count);
    for (let i = 0; i < worker.bodies.length; i++) {
      expect(mirror.bodies[i].x).toBe(worker.bodies[i].x);
      expect(mirror.bodies[i].name).toBe(worker.bodies[i].name);
    }
    expect(mirror.events.some((e) => e.type === 'supernova')).toBe(true);
  });

  it('round-trips shockwaves and fuses through state', () => {
    const sim = new Simulation();
    PRESETS.find((p) => p.id === 'supernova')!.load(sim);
    const copy = new Simulation();
    restoreState(copy, captureState(sim));
    expect([...copy.fuses]).toEqual([...sim.fuses]);
    sim.advance(4.2, 1e6, 1e9);
    expect(sim.shockwaves.length).toBe(1);
    restoreState(copy, captureState(sim));
    expect(copy.shockwaves[0].radius).toBe(sim.shockwaves[0].radius);
  });
});
