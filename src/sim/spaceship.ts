/**
 * Flying a spacecraft: engines, fuel, and an autopilot that puts the ship into orbit.
 *
 * Engines are real ones (a chemical upper stage, the Dawn probe's ion drive) and one hypothetical
 * (a fusion torch). The ship is a test body like the probes: gravity from everything moves it,
 * thrust adds a steady acceleration and uses up its Δv budget (fuel).
 *
 * The autopilot runs inside the physics step, so it can steer an orbit that lasts minutes of
 * simulated time even when the screen shows days per second. Far from the target it flies a
 * brachistochrone-like profile (accelerate, then brake so it arrives at rest relative to the
 * target); close in, it steers towards the local circular orbit (velocity √(GM/r) along the
 * orbit) and the chosen radius, then lets the ship coast.
 */
import type { Body } from './body';

/** m/s² → AU/yr². */
export const MS2_TO_AU_YR2 = (3.15576e7 * 3.15576e7) / 1.495978707e11;
/** km/s → AU/yr. */
export const KMS_TO_AU_YR = 1 / 4.740470463;
export const G0 = 9.80665;

export interface Engine {
  id: string;
  label: string;
  /** Full-throttle acceleration (m/s²) and the Δv it can give in total (km/s; Infinity = no limit). */
  accel: number;
  deltaV: number;
  hypothetical?: boolean;
}

export const ENGINES: Engine[] = [
  { id: 'chemical', label: 'Chemical rocket (1 g, 10 km/s of Δv)', accel: G0, deltaV: 10 },
  { id: 'ion', label: 'Ion drive like Dawn (0.08 mm/s², 11 km/s)', accel: 7.5e-5, deltaV: 11 },
  { id: 'torch', label: 'Fusion torch (1 g, no fuel limit, hypothetical)', accel: G0, deltaV: Infinity, hypothetical: true },
];

export interface Autopilot {
  target: number;
  /** Orbit radius to settle into (AU, from the target's centre). */
  radius: number;
  /** Most acceleration the engine can give (AU/yr²). */
  maxAccel: number;
}

/** Thrust (AU/yr²) the autopilot wants, and whether the ship has settled into the orbit. */
export function autopilotAccel(ship: Body, target: Body, ap: Autopilot, G: number): { accel: [number, number, number]; settled: boolean } {
  const rx = ship.x - target.x, ry = ship.y - target.y, rz = ship.z - target.z;
  const vx = ship.vx - target.vx, vy = ship.vy - target.vy, vz = ship.vz - target.vz;
  const r = Math.hypot(rx, ry, rz) || 1e-12;
  const mu = G * target.mass;
  const vCirc = Math.sqrt(mu / r);
  let dvx: number, dvy: number, dvz: number;
  let tau: number;
  // How far the ship's velocity is from a circular orbit at its current radius.
  let offCircular = Infinity;
  if (r > ap.radius * 6) {
    // Approach: head for the target at the speed from which full braking stops at the orbit.
    const s = Math.sqrt(2 * ap.maxAccel * 0.7 * (r - ap.radius));
    dvx = (-rx / r) * s - vx;
    dvy = (-ry / r) * s - vy;
    dvz = (-rz / r) * s - vz;
    tau = Math.max(1e-9, s / ap.maxAccel / 50);
  } else {
    // Insertion: the circular velocity in the current orbital plane, plus a radial correction.
    let nx = ry * vz - rz * vy, ny = rz * vx - rx * vz, nz = rx * vy - ry * vx;
    let nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-12 * r * (Math.hypot(vx, vy, vz) + 1e-12)) {
      // No angular momentum yet: orbit in the scene's horizontal plane.
      [nx, ny, nz] = [0, 1, 0];
      nl = 1;
    }
    nx /= nl;
    ny /= nl;
    nz /= nl;
    // Tangential direction t = n × r̂ (prograde).
    const tx = (ny * rz - nz * ry) / r, ty = (nz * rx - nx * rz) / r, tz = (nx * ry - ny * rx) / r;
    offCircular = Math.hypot(tx * vCirc - vx, ty * vCirc - vy, tz * vCirc - vz);
    const period = 2 * Math.PI * Math.sqrt(ap.radius ** 3 / mu);
    const radial = ((ap.radius - r) / (period / 8)) * 0.5;
    dvx = tx * vCirc + (rx / r) * radial - vx;
    dvy = ty * vCirc + (ry / r) * radial - vy;
    dvz = tz * vCirc + (rz / r) * radial - vz;
    tau = period / 40;
  }
  // Done once the orbit is nearly circular and near the chosen radius.
  const settled = r < ap.radius * 1.2 && r > ap.radius * 0.8 && offCircular < 0.03 * vCirc;
  let ax = dvx / tau, ay = dvy / tau, az = dvz / tau;
  const a = Math.hypot(ax, ay, az);
  if (a > ap.maxAccel) {
    ax *= ap.maxAccel / a;
    ay *= ap.maxAccel / a;
    az *= ap.maxAccel / a;
  }
  return { accel: [ax, ay, az], settled };
}

/** Orbit around `parent`: periapsis and apoapsis distances (AU; apoapsis Infinity if unbound), period (yr). */
export function orbitAround(ship: Body, parent: Body, G: number): { periapsis: number; apoapsis: number; period?: number; speed: number; distance: number } {
  const rx = ship.x - parent.x, ry = ship.y - parent.y, rz = ship.z - parent.z;
  const vx = ship.vx - parent.vx, vy = ship.vy - parent.vy, vz = ship.vz - parent.vz;
  const r = Math.hypot(rx, ry, rz);
  const v2 = vx * vx + vy * vy + vz * vz;
  const mu = G * parent.mass;
  const energy = v2 / 2 - mu / r;
  const hx = ry * vz - rz * vy, hy = rz * vx - rx * vz, hz = rx * vy - ry * vx;
  const h2 = hx * hx + hy * hy + hz * hz;
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h2) / (mu * mu)));
  if (energy >= 0) return { periapsis: h2 / mu / (1 + e), apoapsis: Infinity, speed: Math.sqrt(v2), distance: r };
  const a = -mu / (2 * energy);
  return { periapsis: a * (1 - e), apoapsis: a * (1 + e), period: 2 * Math.PI * Math.sqrt((a * a * a) / mu), speed: Math.sqrt(v2), distance: r };
}
