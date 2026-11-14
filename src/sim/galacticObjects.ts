/**
 * The Milky Way's X-ray binaries, Wolf–Rayet stars, novae, cataclysmic variables, Cepheids and
 * masers (scripts/build-galactic-objects.mjs): every catalogued one with a measured distance, for
 * the Galaxy Map.
 *
 * - High-mass X-ray binaries (Fortin et al. 2023): a neutron star or black hole feeding on the
 *   wind of a massive O/B companion.
 * - Low-mass X-ray binaries (Fortin et al. 2024): a neutron star or black hole drawing a stream
 *   of gas from a Sun-like or smaller star that fills its Roche lobe.
 * - Wolf–Rayet stars (van der Hucht 2001): massive stars that have blown off their hydrogen,
 *   with winds of thousands of km/s, a few hundred thousand years from exploding.
 * - Novae (Schaefer 2022): white dwarfs whose stolen hydrogen detonated on their surface, every
 *   known Galactic one, with its best distance.
 * - Cataclysmic variables (Canbay et al. 2023, Ritter & Kolb): white dwarfs feeding from a close
 *   companion, with Gaia DR3 distances.
 * - Classical Cepheids (Skowron et al. 2019): pulsating yellow supergiants whose period gives
 *   their luminosity, and so their distance.
 * - Masers (Reid et al. 2019): water and methanol masers around massive protostars, with VLBI
 *   parallaxes, the most precise distances across the Galaxy.
 */

export type GalacticObjectKind = 'hmxb' | 'lmxb' | 'wr' | 'nova' | 'cv' | 'cep' | 'maser';

export interface XrayBinary {
  name: string;
  /** Galactic coordinates (degrees) and distance (kpc). */
  l: number;
  b: number;
  d: number;
  /** The compact object: black hole, neutron star, or not yet known. */
  compact: 'BH' | 'NS' | '?';
  /** A candidate system rather than a confirmed one (LMXBs). */
  candidate?: boolean;
  /** Spectral type of the companion (LMXBs). */
  sptype?: string;
  /** Masses (M☉) of the compact object and companion, orbital period (days), eccentricity, spin (s). */
  mx?: number;
  mo?: number;
  per?: number;
  ecc?: number;
  spin?: number;
  /** Shows thermonuclear bursts on a neutron star's surface. */
  bursts?: boolean;
  /** Host globular cluster. */
  gc?: string;
}

export interface WolfRayet {
  wr: string;
  name: string;
  l: number;
  b: number;
  d: number;
  sptype: string;
  /** Terminal wind speed (km/s) and magnitude. */
  vinf?: number;
  vmag?: number;
}

/** What Ritter & Kolb say a cataclysmic binary is (their type codes). */
export const CV_TYPES: Record<string, string> = {
  DN: 'dwarf nova',
  NL: 'nova-like variable',
  Na: 'fast nova',
  Nb: 'slow nova',
  Nc: 'very slow nova',
  Nr: 'recurrent nova',
  N: 'nova',
  AC: 'AM CVn star',
  SS: 'supersoft X-ray source',
  VY: 'VY Scl star',
  UX: 'UX UMa star',
  SU: 'SU UMa star',
  UG: 'U Gem star',
  ZC: 'Z Cam star',
  WZ: 'WZ Sge star',
  AM: 'polar',
  IP: 'intermediate polar',
  DQ: 'DQ Her star',
  SW: 'SW Sex star',
  ER: 'ER UMa star',
  CV: 'cataclysmic variable',
  CP: 'coherent pulsator',
  GC: 'in a globular cluster',
  CB: 'cataclysmic binary',
  LA: 'low-accretion-rate polar',
  NP: 'non-magnetic',
};

