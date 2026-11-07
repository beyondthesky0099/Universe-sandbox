/**
 * What a massive star leaves behind, from its initial mass and metallicity: how much of it the
 * winds strip away, what it looks like just before it dies (red, yellow or blue supergiant, or a
 * Wolf–Rayet star), which kind of supernova it makes (or whether it collapses quietly), and the
 * remnant. A simplified map of the published single-star models:
 *
 * - Fates vs. mass and metallicity: Heger, Fryer, Woosley, Langer & Hartmann 2003 (ApJ 591, 288).
 *   Winds scale with metallicity as Ṁ ∝ Z^0.85 (Vink, de Koter & Lamers 2001), so metal-rich stars
 *   lose their hydrogen envelopes above ~25 M☉ and become Wolf–Rayet stars (Type Ib/c), while
 *   metal-poor ones keep them.
 * - Explosion energies, ⁵⁶Ni masses and neutron-star masses for ordinary core collapse: Sukhbold,
 *   Ertl, Woosley, Brown & Janka 2016 (ApJ 821, 38): ~0.5–1.5 × 10⁵¹ erg, 0.01–0.1 M☉ of ⁵⁶Ni,
 *   1.2–2 M☉ neutron stars; above ~40 M☉ (unstripped) most cores collapse to black holes without a
 *   bright supernova (a "failed supernova": the star just loses some of its envelope, a faint red
 *   transient for about a year; Lovegrove & Woosley 2013).
 * - Electron-capture supernovae from ~8–9.5 M☉ stars: ~10⁵⁰ erg, ~0.003 M☉ of ⁵⁶Ni (Kitaura,
 *   Janka & Hillebrandt 2006); the Crab's SN 1054 is the usual example.
 * - Pair instability (helium cores of 64–133 M☉, metallicity below ~1/3 solar): the star is blown
 *   apart entirely, 5–90 × 10⁵¹ erg and up to ~57 M☉ of ⁵⁶Ni (Heger & Woosley 2002); helium cores
 *   of 35–64 M☉ pulse, throw off shells that collide (very bright), then collapse to a black hole.
 * - Broad-lined Type Ic hypernovae (SN 1998bw, with gamma-ray bursts): ~3 × 10⁵² erg, ~0.4 M☉ of ⁵⁶Ni.
 * - Pre-supernova luminosity and colour: red supergiants ~3,500 K and 500–1,000 R☉ (Smartt 2009);
 *   SN 1987A's blue supergiant (~20 M☉ at half solar metallicity) ~16,000 K and ~40 R☉.
 *
 * The real boundaries are fuzzy (rotation, binaries and the explosion mechanism all matter); these
 * are the textbook single-star trends.
 */
import type { Explosion } from './supernovaPhysics';

export type SupernovaKind = 'ECSN' | 'II-P' | 'II-L' | 'IIb' | 'Ib' | 'Ic' | 'Ic-BL' | 'PPISN' | 'PISN' | 'failed';

export interface Progenitor {
  /** What the star looks like when it dies. */
  stage: string;
  temperatureK: number;
  radiusRsun: number;
  luminosityLsun: number;
  /** Mass when it dies (after winds), helium-core mass, and hydrogen envelope left (M☉). */
  finalMass: number;
  heliumCore: number;
  envelope: number;
}

export interface StellarFate {
  kind: SupernovaKind;
  /** e.g. "Type II-P supernova". */
  label: string;
  progenitor: Progenitor;
  explosion: Explosion;
  /** The compact remnant, or none (pair instability leaves nothing). */
  remnant?: { kind: 'neutron' | 'blackhole'; mass: number };
}

const T_SUN = 5772;

/** Helium-core mass (M☉) of a star of initial mass M (fit to Woosley, Heger & Weaver 2002). */
export function heliumCoreMass(mass: number): number {
  return 0.1 * mass ** 1.32;
}

/** Fraction of its mass a star loses to winds over its life, ∝ Z^0.85. */
export function windLossFraction(mass: number, metallicity: number): number {
  return Math.min(0.85, Math.max(0, metallicity) ** 0.85 * 0.012 * Math.max(0, mass - 8));
}

