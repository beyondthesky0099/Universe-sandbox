import { BODY_KINDS } from './body';
import type { Explosion } from './supernovaPhysics';
import type { Autopilot } from './spaceship';
import type { AdvanceResult, SimEvent, Simulation } from './simulation';
import type { SimSettings, SimState } from './state';

/** Messages from the main thread to the physics worker. */
export type ToWorker =
  | { type: 'state'; version: number; state: SimState }
  | { type: 'settings'; patch: Partial<SimSettings> }
  | { type: 'advance'; version: number; simTime: number; budgetMs: number }
  /** A ship's engine: acceleration (AU/yr²) or off. */
  | { type: 'thrust'; id: number; accel: [number, number, number] | null }
  /** A ship's autopilot: fly into orbit, or off. */
  | { type: 'autopilot'; id: number; autopilot: Autopilot | null }
  /** Sent once at start: how many helper threads the worker may use for particle forces (-1: automatic). */
  | { type: 'config'; threads: number };

/** Per-frame update from the physics worker. */
export interface Frame {
  type: 'frame';
  version: number;
  time: number;
  steps: number;
  lagging: boolean;
  usingTree: boolean;
  /** CPU threads computing particle forces (1 unless the page is cross-origin isolated). */
  cores: number;
  /** BODY_STRIDE numbers per body (see encodeFrame). */
  bodies: Float64Array;
  /** Names (and tags) for every body, sent only when the set of bodies changed. */
  names?: [number, string, string?][];
  particleCount: number;
  ppos: Float32Array;
  pvel: Float32Array;
  pcol: Float32Array;
  events: SimEvent[];
  /**
   * SHOCK_STRIDE numbers per active shockwave: x, y, z, radius, maxRadius, speed, momentum,
   * sourceId, then for supernovae t0, type (1 = Ia, 0 = II, −1 = none), energy, ejecta mass,
   * nickel mass, progenitor radius, ISM density, subtype (index in SUBTYPES, −1 = none), hydrogen
   * envelope mass (NaN = default), interaction luminosity and days (0 = none).
   */
  shockwaves: number[];
  fuses: [number, number][];
}

export const BODY_STRIDE = 15;
export const SHOCK_STRIDE = 19;
/** Core-collapse subtypes, in the order they are numbered in frames (stellarFate.ts). */
const SUBTYPES = ['ECSN', 'II-P', 'II-L', 'IIb', 'Ib', 'Ic', 'Ic-BL', 'PPISN', 'PISN', 'failed'];
const KINDS = BODY_KINDS;

/** Encode the simulation into a compact, transferable frame. */
export function encodeFrame(sim: Simulation, version: number, result: AdvanceResult, includeNames: boolean): Frame {
  const n = sim.bodies.length;
  const bodies = new Float64Array(n * BODY_STRIDE);
  for (let i = 0; i < n; i++) {
    const b = sim.bodies[i];
    const k = i * BODY_STRIDE;
    bodies[k] = b.id;
    bodies[k + 1] = b.mass;
    bodies[k + 2] = b.radius;
    bodies[k + 3] = b.x;
    bodies[k + 4] = b.y;
    bodies[k + 5] = b.z;
    bodies[k + 6] = b.vx;
    bodies[k + 7] = b.vy;
    bodies[k + 8] = b.vz;
    bodies[k + 9] = b.color;
    bodies[k + 10] = KINDS.indexOf(b.kind);
    bodies[k + 11] = b.age;
    bodies[k + 12] = b.fuel ?? NaN;
    bodies[k + 13] = b.metallicity ?? NaN;
    bodies[k + 14] = b.spin ?? NaN;
  }
  const p = sim.particles;
  const n3 = p.count * 3;
  const shockwaves: number[] = [];
  for (const w of sim.shockwaves) {
    const e = w.explosion;
    shockwaves.push(w.x, w.y, w.z, w.radius, w.maxRadius, w.speed, w.momentum, w.sourceId);
    if (e) shockwaves.push(w.t0 ?? 0, e.type === 'Ia' ? 1 : 0, e.energy, e.ejectaMass, e.nickelMass, e.progenitorRadius, e.ismDensity, e.subtype ? SUBTYPES.indexOf(e.subtype) : -1, e.envelopeMass ?? NaN, e.interaction?.luminosity ?? 0, e.interaction?.days ?? 0);
    else shockwaves.push(0, -1, 0, 0, 0, 0, 0, -1, NaN, 0, 0);
  }
  return {
    type: 'frame',
    version,
    time: sim.time,
    steps: result.steps,
    lagging: result.lagging,
    usingTree: sim.isUsingTree,
    cores: sim.parallel?.ready ? sim.parallel.threads + 1 : 1,
    bodies,
    names: includeNames ? sim.bodies.map((b) => [b.id, b.name, b.tag]) : undefined,
    particleCount: p.count,
    ppos: Float32Array.from(p.pos.subarray(0, n3)),
    pvel: Float32Array.from(p.vel.subarray(0, n3)),
    pcol: p.color.slice(0, n3),
    events: sim.events.splice(0),
    shockwaves,
    fuses: [...sim.fuses],
  };
}

