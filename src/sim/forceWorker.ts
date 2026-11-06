/// <reference lib="webworker" />
import { CTRL, sliceFor, type ForceWorkerInit } from './parallel';
import { particleAccelSlice } from './particleKernel';

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
  let generation = Atomics.load(ctrl, CTRL.GENERATION);
  Atomics.add(ctrl, CTRL.READY, 1);
  for (;;) {
    Atomics.wait(ctrl, CTRL.GENERATION, generation);
    generation = Atomics.load(ctrl, CTRL.GENERATION);
    const count = Atomics.load(ctrl, CTRL.COUNT);
    const total = Atomics.load(ctrl, CTRL.THREADS) + 1;
    const [start, end] = sliceFor(id, total, count);
    particleAccelSlice(pos, acc, dead, bodies, Atomics.load(ctrl, CTRL.BODIES), { g: params[0], eps2: params[1], cull2: params[2] }, start, end);
    Atomics.add(ctrl, CTRL.DONE, 1);
    Atomics.notify(ctrl, CTRL.DONE);
  }
};
