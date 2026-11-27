/**
 * The shapes of the large-scale structures that were labels only (render/cosmicShapes.ts draws them):
 *
 * - Walls of galaxy clusters: the Abell clusters with redshifts (Abell, Corwin & Olowin 1989;
 *   sim/galaxies.ts) in each wall's region of the sky and redshift range, as the papers mapped them.
 *   - Sloan Great Wall (Gott et al. 2005, ApJ 624, 463; Einasto et al. 2011, ApJ 736, 51): RA 9h40m
 *     to 15h, Dec −5° to +10°, z 0.05–0.10.
 *   - Horologium–Reticulum Supercluster (Fleenor et al. 2005, AJ 130, 957): RA 2h20m to 5h, Dec −65°
 *     to −35°, z 0.045–0.08.
 *   - South Pole Wall (Pomarède et al. 2020, ApJ 897, 133): within 40° of its densest part (l 302.9°,
 *     b −27.1°) at 9,000–15,000 km/s. The wall itself is traced by the CosmicFlows-3 density field;
 *     its rich clusters only sketch it.
 * - Voids, as bubbles at their published places and sizes (they have no sharp edges):
 *   - Dipole Repeller (Hoffman et al. 2017, Nature Astronomy 1, 0036): about 16,000 km/s away,
 *     opposite our motion against the CMB; drawn 100 Mpc across to mark where it is.
 *   - KBC Void (Keenan, Barger & Cowie 2013, ApJ 775, 62): about 300 Mpc in radius, around us.
 *   - Eridanus Supervoid (Szapudi et al. 2015, MNRAS 450, 288): R = 220 h⁻¹ Mpc at z = 0.22.
 * - The Huge-LQG's 73 quasars (scripts/build-huge-lqg.mjs).
 */
import { comovingDistance } from './cosmology';
import type { LocalGalaxy } from './galaxies';

const D = Math.PI / 180;

/** Galactic (l, b) → equatorial J2000 (RA, Dec), degrees. */
export function galacticToEquatorial(l: number, b: number): [number, number] {
  const raGp = 192.85948 * D, decGp = 27.12825 * D, lNcp = 122.93192 * D;
  const lr = l * D, br = b * D;
  const dec = Math.asin(Math.sin(br) * Math.sin(decGp) + Math.cos(br) * Math.cos(decGp) * Math.cos(lNcp - lr));
  const y = Math.cos(br) * Math.sin(lNcp - lr);
  const x = Math.sin(br) * Math.cos(decGp) - Math.cos(br) * Math.sin(decGp) * Math.cos(lNcp - lr);
  return [(((Math.atan2(y, x) + raGp) / D) % 360 + 360) % 360, dec / D];
}

const C_KMS = 299792.458;
const unit = (l: number, b: number) => [Math.cos(b * D) * Math.cos(l * D), Math.cos(b * D) * Math.sin(l * D), Math.sin(b * D)];

export interface Wall {
  name: string;
  /** Whether a cluster (galactic l, b in degrees; redshift z) is in the wall's region. */
  inRegion: (l: number, b: number, z: number) => boolean;
  rgb: [number, number, number];
}

export const WALLS: Wall[] = [
  {
    name: 'Sloan Great Wall',
    inRegion: (l, b, z) => {
      const [ra, dec] = galacticToEquatorial(l, b);
      return ra >= 145 && ra <= 225 && dec >= -5 && dec <= 10 && z >= 0.05 && z <= 0.1;
    },
    rgb: [0.55, 0.8, 1],
  },
  {
    name: 'Horologium–Reticulum Supercluster',
    inRegion: (l, b, z) => {
      const [ra, dec] = galacticToEquatorial(l, b);
      return ra >= 35 && ra <= 75 && dec >= -65 && dec <= -35 && z >= 0.045 && z <= 0.08;
    },
    rgb: [0.7, 1, 0.75],
  },
  {
    name: 'South Pole Wall',
    inRegion: (l, b, z) => {
      const [p, q] = [unit(l, b), unit(302.93, -27.13)];
      return p[0] * q[0] + p[1] * q[1] + p[2] * q[2] > Math.cos(40 * D) && z * C_KMS >= 9000 && z * C_KMS <= 15000;
    },
    rgb: [1, 0.75, 0.9],
  },
];

/** A wall's Abell clusters (those with redshifts). */
export function wallMembers(wall: Wall, galaxies: LocalGalaxy[]): LocalGalaxy[] {
  return galaxies.filter((g) => g.kind === 'cluster' && g.z !== undefined && wall.inRegion(g.l, g.b, g.z));
}

export interface VoidBubble {
  name: string;
  l: number;
  b: number;
  /** Distance of the centre (Mpc). */
  d: number;
  /** Radius (Mpc). */
  radius: number;
}

const H = 0.6766;
export const VOIDS: VoidBubble[] = [
  { name: 'Dipole Repeller', l: 96, b: -30, d: 16000 / 67.66, radius: 50 },
  { name: 'KBC Void', l: 0, b: 0, d: 0, radius: 300 },
  { name: 'Eridanus Supervoid', l: 209, b: -57, d: comovingDistance(0.22), radius: 220 / H },
];

export interface LqgQuasar {
  name: string;
  l: number;
  b: number;
  z: number;
}

let lqg: Promise<LqgQuasar[]> | undefined;
/** The Huge-LQG's quasars (public/data/huge-lqg.json). */
export function loadHugeLqg(baseUrl = import.meta.env.BASE_URL): Promise<LqgQuasar[]> {
  lqg ??= fetch(`${baseUrl}data/huge-lqg.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ members: LqgQuasar[] }>) : { members: [] }))
    .then((d) => d.members)
    .catch(() => []);
  return lqg;
}
