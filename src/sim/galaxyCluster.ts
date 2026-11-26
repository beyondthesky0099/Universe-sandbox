/**
 * Inside a galaxy cluster, in kiloparsecs, solar masses and millions of years (as sim/localGroup.ts).
 *
 * Members are the catalogued galaxies (Local Volume, 2MRS) within 2 Mpc of the cluster's centre on
 * the sky and within ±3,000 km/s of it in velocity, then clipped at 3σ about their mean velocity
 * until no more drop out (a cluster's own motions stretch it thousands of km/s along the line of
 * sight). Each is placed at its
 * real position across the line of sight. Its depth along the line of sight isn't measured
 * (redshift distances are smeared by the galaxies' own motions, the "fingers of God"), so it is
 * drawn from the cluster's spread across the sky. Its line-of-sight velocity is its real one,
 * relative to the cluster; the two across are drawn from the same dispersion.
 *
 * The total mass is the virial mass from the standard projected estimator (Heisler, Tremaine &
 * Bahcall 1985, ApJ 298, 8): M = (3π/2G) σ² R_PV, with σ the measured line-of-sight velocity
 * spread and R_PV the projected virial radius from the members' separations on the sky, dark
 * matter included. Each galaxy gets a share in proportion to its infrared (K-band) light, the
 * best tracer of its stars. Clusters too far away for the catalogues to have
 * members get an illustrative swarm of their size and richness.
 */
import { mulberry32 } from '../procgen/rng';
import { displayName, galacticToCosmos, type LocalGalaxy } from './galaxies';
import type { SceneSetup } from './presets';
import type { Simulation } from './simulation';
import { KPC_MYR_GRAVITY_SCALE, KPC_PER_MYR_IN_KMS } from './units';

type V = [number, number, number];
const C_KMS = 299792.458;
/** G in kpc (km/s)² / M☉. */
const G_KPC_KMS = 4.3009e-6;

export interface ClusterMember {
  galaxy: LocalGalaxy;
  /** Position across the line of sight (kpc), in the cluster's sky plane. */
  east: number;
  north: number;
  /** Line-of-sight velocity relative to the cluster (km/s), when measured. */
  vlos?: number;
}

