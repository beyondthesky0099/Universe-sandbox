import type { BodyKind } from './body';
import { kelvinToRgb, rgbToHex } from './color';
import type { ExoCatalog } from './exoplanets';
import { hostPosition } from './exoplanets';
import type { SceneSetup } from './presets';
import type { Simulation } from './simulation';

/**
 * Real stars from the HYG database v4.1 (David Nash / astronexus, CC BY-SA 4.0), built by
 * scripts/build-stars.mjs. Positions are ecliptic J2000.
 */

export const STAR_CREDIT = 'Star data: HYG database v4.1 by David Nash (astronexus), CC BY-SA 4.0.';
export const AU_PER_PC = 206264.806;

export interface NearStar {
  id: number;
  name: string;
  /** Ecliptic J2000 position in parsecs, Sun at the origin. */
  xyz: [number, number, number];
  mag: number;
  absmag: number;
  spect?: string;
  /** B−V colour index. */
  ci?: number;
  /** Visual luminosity in solar units. */
  lum: number;
  companionOf?: number;
}

/** [x, y, z unit vector (ecliptic), magnitude, B−V, proper name?] */
export type BrightStar = [number, number, number, number, number, string?];

/** Effective temperature from B−V (Ballesteros 2012). */
export function temperatureFromBV(bv: number): number {
  const c = Math.max(-0.4, Math.min(2.0, bv));
  return 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62));
}

export interface StarPhysics {
  kind: BodyKind;
  /** Estimated mass in solar masses. */
  mass: number;
  temperature: number;
  color: number;
}

/**
 * Kind, mass and colour of a catalogued star. Masses are estimates: white dwarfs get 0.6 M☉,
 * giants 1.5 M☉, and main-sequence stars a piecewise mass–luminosity relation (visual
 * luminosity, so cool red dwarfs come out a little light).
 */
export function starPhysics(s: Pick<NearStar, 'spect' | 'ci' | 'lum'>): StarPhysics {
  const spect = s.spect ?? '';
  const temperature = temperatureFromBV(s.ci ?? 0.65);
  const color = rgbToHex(kelvinToRgb(temperature));
  if (/^D[ABCOQZX]?/.test(spect)) return { kind: 'whitedwarf', mass: 0.6, temperature, color };
  // Luminosity classes I–III (supergiants and giants), but not IV/V.
  if (/(?:^|[^IV])(?:Ia|Ib|II|III)(?![IV])/.test(spect.replace(/^[a-z]+/, ''))) return { kind: 'giant', mass: 1.5, temperature, color };
  const L = Math.max(1e-5, s.lum);
  let mass: number;
  if (L < 0.033) mass = Math.pow(L / 0.23, 1 / 2.3);
  else if (L < 16) mass = Math.pow(L, 0.25);
  else mass = Math.pow(L / 1.4, 1 / 3.5);
  return { kind: 'star', mass: Math.min(60, Math.max(0.08, mass)), temperature, color };
}

/** Ecliptic (x, y, z) → scene (x, z, −y). */
function scene([x, y, z]: [number, number, number]): [number, number, number] {
  return [x, z, -y];
}

let nearPromise: Promise<NearStar[]> | undefined;
let brightPromise: Promise<BrightStar[]> | undefined;

export function loadNearStars(baseUrl = import.meta.env.BASE_URL): Promise<NearStar[]> {
  nearPromise ??= fetch(`${baseUrl}data/stars-near.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the star catalogue (${r.status})`);
      return r.json() as Promise<{ stars: NearStar[] }>;
    })
    .then((d) => d.stars);
  return nearPromise;
}

export function loadBrightStars(baseUrl = import.meta.env.BASE_URL): Promise<BrightStar[]> {
  brightPromise ??= fetch(`${baseUrl}data/stars-bright.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the bright-star catalogue (${r.status})`);
      return r.json() as Promise<{ stars: BrightStar[] }>;
    })
    .then((d) => d.stars);
  return brightPromise;
}

/**
 * The real solar neighbourhood: every catalogued star within `maxPc` parsecs at its true
 * position, as a static map (gravity off). Stars that host known exoplanets are tagged so they
 * can be visited.
 */
export function loadStarNeighbourhood(sim: Simulation, stars: NearStar[], catalog: ExoCatalog | undefined, maxPc = 10): SceneSetup {
  sim.gravityScale = 0;
  sim.collisions = false;
  sim.tidal = false;
  sim.addBody({ name: 'Sun', kind: 'star', mass: 1, tag: 'home', radius: 3000, color: rgbToHex(kelvinToRgb(5772)) });
  // Exoplanet hosts near the Sun, matched to catalogue stars by position (within 0.05 pc).
  const hosts = (catalog?.hosts ?? []).filter((h) => h.distancePc <= maxPc + 1).map((h) => ({ h, p: hostPosition(h) }));
  let farthest = 1;
  let hostCount = 0;
  for (const s of stars) {
    const d = Math.hypot(...s.xyz);
    if (d > maxPc) continue;
    const phys = starPhysics(s);
    const [x, y, z] = scene(s.xyz).map((v) => v * AU_PER_PC) as [number, number, number];
    farthest = Math.max(farthest, d * AU_PER_PC);
    const match = hosts.find(({ p }) => Math.hypot(p[0] - x, p[1] - y, p[2] - z) < 0.05 * AU_PER_PC);
    if (match) hostCount++;
    sim.addBody({
      name: s.name,
      kind: phys.kind,
      mass: phys.mass,
      // Not to scale: sized by luminosity so bright stars stand out on the map.
      radius: 1500 * Math.min(4, Math.max(0.5, Math.pow(s.lum, 0.2))),
      color: phys.color,
      x,
      y,
      z,
      tag: match ? `exohost:${match.h.name}` : undefined,
    });
  }
  return {
    cameraDistance: farthest * 1.5,
    timeScale: 0.001,
    elevation: 0.5,
    tip: `All ${sim.bodies.length - 1} catalogued stars within ${maxPc} parsecs (${(maxPc * 3.2616).toFixed(0)} light-years) at their real positions${
      hostCount ? `; ${hostCount} host known exoplanets (select one and press "Visit system")` : ''
    }. ${STAR_CREDIT} Masses are estimated from spectral type and brightness.`,
  };
}

/** Bright-star positions on the unit sphere in scene coordinates, with colours and sizes. */
export function skyPoints(stars: BrightStar[]): { pos: Float32Array; col: Float32Array; size: Float32Array } {
  const pos = new Float32Array(stars.length * 3);
  const col = new Float32Array(stars.length * 3);
  const size = new Float32Array(stars.length);
  stars.forEach(([x, y, z, mag, bv], i) => {
    const [sx, sy, sz] = scene([x, y, z]);
    pos.set([sx, sy, sz], i * 3);
    const [r, g, b] = kelvinToRgb(temperatureFromBV(bv));
    // Flux relative to a magnitude-6.5 star, compressed so faint stars stay visible.
    const flux = Math.pow(10, -0.4 * (mag - 6.5));
    const brightness = Math.min(1, 0.18 + 0.12 * Math.log2(1 + flux));
    col.set([r * brightness, g * brightness, b * brightness], i * 3);
    size[i] = Math.min(7, 1.4 + 0.55 * Math.log2(1 + flux) * 0.6);
  });
  return { pos, col, size };
}
