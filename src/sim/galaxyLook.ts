/**
 * How a real galaxy sits in space and what it should look like on the Universe map.
 *
 * Headless (no Three.js): the orientation maths and the per-galaxy look parameters that
 * `render/galaxyShapes.ts` turns into a volumetric picture. Everything measured comes from the
 * catalogues (`LocalGalaxy`): the inclination and axis ratio from Karachentsev et al. and the
 * position angle from HyperLEDA. What no catalogue knows (which edge is nearer, which way the
 * arms wind, the arm pattern) is seeded from the galaxy's name so it is stable between visits.
 */
import { hash32, mulberry32 } from '../procgen/rng';
import { galacticToCosmos, galaxyForm, type GalaxyForm, type LocalGalaxy } from './galaxies';

export type Vec3 = [number, number, number];

/** The J2000 north celestial pole in galactic coordinates (degrees). */
export const NCP_GALACTIC = { l: 122.93192, b: 27.12825 };

/** Unit vector in galactic xyz (x toward l = 0, y toward l = 90°, z toward the north galactic pole). */
export function galacticUnit(lDeg: number, bDeg: number): Vec3 {
  const l = (lDeg * Math.PI) / 180, b = (bDeg * Math.PI) / 180;
  return [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
function normalize(a: Vec3): Vec3 {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}

/** Galactic xyz → map (scene) xyz, the convention of `galacticToCosmos`. */
export function galacticToScene(v: Vec3): Vec3 {
  return [v[0], v[2], -v[1]];
}

/**
 * The local sky directions at a point of the sky: north (toward the celestial pole, as position
 * angles are measured from) and east (increasing right ascension), both perpendicular to the
 * line of sight. Galactic xyz.
 */
export function skyBasis(lDeg: number, bDeg: number): { los: Vec3; north: Vec3; east: Vec3 } {
  const los = galacticUnit(lDeg, bDeg);
  const pole = galacticUnit(NCP_GALACTIC.l, NCP_GALACTIC.b);
  const north = normalize(add(pole, scale(los, -dot(pole, los))));
  const east = normalize(cross(pole, los));
  return { los, north, east };
}

export interface GalaxyOrientation {
  /** The disc's (or spheroid's symmetry) axis, map coordinates, unit length. */
  normal: Vec3;
  /** The major axis as seen from the Milky Way: in the disc plane and across the line of sight. */
  major: Vec3;
  /** Inclination used (degrees from face-on) and whether it and the position angle were measured. */
  inclination: number;
  measuredInclination: boolean;
  measuredPositionAngle: boolean;
  /** Intrinsic flattening of a spheroidal galaxy (short over long axis), 1 for a round one. */
  flattening: number;
}

/** A stable per-galaxy random stream. */
export function galaxyRng(g: Pick<LocalGalaxy, 'name'>): () => number {
  let h = 2166136261;
  for (const ch of g.name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return mulberry32(hash32(h, 0x6a1a));
}

/**
 * Where the galaxy's disc points. Inclination comes from the catalogue (or its axis ratio), the
 * position angle from HyperLEDA; unknown values are seeded. Which end of the minor axis is the
 * near one is never known from a picture, so that is seeded too.
 */
export function galaxyOrientation(g: LocalGalaxy): GalaxyOrientation {
  const rng = galaxyRng(g);
  const form = galaxyForm(g);
  const spheroid = form === 'elliptical' || form === 'dwarf spheroidal';
  if (g.name === 'Milky Way') {
    // The map's own plane is the galactic plane, so the disc axis is straight up.
    return { normal: [0, 1, 0], major: [1, 0, 0], inclination: 0, measuredInclination: true, measuredPositionAngle: true, flattening: 1 };
  }
  const { los, north, east } = skyBasis(g.l, g.b);
  const paKnown = g.pa !== undefined && Number.isFinite(g.pa);
  const pa = ((paKnown ? g.pa! : rng() * 180) * Math.PI) / 180;
  const majorG: Vec3 = normalize(add(scale(north, Math.cos(pa)), scale(east, Math.sin(pa))));
  const minorG = cross(los, majorG); // across the line of sight, along the apparent minor axis

  // Inclination: measured, else from the axis ratio of a disc, else random (uniform in cos i).
  let inc: number;
  let measuredInclination = true;
  if (g.inc !== undefined && Number.isFinite(g.inc)) inc = Math.min(90, Math.max(0, g.inc));
  else if (g.ba !== undefined && Number.isFinite(g.ba)) {
    const q0 = spheroid ? 0.5 : 0.2;
    const ba = Math.min(1, Math.max(q0, g.ba));
    inc = (Math.acos(Math.sqrt((ba * ba - q0 * q0) / (1 - q0 * q0))) * 180) / Math.PI;
  } else {
    inc = (Math.acos(rng()) * 180) / Math.PI;
    measuredInclination = false;
  }
  // A spheroid's intrinsic flattening that shows the observed axis ratio at that inclination.
  let flattening = 1;
  if (spheroid) {
    const ba = Math.min(1, Math.max(0.3, g.ba ?? 0.8));
    const s = Math.sin((inc * Math.PI) / 180), c = Math.cos((inc * Math.PI) / 180);
    flattening = s > 0.05 && ba > c ? Math.min(1, Math.max(0.3, Math.sqrt((ba * ba - c * c) / (s * s)))) : ba;
  }
  const near = rng() < 0.5 ? 1 : -1;
  const i = (inc * Math.PI) / 180;
  const normalG = normalize(add(scale(los, Math.cos(i)), scale(minorG, Math.sin(i) * near)));
  return {
    normal: galacticToScene(normalG),
    major: galacticToScene(majorG),
    inclination: inc,
    measuredInclination,
    measuredPositionAngle: paKnown,
    flattening,
  };
}

/** Numeric form codes shared with the shader. */
export const FORM_CODE: Record<GalaxyForm, number> = { spiral: 0, lenticular: 1, elliptical: 2, irregular: 3, 'dwarf spheroidal': 4 };

export interface GalaxyLook {
  form: number;
  /** Bulge (or whole spheroid) scale as a fraction of the radius, its weight relative to the disc, and flattening. */
  bulgeScale: number;
  bulgeWeight: number;
  flattening: number;
  /** Disc scale height as a fraction of the radius. */
  scaleHeight: number;
  /** Spiral arms: count, pitch angle (radians, negative for the other winding) and contrast. */
  arms: number;
  pitch: number;
  armContrast: number;
  /** Dust optical depth factor (0 for gas-poor galaxies). */
  dust: number;
  /** Mean surface brightness relative to a big spiral (compressed; ~0.35–1.8). */
  surfaceBrightness: number;
  /** How blue the stellar population is (0 old and yellow, 1 young and blue). */
  blue: number;
  /** Seed in [0, 1) for the shader's noise. */
  seed: number;
}

/** Hand-tuned looks for a few famous galaxies whose pictures everyone knows. */
const LOOK_OVERRIDES: Record<string, Partial<GalaxyLook>> = {
  NGC5128: { dust: 1.8, bulgeWeight: 1.1, bulgeScale: 0.3 }, // Centaurus A: an elliptical body with a thick dust lane
  MESSIER104: { dust: 1.5, bulgeWeight: 1.4, bulgeScale: 0.28, armContrast: 0.2 }, // Sombrero
  MESSIER082: { dust: 1.3, blue: 0.4, armContrast: 0 }, // Cigar: a starburst edge-on, no grand design
  MESSIER033: { armContrast: 1.1, blue: 0.85 }, // Triangulum: flocculent and blue
  MESSIER101: { armContrast: 1.2, blue: 0.8 },
  NGC5194: { arms: 2, armContrast: 1.3 }, // Whirlpool: grand design
  MESSIER081: { arms: 2, armContrast: 1.1 },
  MESSIER031: { arms: 2, armContrast: 0.9, dust: 1.1 },
};

/**
 * Look parameters from the catalogue entry: bulge size and weight follow the Hubble type, dust
 * follows the gas fraction, and the mean surface brightness follows luminosity over area.
 */
export function galaxyLook(g: LocalGalaxy, orientation = galaxyOrientation(g)): GalaxyLook {
  const rng = galaxyRng({ name: `${g.name}:look` });
  const form = galaxyForm(g);
  const t = g.name === 'Milky Way' ? 4 : (g.t ?? 9);
  // 0 for the earliest spirals (Sa), 1 for the latest (Sd/Sm).
  const late = Math.min(1, Math.max(0, (t - 1) / 7));
  let look: GalaxyLook = {
    form: FORM_CODE[form],
    bulgeScale: 0.1,
    bulgeWeight: 0.4,
    flattening: orientation.flattening,
    scaleHeight: 0.06,
    arms: 2,
    pitch: 0.2,
    armContrast: 0,
    dust: 0,
    surfaceBrightness: 0.8,
    blue: 0.5,
    seed: rng(),
  };
  // Gas richness relative to starlight: dwarf irregulars are near 1, big spirals ~0.05, ellipticals ~0.
  const gasToLight = g.hi !== undefined && g.lk !== undefined ? Math.pow(10, g.hi - g.lk) : form === 'spiral' ? 0.08 : form === 'irregular' ? 0.6 : 0;
  const gas = Math.min(1.5, Math.max(0, gasToLight * 12));
  const chirality = rng() < 0.5 ? 1 : -1;
  switch (form) {
    case 'spiral':
      look.bulgeScale = 0.05 + 0.1 * (1 - late);
      look.bulgeWeight = 0.12 + 0.9 * (1 - late) ** 2;
      look.arms = g.name === 'Milky Way' ? 4 : late > 0.7 && rng() < 0.5 ? 3 : rng() < 0.15 ? 4 : 2;
      look.pitch = chirality * ((8 + 16 * late) * Math.PI) / 180;
      look.armContrast = 0.45 + 0.7 * late;
      look.dust = Math.max(0.35, Math.min(1.4, 0.6 + 0.5 * gas));
      look.blue = 0.25 + 0.6 * late;
      look.scaleHeight = 0.045;
      break;
    case 'lenticular':
      look.bulgeScale = 0.18;
      look.bulgeWeight = 1.6;
      look.dust = Math.min(1, 0.1 + 0.6 * gas);
      look.blue = 0.1;
      look.scaleHeight = 0.05;
      break;
    case 'elliptical':
      look.bulgeScale = 0.3;
      look.bulgeWeight = 1;
      look.blue = 0.05;
      break;
    case 'dwarf spheroidal':
      look.bulgeScale = 0.4;
      look.bulgeWeight = 0.5;
      look.blue = 0.15;
      break;
    case 'irregular':
      look.bulgeScale = 0.15;
      look.bulgeWeight = 0.1;
      look.scaleHeight = 0.14;
      look.dust = Math.min(0.8, 0.2 + 0.4 * gas);
      look.blue = 0.9;
      break;
  }
  // Mean K-band surface brightness, luminosity over diameter squared, relative to about M31's.
  if (g.lk !== undefined && g.size) {
    const sb = Math.pow(10, g.lk) / (g.size * g.size) / 2.8e7;
    look.surfaceBrightness = Math.min(1.8, Math.max(0.35, Math.sqrt(sb)));
  } else if (form === 'dwarf spheroidal') look.surfaceBrightness = 0.4;
  look = { ...look, ...LOOK_OVERRIDES[g.name.trim()] };
  return look;
}

/** The centre of a galaxy on the map (Mpc). The Milky Way's centre is 8.2 kpc from the Sun, which is the origin. */
export function galaxyCentre(g: LocalGalaxy): Vec3 {
  return g.name === 'Milky Way' ? galacticToCosmos(0, 0, 0.0082) : galacticToCosmos(g.l, g.b, g.d);
}

/** Radius (Mpc) of the galaxy's picture: half the catalogue diameter (the Milky Way is 30 kpc across). */
export function galaxyRadius(g: LocalGalaxy): number {
  return ((g.name === 'Milky Way' ? 30 : (g.size ?? 1)) / 1000) / 2;
}
