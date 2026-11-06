/// <reference lib="webworker" />
import { encodeFrame, frameTransferables, type ToWorker } from './protocol';
import { PARTICLE_CAPACITY, Simulation } from './simulation';
import { restoreState } from './state';

const sim = new Simulation(PARTICLE_CAPACITY);
let version = 0;
let lastIds = '';

function idSignature(): string {
  // Cheap fingerprint of the body set and names; names change on fragments/merges only via add/remove.
  let s = `${sim.bodies.length}:`;
  for (const b of sim.bodies) s += `${b.id},`;
  return s;
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'state':
      version = msg.version;
      restoreState(sim, msg.state);
      lastIds = '';
      break;
    case 'settings':
      Object.assign(sim, msg.patch);
      sim.invalidate();
      break;
    case 'advance': {
      const result = msg.version === version ? sim.advance(msg.simTime, 20000, msg.budgetMs) : { steps: 0, lagging: false };
      const ids = idSignature();
      const frame = encodeFrame(sim, version, result, ids !== lastIds);
      lastIds = ids;
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(frame, frameTransferables(frame));
      break;
    }
  }
};
