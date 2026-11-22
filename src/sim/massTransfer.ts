/**
 * Mass transfer in close binaries (headless): how a white dwarf, neutron star or black hole is fed
 * by its companion, for the Galaxy Map's novae, cataclysmic variables and X-ray binaries.
 *
 * Geometry is in the binary's corotating frame, in units of the separation a: the accretor at the
 * origin, the donor at (1, 0, 0), the orbit turning about +z. The renderer (render/massTransfer.ts)
 * scales it by the current separation and turns it with the orbit.
 *
 * - Roche-lobe overflow (cataclysmic variables, novae, low-mass X-ray binaries): the donor fills
 *   its Roche lobe (Eggleton 1983) and gas spills through the inner Lagrange point L1. Its path is
 *   ballistic in the corotating frame, bent by the Coriolis force (Lubow & Shu 1975), until it
 *   strikes the rim of the disc (the hot spot). The disc reaches out to its tidal radius, about
 *   0.9 of the accretor's own Roche lobe (Paczyński 1977). Too small a disc to form (AM CVn stars
 *   with a large white dwarf) means the stream hits the star directly.
 * - Polars: the white dwarf's field (tens of MG) stops the stream partway and leads it along the
 *   dipole's field lines onto a spot near a magnetic pole; there is no disc. Intermediate polars
 *   keep a disc with its inner part cleared by the field.
 * - Supergiant high-mass X-ray binaries: the compact object is fed by the supergiant's wind, a
 *   β-law outflow (Castor, Abbott & Klein 1975) that the compact object's gravity bends into an
 *   accretion wake (Bondi–Hoyle–Lyttleton).
 * - Be/X-ray binaries: the Be star throws off a disc of gas in its equator, which the compact
 *   object passes through near periastron.
 *
 * Transfer rates: driven by angular-momentum loss through gravitational waves (Landau & Lifshitz)
 * and, for donors with a radiative core, magnetic braking (Rappaport, Verbunt & Joss 1983, γ = 3),
 * for donors whose radius follows their mass (Ritter 1988). Higher mass ratios transfer on the
 * donor's thermal timescale; giant donors take a typical published rate. Winds use the
 * Bondi–Hoyle capture of a typical supergiant wind (Frank, King & Raine, Accretion Power, §4.6).
 */
import { mulberry32 } from '../procgen/rng';
import type { DwarfNovaCycle, NovaEruption } from './binaryCycles';

export type Vec3 = [number, number, number];
export type FeedMode = 'roche' | 'wind' | 'be';
export type AccretorKind = 'whitedwarf' | 'neutron' | 'blackhole';

export interface TransferParams {
  accretor: string;
  donor: string;
  mode: FeedMode;
  accretorKind: AccretorKind;
  /** Polar (no disc, field-line accretion) or intermediate polar (disc with a cleared middle). */
  magnetic?: 'polar' | 'ip';
  /** Mass ratio donor / accretor, masses (M☉), separation (AU), period (days). */
  q: number;
  m1: number;
  m2: number;
  aAu: number;
  periodDays: number;
  /** The accretor's and donor's radii (units of a). */
  accretorRadius: number;
  donorRadius: number;
  /** Distance from the accretor to L1, and the donor's Roche lobe (volume-equivalent radius), in units of a. */
  l1: number;
  lobe: number;
  /** The donor's Roche-lobe shape when it fills it: distances from its centre to the surface (units of a). */
  donorShape?: RocheShape;
  /** The disc's inner and outer radii (units of a), 0 when there is none. */
  discInner: number;
  discOuter: number;
  /** Circularization radius (units of a). */
  circularization: number;
  /** The stream from L1 (polyline), where it meets the disc or star, and (polars) the field-line path to the pole. */
  stream: Vec3[];
  hotSpot?: Vec3;
  column?: Vec3[];
  /** Wind paths from the donor (supergiants), and the compact object's accretion radius (units of a). */
  wind?: Vec3[][];
  accretionRadius?: number;
  /** Radius of a Be star's decretion disc (units of a, around the donor). */
  beDisc?: number;
  /** Mass transfer (or accretion) rate (M☉ per year), what drives it, and the accretion luminosity (erg/s). */
  rate: number;
  driver: string;
  luminosity: number;
  /** A dwarf nova's outburst cycle, or a nova's eruption (sim/binaryCycles.ts). */
  dwarfNova?: DwarfNovaCycle;
  nova?: NovaEruption;
  /** Inclination to Earth's line of sight (degrees), where known or eclipsing. */
  inclination?: number;
}

