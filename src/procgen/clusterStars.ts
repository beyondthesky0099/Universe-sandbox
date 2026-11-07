/**
 * Star clusters drawn as swarms of stars at their measured sizes, so flying to one shows a ball
 * of stars rather than a single point.
 *
 * Each cluster is a Plummer sphere, the standard simple model of a star cluster: density
 * ∝ (1 + r²/a²)^(−5/2). Its projected half-light (half-number) radius is exactly a, so `a` is
 * the catalogue's radius: the half-light radius of a globular (Harris 1996, 2010 edition) or the
 * radius holding half the Gaia members of an open cluster (Hunt & Reffert 2023).
 *
 * The stars are a representative sample, not the cluster's real stars (Gaia can't resolve the
 * crowded cores of globulars): their number scales with the cluster's brightness or membership,
 * and their colours follow its population: old globulars are mostly yellow and orange, with a few
 * blue horizontal-branch stars; young open clusters are blue-white, older ones yellower.
 */
import { kelvinToRgb } from '../sim/color';
import type { StarCluster } from '../sim/clusters';
import { galacticToMap, UNITS_PER_KPC } from './galaxy';
import { mulberry32 } from './rng';

export interface ClusterSwarms {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
}

/** How many stars to draw for a cluster (before `density`), or 0 to leave it out. */
export function swarmSize(c: StarCluster): number {
  if (!c.distancePc || !c.radiusPc) return 0;
  if (c.kind === 'globular') {
    // ∝ luminosity: about 1,400 for 47 Tucanae (M_V −9.4), the floor for faint ones.
    const mv = c.absMag ?? -7;
    return Math.round(Math.min(2500, Math.max(120, 60 * 10 ** (-0.4 * (mv + 6)))));
  }
  if (c.kind === 'open' && ((c.members ?? 0) >= 300 || c.name)) return Math.round(Math.min(400, Math.max(40, (c.members ?? 120) / 3)));
  return 0;
}

/** Plummer radius for a uniform random number: the inverse of M(<r) = r³/(r² + a²)^(3/2), with a = 1. */
export function plummerRadius(u: number): number {
  return 1 / Math.sqrt(u ** (-2 / 3) - 1);
}

/** Star swarms for every cluster that gets one; `density` scales the star counts (phones: 0.5). */
export function clusterSwarms(clusters: StarCluster[], density = 1): ClusterSwarms {
  const list = clusters.map((c) => [c, Math.round(swarmSize(c) * density)] as const).filter(([, n]) => n > 0);
  const count = list.reduce((sum, [, n]) => sum + n, 0);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let k = 0;
  for (const [c, n] of list) {
    const rand = mulberry32(Math.round(c.l * 1000) * 7919 + Math.round(c.b * 1000) + 17);
    const [cx, cy, cz] = galacticToMap(c.l, c.b, c.distancePc! / 1000);
    const a = (c.radiusPc! / 1000) * UNITS_PER_KPC;
    const young = c.kind !== 'globular' && (c.logAge ?? 8.5) < 8;
    for (let i = 0; i < n; i++) {
      // Radius from the Plummer profile (cut at 12 a, where it has ~99% of its mass), random direction.
      let r: number;
      do r = plummerRadius(Math.max(1e-9, rand())); while (r > 12);
      const u = 2 * rand() - 1;
      const th = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      positions[k * 3] = cx + a * r * s * Math.cos(th);
      positions[k * 3 + 1] = cy + a * r * u;
      positions[k * 3 + 2] = cz + a * r * s * Math.sin(th);
      const p = rand();
      const kelvin =
        c.kind === 'globular'
          ? p < 0.08 ? 9500 : p < 0.3 ? 4200 : 5000 + 1200 * rand()
          : young
            ? p < 0.35 ? 11000 + 9000 * rand() : 6500 + 2000 * rand()
            : p < 0.15 ? 4500 : 5500 + 2000 * rand();
      const [R, G, B] = kelvinToRgb(kelvin);
      // A spread of brightnesses, like a real luminosity function: a few bright, many faint.
      const bright = 0.25 + 0.75 * rand() ** 3;
      colors[k * 3] = R * bright;
      colors[k * 3 + 1] = G * bright;
      colors[k * 3 + 2] = B * bright;
      k++;
    }
  }
  return { positions, colors, count };
}
