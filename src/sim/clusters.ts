/**
 * Real Milky Way star clusters (scripts/build-clusters.mjs): open clusters and moving groups from
 * the Gaia DR3 census of Hunt & Reffert 2023, and globular clusters from Harris's catalogue.
 * Positions are galactic (l, b) in degrees; distances in parsecs.
 */
export type ClusterKind = 'open' | 'group' | 'globular';

export interface StarCluster {
  kind: ClusterKind;
  l: number;
  b: number;
  /** Distance in parsecs (two globulars in Harris's 1997 edition have none). */
  distancePc?: number;
  /** Radius holding half the members (open clusters) or half the light (globulars). */
  radiusPc?: number;
  radiusDeg: number;
  /** Open clusters: member stars found in Gaia, and log10 of the age in years. */
  members?: number;
  logAge?: number;
  /** Globular clusters: metallicity [Fe/H] and absolute V magnitude. */
  feh?: number;
  absMag?: number;
  id: string;
  name?: string;
}

type Row = (string | number | null)[];

export function parseClusters(raw: { open: Row[]; globular: Row[] }): StarCluster[] {
  const out: StarCluster[] = [];
  for (const [l, b, d, rPc, rDeg, n, age, group, id, name] of raw.open as [number, number, number, number | null, number | null, number, number | null, number, string, string?][]) {
    out.push({ kind: group ? 'group' : 'open', l, b, distancePc: d, radiusPc: rPc ?? undefined, radiusDeg: rDeg ?? 0, members: n, logAge: age ?? undefined, id, name });
  }
  for (const [l, b, d, rPc, rDeg, feh, mv, id, name] of raw.globular as [number, number, number | null, number | null, number, number | null, number | null, string, string?][]) {
    out.push({ kind: 'globular', l, b, distancePc: d ?? undefined, radiusPc: rPc ?? undefined, radiusDeg: rDeg, feh: feh ?? undefined, absMag: mv ?? undefined, id, name });
  }
  return out;
}

let promise: Promise<StarCluster[]> | undefined;
export function loadClusters(baseUrl = import.meta.env.BASE_URL): Promise<StarCluster[]> {
  promise ??= fetch(`${baseUrl}data/clusters.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load star clusters (${r.status})`);
      return r.json() as Promise<{ open: Row[]; globular: Row[] }>;
    })
    .then(parseClusters);
  return promise;
}

export const CLUSTER_COLORS: Record<ClusterKind, [number, number, number]> = {
  open: [1, 0.86, 0.45],
  group: [0.85, 0.8, 0.6],
  globular: [1, 0.68, 0.35],
};

/** Age in a readable form, from log10(years). */
export function ageText(logAge: number): string {
  const yr = 10 ** logAge;
  return yr >= 1e9 ? `${(yr / 1e9).toFixed(1)} billion years` : `${Math.round(yr / 1e6).toLocaleString('en-US')} million years`;
}

export const CLUSTER_CREDIT =
  'Star clusters: Hunt & Reffert 2023 (A&A 673, A114), from Gaia DR3; globular clusters from the Harris catalogue. Via VizieR.';