/** Shared by novae and other cataclysmic variables: the white dwarf, its donor and their orbit. */
export interface WhiteDwarfBinary {
  name: string;
  l: number;
  b: number;
  d: number;
  /** Orbital period (days). */
  per?: number;
  /** Ritter & Kolb type codes (CV_TYPES), white-dwarf and donor masses (M☉), donor spectral type, inclination (°). */
  types?: string[];
  m1?: number;
  m2?: number;
  sptype2?: string;
  eclipsing?: boolean;
  incl?: number;
}

export interface Nova extends WhiteDwarfBinary {
  /** Distance range (kpc), year of the eruption (recurrent novae have several). */
  dlo?: number;
  dhi?: number;
  year?: number;
  recurrent?: boolean;
  /** Strope et al. light-curve class: S smooth, P plateau, D dust dip, C cusp, O oscillations, F flat top, J jitter. */
  lc?: string;
  /** Days to fade three magnitudes from peak; peak apparent and absolute V magnitudes. */
  t3?: number;
  vpeak?: number;
  vmag?: number;
  /** Spectral class (Fe II, He/N, hybrid; Ne for neon novae) and ejecta speed (km/s). */
  sptype?: string;
  fwhm?: number;
  pop?: 'disc' | 'bulge' | 'cluster';
  ebv?: number;
  /** The distance rests on a good Gaia parallax. */
  gaia?: boolean;
  /** Schaefer's property flags (RG red-giant donor, SubG subgiant donor, Ecl eclipsing, Sh shell…). */
  prop?: string;
}

export interface CataclysmicVariable extends WhiteDwarfBinary {
  /** A magnetic white dwarf (polar or intermediate polar). */
  magnetic?: boolean;
  gmag?: number;
}

export interface Cepheid {
  name: string;
  common?: string;
  l: number;
  b: number;
  d: number;
  ed?: number;
  /** Where the distance comes from when it is not Skowron et al. */
  dsrc?: string;
  /** Pulsation period (days) and mode: fundamental or first overtone. */
  per: number;
  mode: 'F' | '1O';
  /** Age (Myr) from the period–age relation; extinction in Ks. */
  age?: number;
  aks?: number;
  survey: string;
}

export interface Maser {
  name: string;
  gname: string;
  l: number;
  b: number;
  d: number;
  ed?: number;
  /** Radial velocity relative to the local standard of rest (km/s) and spiral arm code (ARMS). */
  vlsr?: number;
  arm?: string;
  /** An evolved red supergiant's masers rather than a star-forming region's. */
  evolved?: boolean;
}

/** Reid et al.'s spiral arm codes. */
export const ARMS: Record<string, string> = {
  '3kN': 'the near 3-kpc arm',
  '3kF': 'the far 3-kpc arm',
  Nor: 'the Norma arm',
  ScN: 'the Scutum arm (near side)',
  ScF: 'the Scutum arm (far side)',
  SgN: 'the Sagittarius arm (near side)',
  SgF: 'the Sagittarius arm (far side)',
  Loc: 'the Local arm',
  Per: 'the Perseus arm',
  Out: 'the Outer arm',
  CtN: 'the Centaurus arm (near side)',
  CtF: 'the Centaurus arm (far side)',
  CrN: 'the Carina arm (near side)',
  CrF: 'the Carina arm (far side)',
  AqS: 'the Aquila spur',
  LoS: 'the Local spur',
  OSC: 'the Outer Scutum–Centaurus arm',
  Con: 'the Connecting arm',
  GC: 'the Galactic Centre region',
  AqR: 'the Aquila Rift',
};

export interface GalacticObjects {
  hmxb: XrayBinary[];
  lmxb: XrayBinary[];
  wr: WolfRayet[];
  nova: Nova[];
  cv: CataclysmicVariable[];
  cep: Cepheid[];
  maser: Maser[];
}

/** One map entry of any kind, in the order of the Galaxy Map's object list. */
export type GalacticObject =
  | ({ kind: 'hmxb' | 'lmxb' } & XrayBinary)
  | ({ kind: 'wr' } & WolfRayet)
  | ({ kind: 'nova' } & Nova)
  | ({ kind: 'cv' } & CataclysmicVariable)
  | ({ kind: 'cep' } & Cepheid)
  | ({ kind: 'maser' } & Maser);

