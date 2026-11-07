/**
 * Supernova physics from the published models, in cgs units unless noted.
 *
 * - Ejecta: a uniform-density, homologously expanding sphere (Truelove & McKee 1999), so the
 *   fastest ejecta move at v_max = √(10E / 3M_ej) and speeds are spread as v_max·u^(1/3).
 * - Brightness: radioactive ⁵⁶Ni → ⁵⁶Co → ⁵⁶Fe heating (Nadyozhin 1994), diffused out of the
 *   ejecta as in Arnett's model (Arnett 1982; Chatzopoulos et al. 2012) for Type Ia, and the
 *   hydrogen-recombination plateau of Type II-P supernovae (Kasen & Woosley 2009 scalings).
 * - Remnant: free expansion, then the Sedov–Taylor blast wave R = 1.15 (E t² / ρ)^(1/5), then the
 *   radiative snowplow after shell formation at t_sf ≈ 3.6×10⁴ yr E₅₁^(3/14) n^(−4/7) (Cioffi,
 *   McKee & Bertschinger 1988), R ∝ t^(2/7).
 * - Neutron-star kicks: Maxwellian with σ = 265 km/s per axis (Hobbs et al. 2005).
 */

export const M_SUN_G = 1.989e33;
export const L_SUN = 3.828e33; // erg/s (IAU nominal)
export const R_SUN_CM = 6.957e10;
const DAY = 86400;
const YEAR = 3.15576e7;
const PC_CM = 3.0857e18;
const AU_CM = 1.495978707e13;
const M_H = 1.6726e-24;
const C_CM = 2.99792458e10;
/** Gravitational constant (cgs). */
const G_CGS = 6.674e-8;

/** ⁵⁶Ni and ⁵⁶Co: energy release per gram per second and mean lifetimes (Nadyozhin 1994). */
export const EPS_NI = 3.9e10;
export const EPS_CO = 6.78e9;
export const TAU_NI_DAYS = 8.8;
export const TAU_CO_DAYS = 111.3;

export type SupernovaType = 'II' | 'Ia';

export interface Explosion {
  type: SupernovaType;
  /** Kinetic energy (erg), ejecta mass (M☉), ⁵⁶Ni mass (M☉). */
  energy: number;
  ejectaMass: number;
  nickelMass: number;
  /** Progenitor radius in solar radii (sets the Type II plateau). */
  progenitorRadius: number;
  /** Ambient interstellar density (hydrogen atoms per cm³). */
  ismDensity: number;
  /** Core-collapse subtype from the progenitor (stellarFate.ts): II-P, Ib, PISN, … */
  subtype?: string;
  /**
   * Hydrogen envelope (M☉) that the shock heats and that glows on the Type II plateau as it
   * recombines. Without one (Ib/c, IIb, pair instability) the light is ⁵⁶Ni diffusing out (Arnett).
   * Defaults to the whole ejecta for Type II.
   */
  envelopeMass?: number;
  /** Extra light from ejecta running into earlier shells (pulsational pair instability). */
  interaction?: { luminosity: number; days: number };
}

/** Hydrogen envelope (M☉) for the plateau. */
function envelopeOf(e: Explosion): number {
  return e.type === 'Ia' ? 0 : e.envelopeMass ?? e.ejectaMass;
}

/**
 * Whether the light curve has a hydrogen-recombination plateau (≥ 0.5 M☉ of envelope). Pair-
 * instability supernovae are powered by their huge ⁵⁶Ni mass (pulsational ones by colliding
 * shells), so they follow Arnett's curve even with hydrogen left.
 */
export function hasPlateau(e: Explosion): boolean {
  return envelopeOf(e) >= 0.5 && e.subtype !== 'PISN' && e.subtype !== 'PPISN';
}

/**
 * A core-collapse supernova of a star of `mass` M☉. Typical values: E ≈ 10⁵¹ erg (Kasen &
 * Woosley 2009 find 0.5–4 × 10⁵¹, typically 0.9 × 10⁵¹), ~0.04 M☉ of ⁵⁶Ni, and a red-supergiant
 * envelope of ~500 R☉; above 20 M☉ the core collapses to a black hole.
 */
