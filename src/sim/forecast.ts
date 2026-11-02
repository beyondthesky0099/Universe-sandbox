import type { Body } from './body';
import { Simulation } from './simulation';

export interface Approach {
  otherId: number;
  otherName: string;
  /** Closest distance between surfaces' centres (AU). */
  distance: number;
  /** Years from now. */
  time: number;
  /** True if the bodies' radii overlap at closest approach: a collision. */
  impact: boolean;
  /** Positions of both bodies at that moment. */
  self: [number, number, number];
  other: [number, number, number];
}

export interface Forecast {
  /** Closest approach to any body other than the one being orbited. */
  closest?: Approach;
  /** First predicted collision (with anything, including the parent). */
  impact?: Approach;
  horizon: number;
}

/**
 * Integrate a copy of the most influential bodies forward to find upcoming close approaches
 * and collisions for `bodyId`. The live simulation is not touched.
 */
export function forecast(sim: Simulation, bodyId: number, horizon: number, maxBodies = 40, maxSteps = 20000): Forecast {
  const target = sim.getBody(bodyId);
  if (!target) return { horizon };
  const parent = sim.parentOf(target);

  const ranked = sim.bodies
    .filter((b) => b !== target)
    .map((b) => ({ b, pull: b.mass / Math.max(1e-12, (b.x - target.x) ** 2 + (b.y - target.y) ** 2 + (b.z - target.z) ** 2) }))
    .sort((p, q) => q.pull - p.pull)
    .slice(0, maxBodies)
    .map((r) => r.b);

  const ghost = new Simulation(0);
  ghost.gravityScale = sim.gravityScale;
  ghost.collisions = false;
  ghost.tidal = false;
  ghost.eta = 0.03;
  ghost.dtMax = sim.dtMax;
  ghost.softening = sim.softening;
  const copies = new Map<Body, Body>();
  const self = ghost.addBody({ ...target, id: undefined });
  for (const b of ranked) copies.set(ghost.addBody({ ...b, id: undefined }), b);

  const best = new Map<Body, Approach>();
  let impact: Approach | undefined;
  let steps = 0;
  // Relative state of each body at the previous sample, to find minima between samples.
  const prevRel = new Map<Body, { p: [number, number, number]; v: [number, number, number]; t: number }>();
  const SUB = 16;
  const sample = (time: number) => {
    for (const [copy, original] of copies) {
      const p1: [number, number, number] = [copy.x - self.x, copy.y - self.y, copy.z - self.z];
      const v1: [number, number, number] = [copy.vx - self.vx, copy.vy - self.vy, copy.vz - self.vz];
      // Closest point on a cubic Hermite curve through the last two samples (relative motion).
      let d = Math.hypot(...p1);
      let rel = p1;
      let back = 0; // how far before `time` the minimum falls (years)
      const prev = prevRel.get(copy);
      if (prev) {
        const h = time - prev.t;
        for (let j = 1; j < SUB; j++) {
          const u = j / SUB;
          const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
          const q = [0, 1, 2].map((c) => h00 * prev.p[c] + h10 * h * prev.v[c] + h01 * p1[c] + h11 * h * v1[c]) as [number, number, number];
          const dq = Math.hypot(q[0], q[1], q[2]);
          if (dq < d) {
            d = dq;
            rel = q;
            back = (1 - u) * h;
          }
        }
      }
      prevRel.set(copy, { p: p1, v: v1, t: time });
      const best0 = best.get(copy);
      if (!best0 || d < best0.distance) {
        // Positions at that moment: the body stepped back along its velocity, the other offset from it.
        const at: [number, number, number] = [self.x - self.vx * back, self.y - self.vy * back, self.z - self.vz * back];
        const a: Approach = {
          otherId: original.id,
          otherName: original.name,
          distance: d,
          time: time - back,
          impact: d < copy.radius + self.radius,
          self: at,
          other: [at[0] + rel[0], at[1] + rel[1], at[2] + rel[2]],
        };
        best.set(copy, a);
        if (a.impact && (!impact || a.time < impact.time)) impact = a;
      }
    }
  };

  sample(0);
  const slices = 1500;
  const slice = horizon / slices;
  for (let i = 1; i <= slices && !impact && steps < maxSteps; i++) {
    steps += ghost.advance(slice, Math.max(1, maxSteps - steps), 1e9).steps;
    sample(i * slice);
  }

  let closest: Approach | undefined;
  for (const [copy, a] of best) {
    if (parent && copies.get(copy) === parent) continue;
    if (!closest || a.distance < closest.distance) closest = a;
  }
  return { closest, impact, horizon };
}
