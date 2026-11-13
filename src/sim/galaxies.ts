/**
 * Real galaxies beyond the Milky Way (built by scripts/build-galaxies.mjs):
 *  - the Local Volume, from the Updated Nearby Galaxy Catalog (Karachentsev et al. 2013), and
 *  - the cosmic web, from the 2MASS Redshift Survey (Huchra et al. 2012).
 *
 * Map coordinates are megaparsecs with the Milky Way at the origin, the galactic plane
 * horizontal (scene x, z) and the north galactic pole up (+y):
 * galactic (x toward l = 0, y toward l = 90°, z north) → scene (x, z, −y).
 */

import { comovingDistance } from './cosmology';

export const LY_PER_MPC = 3.2616e6;

/** What a Universe map entry is: a galaxy unless said otherwise. */
export type CosmosKind = 'galaxy' | 'cluster' | 'quasar';

export interface LocalGalaxy {
  name: string;
  kind?: CosmosKind;
  /** A familiar name (Sombrero Galaxy, Coma Cluster) from the catalogue. */
  common?: string;
  /** Redshift, for objects placed by it. */
  z?: number;
  /** Rich clusters: Abell richness class (0–5), member count and Bautz–Morgan type. */
  rich?: number;
  count?: number;
  bm?: string;
  /** Quasars: V magnitude. */
  vmag?: number;
  /** Record holders: why they matter, and the paper. */
  note?: string;
  ref?: string;
  /** Galactic longitude and latitude (degrees) and distance from the Sun (Mpc). */
  l: number;
  b: number;
  d: number;
  /** de Vaucouleurs T-type: ≤ −1 elliptical/lenticular, 0–8 spiral, 9–10 irregular. */
  t?: number;
  /** Dwarf morphology (Sph, Im, Ir, dE, BCD, ...). */
  m?: string;
  /** Major linear diameter (kpc). */
  size?: number;
  /** Axis ratio and inclination (degrees from face-on). */
  ba?: number;
  inc?: number;
  /** Position angle of the major axis on the sky (degrees, north through east), from HyperLEDA. */
  pa?: number;
  /** log10 Ks-band luminosity, total mass within the Holmberg radius, and HI gas mass (solar units). */
  lk?: number;
  mass?: number;
  hi?: number;
  /** Heliocentric radial velocity (km/s): negative means approaching. */
  v?: number;
  /** The neighbour that disturbs it most. */
  md?: string;
  /** Distance from redshift (Hubble's law) rather than a direct measurement. */
  zd?: boolean;
}

/** [galactic l, b (degrees), cz (km/s), total Ks magnitude] */
export type WebGalaxy = [number, number, number, number];

export interface WebCatalog {
  H0: number;
  galaxies: WebGalaxy[];
}

export type GalaxyForm = 'spiral' | 'elliptical' | 'lenticular' | 'irregular' | 'dwarf spheroidal';

/** Galactic (l, b, d) → map position (Mpc). */
export function galacticToCosmos(lDeg: number, bDeg: number, dMpc: number): [number, number, number] {
  const l = (lDeg * Math.PI) / 180;
  const b = (bDeg * Math.PI) / 180;
  const x = dMpc * Math.cos(b) * Math.cos(l);
  const y = dMpc * Math.cos(b) * Math.sin(l);
  const z = dMpc * Math.sin(b);
  return [x, z, -y];
}

export function localPosition(g: LocalGalaxy): [number, number, number] {
  return g.name === 'Milky Way' ? [0, 0, 0] : galacticToCosmos(g.l, g.b, g.d);
}

/** Distance from redshift (Hubble's law). */
export function webPosition(w: WebGalaxy, H0: number): [number, number, number] {
  return galacticToCosmos(w[0], w[1], w[2] / H0);
}