export function coreCollapse(mass: number, remnantMass: number, opts: Partial<Explosion> = {}): Explosion {
  return {
    type: 'II',
    energy: 1e51,
    ejectaMass: Math.max(0.5, mass - remnantMass),
    nickelMass: 0.04,
    progenitorRadius: mass >= 20 ? 100 : 500,
    ismDensity: 1,
    ...opts,
  };
}

/** A Type Ia supernova: a Chandrasekhar-mass white dwarf, 1.3 × 10⁵¹ erg, 0.6 M☉ of ⁵⁶Ni. */
export function thermonuclear(opts: Partial<Explosion> = {}): Explosion {
  return { type: 'Ia', energy: 1.3e51, ejectaMass: 1.4, nickelMass: 0.6, progenitorRadius: 0.01, ismDensity: 1, ...opts };
}

/**
 * The ejecta's composition shells from the inside out, as mass fractions, with the colour each
 * glows in a remnant (its strongest optical lines): iron-group elements and silicon/sulphur from
 * the core, then oxygen, helium and, for core collapse, the hydrogen envelope. The yields are
 * typical of the models (Woosley & Weaver 1995; Sukhbold et al. 2016 for core collapse; the W7
 * model of Nomoto et al. 1984 for Type Ia: ~0.6 M☉ of ⁵⁶Ni, ~0.5 M☉ of Si–Ca, unburnt C/O outside).
 */
export interface EjectaLayer {
  element: string;
  /** Mass in M☉, and the colour it glows (RGB 0–1). */
  mass: number;
  color: [number, number, number];
}

const LINE_COLORS = {
  iron: [1, 0.72, 0.35], // [Fe II], [Fe III]: warm gold
  silicon: [1, 0.45, 0.28], // [S II] 672 nm, [S III]: orange-red
  oxygen: [0.35, 0.95, 0.85], // [O III] 501 nm: teal
  helium: [0.98, 0.9, 0.62], // He I 588 nm: pale yellow
  hydrogen: [1, 0.3, 0.38], // Hα 656 nm: red
  carbon: [0.8, 0.85, 1], // unburnt C/O, little emission: pale
} as const;

export function ejectaLayers(e: Explosion): EjectaLayer[] {
  const layer = (element: keyof typeof LINE_COLORS, mass: number): EjectaLayer => ({ element, mass, color: [...LINE_COLORS[element]] as [number, number, number] });
  if (e.type === 'Ia') {
    const iron = e.nickelMass + 0.1;
    const silicon = Math.min(0.5, Math.max(0, e.ejectaMass - iron) * 0.7);
    return [layer('iron', iron), layer('silicon', silicon), layer('carbon', Math.max(0, e.ejectaMass - iron - silicon))];
  }
  // A failed supernova only loses some of its hydrogen envelope.
  if (e.subtype === 'failed') return [layer('hydrogen', e.ejectaMass)];
  const hydrogen = Math.min(envelopeOf(e), e.ejectaMass);
  const core = Math.max(0, e.ejectaMass - hydrogen);
  const iron = Math.min(core, e.nickelMass + 0.05);
  const rest = core - iron;
  // The core's onion shells: silicon/sulphur, then oxygen (with neon and magnesium), then helium.
  // Type Ic stars lost their helium; pair-instability cores are mostly oxygen and silicon.
  const [fSi, fO] = e.subtype === 'PISN' ? [0.3, 0.6] : e.subtype === 'Ic' || e.subtype === 'Ic-BL' ? [0.15, 0.8] : e.subtype === 'ECSN' ? [0.02, 0.1] : [0.1, 0.45];
  const silicon = rest * fSi, oxygen = rest * fO;
  const helium = Math.max(0, rest - silicon - oxygen);
  return [layer('iron', iron), layer('silicon', silicon), layer('oxygen', oxygen), layer('helium', helium), layer('hydrogen', hydrogen)];
}

/** Fastest ejecta speed (km/s) of a uniform, homologous sphere: KE = (3/10) M v_max². */
export function maxEjectaSpeed(e: Explosion): number {
  return Math.sqrt((10 * e.energy) / (3 * e.ejectaMass * M_SUN_G)) / 1e5;
}

