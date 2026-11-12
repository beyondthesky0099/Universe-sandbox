/// <reference lib="webworker" />
import { CTRL, sliceFor, type ForceWorkerInit } from './parallel';
import { particleAccelSlice } from './particleKernel';
import { treeSlice } from './treeKernel';

/**
 * A helper thread for multi-core particle forces (see src/sim/parallel.ts). After its one setup
 * message it blocks on the shared generation counter, computes its slice of particles whenever
 * the counter moves, and reports back through the shared "done" counter.
 */
self.onmessage = (e: MessageEvent<ForceWorkerInit>) => {
  const { id } = e.data;
  const ctrl = new Int32Array(e.data.ctrl);
  const params = new Float64Array(e.data.params);
  const pos = new Float64Array(e.data.pos);
  const acc = new Float64Array(e.data.acc);
  const dead = new Uint8Array(e.data.dead);
  const bodies = new Float64Array(e.data.bodies);
  const treeNodes = new Float64Array(e.data.treeNodes);
  const treeBodies = new Float64Array(e.data.treeBodies);
  const bodyAcc = new Float64Array(e.data.bodyAcc);
  let stack: Int32Array = new Int32Array(256);
  let generation = Atomics.load(ctrl, CTRL.GENERATION);
  Atomics.add(ctrl, CTRL.READY, 1);
  for (;;) {
    Atomics.wait(ctrl, CTRL.GENERATION, generation);
    generation = Atomics.load(ctrl, CTRL.GENERATION);
    const count = Atomics.load(ctrl, CTRL.COUNT);
    const total = Atomics.load(ctrl, CTRL.THREADS) + 1;
    const [start, end] = sliceFor(id, total, count);
    const mode = Atomics.load(ctrl, CTRL.MODE);
    if (mode === 0) {
      particleAccelSlice(pos, acc, dead, bodies, Atomics.load(ctrl, CTRL.BODIES), { g: params[0], eps2: params[1], cull2: params[2] }, start, end);
    } else {
      const p = { g: params[0], eps2: params[1], cull2: params[2], theta2: params[3], absorb: mode === 2 };
      stack = treeSlice(treeNodes, treeBodies, Atomics.load(ctrl, CTRL.BODIES), bodyAcc, pos, acc, dead, p, start, end, stack);
    }
    Atomics.add(ctrl, CTRL.DONE, 1);
    Atomics.notify(ctrl, CTRL.DONE);
  }
};
