import { describe, expect, it } from 'vitest';
import { sliceFor } from '../src/sim/parallel';
import { BODY_FIELDS, particleAccelSlice } from '../src/sim/particleKernel';
import { ParticleSet } from '../src/sim/particles';
import { Simulation } from '../src/sim/simulation';
import { Octree } from '../src/sim/octree';
import { NODE_FIELDS, TREE_BODY_FIELDS, treeSlice } from '../src/sim/treeKernel';
import type { Body } from '../src/sim/body';

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

  it('walks a packed Barnes–Hut tree to exactly the same forces as the octree itself, in any slices', () => {
    const n = 1500, count = 2000;
    const bodies = Array.from({ length: n }, (_, j) => ({ x: Math.sin(j * 0.7) * 20 + Math.cos(j) * 3, y: Math.cos(j * 1.3) * 20, z: Math.sin(j * 0.11) * 4, mass: 1e-3 * (1 + (j % 7)), radius: j % 5 ? 0.02 : 0.3 }) as Body);
    const tree = new Octree();
    tree.build(bodies);
    const g = 4 * Math.PI ** 2, eps2 = 1e-6, cull2 = 900;
    const params = { g, eps2, theta2: tree.theta * tree.theta, cull2, absorb: true };
    const pos = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) pos.set([Math.sin(i * 0.37) * 25, Math.cos(i * 0.11) * 25, Math.sin(i) * 2], i * 3);
    // Serial: the octree's own walk, as computeForcesTree does it.
    const out = new Float64Array(3);
    const serialBody = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      tree.accel(bodies[i].x, bodies[i].y, bodies[i].z, i, g, eps2, out);
      serialBody.set(out, i * 3);
    }
    const serialAcc = new Float64Array(count * 3);
    const serialDead = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const [px, py, pz] = pos.subarray(i * 3, i * 3 + 3);
      if (px * px + py * py + pz * pz > cull2) {
        serialDead[i] = 1;
        continue;
      }
      tree.accel(px, py, pz, -1, g, eps2, out, true);
      if (Number.isNaN(out[0])) serialDead[i] = 1;
      else serialAcc.set(out, i * 3);
    }
    // Packed, in 6 slices.
    const nodes = new Float64Array(tree.nodeCount * NODE_FIELDS);
    const tb = new Float64Array(n * TREE_BODY_FIELDS);
    expect(tree.pack(nodes, tb)).toBe(true);
    const bodyAcc = new Float64Array(n * 3), acc = new Float64Array(count * 3), dead = new Uint8Array(count);
    let stack: Int32Array = new Int32Array(8);
    for (let id = 0; id < 6; id++) stack = treeSlice(nodes, tb, n, bodyAcc, pos, acc, dead, params, ...sliceFor(id, 6, n + count), stack);
    expect(Array.from(bodyAcc)).toEqual(Array.from(serialBody));
    expect(Array.from(dead)).toEqual(Array.from(serialDead));
    for (let i = 0; i < count; i++) if (!dead[i]) expect([acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]]).toEqual([serialAcc[i * 3], serialAcc[i * 3 + 1], serialAcc[i * 3 + 2]]);
    expect(serialDead.some((d) => d === 1)).toBe(true);
    // Too small a buffer: refuses rather than overflowing.
    expect(tree.pack(new Float64Array(10), tb)).toBe(false);
  });
});
