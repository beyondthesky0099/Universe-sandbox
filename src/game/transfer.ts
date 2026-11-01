import type { Body } from '../sim/body';
import { G } from '../sim/units';

export interface TransferPlan {
  /** Prograde Δv for the departure burn (AU/yr); negative means retrograde. */
  dv1: number;
  /** Δv to circularise on arrival (AU/yr). */
  dv2: number;
  /** Transfer time (years). */
  timeOfFlight: number;
  /** Angle (rad) the target should lead the probe by at departure. */
  phaseNeeded: number;
  /** Current lead angle of the target (rad, 0..2π). */
  phaseNow: number;
  /** Years to wait until the phase is right (given current angular rates). */
  wait: number;
}

function angleInPlane(b: Body, parent: Body): number {
  return Math.atan2(-(b.z - parent.z), b.x - parent.x);
}

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

/**
 * Hohmann transfer from the probe's current distance to the target's distance around a
 * common parent, with phasing advice. Assumes roughly circular, prograde, coplanar orbits.
 */
export function planHohmann(probe: Body, target: Body, parent: Body, gravityScale = 1): TransferPlan {
  const mu = G * gravityScale * parent.mass;
  const r1 = Math.hypot(probe.x - parent.x, probe.y - parent.y, probe.z - parent.z);
  const r2 = Math.hypot(target.x - parent.x, target.y - parent.y, target.z - parent.z);
  const at = (r1 + r2) / 2;
  const v1 = Math.sqrt(mu / r1);
  const v2 = Math.sqrt(mu / r2);
  const dv1 = v1 * (Math.sqrt(r2 / at) - 1);
  const dv2 = v2 * (1 - Math.sqrt(r1 / at));
  const tof = Math.PI * Math.sqrt((at * at * at) / mu);
  const n1 = Math.sqrt(mu / (r1 * r1 * r1));
  const n2 = Math.sqrt(mu / (r2 * r2 * r2));
  const phaseNeeded = wrap(Math.PI - n2 * tof);
  const phaseNow = wrap(angleInPlane(target, parent) - angleInPlane(probe, parent));
  const rel = n2 - n1; // rate of change of the lead angle
  let wait = 0;
  if (Math.abs(rel) > 1e-12) {
    const diff = wrap(phaseNeeded - phaseNow);
    wait = rel > 0 ? diff / rel : (TAU - diff) / -rel;
    if (wait > 0 && Math.abs(diff) < 0.02) wait = 0;
  }
  return { dv1, dv2, timeOfFlight: tof, phaseNeeded, phaseNow, wait };
}

/** Unit prograde (velocity relative to parent) and radial-out directions. */
export function burnDirections(body: Body, parent: Body): { prograde: [number, number, number]; radial: [number, number, number] } {
  const vx = body.vx - parent.vx, vy = body.vy - parent.vy, vz = body.vz - parent.vz;
  const vl = Math.hypot(vx, vy, vz) || 1;
  const rx = body.x - parent.x, ry = body.y - parent.y, rz = body.z - parent.z;
  const rl = Math.hypot(rx, ry, rz) || 1;
  return { prograde: [vx / vl, vy / vl, vz / vl], radial: [rx / rl, ry / rl, rz / rl] };
}
