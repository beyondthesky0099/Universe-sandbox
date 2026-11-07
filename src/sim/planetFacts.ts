/**
 * Facts about a planet or moon, worked out from its mass, size and orbit, for the "More about"
 * section of the body panel.
 *
 * The Earth Similarity Index (Schulze-Makuch et al. 2011, Astrobiology 11, 1041) is a weighted
 * geometric mean of how close four properties are to Earth's:
 *   ESI = Π (1 − |x − x⊕| / (x + x⊕))^(wᵢ / n),
 * with radius (w = 0.57), bulk density (1.07), escape velocity (0.70) and surface temperature
 * (5.58; Earth 288 K), n = 4. It is 1 for Earth. Above ~0.8 a world is Earth-like in size and
 * temperature, which is not the same as habitable.
 */
import { physicalRadius, type BodyKind } from './body';
import { EARTH_MASS } from './units';

const SOLAR_MASS_KG = 1.98847e30;
const G_SI = 6.6743e-11;
const AU_KM = 149597870.7;
const EARTH_RADIUS_KM = 6371.0;
const EARTH_DENSITY = 5.514; // g/cm³
const EARTH_ESCAPE = 11.186; // km/s
const EARTH_TEMP = 288; // K
const EQ_1AU = 278.6; // K, zero albedo, 1 L☉ at 1 AU

export interface EsiParts {
  radius: number;
  density: number;
  escape: number;
  temperature: number;
}

export const ESI_WEIGHTS: EsiParts = { radius: 0.57, density: 1.07, escape: 0.7, temperature: 5.58 };

/** One property's similarity term, raised to w/n. */
function term(x: number, ref: number, weight: number, n: number): number {
  if (!(x > 0)) return 0;
  return Math.pow(1 - Math.abs(x - ref) / (x + ref), weight / n);
}

/**
 * ESI from radius (Earth radii), density (Earth = 1), escape velocity (Earth = 1) and surface
 * temperature (K). Returns the index and each property's term.
 */
export function earthSimilarity(radius: number, density: number, escape: number, kelvin: number): { esi: number; parts: EsiParts } {
  const n = 4;
  const parts: EsiParts = {
    radius: term(radius, 1, ESI_WEIGHTS.radius, n),
    density: term(density, 1, ESI_WEIGHTS.density, n),
    escape: term(escape, 1, ESI_WEIGHTS.escape, n),
    temperature: term(kelvin, EARTH_TEMP, ESI_WEIGHTS.temperature, n),
  };
  return { esi: parts.radius * parts.density * parts.escape * parts.temperature, parts };
}

export interface PlanetFacts {
  radiusKm: number;
  /** True when the radius comes from a mass–radius relation, not a measurement. */
  radiusEstimated: boolean;
  gravity: number; // m/s²
  escapeKms: number;
  density: number; // g/cm³
  /** Starlight received, relative to Earth's (solar constant = 1). */
  insolation: number;
  /** Equilibrium temperature (K) with the body's albedo, before any greenhouse warming. */
  equilibriumK: number;
  albedo: number;
  esi: number;
  esiParts: EsiParts;
  /** Hill sphere radius (AU) around the body, if it orbits something. */
  hillAU?: number;
}

export interface FactsInput {
  kind: BodyKind;
  /** Solar masses. */
  mass: number;
  /** Measured radius (km), when known. */
  radiusKm?: number;
  albedo?: number;
  /** Stellar flux in L☉/AU² (= Earth units). */
  flux: number;
  /** Modelled surface temperature (K), used for the ESI. */
  surfaceK: number;
  /** Mass of the body it orbits (M☉) and the distance to it (AU). */
  parentMass?: number;
  distance?: number;
}

export function planetFacts(input: FactsInput): PlanetFacts {
  const radiusKm = input.radiusKm ?? physicalRadius(input.kind, input.mass) * AU_KM;
  const m = input.mass * SOLAR_MASS_KG;
  const r = radiusKm * 1000;
  const gravity = (G_SI * m) / (r * r);
  const escapeKms = Math.sqrt((2 * G_SI * m) / r) / 1000;
  const density = m / ((4 / 3) * Math.PI * r ** 3) / 1000; // kg/m³ → g/cm³
  const albedo = input.albedo ?? 0.3;
  const equilibriumK = EQ_1AU * Math.pow(Math.max(0, input.flux) * (1 - albedo), 0.25);
  const { esi, parts } = earthSimilarity(radiusKm / EARTH_RADIUS_KM, density / EARTH_DENSITY, escapeKms / EARTH_ESCAPE, input.surfaceK);
  const hillAU = input.parentMass && input.distance ? input.distance * Math.cbrt(input.mass / (3 * input.parentMass)) : undefined;
  return { radiusKm, radiusEstimated: input.radiusKm === undefined, gravity, escapeKms, density, insolation: input.flux, equilibriumK, albedo, esi, esiParts: parts, hillAU };
}

/** A word for an ESI value. */
export function esiLabel(esi: number): string {
  if (esi >= 0.99) return 'Earth';
  if (esi >= 0.8) return 'Earth-like';
  if (esi >= 0.6) return 'somewhat Earth-like';
  if (esi >= 0.4) return 'unlike Earth';
  return 'very unlike Earth';
}

/** Earth masses helper for display. */
export function earthMasses(mass: number): number {
  return mass / EARTH_MASS;
}

/** Wikipedia article titles for Solar System names that need disambiguating. */
const WIKI_TITLES: Record<string, string> = {
  Mercury: 'Mercury_(planet)',
  Ceres: 'Ceres_(dwarf_planet)',
  Eris: 'Eris_(dwarf_planet)',
  Pallas: '2_Pallas',
  Vesta: '4_Vesta',
  Hygiea: '10_Hygiea',
  Juno: '3_Juno',
  Psyche: '16_Psyche',
  Bennu: '101955_Bennu',
  Apophis: '99942_Apophis',
  Enceladus: 'Enceladus',
  Moon: 'Moon',
  Sun: 'Sun',
};
/** Moons whose plain name is already the article (the rest get "(moon)"). */
const PLAIN_MOONS = new Set(['Moon', 'Enceladus']);

/** The Wikipedia link for a real Solar System body. */
export function wikipediaUrl(name: string, isMoon: boolean): string {
  const title = WIKI_TITLES[name] ?? (isMoon && !PLAIN_MOONS.has(name) ? `${name}_(moon)` : name.replace(/ /g, '_'));
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title).replace(/%2F/g, '/')}`;
}

/** The NASA Exoplanet Archive overview page for a host star. */
export function exoplanetArchiveUrl(host: string): string {
  return `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(host)}`;
}
