/**
 * Fast radio bursts traced to their host galaxies (scripts/build-frbs.mjs): Sharma et al. 2024
 * (Nature 635, 61), plus FRB 20121102A and FRB 20220610A. Millisecond flashes of radio waves from
 * other galaxies; most likely from magnetars, like the one seen in our own galaxy in 2020
 * (SGR 1935+2154, CHIME/FRB Collaboration 2020, Nature 587, 54).
 */
/** [name, RA (°), Dec (°), redshift, note?] */
export type Frb = [string, number, number, number, string?];

let promise: Promise<Frb[]> | undefined;

export function loadFrbs(baseUrl = import.meta.env.BASE_URL): Promise<Frb[]> {
  promise ??= fetch(`${baseUrl}data/frbs.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the fast radio bursts (HTTP ${r.status})`);
      return r.json() as Promise<{ bursts: Frb[] }>;
    })
    .then((d) => d.bursts);
  promise.catch(() => (promise = undefined));
  return promise;
}