/** Unit vectors across the line of sight at a direction (map frame). */
function skyBasis(n: V): { e: V; u: V } {
  const ref: V = Math.abs(n[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const e0: V = [ref[1] * n[2] - ref[2] * n[1], ref[2] * n[0] - ref[0] * n[2], ref[0] * n[1] - ref[1] * n[0]];
  const le = Math.hypot(...e0);
  const e: V = [e0[0] / le, e0[1] / le, e0[2] / le];
  const u: V = [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]];
  return { e, u };
}

/** The catalogued galaxies in a cluster: within `radiusMpc` across and ±`depthMpc` in distance. */
export function clusterMembers(cluster: Pick<LocalGalaxy, 'l' | 'b' | 'd'>, galaxies: LocalGalaxy[], radiusMpc = 2, depthMpc = 44): ClusterMember[] {
  const n = galacticToCosmos(cluster.l, cluster.b, 1) as V;
  const { e, u } = skyBasis(n);
  const out: ClusterMember[] = [];
  const v0 = (cluster.d ?? 0) * 67.66; // the cluster's own recession velocity (km/s), from its distance
  for (const g of galaxies) {
    if (g.kind && g.kind !== 'galaxy') continue;
    if (Math.abs(g.d - cluster.d) > depthMpc) continue;
    const p = galacticToCosmos(g.l, g.b, 1) as V;
    const cos = p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
    if (cos < 0.99) continue;
    // Across the line of sight, at the cluster's distance (kpc).
    const east = (p[0] * e[0] + p[1] * e[1] + p[2] * e[2]) * cluster.d * 1000;
    const north = (p[0] * u[0] + p[1] * u[1] + p[2] * u[2]) * cluster.d * 1000;
    if (Math.hypot(east, north) > radiusMpc * 1000) continue;
    out.push({ galaxy: g, east, north, ...(g.v !== undefined ? { vlos: (g.v - v0) / (1 + v0 / C_KMS) } : {}) });
  }
  // 3σ clipping about the mean velocity, until it settles.
  let members = out;
  for (let pass = 0; pass < 10; pass++) {
    const v = members.filter((m) => m.vlos !== undefined).map((m) => m.vlos!);
    if (v.length < 5) break;
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.max(300, Math.sqrt(v.reduce((t, x) => t + (x - mean) ** 2, 0) / (v.length - 1)));
    const kept = members.filter((m) => m.vlos === undefined || Math.abs(m.vlos - mean) < 3 * sd);
    if (kept.length === members.length) break;
    members = kept;
  }
  return members;
}

/** Load a galaxy cluster's members (or, beyond the catalogues, an illustrative swarm). */
export function loadGalaxyCluster(sim: Simulation, cluster: LocalGalaxy, members: ClusterMember[]): SceneSetup {
  sim.units = 'kpc-myr';
  sim.gravityScale = KPC_MYR_GRAVITY_SCALE;
  sim.softening = 20;
  sim.dtMax = 2;
  sim.evolutionRate = 0;
  sim.tidal = false;
  sim.debris = false;
  sim.shatter = false;
  sim.collisions = false;
  const name = displayName(cluster);
  const rand = mulberry32(name.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 3));
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const real = members.length >= 5;
  const KMS = 1 / KPC_PER_MYR_IN_KMS;
  let list: { name: string; lk: number; size: number; t: number; east: number; north: number; vlos?: number }[];
  if (real) {
    list = members.map((m) => ({ name: displayName(m.galaxy), lk: m.galaxy.lk ?? 10, size: m.galaxy.size ?? 20, t: m.galaxy.t ?? 0, east: m.east, north: m.north, vlos: m.vlos }));
  } else {
    // Beyond the catalogues: a swarm of its richness (Abell bright-member count, else 60) in a
    // King-like sphere about 1.5 Mpc across.
    const count = Math.min(200, Math.max(40, cluster.count ?? 60));
    list = Array.from({ length: count }, (_, i) => {
      const r = 400 * Math.sqrt(1 / Math.pow(rand() * 0.98 + 0.01, 2 / 3) - 1);
      const th = 2 * Math.PI * rand(), u = 2 * rand() - 1, s = Math.sqrt(1 - u * u);
      return { name: `${name} galaxy ${i + 1}`, lk: 10 + 1.2 * Math.pow(rand(), 3), size: 20, t: rand() < 0.7 ? -5 : 3, east: r * s * Math.cos(th), north: r * u };
    });
  }
  // The spread of positions and velocities, and from them the virial mass.
  const rms = Math.sqrt(list.reduce((t, m) => t + m.east ** 2 + m.north ** 2, 0) / list.length / 2) || 500;
  const measured = list.filter((m) => m.vlos !== undefined);
  const sigma = measured.length >= 5 ? Math.sqrt(measured.reduce((t, m) => t + (m.vlos! - measured.reduce((s, x) => s + x.vlos!, 0) / measured.length) ** 2, 0) / (measured.length - 1)) : 900;
  // Projected virial radius: N(N−1)/2 over the sum of inverse projected separations.
  let inv = 0, pairs = 0;
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      inv += 1 / Math.max(10, Math.hypot(list[i].east - list[j].east, list[i].north - list[j].north));
      pairs++;
    }
  const rpv = pairs / inv;
  const totalMass = (3 * Math.PI * sigma * sigma * rpv) / (2 * G_KPC_KMS);
  const lightSum = list.reduce((t, m) => t + 10 ** m.lk, 0);
  const n = galacticToCosmos(cluster.l, cluster.b, 1) as V;
  const { e, u } = skyBasis(n);
  for (const m of list) {
    const depth = gauss() * rms;
    const vlos = m.vlos ?? gauss() * sigma;
    const ve = gauss() * sigma, vu = gauss() * sigma;
    const pos: V = [0, 1, 2].map((k) => m.east * e[k] + m.north * u[k] + depth * n[k]) as V;
    const vel: V = [0, 1, 2].map((k) => (ve * e[k] + vu * u[k] + vlos * n[k]) * KMS) as V;
    sim.addBody({
      name: m.name,
      kind: 'star',
      tag: 'galaxy',
      mass: (totalMass * 10 ** m.lk) / lightSum,
      radius: Math.max(5, m.size / 2),
      color: m.t <= -1 ? 0xffe2b8 : 0xcfe0ff,
      x: pos[0], y: pos[1], z: pos[2], vx: vel[0], vy: vel[1], vz: vel[2],
    });
  }
  sim.recenter();
  const crossingMyr = (rms * 2) / (sigma * KMS);
  const mass = totalMass >= 1e15 ? `${(totalMass / 1e15).toFixed(1)} million billion` : `${(totalMass / 1e12).toFixed(0)} trillion`;
  return {
    cameraDistance: rms * 7,
    timeScale: crossingMyr / 40,
    elevation: 0.5,
    tip: real
      ? `${name}: its ${list.length} catalogued galaxies at their real places across the sky and their real line-of-sight speeds (spread ${Math.round(sigma)} km/s), with ${mass} suns of mass between them (the virial mass, mostly dark matter). Their depth along the line of sight isn't measured, so it is drawn from the cluster's spread. Time runs in millions of years.`
      : `${name}: too far away for the galaxy catalogues to list its members, so this is an illustrative swarm of ${list.length} galaxies of its size, with ${mass} suns of mass between them. Time runs in millions of years.`,
  };
}
