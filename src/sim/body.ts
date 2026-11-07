import { BLACK_HOLE_COLLAPSE_MASS, EARTH_MASS, GAS_GIANT_MIN_MASS, JUPITER_MASS, STAR_MIN_MASS } from './units';
import { kelvinToRgb, rgbToHex, starColor } from './color';

export type BodyKind = 'rocky' | 'gas' | 'star' | 'giant' | 'whitedwarf' | 'neutron' | 'blackhole';

/** Every kind, in rank order (used for compact encodings). */
export const BODY_KINDS: BodyKind[] = ['rocky', 'gas', 'star', 'giant', 'whitedwarf', 'neutron', 'blackhole'];

export interface Body {
  id: number;
  name: string;
  kind: BodyKind;
  mass: number;
  /** Game radius in AU. Exaggerated relative to reality so bodies are visible. Used for rendering and collisions. */
  radius: number;
  color: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ax: number;
  ay: number;
  az: number;
  /** Age in years (drives stellar evolution). */
  age: number;
  /** Optional role marker, e.g. 'probe' or 'target'. */
  tag?: string;
  /** Remaining delta-v budget (AU/yr) for probes. */
  fuel?: number;
  /**
   * Stars: metallicity Z/Z☉ (1 = the Sun's mix; 0.1 = a metal-poor halo star). Sets how much
   * mass winds strip and so how the star dies (stellarFate.ts). Undefined means solar.
   */
  metallicity?: number;
  /** Black holes: dimensionless spin a* = cJ/GM² (0 … 0.998; kerr.ts). Undefined means not spinning. */
  spin?: number;
}

export interface BodyInit {
  /** Explicit id (used when restoring saved state). */
  id?: number;
  name?: string;
  kind?: BodyKind;
  mass: number;
  radius?: number;
  color?: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  age?: number;
  tag?: string;
  fuel?: number;
  metallicity?: number;
  spin?: number;
}

const KIND_RANK: Record<BodyKind, number> = { rocky: 0, gas: 1, star: 2, giant: 3, whitedwarf: 4, neutron: 5, blackhole: 6 };

/** White dwarfs heavier than this explode (Chandrasekhar limit). */
export const CHANDRASEKHAR_MASS = 1.4;

/** Neutron stars heavier than this collapse into black holes. */
export const NEUTRON_MAX_MASS = 2.5;

/**
 * Nominal bulk densities (g/cm³) used for tidal (Roche) limits. Game radii are inflated,
 * so densities derived from them would be meaningless.
 */
export const NOMINAL_DENSITY: Record<BodyKind, number> = {
  rocky: 5.5,
  gas: 1.3,
  star: 1.4,
  giant: 1e-6,
  whitedwarf: 1e6,
  neutron: 1e14,
  blackhole: Infinity,
};

/** Dense stellar remnants: tidal disruption uses the r_t ≈ R (M/m)^⅓ formula around these. */
export function isCompact(kind: BodyKind): boolean {
  return kind === 'whitedwarf' || kind === 'neutron' || kind === 'blackhole';
}

/** Anything that shines and heats planets. */
export function isLuminous(kind: BodyKind): boolean {
  return kind === 'star' || kind === 'giant' || kind === 'whitedwarf';
}

/** What a body of this mass naturally is. */
export function kindForMass(mass: number): BodyKind {
  if (mass >= BLACK_HOLE_COLLAPSE_MASS) return 'blackhole';
  if (mass >= STAR_MIN_MASS) return 'star';
  if (mass >= GAS_GIANT_MIN_MASS) return 'gas';
  return 'rocky';
}

/** Kind of the body produced by merging two bodies. Never "downgrades" (a black hole stays a black hole). */
export function mergedKind(a: BodyKind, b: BodyKind, totalMass: number): BodyKind {
  const natural = kindForMass(totalMass);
  const best = Math.max(KIND_RANK[a], KIND_RANK[b], KIND_RANK[natural]);
  const kind = (Object.keys(KIND_RANK) as BodyKind[]).find((k) => KIND_RANK[k] === best)!;
  return kind === 'neutron' && totalMass >= NEUTRON_MAX_MASS ? 'blackhole' : kind;
}

/**
 * Game radius (AU) for a body. Real radii are far too small to see or collide at
 * solar-system scales, so these are deliberately inflated while staying ordered
 * sensibly (asteroid < earth < jupiter < sun < blue giant).
 */
