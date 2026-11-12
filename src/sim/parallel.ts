import { BODY_FIELDS, particleAccelSlice, type KernelParams } from './particleKernel';
import { NODE_FIELDS, TREE_BODY_FIELDS, treeSlice, type TreeParams } from './treeKernel';
import type { Octree } from './octree';
import type { ParticleSet } from './particles';

/**
 * Multi-core forces. The physics worker splits the force loop between itself and `threads`
 * helper workers (src/sim/forceWorker.ts):
 * - direct mode: the particle–body loop;
 * - tree mode (Barnes–Hut, big scenes): bodies and particles walk a packed copy of the octree.
 * Particle positions,
 * accelerations and the bodies live in SharedArrayBuffers, and the threads synchronise with
 * Atomics, so no data is copied per step.
 *
 * Needs a cross-origin-isolated page (COOP + COEP headers), which the desktop app serves;
 * elsewhere `ParallelForces.create` returns undefined and the simulation stays single-threaded.
 */

/** Control words in the shared Int32Array. */
export const CTRL = { GENERATION: 0, DONE: 1, READY: 2, COUNT: 3, BODIES: 4, THREADS: 5, MODE: 6 } as const;
/** Bodies the shared body buffer holds; scenes with more use the octree, not this path. */
export const MAX_SHARED_BODIES = 4096;
/** Below this many particle–body interactions per force pass, threads cost more than they save. */
export const MIN_PARALLEL_WORK = 40000;
/** Tree mode: the most bodies and octree nodes the shared tree holds (about 16 MB). */
export const MAX_TREE_BODIES = 32768;
export const MAX_TREE_NODES = MAX_TREE_BODIES * 4;
/** Tree mode: below this many bodies + particles, threads cost more than they save. */
export const MIN_TREE_WORK = 1000;

export interface ForceWorkerInit {
  id: number;
  ctrl: SharedArrayBuffer;
  params: SharedArrayBuffer;
  pos: SharedArrayBuffer;
  acc: SharedArrayBuffer;
  dead: SharedArrayBuffer;
  bodies: SharedArrayBuffer;
  treeNodes: SharedArrayBuffer;
  treeBodies: SharedArrayBuffer;
  bodyAcc: SharedArrayBuffer;
}

/** The particles [start, end) that worker `id` of `total` handles (the physics worker is id 0). */
export function sliceFor(id: number, total: number, count: number): [number, number] {
  return [Math.floor((count * id) / total), Math.floor((count * (id + 1)) / total)];
}

export class ParallelForces {
  private readonly ctrl: Int32Array;
  private readonly params: Float64Array;
  private readonly bodies: Float64Array;
  private readonly treeNodes: Float64Array;
  private readonly treeBodies: Float64Array;
  /** Tree mode: the bodies' accelerations (3 per body). */
  readonly bodyAcc: Float64Array;
  private stack: Int32Array = new Int32Array(256);
  private readonly workers: Worker[] = [];

  private constructor(
    private readonly particles: ParticleSet,
    readonly threads: number,
  ) {
    this.ctrl = new Int32Array(new SharedArrayBuffer(8 * 4));
    this.params = new Float64Array(new SharedArrayBuffer(4 * 8));
    this.bodies = new Float64Array(new SharedArrayBuffer(MAX_SHARED_BODIES * BODY_FIELDS * 8));
    this.treeNodes = new Float64Array(new SharedArrayBuffer(MAX_TREE_NODES * NODE_FIELDS * 8));
    this.treeBodies = new Float64Array(new SharedArrayBuffer(MAX_TREE_BODIES * TREE_BODY_FIELDS * 8));
    this.bodyAcc = new Float64Array(new SharedArrayBuffer(MAX_TREE_BODIES * 3 * 8));
    Atomics.store(this.ctrl, CTRL.THREADS, threads);
    for (let id = 1; id <= threads; id++) {
      const w = new Worker(new URL('./forceWorker.ts', import.meta.url), { type: 'module' });
      const init: ForceWorkerInit = {
        id,
        ctrl: this.ctrl.buffer as SharedArrayBuffer,
        params: this.params.buffer as SharedArrayBuffer,
        pos: particles.pos.buffer as SharedArrayBuffer,
        acc: particles.acc.buffer as SharedArrayBuffer,
        dead: particles.dead.buffer as SharedArrayBuffer,
        bodies: this.bodies.buffer as SharedArrayBuffer,
        treeNodes: this.treeNodes.buffer as SharedArrayBuffer,
        treeBodies: this.treeBodies.buffer as SharedArrayBuffer,
        bodyAcc: this.bodyAcc.buffer as SharedArrayBuffer,
      };
      w.postMessage(init);
      this.workers.push(w);
    }
  }

