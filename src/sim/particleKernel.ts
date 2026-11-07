/**
 * The test-particle force loop, factored out so several threads can each run a slice of it
 * (src/sim/parallel.ts) while the single-threaded path runs the whole range. Every thread runs
 * exactly this code, so the parallel result is identical to the serial one.
 */

/** Doubles per packed body: x, y, z, mass, swallow radius (negative: particles pass through). */
export const BODY_FIELDS = 5;

export interface KernelParams {
  /** Gravitational constant times the scene's gravity scale, softening², and the cull distance². */
  g: number;
  eps2: number;
  cull2: number;
}

/**
 * Accelerations on particles [start, end) from `nBodies` packed bodies. Writes `acc` (3 per
 * particle) and sets `dead[i]` to 1 for particles beyond the cull distance or inside a body,
 * 0 otherwise.
 */
export function particleAccelSlice(
  pos: Float64Array,
  acc: Float64Array,
  dead: Uint8Array,
  bodies: Float64Array,
  nBodies: number,
  { g, eps2, cull2 }: KernelParams,
  start: number,
  end: number,
): void {
  for (let i = start; i < end; i++) {
    const k = i * 3;
    const px = pos[k];
    const py = pos[k + 1];
    const pz = pos[k + 2];
    let ax = 0;
    let ay = 0;
    let az = 0;
    let gone = px * px + py * py + pz * pz > cull2;
    for (let j = 0; j < nBodies && !gone; j++) {
      const o = j * BODY_FIELDS;
      const dx = bodies[o] - px;
      const dy = bodies[o + 1] - py;
      const dz = bodies[o + 2] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const swallow = bodies[o + 4];
      if (swallow > 0 && d2 < swallow * swallow) {
        gone = true;
        break;
      }
      const r2 = d2 + eps2;
      const f = (g * bodies[o + 3]) / (r2 * Math.sqrt(r2));
      ax += dx * f;
      ay += dy * f;
      az += dz * f;
    }
    dead[i] = gone ? 1 : 0;
    acc[k] = ax;
    acc[k + 1] = ay;
    acc[k + 2] = az;
  }
}
