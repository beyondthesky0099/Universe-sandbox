/**
 * Interstellar objects: the three bodies seen passing through the Solar System from another
 * star (scripts/build-interstellar.mjs, NASA/JPL Small-Body Database). Their orbits are
 * hyperbolas (e > 1): they fall in once, swing past the Sun and leave for good.
 */
import { G } from './units';
import type { EclipticState } from './solarSystemData';

export interface InterstellarObject {
  name: string;
  designation: string;
  discovered: string;
  by: string;
  note: string;
  /** Heliocentric ecliptic J2000 elements: eccentricity, perihelion distance (AU), angles (degrees), perihelion time (JD). */
  e: number;
  q: number;
  i: number;
  node: number;
  peri: number;
  tpJd: number;
  /** Speed far from the Sun (km/s). */
  vInfKms: number;
}

const DEG = Math.PI / 180;
const DAYS_PER_YEAR = 365.25;

/** Solve the hyperbolic Kepler equation M = e sinh H − H. */
function hyperbolicAnomaly(M: number, e: number): number {
  let H = Math.asinh(M / e);
  for (let k = 0; k < 80; k++) {
    const d = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
    H -= d;
    if (Math.abs(d) < 1e-13 * Math.max(1, Math.abs(H))) break;
  }
  return H;
}

/** Heliocentric ecliptic position (AU) and velocity (AU/yr) on a Julian date (two-body motion about the Sun). */
export function hyperbolicState(o: Pick<InterstellarObject, 'e' | 'q' | 'i' | 'node' | 'peri' | 'tpJd'>, jd: number, mu = G): EclipticState {
  const e = o.e;
  const a = o.q / (e - 1); // |a|
  const n = Math.sqrt(mu / (a * a * a));
  const M = n * ((jd - o.tpJd) / DAYS_PER_YEAR);
  const H = hyperbolicAnomaly(M, e);
  const ch = Math.cosh(H), sh = Math.sinh(H);
  const b = a * Math.sqrt(e * e - 1);
  const xp = a * (e - ch);
  const yp = b * sh;
  const Hdot = n / (e * ch - 1);
  const vxp = -a * sh * Hdot;
  const vyp = b * ch * Hdot;
  const cO = Math.cos(o.node * DEG), sO = Math.sin(o.node * DEG);
  const cw = Math.cos(o.peri * DEG), sw = Math.sin(o.peri * DEG);
  const ci = Math.cos(o.i * DEG), si = Math.sin(o.i * DEG);
  const r11 = cO * cw - sO * sw * ci, r12 = -cO * sw - sO * cw * ci;
  const r21 = sO * cw + cO * sw * ci, r22 = -sO * sw + cO * cw * ci;
  const r31 = sw * si, r32 = cw * si;
  return {
    pos: [r11 * xp + r12 * yp, r21 * xp + r22 * yp, r31 * xp + r32 * yp],
    vel: [r11 * vxp + r12 * vyp, r21 * vxp + r22 * vyp, r31 * vxp + r32 * vyp],
  };
}

/** Within this distance of the Sun (AU, about the heliopause) an interstellar object is drawn in the Solar System. */
export const INTERSTELLAR_SHOW_AU = 130;

/** The date (JD) its perihelion falls on, as a calendar date. */
export function perihelionDate(o: Pick<InterstellarObject, 'tpJd'>): Date {
  return new Date((o.tpJd - 2440587.5) * 86400000);
}
