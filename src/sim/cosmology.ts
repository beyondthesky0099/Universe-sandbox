/**
 * Distances and times from redshift in a flat ΛCDM universe (H0 = 70 km/s/Mpc, Ωm = 0.3,
 * ΩΛ = 0.7, radiation ignored except where noted), for placing distant galaxies, quasars and
 * clusters on the Universe map. Comoving distance is what the map uses: the Universe map is a
 * comoving grid with the CMB at about 14,000 Mpc.
 */

export const H0 = 70; // km/s/Mpc
export const OMEGA_M = 0.3;
export const OMEGA_L = 1 - OMEGA_M;
/** Hubble distance c / H0 (Mpc). */
export const HUBBLE_DISTANCE_MPC = 299792.458 / H0;
/** Hubble time 1 / H0 (Gyr). */
export const HUBBLE_TIME_GYR = 977.8 / H0;

function E(z: number): number {
  const a = 1 + z;
  return Math.sqrt(OMEGA_M * a * a * a + OMEGA_L);
}

/** ∫ f over [0, z] by Simpson's rule, with more steps for larger redshifts. */
function integrate(f: (z: number) => number, z: number): number {
  const n = Math.max(16, Math.min(2000, Math.ceil(z * 40))) * 2;
  const h = z / n;
  let s = f(0) + f(z);
  for (let i = 1; i < n; i++) s += f(i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** Line-of-sight comoving distance (Mpc). Small z reduces to cz / H0. */
export function comovingDistance(z: number): number {
  if (!(z > 0)) return 0;
  if (z < 0.01) return HUBBLE_DISTANCE_MPC * z * (1 - 0.75 * OMEGA_M * z); // second order, cheaper
  return HUBBLE_DISTANCE_MPC * integrate((x) => 1 / E(x), z);
}

/** Luminosity distance (Mpc). */
export function luminosityDistance(z: number): number {
  return comovingDistance(z) * (1 + z);
}

/**
 * Light travel time from an object at redshift z (Gyr): ∫ da / (a H) from a = 1 / (1 + z) to 1,
 * integrated in the scale factor, where the integrand is smooth all the way to the Big Bang.
 */
export function lookbackTime(z: number): number {
  if (!(z > 0)) return 0;
  const a0 = 1 / (1 + z);
  const n = 2000;
  const h = (1 - a0) / n;
  const f = (a: number) => 1 / Math.sqrt(OMEGA_M / a + OMEGA_L * a * a);
  let s = f(a0) + f(1);
  for (let i = 1; i < n; i++) s += f(a0 + i * h) * (i % 2 ? 4 : 2);
  return (HUBBLE_TIME_GYR * s * h) / 3;
}

/** Age of the universe (Gyr): the lookback time to the Big Bang. */
export const UNIVERSE_AGE_GYR = lookbackTime(1e7);

/** Age of the universe at redshift z (Gyr). */
export function ageAt(z: number): number {
  return Math.max(0, UNIVERSE_AGE_GYR - lookbackTime(z));
}

/** Readable lookback time: "2.4 billion years", "430 million years". */
export function formatLookback(gyr: number): string {
  if (gyr < 0.001) return `${Math.round(gyr * 1e6).toLocaleString('en-US')} thousand years`;
  if (gyr < 1) return `${Math.round(gyr * 1000)} million years`;
  return `${gyr.toFixed(gyr < 10 ? 1 : 0)} billion years`;
}
