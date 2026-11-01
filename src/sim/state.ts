import type { BodyKind } from './body';
import type { GravityMode, Simulation } from './simulation';

export interface BodyState {
  id: number;
  name: string;
  kind: BodyKind;
  mass: number;
  radius: number;
  color: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age?: number;
  tag?: string;
  fuel?: number;
}

export interface ParticleState {
  count: number;
  /** Positions, velocities and colours: 3 numbers per particle each. */
  pos: ArrayLike<number>;
  vel: ArrayLike<number>;
  color: ArrayLike<number>;
}

export interface SimSettings {
  gravityScale: number;
  collisions: boolean;
  debris: boolean;
  tidal: boolean;
  shatter: boolean;
  dtMax: number;
  softening: number;
  gravityMode?: GravityMode;
  relativity?: boolean;
  lightSpeedScale?: number;
  evolutionRate?: number;
}

export interface ShockwaveState {
  x: number;
  y: number;
  z: number;
  radius: number;
  speed: number;
  momentum: number;
  maxRadius: number;
  sourceId: number;
  hit: number[];
}

export interface SimState {
  format: 'astrarium-scene';
  version: 1;
  time: number;
  settings: SimSettings;
  bodies: BodyState[];
  particles?: ParticleState;
  shockwaves?: ShockwaveState[];
  /** Scheduled supernovae: [body id, detonation time]. */
  fuses?: [number, number][];
}

export interface CaptureOptions {
  /** Include particles (default true). */
  particles?: boolean;
  /** Store particle arrays as plain number arrays rounded to `precision` significant digits (for JSON). */
  json?: boolean;
  precision?: number;
}

/** Snapshot the full simulation state. */
export function captureState(sim: Simulation, opts: CaptureOptions = {}): SimState {
  const { particles = true, json = false, precision = 7 } = opts;
  const round = json ? (v: number) => Number(v.toPrecision(precision)) : (v: number) => v;
  const state: SimState = {
    format: 'astrarium-scene',
    version: 1,
    time: sim.time,
    settings: {
      gravityScale: sim.gravityScale,
      collisions: sim.collisions,
      debris: sim.debris,
      tidal: sim.tidal,
      shatter: sim.shatter,
      dtMax: sim.dtMax,
      softening: sim.softening,
      gravityMode: sim.gravityMode,
      relativity: sim.relativity,
      lightSpeedScale: sim.lightSpeedScale,
      evolutionRate: sim.evolutionRate,
    },
    bodies: sim.bodies.map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      mass: round(b.mass),
      radius: round(b.radius),
      color: b.color,
      x: round(b.x),
      y: round(b.y),
      z: round(b.z),
      vx: round(b.vx),
      vy: round(b.vy),
      vz: round(b.vz),
      ...(b.age ? { age: round(b.age) } : {}),
      ...(b.tag ? { tag: b.tag } : {}),
      ...(b.fuel !== undefined ? { fuel: round(b.fuel) } : {}),
    })),
  };
  if (sim.shockwaves.length) state.shockwaves = sim.shockwaves.map((w) => ({ ...w, hit: [...w.hit] }));
  if (sim.fuses.size) state.fuses = [...sim.fuses];
  if (particles && sim.particles.count > 0) {
    const p = sim.particles;
    const n3 = p.count * 3;
    if (json) {
      const r4 = (v: number) => Number(v.toPrecision(5));
      state.particles = {
        count: p.count,
        pos: Array.from(p.pos.subarray(0, n3), r4),
        vel: Array.from(p.vel.subarray(0, n3), r4),
        color: Array.from(p.color.subarray(0, n3), (v) => Math.round(v * 100) / 100),
      };
    } else {
      state.particles = {
        count: p.count,
        pos: Float32Array.from(p.pos.subarray(0, n3)),
        vel: Float32Array.from(p.vel.subarray(0, n3)),
        color: p.color.slice(0, n3),
      };
    }
  }
  return state;
}

/** Replace the simulation's contents with a snapshot. Body ids are preserved. */
export function restoreState(sim: Simulation, state: SimState): void {
  if (state.format !== 'astrarium-scene') throw new Error('Not an Astrarium scene');
  sim.clear();
  sim.time = state.time;
  Object.assign(sim, state.settings);
  for (const b of state.bodies) sim.addBody({ ...b });
  if (state.particles) {
    const p = state.particles;
    const n = Math.min(p.count, sim.particles.capacity);
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      sim.particles.add(p.pos[k], p.pos[k + 1], p.pos[k + 2], p.vel[k], p.vel[k + 1], p.vel[k + 2], [p.color[k], p.color[k + 1], p.color[k + 2]]);
    }
  }
  if (state.shockwaves) sim.shockwaves = state.shockwaves.map((w) => ({ ...w, hit: new Set(w.hit) }));
  if (state.fuses) for (const [id, at] of state.fuses) sim.fuses.set(id, at);
  sim.invalidate();
}

export function isSimState(value: unknown): value is SimState {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as SimState).format === 'astrarium-scene' &&
    Array.isArray((value as SimState).bodies)
  );
}

/** Approximate memory footprint of a snapshot, in bytes. */
export function stateSize(state: SimState): number {
  return state.bodies.length * 200 + (state.particles ? state.particles.count * 40 : 0);
}