export function flattenObjects(data: GalacticObjects): GalacticObject[] {
  return [
    ...data.hmxb.map((o) => ({ kind: 'hmxb' as const, ...o })),
    ...data.lmxb.map((o) => ({ kind: 'lmxb' as const, ...o })),
    ...data.wr.map((o) => ({ kind: 'wr' as const, ...o })),
    ...(data.nova ?? []).map((o) => ({ kind: 'nova' as const, ...o })),
    ...(data.cv ?? []).map((o) => ({ kind: 'cv' as const, ...o })),
    ...(data.cep ?? []).map((o) => ({ kind: 'cep' as const, ...o })),
    ...(data.maser ?? []).map((o) => ({ kind: 'maser' as const, ...o })),
  ];
}

let promise: Promise<GalacticObject[]> | undefined;
export function loadGalacticObjects(baseUrl = import.meta.env.BASE_URL): Promise<GalacticObject[]> {
  promise ??= fetch(`${baseUrl}data/galactic-objects.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`galactic-objects.json: HTTP ${r.status}`);
      return r.json() as Promise<GalacticObjects>;
    })
    .then(flattenObjects);
  return promise;
}

/** Default masses when the catalogue has none: neutron stars 1.4 M☉, black holes 8 M☉, donors by class. */
export function xrayMasses(o: XrayBinary & { kind: 'hmxb' | 'lmxb' }): { compact: number; companion: number; isBlackHole: boolean } {
  const isBlackHole = o.compact === 'BH';
  const compact = o.mx && o.mx > 0 ? o.mx : isBlackHole ? 8 : 1.4;
  const companion = o.mo && o.mo > 0 ? o.mo : o.kind === 'hmxb' ? 18 : 0.5;
  return { compact, companion, isBlackHole };
}

/** The orbital period to show (days): the catalogue's, else a typical one for the class. */
export function xrayPeriodDays(o: XrayBinary & { kind: 'hmxb' | 'lmxb' }): { days: number; assumed: boolean } {
  if (o.per && o.per > 0) return { days: o.per, assumed: false };
  return { days: o.kind === 'hmxb' ? 10 : 0.4, assumed: true };
}

export function formatPeriod(days: number): string {
  if (days < 1 / 24) return `${(days * 1440).toPrecision(3)} minutes`;
  if (days < 2) return `${(days * 24).toPrecision(3)} hours`;
  if (days < 1000) return `${days.toPrecision(3)} days`;
  return `${(days / 365.25).toPrecision(3)} years`;
}

/**
 * The white dwarf and donor masses of a nova or cataclysmic variable: the catalogue's where it
 * has them, else typical ones. Recurrent novae need a white dwarf near the Chandrasekhar limit;
 * a short-period donor follows the Knigge et al. (2011) donor sequence, M₂ ≈ 0.065 P(h)^1.25 M☉,
 * and a giant donor (periods of months) is about 0.8 M☉.
 */
export function whiteDwarfMasses(o: WhiteDwarfBinary & ({ kind: 'nova' } & Nova | { kind: 'cv' } & CataclysmicVariable)): { wd: number; donor: number; donorKind: 'star' | 'giant' | 'whitedwarf'; assumed: string[] } {
  const assumed: string[] = [];
  const recurrent = o.kind === 'nova' && !!o.recurrent;
  const heliumDonor = !!o.types?.includes('AC');
  const period = o.per ?? 0;
  const giant = (o.kind === 'nova' && /\bRG\b/.test(o.prop ?? '')) || period > 30 || /III|II\b/.test(o.sptype2 ?? '');
  let wd = o.m1 && o.m1 > 0 ? o.m1 : recurrent ? 1.35 : 0.8;
  if (!(o.m1 && o.m1 > 0)) assumed.push('the white dwarf mass');
  // A white dwarf cannot exceed the Chandrasekhar mass.
  wd = Math.min(wd, 1.38);
  let donor: number;
  if (o.m2 && o.m2 > 0) donor = o.m2;
  else {
    assumed.push('the donor mass');
    donor = heliumDonor ? 0.03 : giant ? 0.8 : period > 0 ? Math.min(1.2, Math.max(0.06, 0.065 * Math.pow(period * 24, 1.25))) : 0.3;
  }
  return { wd, donor, donorKind: heliumDonor ? 'whitedwarf' : giant ? 'giant' : 'star', assumed };
}

/** The orbital period (days) to show for a white-dwarf binary: the catalogue's, else a typical 4 hours. */
export function whiteDwarfPeriodDays(o: WhiteDwarfBinary): { days: number; assumed: boolean } {
  if (o.per && o.per > 0) return { days: o.per, assumed: false };
  return { days: 4 / 24, assumed: true };
}

/** A nova's speed class from t₃, the days it took to fade three magnitudes (Payne-Gaposchkin). */
export function novaSpeedClass(t3: number): string {
  return t3 < 10 ? 'very fast' : t3 <= 25 ? 'fast' : t3 <= 80 ? 'moderately fast' : t3 <= 150 ? 'slow' : 'very slow';
}

const LIGHT_CURVE_CLASSES: Record<string, string> = {
  S: 'a smooth decline',
  P: 'a plateau in its decline',
  PP: 'a plateau in its decline',
  D: 'a dip when dust condensed in the ejecta',
  C: 'a cusp-shaped second peak',
  O: 'oscillations on the way down',
  F: 'a flat top',
  J: 'jittering flares on the way down',
};

/** The subtypes of a cataclysmic variable in words, most telling first ("polar, nova-like variable"). */
export function cvTypeLabel(o: WhiteDwarfBinary & { magnetic?: boolean }): string {
  const order = ['AM', 'IP', 'AC', 'SS', 'DQ', 'DN', 'NL', 'WZ', 'SU', 'ER', 'ZC', 'UG', 'VY', 'SW', 'UX', 'LA', 'CP', 'Nr', 'Na', 'Nb', 'Nc', 'N', 'CV', 'CB'];
  const codes = [...(o.types ?? [])].filter((c) => CV_TYPES[c] && c !== 'GC' && c !== 'NP').sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!codes.length) return o.magnetic ? 'magnetic cataclysmic variable' : 'cataclysmic variable';
  return codes.slice(0, 2).map((c) => CV_TYPES[c]).join(', ');
}

/**
 * The luminosity (L☉) of a classical Cepheid from its period: the V-band period–luminosity
 * relation of Benedict et al. (2007), M_V = −2.43 (log P − 1) − 4.05. A first-overtone period is
 * first converted to the fundamental (P_F ≈ P_1O / 0.716).
 */
export function cepheidLuminosity(periodDays: number, mode: 'F' | '1O' = 'F'): number {
  const p = mode === '1O' ? periodDays / 0.716 : periodDays;
  const mv = -2.43 * (Math.log10(p) - 1) - 4.05;
  return Math.pow(10, (4.83 - mv) / 2.5);
}

/** A Cepheid's radius (R☉) from its period (Gieren et al. 1998 period–radius relation). */
export function cepheidRadius(periodDays: number, mode: 'F' | '1O' = 'F'): number {
  const p = mode === '1O' ? periodDays / 0.716 : periodDays;
  return Math.pow(10, 1.1 + 0.75 * Math.log10(p));
}

/**
 * A Cepheid's mass (M☉): the star whose main-sequence life just ended at the catalogue age
 * (the inverse of the sandbox's own lifetime law, t = 10 Gyr · M^−2.5), else from the period
 * (Anderson et al. 2016 period–age relation). Between 3 and 20 M☉.
 */
export function cepheidMass(o: Pick<Cepheid, 'age' | 'per' | 'mode'>): number {
  const p = o.mode === '1O' ? o.per / 0.716 : o.per;
  const ageYears = o.age && o.age > 0 ? o.age * 1e6 : Math.pow(10, 8.49 - 0.79 * Math.log10(p));
  return Math.min(20, Math.max(3, Math.pow(1e10 / ageYears, 0.4)));
}

/** A readable, one-line kind: "black-hole X-ray binary", "Wolf–Rayet star (WC9)", "recurrent nova". */
export function objectKindLabel(o: GalacticObject): string {
  if (o.kind === 'wr') return `Wolf–Rayet star (${o.sptype.split('+')[0]})`;
  if (o.kind === 'nova') return o.recurrent ? 'recurrent nova' : `classical nova${o.year ? ` of ${Math.floor(o.year)}` : ''}`;
  if (o.kind === 'cv') return cvTypeLabel(o);
  if (o.kind === 'cep') return `classical Cepheid (${o.mode === '1O' ? 'first overtone' : 'fundamental mode'})`;
  if (o.kind === 'maser') return o.evolved ? 'maser around a red supergiant' : 'maser in a star-forming region';
  const what = o.compact === 'BH' ? 'black-hole' : o.compact === 'NS' ? 'neutron-star' : '';
  const mass = o.kind === 'hmxb' ? 'high-mass' : 'low-mass';
  return `${what ? `${what} ` : ''}${mass} X-ray binary${o.candidate ? ' (candidate)' : ''}`;
}

function describeWhiteDwarfBinary(o: ({ kind: 'nova' } & Nova) | ({ kind: 'cv' } & CataclysmicVariable)): string {
  const { wd, donor, donorKind } = whiteDwarfMasses(o);
  const period = whiteDwarfPeriodDays(o);
  const orbit = period.assumed ? '' : ` every ${formatPeriod(period.days)}`;
  const donorWords = donorKind === 'whitedwarf' ? 'a helium white dwarf' : donorKind === 'giant' ? 'a red giant' : donor < 0.2 ? 'a tiny red dwarf' : donor < 0.6 ? 'a red dwarf' : donor < 1.2 ? 'a Sun-like star' : 'a star';
  const wdWords = `${wd >= 1.2 ? 'heavy ' : ''}white dwarf${o.m1 ? ` of ${wd.toFixed(2)} M☉` : ''}`;
  if (o.kind === 'nova') {
    const speed = o.t3 ? `${novaSpeedClass(o.t3)}, fading three magnitudes in ${o.t3} days` : '';
    const peak = o.vpeak !== undefined ? `It reached magnitude ${o.vpeak.toFixed(1)}${o.vmag !== undefined ? ` (absolute ${o.vmag.toFixed(1)})` : ''}${speed ? `: ${speed}` : ''}.` : speed ? `It was ${speed}.` : '';
    const neon = /Ne/.test(o.sptype ?? '') ? ' Neon in the ejecta shows the white dwarf is a heavy oxygen–neon one.' : '';
    const curve = o.lc && LIGHT_CURVE_CLASSES[o.lc] ? ` Its light curve showed ${LIGHT_CURVE_CLASSES[o.lc]}.` : '';
    const where = o.pop === 'bulge' ? ' It belongs to the Galactic bulge.' : o.pop === 'cluster' ? ` It erupted inside a globular cluster${/in-(\S+)/.test(o.prop ?? '') ? ` (${o.prop!.match(/in-(\S+)/)![1]})` : ''}.` : '';
    if (o.recurrent) {
      return `A recurrent nova: a ${wdWords} near the Chandrasekhar limit pulls gas from ${donorWords}${orbit}, and the hydrogen it collects detonates on its surface every few decades. ${peak}${curve}${where}`.trim();
    }
    return `A classical nova${o.year ? ` that erupted in ${Math.floor(o.year)}` : ''}: hydrogen stolen from ${donorWords}${orbit} piled up on a ${wdWords} until it detonated in a thermonuclear flash. ${peak}${neon}${curve}${where}`.trim();
  }
  const codes = o.types ?? [];
  const has = (c: string) => codes.includes(c);
  const base = `a ${wdWords} pulling a stream of gas from ${donorWords}${o.sptype2 ? ` (${o.sptype2.split('/')[0]})` : ''}${orbit}`;
  let what: string;
  if (has('AM')) what = `A polar: ${base}. The dwarf's magnetic field, tens of millions of gauss, stops a disc from forming and funnels the gas onto its magnetic poles, locking its spin to the orbit.`;
  else if (has('IP')) what = `An intermediate polar: ${base}. The magnetic white dwarf spins faster than the orbit and swallows the inner disc, lighting up at its spin period in X-rays.`;
  else if (has('AC')) what = `An AM CVn star: ${base.replace('a stream of gas', 'helium')}. Two white dwarfs in an orbit under an hour long, a strong source of gravitational waves.`;
  else if (has('SS')) what = `A supersoft X-ray source: ${base}. The gas arrives fast enough to burn steadily on the dwarf's surface, which glows at hundreds of thousands of degrees.`;
  else if (has('DN') || has('SU') || has('UG') || has('ZC') || has('WZ') || has('ER')) {
    const flavour = has('WZ') ? ' Its outbursts are rare, years apart, but huge.' : has('SU') ? ' Occasional superoutbursts last longer and show superhumps from the disc\u2019s precession.' : has('ZC') ? ' Sometimes it sticks halfway down in a standstill.' : '';
    what = `A dwarf nova: ${base}. Every few weeks the disc flips to a hot, viscous state and brightens by several magnitudes for a few days.${flavour}`;
  } else if (has('NL') || has('UX') || has('SW') || has('VY')) what = `A nova-like variable: ${base}. Its disc stays in the bright, hot state${has('VY') ? ', except for occasional low states when the flow nearly stops' : ''}.`;
  else what = `A cataclysmic variable: ${base}.${o.magnetic ? ' Its white dwarf is magnetic.' : ''}`;
  const eclipses = o.eclipsing ? ' We see it edge-on enough that the donor eclipses the dwarf and its disc each orbit.' : '';
  return `${what}${eclipses}`;
}

/** A sentence for the panel and the search index. */
export function describeObject(o: GalacticObject): string {
  if (o.kind === 'nova' || o.kind === 'cv') return describeWhiteDwarfBinary(o);
  if (o.kind === 'cep') {
    const lum = cepheidLuminosity(o.per, o.mode);
    const mass = cepheidMass(o);
    const age = o.age ? ` It is about ${o.age} million years old` : '';
    const mode = o.mode === '1O' ? ' in its first overtone' : '';
    return `A classical Cepheid${o.common ? ` (${o.common})` : ''}: a yellow supergiant of about ${mass.toFixed(0)} M☉ that swells and shrinks every ${formatPeriod(o.per)}${mode}, brightening and fading by about a magnitude. Its period gives its luminosity, ${Math.round(lum).toLocaleString('en-US')} Suns, and so its distance.${age ? `${age}.` : ''}`;
  }
  if (o.kind === 'maser') {
    const where = o.arm && ARMS[o.arm] ? ` in ${ARMS[o.arm]}` : '';
    const speed = o.vlsr !== undefined ? ` It moves at ${o.vlsr > 0 ? '+' : ''}${o.vlsr} km/s along our line of sight (relative to the local standard of rest).` : '';
    if (o.evolved) return `Water and silicon-monoxide masers, natural microwave lasers, in the thick wind of a red supergiant${where}. Radio telescopes across continents timed their parallax, fixing the distance to ${o.ed && o.d ? `${Math.round((100 * o.ed) / o.d)}%` : 'a few percent'}.${speed}`;
    return `Methanol and water masers, natural microwave lasers, in the shocked gas around a massive protostar${where}. Radio telescopes across continents timed their parallax, fixing the distance to ${o.ed && o.d ? `${Math.round((100 * o.ed) / o.d)}%` : 'a few percent'}: these masers trace the Galaxy's spiral arms.${speed}`;
  }
  if (o.kind === 'wr') {
    const wind = o.vinf ? ` Its wind blows at ${o.vinf.toLocaleString('en-US')} km/s.` : '';
    const sub = o.sptype.startsWith('WC') ? 'carbon-rich' : o.sptype.startsWith('WO') ? 'oxygen-rich' : 'nitrogen-rich';
    return `A massive star that has shed its hydrogen, showing its ${sub} interior; it will explode within a few hundred thousand years.${wind}`;
  }
  const { compact, companion, isBlackHole } = xrayMasses(o);
  const period = xrayPeriodDays(o);
  const eater = o.compact === '?' ? 'A compact star' : isBlackHole ? `A ${compact % 1 ? compact.toFixed(1) : compact} M☉ black hole` : 'A neutron star';
  const donor = o.kind === 'hmxb' ? `a ${Math.round(companion)} M☉ ${companion > 12 ? 'supergiant' : 'blue star'}` : `a ${companion < 0.3 ? 'tiny' : companion < 1.5 ? 'Sun-like' : 'evolved'} star${o.sptype ? ` (${o.sptype})` : ''}`;
  const how = o.kind === 'hmxb' ? 'feeding on the wind of' : 'pulling a stream of gas from';
  const orbit = period.assumed ? '' : ` every ${formatPeriod(period.days)}`;
  const extras = [o.spin ? `it spins every ${o.spin < 1 ? `${(o.spin * 1000).toPrecision(3)} ms` : `${o.spin.toPrecision(3)} s`}` : '', o.bursts ? 'thermonuclear bursts flash on its surface' : '', o.gc ? `inside the globular cluster ${o.gc}` : ''].filter(Boolean);
  const more = extras.join('; ');
  return `${eater} ${how} ${donor}${orbit}, lit up in X-rays by the infalling gas.${more ? ` ${more[0].toUpperCase()}${more.slice(1)}.` : ''}`;
}

/** Facts for the Galaxy Map panel. */
export function objectFacts(o: GalacticObject): [string, string][] {
  const ly = `${Math.round(o.d * 3261.6).toLocaleString('en-US')} light-years`;
  if (o.kind === 'nova' || o.kind === 'cv') {
    const period = whiteDwarfPeriodDays(o);
    const facts: [string, string][] = [['Type', objectKindLabel(o)]];
    if (o.kind === 'nova') {
      if (o.year) facts.push(['Eruption', `${Math.floor(o.year)}`]);
      if (o.vpeak !== undefined) facts.push(['Peak brightness', `magnitude ${o.vpeak.toFixed(1)}${o.vmag !== undefined ? ` (absolute ${o.vmag.toFixed(1)})` : ''}`]);
      if (o.t3) facts.push(['Speed', `${novaSpeedClass(o.t3)} (t₃ = ${o.t3} days)`]);
      if (o.sptype) facts.push(['Spectrum', o.sptype.replace(',', ', ')]);
      if (o.fwhm) facts.push(['Ejecta speed', `${o.fwhm.toLocaleString('en-US')} km/s`]);
    }
    facts.push(['White dwarf', o.m1 ? `${o.m1} M☉` : 'mass unknown']);
    facts.push(['Companion', `${o.sptype2 ? `${o.sptype2.split('/')[0]} star` : o.kind === 'nova' && /\bRG\b/.test(o.prop ?? '') ? 'red giant' : 'star'}${o.m2 ? `, ${o.m2} M☉` : ''}`]);
    facts.push(['Orbit', period.assumed ? 'period unknown' : `${formatPeriod(period.days)}${o.eclipsing ? ', eclipsing' : ''}`]);
    if (o.kind === 'nova' && o.pop) facts.push(['Population', o.pop === 'cluster' ? 'globular cluster' : o.pop]);
    facts.push(['Distance', o.kind === 'nova' && o.dlo && o.dhi ? `${ly} (${Math.round(o.dlo * 3261.6).toLocaleString('en-US')}–${Math.round(o.dhi * 3261.6).toLocaleString('en-US')})` : ly]);
    facts.push(['Source', o.kind === 'nova' ? `Schaefer 2022${o.gaia ? ' (Gaia parallax)' : ''}${o.types ? '; Ritter & Kolb' : ''}` : `Canbay et al. 2023 (Gaia DR3)${o.types ? '; Ritter & Kolb' : ''}`]);
    return facts;
  }
  if (o.kind === 'cep') {
    return [
      ['Type', objectKindLabel(o)],
      ['Period', formatPeriod(o.per)],
      ['Luminosity', `${Math.round(cepheidLuminosity(o.per, o.mode)).toLocaleString('en-US')} L☉ (from the period)`],
      ['Radius', `about ${Math.round(cepheidRadius(o.per, o.mode))} R☉`],
      ...(o.age ? ([['Age', `about ${o.age} million years`]] as [string, string][]) : []),
      ['Distance', `${ly}${o.ed ? ` ± ${Math.round(o.ed * 3261.6).toLocaleString('en-US')}` : ''}`],
      ['Source', o.dsrc ?? `Skowron et al. 2019 (${o.survey})`],
    ];
  }
  if (o.kind === 'maser') {
    return [
      ['Type', objectKindLabel(o)],
      ['Region', o.gname],
      ...(o.arm && ARMS[o.arm] ? ([['Spiral arm', ARMS[o.arm].replace(/^the /, '')]] as [string, string][]) : []),
      ...(o.vlsr !== undefined ? ([['Radial velocity', `${o.vlsr > 0 ? '+' : ''}${o.vlsr} km/s (LSR)`]] as [string, string][]) : []),
      ['Distance', `${ly}${o.ed ? ` ± ${Math.round(o.ed * 3261.6).toLocaleString('en-US')}` : ''} (VLBI parallax)`],
      ['Source', 'Reid et al. 2019 (BeSSeL, VERA)'],
    ];
  }
  if (o.kind === 'wr') {
    return [
      ['Type', objectKindLabel(o)],
      ['Spectral type', o.sptype],
      ...(o.vinf ? ([['Wind speed', `${o.vinf.toLocaleString('en-US')} km/s`]] as [string, string][]) : []),
      ...(o.vmag !== undefined ? ([['Brightness', `magnitude ${o.vmag.toFixed(1)}`]] as [string, string][]) : []),
      ['Distance', ly],
      ['Source', 'van der Hucht 2001 (VIIth WR catalogue)'],
    ];
  }
  const period = xrayPeriodDays(o);
  return [
    ['Type', objectKindLabel(o)],
    ['Compact object', o.compact === '?' ? 'neutron star or black hole (unknown)' : `${o.compact === 'BH' ? 'black hole' : 'neutron star'}${o.mx ? `, ${o.mx} M☉` : ''}`],
    ['Companion', `${o.sptype ? `${o.sptype} star` : o.kind === 'hmxb' ? 'massive star' : 'star'}${o.mo ? `, ${o.mo} M☉` : ''}`],
    ['Orbit', period.assumed ? 'period unknown' : formatPeriod(period.days)],
    ...(o.spin ? ([['Spin period', o.spin < 1 ? `${(o.spin * 1000).toPrecision(3)} ms` : `${o.spin.toPrecision(3)} s`]] as [string, string][]) : []),
    ...(o.gc ? ([['Globular cluster', o.gc]] as [string, string][]) : []),
    ['Distance', ly],
    ['Source', o.kind === 'hmxb' ? 'Fortin et al. 2023 (Gaia EDR3 distance)' : 'Fortin et al. 2024'],
  ];
}