export function galaxyForm(g: Pick<LocalGalaxy, 't' | 'm'>): GalaxyForm {
  // Dwarf morphology codes from the catalogue take precedence over the T-type.
  if (g.m === 'Sph' || g.m === 'Tr') return 'dwarf spheroidal';
  if (g.m?.startsWith('dE')) return 'elliptical'; // dE, dEem: dwarf ellipticals such as M32
  if (g.m?.startsWith('dS0')) return 'lenticular';
  const t = g.t ?? 9;
  if (t <= -3) return 'elliptical';
  if (t <= 0) return 'lenticular';
  if (t <= 8) return 'spiral';
  return 'irregular';
}

/** Well-known names for catalogue entries. */
const COMMON: Record<string, string> = {
  'Milky Way': 'Milky Way',
  MESSIER031: 'Andromeda Galaxy (M31)',
  MESSIER033: 'Triangulum Galaxy (M33)',
  MESSIER032: 'M32',
  NGC0205: 'M110',
  LMC: 'Large Magellanic Cloud',
  SMC: 'Small Magellanic Cloud',
  'Sag dSph': 'Sagittarius Dwarf',
  NGC5128: 'Centaurus A',
  MESSIER081: "Bode's Galaxy (M81)",
  MESSIER082: 'Cigar Galaxy (M82)',
  NGC5194: 'Whirlpool Galaxy (M51)',
  NGC5195: 'NGC 5195 (M51b)',
  MESSIER101: 'Pinwheel Galaxy (M101)',
  MESSIER083: 'Southern Pinwheel (M83)',
  NGC0253: 'Sculptor Galaxy',
  MESSIER094: 'M94',
  MESSIER063: 'Sunflower Galaxy (M63)',
  MESSIER064: 'Black Eye Galaxy (M64)',
  MESSIER106: 'M106',
  NGC4594: 'Sombrero Galaxy (M104)',
  MESSIER104: 'Sombrero Galaxy (M104)',
  NGC6822: "Barnard's Galaxy",
  IC0342: 'IC 342 (hidden galaxy)',
  'Maffei 1': 'Maffei 1',
  'Maffei 2': 'Maffei 2',
  NGC0300: 'NGC 300',
  NGC0055: 'NGC 55',
  NGC2403: 'NGC 2403',
  NGC4945: 'NGC 4945',
  IC1613: 'IC 1613',
  WLM: 'Wolf–Lundmark–Melotte',
  MESSIER087: 'M87 (Virgo A)',
  MESSIER049: 'M49',
  MESSIER060: 'M60',
  MESSIER084: 'M84',
  MESSIER086: 'M86',
  MESSIER077: 'M77 (Cetus A)',
  NGC1316: 'Fornax A',
  NGC1399: 'NGC 1399 (Fornax Cluster centre)',
};

/** The catalogue name made readable: "M31", "NGC 253", "Abell 1656". */
export function catalogueName(name: string): string {
  const n = name.trim();
  const messier = n.match(/^MESSIER0*(\d+)$/);
  if (messier) return `M${messier[1]}`;
  const cat = n.match(/^(NGC|IC|UGC|UGCA|PGC|ESO|DDO|KK|KKH|KKs|MCG|MRK|CGCG|KUG|ARK|AM|WKK)0*(\d.*)$/);
  if (cat) return `${cat[1]} ${cat[2]}`;
  return n.replace(/\.0$/, '');
}

/** Readable name: well-known names, then catalogue common names, then "M31"/"NGC 253"-style numbers. */
export function displayName(g: Pick<LocalGalaxy, 'name' | 'common'>): string {
  const n = g.name.trim();
  if (COMMON[n]) return COMMON[n];
  const cat = catalogueName(n);
  if (g.common) return g.common.includes(cat) ? g.common : `${g.common} (${cat})`;
  return cat;
}

/** True for objects worth a permanent label on the map. */
export function isFamous(g: Pick<LocalGalaxy, 'name' | 'common' | 'note'>): boolean {
  return !!COMMON[g.name.trim()] || !!g.common || !!g.note;
}

/**
 * Well-known clusters and superclusters, at approximate galactic coordinates and distances
 * (Mpc) from the literature. They are labels only; the galaxies around them are real data.
 */
