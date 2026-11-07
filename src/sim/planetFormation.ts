/**
 * How planets form around a young star (the core-accretion picture).
 *
 * 1. **Disc.** The minimum-mass solar nebula (Hayashi 1981): solids with surface density
 *    Σ = 7.1 (r / 1 AU)^−1.5 g/cm² inside the snow line at 2.7 AU, and 30 (r / 1 AU)^−1.5
 *    beyond it, where water freezes into ice. Gas Σ = 1,700 (r / 1 AU)^−1.5 g/cm².
 *    Giant-planet models need a few times this: Pollack et al. (1996) used about 4× at
 *    Jupiter's distance.
 * 2. **Embryos.** Planetesimals collide and stick. The biggest grow fastest until each has
 *    swept up its feeding zone, ~10 Hill radii wide. That gives the isolation mass (Kokubo & Ida
 *    2002): about a Moon to a Mars inside the snow line, and several Earths beyond it.
 * 3. **Giants.** A core above ~10 Earth masses can no longer hold up the gas around it. The
 *    envelope contracts and the core pulls in gas faster and faster: runaway gas accretion
 *    (Pollack et al. 1996; Ikoma et al. 2000). The Kelvin–Helmholtz time is
 *    τ ≈ 10⁸ yr × (M_core / M⊕)^−2.5. Growth stops when the nearby gas is used up or the disc
 *    is gone.
 * 4. **Clearing.** The gas disc lasts a few million years (median ~3 Myr; Haisch et al. 2001),
 *    then the young star's light and wind blow it away. What has not become a giant by then
 *    stays rocky or icy.
 *
 * In the sandbox the bodies' radii are enlarged, so they collide about 10⁵ times sooner than
 * real ones would. The gas clock runs `speedup` times faster to match: the disc lasts 3 Myr / 10⁵
 * = 30 simulated years.
 */
import { EARTH_MASS } from './units';

const AU_CM = 1.495978707e13;
const SOLAR_MASS_G = 1.98847e33;
/** Mass of an annulus (M☉) for surface density coefficient `sigma1` (g/cm² at 1 AU, ∝ r^−1.5). */
function annulusMass(sigma1: number, r0: number, r1: number): number {
  // ∫ 2π r Σ1 r^−1.5 dr = 4π Σ1 (√r1 − √r0)   (r in AU → × AU² in cm²)
  return (4 * Math.PI * sigma1 * (Math.sqrt(r1) - Math.sqrt(r0)) * AU_CM * AU_CM) / SOLAR_MASS_G;
}

export const SNOW_LINE_AU = 2.7;
export const SIGMA_ROCK = 7.1;
export const SIGMA_ICE = 30;
export const SIGMA_GAS = 1700;
/** Core mass above which gas accretion runs away (M☉). */
export const CRITICAL_CORE = 10 * EARTH_MASS;
/** Median gas-disc lifetime (years). */
export const GAS_DISC_LIFETIME = 3e6;

/** Solid surface density (g/cm²) at r AU, scaled by `enhancement`. */
export function solidDensity(r: number, enhancement = 1, snowLine = SNOW_LINE_AU): number {
  return enhancement * (r < snowLine ? SIGMA_ROCK : SIGMA_ICE) * Math.pow(r, -1.5);
}

/** Solids (M☉) between r0 and r1 AU. */
export function solidMass(r0: number, r1: number, enhancement = 1, snowLine = SNOW_LINE_AU): number {
  let m = 0;
  if (r0 < snowLine) m += annulusMass(SIGMA_ROCK, r0, Math.min(r1, snowLine));
  if (r1 > snowLine) m += annulusMass(SIGMA_ICE, Math.max(r0, snowLine), r1);
  return m * enhancement;
}

/** Gas (M☉) between r0 and r1 AU. */
export function gasMass(r0: number, r1: number, enhancement = 1): number {
  return annulusMass(SIGMA_GAS, r0, r1) * enhancement;
}

/**
 * Isolation mass (M☉) at r AU around a star of `starMass` M☉: the mass of solids within
 * ±b/2 Hill radii of the embryo, where b ≈ 10 (Kokubo & Ida 2002). Solves
 * M = 2π r · b r_H · Σ with r_H = r (M / 3M*)^⅓.
 */
export function isolationMass(r: number, starMass = 1, enhancement = 1, b = 10): number {
  const sigma = (solidDensity(r, enhancement) * AU_CM * AU_CM) / SOLAR_MASS_G; // M☉/AU²
  // M = 2π b r² Σ (M / 3M*)^⅓  ⇒  M^⅔ = 2π b r² Σ / (3M*)^⅓
  return Math.pow((2 * Math.PI * b * r * r * sigma) / Math.cbrt(3 * starMass), 1.5);
}

/** Kelvin–Helmholtz growth time (years) of an envelope on a core of `mass` M☉. */
export function gasAccretionTime(mass: number): number {
  return 1e8 * Math.pow(mass / EARTH_MASS, -2.5);
}

/**
 * The most gas a giant at r AU can gather: what the disc holds within ±30% of its orbit. At
 * Jupiter's distance in a 4× nebula this is about 1.7 Jupiter masses.
 */
export function gasSupply(r: number, enhancement = 1): number {
  return gasMass(r * 0.7, r * 1.3, enhancement);
}

export interface FormationSettings {
  /** Id of the young star. */
  starId: number;
  /** Disc mass relative to the minimum-mass nebula. */
  enhancement: number;
  /** How many times faster growth runs here than in reality (to match the enlarged radii). */
  speedup: number;
  /** Simulation time (years) at which the gas disc is gone. */
  gasUntil: number;
  /** Set once the disc has gone. */
  dispersed?: boolean;
}

/**
 * New mass of a body at r AU after `dt` simulated years of gas accretion. A core below the
 * critical mass, or one whose disc has gone, keeps its mass.
 */
export function accreteGas(mass: number, r: number, dt: number, s: Pick<FormationSettings, 'enhancement' | 'speedup'>, gasLeft: boolean): number {
  if (!gasLeft || mass < CRITICAL_CORE) return mass;
  const cap = gasSupply(r, s.enhancement);
  if (mass >= cap) return mass;
  const tau = gasAccretionTime(mass) / s.speedup;
  return Math.min(cap, mass * Math.exp(dt / tau));
}

/** A seeded set of planetesimals following the disc's solid density. */
export function planetesimals(
  rand: () => number,
  count: number,
  inner: number,
  outer: number,
  enhancement: number,
): { a: number; mass: number; icy: boolean }[] {
  // Equal numbers per equal √r step, so each body carries the mass of its own annulus.
  const out: { a: number; mass: number; icy: boolean }[] = [];
  const s0 = Math.sqrt(inner), s1 = Math.sqrt(outer);
  for (let i = 0; i < count; i++) {
    const lo = s0 + ((s1 - s0) * i) / count, hi = s0 + ((s1 - s0) * (i + 1)) / count;
    const r0 = lo * lo, r1 = hi * hi;
    const a = r0 + (r1 - r0) * rand();
    out.push({ a, mass: solidMass(r0, r1, enhancement), icy: a >= SNOW_LINE_AU });
  }
  return out;
}