/** Radioactive power (erg/s) deposited by `nickelMass` M☉ of ⁵⁶Ni, `days` after explosion. */
export function decayPower(nickelMass: number, days: number): number {
  return nickelMass * M_SUN_G * ((EPS_NI - EPS_CO) * Math.exp(-days / TAU_NI_DAYS) + EPS_CO * Math.exp(-days / TAU_CO_DAYS));
}

/** Arnett diffusion time (days): t_m = √(2κM / βcv), β = 13.8, with v the mean ejecta speed. */
export function diffusionTimeDays(e: Explosion, kappa = 0.1): number {
  const v = Math.sqrt((2 * e.energy) / (e.ejectaMass * M_SUN_G)); // RMS speed, cm/s
  return Math.sqrt((2 * kappa * e.ejectaMass * M_SUN_G) / (13.8 * C_CM * v)) / DAY;
}

/** Arnett light curve (erg/s): radioactive heating diffusing out of the ejecta (full γ-ray trapping). */
export function arnettLuminosity(e: Explosion, days: number, steps = 400): number {
  if (days <= 0) return 0;
  const tm = diffusionTimeDays(e);
  const x = days / tm;
  // L(t) = e^{−x²} ∫₀^x 2z e^{z²} P(z·t_m) dz, integrated by the midpoint rule.
  let sum = 0;
  const h = x / steps;
  for (let i = 0; i < steps; i++) {
    const z = (i + 0.5) * h;
    sum += 2 * z * Math.exp(z * z - x * x) * decayPower(e.nickelMass, z * tm) * h;
  }
  return sum;
}

/** Type II-P plateau luminosity (erg/s) and duration (days), Kasen & Woosley 2009 scalings. */
export function plateau(e: Explosion): { luminosity: number; days: number } {
  // The plateau lasts as long as the hydrogen envelope takes to recombine: its mass, not the core's.
  const E51 = e.energy / 1e51, M10 = Math.max(0.05, envelopeOf(e)) / 10, R500 = e.progenitorRadius / 500;
  return {
    luminosity: 1.26e42 * E51 ** (5 / 6) * M10 ** -0.5 * R500 ** (2 / 3),
    days: 109 * E51 ** (-1 / 6) * M10 ** 0.5 * R500 ** (1 / 6),
  };
}

/** Bolometric luminosity (erg/s) `days` after the explosion. */
export function luminosity(e: Explosion, days: number): number {
  if (days <= 0) return 0;
  const interaction = e.interaction ? e.interaction.luminosity * (1 - Math.exp(-days / 10)) / (1 + Math.exp((days - e.interaction.days) / 15)) : 0;
  // No hydrogen plateau (Type Ia, Ib/c, IIb, pair instability): ⁵⁶Ni light diffusing out.
  if (!hasPlateau(e)) return arnettLuminosity(e, days) + interaction;
  // Type II: a ~10-day rise to the plateau, the plateau, then a ~2-week drop to the ⁵⁶Co tail.
  const p = plateau(e);
  const rise = 1 - Math.exp(-days / 3);
  const drop = 1 / (1 + Math.exp((days - p.days) / 6));
  return Math.max(p.luminosity * rise * drop, decayPower(e.nickelMass, days)) + interaction;
}

/** The peak of the light curve (erg/s), found by a coarse search over the first 150 days (cached). */
const peaks = new Map<string, number>();
export function peakLuminosity(e: Explosion): number {
  const key = `${e.type}|${e.subtype}|${e.energy}|${e.ejectaMass}|${e.nickelMass}|${e.progenitorRadius}|${e.envelopeMass}`;
  let peak = peaks.get(key);
  if (peak === undefined) {
    peak = 0;
    // Pair-instability light curves peak after months; failed supernovae glow for a year.
    const span = e.subtype === 'PISN' || e.subtype === 'failed' ? 500 : 150;
    for (let d = 0.5; d < span; d += span / 300) peak = Math.max(peak, luminosity(e, d));
    if (peaks.size > 64) peaks.clear();
    peaks.set(key, peak);
  }
  return peak;
}

/** Absolute bolometric magnitude for a luminosity in erg/s. */
export function bolometricMagnitude(lum: number): number {
  return 4.74 - 2.5 * Math.log10(lum / L_SUN);
}

