import type { Body } from './body';
import { G } from './units';

export interface LagrangePoint {
  name: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  x: number;
  y: number;
  z: number;
}

/**
 * Approximate Lagrange points of `secondary` orbiting `primary`, using the instantaneous
 * separation and orbital plane. L1/L2 use the Hill-sphere approximation, L3 the
 * first-order offset, and L4/L5 sit 60° ahead of/behind the secondary.
 */
export function lagrangePoints(primary: Body, secondary: Body): LagrangePoint[] {
  const rx = secondary.x - primary.x, ry = secondary.y - primary.y, rz = secondary.z - primary.z;
  const r = Math.hypot(rx, ry, rz);
  if (r === 0) return [];
  const ux = rx / r, uy = ry / r, uz = rz / r;
  const mu = secondary.mass / (primary.mass + secondary.mass);
  const hill = Math.cbrt(mu / 3);
  // Orbit normal from relative angular momentum.
  const vx = secondary.vx - primary.vx, vy = secondary.vy - primary.vy, vz = secondary.vz - primary.vz;
  let nx = ry * vz - rz * vy, ny = rz * vx - rx * vz, nz = rx * vy - ry * vx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  // Tangent (direction of motion) t = n × u.
  const tx = ny * uz - nz * uy, ty = nz * ux - nx * uz, tz = nx * uy - ny * ux;
  const at = (dist: number, angle = 0) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: primary.x + dist * (c * ux + s * tx), y: primary.y + dist * (c * uy + s * ty), z: primary.z + dist * (c * uz + s * tz) };
  };
  return [
    { name: 'L1', ...at(r * (1 - hill)) },
    { name: 'L2', ...at(r * (1 + hill)) },
    { name: 'L3', ...at(-r * (1 + (5 / 12) * mu)) },
    { name: 'L4', ...at(r, Math.PI / 3) },
    { name: 'L5', ...at(r, -Math.PI / 3) },
  ];
}

/** Orbital period (years) of `body` around `parent` from its current state, or undefined if unbound. */
export function orbitalPeriod(body: Body, parent: Body, gravityScale = 1): number | undefined {
  const mu = G * gravityScale * (parent.mass + body.mass);
  const r = Math.hypot(body.x - parent.x, body.y - parent.y, body.z - parent.z);
  const v2 = (body.vx - parent.vx) ** 2 + (body.vy - parent.vy) ** 2 + (body.vz - parent.vz) ** 2;
  const energy = v2 / 2 - mu / r;
  if (!(mu > 0) || energy >= 0) return undefined;
  const a = -mu / (2 * energy);
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
}

/**
 * If the period ratio is within `tolerance` of a small-integer ratio p:q (p, q ≤ 5), return it.
 * Ratios are expressed with the larger number first (e.g. Neptune:Pluto = 3:2).
 */
export function nearResonance(periodA: number, periodB: number, tolerance = 0.015): [number, number] | undefined {
  const ratio = Math.max(periodA, periodB) / Math.min(periodA, periodB);
  let best: [number, number] | undefined;
  let bestErr = tolerance;
  for (let q = 1; q <= 5; q++) {
    for (let p = q + 1; p <= 5 * q && p <= 9; p++) {
      if (gcd(p, q) !== 1) continue;
      const err = Math.abs(ratio - p / q) / (p / q);
      if (err < bestErr) {
        bestErr = err;
        best = [p, q];
      }
    }
  }
  return best;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Rough tidal-locking test. Moons (orbiting a non-star) are treated as locked; planets lock if
 * they orbit close to their star for their age. Uses the scaling t_lock ∝ a⁶ / M², calibrated so
 * Mercury (0.39 AU, 4.6 Gyr) is borderline and habitable-zone planets of red dwarfs are locked.
 */
export function isTidallyLocked(body: Body, parent: Body, distance: number): boolean {
  if (body.kind !== 'rocky' && body.kind !== 'gas') return false;
  if (parent.kind === 'rocky' || parent.kind === 'gas') return true;
  const ageGyr = Math.max(0.5, (parent.age || 4.6e9) / 1e9);
  const lockTimeGyr = 4.6 * Math.pow(distance / 0.39, 6) / (parent.mass * parent.mass);
  return lockTimeGyr < ageGyr;
}
