/**
 * Simulation units:
 *   distance: astronomical units (AU)
 *   mass:     solar masses (M☉)
 *   time:     years (yr)
 *
 * In these units the gravitational constant is G = 4π², which means a
 * massless body orbiting 1 M☉ at 1 AU has a period of exactly 1 year.
 */
export const G = 4 * Math.PI * Math.PI;

/**
 * Galaxy-scale scenes use kiloparsecs, solar masses and millions of years instead. The
 * simulation is unit-agnostic, so they set gravityScale = KPC_MYR_GRAVITY_SCALE, and the
 * display formatters switch with setDisplayUnits.
 */
export type UnitSystem = 'au-yr' | 'kpc-myr';
/** G in kpc³ / (M☉ Myr²) divided by 4π². */
export const KPC_MYR_GRAVITY_SCALE = 4.4985e-12 / G;
/** 1 kpc/Myr in km/s. */
export const KPC_PER_MYR_IN_KMS = 977.79;

let displayUnits: UnitSystem = 'au-yr';
export function setDisplayUnits(units: UnitSystem): void {
  displayUnits = units;
}
export function getDisplayUnits(): UnitSystem {
  return displayUnits;
}

export const EARTH_MASS = 3.003e-6; // M☉
export const JUPITER_MASS = 9.546e-4; // M☉

/** Speed of light in AU per year. */
export const C_AU_PER_YEAR = 63241.077;

/** 1 AU/yr expressed in km/s. */
export const AU_PER_YEAR_IN_KMS = 4.7406;

/** Bodies at or above this mass ignite as stars. */
export const STAR_MIN_MASS = 0.08;
/** Bodies at or above this mass (that are not stars) become gas giants. */
export const GAS_GIANT_MIN_MASS = 10 * EARTH_MASS;
/** Stars at or above this mass collapse into black holes. */
export const BLACK_HOLE_COLLAPSE_MASS = 50;

export function formatMass(m: number): string {
  if (m >= STAR_MIN_MASS) return `${fmt(m)} M☉`;
  if (m >= GAS_GIANT_MIN_MASS) return `${fmt(m / JUPITER_MASS)} M_J`;
  return `${fmt(m / EARTH_MASS)} M⊕`;
}

export function formatDistance(au: number): string {
  if (displayUnits === 'kpc-myr') return `${fmt(au)} kpc (${fmt(au * 3261.6)} ly)`;
  return `${fmt(au)} AU`;
}

/** Real sizes in kilometres (large stars in AU). */
export function formatKm(au: number): string {
  const km = au * 149597870.7;
  if (km >= 1e7) return formatDistance(au);
  if (km >= 1000) return `${Math.round(km).toLocaleString('en-US')} km`;
  return `${Number(km.toPrecision(3))} km`;
}

export function formatSpeed(auPerYear: number): string {
  if (displayUnits === 'kpc-myr') return `${fmt(auPerYear * KPC_PER_MYR_IN_KMS)} km/s`;
  return `${fmt(auPerYear * AU_PER_YEAR_IN_KMS)} km/s`;
}

export function formatTime(years: number): string {
  if (displayUnits === 'kpc-myr') {
    // Here the time unit is a million years.
    return Math.abs(years) < 1000 ? `${years.toFixed(0)} million yr` : `${(years / 1000).toFixed(2)} billion yr`;
  }
  if (Math.abs(years) < 1) return `${(years * 365.25).toFixed(1)} days`;
  if (Math.abs(years) < 1e4) return `${years.toFixed(2)} yr`;
  return `${(years / 1000).toFixed(1)} kyr`;
}

export function fmt(x: number): string {
  const a = Math.abs(x);
  if (a === 0) return '0';
  if (a >= 1e4 || a < 1e-3) return x.toExponential(2);
  if (a >= 100) return x.toFixed(0);
  if (a >= 10) return x.toFixed(1);
  return x.toFixed(a >= 1 ? 2 : 3);
}