export function radiusFor(kind: BodyKind, mass: number): number {
  switch (kind) {
    case 'rocky':
      return 0.012 * Math.pow(mass / EARTH_MASS, 0.3);
    case 'gas':
      return Math.min(0.075, 0.012 * Math.pow(mass / EARTH_MASS, 0.3));
    case 'star':
      return Math.min(1.2, Math.max(0.08, 0.15 * Math.pow(mass, 0.6)));
    case 'giant':
      return Math.min(3, Math.max(0.5, 0.9 * Math.pow(mass, 0.4)));
    case 'whitedwarf':
      return 0.03;
    case 'neutron':
      return 0.02;
    case 'blackhole':
      return 0.04 * Math.pow(mass, 0.4);
  }
}

const R_EARTH_AU = 6371 / 149597870.7;
const R_JUPITER_AU = 69911 / 149597870.7;
const R_SUN_AU = 695700 / 149597870.7;

/**
 * Physical (true) radius in AU from kind and mass, for "Real sizes" mode. Approximate
 * mass–radius relations: rocky planets R ∝ M^0.27; ice and gas giants grow up to about
 * Jupiter's radius and then stay there; main-sequence stars R ∝ M^0.8 (M < 1) or M^0.57;
 * white dwarfs shrink as they get heavier; neutron stars are 12 km; black holes use the
 * Schwarzschild radius 2GM/c².
 */
export function physicalRadius(kind: BodyKind, mass: number): number {
  const mJ = mass / JUPITER_MASS;
  switch (kind) {
    case 'rocky':
      return R_EARTH_AU * Math.pow(mass / EARTH_MASS, 0.27);
    case 'gas':
      if (mJ < 0.3) return R_JUPITER_AU * 0.84 * Math.pow(mJ / 0.3, 0.45);
      if (mJ < 1) return R_JUPITER_AU * Math.pow(mJ, 0.145);
      return R_JUPITER_AU;
    case 'star':
      return R_SUN_AU * Math.pow(mass, mass < 1 ? 0.8 : 0.57);
    case 'giant':
      return 50 * R_SUN_AU * Math.sqrt(mass);
    case 'whitedwarf':
      return 0.0127 * R_SUN_AU * Math.pow(mass / 0.6, -1 / 3);
    case 'neutron':
      return 12 / 149597870.7;
    case 'blackhole':
      // 2GM/c² with G = 4π² AU³/(M☉ yr²) and c = 63,241 AU/yr
      return (2 * 4 * Math.PI * Math.PI * mass) / (63241.077 * 63241.077);
  }
}

/** Main-sequence lifetime in years: ~10 Gyr for the Sun, much shorter for massive stars. */
export function mainSequenceLifetime(mass: number): number {
  return 1e10 * Math.pow(Math.max(mass, 0.08), -2.5);
}

export function kindRank(kind: BodyKind): number {
  return KIND_RANK[kind];
}

/** Rough luminosity in L☉. */
export function luminosity(body: Pick<Body, 'kind' | 'mass'>): number {
  switch (body.kind) {
    case 'star':
      return Math.pow(body.mass, 3.5);
    case 'giant':
      return Math.max(100, 1000 * body.mass);
    case 'whitedwarf':
      return 0.003;
    default:
      return 0;
  }
}

export function defaultColor(kind: BodyKind, mass: number): number {
  switch (kind) {
    case 'star':
      return starColor(mass);
    case 'blackhole':
      return 0x000000;
    case 'neutron':
      return 0xcfe6ff;
    case 'giant':
      return rgbToHex(kelvinToRgb(3500));
    case 'whitedwarf':
      return 0xeaf2ff;
    case 'gas':
      return 0xd8b48a;
    case 'rocky':
      return 0x8a8f99;
  }
}

let nextId = 1;

export function createBody(init: BodyInit): Body {
  const kind = init.kind ?? kindForMass(init.mass);
  let id: number;
  if (init.id !== undefined) {
    id = init.id;
    nextId = Math.max(nextId, id + 1);
  } else {
    id = nextId++;
  }
  return {
    id,
    name: init.name ?? `Body ${id}`,
    kind,
    mass: init.mass,
    radius: init.radius ?? radiusFor(kind, init.mass),
    color: init.color ?? defaultColor(kind, init.mass),
    x: init.x ?? 0,
    y: init.y ?? 0,
    z: init.z ?? 0,
    vx: init.vx ?? 0,
    vy: init.vy ?? 0,
    vz: init.vz ?? 0,
    ax: 0,
    ay: 0,
    az: 0,
    age: init.age ?? 0,
    tag: init.tag,
    fuel: init.fuel,
    ...(init.metallicity !== undefined ? { metallicity: init.metallicity } : {}),
    ...(init.spin !== undefined ? { spin: init.spin } : {}),
  };
}
