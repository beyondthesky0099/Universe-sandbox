import type { BodyInit } from './body';
import { Simulation } from './simulation';

/**
 * Predict the path of a body that is about to be spawned, by integrating it together
 * with the most influential existing bodies (which are copied, so the live simulation
 * is untouched). Returns a flat [x, y, z, ...] array of sampled positions.
 */
export function predictPath(sim: Simulation, init: BodyInit, maxPoints = 400, influencers = 8): Float32Array {
  const ghost = new Simulation(0);
  ghost.gravityScale = sim.gravityScale;
  ghost.collisions = false;
  ghost.eta = 0.03;
  ghost.dtMax = sim.dtMax;

  const x = init.x ?? 0;
  const y = init.y ?? 0;
  const z = init.z ?? 0;
  const ranked = [...sim.bodies]
    .map((b) => ({ b, pull: b.mass / Math.max(1e-12, (b.x - x) ** 2 + (b.y - y) ** 2 + (b.z - z) ** 2) }))
    .sort((p, q) => q.pull - p.pull)
    .slice(0, influencers);
  for (const { b } of ranked) {
    ghost.addBody({ kind: b.kind, mass: b.mass, radius: b.radius, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz });
  }
  const probe = ghost.addBody({ ...init, mass: Math.min(init.mass, 1e-12) });

  // Choose a horizon: about one orbit if bound to the dominant body, otherwise a fly-by.
  const dom = ranked[0]?.b;
  let horizon = 1;
  if (dom) {
    const g = ghost.effectiveG;
    const r = Math.hypot(x - dom.x, y - dom.y, z - dom.z);
    const v2 = ((init.vx ?? 0) - dom.vx) ** 2 + ((init.vy ?? 0) - dom.vy) ** 2 + ((init.vz ?? 0) - dom.vz) ** 2;
    const mu = g * dom.mass;
    const energy = v2 / 2 - mu / r;
    if (mu > 0 && energy < 0) {
      const a = -mu / (2 * energy);
      horizon = 2 * Math.PI * Math.sqrt((a * a * a) / mu) * 1.02;
    } else {
      horizon = (6 * r) / Math.max(Math.sqrt(v2), 1e-6);
    }
  }
  horizon = Math.min(horizon, 500);

  const out = new Float32Array(maxPoints * 3);
  const slice = horizon / (maxPoints - 1);
  out[0] = probe.x;
  out[1] = probe.y;
  out[2] = probe.z;
  let n = 1;
  for (; n < maxPoints; n++) {
    ghost.advance(slice, 200, 1e9);
    out[n * 3] = probe.x;
    out[n * 3 + 1] = probe.y;
    out[n * 3 + 2] = probe.z;
    // Stop at impact.
    if (ghost.bodies.some((b) => b !== probe && (b.x - probe.x) ** 2 + (b.y - probe.y) ** 2 + (b.z - probe.z) ** 2 < b.radius * b.radius)) {
      n++;
      break;
    }
  }
  return out.subarray(0, n * 3);
}
