import type { Body } from './body';
import { G } from './units';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface StateVector {
  pos: Vec3;
  vel: Vec3;
}

export interface OrbitalElements {
  /** Semi-major axis (AU). */
  a: number;
  /** Eccentricity, 0 ≤ e < 1. */
  e?: number;
  /** Inclination (rad). */
  inc?: number;
  /** Longitude of ascending node (rad). */
  lan?: number;
  /** Argument of periapsis (rad). */
  argp?: number;
  /** True anomaly (rad). */
  nu?: number;
}

/**
 * Position/velocity relative to the central body for the given Keplerian elements.
 * The reference plane is the scene's XZ plane with +Y up; prograde orbits have
 * angular momentum along +Y.
 */
export function keplerToState(mu: number, el: OrbitalElements): StateVector {
  const { a, e = 0, inc = 0, lan = 0, argp = 0, nu = 0 } = el;
  const p = a * (1 - e * e);
  const r = p / (1 + e * Math.cos(nu));
  const px = r * Math.cos(nu);
  const py = r * Math.sin(nu);
  const vf = Math.sqrt(mu / p);
  const vx = -vf * Math.sin(nu);
  const vy = vf * (e + Math.cos(nu));

  const cO = Math.cos(lan), sO = Math.sin(lan);
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const ci = Math.cos(inc), si = Math.sin(inc);
  // Perifocal → reference frame rotation R = Rz(Ω)·Rx(i)·Rz(ω)
  const r11 = cO * cw - sO * sw * ci;
  const r12 = -cO * sw - sO * cw * ci;
  const r21 = sO * cw + cO * sw * ci;
  const r22 = -sO * sw + cO * cw * ci;
  const r31 = sw * si;
  const r32 = cw * si;

  const toScene = (x: number, y: number): Vec3 => {
    const ox = r11 * x + r12 * y;
    const oy = r21 * x + r22 * y;
    const oz = r31 * x + r32 * y;
    // Orbital (x, y, z) with z = orbit normal → scene (x, z, -y), a proper rotation.
    return { x: ox, y: oz, z: -oy };
  };

  return { pos: toScene(px, py), vel: toScene(vx, vy) };
}

/** Speed of a circular orbit of radius r around mass m. */
export function circularSpeed(mass: number, r: number, gravityScale = 1): number {
  return Math.sqrt((G * gravityScale * mass) / r);
}

/**
 * Velocity for a prograde circular orbit around `parent` at the given point, projected
 * onto the plane perpendicular to +Y (the "ecliptic"). Includes the parent's velocity.
 */
export function circularOrbitVelocity(parent: Body, x: number, y: number, z: number, gravityScale = 1): Vec3 {
  const dx = x - parent.x;
  const dz = z - parent.z;
  const dy = y - parent.y;
  const r = Math.hypot(dx, dy, dz);
  const rh = Math.hypot(dx, dz);
  if (r === 0 || rh === 0) return { x: parent.vx, y: parent.vy, z: parent.vz };
  const s = circularSpeed(parent.mass, r, gravityScale);
  // ŷ × r̂ gives the prograde tangent.
  return { x: parent.vx + (dz / rh) * s, y: parent.vy, z: parent.vz + (-dx / rh) * s };
}

/** Hill sphere radius of a body of mass m orbiting mass M at distance a. */
export function hillRadius(a: number, m: number, M: number): number {
  return a * Math.cbrt(m / (3 * M));
}
