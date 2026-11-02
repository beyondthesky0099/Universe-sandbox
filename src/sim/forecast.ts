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
  const SUB = 24;
  const q: [number, number, number] = [0, 0, 0];
  const sample = (time: number) => {
    for (const [copy, original] of copies) {
      const px = copy.x - self.x, py = copy.y - self.y, pz = copy.z - self.z;
      const vx = copy.vx - self.vx, vy = copy.vy - self.vy, vz = copy.vz - self.vz;
      let d = Math.hypot(px, py, pz);
      let rx = px, ry = py, rz = pz;
      let back = 0; // how far before `time` the minimum falls (years)
      let prev = prevRel.get(copy);
      // Only when the bodies stopped approaching during this interval can a closer point lie
      // inside it: then search a cubic Hermite curve through the two samples.
      if (prev && prev.p[0] * prev.v[0] + prev.p[1] * prev.v[1] + prev.p[2] * prev.v[2] < 0 && px * vx + py * vy + pz * vz > 0) {
        const h = time - prev.t;
        for (let j = 1; j < SUB; j++) {
          const u = j / SUB;
          const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
          q[0] = h00 * prev.p[0] + h10 * h * prev.v[0] + h01 * px + h11 * h * vx;
          q[1] = h00 * prev.p[1] + h10 * h * prev.v[1] + h01 * py + h11 * h * vy;
          q[2] = h00 * prev.p[2] + h10 * h * prev.v[2] + h01 * pz + h11 * h * vz;
          const dq = Math.hypot(q[0], q[1], q[2]);
          if (dq < d) {
            d = dq;
            rx = q[0]; ry = q[1]; rz = q[2];
            back = (1 - u) * h;
          }
        }
      }
      if (!prev) {
        prev = { p: [0, 0, 0], v: [0, 0, 0], t: 0 };
        prevRel.set(copy, prev);
      }
      prev.p[0] = px; prev.p[1] = py; prev.p[2] = pz;
      prev.v[0] = vx; prev.v[1] = vy; prev.v[2] = vz;
      prev.t = time;
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
          other: [at[0] + rx, at[1] + ry, at[2] + rz],
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
