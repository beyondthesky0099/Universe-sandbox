import { heliocentricEcliptic, julianDate, PLANET_NAMES, type PlanetName } from './ephemeris';

/**
 * The sky from a place on Earth: where the Sun, Moon, planets and stars are (altitude and
 * azimuth) at a given moment. Planets come from JPL's approximate planetary elements, the Moon
 * from the main terms of the ELP-2000/82 lunar theory as given by Meeus (Astronomical
 * Algorithms, 2nd ed., ch. 47), and the Earth's rotation from the IAU 1982 sidereal time.
 * Accuracy is a few arcminutes for the planets and Sun and about 0.1° for the Moon, which is
 * checked against JPL Horizons in tests/sky.test.ts.
 */

const DEG = Math.PI / 180;
const J2000 = 2451545.0;
const AU_KM = 149597870.7;
const EARTH_RADIUS_KM = 6378.14;
/** TT − UT in seconds: about 69 s in the 2020s (IERS). */
const DELTA_T = 69;

export interface Observer {
  /** Geodetic latitude and east longitude in degrees. */
  lat: number;
  lon: number;
}

export interface SkyObject {
  name: string;
  kind: 'sun' | 'moon' | 'planet';
  /** Altitude above the horizon and azimuth from north through east, in degrees. */
  alt: number;
  az: number;
  /** Distance from the observer in km. */
  km: number;
  /** Apparent magnitude estimate (planets), angular diameter in degrees (Sun and Moon). */
  diameter: number;
}

const norm360 = (x: number) => ((x % 360) + 360) % 360;

/** Mean obliquity of the ecliptic of date (degrees). */
export function obliquity(T: number): number {
  return 23.439291 - 0.0130042 * T;
}

/** Greenwich mean sidereal time (degrees) at a Julian date in UT. */
export function gmst(jdUt: number): number {
  const d = jdUt - J2000;
  const T = d / 36525;
  return norm360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000);
}

// Meeus table 47.A: D, M, M', F, Σl (1e-6 °), Σr (1e-3 km). The largest terms.
const MOON_LR: [number, number, number, number, number, number][] = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
];
// Meeus table 47.B: D, M, M', F, Σb (1e-6 °).
const MOON_B: [number, number, number, number, number][] = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
];

/** Geocentric ecliptic longitude and latitude of date (degrees) and distance (km) of the Moon. */
export function moonPosition(jdTT: number): { lon: number; lat: number; km: number } {
  const T = (jdTT - J2000) / 36525;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.29 * T, A3 = 313.45 + 481266.484 * T;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of MOON_LR) {
    const arg = (d * D + m * M + mp * Mp + f * F) * DEG;
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sl += l * e * Math.sin(arg);
    sr += r * e * Math.cos(arg);
  }
  for (const [d, m, mp, f, b] of MOON_B) {
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sb += b * e * Math.sin((d * D + m * M + mp * Mp + f * F) * DEG);
  }
  sl += 3958 * Math.sin(A1 * DEG) + 1962 * Math.sin((Lp - F) * DEG) + 318 * Math.sin(A2 * DEG);
  sb += -2235 * Math.sin(Lp * DEG) + 382 * Math.sin(A3 * DEG) + 175 * Math.sin((A1 - F) * DEG) + 175 * Math.sin((A1 + F) * DEG) + 127 * Math.sin((Lp - Mp) * DEG) - 115 * Math.sin((Lp + Mp) * DEG);
  return { lon: norm360(Lp + sl / 1e6), lat: sb / 1e6, km: 385000.56 + sr / 1000 };
}

/** Precession from the J2000 ecliptic to the ecliptic of date, as a shift in longitude (degrees). */
function precession(T: number): number {
  return 1.396971 * T + 0.0003086 * T * T;
}

type V3 = [number, number, number];

/** Ecliptic J2000 rectangular → ecliptic of date longitude/latitude (degrees). */
function eclipticOfDate([x, y, z]: V3, T: number): { lon: number; lat: number; r: number } {
  const r = Math.hypot(x, y, z);
  return { lon: norm360(Math.atan2(y, x) / DEG + precession(T)), lat: Math.asin(z / r) / DEG, r };
}

