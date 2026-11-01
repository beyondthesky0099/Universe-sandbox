/**
 * Approximate planetary positions from JPL's "Keplerian Elements for Approximate Positions
 * of the Major Planets" (E. M. Standish, JPL/Caltech). Table 1 is used for 1800–2050 AD and
 * Tables 2a/2b for 3000 BC–3000 AD. Positions are heliocentric, in AU, in the J2000 ecliptic
 * frame; accuracy is roughly arcminutes over the stated ranges.
 * Source: https://ssd.jpl.nasa.gov/planets/approx_pos.html
 */

export type PlanetName = 'Mercury' | 'Venus' | 'Earth' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune';

type Row = [number, number, number, number, number, number];
interface Elements {
  base: Row;
  rate: Row;
  /** Extra mean-anomaly terms b, c, s, f (Table 2b; outer planets only). */
  extra?: [number, number, number, number];
}

// a (AU), e, I (deg), L (deg), long. perihelion (deg), long. node (deg); rates per Julian century.
const TABLE1: Record<PlanetName, Elements> = {
  Mercury: { base: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  Venus: { base: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], rate: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418] },
  Earth: { base: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0] },
  Mars: { base: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  Jupiter: { base: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
  Saturn: { base: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rate: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
  Uranus: { base: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589] },
  Neptune: { base: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664] },
};

const TABLE2: Record<PlanetName, Elements> = {
  Mercury: { base: [0.38709843, 0.20563661, 7.00559432, 252.25166724, 77.45771895, 48.33961819], rate: [0.0, 0.00002123, -0.00590158, 149472.67486623, 0.15940013, -0.12214182] },
  Venus: { base: [0.72332102, 0.00676399, 3.39777545, 181.9797085, 131.76755713, 76.67261496], rate: [-0.00000026, -0.00005107, 0.00043494, 58517.8156026, 0.05679648, -0.27274174] },
  Earth: { base: [1.00000018, 0.01673163, -0.00054346, 100.46691572, 102.93005885, -5.11260389], rate: [-0.00000003, -0.00003661, -0.01337178, 35999.37306329, 0.3179526, -0.24123856] },
  Mars: { base: [1.52371243, 0.09336511, 1.85181869, -4.56813164, -23.91744784, 49.71320984], rate: [0.00000097, 0.00009149, -0.00724757, 19140.29934243, 0.45223625, -0.26852431] },
  Jupiter: { base: [5.20248019, 0.0485359, 1.29861416, 34.33479152, 14.27495244, 100.29282654], rate: [-0.00002864, 0.00018026, -0.00322699, 3034.90371757, 0.18199196, 0.13024619], extra: [-0.00012452, 0.0606406, -0.35635438, 38.35125] },
  Saturn: { base: [9.54149883, 0.05550825, 2.49424102, 50.07571329, 92.86136063, 113.63998702], rate: [-0.00003065, -0.00032044, 0.00451969, 1222.11494724, 0.54179478, -0.25015002], extra: [0.00025899, -0.13434469, 0.87320147, 38.35125] },
  Uranus: { base: [19.18797948, 0.0468574, 0.77298127, 314.20276625, 172.43404441, 73.96250215], rate: [-0.00020455, -0.0000155, -0.00180155, 428.49512595, 0.09266985, 0.05739699], extra: [0.00058331, -0.97731848, 0.17689245, 7.67025] },
  Neptune: { base: [30.06952752, 0.00895439, 1.7700552, 304.22289287, 46.68158724, 131.78635853], rate: [0.00006447, 0.00000818, 0.000224, 218.46515314, 0.01009938, -0.00606302], extra: [-0.00041348, 0.68346318, -0.10162547, 7.67025] },
};

export const PLANET_NAMES = Object.keys(TABLE1) as PlanetName[];

const DEG = Math.PI / 180;
const MS_PER_DAY = 86400000;
const JD_UNIX_EPOCH = 2440587.5;
const J2000 = 2451545.0;

export function julianDate(date: Date): number {
  return date.getTime() / MS_PER_DAY + JD_UNIX_EPOCH;
}

export function dateFromJulian(jd: number): Date {
  return new Date((jd - JD_UNIX_EPOCH) * MS_PER_DAY);
}

/** Solve Kepler's equation M = E − e sin E (radians). */
export function solveKepler(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

/** Heliocentric ecliptic J2000 position (AU) of a planet at a Julian date. */
export function heliocentricEcliptic(name: PlanetName, jd: number): [number, number, number] {
  const year = 2000 + (jd - J2000) / 365.25;
  const table = year >= 1800 && year <= 2050 ? TABLE1 : TABLE2;
  const el = table[name];
  const T = (jd - J2000) / 36525;
  const v = el.base.map((b, i) => b + el.rate[i] * T) as Row;
  const [a, e, I, L, varpi, Omega] = v;
  let M = L - varpi;
  if (table === TABLE2 && el.extra) {
    const [b, c, s, f] = el.extra;
    M += b * T * T + c * Math.cos(f * T * DEG) + s * Math.sin(f * T * DEG);
  }
  M = ((((M + 180) % 360) + 360) % 360) - 180;
  const omega = varpi - Omega;
  const E = solveKepler(M * DEG, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const co = Math.cos(omega * DEG), so = Math.sin(omega * DEG);
  const cO = Math.cos(Omega * DEG), sO = Math.sin(Omega * DEG);
  const cI = Math.cos(I * DEG), sI = Math.sin(I * DEG);
  return [
    (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp,
    (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp,
    so * sI * xp + co * sI * yp,
  ];
}

export interface PlanetState {
  name: PlanetName;
  /** Scene coordinates (ecliptic x, y, z → scene x, z, −y), AU and AU/yr. */
  pos: [number, number, number];
  vel: [number, number, number];
}

/** Ecliptic (x, y, z) → scene (x, z, −y): same convention as orbital elements elsewhere. */
function toScene([x, y, z]: [number, number, number]): [number, number, number] {
  return [x, z, -y];
}

/** Heliocentric positions and velocities of all eight planets on a date. */
export function planetStates(date: Date): PlanetState[] {
  const jd = julianDate(date);
  const h = 0.5; // days, for a central-difference velocity
  return PLANET_NAMES.map((name) => {
    const p = heliocentricEcliptic(name, jd);
    const a = heliocentricEcliptic(name, jd - h);
    const b = heliocentricEcliptic(name, jd + h);
    const perYear = 365.25 / (2 * h);
    const vel: [number, number, number] = [(b[0] - a[0]) * perYear, (b[1] - a[1]) * perYear, (b[2] - a[2]) * perYear];
    return { name, pos: toScene(p), vel: toScene(vel) };
  });
}