/** Initial mass above which winds strip the whole hydrogen envelope (25 M☉ at solar metallicity). */
export function strippingMass(metallicity: number): number {
  return 25 / Math.max(0.01, metallicity) ** 1.2;
}

const label: Record<SupernovaKind, string> = {
  ECSN: 'electron-capture supernova (Type II-P)',
  'II-P': 'Type II-P supernova',
  'II-L': 'Type II-L supernova',
  IIb: 'Type IIb supernova',
  Ib: 'Type Ib supernova',
  Ic: 'Type Ic supernova',
  'Ic-BL': 'broad-lined Type Ic hypernova',
  PPISN: 'pulsational pair-instability supernova',
  PISN: 'pair-instability supernova',
  failed: 'failed supernova',
};

/** The fate of a star of `mass` M☉ (taken as its initial mass) and `metallicity` (Z / Z☉). */
export function stellarFate(mass: number, metallicity = 1, ismDensity = 1): StellarFate {
  const Z = Math.max(0, metallicity);
  const finalMass = mass * (1 - windLossFraction(mass, Z));
  const heCore = Math.min(heliumCoreMass(mass), finalMass);
  const mStrip = strippingMass(Z);
  let kind: SupernovaKind;
  if (mass < 9.5) kind = 'ECSN';
  else if (Z < 0.35 && heCore >= 64 && heCore <= 133) kind = 'PISN';
  else if (Z < 0.35 && heCore >= 35 && heCore < 64) kind = 'PPISN';
  else if (mass >= mStrip * 2) kind = 'Ic-BL';
  else if (mass >= mStrip * 1.6) kind = 'Ic';
  else if (mass >= mStrip) kind = 'Ib';
  else if (mass >= mStrip * 0.9) kind = 'IIb';
  else if (mass >= 40 || heCore > 133) kind = 'failed';
  else if (mass >= mStrip * 0.75) kind = 'II-L';
  else kind = 'II-P';

  // What's left of the hydrogen envelope.
  const envelope =
    kind === 'Ib' || kind === 'Ic' || kind === 'Ic-BL' ? 0
    : kind === 'IIb' ? 0.3
    : kind === 'II-L' ? Math.min(2, Math.max(0.5, finalMass - heCore))
    : Math.max(0, finalMass - heCore);
  // Stripped stars are just their cores, and Wolf–Rayet winds blow away a further ~third of
  // those (Ic: the helium layer is gone too), leaving the 2–5 M☉ of ejecta seen in Type Ib/c
  // light curves (Lyman et al. 2016).
  const wr = 1 - 0.35 * Math.min(1, Z) ** 0.85;
  const starMass = envelope > 0 ? heCore + envelope : kind === 'Ic' || kind === 'Ic-BL' ? heCore * 0.75 * wr : kind === 'IIb' ? heCore * wr + envelope : heCore * wr;

  // Before it dies: luminosity from the core (log L ≈ 4.6 at 10 M☉ rising with mass), and the
  // surface temperature of its kind of supergiant.
  const luminosityLsun = 10 ** 4.6 * (Math.max(heCore, 1.5) / 2.2) ** 1.3;
  let temperatureK: number;
  let stage: string;
  if (kind === 'Ic' || kind === 'Ic-BL') [temperatureK, stage] = [110000, 'Wolf–Rayet star (WC/WO, carbon and oxygen showing)'];
  else if (kind === 'Ib') [temperatureK, stage] = [60000, 'Wolf–Rayet star (WN, helium showing)'];
  else if (kind === 'IIb') [temperatureK, stage] = [7500, 'yellow supergiant'];
  else if (Z <= 0.6 && mass >= 15 && kind !== 'failed') [temperatureK, stage] = [16000 - 4000 * Math.max(0, Z - 0.3), 'blue supergiant'];
  else [temperatureK, stage] = [3500 + 600 * Math.max(0, 1 - Z), 'red supergiant'];
  const radiusRsun = Math.sqrt(luminosityLsun) * (T_SUN / temperatureK) ** 2;

  // Explosion and remnant.
  const nsMass = Math.min(2, 1.25 + 0.035 * Math.max(0, mass - 9));
  let energy: number, nickelMass: number;
  let remnant: StellarFate['remnant'];
  let interaction: Explosion['interaction'];
  switch (kind) {
    case 'ECSN':
      [energy, nickelMass, remnant] = [1e50, 0.003, { kind: 'neutron', mass: 1.25 }];
      break;
    case 'II-P':
    case 'II-L':
      energy = Math.min(1.6e51, (0.6 + 0.06 * (mass - 9.5)) * 1e51);
      nickelMass = Math.min(0.1, 0.015 + 0.004 * (mass - 9.5));
      // Above ~20 M☉ much of the core falls back onto a black hole.
      remnant = mass >= 20 ? { kind: 'blackhole', mass: Math.max(3, heCore * 0.6) } : { kind: 'neutron', mass: nsMass };
      if (mass >= 20) [energy, nickelMass] = [energy * 0.6, nickelMass * 0.4];
      break;
    case 'IIb':
    case 'Ib':
      [energy, nickelMass, remnant] = [1.2e51, 0.1, mass >= 30 ? { kind: 'blackhole', mass: Math.max(3, heCore * 0.4) } : { kind: 'neutron', mass: nsMass }];
      break;
    case 'Ic':
      [energy, nickelMass, remnant] = [1.5e51, 0.15, { kind: 'blackhole', mass: Math.max(3, heCore * 0.35) }];
      break;
    case 'Ic-BL':
      [energy, nickelMass, remnant] = [3e52, 0.4, { kind: 'blackhole', mass: Math.max(3, heCore * 0.3) }];
      break;
    case 'PPISN': {
      // Pulses throw off shells that collide: bright for months; then the core collapses.
      [energy, nickelMass, remnant] = [1e51, 0, { kind: 'blackhole', mass: Math.min(45, heCore * 0.85) }];
      interaction = { luminosity: 2e43, days: 120 };
      break;
    }
    case 'PISN': {
      const x = (heCore - 64) / (133 - 64);
      [energy, nickelMass, remnant] = [(5 + 85 * x) * 1e51, 57 * x * x, undefined];
      break;
    }
    case 'failed':
      // The core collapses straight into a black hole; neutrino losses unbind only a little of the envelope.
      [energy, nickelMass, remnant] = [5e47, 0, { kind: 'blackhole', mass: Math.max(3, finalMass - 0.5) }];
      break;
  }
  const ejectaMass = kind === 'failed' ? Math.min(0.5, Math.max(0.05, envelope)) : Math.max(0.3, starMass - (remnant?.mass ?? 0));
  const explosion: Explosion = {
    type: 'II',
    subtype: kind,
    energy,
    ejectaMass,
    nickelMass: Math.min(nickelMass, ejectaMass * 0.9),
    progenitorRadius: radiusRsun,
    envelopeMass: kind === 'failed' ? ejectaMass : Math.min(envelope, ejectaMass),
    ismDensity,
    ...(interaction ? { interaction } : {}),
  };
  return {
    kind,
    label: label[kind],
    progenitor: { stage, temperatureK, radiusRsun, luminosityLsun, finalMass: starMass, heliumCore: heCore, envelope },
    explosion,
    remnant,
  };
}

/**
 * A Type Ia supernova from a white dwarf of the given metallicity: more neutron-rich fuel (more
 * metals) makes less ⁵⁶Ni, M_Ni ∝ 1 − 0.057 Z/Z☉ (Timmes, Brown & Truran 2003).
 */
export function typeIaNickel(metallicity = 1): number {
  return 0.6 * (1 - 0.057 * Math.max(0, metallicity));
}

/** One line about the star and how it dies, for the body panel. */
export function describeFate(f: StellarFate): string {
  const p = f.progenitor;
  const r = p.radiusRsun >= 10 ? Math.round(p.radiusRsun).toLocaleString('en-US') : p.radiusRsun.toFixed(1);
  const end = f.remnant ? `leaving a ${f.remnant.mass.toFixed(1)} M☉ ${f.remnant.kind === 'neutron' ? 'neutron star' : 'black hole'}` : 'leaving nothing behind';
  return `Dies as a ${p.stage} (${Math.round(p.temperatureK).toLocaleString('en-US')} K, ${r} R☉) in a ${f.label}, ${end}.`;
}
