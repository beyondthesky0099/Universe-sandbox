/**
 * The Boötes Void: one of the largest known empty regions, found in a redshift survey by Kirshner,
 * Oemler, Schechter & Shectman (1981, ApJ 248, L57) towards RA 14h50m, Dec +46°, at a recession
 * velocity of 15,500 km/s. Its radius here, 3,100 km/s (~46 Mpc), is from Wegner, Salzer, Taylor &
 * Hirschauer (2019, ApJ 883, 29); Kirshner et al. (1987) gave 34 h⁻¹ Mpc (50 Mpc with h = 0.68).
 * About 60 galaxies are now known inside it.
 *
 * `voidCensus` measures its emptiness in the map's own galaxies (the 2MASS Redshift Survey,
 * cz ≤ 15,000 km/s): the void's near side against the same redshift range everywhere else
 * outside the Zone of Avoidance, so the survey's depth affects both alike.
 */
import { equatorialToGalactic } from '../procgen/galaxy';
import { mulberry32 } from '../procgen/rng';
import { galacticToCosmos, type WebGalaxy } from './galaxies';

export const BOOTES_VOID = { raDeg: 222.5, decDeg: 46, czKms: 15500, radiusKms: 3100 };
/** The 2MASS Redshift Survey's limit (galaxies-2mrs.json). */
const SURVEY_CZ = 15000;

/** Centre (Universe frame, Mpc) and radius (Mpc) for a Hubble constant. */
export function bootesVoid(H0: number): { centre: [number, number, number]; radius: number } {
  const [l, b] = equatorialToGalactic(BOOTES_VOID.raDeg, BOOTES_VOID.decDeg);
  return { centre: galacticToCosmos(l, b, BOOTES_VOID.czKms / H0), radius: BOOTES_VOID.radiusKms / H0 };
}

const inside = (p: [number, number, number], c: [number, number, number], r: number) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < r;

/**
 * Galaxies in the void's part of the survey's last shell (cz from the void's near edge to 15,000
 * km/s), and how many it would hold at the shell's average density elsewhere (|b| > 10°).
 */
export function voidCensus(galaxies: WebGalaxy[], H0: number, samples = 300_000): { inside: number; expected: number; ratio: number } {
  const { centre, radius } = bootesVoid(H0);
  const lo = BOOTES_VOID.czKms - BOOTES_VOID.radiusKms;
  const shell = galaxies.filter((g) => g[2] >= lo && g[2] <= SURVEY_CZ && Math.abs(g[1]) > 10);
  const pos = (g: WebGalaxy) => galacticToCosmos(g[0], g[1], g[2] / H0);
  const n = shell.filter((g) => inside(pos(g), centre, radius)).length;
  // The void's share of the shell's volume (outside the Zone of Avoidance), by sampling.
  const rand = mulberry32(1981);
  const [r0, r1] = [lo / H0, SURVEY_CZ / H0];
  let inVoid = 0, inRest = 0;
  for (let k = 0; k < samples; k++) {
    const u = 2 * rand() - 1;
    if (Math.abs(u) <= Math.sin((10 * Math.PI) / 180)) continue; // |b| ≤ 10°
    const phi = 2 * Math.PI * rand();
    const r = Math.cbrt(r0 ** 3 + rand() * (r1 ** 3 - r0 ** 3));
    const s = Math.sqrt(1 - u * u);
    if (inside([r * s * Math.cos(phi), r * u, -r * s * Math.sin(phi)], centre, radius)) inVoid++;
    else inRest++;
  }
  const expected = ((shell.length - n) * inVoid) / inRest;
  return { inside: n, expected, ratio: n / expected };
}
