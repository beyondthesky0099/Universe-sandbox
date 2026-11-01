/**
 * Real galaxies beyond the Milky Way (built by scripts/build-galaxies.mjs):
 *  - the Local Volume, from the Updated Nearby Galaxy Catalog (Karachentsev et al. 2013), and
 *  - the cosmic web, from the 2MASS Redshift Survey (Huchra et al. 2012).
 *
 * Map coordinates are megaparsecs with the Milky Way at the origin, the galactic plane
 * horizontal (scene x, z) and the north galactic pole up (+y):
 * galactic (x toward l = 0, y toward l = 90°, z north) → scene (x, z, −y).
 */

export const LY_PER_MPC = 3.2616e6;

export interface LocalGalaxy {
  name: string;
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
  /** log10 Ks-band luminosity, total mass within the Holmberg radius, and HI gas mass (solar units). */
  lk?: number;
  mass?: number;
  hi?: number;
  /** Heliocentric radial velocity (km/s): negative means approaching. */
  v?: number;
  /** The neighbour that disturbs it most. */
  md?: string;
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
};

/** Readable name: common names, then "M 31"/"NGC 253"-style catalogue numbers. */
export function displayName(g: Pick<LocalGalaxy, 'name'>): string {
  const n = g.name.trim();
  if (COMMON[n]) return COMMON[n];
  const messier = n.match(/^MESSIER0*(\d+)$/);
  if (messier) return `M${messier[1]}`;
  const cat = n.match(/^(NGC|IC|UGC|UGCA|PGC|ESO|DDO|KK|KKH|KKs)0*(\d.*)$/);
  if (cat) return `${cat[1]} ${cat[2]}`;
  return n;
}

/** True for galaxies worth a permanent label on the map. */
export function isFamous(g: Pick<LocalGalaxy, 'name'>): boolean {
  return !!COMMON[g.name.trim()];
}

/**
 * Well-known clusters and superclusters, at approximate galactic coordinates and distances
 * (Mpc) from the literature. They are labels only; the galaxies around them are real data.
 */
export const COSMIC_STRUCTURES: { name: string; l: number; b: number; d: number }[] = [
  { name: 'Local Group', l: 0, b: 0, d: 0.4 },
  { name: 'Virgo Cluster', l: 283.8, b: 74.5, d: 16.5 },
  { name: 'Fornax Cluster', l: 236.7, b: -53.6, d: 19 },
  { name: 'Centaurus Cluster', l: 302.4, b: 21.6, d: 48 },
  { name: 'Hydra Cluster', l: 269.6, b: 26.5, d: 54 },
  { name: 'Norma Cluster (Great Attractor)', l: 325.3, b: -7.3, d: 68 },
  { name: 'Perseus Cluster', l: 150.6, b: -13.3, d: 74 },
  { name: 'Coma Cluster', l: 58.1, b: 88.0, d: 99 },
];

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
  'Galaxy data: Updated Nearby Galaxy Catalog (Karachentsev, Makarov & Kaisina 2013) and the 2MASS Redshift Survey (Huchra et al. 2012), via VizieR (CDS).';
