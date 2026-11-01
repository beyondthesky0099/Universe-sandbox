import { gmst } from './sky';

/**
 * Solar eclipses from real data (scripts/build-eclipses.mjs): JPL Horizons apparent positions of
 * the Sun and Moon every few minutes, from which this module traces the Moon's shadow across the
 * Earth (WGS-84 ellipsoid) and works out local circumstances. NASA's catalogue values ride along
 * so tests can check the geometry against them.
 */
export interface Eclipse {
  id: string;
  date: string;
  type: 'total' | 'annular' | 'hybrid';
  greatestTD: string;
  greatestJdTD: number;
  /** NASA's ΔT (s) and its values for greatest eclipse. */
  deltaT: number;
  saros: number;
  gamma: number;
  magnitude: number;
  lat: number;
  lon: number;
  sunAlt: number;
  widthKm: number | null;
  durationSec: number;
  /** TT − UT that Horizons used (s). */
  horizonsDeltaT: number | null;
  startJdTT: number;
  stepMin: number;
  /** [RA (deg), Dec (deg), distance (AU)], apparent geocentric of date, at TT sample times. */
  sun: [number, number, number][];
  moon: [number, number, number][];
}

type V3 = [number, number, number];

const DEG = Math.PI / 180;
const AU_KM = 149597870.7;
export const EARTH_A = 6378.137;
const FLAT = 1 / 298.257223563;
const E2 = FLAT * (2 - FLAT);
const SUN_R = 696000;
/** Lunar radius in Earth radii: NASA's smaller value for umbral contacts (allows for limb valleys) and the mean one for the penumbra. */
const K_UMBRA = 0.272281;
const K_PENUMBRA = 0.2725076;
const DEFAULT_DELTA_T = 69;

let promise: Promise<Eclipse[]> | undefined;
export function loadEclipses(baseUrl = import.meta.env.BASE_URL): Promise<Eclipse[]> {
  promise ??= fetch(`${baseUrl}data/eclipses.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load eclipse data (${r.status})`);
      return r.json() as Promise<{ eclipses: Eclipse[] }>;
    })
    .then((d) => d.eclipses);
  return promise;
}

export function deltaT(e: Eclipse): number {
  return e.horizonsDeltaT ?? DEFAULT_DELTA_T;
}

/** The time span the data covers, as TT Julian dates. */
export function span(e: Eclipse): [number, number] {
  return [e.startJdTT, e.startJdTT + ((e.sun.length - 1) * e.stepMin) / 1440];
}

/** Four-point Lagrange interpolation of a sampled track (RA unwrapped across 0/360°). */
function interpolate(rows: [number, number, number][], e: Eclipse, jdTT: number): [number, number, number] {
  const u = (jdTT - e.startJdTT) / (e.stepMin / 1440);
  const i0 = Math.max(0, Math.min(rows.length - 4, Math.floor(u) - 1));
  const x = u - i0;
  const out: [number, number, number] = [0, 0, 0];
  const ra0 = rows[i0][0];
  for (let k = 0; k < 4; k++) {
    let w = 1;
    for (let j = 0; j < 4; j++) if (j !== k) w *= (x - j) / (k - j);
    const r = rows[i0 + k];
    let ra = r[0];
    if (ra - ra0 > 180) ra -= 360;
    else if (ra0 - ra > 180) ra += 360;
    out[0] += w * ra;
    out[1] += w * r[1];
    out[2] += w * r[2];
  }
  return out;
}

/** Earth-fixed position (km) from RA/Dec of date, distance and Greenwich sidereal time (deg). */
function earthFixed([ra, dec, au]: [number, number, number], gst: number): V3 {
  const r = au * AU_KM;
  const lon = (ra - gst) * DEG;
  return [r * Math.cos(dec * DEG) * Math.cos(lon), r * Math.cos(dec * DEG) * Math.sin(lon), r * Math.sin(dec * DEG)];
}

