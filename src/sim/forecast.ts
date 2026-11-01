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
  const sample = (time: number) => {
    for (const [copy, original] of copies) {
      const d = Math.hypot(copy.x - self.x, copy.y - self.y, copy.z - self.z);
      const prev = best.get(copy);
      if (!prev || d < prev.distance) {
        const a: Approach = {
          otherId: original.id,
          otherName: original.name,
          distance: d,
          time,
          impact: d < copy.radius + self.radius,
          self: [self.x, self.y, self.z],
          other: [copy.x, copy.y, copy.z],
        };
        best.set(copy, a);
        if (a.impact && (!impact || time < impact.time)) impact = a;
      }
    }
  };

  const slices = 300;
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
