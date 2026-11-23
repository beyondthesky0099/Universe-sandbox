/**
 * Real datasets for the Milky Way (scripts/build-galactic-extras.py): the S-stars orbiting Sgr A*
 * (Gillessen et al. 2017), hypervelocity stars (Brown et al. 2012; S5-HVS1, Koposov et al. 2020),
 * the Radcliffe Wave (Konietzka et al. 2024) and the Local Bubble's shell (Pelgrims et al. 2020).
 */

export interface SStar {
  name: string;
  /** Semi-major axis (arcsec as seen from here), eccentricity, angles (degrees), periapse (year), period (years). */
  aArcsec: number;
  e: number;
  i: number;
  node: number;
  peri: number;
  tpYear: number;
  periodYears: number;
}

export interface HypervelocityStar {
  name: string;
  l: number;
  b: number;
  dKpc: number;
  /** Radial velocity in the Galaxy's rest frame (km/s). */
  vKms: number;
  /** The survey's class: unbound, probably bound, or possible. */
  kind: 'unbound' | 'bound' | 'possible';
  fromSgrA?: boolean;
}

export interface GalacticExtras {
  sgrA: { massMsun: number; r0Kpc: number };
  sStars: SStar[];
  hypervelocity: HypervelocityStar[];
  /** The Radcliffe Wave: heliocentric galactic x, y, z (pc) and vertical velocity (km/s). */
  radcliffeWave: [number, number, number, number][];
  /** The Local Bubble: distance (pc) to its shell's inner surface on a longitude × latitude grid (b from −90°). */
  localBubble: { nLon: number; nLat: number; rPc: number[] };
}

/**
 * The 68 millisecond pulsars of the NANOGrav 15-year data set (Agazie et al. 2023, ApJL 951, L9,
 * table 5), whose timing gave the evidence for the gravitational-wave background (Agazie et al.
 * 2023, ApJL 951, L8).
 */
export const NANOGRAV_15YR = [
  'B1855+09', 'B1937+21', 'B1953+29', 'J0023+0923', 'J0030+0451', 'J0340+4130', 'J0406+3039', 'J0437-4715', 'J0509+0856', 'J0557+1551',
  'J0605+3757', 'J0610-2100', 'J0613-0200', 'J0614-3329', 'J0636+5128', 'J0645+5158', 'J0709+0458', 'J0740+6620', 'J0931-1902', 'J1012+5307',
  'J1012-4235', 'J1022+1001', 'J1024-0719', 'J1125+7819', 'J1312+0051', 'J1453+1902', 'J1455-3330', 'J1600-3053', 'J1614-2230', 'J1630+3734',
  'J1640+2224', 'J1643-1224', 'J1705-1903', 'J1713+0747', 'J1719-1438', 'J1730-2304', 'J1738+0333', 'J1741+1351', 'J1744-1134', 'J1745+1017',
  'J1747-4036', 'J1751-2857', 'J1802-2124', 'J1811-2405', 'J1832-0836', 'J1843-1113', 'J1853+1303', 'J1903+0327', 'J1909-3744', 'J1910+1256',
  'J1911+1347', 'J1918-0642', 'J1923+2515', 'J1944+0907', 'J1946+3417', 'J2010-1323', 'J2017+0603', 'J2033+1734', 'J2043+1711', 'J2124-3358',
  'J2145-0750', 'J2214+3000', 'J2229+2643', 'J2234+0611', 'J2234+0944', 'J2302+4442', 'J2317+1439', 'J2322+2057',
];

let cached: GalacticExtras | undefined;
let promise: Promise<GalacticExtras> | undefined;

export function loadGalacticExtras(baseUrl = import.meta.env.BASE_URL): Promise<GalacticExtras> {
  promise ??= fetch(`${baseUrl}data/galactic-extras.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the Milky Way extras (HTTP ${r.status})`);
      return r.json() as Promise<GalacticExtras>;
    })
    .then((d) => (cached = d));
  promise.catch(() => (promise = undefined));
  return promise;
}

/** The data, if loaded (the Sandbox scene needs it synchronously). */
export function getGalacticExtras(): GalacticExtras | undefined {
  return cached;
}

export function setGalacticExtras(d: GalacticExtras | undefined): void {
  cached = d;
}

/** Heliocentric galactic Cartesian (pc) → galactic l, b (degrees) and distance (kpc). */
export function cartesianToGalactic(x: number, y: number, z: number): { l: number; b: number; dKpc: number } {
  const r = Math.hypot(x, y, z);
  return { l: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, b: (Math.asin(z / r) * 180) / Math.PI, dKpc: r / 1000 };
}
