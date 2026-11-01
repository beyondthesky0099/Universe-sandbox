import { G } from './units';

/**
 * Real Solar System data bundled from NASA/JPL (see scripts/build-solar-system.mjs and
 * scripts/build-small-bodies.mjs): osculating orbital elements at an epoch, propagated to any
 * date with two-body Kepler motion, plus physical properties.
 *
 * All vectors returned here are in the J2000 ecliptic frame (x, y, z), in AU and AU/yr.
 * Use `toScene` to convert to scene coordinates (x, z, −y).
 */

export type SolarKind = 'planet' | 'dwarf' | 'asteroid' | 'comet' | 'moon';

export interface Elements {
  epochJd: number;
  /** Semi-major axis (AU). */
  a: number;
  e: number;
  /** Inclination, ascending node, argument of periapsis, mean anomaly: degrees. */
  i: number;
  node: number;
  peri: number;
  M: number;
  /**
   * Mean-anomaly rate (deg/day). For osculating elements this is Horizons' value computed with
   * the centre body's GM only.
   */
  n: number;
  /**
   * Moons carry fitted *mean* elements instead (see scripts/build-solar-system.mjs): `n` is the
   * observed mean motion, and the node and longitude of periapsis advance at these rates.
   */
  mean?: boolean;
  nodeRate?: number;
  /** Rate of the longitude of periapsis (node + argument of periapsis), deg/day. */
  periRate?: number;
}

export interface SolarBodyData {
  name: string;
  kind: SolarKind;
  /** Name of the parent body ('Sun' for heliocentric orbits). */
  parent: string;
  /** Mass in solar masses. */
  mass?: number;
  /** True when the mass is estimated from size and an assumed density. */
  massEstimated?: boolean;
  note?: string;
  radiusKm?: number;
  rotationHours?: number;
  synchronous?: boolean;
  obliquityDeg?: number;
  albedo?: number;
  /** North pole (RA, Dec in degrees, ICRF J2000) from the IAU WGCCRE (Archinal et al. 2018). */
  pole?: { ra: number; dec: number };
  /** Spins clockwise about its north pole (Venus, Uranus, Pluto). */
  retrograde?: boolean;
  /** Elements are relative to the parent system's barycentre (Nix and Hydra around Pluto–Charon). */
  barycentric?: boolean;
  elements: Elements;
}

export interface SmallBody {
  name: string;
  /** a (AU), e, i, node, peri, M (degrees), epoch JD. */
  el: [number, number, number, number, number, number, number];
  cls: string;
}

export interface SolarData {
  epoch: string;
  bodies: SolarBodyData[];
  byName: Map<string, SolarBodyData>;
  small: SmallBody[];
  /** Saturn's main rings (NASA ring fact sheet), if loaded. */
  rings?: SaturnRing[];
}

export interface SaturnRing {
  name: string;
  /** Radii from Saturn's centre, km. */
  inner: number;
  outer: number;
  /** Typical normal optical depth (midpoint of the published range). */
  tau?: number;
  albedo?: number;
}

export const KM_PER_AU = 149597870.7;
const DEG = Math.PI / 180;
const DAYS_PER_YEAR = 365.25;

export type V3 = [number, number, number];

export interface EclipticState {
  pos: V3;
  vel: V3;
}

/** Ecliptic (x, y, z) → scene (x, z, −y). */
export function toScene([x, y, z]: V3): V3 {
  return [x, z, -y];
}