// --- Roche geometry -------------------------------------------------------------------------

/** Eggleton (1983): the Roche lobe's volume-equivalent radius over the separation, for mass ratio q = M_this / M_other. */
export function rocheLobeRadius(q: number): number {
  const q3 = Math.cbrt(q);
  return (0.49 * q3 * q3) / (0.6 * q3 * q3 + Math.log(1 + q3));
}

/** Effective potential in the corotating frame (units G(M₁+M₂) = a = Ω = 1), accretor at the origin, donor at x = 1. */
export function rochePotential(q: number, p: Vec3): number {
  const mu = q / (1 + q);
  const r1 = Math.hypot(p[0], p[1], p[2]);
  const r2 = Math.hypot(p[0] - 1, p[1], p[2]);
  return -(1 - mu) / r1 - mu / r2 - 0.5 * ((p[0] - mu) ** 2 + p[1] ** 2);
}

/** Distance from the accretor to the inner Lagrange point L1 (units of a). */
export function l1Distance(q: number): number {
  const mu = q / (1 + q);
  const f = (x: number) => (1 - mu) / (x * x) - mu / ((1 - x) * (1 - x)) - (x - mu);
  let lo = 1e-6, hi = 1 - 1e-6;
  for (let k = 0; k < 100; k++) {
    const m = (lo + hi) / 2;
    if (f(m) > 0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

export interface RocheShape {
  /** Donor centre to L1, to the far side, sideways in the orbital plane, and to the pole (units of a). */
  front: number;
  back: number;
  side: number;
  pole: number;
}

/** The critical Roche surface around the donor, along its four principal directions. */
export function rocheShape(q: number): RocheShape {
  const l1 = l1Distance(q);
  const crit = rochePotential(q, [l1, 0, 0]);
  // March out from the donor's centre to the first crossing of the critical potential (beyond
  // it, past L2, the centrifugal term brings the potential down again), then bisect.
  const along = (dir: Vec3) => {
    const phi = (t: number) => rochePotential(q, [1 + dir[0] * t, dir[1] * t, dir[2] * t]);
    let lo = 1e-4, hi = lo;
    while (hi < 2 && phi(hi) < crit) [lo, hi] = [hi, hi * 1.05];
    for (let k = 0; k < 60; k++) {
      const m = (lo + hi) / 2;
      if (phi(m) < crit) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  return { front: 1 - l1, back: along([1, 0, 0]), side: along([0, 1, 0]), pole: along([0, 0, 1]) };
}

/** The tidal radius that truncates a disc around the accretor: 0.9 of its Roche lobe (units of a). */
export function discTidalRadius(q: number): number {
  return 0.9 * rocheLobeRadius(1 / q);
}

/** Circularization radius of gas from L1 (Frank, King & Raine eq. 4.20), units of a. */
export function circularizationRadius(q: number): number {
  return (1 + q) * Math.pow(0.5 - 0.227 * Math.log10(q), 4);
}

// --- The ballistic stream -------------------------------------------------------------------

/** Acceleration of a test particle in the corotating frame: both stars' gravity, centrifugal and Coriolis. */
function rocheAccel(q: number, p: Vec3, v: Vec3): Vec3 {
  const mu = q / (1 + q);
  const r1 = Math.hypot(p[0], p[1], p[2]);
  const dx2 = p[0] - 1;
  const r2 = Math.hypot(dx2, p[1], p[2]);
  const k1 = (1 - mu) / (r1 * r1 * r1), k2 = mu / (r2 * r2 * r2);
  return [-k1 * p[0] - k2 * dx2 + (p[0] - mu) + 2 * v[1], -k1 * p[1] - k2 * p[1] + p[1] - 2 * v[0], -k1 * p[2] - k2 * p[2]];
}

/**
 * Follow gas from `start` with velocity `vel` (corotating frame, units of a and aΩ) by RK4 until
 * `stop` says so or it has gone too far; returns the path and whether it stopped.
 */
function integrate(q: number, start: Vec3, vel: Vec3, stop: (p: Vec3) => boolean, accel: (p: Vec3, v: Vec3) => Vec3 = (p, v) => rocheAccel(q, p, v), maxSteps = 20000, spacing = 0.006): { path: Vec3[]; stopped: boolean } {
  let p: Vec3 = [...start], v: Vec3 = [...vel];
  const path: Vec3[] = [[...p]];
  let since = 0;
  for (let k = 0; k < maxSteps; k++) {
    if (stop(p)) return { path: [...path, [...p]], stopped: true };
    // Smaller steps close to the accretor, where the gas falls fast.
    const h = Math.min(2e-3, 0.004 * Math.hypot(p[0], p[1], p[2]));
    const add = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
    const a1 = accel(p, v);
    const p2 = add(p, v, h / 2), v2 = add(v, a1, h / 2), a2 = accel(p2, v2);
    const p3 = add(p, v2, h / 2), v3 = add(v, a2, h / 2), a3 = accel(p3, v3);
    const p4 = add(p, v3, h), v4 = add(v, a3, h), a4 = accel(p4, v4);
    const np = add(p, [v[0] + 2 * v2[0] + 2 * v3[0] + v4[0], v[1] + 2 * v2[1] + 2 * v3[1] + v4[1], v[2] + 2 * v2[2] + 2 * v3[2] + v4[2]], h / 6);
    v = add(v, [a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0], a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1], a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2]], h / 6);
    since += Math.hypot(np[0] - p[0], np[1] - p[1], np[2] - p[2]);
    p = np;
    if (since > spacing) {
      path.push([...p]);
      since = 0;
    }
    if (Math.hypot(p[0], p[1], p[2]) > 4) break;
  }
  return { path, stopped: false };
}

/**
 * The stream from L1: gas leaves at about the sound speed (a few per cent of aΩ) and falls
 * towards the accretor until it reaches `untilRadius` (the disc's rim, the star, or where a
 * polar's field takes over).
 */
export function ballisticStream(q: number, untilRadius: number, soundSpeed = 0.02): { path: Vec3[]; end?: Vec3 } {
  const l1 = l1Distance(q);
  const { path, stopped } = integrate(q, [l1 - 1e-3, 0, 0], [-soundSpeed, 0, 0], (p) => Math.hypot(p[0], p[1], p[2]) <= untilRadius);
  return { path, end: stopped ? path[path.length - 1] : undefined };
}

/**
 * A polar's accretion column: from where the field takes the stream, along the dipole field line
 * r = L sin²θ (θ from the magnetic axis) down to the white dwarf's surface near the pole.
 */
export function fieldLinePath(from: Vec3, axis: Vec3, surface: number, steps = 40): Vec3[] {
  const n = Math.hypot(...axis);
  let m: Vec3 = [axis[0] / n, axis[1] / n, axis[2] / n];
  const r0 = Math.hypot(...from);
  // Fall towards the nearer pole.
  if (from[0] * m[0] + from[1] * m[1] + from[2] * m[2] < 0) m = [-m[0], -m[1], -m[2]];
  const cos0 = (from[0] * m[0] + from[1] * m[1] + from[2] * m[2]) / r0;
  const th0 = Math.acos(Math.max(-1, Math.min(1, cos0)));
  const perp: Vec3 = [from[0] - r0 * cos0 * m[0], from[1] - r0 * cos0 * m[1], from[2] - r0 * cos0 * m[2]];
  const pl = Math.hypot(...perp) || 1;
  const e: Vec3 = [perp[0] / pl, perp[1] / pl, perp[2] / pl];
  const L = r0 / Math.sin(th0) ** 2;
  const th1 = Math.asin(Math.min(1, Math.sqrt(surface / L)));
  const out: Vec3[] = [];
  for (let k = 0; k <= steps; k++) {
    const th = th0 + ((th1 - th0) * k) / steps;
    const r = L * Math.sin(th) ** 2;
    out.push([r * (Math.cos(th) * m[0] + Math.sin(th) * e[0]), r * (Math.cos(th) * m[1] + Math.sin(th) * e[1]), r * (Math.cos(th) * m[2] + Math.sin(th) * e[2])]);
  }
  return out;
}

/**
 * Wind paths from a supergiant donor: β = 1 outflow from its surface (radial speed v∞(1 − R/r)),
 * bent by the compact object's gravity and the Coriolis force in the corotating frame. Speeds in
 * units of aΩ. Paths that pass close to the compact object end on it.
 */
export function windPaths(q: number, donorRadius: number, vInf: number, capture = 0.04, count = 48, seed = 1): Vec3[][] {
  const mu = q / (1 + q);
  const rand = mulberry32(seed);
  const accel = (p: Vec3, v: Vec3): Vec3 => {
    const d: Vec3 = [p[0] - 1, p[1], p[2]];
    const rd = Math.hypot(...d);
    const ar = rd > donorRadius ? (vInf * vInf * (1 - donorRadius / rd) * donorRadius) / (rd * rd) : 0;
    const r1 = Math.hypot(p[0], p[1], p[2]);
    const k1 = (1 - mu) / (r1 * r1 * r1);
    return [(ar * d[0]) / rd - k1 * p[0] + 2 * v[1], (ar * d[1]) / rd - k1 * p[1] - 2 * v[0], (ar * d[2]) / rd - k1 * p[2]];
  };
  const paths: Vec3[][] = [];
  // All round the star, mostly near the orbital plane, plus a fan from the side facing the
  // compact object, so that the part it bends and captures shows.
  const fan = Math.round(count / 2);
  for (let k = 0; k < count + fan; k++) {
    const phi = k < count ? (2 * Math.PI * (k + 0.5 * rand())) / count : Math.PI + ((k - count + 0.5) / fan - 0.5) * 1.2;
    const lat = k < count ? (rand() - 0.5) * 0.9 : (rand() - 0.5) * 0.2;
    const dir: Vec3 = [Math.cos(lat) * Math.cos(phi), Math.cos(lat) * Math.sin(phi), Math.sin(lat)];
    const r = donorRadius * 1.02;
    const v0 = vInf * (1 - 1 / 1.02);
    const { path } = integrate(
      q,
      [1 + dir[0] * r, dir[1] * r, dir[2] * r],
      [dir[0] * v0, dir[1] * v0, dir[2] * v0],
      (p) => Math.hypot(p[0], p[1], p[2]) < capture || Math.hypot(p[0] - 1, p[1], p[2]) > 2.6,
      accel,
      8000,
      0.02,
    );
    paths.push(path);
  }
  return paths;
}

// --- Rates ----------------------------------------------------------------------------------

const G_CGS = 6.674e-8;
const C_CGS = 2.998e10;
const MSUN = 1.989e33;
const RSUN = 6.957e10;
const AU_CM = 1.496e13;
const YEAR = 3.156e7;
const L_EDD_PER_MSUN = 1.26e38;

/** Gravitational-wave angular-momentum loss rate, J̇/J (per second, negative). */
export function gwJdotOverJ(m1: number, m2: number, aAu: number): number {
  const M1 = m1 * MSUN, M2 = m2 * MSUN, a = aAu * AU_CM;
  return -(32 / 5) * (G_CGS ** 3 / C_CGS ** 5) * (M1 * M2 * (M1 + M2)) / a ** 4;
}

/** Magnetic braking (Rappaport, Verbunt & Joss 1983, γ = 3), J̇/J per second, for a donor of radius r2 (R☉) in a synchronized orbit. */
export function magneticBrakingJdotOverJ(m1: number, m2: number, aAu: number, r2: number, periodDays: number): number {
  const omega = (2 * Math.PI) / (periodDays * 86400);
  const jdot = -3.8e-30 * m2 * MSUN * RSUN ** 4 * r2 ** 3 * omega ** 3;
  const J = m1 * MSUN * m2 * MSUN * Math.sqrt((G_CGS * aAu * AU_CM) / ((m1 + m2) * MSUN));
  return jdot / J;
}

/**
 * Roche-lobe overflow rate (M☉/yr) and what drives it. A donor whose radius goes as M^ζ stays in
 * contact while −Ṁ₂/M₂ = −(J̇/J) / (ζ/2 + 5/6 − q). Low-mass main-sequence donors: ζ ≈ 0.8, magnetic
 * braking while they keep a radiative core (above 0.35 M☉; fully convective ones below it lose it,
 * which opens the period gap); white-dwarf donors: ζ = −1/3. When the denominator is not positive
 * the donor overflows on its thermal timescale, GM²/(RL).
 */
export function rocheTransferRate(m1: number, m2: number, aAu: number, r2: number, periodDays: number, donor: 'star' | 'giant' | 'whitedwarf'): { rate: number; driver: string } {
  if (donor === 'giant') return { rate: 1e-8, driver: 'the evolved donor swelling as it ages (a typical rate for giant and subgiant donors)' };
  const q = m2 / m1;
  const zeta = donor === 'whitedwarf' ? -1 / 3 : 0.8;
  const denom = zeta / 2 + 5 / 6 - q;
  if (denom <= 0.02) {
    // Thermal timescale: Kelvin–Helmholtz time of the donor.
    const lum = Math.pow(m2, 3.5);
    const tKH = (3.1e7 * m2 * m2) / (r2 * lum);
    return { rate: m2 / tKH, driver: 'the donor, heavier than its companion, overflowing on its thermal timescale' };
  }
  const gw = gwJdotOverJ(m1, m2, aAu);
  const braking = donor === 'star' && m2 > 0.35 && m2 < 1.5;
  const mb = braking ? magneticBrakingJdotOverJ(m1, m2, aAu, r2, periodDays) : 0;
  const rate = (-(gw + mb) / denom) * m2 * YEAR;
  return { rate, driver: braking ? 'magnetic braking of the donor’s wind, with gravitational waves' : 'gravitational waves carrying off the orbit’s angular momentum' };
}

/**
 * Bondi–Hoyle–Lyttleton capture of a wind (FKR §4.6): the compact object sweeps up the gas within
 * R_acc = 2GM/v_rel², so Ṁ = Ṁ_wind R_acc² v_rel / (4 a² v_wind). Speeds in km/s.
 */
export function windCaptureRate(windLoss: number, mx: number, aAu: number, vWind: number, vOrb: number): number {
  const vRel2 = vWind * vWind + vOrb * vOrb;
  const gm = mx * 887.1; // GM☉/AU in km²/s²
  const rAcc = (2 * gm) / vRel2; // AU
  return Math.min(windLoss, (windLoss * rAcc * rAcc * Math.sqrt(vRel2)) / (4 * aAu * aAu * vWind));
}

/** Accretion luminosity (erg/s) at a rate (M☉/yr): GMṀ/R for a white dwarf or neutron star, 0.1 Ṁc² for a black hole; capped at Eddington. */
export function accretionLuminosity(rate: number, mass: number, kind: AccretorKind, radiusAu: number): number {
  const mdot = (rate * MSUN) / YEAR;
  const l = kind === 'blackhole' ? 0.1 * mdot * C_CGS * C_CGS : (G_CGS * mass * MSUN * mdot) / (radiusAu * AU_CM);
  return Math.min(l, L_EDD_PER_MSUN * mass);
}

// --- Putting a system together --------------------------------------------------------------

export interface BinaryInput {
  accretor: string;
  donor: string;
  accretorKind: AccretorKind;
  donorKind: 'star' | 'giant' | 'whitedwarf';
  m1: number;
  m2: number;
  aAu: number;
  periodDays: number;
  eccentricity?: number;
  accretorRadiusAu: number;
  /** The donor's own radius (AU) if it doesn't fill its lobe, or the fraction of the lobe (at periastron) it fills. */
  donorRadiusAu?: number;
  donorFill?: number;
  mode: FeedMode;
  magnetic?: 'polar' | 'ip';
}

/** Typical supergiant wind: 10⁻⁶ M☉/yr at v∞ = 2.6 × the escape speed (Lamers, Snow & Lindholm 1995). */
export const SUPERGIANT_WIND = 1e-6;

/** Everything the scene and renderer need for one binary. */
export function binaryTransfer(b: BinaryInput): TransferParams {
  const q = b.m2 / b.m1;
  const l1 = l1Distance(q);
  const lobe = rocheLobeRadius(q);
  const accR = b.accretorRadiusAu / b.aAu;
  const filling = b.mode === 'roche';
  const peri = 1 - (b.eccentricity ?? 0);
  const donorRadius = filling ? lobe : b.donorFill ? b.donorFill * lobe * peri : Math.min((b.donorRadiusAu ?? lobe * b.aAu) / b.aAu, lobe * peri);
  const circ = circularizationRadius(q);
  const tidal = discTidalRadius(q);
  const base = { accretor: b.accretor, donor: b.donor, mode: b.mode, accretorKind: b.accretorKind, magnetic: b.magnetic, q, m1: b.m1, m2: b.m2, aAu: b.aAu, periodDays: b.periodDays, accretorRadius: accR, donorRadius, l1, lobe, circularization: circ };
  const r2Sun = (donorRadius * b.aAu * AU_CM) / RSUN;

  if (b.mode === 'roche') {
    const { rate, driver } = rocheTransferRate(b.m1, b.m2, b.aAu, r2Sun, b.periodDays, b.donorKind);
    const luminosity = accretionLuminosity(rate, b.m1, b.accretorKind, b.accretorRadiusAu);
    const donorShape = rocheShape(q);
    if (b.magnetic === 'polar') {
      // The field takes the stream about halfway from L1 (illustrative; the threading region varies).
      const thread = 0.5 * l1;
      const { path, end } = ballisticStream(q, thread);
      // The magnetic axis, tilted 25° from the spin (= orbit) axis towards the donor's leading side.
      const tilt = (25 * Math.PI) / 180;
      const column = end ? fieldLinePath(end, [Math.sin(tilt) * 0.5, Math.sin(tilt) * 0.87, Math.cos(tilt)], accR) : [];
      return { ...base, donorShape, discInner: 0, discOuter: 0, stream: path, column, hotSpot: column[column.length - 1], rate, driver, luminosity };
    }
    // A disc forms if the gas circularizes outside the star.
    const hasDisc = circ > accR * 1.5;
    const discOuter = hasDisc ? Math.max(tidal, circ) : 0;
    let discInner = hasDisc ? accR : 0;
    if (b.magnetic === 'ip') discInner = Math.min(0.4 * discOuter, Math.max(accR * 1.5, alfvenRadius(rate, b.m1, b.accretorRadiusAu, 5e6) / b.aAu));
    const { path, end } = ballisticStream(q, hasDisc ? discOuter : accR);
    return { ...base, donorShape, discInner, discOuter, stream: path, hotSpot: end, rate, driver, luminosity };
  }

  // Winds: the donor's escape speed sets v∞.
  const orbitKms = Math.sqrt((887.1 * (b.m1 + b.m2)) / b.aAu);
  const rd = donorRadius * b.aAu;
  const vEsc = Math.sqrt((2 * 887.1 * b.m2) / rd);
  const vInf = 2.6 * vEsc;
  if (b.mode === 'wind') {
    const vWind = vInf * (1 - rd / b.aAu);
    const rate = windCaptureRate(SUPERGIANT_WIND, b.m1, b.aAu, Math.max(vWind, 0.1 * vInf), orbitKms);
    const luminosity = accretionLuminosity(rate, b.m1, b.accretorKind, b.accretorRadiusAu);
    // Gas passing within the accretion radius 2GM/v_rel² is captured.
    const rAcc = (2 * 887.1 * b.m1) / (Math.max(vWind, 0.1 * vInf) ** 2 + orbitKms ** 2) / b.aAu;
    return { ...base, discInner: 0, discOuter: 0, stream: [], wind: windPaths(q, donorRadius, vInf / orbitKms, Math.max(rAcc, 0.02)), accretionRadius: rAcc, rate, driver: 'the compact object sweeping up the supergiant’s wind (Bondi–Hoyle capture of a typical 10⁻⁶ M☉/yr wind)', luminosity };
  }
  // Be/X-ray binaries: the Be star's disc, truncated short of its Roche lobe at periastron.
  const beDisc = Math.max(donorRadius * 2, Math.min(donorRadius * 10, 0.9 * lobe * peri));
  const rate = 1e-9;
  return { ...base, discInner: 0, discOuter: 0, stream: [], beDisc, rate, driver: 'gas from the Be star’s disc, taken mostly near periastron in outbursts (a typical outburst rate)', luminosity: accretionLuminosity(rate, b.m1, b.accretorKind, b.accretorRadiusAu) };
}

/** Magnetospheric (Alfvén) radius in AU for a dipole of surface field B (G) on a star of radius R (AU), accreting at `rate` M☉/yr. */
export function alfvenRadius(rate: number, mass: number, radiusAu: number, surfaceField: number): number {
  const mu = surfaceField * (radiusAu * AU_CM) ** 3 / 2;
  const mdot = (rate * MSUN) / YEAR;
  const r = Math.pow((mu ** 4) / (2 * G_CGS * mass * MSUN * mdot * mdot), 1 / 7);
  return r / AU_CM;
}

// --- Registry (by body name, for the renderer) ---------------------------------------------

const byAccretor = new Map<string, TransferParams>();
const byDonor = new Map<string, TransferParams>();

export function rememberTransfer(t: TransferParams): void {
  byAccretor.set(t.accretor, t);
  byDonor.set(t.donor, t);
}
export function transferForAccretor(name: string): TransferParams | undefined {
  return byAccretor.get(name);
}
export function transferForDonor(name: string): TransferParams | undefined {
  return byDonor.get(name);
}

/** A sentence for the scene tip. */
export function describeTransfer(t: TransferParams): string {
  const exp = Math.floor(Math.log10(t.rate));
  const mant = t.rate / 10 ** exp;
  const rate = `${mant >= 9.5 ? '1' : mant.toFixed(mant < 2 ? 1 : 0)} × 10^${mant >= 9.5 ? exp + 1 : exp}`;
  const lum = t.luminosity / 3.828e33;
  const lumText = lum >= 1 ? `${+lum.toPrecision(2)} times the Sun's light` : `${+(lum * 100).toPrecision(2)}% of the Sun's light`;
  const how =
    t.mode === 'wind'
      ? 'The supergiant blows a fast wind, and the compact object’s gravity bends the part that passes it into a trailing wake that feeds it.'
      : t.mode === 'be'
        ? 'The Be star spins so fast that it throws off a disc of gas in its equator, and the compact object feeds when its orbit carries it through.'
        : t.magnetic === 'polar'
          ? 'The donor fills its Roche lobe, and gas pours through the inner Lagrange point; partway down, the white dwarf’s strong magnetic field takes hold and leads it along field lines onto a hot spot near a magnetic pole, with no disc at all.'
          : `The donor fills its Roche lobe, and gas pours through the inner Lagrange point in a stream that the orbit’s turning bends ahead of the ${t.accretorKind === 'whitedwarf' ? 'white dwarf' : t.accretorKind === 'neutron' ? 'neutron star' : 'black hole'}${t.hotSpot && t.discOuter ? ', striking the edge of the disc at a bright hot spot' : ''}.${t.magnetic === 'ip' ? ' The white dwarf’s field clears the disc’s middle.' : ''}`;
  return `${how} It moves about ${rate} M☉ a year, driven by ${t.driver}, and the infall shines with about ${lumText}.`;
}