  /**
   * Helper threads for the particles' forces, or undefined when this context can't share
   * memory or block on it (not cross-origin isolated, or a single core).
   */
  static create(particles: ParticleSet, cores = navigator.hardwareConcurrency ?? 1): ParallelForces | undefined {
    const g = globalThis as unknown as { crossOriginIsolated?: boolean };
    if (!g.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined' || !(particles.pos.buffer instanceof SharedArrayBuffer)) return undefined;
    // Leave one core for the page that draws the frames.
    const threads = Math.min(15, Math.max(0, cores - 2));
    return threads > 0 ? new ParallelForces(particles, threads) : undefined;
  }

  /** True once every helper thread has started and is waiting for work. */
  get ready(): boolean {
    return Atomics.load(this.ctrl, CTRL.READY) === this.threads;
  }

  /**
   * Compute the particle forces on all threads. Returns false (and does nothing) when it isn't
   * worth it or the helpers aren't ready, so the caller runs the single-threaded loop instead.
   */
  run(pack: Float64Array, nBodies: number, params: KernelParams, count: number): boolean {
    if (!this.ready || nBodies > MAX_SHARED_BODIES || count * Math.max(1, nBodies) < MIN_PARALLEL_WORK) return false;
    this.bodies.set(pack.subarray(0, nBodies * BODY_FIELDS));
    this.params[0] = params.g;
    this.params[1] = params.eps2;
    this.params[2] = params.cull2;
    Atomics.store(this.ctrl, CTRL.MODE, 0);
    Atomics.store(this.ctrl, CTRL.COUNT, count);
    Atomics.store(this.ctrl, CTRL.BODIES, nBodies);
    Atomics.store(this.ctrl, CTRL.DONE, 0);
    // Wake the helpers.
    Atomics.add(this.ctrl, CTRL.GENERATION, 1);
    Atomics.notify(this.ctrl, CTRL.GENERATION);
    // Do our own share meanwhile.
    const total = this.threads + 1;
    const [start, end] = sliceFor(0, total, count);
    particleAccelSlice(this.particles.pos, this.particles.acc, this.particles.dead, this.bodies, nBodies, params, start, end);
    // Wait for the others.
    for (;;) {
      const done = Atomics.load(this.ctrl, CTRL.DONE);
      if (done >= this.threads) break;
      Atomics.wait(this.ctrl, CTRL.DONE, done, 100);
    }
    return true;
  }

  /**
   * Barnes–Hut forces on all threads: every body's acceleration (into `bodyAcc`) and every
   * particle's (into the particles' `acc`, with `dead` marking culled or swallowed ones). Returns
   * false (doing nothing) when not worth it, the tree is too big, or the helpers aren't ready.
   */
  runTree(tree: Octree, nBodies: number, params: TreeParams, count: number): boolean {
    if (!this.ready || nBodies > MAX_TREE_BODIES || tree.nodeCount > MAX_TREE_NODES || nBodies + count < MIN_TREE_WORK) return false;
    if (!tree.pack(this.treeNodes, this.treeBodies)) return false;
    this.params[0] = params.g;
    this.params[1] = params.eps2;
    this.params[2] = params.cull2;
    this.params[3] = params.theta2;
    Atomics.store(this.ctrl, CTRL.MODE, params.absorb ? 2 : 1);
    Atomics.store(this.ctrl, CTRL.COUNT, nBodies + count);
    Atomics.store(this.ctrl, CTRL.BODIES, nBodies);
    Atomics.store(this.ctrl, CTRL.DONE, 0);
    Atomics.add(this.ctrl, CTRL.GENERATION, 1);
    Atomics.notify(this.ctrl, CTRL.GENERATION);
    const [start, end] = sliceFor(0, this.threads + 1, nBodies + count);
    this.stack = treeSlice(this.treeNodes, this.treeBodies, nBodies, this.bodyAcc, this.particles.pos, this.particles.acc, this.particles.dead, params, start, end, this.stack);
    for (;;) {
      const done = Atomics.load(this.ctrl, CTRL.DONE);
      if (done >= this.threads) break;
      Atomics.wait(this.ctrl, CTRL.DONE, done, 100);
    }
    return true;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
  }
}
