import type { Body } from './body';
import { equatorialToGalactic } from '../procgen/galaxy';
import { galacticToCosmos } from './galaxies';
import type { SceneSetup } from './presets';
import type { Simulation } from './simulation';
import { KPC_MYR_GRAVITY_SCALE, KPC_PER_MYR_IN_KMS } from './units';

/**
 * The real Milky Way–Andromeda encounter, in kiloparsecs, solar masses and millions of years.
 *
 * - Andromeda (M31): position from the Updated Nearby Galaxy Catalog (l = 121.17°, b = −21.57°,
 *   770 kpc). Velocity relative to the Milky Way from HST proper motions (van der Marel et al.
 *   2012, ApJ 753, 8): 109.3 km/s radially toward us and about 17 km/s tangentially.
 * - Masses as in that study: Milky Way 1.0 × 10¹² M☉, Andromeda 1.5 × 10¹² M☉, each treated
 *   as one softened point mass (Plummer softening 25 kpc) so disk stars get roughly flat
 *   ~200 km/s rotation curves.
 * - Andromeda's disk orientation: inclination 77.5° and position angle 38° (spin sense
 *   approximate).
 *
 * Point-mass halos feel no dynamical friction, so the galaxies' cores merge here at their first
 * close passage, while in reality friction brings the full merger about 2 billion years later.
 */

const KMS = 1 / KPC_PER_MYR_IN_KMS; // km/s → kpc/Myr
const SOFTENING_KPC = 25;
const DEG = Math.PI / 180;

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => scale(a, 1 / Math.hypot(...a));

/** Unit vector (map frame) toward an equatorial direction. */
function skyDirection(raDeg: number, decDeg: number): V {
  const [l, b] = equatorialToGalactic(raDeg, decDeg);
  return galacticToCosmos(l, b, 1);
}

/** A disk of test-particle stars on circular orbits in the softened potential of `host`. */
function addStarDisk(sim: Simulation, host: Body, normal: V, opts: { count: number; inner: number; outer: number; color: [number, number, number]; spin: 1 | -1 }): void {
  const gm = 4 * Math.PI * Math.PI * sim.gravityScale * host.mass;
  // Orthonormal basis of the disk plane.
  const n = norm(normal);
  const seed: V = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(n, seed));
  const w = cross(n, u);
  for (let i = 0; i < opts.count; i++) {
    // Exponential-ish disk: more stars toward the centre.
    const r = opts.inner + (opts.outer - opts.inner) * Math.pow(Math.random(), 1.6);
    const th = Math.random() * Math.PI * 2;
    const h = (Math.random() - 0.5) * 0.6; // ~300 pc thick
    const radial = add(scale(u, Math.cos(th)), scale(w, Math.sin(th)));
    const tangent = scale(cross(n, radial), opts.spin);
    const a2 = SOFTENING_KPC * SOFTENING_KPC;
    const v = Math.sqrt((gm * r * r) / Math.pow(r * r + a2, 1.5));
    const p = add(add([host.x, host.y, host.z], scale(radial, r)), scale(n, h));
    const vel = add([host.vx, host.vy, host.vz], scale(tangent, v));
    const shade = 0.75 + Math.random() * 0.4;
    sim.particles.add(p[0], p[1], p[2], vel[0], vel[1], vel[2], [opts.color[0] * shade, opts.color[1] * shade, opts.color[2] * shade]);
  }
}

export function loadMilkyWayAndromeda(sim: Simulation): SceneSetup {
  sim.units = 'kpc-myr';
  sim.gravityScale = KPC_MYR_GRAVITY_SCALE;
  sim.softening = SOFTENING_KPC;
  sim.dtMax = 2; // Myr
  sim.evolutionRate = 0;
  sim.tidal = false;
  sim.debris = false;
  sim.shatter = false;
  sim.collisions = true;

  const mwMass = 1.0e12;
  const m31Mass = 1.5e12;
  // Andromeda's position (kpc) and velocity relative to the Milky Way.
  const m31Pos = galacticToCosmos(121.17, -21.57, 770);
  const los = norm(m31Pos);
  const tangentialDir = norm(cross(los, [0, 1, 0]));
  const relVel = add(scale(los, -109.3 * KMS), scale(tangentialDir, 17 * KMS));
  // Start in the centre-of-mass frame.
  const fMW = m31Mass / (mwMass + m31Mass);
  const fM31 = mwMass / (mwMass + m31Mass);
  const mwPos = scale(m31Pos, -fMW);
  const m31Start = add(mwPos, m31Pos);
  const mwVel = scale(relVel, -fMW);
  const m31Vel = scale(relVel, fM31);

  const mw = sim.addBody({
    name: 'Milky Way', kind: 'star', mass: mwMass, radius: 12, color: 0xfff1d6, tag: 'galaxy',
    x: mwPos[0], y: mwPos[1], z: mwPos[2], vx: mwVel[0], vy: mwVel[1], vz: mwVel[2],
  });
  const m31 = sim.addBody({
    name: 'Andromeda', kind: 'star', mass: m31Mass, radius: 12, color: 0xffe6c4, tag: 'galaxy',
    x: m31Start[0], y: m31Start[1], z: m31Start[2], vx: m31Vel[0], vy: m31Vel[1], vz: m31Vel[2],
  });

  // Milky Way disk: in the galactic plane (map +y is the north galactic pole), rotating
  // clockwise seen from the north, i.e. angular momentum toward the south galactic pole.
  addStarDisk(sim, mw, [0, 1, 0], { count: 3500, inner: 1, outer: 18, color: [0.85, 0.88, 1], spin: -1 });

  // Andromeda's disk normal from inclination and position angle on the sky.
  const ra = 10.6847, dec = 41.269;
  const n0 = skyDirection(ra, dec);
  const north = norm(sub(skyDirection(ra, dec + 0.1), n0));
  const east = norm(sub(skyDirection(ra + 0.1 / Math.cos(dec * DEG), dec), n0));
  const pa = 38 * DEG, inc = 77.5 * DEG;
  const minor = add(scale(north, -Math.sin(pa)), scale(east, Math.cos(pa)));
  const m31Normal = add(scale(n0, -Math.cos(inc)), scale(minor, Math.sin(inc)));
  addStarDisk(sim, m31, m31Normal, { count: 4500, inner: 1, outer: 22, color: [1, 0.86, 0.68], spin: 1 });

  return {
    cameraDistance: 1100,
    timeScale: 60,
    elevation: 0.45,
    tip:
      'The real Milky Way–Andromeda encounter: Andromeda 770 kpc (2.5 million light-years) away, closing at 109 km/s (HST, van der Marel et al. 2012). Time runs in millions of years. Each galaxy is one softened mass with a disk of stars; real dynamical friction would delay the final merger by about 2 billion years.',
  };
}
