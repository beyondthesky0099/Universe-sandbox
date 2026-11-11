/**
 * Neutron stars and pulsars: what they are like, and what you would see up close.
 *
 * - **Size and gravity.** About 1.4 M☉ in a ball 12 km across, so dense that space around it is
 *   strongly curved. Its compactness u = R_s / R (Schwarzschild radius over radius) is about 0.35.
 * - **Light bending.** Light leaving the surface is bent round the star, so you see more than half
 *   of it. Beloborodov (2002, ApJ 566, L85): a ray leaving at angle α to the vertical reaches you
 *   from a point ψ round the star, with 1 − cos α = (1 − cos ψ)(1 − u). The star also looks
 *   bigger than it is: R / √(1 − u).
 * - **Magnetic field and beams.** The field is a dipole (10⁸–10¹³ G) tilted from the spin axis.
 *   Particles stream out along the open field lines over the magnetic poles and beam radio waves
 *   (and in young pulsars light, X-rays and gamma rays) along the magnetic axis. As the star turns
 *   the beams sweep round like a lighthouse; we see a pulse each time one crosses us.
 * - **Spin-down.** The spinning magnet radiates and slows: B ≈ 3.2 × 10¹⁹ √(P Ṗ) G, characteristic
 *   age P / 2Ṗ, power Ė = 4π² I Ṗ / P³ with I = 10³⁸ kg m².
 *
 * Known pulsars use their measured period and spin-down (ATNF Pulsar Catalogue, Manchester et al.
 * 2005). Other neutron stars (e.g. born in a supernova here) get a birth period and field drawn
 * from the young-pulsar population (Faucher-Giguère & Kaspi 2006, ApJ 643, 332: P₀ ~ N(300 ms,
 * 150 ms), log B ~ N(12.65, 0.55)). The tilt of the magnetic axis is random (isotropic) unless known.
 */

/** Neutron-star radius (km). NICER finds 12–13 km for 1.4 M☉ (Riley et al. 2019; Miller et al. 2019). */
export const NS_RADIUS_KM = 12;
/** GM☉/c² in km. */
const GM_SUN_KM = 1.4766;
const C_KMS = 299792.458;
const G_SI = 6.674e-11;
const M_SUN_KG = 1.98847e30;
/** Moment of inertia (kg m²), the canonical 10⁴⁵ g cm². */
const INERTIA = 1e38;
const YEAR_S = 3.15576e7;
const DEG = Math.PI / 180;

/** Compactness u = R_s / R = 2GM / (R c²). */
export function compactness(massMsun: number, radiusKm = NS_RADIUS_KM): number {
  return (2 * GM_SUN_KM * massMsun) / radiusKm;
}

/**
 * Where a ray comes from: the angle ψ (radians) round the star between the point facing you and
 * the point a ray leaving at α (radians) to the vertical comes from (Beloborodov 2002).
 */
