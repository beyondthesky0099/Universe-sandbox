/**
 * The Saraswati Supercluster's galaxy clusters (scripts/build-saraswati.mjs): the WHL clusters
 * within 90 Mpc of Abell 2631 in SDSS Stripe 82, as chosen by Bagchi et al. 2017 (ApJ 844, 25).
 */
export interface SaraswatiCluster {
  name: string;
  l: number;
  b: number;
  z: number;
  /** Photometric redshift (no spectrum yet). */
  zPhot?: boolean;
  n200: number;
  r200: number;
  /** In the gravitationally bound core (within 20 Mpc of Abell 2631). */
  core: boolean;
  fromCentre: number;
  abell?: boolean;
}

let promise: Promise<SaraswatiCluster[]> | undefined;
export function loadSaraswati(baseUrl = import.meta.env.BASE_URL): Promise<SaraswatiCluster[]> {
  promise ??= fetch(`${baseUrl}data/saraswati.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ members: SaraswatiCluster[] }>) : { members: [] }))
    .then((d) => d.members)
    .catch(() => []);
  return promise;
}
