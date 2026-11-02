/**
 * Real Milky Way nebulae (scripts/build-nebulae.mjs): HII regions from the WISE catalogue,
 * planetary nebulae from the Strasbourg-ESO catalogue with Gaia or statistical distances, and
 * supernova remnants from Green's catalogue. Positions are galactic (l, b) in degrees.
 */
export type NebulaKind = 'hii' | 'pn' | 'snr';

export interface Nebula {
  kind: NebulaKind;
  l: number;
  b: number;
  /** Distance in kpc, when measured. */
  distanceKpc?: number;
  /** Where the distance comes from (planetary nebulae): Gaia parallax or a statistical method. */
  distanceSource?: 'gaia' | 'statistical';
  /** Angular radius in degrees (0 if unknown). */
  radiusDeg: number;
  /** Catalogue designation, and a familiar name when it has one. */
  id: string;
  name?: string;
  /** Supernova remnant morphology: S shell, F filled centre, C composite. */
  snrType?: string;
}

type Row = (string | number | null)[];
interface RawCatalog {
  hii: Row[];
  pn: Row[];
  snr: Row[];
}

export function parseNebulae(raw: RawCatalog): Nebula[] {
  const out: Nebula[] = [];
  for (const [l, b, d, rad, id, name] of raw.hii as [number, number, number | null, number, string, string?][]) {
    out.push({ kind: 'hii', l, b, distanceKpc: d ?? undefined, radiusDeg: rad / 3600, id, name });
  }
  for (const [l, b, d, rad, id, src, name] of raw.pn as [number, number, number | null, number | null, string, string | null, string?][]) {
    out.push({ kind: 'pn', l, b, distanceKpc: d ?? undefined, distanceSource: src === 'g' ? 'gaia' : src === 's' ? 'statistical' : undefined, radiusDeg: (rad ?? 0) / 3600, id, name });
  }
  for (const [l, b, maj, min, type, id, name] of raw.snr as [number, number, number, number, string, string, string?][]) {
    out.push({ kind: 'snr', l, b, radiusDeg: Math.sqrt(maj * min) / 2 / 60, id, name, snrType: type });
  }
  return out;
}

let promise: Promise<Nebula[]> | undefined;
export function loadNebulae(baseUrl = import.meta.env.BASE_URL): Promise<Nebula[]> {
  promise ??= fetch(`${baseUrl}data/nebulae.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load nebulae (${r.status})`);
      return r.json() as Promise<RawCatalog>;
    })
    .then(parseNebulae);
  return promise;
}

/** Physical diameter in parsecs, when the distance and angular size are known. */
export function diameterPc(n: Nebula): number | undefined {
  if (!n.distanceKpc || !n.radiusDeg) return undefined;
  return 2 * n.distanceKpc * 1000 * Math.tan((n.radiusDeg * Math.PI) / 180);
}

const DEG = Math.PI / 180;
const OBLIQUITY = 23.4392911 * DEG;

/**
 * Galactic (l, b) → J2000 ecliptic unit vector (the frame of the bright-star catalogue, so the
 * Sky tab can rotate nebulae with the stars). Uses the IAU galactic pole: RA 192.85948°,
 * Dec 27.12825°, and the north celestial pole at galactic longitude 122.93192°.
 */
export function galacticToEcliptic(lDeg: number, bDeg: number): [number, number, number] {
  const ap = 192.85948 * DEG, dp = 27.12825 * DEG, lncp = 122.93192 * DEG;
  const l = lDeg * DEG, b = bDeg * DEG;
  const sd = Math.sin(dp) * Math.sin(b) + Math.cos(dp) * Math.cos(b) * Math.cos(lncp - l);
  const dec = Math.asin(sd);
  const y = Math.cos(b) * Math.sin(lncp - l);
  const x = Math.cos(dp) * Math.sin(b) - Math.sin(dp) * Math.cos(b) * Math.cos(lncp - l);
  const ra = ap + Math.atan2(y, x);
  const ex = Math.cos(dec) * Math.cos(ra), ey = Math.cos(dec) * Math.sin(ra), ez = Math.sin(dec);
  return [ex, Math.cos(OBLIQUITY) * ey + Math.sin(OBLIQUITY) * ez, -Math.sin(OBLIQUITY) * ey + Math.cos(OBLIQUITY) * ez];
}

export const NEBULA_COLORS: Record<NebulaKind, [number, number, number]> = {
  hii: [1, 0.38, 0.52],
  pn: [0.4, 0.95, 0.85],
  snr: [0.55, 0.7, 1],
};

export const NEBULA_KIND_LABEL: Record<NebulaKind, string> = {
  hii: 'HII region',
  pn: 'planetary nebula',
  snr: 'supernova remnant',
};

export const NEBULA_CREDIT =
  'Nebulae: WISE Catalog of Galactic HII Regions (Anderson et al. 2014), Strasbourg-ESO catalogue of planetary nebulae (Acker et al. 1992) with Gaia EDR3 (Gonzalez-Santamaria et al. 2021) and statistical (Stanghellini & Haywood 2010) distances, and Green’s catalogue of supernova remnants (2019), via VizieR.';
