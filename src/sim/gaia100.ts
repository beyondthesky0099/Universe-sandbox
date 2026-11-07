import { kelvinToRgb, rgbToHex } from './color';
import type { SceneSetup } from './presets';
import type { Simulation } from './simulation';
import { AU_PER_PC, starPhysics, type NearStar } from './stars';

/**
 * Every star within 100 parsecs brighter than Gaia G = 11 (scripts/build-stars-100pc.mjs), from
 * ESA Gaia DR3: heliocentric ecliptic J2000 positions (pc) and velocities (km/s).
 */
export interface Stars100 {
  stride: number;
  /** Flat rows of x, y, z (pc), vx, vy, vz (km/s), Teff (K), absolute G, radial velocity known (1/0). */
  stars: number[];
  /** [row index, proper name] for named bright stars. */
  names: [number, string][];
}

export const GAIA_100PC_CREDIT = 'Star data: ESA Gaia DR3 (Gaia Collaboration, Vallenari et al. 2023); names and the brightest stars from the HYG database v4.1 (CC BY-SA 4.0).';
const KMS_TO_AU_PER_YR = 1 / 4.740470463;

let promise: Promise<Stars100> | undefined;
export function loadStars100(baseUrl = import.meta.env.BASE_URL): Promise<Stars100> {
  promise ??= fetch(`${baseUrl}data/stars-100pc.json`).then((r) => {
    if (!r.ok) throw new Error(`Couldn't load the Gaia 100-parsec stars (${r.status})`);
    return r.json() as Promise<Stars100>;
  });
  return promise;
}

/** Ecliptic (x, y, z) → scene (x, z, −y). */
const scene = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];

/** Rough main-sequence mass from absolute G magnitude (luminosity^0.25, clamped). */
function massFromAbsG(absG: number): number {
  const L = 10 ** (-0.4 * (absG - 4.67));
  return Math.min(20, Math.max(0.08, L ** 0.25));
}

/**
 * The solar neighbourhood out to 100 parsecs: 44,500 Gaia stars as moving points (gravity off,
 * so each follows its measured straight-line motion), the named and brightest ones as labelled
 * bodies. `near` (the 20-parsec HYG list) adds the very brightest stars, which Gaia cannot
 * measure (Sirius, Vega, Arcturus, ...).
 */
export function loadNeighbourhood100(sim: Simulation, data: Stars100, near: NearStar[] = []): SceneSetup {
  sim.gravityScale = 0;
  sim.collisions = false;
  sim.tidal = false;
  sim.dtMax = 500;
  // Stars, not debris: keep them however far they travel, and let them pass each other.
  sim.particleCullDistance = 1e12;
  sim.absorbParticles = false;
  sim.addBody({ name: 'Sun', kind: 'star', mass: 1, tag: 'home', radius: 30000, color: rgbToHex(kelvinToRgb(5772)) });
  const named = new Map(data.names);
  const s = data.stars;
  const k = data.stride;
  let particles = 0;
  let bodies = 0;
  for (let i = 0; i * k < s.length; i++) {
    const o = i * k;
    const [x, y, z] = scene(s[o] * AU_PER_PC, s[o + 1] * AU_PER_PC, s[o + 2] * AU_PER_PC);
    const [vx, vy, vz] = scene(s[o + 3] * KMS_TO_AU_PER_YR, s[o + 4] * KMS_TO_AU_PER_YR, s[o + 5] * KMS_TO_AU_PER_YR);
    const teff = s[o + 6];
    const absG = s[o + 7];
    const rgb = kelvinToRgb(teff);
    const name = named.get(i);
    if (name) {
      sim.addBody({ name, kind: 'star', mass: massFromAbsG(absG), radius: 18000, color: rgbToHex(rgb), x, y, z, vx, vy, vz });
      bodies++;
    } else {
      // Brighter stars are brighter points.
      const b = Math.min(1, 0.22 + 0.78 * Math.pow(10, -0.4 * (absG - 1)) ** 0.25);
      if (sim.particles.add(x, y, z, vx, vy, vz, [rgb[0] * b, rgb[1] * b, rgb[2] * b]) >= 0) particles++;
    }
  }
  // The brightest stars are missing from Gaia's astrometry: take them from HYG (within 20 pc)
  // unless this sample already has a star about as luminous at the same place. (A faint
  // companion such as Sirius B, which Gaia does measure, doesn't count.)
  const inGaia = (p: [number, number, number], absMag: number) => {
    for (let o = 0; o < s.length; o += k) {
      if (Math.hypot(s[o] - p[0], s[o + 1] - p[1], s[o + 2] - p[2]) < 0.2 && Math.abs(s[o + 7] - absMag) < 2) return true;
    }
    return false;
  };
  for (const st of near) {
    if (st.mag > 3 || !st.v || inGaia(st.xyz, st.absmag)) continue;
    const [x, y, z] = scene(...(st.xyz.map((c) => c * AU_PER_PC) as [number, number, number]));
    const [vx, vy, vz] = scene(...(st.v.map((c) => c * AU_PER_PC) as [number, number, number]));
    const phys = starPhysics(st);
    sim.addBody({ name: st.name, kind: phys.kind, mass: phys.mass, radius: 18000, color: phys.color, x, y, z, vx, vy, vz });
    bodies++;
  }
  return {
    cameraDistance: 100 * AU_PER_PC * 1.7,
    timeScale: 20000,
    maxTimeScale: 1e7,
    elevation: 0.45,
    tip: `Every star within 326 light-years (100 parsecs) brighter than Gaia magnitude 11: ${(particles + bodies).toLocaleString('en-US')} stars at their measured positions, each moving with its real velocity (Gaia's proper motion and radial velocity; about 10% have no radial velocity and move only across the sky). Speed up time to watch the neighbourhood drift apart over millions of years. ${GAIA_100PC_CREDIT}`,
  };
}
