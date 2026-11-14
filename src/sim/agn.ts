/**
 * Active galactic nuclei up close (headless): what the scene around a feeding supermassive
 * black hole should be, from a Universe-view entry (src/sim/galaxies.ts).
 *
 * - The black hole: the measured mass where a paper has one (LocalGalaxy.bh), else one that
 *   would radiate the catalogued luminosity at a typical Eddington ratio.
 * - The luminosity: from the V magnitude and distance, λL_λ(5100 Å) ≈ 2.9 × 10³³ erg/s ×
 *   10^(−0.4 (M_V − 4.83)) and L_bol ≈ 9 λL_λ (Kaspi et al. 2000).
 * - The broad-line region: R_BLR ≈ 34 light-days × (λL_λ / 10⁴⁴)^0.53 (Bentz et al. 2013).
 * - The dusty torus: dust sublimates inside R_sub ≈ 0.4 pc × (L_bol / 10⁴⁵)^½ (Nenkova et al.
 *   2008); drawn out to five times that.
 * - The viewing angle follows the unified model: a blazar is a jet seen nearly head-on, a type 1
 *   nucleus is seen past the torus, a type 2 through it.
 *
 * The sizes are to scale with each other (a 10⁸ M☉ hole is 2 AU across, its torus half a
 * parsec): zooming in from the torus to the disc is a journey of ten thousand to one.
 */
import type { AgnClass, LocalGalaxy } from './galaxies';

export const AU_PER_PC = 206264.8;
/** Tilt (rad, about x) that BodyVisual gives every black hole's disc; the torus, jets and clouds share it. */
export const DISC_TILT = 0.25;
export const AU_PER_LIGHT_DAY = 173.14;
/** Eddington luminosity per solar mass (erg/s). */
export const L_EDDINGTON_PER_MSUN = 1.26e38;
const L_SUN_V = 2.9e33; // λL_λ of the Sun at 5500 Å, erg/s

export type AgnType = 'quasar' | 'seyfert1' | 'seyfert2' | 'liner' | 'blazar' | 'radio';

export interface AgnParams {
  name: string;
  type: AgnType;
  /** Black-hole mass (M☉) and whether a paper measured it. */
  mass: number;
  massMeasured: boolean;
  massRef?: string;
  /** Bolometric luminosity (erg/s), its Eddington ratio, and whether a magnitude gave it. */
  lbol: number;
  eddington: number;
  luminosityMeasured: boolean;
  /** Dimensionless spin. */
  spin: number;
  /** Schwarzschild radius, broad-line region radius, torus inner and outer radii, drawn jet length (AU). */
  rsAu: number;
  blrAu: number;
  torusInnerAu: number;
  torusOuterAu: number;
  jetLengthAu: number;
  /** Jet speed as a fraction of c, and whether the source is radio-loud. */
  jetBeta: number;
  radioLoud: boolean;
  /** Half-opening angle of the torus's clear cone (rad). */
  torusOpening: number;
  /** Angle between the spin axis and the line of sight for the default view (rad). */
  viewAngle: number;
}

const ASSUMED_EDDINGTON: Record<AgnType, number> = { quasar: 0.1, blazar: 0.05, seyfert1: 0.05, seyfert2: 0.03, liner: 0.001, radio: 0.005 };

/** The unified-model type of a Véron class and spectrum code. */
export function agnType(cl: AgnClass | undefined, sp: string | undefined, radio?: number): AgnType {
  const code = (sp ?? '').trim();
  if (cl === 'B') return code === '?' || code === 'BL?' ? 'radio' : 'blazar';
  if (code.startsWith('S3')) return 'liner';
  if (code === 'S2' || code === 'S2?' || code === 'S1h' || code === 'S1.9' || code === 'S1.8' || code === 'Q2') return 'seyfert2';
  if (cl === 'Q') return code === 'HP' ? 'blazar' : 'quasar';
  if (code.startsWith('S1') || code === 'S' || code === 'S?' || code === '') return (radio ?? 0) >= 1 && cl !== 'A' ? 'radio' : 'seyfert1';
  return 'seyfert1';
}

/** Angle between the axis and our line of sight that the unified model gives each type (rad). */
export function viewAngleFor(type: AgnType, sp = ''): number {
  const code = sp.trim();
  switch (type) {
    case 'blazar':
      // Real blazar jets point within about 10° of us; a little more keeps the camera out of the jet.
      return (12 * Math.PI) / 180;
    case 'quasar':
      return (30 * Math.PI) / 180;
    case 'seyfert1':
      return (code === 'S1.5' ? 50 : 38) * (Math.PI / 180);
    case 'seyfert2':
      return (code === 'S1.8' || code === 'S1.9' ? 62 : 78) * (Math.PI / 180);
    case 'liner':
      // LINERs are mostly unobscured; M87's jet, for one, is only about 17° from our line of sight.
      return (35 * Math.PI) / 180;
    case 'radio':
      return (65 * Math.PI) / 180;
  }
}

/** λL_λ(5100 Å) in erg/s from an apparent V magnitude at d Mpc (no K-correction). */
export function opticalLuminosity(vmag: number, dMpc: number): number {
  const mv = vmag - 5 * Math.log10((dMpc * 1e6) / 10);
  return L_SUN_V * Math.pow(10, -0.4 * (mv - 4.83));
}

