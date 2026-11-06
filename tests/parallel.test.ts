import { describe, expect, it } from 'vitest';
import { sliceFor } from '../src/sim/parallel';
import { BODY_FIELDS, particleAccelSlice } from '../src/sim/particleKernel';
import { ParticleSet } from '../src/sim/particles';
import { Simulation } from '../src/sim/simulation';

describe('multi-core particle forces', () => {
  it('splits the particles into slices that cover each one exactly once', () => {
    for (const [total, count] of [[1, 10], [4, 4000], [9, 3991], [16, 5]]) {
      const seen = new Uint8Array(count);
      for (let id = 0; id < total; id++) {
        const [a, b] = sliceFor(id, total, count);
        for (let i = a; i < b; i++) seen[i]++;
      }
      expect(seen.every((v) => v === 1)).toBe(true);
    }
  });

  it('gives exactly the same accelerations whether run as one slice or many', () => {
    const n = 25, count = 3000;
    const bodies = new Float64Array(n * BODY_FIELDS);
    for (let j = 0; j < n; j++) bodies.set([Math.sin(j) * 5, Math.cos(j * 1.3) * 5, j * 0.01, 1e-3 * (j + 1), j % 3 ? 0.05 : -1], j * BODY_FIELDS);
    const make = () => {
      const p = new ParticleSet(count, true);
      for (let i = 0; i < count; i++) p.add(Math.sin(i * 0.37) * 8, Math.cos(i * 0.11) * 8, Math.sin(i) * 0.3, 0, 0, 0, [1, 1, 1]);
      return p;
    };
    const params = { g: 4 * Math.PI ** 2, eps2: 1e-8, cull2: 100 };
    const whole = make();
    particleAccelSlice(whole.pos, whole.acc, whole.dead, bodies, n, params, 0, count);
    const split = make();
    for (let id = 0; id < 7; id++) particleAccelSlice(split.pos, split.acc, split.dead, bodies, n, params, ...sliceFor(id, 7, count));
    expect(Array.from(split.acc.subarray(0, count * 3))).toEqual(Array.from(whole.acc.subarray(0, count * 3)));
    expect(Array.from(split.dead.subarray(0, count))).toEqual(Array.from(whole.dead.subarray(0, count)));
    expect(whole.dead.subarray(0, count).some((d) => d === 1)).toBe(true); // some are swallowed or culled
  });

  it('keeps the simulation single-threaded where memory cannot be shared', async () => {
    const { ParallelForces } = await import('../src/sim/parallel');
    const sim = new Simulation(100, { sharedParticles: true });
    // Node isn't a cross-origin-isolated page, so no helper threads are made.
    expect(ParallelForces.create(sim.particles, 8)).toBeUndefined();
  });
});
