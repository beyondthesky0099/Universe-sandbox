/**
 * Distances and times from redshift in a flat ΛCDM universe with the Planck 2018 parameters
 * (Planck Collaboration 2020, A&A 641, A6, TT,TE,EE+lowE+lensing+BAO: H0 = 67.66 km/s/Mpc,
 * Ωm = 0.3111), plus radiation (photons and three massless neutrino species, Ωr ≈ 9.1 × 10⁻⁵),
 * for placing distant galaxies, quasars and clusters on the Universe map. Comoving distance is
 * what the map uses: it is a comoving grid, with the cosmic microwave background on the
 * last-scattering surface at about 45 billion light-years and the edge of the observable
 * universe (the particle horizon) at about 46 billion.
 *
 * The integrals run over the scale factor a = 1/(1 + z), where the integrands stay finite all the
 * way back to the Big Bang (with radiation, a²E(a) → √Ωr), so very high redshifts stay accurate.
 */

export const H0 = 67.66; // km/s/Mpc
export const OMEGA_M = 0.3111;
/** Radiation today: photons (Ωγh² = 2.47 × 10⁻⁵) and neutrinos (× 1.69), for h = 0.6766. */
export const OMEGA_R = (2.47e-5 * 1.6913) / (0.6766 * 0.6766);
export const OMEGA_L = 1 - OMEGA_M - OMEGA_R;
/** Hubble distance c / H0 (Mpc). */
export const HUBBLE_DISTANCE_MPC = 299792.458 / H0;
/** Hubble time 1 / H0 (Gyr). */
export const HUBBLE_TIME_GYR = 977.8 / H0;
/** Redshift of the last-scattering surface, where the microwave background was released (Planck 2018: z* = 1089.9). */
export const LAST_SCATTERING_Z = 1089.9;
export const MPC_IN_LY = 3.2616e6;

/** a² E(a) = a² H(a)/H0, finite at a = 0 thanks to radiation. */
function a2E(a: number): number {
  return Math.sqrt(OMEGA_R + OMEGA_M * a + OMEGA_L * a * a * a * a);
}

/** ∫ f over [a0, 1] by Simpson's rule with n (even) steps. */
function simpson(f: (a: number) => number, a0: number, n: number): number {
  const h = (1 - a0) / n;
  let s = f(a0) + f(1);
  for (let i = 1; i < n; i++) s += f(a0 + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** Line-of-sight comoving distance (Mpc): c/H0 ∫ da / (a² E(a)) from 1/(1+z) to 1. Small z reduces to cz/H0. */
export function comovingDistance(z: number): number {
  if (!(z > 0)) return 0;
  if (z < 0.01) return HUBBLE_DISTANCE_MPC * z * (1 - 0.75 * OMEGA_M * z); // second order, cheaper
  const a0 = 1 / (1 + z);
  // More steps for deeper integrals; the integrand is smooth in a.
  const n = z < 1 ? 200 : z < 20 ? 1000 : 4000;
  return HUBBLE_DISTANCE_MPC * simpson((a) => 1 / a2E(a), a0, n);
}

/** Angular-diameter distance (Mpc): the comoving distance over 1 + z (flat universe). Sizes on the sky use it. */
export function angularDiameterDistance(z: number): number {
  return comovingDistance(z) / (1 + z);
}

/** Luminosity distance (Mpc). */
export function luminosityDistance(z: number): number {
  return comovingDistance(z) * (1 + z);
}

/**
 * Light travel time from an object at redshift z (Gyr): ∫ da / (a H) = (1/H0) ∫ a da / (a² E(a))
 * from a = 1 / (1 + z) to 1.
 */
export function lookbackTime(z: number): number {
  if (!(z > 0)) return 0;
  return HUBBLE_TIME_GYR * simpson((a) => a / a2E(a), 1 / (1 + z), 4000);
}

/** Age of the universe (Gyr): the lookback time to the Big Bang (about 13.8 billion years). */
export const UNIVERSE_AGE_GYR = lookbackTime(1e12);

/** Distance to the cosmic microwave background's last-scattering surface (Mpc), about 13,900 (45 billion light-years). */
export const CMB_DISTANCE_MPC = comovingDistance(LAST_SCATTERING_Z);

/** The particle horizon, the edge of the observable universe (Mpc): about 14,200, or 46 billion light-years. */
export const OBSERVABLE_RADIUS_MPC = comovingDistance(1e12);

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
