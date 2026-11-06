import { applyFrame, type Frame, type ToWorker } from './protocol';
import { PARTICLE_CAPACITY, Simulation, type SimEvent } from './simulation';
import { captureState, type SimSettings } from './state';

export interface HostStatus {
  lagging: boolean;
  usingTree: boolean;
  /** True when physics runs in a Web Worker. */
  threaded: boolean;
}

/**
 * Owns the simulation. With a worker, physics runs off the main thread and `sim` is a
 * mirror updated every frame; the UI may read and mutate the mirror freely but must call
 * `commit()` after mutating so the worker adopts the change. Without a worker, `sim` is
 * the real simulation and `commit()` is a no-op.
 */
export class SimHost {
  readonly sim = new Simulation(PARTICLE_CAPACITY);
  private worker?: Worker;
  private version = 0;
  private busy = false;
  private pending = 0;
  private readonly events: SimEvent[] = [];
  private status: HostStatus = { lagging: false, usingTree: false, threaded: false };

  constructor(useWorker = true) {
    if (!useWorker || typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<Frame>) => this.receive(e.data);
      this.worker.onerror = (err) => {
        console.warn('Physics worker failed; falling back to the main thread.', err);
        this.worker?.terminate();
        this.worker = undefined;
        this.busy = false;
        this.status.threaded = false;
      };
      this.status.threaded = true;
    } catch (err) {
      console.warn('Web Workers unavailable; running physics on the main thread.', err);
      this.worker = undefined;
    }
  }

  get threaded(): boolean {
    return !!this.worker;
  }

  /** Push the mirror's state to the worker after a main-thread mutation. */
  commit(): void {
    this.sim.invalidate();
    if (!this.worker) return;
    this.version++;
    this.post({ type: 'state', version: this.version, state: captureState(this.sim) });
  }

  /** Change simulation settings without resending the whole state. */
  setSettings(patch: Partial<SimSettings>): void {
    Object.assign(this.sim, patch);
    this.sim.invalidate();
    if (this.worker) this.post({ type: 'settings', patch });
  }

  /**
   * Request `simTime` years of simulation. Returns events produced since the last call.
   * With a worker the result arrives asynchronously, so the mirror lags by about a frame.
   */
  advance(simTime: number, budgetMs = 14): SimEvent[] {
    if (!this.worker) {
      const r = this.sim.advance(simTime, 4000, budgetMs);
      this.status.lagging = r.lagging;
      this.status.usingTree = this.sim.isUsingTree;
      this.events.push(...this.sim.events.splice(0));
    } else {
      // Don't let requested time pile up if the worker falls behind.
      this.pending = Math.min(this.pending + simTime, simTime * 4);
      if (!this.busy && this.pending > 0) {
        this.busy = true;
        this.post({ type: 'advance', version: this.version, simTime: this.pending, budgetMs: Math.max(budgetMs, 24) });
        this.pending = 0;
      }
    }
    return this.events.splice(0);
  }

  getStatus(): HostStatus {
    return { ...this.status, threaded: !!this.worker };
  }

  private receive(frame: Frame): void {
    this.busy = false;
    if (frame.version !== this.version) return; // stale: the main thread changed state since
    applyFrame(this.sim, frame);
    this.events.push(...this.sim.events.splice(0));
    this.status.lagging = frame.lagging;
    this.status.usingTree = frame.usingTree;
  }

  private post(msg: ToWorker): void {
    this.worker!.postMessage(msg);
  }
}