/** Solve Kepler's equation M = E − e sin E (radians), robust up to e ≈ 0.999. */
function eccentricAnomaly(M: number, e: number): number {
  M = ((M % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = e < 0.8 ? M : Math.sign(M || 1) * Math.PI * 0.85;
  for (let k = 0; k < 60; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

/**
 * State from elements. Angles in radians, `mu` in AU³/yr². Elliptic orbits only.
 */
export function stateFromElements(a: number, e: number, i: number, node: number, peri: number, M: number, mu: number): EclipticState {
  const E = eccentricAnomaly(M, e);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e);
  const n = Math.sqrt(mu / (a * a * a));
  const denom = 1 - e * cosE;
  const xp = a * (cosE - e);
  const yp = b * sinE;
  const vxp = (-a * n * sinE) / denom;
  const vyp = (b * n * cosE) / denom;
  const cO = Math.cos(node), sO = Math.sin(node);
  const cw = Math.cos(peri), sw = Math.sin(peri);
  const ci = Math.cos(i), si = Math.sin(i);
  const r11 = cO * cw - sO * sw * ci, r12 = -cO * sw - sO * cw * ci;
  const r21 = sO * cw + cO * sw * ci, r22 = -sO * sw + cO * cw * ci;
  const r31 = sw * si, r32 = cw * si;
  return {
    pos: [r11 * xp + r12 * yp, r21 * xp + r22 * yp, r31 * xp + r32 * yp],
    vel: [r11 * vxp + r12 * vyp, r21 * vxp + r22 * vyp, r31 * vxp + r32 * vyp],
  };
}

/** Classical elements (radians) from a state vector, for bound orbits. */
export function elementsFromState(s: EclipticState, mu: number): { a: number; e: number; i: number; node: number; peri: number; M: number } {
  const [x, y, z] = s.pos;
  const [vx, vy, vz] = s.vel;
  const r = Math.hypot(x, y, z);
  const v2 = vx * vx + vy * vy + vz * vz;
  const hx = y * vz - z * vy, hy = z * vx - x * vz, hz = x * vy - y * vx;
  const h = Math.hypot(hx, hy, hz);
  const a = 1 / (2 / r - v2 / mu);
  const rv = x * vx + y * vy + z * vz;
  // Eccentricity vector
  const ex = ((v2 - mu / r) * x - rv * vx) / mu;
  const ey = ((v2 - mu / r) * y - rv * vy) / mu;
  const ez = ((v2 - mu / r) * z - rv * vz) / mu;
  const e = Math.hypot(ex, ey, ez);
  const i = Math.acos(Math.max(-1, Math.min(1, hz / h)));
  // Node vector n = k × h
  const nx = -hy, ny = hx;
  const nn = Math.hypot(nx, ny);
  let node = nn > 1e-12 ? Math.atan2(ny, nx) : 0;
  if (node < 0) node += 2 * Math.PI;
  let peri: number;
  let nu: number;
  if (e > 1e-10) {
    if (nn > 1e-12) {
      peri = Math.acos(Math.max(-1, Math.min(1, (nx * ex + ny * ey) / (nn * e))));
      if (ez < 0) peri = 2 * Math.PI - peri;
    } else {
      peri = Math.atan2(ey, ex);
    }
    nu = Math.acos(Math.max(-1, Math.min(1, (ex * x + ey * y + ez * z) / (e * r))));
    if (rv < 0) nu = 2 * Math.PI - nu;
  } else {
    // Circular: measure the anomaly from the node.
    peri = 0;
    nu = nn > 1e-12 ? Math.acos(Math.max(-1, Math.min(1, (nx * x + ny * y) / (nn * r)))) : Math.atan2(y, x);
    if (z < 0) nu = 2 * Math.PI - nu;
  }
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  const M = E - e * Math.sin(E);
  return { a, e, i, node, peri, M };
}

/**
 * Position and velocity of a catalogue body relative to its parent (or the parent system's
 * barycentre) on a Julian date. Propagates the epoch state with two-body motion using the
 * combined mass `muTotal` (AU³/yr²), so mutual orbits like Pluto–Charon keep the right period.
 */
export function relativeState(body: SolarBodyData, jd: number, muTotal?: number): EclipticState {
  const el = body.elements;
  if (el.mean) {
    // Mean elements: advance the angles at their observed rates. The speed comes from the
    // two-body `mu` the simulation will use, so the moon starts on a stable orbit.
    const dt = jd - el.epochJd;
    const node = el.node + (el.nodeRate ?? 0) * dt;
    const varpi = el.node + el.peri + (el.periRate ?? 0) * dt;
    const M = el.M + el.n * dt;
    const nYr = el.n * DEG * DAYS_PER_YEAR;
    const mu = muTotal ?? nYr * nYr * el.a ** 3;
    return stateFromElements(el.a, el.e, el.i * DEG, node * DEG, (varpi - node) * DEG, M * DEG, mu);
  }
  const nYr = el.n * DEG * DAYS_PER_YEAR; // rad/yr
  const muCentre = nYr * nYr * el.a ** 3; // the GM Horizons used for these osculating elements
  const epochState = stateFromElements(el.a, el.e, el.i * DEG, el.node * DEG, el.peri * DEG, el.M * DEG, muCentre);
  const mu = muTotal ?? muCentre;
  const k = elementsFromState(epochState, mu);
  const dtYears = (jd - el.epochJd) / DAYS_PER_YEAR;
  const M = k.M + Math.sqrt(mu / k.a ** 3) * dtYears;
  return stateFromElements(k.a, k.e, k.i, k.node, k.peri, M, mu);
}

/** Heliocentric position and velocity of a small body (massless) on a Julian date. */
export function smallBodyState(b: SmallBody, jd: number): EclipticState {
  const [a, e, i, node, peri, M0, epoch] = b.el;
  const mu = G;
  const M = M0 * DEG + Math.sqrt(mu / a ** 3) * ((jd - epoch) / DAYS_PER_YEAR);
  return stateFromElements(a, e, i * DEG, node * DEG, peri * DEG, M, mu);
}

const OBLIQUITY_J2000 = 23.4392911 * DEG;

/** Unit vector of the body's north pole in scene coordinates (ecliptic J2000 → x, z, −y). */
export function poleScene(body: SolarBodyData): V3 | undefined {
  if (!body.pole) return undefined;
  const ra = body.pole.ra * DEG, dec = body.pole.dec * DEG;
  const x = Math.cos(dec) * Math.cos(ra);
  const ye = Math.cos(dec) * Math.sin(ra);
  const ze = Math.sin(dec);
  const c = Math.cos(OBLIQUITY_J2000), s = Math.sin(OBLIQUITY_J2000);
  return toScene([x, c * ye + s * ze, -s * ye + c * ze]);
}

/** Real radius in AU, if known. */
export function realRadiusAu(body: SolarBodyData): number | undefined {
  return body.radiusKm ? body.radiusKm / KM_PER_AU : undefined;
}

// ---------------------------------------------------------------------------
// Loading

interface RawSolar {
  epoch: string;
  bodies: SolarBodyData[];
}

interface RawSmall {
  classes: string[];
  bodies: [string, number, number, number, number, number, number, number, number][];
}

export function parseSolarData(solar: RawSolar, small?: RawSmall, rings?: { rings: SaturnRing[] }): SolarData {
  return {
    rings: rings?.rings,
    epoch: solar.epoch,
    bodies: solar.bodies,
    byName: new Map(solar.bodies.map((b) => [b.name, b])),
    small: (small?.bodies ?? []).map(([name, a, e, i, node, peri, M, epoch, c]) => ({
      name,
      el: [a, e, i, node, peri, M, epoch],
      cls: small!.classes[c] ?? '',
    })),
  };
}

let cached: SolarData | undefined;
let loading: Promise<SolarData> | undefined;

/** The loaded data, if `loadSolarData` has finished. Presets fall back to built-in values without it. */
export function getSolarData(): SolarData | undefined {
  return cached;
}

export function setSolarData(data: SolarData | undefined): void {
  cached = data;
}

/** Fetch the bundled JSON files once. */
export function loadSolarData(baseUrl = import.meta.env.BASE_URL): Promise<SolarData> {
  loading ??= Promise.all([
    fetch(`${baseUrl}data/solar-system.json`).then((r) => {
      if (!r.ok) throw new Error(`Couldn't load Solar System data (${r.status})`);
      return r.json() as Promise<RawSolar>;
    }),
    fetch(`${baseUrl}data/small-bodies.json`)
      .then((r) => (r.ok ? (r.json() as Promise<RawSmall>) : undefined))
      .catch(() => undefined),
    fetch(`${baseUrl}data/saturn-rings.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ rings: SaturnRing[] }>) : undefined))
      .catch(() => undefined),
  ]).then(([solar, small, rings]) => {
    cached = parseSolarData(solar, small, rings);
    return cached;
  });
  return loading;
}

/**
 * Sample ring-particle radii (km): each ring gets particles in proportion to its optical depth
 * times its area, so the dense B ring is crowded and the Cassini Division is sparse.
 */
export function sampleRingRadii(rings: SaturnRing[], count: number, rand: () => number = Math.random): { r: number; ring: SaturnRing }[] {
  const weights = rings.map((g) => Math.max(0.02, g.tau ?? 0.1) * (g.outer * g.outer - g.inner * g.inner));
  const total = weights.reduce((a, b) => a + b, 0);
  const out: { r: number; ring: SaturnRing }[] = [];
  for (let k = 0; k < count; k++) {
    let pick = rand() * total;
    let i = 0;
    while (i < rings.length - 1 && (pick -= weights[i]) > 0) i++;
    const g = rings[i];
    // Uniform per unit area within the ring.
    const r = Math.sqrt(g.inner * g.inner + rand() * (g.outer * g.outer - g.inner * g.inner));
    out.push({ r, ring: g });
  }
  return out;
}

/** Display colours for real bodies (approximate true colour). */
export const REAL_COLORS: Record<string, number> = {
  Moon: 0xa8a39b,
  Phobos: 0x6e6157,
  Deimos: 0x8a7b6c,
  Io: 0xd9c45a,
  Europa: 0xc9b9a0,
  Ganymede: 0x8f8577,
  Callisto: 0x5f5548,
  Amalthea: 0x9c4a32,
  Mimas: 0xb9b5ae,
  Enceladus: 0xf2f4f6,
  Tethys: 0xd8d6d0,
  Dione: 0xc9c6bf,
  Rhea: 0xbcb8af,
  Titan: 0xd99a3c,
  Hyperion: 0xa89a86,
  Iapetus: 0x8c8172,
  Phoebe: 0x4f4a44,
  Miranda: 0xa9a7a3,
  Ariel: 0xb3b0aa,
  Umbriel: 0x6d6a66,
  Titania: 0xa49b90,
  Oberon: 0x8f857b,
  Triton: 0xd7c7bd,
  Nereid: 0x9a948c,
  Proteus: 0x6a6560,
  Pluto: 0xd8b48f,
  Charon: 0x9b938a,
  Nix: 0xc8c4be,
  Hydra: 0xc8c4be,
  Ceres: 0x8b8682,
  Eris: 0xe8e6e2,
  Haumea: 0xdcdad6,
  Makemake: 0xc79a77,
  Vesta: 0xa59d92,
  Pallas: 0x8d8a85,
  Hygiea: 0x5e5a55,
  Apophis: 0x8d8073,
  Bennu: 0x3c3a38,
};