/** What the scene needs, from a Universe-view entry. `name` is what the body is called. */
export function agnParams(g: Pick<LocalGalaxy, 'name' | 'kind' | 'cl' | 'sp' | 'vmag' | 'radio' | 'agn' | 'bh' | 'd' | 'z'>, name = g.name): AgnParams {
  const cl = g.cl ?? g.agn?.cl;
  const sp = g.sp ?? g.agn?.sp ?? '';
  const radio = g.radio ?? g.agn?.radio;
  const type = agnType(cl, sp, radio);
  const vmag = g.vmag ?? g.agn?.vmag;
  // Luminosity from the magnitude, else typical for the type; obscured nuclei are brighter than they look.
  const lopt = vmag !== undefined && g.d > 0 ? opticalLuminosity(vmag, g.d) * (type === 'seyfert2' ? 5 : 1) : undefined;
  let lbol = lopt !== undefined ? 9 * lopt : type === 'quasar' || type === 'blazar' ? 1e46 : type === 'liner' ? 3e42 : 1e44;
  let mass: number;
  if (g.bh) mass = g.bh.mass;
  else {
    // A black hole that radiates this much at the type's usual Eddington ratio, to one significant figure.
    const m = lbol / (ASSUMED_EDDINGTON[type] * L_EDDINGTON_PER_MSUN);
    const e = Math.pow(10, Math.floor(Math.log10(m)));
    mass = Math.min(3e10, Math.max(1e6, Math.round(m / e) * e));
  }
  // Nothing shines past its Eddington limit for long, and a LINER is a starved hole.
  lbol = Math.min(lbol, 1 * L_EDDINGTON_PER_MSUN * mass);
  const eddington = lbol / (L_EDDINGTON_PER_MSUN * mass);
  const blrAu = 34 * AU_PER_LIGHT_DAY * Math.pow(lbol / 9 / 1e44, 0.53);
  const torusInnerAu = 0.4 * AU_PER_PC * Math.sqrt(lbol / 1e45);
  const radioLoud = type === 'blazar' || type === 'radio' || (radio ?? 0) >= 1;
  return {
    name,
    type,
    mass,
    massMeasured: !!g.bh,
    massRef: g.bh?.ref,
    lbol,
    eddington,
    luminosityMeasured: lopt !== undefined,
    spin: 0.9,
    rsAu: 1.97e-8 * mass,
    blrAu,
    torusInnerAu,
    torusOuterAu: torusInnerAu * 5,
    // Drawn to a few torus radii (real jets run on for thousands of light-years), short of the camera's start.
    jetLengthAu: torusInnerAu * (radioLoud ? 9 : 5),
    jetBeta: radioLoud ? 0.98 : 0.3,
    radioLoud,
    torusOpening: (45 * Math.PI) / 180,
    viewAngle: viewAngleFor(type, sp),
  };
}

const registry = new Map<string, AgnParams>();
/** Register a scene's nucleus so the renderer (by body name) can draw its torus and jets. */
export function rememberAgn(p: AgnParams): void {
  registry.set(p.name, p);
}
export function agnFor(name: string): AgnParams | undefined {
  return registry.get(name);
}

const TYPE_WORDS: Record<AgnType, string> = {
  quasar: 'a quasar',
  seyfert1: 'a Seyfert 1 nucleus',
  seyfert2: 'a Seyfert 2 nucleus',
  liner: 'a LINER (a starved nucleus)',
  blazar: 'a blazar',
  radio: 'a radio galaxy',
};

export function formatMass(mass: number): string {
  if (mass >= 1e9) return `${+(mass / 1e9).toPrecision(2)} billion`;
  return `${+(mass / 1e6).toPrecision(2)} million`;
}

/** A paragraph for the scene tip. */
export function describeAgn(p: AgnParams): string {
  const view =
    p.type === 'blazar'
      ? 'We look almost straight down the jet, which is beamed towards us at nearly the speed of light and outshines everything else.'
      : p.type === 'seyfert2'
        ? 'We look in through the dusty torus, which hides the disc and the broad-line clouds: only scattered light and the far gas show.'
        : p.type === 'radio'
          ? 'The jets run across our line of sight; neither is beamed at us.'
          : 'We look in past the torus, straight at the disc and the fast clouds around it.';
  const pcTorus = p.torusInnerAu / AU_PER_PC;
  const scale = `The black hole, ${formatMass(p.mass)} M☉, is ${p.rsAu < 1 ? `${(p.rsAu * 1.496e8).toLocaleString('en-US', { maximumFractionDigits: 0 })} km` : `${+p.rsAu.toPrecision(2)} AU`} across; its broad-line clouds orbit about ${(p.blrAu / AU_PER_LIGHT_DAY).toPrecision(2)} light-days out and the dust torus begins ${pcTorus < 0.1 ? `${(pcTorus * 3.26 * 365).toPrecision(2)} light-days` : `${+pcTorus.toPrecision(2)} parsec${pcTorus >= 1.5 ? 's' : ''}`} out, all to scale: zoom in ten thousand times to reach the disc.`;
  const assumed = [p.massMeasured ? '' : 'the black-hole mass', p.luminosityMeasured ? '' : 'the luminosity'].filter(Boolean);
  const notes = `${assumed.length ? `Not measured, so typical values are used for ${assumed.join(' and ')}. ` : ''}The torus's shape, the stars of the nuclear cluster and the jets' length are illustrative; real jets reach thousands of light-years.`;
  return `${p.name} as ${TYPE_WORDS[p.type]}: a supermassive black hole shining at ${+(p.eddington * 100).toPrecision(2)}% of its Eddington limit (${p.lbol.toExponential(1).replace('e+', ' × 10^')} erg/s). ${view} ${scale} ${notes}`;
}