/**
 * Photosphere temperature (K): hot right after shock breakout, ~6,000 K on a Type II plateau
 * (hydrogen recombines there), ~10,000 K for a Type Ia near peak, cooling into the nebular phase.
 */
export function photosphereTemperature(e: Explosion, days: number): number {
  if (e.type === 'Ia') return days < 20 ? 10000 + 6000 * Math.exp(-days / 6) : Math.max(4000, 10000 - (days - 20) * 60);
  // A failed supernova's slow, cool envelope: a faint red glow.
  if (e.subtype === 'failed') return 3000;
  if (!hasPlateau(e)) {
    // Stripped and pair-instability explosions: hot at first, ~7,000–9,000 K around the peak.
    const tm = diffusionTimeDays(e);
    return days < tm ? 8000 + 12000 * Math.exp(-days / (tm / 4)) : Math.max(4000, 8000 - ((days - tm) * 4000) / (3 * tm));
  }
  const p = plateau(e);
  if (days < 20) return 6000 + 24000 * Math.exp(-days / 3);
  if (days < p.days) return 6000;
  return Math.max(3500, 6000 - (days - p.days) * 30);
}

/** Radius of the blast wave (pc) `years` after the explosion. */
export function remnantRadiusPc(e: Explosion, years: number): number {
  if (years <= 0) return 0;
  const t = years * YEAR;
  const rho = 1.4 * M_H * e.ismDensity;
  const free = (maxEjectaSpeed(e) * 1e5 * t) / PC_CM;
  const sedov = (1.15 * ((e.energy * t * t) / rho) ** 0.2) / PC_CM;
  const r = Math.min(free, sedov);
  const tsf = shellFormationYears(e);
  if (years <= tsf) return r;
  // Radiative, pressure-driven snowplow.
  const rsf = Math.min((maxEjectaSpeed(e) * 1e5 * tsf * YEAR) / PC_CM, (1.15 * ((e.energy * (tsf * YEAR) ** 2) / rho) ** 0.2) / PC_CM);
  return rsf * (years / tsf) ** (2 / 7);
}

/** When the shell turns radiative (years): Cioffi, McKee & Bertschinger 1988. */
export function shellFormationYears(e: Explosion): number {
  return 3.61e4 * (e.energy / 1e51) ** (3 / 14) * e.ismDensity ** (-4 / 7);
}

/** Blast-wave radius in AU and its speed in AU/yr (the units of the simulation). */
export function remnantInAu(e: Explosion, years: number): { radius: number; speed: number } {
  const pcToAu = PC_CM / AU_CM;
  const dt = Math.max(1e-6, years * 1e-3);
  const r = remnantRadiusPc(e, years) * pcToAu;
  const speed = ((remnantRadiusPc(e, years + dt) - remnantRadiusPc(e, Math.max(0, years - dt))) * pcToAu) / (2 * dt);
  return { radius: r, speed };
}

/**
 * Does a body survive? It intercepts its share of the explosion energy, E·πR²/4πd², and is
 * unbound if that exceeds its gravitational binding energy 3GM²/5R. Masses in M☉, lengths in AU.
 */
export function blastOnBody(e: Explosion, distanceAu: number, massMsun: number, radiusAu: number): { energy: number; binding: number; destroyed: boolean; deltaVKms: number } {
  const d = distanceAu * AU_CM, R = radiusAu * AU_CM, M = massMsun * M_SUN_G;
  const share = (R * R) / (4 * d * d);
  const energy = e.energy * share;
  const binding = (3 * G_CGS * M * M) / (5 * R);
  // Momentum carried by the ejecta, √(2 M_ej E), intercepted the same way.
  const momentum = Math.sqrt(2 * e.ejectaMass * M_SUN_G * e.energy) * share;
  return { energy, binding, destroyed: energy > binding, deltaVKms: momentum / M / 1e5 };
}

/** A neutron-star kick (km/s): three Gaussian components with σ = 265 km/s (Hobbs et al. 2005). */
export function neutronStarKick(rand: () => number = Math.random): [number, number, number] {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  return [gauss() * 265, gauss() * 265, gauss() * 265];
}
