/**
 * The Milky Way's X-ray binaries and Wolf–Rayet stars (scripts/build-galactic-objects.mjs):
 * every catalogued one with a measured distance, for the Galaxy Map.
 *
 * - High-mass X-ray binaries (Fortin et al. 2023): a neutron star or black hole feeding on the
 *   wind of a massive O/B companion.
 * - Low-mass X-ray binaries (Fortin et al. 2024): a neutron star or black hole drawing a stream
 *   of gas from a Sun-like or smaller star that fills its Roche lobe.
 * - Wolf–Rayet stars (van der Hucht 2001): massive stars that have blown off their hydrogen,
 *   with winds of thousands of km/s, a few hundred thousand years from exploding.
 */

export type GalacticObjectKind = 'hmxb' | 'lmxb' | 'wr';

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

export interface GalacticObjects {
  hmxb: XrayBinary[];
  lmxb: XrayBinary[];
  wr: WolfRayet[];
}

/** One map entry of any kind, in the order of the Galaxy Map's object list. */
export type GalacticObject = ({ kind: 'hmxb' | 'lmxb' } & XrayBinary) | ({ kind: 'wr' } & WolfRayet);

export function flattenObjects(data: GalacticObjects): GalacticObject[] {
  return [...data.hmxb.map((o) => ({ kind: 'hmxb' as const, ...o })), ...data.lmxb.map((o) => ({ kind: 'lmxb' as const, ...o })), ...data.wr.map((o) => ({ kind: 'wr' as const, ...o }))];
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

/** A readable, one-line kind: "black-hole X-ray binary", "Wolf–Rayet star (WC9)". */
export function objectKindLabel(o: GalacticObject): string {
  if (o.kind === 'wr') return `Wolf–Rayet star (${o.sptype.split('+')[0]})`;
  const what = o.compact === 'BH' ? 'black-hole' : o.compact === 'NS' ? 'neutron-star' : '';
  const mass = o.kind === 'hmxb' ? 'high-mass' : 'low-mass';
  return `${what ? `${what} ` : ''}${mass} X-ray binary${o.candidate ? ' (candidate)' : ''}`;
}

/** A sentence for the panel and the search index. */
export function describeObject(o: GalacticObject): string {
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
