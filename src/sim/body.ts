import { BLACK_HOLE_COLLAPSE_MASS, EARTH_MASS, GAS_GIANT_MIN_MASS, STAR_MIN_MASS } from './units';
import { starColor } from './color';

export type BodyKind = 'rocky' | 'gas' | 'star' | 'blackhole';

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
}

export interface BodyInit {
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
}

const KIND_RANK: Record<BodyKind, number> = { rocky: 0, gas: 1, star: 2, blackhole: 3 };

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
  return (Object.keys(KIND_RANK) as BodyKind[]).find((k) => KIND_RANK[k] === best)!;
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
    case 'blackhole':
      return 0.04 * Math.pow(mass, 0.4);
  }
}

/** Rough main-sequence luminosity in L☉. */
export function luminosity(body: Pick<Body, 'kind' | 'mass'>): number {
  if (body.kind !== 'star') return 0;
  return Math.pow(body.mass, 3.5);
}

export function defaultColor(kind: BodyKind, mass: number): number {
  switch (kind) {
    case 'star':
      return starColor(mass);
    case 'blackhole':
      return 0x000000;
    case 'gas':
      return 0xd8b48a;
    case 'rocky':
      return 0x8a8f99;
  }
}

let nextId = 1;

export function createBody(init: BodyInit): Body {
  const kind = init.kind ?? kindForMass(init.mass);
  return {
    id: nextId++,
    name: init.name ?? `Body ${nextId - 1}`,
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
  };
}