export function bentAngle(alpha: number, u: number): number {
  const c = 1 - (1 - Math.cos(alpha)) / (1 - u);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

/** Fraction of the surface you can see at once (0.5 without gravity; the whole star at u ≥ 0.5). */
export function visibleFraction(u: number): number {
  const psiMax = bentAngle(Math.PI / 2, u);
  return (1 - Math.cos(psiMax)) / 2;
}

/** How big the star looks (km): its radius magnified by its own gravity, R / √(1 − u). */
export function apparentRadiusKm(massMsun: number, radiusKm = NS_RADIUS_KM): number {
  return radiusKm / Math.sqrt(1 - compactness(massMsun, radiusKm));
}

/** Gravitational redshift of light from the surface, z = 1 / √(1 − u) − 1. */
export function surfaceRedshift(u: number): number {
  return 1 / Math.sqrt(1 - u) - 1;
}

/** Escape speed from the surface as a fraction of light speed, √u. */
export function escapeSpeedC(u: number): number {
  return Math.sqrt(u);
}

/** Surface gravity (m/s²), GM / (R² √(1 − u)). */
export function surfaceGravity(massMsun: number, radiusKm = NS_RADIUS_KM): number {
  const r = radiusKm * 1000;
  return (G_SI * massMsun * M_SUN_KG) / (r * r) / Math.sqrt(1 - compactness(massMsun, radiusKm));
}

/** Mean density (kg/m³). */
export function meanDensity(massMsun: number, radiusKm = NS_RADIUS_KM): number {
  const r = radiusKm * 1000;
  return (massMsun * M_SUN_KG) / ((4 / 3) * Math.PI * r * r * r);
}

/** Light-cylinder radius (km): where co-rotating field lines would move at light speed, cP / 2π. */
export function lightCylinderKm(periodS: number): number {
  return (C_KMS * periodS) / (2 * Math.PI);
}

/** Angular radius (radians) of the polar cap of open field lines: sin²θ = R / R_LC. */
export function polarCapAngle(periodS: number, radiusKm = NS_RADIUS_KM): number {
  return Math.asin(Math.min(1, Math.sqrt(radiusKm / lightCylinderKm(periodS))));
}

/** Half-width of the radio beam (degrees) at 1 GHz: 5.4° P^−½ (Rankin 1993, ApJ 405, 285). */
export function beamHalfAngleDeg(periodS: number): number {
  return Math.min(90, 5.4 / Math.sqrt(periodS));
}

/** Surface dipole field (gauss) from period and spin-down: 3.2 × 10¹⁹ √(P Ṗ). */
export function dipoleField(periodS: number, pdot: number): number {
  return 3.2e19 * Math.sqrt(periodS * pdot);
}

/** Spin-down rate Ṗ (s/s) of a dipole of `fieldG` gauss spinning with period P. */
export function periodDerivative(periodS: number, fieldG: number): number {
  return (fieldG / 3.2e19) ** 2 / periodS;
}

/** Characteristic age (years), P / 2Ṗ. */
export function characteristicAge(periodS: number, pdot: number): number {
  return periodS / (2 * pdot) / YEAR_S;
}

/** Spin-down power (watts), Ė = 4π² I Ṗ / P³. */
export function spinDownPower(periodS: number, pdot: number): number {
  return (4 * Math.PI * Math.PI * INERTIA * pdot) / periodS ** 3;
}

/**
 * Surface temperature (K) a neutron star of this age has cooled to: a rough fit to the standard
 * (minimal) cooling curve (Page et al. 2004): about a million kelvin for the first ~10⁵ years
 * while neutrinos carry the heat away, then a fast fall once the surface's own light takes over.
 */
export function surfaceTemperature(ageYr: number): number {
  const t = Math.max(ageYr, 100);
  if (t < 1e5) return 1.4e6 * Math.pow(t / 1e3, -0.09);
  return Math.max(3e4, 1.4e6 * Math.pow(100, -0.09) * Math.pow(t / 1e5, -0.6));
}

export interface PulsarParams {
  /** Spin period (s). */
  period: number;
  /** Spin-down rate Ṗ (s/s). */
  pdot: number;
  /** Surface dipole field (gauss). */
  field: number;
  /** Angle between the magnetic axis and the spin axis (degrees). */
  obliquity: number;
  /** Measured (a catalogued pulsar) rather than drawn from the population. */
  real: boolean;
  /** Age (years): the remnant's age if known, else the characteristic age. */
  age: number;
}

/**
 * Catalogued pulsars: period and Ṗ from the ATNF Pulsar Catalogue (v2.6.1, as in
 * public/data/pulsars.json; a test keeps them in step). Ṗ for the millisecond pulsars is the
 * intrinsic value (corrected for their motion). Ages are those of the supernova
 * remnant where it is known (the Crab: SN 1054). The magnetic tilt is poorly known and set to 45°.
 */
export const KNOWN_PULSARS: Record<string, { period: number; pdot: number; age?: number; aliases: string[] }> = {
  'Crab Pulsar': { period: 0.033392, pdot: 4.21e-13, age: 972, aliases: ['PSR B0531+21', 'PSR J0534+2200'] },
  'Vela Pulsar': { period: 0.089328, pdot: 1.25e-13, aliases: ['PSR B0833-45', 'PSR J0835-4510'] },
  'PSR J0437-4715': { period: 0.005757, pdot: 1.37e-20, aliases: [] },
  'PSR B1257+12': { period: 0.006219, pdot: 1.53e-20, aliases: ['Lich', 'PSR J1300+1240'] },
  'PSR B1913+16': { period: 0.05903, pdot: 8.62e-18, aliases: ['Hulse–Taylor pulsar', 'PSR J1915+1606'] },
};

/** A catalogued pulsar whose name (or alias) the body's name contains. */
export function knownPulsar(name: string): (typeof KNOWN_PULSARS)[string] | undefined {
  const lower = name.toLowerCase();
  for (const [key, p] of Object.entries(KNOWN_PULSARS)) {
    if ([key, ...p.aliases].some((n) => lower.includes(n.toLowerCase()))) return p;
  }
  return undefined;
}

/** A small deterministic random-number generator (so a body keeps its pulsar between frames). */
function rng(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/**
 * The pulsar a neutron star is: catalogued values for a known pulsar (matched by name), otherwise
 * a young pulsar drawn from the birth population, seeded by `seed` (the body's id).
 */
export function pulsarParams(name: string, seed: number): PulsarParams {
  const rand = rng(seed + 1);
  const obliquity = (Math.acos(1 - rand()) / DEG);
  const known = knownPulsar(name);
  if (known) {
    const age = known.age ?? characteristicAge(known.period, known.pdot);
    return { period: known.period, pdot: known.pdot, field: dipoleField(known.period, known.pdot), obliquity: 45, real: true, age };
  }
  let period = 0;
  while (period < 0.01) period = 0.3 + 0.15 * gaussian(rand);
  const field = Math.pow(10, 12.65 + 0.55 * gaussian(rand));
  return { period, pdot: periodDerivative(period, field), field, obliquity, real: false, age: 1000 };
}

/**
 * How fast to turn the star on screen (seconds per turn). The real period if a screen can show it,
 * else slowed to 0.25 s: faster than that, frames would catch it at random angles.
 */
export function displayPeriod(periodS: number): number {
  return Math.max(periodS, 0.25);
}

/** A neutron star's facts: its pulsar (catalogued or typical), and what its gravity does. */
export function neutronFacts(body: { name: string; id: number; mass: number }): [string, string][] {
  const p = pulsarParams(body.name, body.id);
  const u = compactness(body.mass);
  const per = p.period < 1 ? `${(p.period * 1000).toPrecision(3)} ms (${Math.round(1 / p.period)} turns a second)` : `${p.period.toPrecision(3)} s`;
  const shown = displayPeriod(p.period) > p.period ? ', shown slowed to 4 a second' : '';
  const sci = (x: number, unit: string) => {
    const e = Math.floor(Math.log10(x));
    return `${(x / 10 ** e).toFixed(1)} × 10${String(e).replace(/./g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)] ?? (c === '-' ? '⁻' : c))} ${unit}`;
  };
  const age = p.age < 1e6 ? `${Math.round(p.age).toLocaleString('en-US')} years` : p.age < 1e9 ? `${Math.round(p.age / 1e6).toLocaleString('en-US')} million years` : `${(p.age / 1e9).toFixed(1)} billion years`;
  const lc = lightCylinderKm(p.period);
  return [
    ['Pulsar', p.real ? 'measured (ATNF Pulsar Catalogue)' : 'typical newborn pulsar (Faucher-Giguère & Kaspi 2006)'],
    ['Spin period', per + shown],
    ['Magnetic field', `${sci(p.field, 'G')} (Earth: 0.5 G)`],
    ['Magnetic axis tilt', `${Math.round(p.obliquity)}° from the spin axis${p.real ? ' (poorly known)' : ''}`],
    ['Beam half-width', `${beamHalfAngleDeg(p.period).toFixed(0)}° (radio, 1 GHz)`],
    ['Age', `${age}${p.real ? '' : ' (just born)'}`],
    ['Surface temperature', `about ${sci(surfaceTemperature(p.age), 'K')}`],
    ['Spin-down power', `${sci(spinDownPower(p.period, p.pdot) / 3.828e26, 'L☉')}`],
    ['Light cylinder', `${Math.round(lc).toLocaleString('en-US')} km (where the field would have to move at light speed)`],
    ['Radius', `${NS_RADIUS_KM} km (shown enlarged)`],
    ['Density', `${sci(meanDensity(body.mass) / 1000, 't/m³')}: a teaspoonful weighs ${((meanDensity(body.mass) * 5e-6) / 1e12).toFixed(1)} billion tonnes`],
    ['Surface gravity', `${sci(surfaceGravity(body.mass) / 9.81, 'g')}`],
    ['Escape speed', `${Math.round(escapeSpeedC(u) * 100)}% of light speed`],
    ['Visible at once', `${Math.round(visibleFraction(u) * 100)}% of its surface (gravity bends the light)`],
    ['Light from the surface', `stretched ${Math.round(surfaceRedshift(u) * 100)}% redder by gravity`],
  ];
}
