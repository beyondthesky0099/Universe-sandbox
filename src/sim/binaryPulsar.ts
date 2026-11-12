/**
 * The Hulse–Taylor binary pulsar, PSR B1913+16: two neutron stars on a tight, eccentric orbit.
 * Its orbit shrinks exactly as general relativity says it should by radiating gravitational waves:
 * the first evidence that they exist (Taylor & Weisberg 1982; Nobel Prize 1993).
 *
 * Measured values: Weisberg & Huang (2016, ApJ 829, 55).
 */

/** GM☉/c³ in seconds. */
export const T_SUN = 4.925490947e-6;
const SECONDS_PER_YEAR = 3.15576e7;

export const HULSE_TAYLOR = {
  /** Orbital period (days). */
  pbDays: 0.322997448918,
  e: 0.617134,
  /** Pulsar and companion masses (M☉). */
  mp: 1.438,
  mc: 1.39,
  /** Periastron advance, measured (degrees per year). */
  omegaDot: 4.226585,
  /** Orbital decay: observed, and the part left once the Galaxy's pull and the pulsar's motion
   * are taken off (s/s). */
  pbDotObserved: -2.423e-12,
  pbDotIntrinsic: -2.398e-12,
  /** The intrinsic decay as a fraction of general relativity's prediction, and its uncertainty. */
  ratio: 0.9983,
  ratioError: 0.0016,
  /** First measured: discovered 1974; timing since 1974.7. */
  since: 1974.7,
} as const;

function eccentricityFactor(e: number): number {
  return (1 + (73 / 24) * e * e + (37 / 96) * e ** 4) / (1 - e * e) ** 3.5;
}

/** General relativity's orbital decay dPb/dt (s/s) for a binary (Peters & Mathews 1963). */
export function orbitalDecay(pbSeconds: number, e: number, m1: number, m2: number): number {
  const n = (2 * Math.PI) / pbSeconds;
  return -((192 * Math.PI) / 5) * T_SUN ** (5 / 3) * n ** (5 / 3) * eccentricityFactor(e) * ((m1 * m2) / (m1 + m2) ** (1 / 3));
}

/** General relativity's periastron advance (degrees per year). */
export function periastronAdvance(pbSeconds: number, e: number, m1: number, m2: number): number {
  const n = (2 * Math.PI) / pbSeconds;
  const rad = (3 * T_SUN ** (2 / 3) * n ** (5 / 3) * (m1 + m2) ** (2 / 3)) / (1 - e * e);
  return (rad * SECONDS_PER_YEAR * 180) / Math.PI;
}

/**
 * How long until the two stars merge (years): Peters' (1964) equations for how gravitational
 * waves shrink the orbit and round it off, integrated until the stars meet. Lengths in
 * light-seconds, so G = c = 1 and masses are T☉ × M.
 */
export function timeToMerge(pbSeconds: number, e: number, m1: number, m2: number): number {
  const M = m1 + m2;
  const beta = T_SUN ** 3 * m1 * m2 * M;
  let a = Math.cbrt(T_SUN * M * (pbSeconds / (2 * Math.PI)) ** 2);
  let t = 0;
  const end = 10 * T_SUN * M;
  while (a > end) {
    const q = 1 - e * e;
    const dadt = (-(64 / 5) * beta * (1 + (73 / 24) * e * e + (37 / 96) * e ** 4)) / (a ** 3 * q ** 3.5);
    const dedt = (-(304 / 15) * e * beta * (1 + (121 / 304) * e * e)) / (a ** 4 * q ** 2.5);
    const dt = (0.002 * a) / Math.abs(dadt);
    a += dadt * dt;
    e = Math.max(0, e + dedt * dt);
    t += dt;
  }
  return t / SECONDS_PER_YEAR;
}

/** Cumulative shift of periastron time (s) after `years` at a constant decay rate. */
export function periastronShift(years: number, pbDot: number, pbSeconds: number): number {
  const t = years * SECONDS_PER_YEAR;
  return (pbDot / (2 * pbSeconds)) * t * t;
}
