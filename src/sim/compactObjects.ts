/**
 * Famous black holes and pulsars (scripts/build-compact-objects.mjs): positions from SIMBAD,
 * masses, distances and (for the black holes) the companion star's orbit from the discovery
 * papers.
 */
export interface CompactObject {
  name: string;
  kind: 'blackhole' | 'pulsar';
  raDeg: number;
  decDeg: number;
  distanceKpc: number;
  mass?: number;
  about?: string;
  arxiv?: string;
  /** The companion star: mass (M☉), orbital period (days), eccentricity, kind; `dormant` black
   * holes are not feeding (no accretion disc, no X-rays). */
  companion?: { mass: number; periodDays: number; ecc: number; kind: 'star' | 'giant'; dormant?: boolean; note?: string };
}

let promise: Promise<CompactObject[]> | undefined;

export function loadCompactObjects(baseUrl = import.meta.env.BASE_URL): Promise<CompactObject[]> {
  promise ??= fetch(`${baseUrl}data/compact-objects.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`compact-objects.json: HTTP ${r.status}`);
      return r.json() as Promise<{ objects: CompactObject[] }>;
    })
    .then((d) => d.objects);
  return promise;
}