export function frameTransferables(f: Frame): Transferable[] {
  return [f.bodies.buffer, f.ppos.buffer, f.pvel.buffer, f.pcol.buffer];
}

/**
 * Apply a frame to the main-thread mirror simulation. Existing Body objects are updated
 * in place (so references held by the UI stay valid); new ones are created.
 */
export function applyFrame(sim: Simulation, f: Frame): void {
  const existing = new Map(sim.bodies.map((b) => [b.id, b]));
  const names = f.names ? new Map(f.names.map(([id, name, tag]) => [id, { name, tag }])) : undefined;
  const n = f.bodies.length / BODY_STRIDE;
  const next = [];
  for (let i = 0; i < n; i++) {
    const k = i * BODY_STRIDE;
    const id = f.bodies[k];
    let b = existing.get(id);
    const meta = names?.get(id);
    if (!b) {
      b = sim.addBodyDetached({ id, name: meta?.name ?? `Body ${id}`, mass: f.bodies[k + 1], tag: meta?.tag });
    } else if (meta) {
      b.name = meta.name;
      b.tag = meta.tag;
    }
    b.mass = f.bodies[k + 1];
    b.radius = f.bodies[k + 2];
    b.x = f.bodies[k + 3];
    b.y = f.bodies[k + 4];
    b.z = f.bodies[k + 5];
    b.vx = f.bodies[k + 6];
    b.vy = f.bodies[k + 7];
    b.vz = f.bodies[k + 8];
    b.color = f.bodies[k + 9];
    b.kind = KINDS[f.bodies[k + 10]];
    b.age = f.bodies[k + 11];
    const fuel = f.bodies[k + 12];
    b.fuel = Number.isNaN(fuel) ? undefined : fuel;
    const metallicity = f.bodies[k + 13];
    b.metallicity = Number.isNaN(metallicity) ? undefined : metallicity;
    const spin = f.bodies[k + 14];
    b.spin = Number.isNaN(spin) ? undefined : spin;
    next.push(b);
  }
  sim.bodies = next;
  sim.time = f.time;

  const p = sim.particles;
  const count = Math.min(f.particleCount, p.capacity);
  const n3 = count * 3;
  for (let i = 0; i < n3; i++) {
    p.pos[i] = f.ppos[i];
    p.vel[i] = f.pvel[i];
    p.color[i] = f.pcol[i];
  }
  p.count = count;

  sim.shockwaves = [];
  for (let i = 0; i < f.shockwaves.length; i += SHOCK_STRIDE) {
    const [x, y, z, radius, maxRadius, speed, momentum, sourceId, t0, type, energy, ejectaMass, nickelMass, progenitorRadius, ismDensity, subtype, envelopeMass, interL, interDays] = f.shockwaves.slice(i, i + SHOCK_STRIDE);
    // Bodies inside the shell have already been hit.
    const hit = new Set<number>([sourceId]);
    for (const b of next) if (Math.hypot(b.x - x, b.y - y, b.z - z) <= radius) hit.add(b.id);
    const explosion: Explosion | undefined =
      type < 0
        ? undefined
        : {
            type: type === 1 ? 'Ia' : 'II',
            energy,
            ejectaMass,
            nickelMass,
            progenitorRadius,
            ismDensity,
            ...(subtype >= 0 ? { subtype: SUBTYPES[subtype] } : {}),
            ...(Number.isNaN(envelopeMass) ? {} : { envelopeMass }),
            ...(interL > 0 ? { interaction: { luminosity: interL, days: interDays } } : {}),
          };
    sim.shockwaves.push({ x, y, z, radius, maxRadius, speed, momentum, sourceId, hit, ...(explosion ? { t0, explosion } : {}) });
  }
  sim.fuses.clear();
  for (const [id, at] of f.fuses) sim.fuses.set(id, at);
  sim.events.push(...f.events);
}
