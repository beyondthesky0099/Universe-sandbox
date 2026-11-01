import { luminosity, type Body, type BodyKind } from './body';
import { EARTH_MASS } from './units';

/** Equilibrium temperature (K) of a zero-albedo body at 1 AU from 1 L☉. */
const T_1AU = 278.6;
const DEFAULT_ALBEDO = 0.3;
/** Greenhouse warming (K) for an Earth-mass rocky planet. */
const GREENHOUSE = 33;
/** Floor from internal heat / background. */
const MIN_TEMP = 30;

export const HABITABLE_MIN_K = 250;
export const HABITABLE_MAX_K = 330;

export type Climate = 'frozen' | 'cold' | 'temperate' | 'hot' | 'molten';

/** Total stellar flux at a point, in units of the solar constant at 1 AU (L☉/AU²). */
export function stellarFlux(bodies: readonly Body[], x: number, y: number, z: number, exclude?: Body): number {
  let flux = 0;
  for (const b of bodies) {
    if (b === exclude || b.kind !== 'star') continue;
    const d2 = Math.max((b.x - x) ** 2 + (b.y - y) ** 2 + (b.z - z) ** 2, b.radius * b.radius);
    flux += luminosity(b) / d2;
  }
  return flux;
}

function greenhouse(kind: BodyKind, mass: number): number {
  return kind === 'rocky' ? GREENHOUSE * Math.min(1.5, Math.sqrt(mass / EARTH_MASS)) : 0;
}

/** Approximate surface (or cloud-top) temperature in kelvin for a given stellar flux. */
export function surfaceTemperature(kind: BodyKind, mass: number, flux: number, albedo = DEFAULT_ALBEDO): number {
  const teq = T_1AU * Math.pow(Math.max(0, flux) * (1 - albedo), 0.25);
  return Math.max(MIN_TEMP, teq + greenhouse(kind, mass));
}

export function bodyTemperature(bodies: readonly Body[], body: Body): number {
  return surfaceTemperature(body.kind, body.mass, stellarFlux(bodies, body.x, body.y, body.z, body));
}

export function climateFor(kind: BodyKind, kelvin: number): Climate {
  if (kelvin < 180) return 'frozen';
  if (kelvin < HABITABLE_MIN_K) return 'cold';
  if (kelvin <= HABITABLE_MAX_K) return 'temperate';
  if (kind === 'rocky' && kelvin >= 700) return 'molten';
  return 'hot';
}

export function isHabitable(kind: BodyKind, mass: number, kelvin: number): boolean {
  return kind === 'rocky' && mass >= 0.1 * EARTH_MASS && mass <= 10 * EARTH_MASS && kelvin >= HABITABLE_MIN_K && kelvin <= HABITABLE_MAX_K;
}

/**
 * Inner and outer edge (AU) of the habitable zone of a star of luminosity L (L☉), i.e. the
 * distances where an Earth-like planet's surface temperature is between the habitable bounds.
 */
export function habitableZone(lum: number): [number, number] {
  const distanceFor = (kelvin: number) => {
    const teq = kelvin - GREENHOUSE;
    // teq = T_1AU * ((L / d²)(1 - A))^¼  →  d = sqrt(L (1 - A)) · (T_1AU / teq)²
    return Math.sqrt(lum * (1 - DEFAULT_ALBEDO)) * Math.pow(T_1AU / teq, 2);
  };
  return [distanceFor(HABITABLE_MAX_K), distanceFor(HABITABLE_MIN_K)];
}

export function formatTemperature(kelvin: number): string {
  return `${Math.round(kelvin)} K (${Math.round(kelvin - 273.15)} °C)`;
}