/** Geocentric equatorial-of-date unit vector from ecliptic-of-date longitude/latitude. */
function equatorial(lon: number, lat: number, eps: number): V3 {
  const cl = Math.cos(lon * DEG), sl = Math.sin(lon * DEG), cb = Math.cos(lat * DEG), sb = Math.sin(lat * DEG);
  const ce = Math.cos(eps * DEG), se = Math.sin(eps * DEG);
  const x = cb * cl, y = cb * sl, z = sb;
  return [x, y * ce - z * se, y * se + z * ce];
}

/**
 * Topocentric altitude/azimuth of a body at geocentric equatorial position `v` (unit vector) and
 * distance `km` (Infinity for stars), for an observer, given the local sidereal time (degrees).
 */
function horizontal(v: V3, km: number, obs: Observer, lst: number): { alt: number; az: number; km: number } {
  let [x, y, z] = v;
  if (Number.isFinite(km)) {
    // Shift from the Earth's centre to the observer (parallax: up to a degree for the Moon).
    const r = EARTH_RADIUS_KM / km;
    const cphi = Math.cos(obs.lat * DEG);
    x -= r * cphi * Math.cos(lst * DEG);
    y -= r * cphi * Math.sin(lst * DEG);
    z -= r * Math.sin(obs.lat * DEG);
    const n = Math.hypot(x, y, z);
    km *= n;
    x /= n; y /= n; z /= n;
  }
  const ra = Math.atan2(y, x) / DEG;
  const dec = Math.asin(Math.max(-1, Math.min(1, z))) / DEG;
  const H = (lst - ra) * DEG;
  const phi = obs.lat * DEG;
  const d = dec * DEG;
  const alt = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
  const az = Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(phi) - Math.cos(d) * Math.sin(phi) * Math.cos(H));
  return { alt: alt / DEG, az: norm360(az / DEG), km };
}

/** Atmospheric refraction (degrees) for an apparent altitude (Bennett 1982), at standard conditions. */
export function refraction(alt: number): number {
  if (alt < -2) return 0;
  return 1 / 60 / Math.tan((alt + 7.31 / (alt + 4.4)) * DEG);
}

const PLANET_DIAMETER_KM: Record<string, number> = { Mercury: 4879, Venus: 12104, Mars: 6779, Jupiter: 139820, Saturn: 116460, Uranus: 50724, Neptune: 49244 };

export interface SkySnapshot {
  objects: SkyObject[];
  /** Local sidereal time (degrees) and the ecliptic-of-date precession shift, for placing stars. */
  lst: number;
  T: number;
  /** Fraction of the Moon's disc lit (0–1), and the position angle (degrees, from north through east) of its bright limb. */
  moonIllumination: number;
  moonBrightLimb: number;
}

