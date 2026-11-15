/**
 * Light around a non-spinning black hole (headless). A photon's path in Schwarzschild spacetime
 * lies in a plane and obeys, with u = 1/r in units of M = GM/c²,
 *
 *     d²u/dφ² = 3u² − u,
 *
 * the Newtonian straight line plus the general-relativistic 3u² term. The renderer integrates
 * the same equation in the lens shader to draw the accretion disc as it is really seen: the far
 * side bent up and over the shadow, the underside showing beneath it. This module is the
 * reference the shader is checked against: it uses the same step and the same initial
 * conditions.
 *
 * Checks (tests/geodesic.test.ts): the weak-field deflection 4M/b, capture inside the critical
 * impact parameter √27 M, and a ray aimed above an edge-on disc that lands on its far side.
 */

export const CRITICAL_IMPACT = Math.sqrt(27);

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const length = (a: Vec3) => Math.sqrt(dot(a, a));
const normalize = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));

/** Step in φ (radians) used by the integrator and the shader. */
export const PHI_STEP = 0.03;
export const MAX_STEPS = 260;

/**
 * Impact parameter b = L/E of a ray leaving a static observer at radius r0 at angle `theta` to
 * the radial direction: b = r0 sin θ / √(1 − 2/r0).
 */
export function impactParameter(r0: number, theta: number): number {
  return (r0 * Math.sin(theta)) / Math.sqrt(Math.max(1 - 2 / r0, 1e-3));
}

/** One leapfrog step of u'' = 3u² − u. */
function step(u: number, up: number, h: number): [number, number] {
  const a0 = 3 * u * u - u;
  const uHalf = up + 0.5 * h * a0;
  const u1 = u + h * uHalf;
  const a1 = 3 * u1 * u1 - u1;
  const up1 = uHalf + 0.5 * h * a1;
  return [u1, up1];
}

/**
 * A photon coming in from far away (r0 ≫ M) with impact parameter b: whether the hole captures
 * it, and otherwise its total deflection (radians) and closest approach (M).
 */
export function tracePhoton(b: number, r0 = 1e4): { captured: boolean; deflection: number; rMin: number } {
  const u0 = 1 / r0;
  let u = u0;
  let up = Math.sqrt(Math.max(1 / (b * b) - u * u * (1 - 2 * u), 0));
  let phi = 0;
  let rMin = r0;
  for (let i = 0; i < 20000; i++) {
    const uPrev = u;
    [u, up] = step(u, up, PHI_STEP);
    phi += PHI_STEP;
    if (u >= 0.5) return { captured: true, deflection: Infinity, rMin: 2 };
    if (u > 0) rMin = Math.min(rMin, 1 / u);
    if (u <= u0 && up < 0) {
      // Back out to where it started, outgoing: interpolate the exact crossing of u = u0.
      phi -= PHI_STEP * ((u0 - u) / (uPrev - u));
      break;
    }
  }
  // A straight line from r0 with impact parameter b would sweep π − 2 asin(b/r0): the rest is the bending.
  return { captured: false, deflection: phi - (Math.PI - 2 * Math.asin(Math.min(1, b / r0))), rMin };
}

export interface DiscHit {
  /** Radius (M) and azimuth (radians, from `m1` about the normal) of the point seen, and the point itself relative to the hole. */
  r: number;
  phi: number;
  point: Vec3;
  /** Doppler × gravitational factor g for gas on a circular orbit there (prograde about the normal). */
  g: number;
  /** Where the photon was going when it left the disc (unit, towards the camera). */
  dir: Vec3;
}

/**
 * Trace a ray backwards from the camera (at the origin; positions in M, the hole at `hole`) in
 * direction `dir`, and report the first crossing of the disc plane (normal `n` through the hole)
 * between radii rIn and rOut, or 'captured' when the ray falls into the hole first, or
 * undefined when it escapes. `m1` is the azimuth reference in the disc plane.
 */
export function traceDisc(hole: Vec3, dir: Vec3, n: Vec3, m1: Vec3, rIn: number, rOut: number): DiscHit | 'captured' | undefined {
  const d = normalize(dir);
  const r0 = length(hole);
  const e1 = scale(hole, -1 / r0); // from the hole towards the camera
  const cosTheta = -dot(d, e1); // angle between the ray and the direction to the hole
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const b = impactParameter(r0, Math.asin(Math.min(1, sinTheta)));
  // The photon never comes closer to the hole than b: a ray aimed wide of the disc cannot hit it.
  if (b > rOut) return undefined;
  if (sinTheta < 1e-6) return 'captured';
  const e2 = normalize(sub(d, scale(e1, dot(d, e1)))); // the ray's sideways direction: the orbital plane is (e1, e2)
  const n1 = dot(n, e1), n2 = dot(n, e2);
  let u = 1 / r0;
  // Inward rays (towards the hole) have u growing with φ; outward ones shrinking.
  let up = (dot(d, e1) < 0 ? 1 : -1) * Math.sqrt(Math.max(1 / (b * b) - u * u * (1 - 2 * u), 0));
  let phi = 0;
  let hPrev = r0 * n1;
  let rPrev = r0, phiPrev = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    [u, up] = step(u, up, PHI_STEP);
    phi += PHI_STEP;
    if (u >= 0.5) return 'captured';
    if (u <= 0 || (up < 0 && u < 1 / (3 * r0) && u < 1 / (2 * rOut))) return undefined; // escaped
    const r = 1 / u;
    const h = r * (Math.cos(phi) * n1 + Math.sin(phi) * n2);
    if (h * hPrev < 0) {
      const t = hPrev / (hPrev - h);
      const rc = rPrev + (r - rPrev) * t;
      const phic = phiPrev + (phi - phiPrev) * t;
      if (rc >= rIn && rc <= rOut) {
        // The point seen, in world space relative to the hole.
        const P = add(scale(e1, rc * Math.cos(phic)), scale(e2, rc * Math.sin(phic)));
        const m2 = cross(n, m1);
        const az = Math.atan2(dot(P, m2), dot(P, m1));
        // The path's tangent (increasing φ) at the crossing; the photon travelled the other way.
        const drdphi = -up / (u * u);
        const T = add(scale(e1, drdphi * Math.cos(phic) - rc * Math.sin(phic)), scale(e2, drdphi * Math.sin(phic) + rc * Math.cos(phic)));
        const k = normalize(scale(T, -1));
        // Gas on a circular orbit, prograde about the normal: β = 1/√r (M units).
        const v = normalize(cross(n, P));
        const beta = Math.min(0.95, 1 / Math.sqrt(rc));
        const D = Math.sqrt(1 - beta * beta) / (1 - beta * dot(v, k));
        const g = D * Math.sqrt(Math.max(0.05, 1 - 3 / rc));
        return { r: rc, phi: az, point: P, g, dir: k };
      }
    }
    hPrev = h;
    rPrev = r;
    phiPrev = phi;
  }
  return undefined;
}
