import { BodyKind, luminosity, radiusFor } from '../sim/body';
import { GAS_PALETTE, ROCKY_PALETTE, starColor, starTemperature } from '../sim/color';
import { hillRadius } from '../sim/orbits';
import { EARTH_MASS } from '../sim/units';
import { moonName, planetName, starName } from './names';
import { Rng, intRange, logRange, mulberry32, pick, range, weighted } from './rng';

export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M';

/** Frequencies are boosted for rarer classes so the galaxy is more varied than reality (where ~75% are M dwarfs). */
const CLASS_WEIGHTS: readonly (readonly [SpectralClass, number])[] = [
  ['M', 0.6],
  ['K', 0.15],
  ['G', 0.1],
  ['F', 0.07],
  ['A', 0.045],
  ['B', 0.025],
  ['O', 0.01],
];

const CLASS_MASS: Record<SpectralClass, [number, number]> = {
  M: [0.1, 0.5],
  K: [0.5, 0.8],
  G: [0.8, 1.05],
  F: [1.05, 1.4],
  A: [1.4, 2.1],
  B: [2.1, 16],
  O: [16, 35],
};

export interface StarSummary {
  name: string;
  spectralClass: SpectralClass;
  mass: number;
  temperature: number;
  color: number;
}

export interface MoonSpec {
  name: string;
  mass: number;
  a: number;
  inc: number;
  nu: number;
  color: number;
}

export interface PlanetSpec {
  name: string;
  kind: BodyKind;
  mass: number;
  a: number;
  e: number;
  inc: number;
  lan: number;
  argp: number;
  nu: number;
  color: number;
  moons: MoonSpec[];
}

export interface CompanionSpec extends StarSummary {
  a: number;
  e: number;
  nu: number;
}

export interface BeltSpec {
  inner: number;
  outer: number;
  count: number;
}

export interface StarSystemSpec {
  seed: number;
  star: StarSummary;
  companion?: CompanionSpec;
  planets: PlanetSpec[];
  belt?: BeltSpec;
}

function makeStar(rng: Rng, spectralClass: SpectralClass): StarSummary {
  const [lo, hi] = CLASS_MASS[spectralClass];
  const mass = logRange(rng, lo, hi);
  return { name: '', spectralClass, mass, temperature: starTemperature(mass), color: starColor(mass) };
}

function classForMass(mass: number): SpectralClass {
  return (Object.keys(CLASS_MASS) as SpectralClass[]).find((c) => mass >= CLASS_MASS[c][0] && mass <= CLASS_MASS[c][1]) ?? 'M';
}

/**
 * The star at a galaxy position is fully determined by its seed. This is the cheap
 * part used to colour all the stars on the galaxy map.
 */
export function starSummary(seed: number): StarSummary {
  const rng = mulberry32(seed);
  const spectralClass = weighted(rng, CLASS_WEIGHTS);
  const star = makeStar(rng, spectralClass);
  star.name = starName(rng);
  return star;
}

/** Full, deterministic star system for a seed. Starts from the same RNG stream as `starSummary`. */
export function generateStarSystem(seed: number): StarSystemSpec {
  const rng = mulberry32(seed);
  const spectralClass = weighted(rng, CLASS_WEIGHTS);
  const star = makeStar(rng, spectralClass);
  star.name = starName(rng);
  const starRadius = radiusFor('star', star.mass);

  // Optional wide binary companion. Planets stay well inside its orbit.
  let companion: CompanionSpec | undefined;
  let outerLimit = 60;
  if (rng() < 0.22) {
    const cMass = Math.max(0.1, star.mass * range(rng, 0.15, 0.8));
    const a = range(rng, 25, 70);
    companion = {
      name: `${star.name} B`,
      spectralClass: classForMass(cMass),
      mass: cMass,
      temperature: starTemperature(cMass),
      color: starColor(cMass),
      a,
      e: range(rng, 0, 0.3),
      nu: range(rng, 0, Math.PI * 2),
    };
    outerLimit = (a * (1 - companion.e)) / 3.5;
  }

  const L = luminosity({ kind: 'star', mass: star.mass });
  const frostLine = 2.7 * Math.sqrt(L);
  const planetCount = weighted(rng, [
    [0, 0.06], [1, 0.08], [2, 0.1], [3, 0.13], [4, 0.15], [5, 0.15], [6, 0.12], [7, 0.1], [8, 0.07], [9, 0.04],
  ] as const);

  const planets: PlanetSpec[] = [];
  let a = Math.max(starRadius * 4, 0.25) * range(rng, 1, 1.8);
  let prevMass = 0;
  for (let i = 0; i < planetCount && a < outerLimit; i++) {
    const beyondFrost = a > frostLine;
    const isGas = rng() < (beyondFrost ? 0.65 : 0.12);
    const kind: BodyKind = isGas ? 'gas' : 'rocky';
    const mass = isGas ? logRange(rng, 12, 1500) * EARTH_MASS : logRange(rng, 0.05, 8) * EARTH_MASS;

    // Keep neighbours at least ~10 mutual Hill radii apart so systems are stable-ish.
    if (prevMass > 0) {
      const prevA = planets[planets.length - 1].a;
      const mutualHill = Math.cbrt((prevMass + mass) / (3 * star.mass)) * ((prevA + a) / 2);
      a = Math.max(a, prevA + 10 * mutualHill, prevA + 0.2);
      if (a >= outerLimit) break;
    }

    const name = planetName(star.name, i);
    const color = pick(rng, isGas ? GAS_PALETTE : ROCKY_PALETTE);
    const planet: PlanetSpec = {
      name,
      kind,
      mass,
      a,
      e: range(rng, 0, 0.08),
      inc: range(rng, -0.04, 0.04),
      lan: range(rng, 0, Math.PI * 2),
      argp: range(rng, 0, Math.PI * 2),
      nu: range(rng, 0, Math.PI * 2),
      color,
      moons: [],
    };

    // Moons: only where they fit between the (inflated) planet surface and ~40% of the Hill sphere.
    const pr = radiusFor(kind, mass);
    const hill = hillRadius(a, mass, star.mass);
    let ma = pr * 3;
    const maxMoonA = hill * 0.4;
    const moonCount = isGas ? intRange(rng, 0, 4) : rng() < 0.15 ? 1 : 0;
    for (let m = 0; m < moonCount && ma < maxMoonA; m++) {
      planet.moons.push({
        name: moonName(name, m),
        mass: logRange(rng, 0.005, 0.1) * EARTH_MASS,
        a: ma,
        inc: range(rng, -0.05, 0.05),
        nu: range(rng, 0, Math.PI * 2),
        color: pick(rng, ROCKY_PALETTE),
      });
      ma *= range(rng, 1.5, 2.0);
    }

    planets.push(planet);
    prevMass = mass;
    a *= range(rng, 1.45, 2.1);
  }

  // Asteroid belt in the widest gap between neighbouring planets (or just past the last one).
  let belt: BeltSpec | undefined;
  if (rng() < 0.45) {
    let best: [number, number] | undefined;
    let bestRatio = 2.2;
    for (let i = 0; i + 1 < planets.length; i++) {
      const ratio = planets[i + 1].a / planets[i].a;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = [planets[i].a * 1.35, planets[i + 1].a * 0.72];
      }
    }
    if (!best && planets.length > 0) {
      const last = planets[planets.length - 1].a;
      if (last * 1.8 < outerLimit) best = [last * 1.4, last * 1.8];
    }
    if (best && best[1] > best[0]) belt = { inner: best[0], outer: best[1], count: intRange(rng, 500, 1500) };
  }

  return { seed, star, companion, planets, belt };
}