/** Everything in the sky for an observer at a moment (UTC). */
export function skyAt(date: Date, obs: Observer): SkySnapshot {
  const jdUt = julianDate(date);
  const jd = jdUt + DELTA_T / 86400;
  const T = (jd - J2000) / 36525;
  const eps = obliquity(T);
  const lst = norm360(gmst(jdUt) + obs.lon);
  const earth = heliocentricEcliptic('Earth', jd);
  const objects: SkyObject[] = [];

  // Sun: the reverse of the Earth's heliocentric position.
  const sunEcl = eclipticOfDate([-earth[0], -earth[1], -earth[2]], T);
  // Annual aberration shifts the Sun about 20.5″ back along the ecliptic.
  sunEcl.lon -= 20.4898 / 3600 / sunEcl.r;
  const sunEq = equatorial(sunEcl.lon, sunEcl.lat, eps);
  const sun = horizontal(sunEq, sunEcl.r * AU_KM, obs, lst);
  objects.push({ name: 'Sun', kind: 'sun', ...sun, diameter: (2 * Math.atan(696000 / sun.km)) / DEG });

  // Moon.
  const m = moonPosition(jd);
  const moonEq = equatorial(m.lon, m.lat, eps);
  const moon = horizontal(moonEq, m.km, obs, lst);
  objects.push({ name: 'Moon', kind: 'moon', ...moon, diameter: (2 * Math.atan(1737.4 / moon.km)) / DEG });

  // Planets, with one light-time correction.
  for (const name of PLANET_NAMES) {
    if (name === 'Earth') continue;
    let p = heliocentricEcliptic(name as PlanetName, jd);
    let g: V3 = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
    const tau = (Math.hypot(...g) * AU_KM) / 299792.458 / 86400;
    p = heliocentricEcliptic(name as PlanetName, jd - tau);
    g = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
    const ecl = eclipticOfDate(g, T);
    const h = horizontal(equatorial(ecl.lon, ecl.lat, eps), ecl.r * AU_KM, obs, lst);
    objects.push({ name, kind: 'planet', ...h, diameter: (PLANET_DIAMETER_KM[name] / h.km) / DEG });
  }

  // Moon phase from the Sun–Moon elongation, and the bright limb's position angle (Meeus 48.5).
  const cosPsi = sunEq[0] * moonEq[0] + sunEq[1] * moonEq[1] + sunEq[2] * moonEq[2];
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
  const R = sunEcl.r * AU_KM;
  const i = Math.atan2(R * Math.sin(psi), m.km - R * Math.cos(psi));
  const moonIllumination = (1 + Math.cos(i)) / 2;
  const a0 = Math.atan2(sunEq[1], sunEq[0]), d0 = Math.asin(sunEq[2]);
  const a = Math.atan2(moonEq[1], moonEq[0]), d = Math.asin(moonEq[2]);
  const chi = Math.atan2(Math.cos(d0) * Math.sin(a0 - a), Math.sin(d0) * Math.cos(d) - Math.cos(d0) * Math.sin(d) * Math.cos(a0 - a));
  return { objects, lst, T, moonIllumination, moonBrightLimb: norm360(chi / DEG) };
}

/**
 * Altitude/azimuth of a fixed star given as a unit vector in the J2000 ecliptic frame
 * (the bright-star catalogue's format), using a snapshot's sidereal time.
 */
export function starAltAz(v: V3, snap: Pick<SkySnapshot, 'lst' | 'T'>, obs: Observer): { alt: number; az: number } {
  const ecl = eclipticOfDate(v, snap.T);
  const h = horizontal(equatorial(ecl.lon, ecl.lat, obliquity(snap.T)), Infinity, obs, snap.lst);
  return { alt: h.alt, az: h.az };
}

/** The Moon's phase name from its illuminated fraction and whether it is waxing. */
export function moonPhaseName(illumination: number, waxing: boolean): string {
  if (illumination < 0.03) return 'New Moon';
  if (illumination > 0.97) return 'Full Moon';
  if (Math.abs(illumination - 0.5) < 0.05) return waxing ? 'First quarter' : 'Last quarter';
  return `${waxing ? 'Waxing' : 'Waning'} ${illumination < 0.5 ? 'crescent' : 'gibbous'}`;
}

/**
 * Rotation (row-major 3×3) taking J2000 ecliptic unit vectors to the observer's horizon frame in
 * scene axes: x east, y up, z south (−north). One matrix moves every star at once.
 */
export function skyMatrix(snap: Pick<SkySnapshot, 'lst' | 'T'>, obs: Observer): number[] {
  const p = precession(snap.T) * DEG;
  const e = obliquity(snap.T) * DEG;
  const l = -snap.lst * DEG;
  const phi = obs.lat * DEG;
  const mul = (a: number[], b: number[]) =>
    [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
  const rz = (t: number) => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];
  const rx = (t: number) => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
  // Hour-angle frame (x', y', z') → (east, up, −north).
  const toHorizon = [0, 1, 0, Math.cos(phi), 0, Math.sin(phi), Math.sin(phi), 0, -Math.cos(phi)];
  return mul(toHorizon, mul(rz(l), mul(rx(e), rz(p))));
}

/** Scene direction (x east, y up, z south) for an altitude and azimuth in degrees. */
export function altAzToScene(alt: number, az: number): [number, number, number] {
  const a = alt * DEG, z = az * DEG;
  return [Math.cos(a) * Math.sin(z), Math.sin(a), -Math.cos(a) * Math.cos(z)];
}