export const COSMIC_STRUCTURES: { name: string; l: number; b: number; d: number }[] = [
  { name: 'Local Group', l: 0, b: 0, d: 0.4 },
  { name: 'Virgo Cluster', l: 283.8, b: 74.5, d: 16.5 },
  { name: 'Fornax Cluster', l: 236.7, b: -53.6, d: 19 },
  { name: 'Local Void', l: 33.9, b: -1.9, d: 25 },
  { name: 'Perseus–Pisces Supercluster', l: 132.8, b: -32.1, d: 70 },
  { name: 'CfA2 Great Wall', l: 241.4, b: 76.2, d: 95 },
  { name: 'Hercules Superclusters', l: 31.2, b: 44.5, d: 155 },
  { name: 'Shapley Supercluster', l: 311.5, b: 32.3, d: 200 },
  { name: 'Boötes Void', l: 79.7, b: 59.9, d: 215 },
  { name: 'Horologium–Reticulum Supercluster', l: 262.2, b: -53.8, d: 265 },
  { name: 'Sloan Great Wall', l: 332.7, b: 59.4, d: 330 },
];

/** Familiar names of Abell clusters. */
export const ABELL_NAMES: Record<number, string> = {
  1656: 'Coma Cluster',
  426: 'Perseus Cluster',
  1367: 'Leo Cluster',
  2151: 'Hercules Cluster',
  3526: 'Centaurus Cluster',
  1060: 'Hydra Cluster',
  3627: 'Norma Cluster (Great Attractor)',
  3558: 'Shapley Supercluster core',
  2199: 'Abell 2199 (Hercules)',
  1689: 'Abell 1689 (gravitational lens)',
  2218: 'Abell 2218 (gravitational lens)',
  370: 'Abell 370 (gravitational lens)',
  2744: "Pandora's Cluster",
  2029: 'Abell 2029 (giant cD galaxy)',
  262: 'Abell 262 (Perseus–Pisces)',
  85: 'Abell 85',
  2256: 'Abell 2256 (merging cluster)',
};

/** [name, l, b, cz (km/s), total Ks magnitude, T-type, position angle (degrees), axis ratio] */
type NamedRow = [string, number, number, number, number, number | null, (number | null)?, (number | null)?, (string | null)?];

/**
 * The brightest galaxies beyond the Local Volume (2MRS), as clickable map entries. Distances
 * are from redshift; luminosities and sizes are estimated from the Ks magnitude.
 */
export function namedFromSurvey(rows: NamedRow[], H0: number): LocalGalaxy[] {
  return rows.map(([name, l, b, cz, kt, t, pa, ba, common]) => {
    const d = cz / H0;
    const absK = kt - 5 * Math.log10(d * 1e6) + 5;
    const lk = (3.28 - absK) / 2.5; // log10 Ks luminosity, solar units
    return {
      name,
      l,
      b,
      d,
      t: t ?? undefined,
      lk: Number(lk.toFixed(2)),
      size: Number((30 * Math.pow(10, (lk - 10.7) / 2.5)).toFixed(1)), // rough diameter (kpc) from luminosity
      v: cz,
      zd: true,
      ...(pa !== null && pa !== undefined ? { pa } : {}),
      ...(ba !== null && ba !== undefined ? { ba } : {}),
      ...(common ? { common } : {}),
    };
  });
}

