import { BODY_FIELDS, particleAccelSlice, type KernelParams } from './particleKernel';
import type { ParticleSet } from './particles';

/**
 * Multi-core particle forces. The physics worker splits the particle–body force loop between
 * itself and `threads` helper workers (src/sim/forceWorker.ts). Particle positions,
 * accelerations and the bodies live in SharedArrayBuffers, and the threads synchronise with
 * Atomics, so no data is copied per step.
 *
 * Needs a cross-origin-isolated page (COOP + COEP headers), which the desktop app serves;
 * elsewhere `ParallelForces.create` returns undefined and the simulation stays single-threaded.
 */

/** Control words in the shared Int32Array. */
export const CTRL = { GENERATION: 0, DONE: 1, READY: 2, COUNT: 3, BODIES: 4, THREADS: 5 } as const;
/** Bodies the shared body buffer holds; scenes with more use the octree, not this path. */
export const MAX_SHARED_BODIES = 4096;
/** Below this many particle–body interactions per force pass, threads cost more than they save. */
export const MIN_PARALLEL_WORK = 40000;

export interface ForceWorkerInit {
  id: number;
  ctrl: SharedArrayBuffer;
  params: SharedArrayBuffer;
  pos: SharedArrayBuffer;
  acc: SharedArrayBuffer;
  dead: SharedArrayBuffer;
  bodies: SharedArrayBuffer;
}

/** The particles [start, end) that worker `id` of `total` handles (the physics worker is id 0). */
export function sliceFor(id: number, total: number, count: number): [number, number] {
  return [Math.floor((count * id) / total), Math.floor((count * (id + 1)) / total)];
}

export class ParallelForces {
  private readonly ctrl: Int32Array;
  private readonly params: Float64Array;
  private readonly bodies: Float64Array;
  private readonly workers: Worker[] = [];

  private constructor(
    private readonly particles: ParticleSet,
    readonly threads: number,
  ) {
    this.ctrl = new Int32Array(new SharedArrayBuffer(8 * 4));
    this.params = new Float64Array(new SharedArrayBuffer(4 * 8));
    this.bodies = new Float64Array(new SharedArrayBuffer(MAX_SHARED_BODIES * BODY_FIELDS * 8));
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

  dispose(): void {
    for (const w of this.workers) w.terminate();
  }
}