/** Sun and Moon in Earth-fixed coordinates (km) at a TT Julian date. */
export function bodiesAt(e: Eclipse, jdTT: number): { sun: V3; moon: V3 } {
  const gst = gmst(jdTT - deltaT(e) / 86400);
  return { sun: earthFixed(interpolate(e.sun, e, jdTT), gst), moon: earthFixed(interpolate(e.moon, e, jdTT), gst) };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a: V3): V3 => scale(a, 1 / len(a));

/** Where the line p + t·d first meets the WGS-84 ellipsoid (t > 0), or undefined. */
function hitEarth(p: V3, d: V3): V3 | undefined {
  const k = 1 / (1 - FLAT); // stretch z so the ellipsoid becomes a sphere of radius a
  const ps: V3 = [p[0], p[1], p[2] * k], ds: V3 = [d[0], d[1], d[2] * k];
  const A = dot(ds, ds), B = 2 * dot(ps, ds), C = dot(ps, ps) - EARTH_A * EARTH_A;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return undefined;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  if (t < 0) return undefined;
  return add(p, scale(d, t));
}

/** Geodetic latitude and longitude (degrees) of a point on the ellipsoid. */
export function toGeodetic([x, y, z]: V3): { lat: number; lon: number } {
  return { lat: Math.atan2(z, (1 - E2) * Math.hypot(x, y)) / DEG, lon: Math.atan2(y, x) / DEG };
}

/** Earth-fixed position (km) of a place at sea level. */
export function fromGeodetic(lat: number, lon: number): V3 {
  const phi = lat * DEG, lam = lon * DEG;
  const N = EARTH_A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  return [N * Math.cos(phi) * Math.cos(lam), N * Math.cos(phi) * Math.sin(lam), N * (1 - E2) * Math.sin(phi)];
}

export interface Shadow {
  /** Distance of the shadow axis from the Earth's centre in equatorial radii, signed (+ north). */
  gamma: number;
  /** Where the axis meets the Earth, if it does. */
  centre?: { lat: number; lon: number };
  /** Umbra (positive, total) or antumbra (negative, annular) radius and penumbra radius at the surface (km). */
  umbraKm: number;
  penumbraKm: number;
  /** Path edges across the track at this moment, when the axis is on the Earth. */
  limits?: [{ lat: number; lon: number }, { lat: number; lon: number }];
}

/** The Moon's shadow on the Earth at a TT Julian date. */
export function shadowAt(e: Eclipse, jdTT: number): Shadow {
  const { sun, moon } = bodiesAt(e, jdTT);
  const axis = norm(sub(moon, sun));
  const D = len(sub(moon, sun));
  const perp = sub(moon, scale(axis, dot(moon, axis)));
  const gamma = (len(perp) / EARTH_A) * Math.sign(perp[2] || 1);
  const rU = K_UMBRA * EARTH_A;
  const rP = K_PENUMBRA * EARTH_A;
  const f2 = Math.asin((SUN_R - rU) / D);
  const f1 = Math.asin((SUN_R + rP) / D);
  const hit = hitEarth(moon, axis);
  // Distance from the Moon along the axis to the surface (or to the fundamental plane).
  const x = hit ? len(sub(hit, moon)) : dot(scale(moon, -1), axis);
  const umbraKm = rU / Math.cos(f2) - x * Math.tan(f2);
  const penumbraKm = rP / Math.cos(f1) + x * Math.tan(f1);
  const s: Shadow = { gamma, umbraKm, penumbraKm };
  if (!hit) return s;
  s.centre = toGeodetic(hit);
  // Offset the axis sideways by the umbral radius, across the shadow's motion.
  const later = bodiesAt(e, jdTT + 1 / 1440);
  const axis2 = norm(sub(later.moon, later.sun));
  const hit2 = hitEarth(later.moon, axis2);
  if (hit2) {
    const motion = sub(hit2, hit);
    const along = norm(sub(motion, scale(axis, dot(motion, axis)))); // shadow motion, in the fundamental plane
    const side = norm([along[1] * axis[2] - along[2] * axis[1], along[2] * axis[0] - along[0] * axis[2], along[0] * axis[1] - along[1] * axis[0]]);
    const r = Math.abs(umbraKm);
    const a = hitEarth(add(moon, scale(side, r)), axis);
    const b = hitEarth(add(moon, scale(side, -r)), axis);
    if (a && b) s.limits = [toGeodetic(a), toGeodetic(b)];
  }
  return s;
}

