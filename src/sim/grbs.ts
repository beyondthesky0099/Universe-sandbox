/**
 * Gamma-ray bursts with measured redshifts (scripts/build-grbs.mjs, J. Greiner's table): the most
 * distant explosions we see, and the evidence for the claimed Hercules–Corona Borealis Great Wall.
 *
 * Horváth, Hakkila & Bagoly (2014, A&A 561, L12) found that of the bursts known then at redshift
 * 1.6–2.1, 14 of 31 lay within 45° of one point of the sky (towards Hercules and Corona Borealis,
 * RA 17h, Dec +27.75°), where chance would put about 4.5: a structure perhaps 2–3 Gpc long, far
 * larger than cosmology expects. Whether it is real is debated: the region was picked after seeing
 * the data, and bursts are found more easily in some parts of the sky.
 */

/** [name, RA (°), Dec (°), redshift] */
export type Grb = [string, number, number, number];

export const HCB = { raDeg: 255, decDeg: 27.75, radiusDeg: 45, zMin: 1.6, zMax: 2.1 };

const DEG = Math.PI / 180;

export function separationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const c = Math.sin(dec1 * DEG) * Math.sin(dec2 * DEG) + Math.cos(dec1 * DEG) * Math.cos(dec2 * DEG) * Math.cos((ra1 - ra2) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
}

/** Is this burst one of the Great Wall's: in its redshift range and region? */
export function inGreatWall([, ra, dec, z]: Grb): boolean {
  return z >= HCB.zMin && z <= HCB.zMax && separationDeg(ra, dec, HCB.raDeg, HCB.decDeg) <= HCB.radiusDeg;
}

/** The year a burst happened, from its name (GRB yymmdd…). */
export function grbYear(name: string): number | undefined {
  const m = name.match(/(\d\d)\d{4}/);
  if (!m) return undefined;
  const y = Number(m[1]);
  return y >= 90 ? 1900 + y : 2000 + y;
}

/**
 * The excess towards the Wall among bursts up to a year: how many at z 1.6–2.1 there are, how many
 * lie in its 45° region, and how many would by chance if they were spread evenly over the sky.
 */
export function greatWallCount(bursts: Grb[], upToYear = Infinity): { total: number; inside: number; expected: number } {
  const range = bursts.filter((b) => b[3] >= HCB.zMin && b[3] <= HCB.zMax && (grbYear(b[0]) ?? Infinity) <= upToYear);
  const inside = range.filter(inGreatWall).length;
  const capFraction = (1 - Math.cos(HCB.radiusDeg * DEG)) / 2;
  return { total: range.length, inside, expected: range.length * capFraction };
}

let promise: Promise<Grb[]> | undefined;

export function loadGrbs(baseUrl = import.meta.env.BASE_URL): Promise<Grb[]> {
  promise ??= fetch(`${baseUrl}data/grbs.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the gamma-ray bursts (HTTP ${r.status})`);
      return r.json() as Promise<{ bursts: Grb[] }>;
    })
    .then((d) => d.bursts);
  promise.catch(() => (promise = undefined));
  return promise;
}