let namedPromise: Promise<LocalGalaxy[]> | undefined;
export function loadNamedGalaxies(baseUrl = import.meta.env.BASE_URL): Promise<LocalGalaxy[]> {
  namedPromise ??= fetch(`${baseUrl}data/galaxies-named.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ H0: number; galaxies: NamedRow[] }>) : { H0: 70, galaxies: [] }))
    .then((d) => namedFromSurvey(d.galaxies, d.H0))
    .catch(() => []);
  return namedPromise;
}

/** Raw rows of public/data/universe-objects.json (scripts/build-deep-universe.mjs). */
export interface UniverseObjects {
  /** [Abell number, l, b, z, richness class, member count, Bautz–Morgan type] */
  clusters: [number, number, number, number, number | null, number | null, string | null][];
  /** [name, l, b, z, V magnitude] */
  quasars: [string, number, number, number, number | null][];
  records: { name: string; l: number; b: number; z: number; kind: 'galaxy' | 'quasar'; note: string; ref: string }[];
}

const normName = (n: string) => n.replace(/\.0$/, '').replace(/[\s_−-]/g, '').toUpperCase();

/**
 * Rich clusters, quasars and record holders as map entries, placed at the comoving distance for
 * their redshift. A record holder replaces a catalogue quasar of the same name.
 */
export function universeEntries(u: UniverseObjects): LocalGalaxy[] {
  const out: LocalGalaxy[] = [];
  for (const [n, l, b, z, rich, count, bm] of u.clusters) {
    const g: LocalGalaxy = { name: `Abell ${n}`, kind: 'cluster', l, b, d: comovingDistance(z), z, zd: true, size: 4000, lk: 11.5 + (rich ?? 0) * 0.5 };
    if (rich !== null) g.rich = rich;
    if (count !== null) g.count = count;
    if (bm) g.bm = bm;
    if (ABELL_NAMES[n]) g.common = ABELL_NAMES[n];
    out.push(g);
  }
  const recordNames = new Set(u.records.map((r) => normName(r.name)));
  for (const [name, l, b, z, vmag] of u.quasars) {
    if (recordNames.has(normName(name))) continue;
    const g: LocalGalaxy = { name, kind: 'quasar', l, b, d: comovingDistance(z), z, zd: true, size: 30, t: -5, lk: vmag !== null ? 12.5 - vmag * 0.15 : 10 };
    if (vmag !== null) g.vmag = vmag;
    out.push(g);
  }
  for (const r of u.records) {
    out.push({ name: r.name, kind: r.kind === 'quasar' ? 'quasar' : 'galaxy', l: r.l, b: r.b, d: comovingDistance(r.z), z: r.z, zd: true, size: r.kind === 'quasar' ? 30 : 2, t: r.kind === 'quasar' ? -5 : 9, lk: 11, note: r.note, ref: r.ref });
  }
  return out;
}

let universePromise: Promise<LocalGalaxy[]> | undefined;
export function loadUniverseObjects(baseUrl = import.meta.env.BASE_URL): Promise<LocalGalaxy[]> {
  universePromise ??= fetch(`${baseUrl}data/universe-objects.json`)
    .then((r) => (r.ok ? (r.json() as Promise<UniverseObjects>) : { clusters: [], quasars: [], records: [] }))
    .then(universeEntries)
    .catch(() => []);
  return universePromise;
}

let localPromise: Promise<LocalGalaxy[]> | undefined;
let webPromise: Promise<WebCatalog> | undefined;

export function loadLocalGalaxies(baseUrl = import.meta.env.BASE_URL): Promise<LocalGalaxy[]> {
  localPromise ??= fetch(`${baseUrl}data/galaxies-local.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the galaxy catalogue (${r.status})`);
      return r.json() as Promise<{ galaxies: LocalGalaxy[] }>;
    })
    .then((d) => d.galaxies);
  return localPromise;
}

export function loadWebGalaxies(baseUrl = import.meta.env.BASE_URL): Promise<WebCatalog> {
  webPromise ??= fetch(`${baseUrl}data/galaxies-2mrs.json`).then((r) => {
    if (!r.ok) throw new Error(`Couldn't load the redshift survey (${r.status})`);
    return r.json() as Promise<WebCatalog>;
  });
  return webPromise;
}

export const GALAXY_CREDIT =
  'Galaxy data: Updated Nearby Galaxy Catalog (Karachentsev, Makarov & Kaisina 2013), the 2MASS Redshift Survey (Huchra et al. 2012), HyperLEDA position angles (Paturel et al. 2003), OpenNGC (Mattia Verga, CC BY-SA 4.0), the Abell cluster catalogue (Abell, Corwin & Olowin 1989) and the Véron-Cetty & Véron quasar catalogue (2010), via VizieR (CDS).';