/** Instant of greatest eclipse: when the shadow axis passes closest to the Earth's centre. */
export function greatestEclipse(e: Eclipse): { jdTT: number; shadow: Shadow } {
  const [t0, t1] = span(e);
  let a = t0, b = t1;
  // Golden-section search on |gamma| (unimodal over an eclipse).
  const g = (t: number) => Math.abs(shadowAt(e, t).gamma);
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = b - phi * (b - a), d = a + phi * (b - a);
  for (let i = 0; i < 80; i++) {
    if (g(c) < g(d)) b = d;
    else a = c;
    c = b - phi * (b - a);
    d = a + phi * (b - a);
  }
  const jdTT = (a + b) / 2;
  return { jdTT, shadow: shadowAt(e, jdTT) };
}

/** Great-circle distance (km, mean radius) between two places. */
export function groundKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const p1 = a.lat * DEG, p2 = b.lat * DEG, dl = (b.lon - a.lon) * DEG;
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.acos(Math.max(-1, Math.min(1, c))) * 6371.0;
}

export interface LocalView {
  /** Angular radii (deg) of the Sun and Moon, their separation (deg), and the fraction of the Sun's disc covered. */
  sunRadius: number;
  moonRadius: number;
  separation: number;
  obscuration: number;
  /** Altitude of the Sun (deg), and the Moon's offset from the Sun as seen from here. */
  sunAlt: number;
}

/** How the eclipse looks from a place at a TT Julian date. */
export function localView(e: Eclipse, jdTT: number, lat: number, lon: number): LocalView {
  const { sun, moon } = bodiesAt(e, jdTT);
  const o = fromGeodetic(lat, lon);
  const s = sub(sun, o), m = sub(moon, o);
  const sunRadius = Math.asin(SUN_R / len(s)) / DEG;
  const moonRadius = Math.asin((K_UMBRA * EARTH_A) / len(m)) / DEG;
  const separation = Math.acos(Math.max(-1, Math.min(1, dot(s, m) / (len(s) * len(m))))) / DEG;
  const up: V3 = norm([o[0], o[1], o[2] / (1 - E2)]); // ellipsoid normal
  const sunAlt = Math.asin(dot(norm(s), up)) / DEG;
  return { sunRadius, moonRadius, separation, obscuration: discOverlap(sunRadius, moonRadius, separation), sunAlt };
}

/** Fraction of a disc of radius r1 covered by a disc of radius r2 whose centre is d away. */
export function discOverlap(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r2 - r1)) return r2 >= r1 ? 1 : (r2 * r2) / (r1 * r1);
  const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const k = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return (a1 + a2 - k) / (Math.PI * r1 * r1);
}

export interface LocalCircumstances {
  /** Time of maximum (TT JD), the largest fraction covered, and how long the Sun is fully covered or ringed (s). */
  maxJdTT: number;
  obscuration: number;
  centralSec: number;
  central: 'total' | 'annular' | 'none';
  /** First and last contact (TT JD), when the Moon touches the Sun's disc. */
  start?: number;
  end?: number;
}

