/**
 * A star's size from what a catalogue gives: apparent V magnitude, B−V colour and distance.
 *
 * - Temperature from B−V (Ballesteros 2012, sim/stars.ts).
 * - Luminosity from the absolute magnitude and the bolometric correction of Flower (1996), with the
 *   coefficients as corrected by Torres (2010, AJ 140, 1158, Table 1), M_bol,☉ = 4.74.
 * - Radius from L = 4πR²σT⁴: R/R☉ = √(L/L☉) / (T/5772 K)².
 * - Mass, which brightness alone can't give, from typical relations: main-sequence stars
 *   M ≈ L^(1/3.5); red giants about 1.5 M☉; brighter evolved stars as massive main-sequence stars.
 *
 * Interstellar dust is ignored, so stars behind a lot of it come out too faint and too cool: the
 * famous ones of those carry published values instead (sim/famous.ts).
 */
import { temperatureFromBV } from './stars';

const T_SUN = 5772;

/** Bolometric correction BC_V (magnitudes) for an effective temperature (K). */
export function bolometricCorrection(T: number): number {
  const x = Math.log10(Math.max(2000, Math.min(50000, T)));
  if (x < 3.7) return -0.190537291496456e5 + 0.155144866764412e5 * x - 0.421278819301717e4 * x ** 2 + 0.381476328422343e3 * x ** 3;
  if (x < 3.9) return -0.370510203809015e5 + 0.385672629965804e5 * x - 0.150651486316025e5 * x ** 2 + 0.261724637119416e4 * x ** 3 - 0.170623810323864e3 * x ** 4;
  return -0.118115450538963e6 + 0.137145973583929e6 * x - 0.636233812100225e5 * x ** 2 + 0.147412923562646e5 * x ** 3 - 0.170587278406872e4 * x ** 4 + 0.788731721804990e2 * x ** 5;
}

export interface StarEstimate {
  temperature: number;
  /** Solar luminosities. */
  luminosity: number;
  /** Solar radii. */
  radius: number;
  /** Solar masses (a typical value for a star of this kind, not measured). */
  mass: number;
  /** What kind of star that makes it ("Red supergiant", "Main-sequence star"). */
  type: string;
}

/** Radius (R☉) from luminosity (L☉) and temperature (K). */
export function radiusFrom(luminosity: number, temperature: number): number {
  return Math.sqrt(luminosity) / (temperature / T_SUN) ** 2;
}

/** The kind of star a temperature, radius and luminosity make. */
export function starType(temperature: number, radius: number, luminosity = 0): string {
  if (radius >= 100 || (luminosity >= 1e4 && radius >= 30)) return temperature < 4600 ? 'Red supergiant' : temperature < 7500 ? 'Yellow supergiant' : temperature < 10000 ? 'White supergiant' : 'Blue supergiant';
  if (radius >= 10) return temperature < 5200 ? 'Red giant' : temperature < 10000 ? 'Bright giant' : 'Blue giant';
  if (radius >= 3) return 'Subgiant or bright star';
  return 'Main-sequence star';
}

/** Estimate a star from its V magnitude, B−V colour and distance (parsecs). */
export function estimateStar(vmag: number, bv: number, pc: number): StarEstimate {
  const temperature = temperatureFromBV(bv);
  const absV = vmag - 5 * Math.log10(pc / 10);
  const luminosity = 10 ** (-0.4 * (absV + bolometricCorrection(temperature) - 4.74));
  const radius = radiusFrom(luminosity, temperature);
  const evolved = radius >= 10;
  const mass = evolved && luminosity < 2000 ? 1.5 : Math.min(40, Math.max(0.1, luminosity ** (1 / 3.5)));
  return { temperature, luminosity, radius, mass, type: starType(temperature, radius, luminosity) };
}