/** The eclipse as seen from one place: maximum, duration of totality (or annularity), contacts. */
export function localCircumstances(e: Eclipse, lat: number, lon: number): LocalCircumstances {
  const [t0, t1] = span(e);
  const step = 1 / 1440;
  let best = { t: t0, sep: Infinity };
  for (let t = t0; t <= t1; t += step) {
    const v = localView(e, t, lat, lon);
    if (v.separation < best.sep) best = { t, sep: v.separation };
  }
  // Refine the maximum to about a second.
  let a = Math.max(t0, best.t - step), b = Math.min(t1, best.t + step);
  for (let i = 0; i < 40; i++) {
    const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
    if (localView(e, m1, lat, lon).separation < localView(e, m2, lat, lon).separation) b = m2;
    else a = m1;
  }
  const maxJdTT = (a + b) / 2;
  const at = localView(e, maxJdTT, lat, lon);
  const centralGap = (v: LocalView) => Math.abs(v.moonRadius - v.sunRadius) - v.separation;
  const touching = (v: LocalView) => v.sunRadius + v.moonRadius - v.separation;
  /** Bisect for the time a condition f(t) > 0 stops holding, going from `inside` toward `outside`. */
  const edge = (f: (t: number) => number, inside: number, outside: number) => {
    let i = inside, o = outside;
    for (let k = 0; k < 50; k++) {
      const m = (i + o) / 2;
      if (f(m) > 0) i = m;
      else o = m;
    }
    return (i + o) / 2;
  };
  let centralSec = 0;
  let central: LocalCircumstances['central'] = 'none';
  if (centralGap(at) > 0) {
    central = at.moonRadius > at.sunRadius ? 'total' : 'annular';
    const f = (t: number) => centralGap(localView(e, t, lat, lon));
    centralSec = (edge(f, maxJdTT, maxJdTT + 0.01) - edge(f, maxJdTT, maxJdTT - 0.01)) * 86400;
  }
  const out: LocalCircumstances = { maxJdTT, obscuration: at.obscuration, centralSec, central };
  if (touching(at) > 0) {
    const f = (t: number) => touching(localView(e, t, lat, lon));
    out.start = edge(f, maxJdTT, t0);
    out.end = edge(f, maxJdTT, t1);
  }
  return out;
}

/** The central line and path edges, sampled each minute while the shadow axis is on the Earth. */
export function eclipsePath(e: Eclipse, stepMin = 1): { jdTT: number; centre: { lat: number; lon: number }; limits?: Shadow['limits'] }[] {
  const [t0, t1] = span(e);
  const out: ReturnType<typeof eclipsePath> = [];
  for (let t = t0; t <= t1; t += stepMin / 1440) {
    const s = shadowAt(e, t);
    if (s.centre) out.push({ jdTT: t, centre: s.centre, limits: s.limits });
  }
  return out;
}

/** Topocentric altitude/azimuth (deg) and angular radius (deg) of the Sun and Moon from a place. */
export function topocentric(e: Eclipse, jdTT: number, lat: number, lon: number): { sun: { alt: number; az: number; radius: number; km: number }; moon: { alt: number; az: number; radius: number; km: number } } {
  const { sun, moon } = bodiesAt(e, jdTT);
  const o = fromGeodetic(lat, lon);
  const phi = lat * DEG, lam = lon * DEG;
  const east: V3 = [-Math.sin(lam), Math.cos(lam), 0];
  const north: V3 = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)];
  const up: V3 = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  const view = (p: V3, r: number) => {
    const v = sub(p, o);
    const d = len(v);
    const n = scale(v, 1 / d);
    return {
      alt: Math.asin(dot(n, up)) / DEG,
      az: ((Math.atan2(dot(n, east), dot(n, north)) / DEG) + 360) % 360,
      radius: Math.asin(r / d) / DEG,
      km: d,
    };
  };
  return { sun: view(sun, SUN_R), moon: view(moon, K_PENUMBRA * EARTH_A) };
}

/** TT Julian date ↔ JavaScript Date (UTC) for an eclipse's ΔT. */
export function jdTTToDate(e: Eclipse, jdTT: number): Date {
  return new Date((jdTT - deltaT(e) / 86400 - 2440587.5) * 86400000);
}
export function dateToJdTT(e: Eclipse, date: Date): number {
  return date.getTime() / 86400000 + 2440587.5 + deltaT(e) / 86400;
}
