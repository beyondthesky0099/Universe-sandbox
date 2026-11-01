import {
  Body,
  BodyInit,
  CHANDRASEKHAR_MASS,
  createBody,
  defaultColor,
  isCompact,
  mainSequenceLifetime,
  kindForMass,
  mergedKind,
  NOMINAL_DENSITY,
  radiusFor,
} from './body';
import { kelvinToRgb } from './color';
import { Octree } from './octree';
import { ParticleSet } from './particles';
import { C_AU_PER_YEAR, EARTH_MASS, G } from './units';

export type SimEventType = 'merge' | 'ignite' | 'collapse' | 'shatter' | 'disrupt' | 'supernova' | 'gwmerger' | 'redgiant' | 'nebula';

export interface SimEvent {
  type: SimEventType;
  message: string;
  x: number;
  y: number;
  z: number;
  /** Visual size hint (AU) for effects. */
  size: number;
}

export interface Shockwave {
  x: number;
  y: number;
  z: number;
  radius: number;
  speed: number;
  /** Ejecta momentum (M☉·AU/yr) carried by the blast. */
  momentum: number;
  maxRadius: number;
  sourceId: number;
  hit: Set<number>;
}

export interface AdvanceResult {
  steps: number;
  /** True if the simulation could not keep up and dropped time this frame. */
  lagging: boolean;
}

export type GravityMode = 'auto' | 'direct' | 'tree';

const PARTICLE_CULL_DISTANCE = 5000; // AU
/** Minimum fragment mass for shattering collisions. */
const MIN_FRAGMENT_MASS = 0.002 * EARTH_MASS;
/** Stars at or above this mass can go supernova. */
export const SUPERNOVA_MIN_MASS = 8;

type Rgb = [number, number, number];

/**
 * N-body gravity simulation.
 *
 * Integrator: kick-drift-kick leapfrog. Timestep is adaptive and global:
 *  - direct mode (O(N²)): dt = eta · min over pairs of sqrt(r³ / G(m₁+m₂)),
 *  - tree mode (Barnes–Hut, O(N log N)): dt = etaTree · min over bodies of sqrt(ℓ / |a|).
 *
 * Collisions merge (conserving mass and momentum) or, for fast rocky impacts, shatter into
 * fragments. Bodies that stray inside another's Roche limit are torn into debris, and massive
 * stars can go supernova, launching a shockwave.
 */
export class Simulation {
  bodies: Body[] = [];
  readonly particles: ParticleSet;
  readonly events: SimEvent[] = [];
  shockwaves: Shockwave[] = [];

  time = 0;
  /** Multiplier on G. 0 disables gravity entirely. */
  gravityScale = 1;
  collisions = true;
  debris = true;
  tidal = true;
  shatter = true;
  gravityMode: GravityMode = 'auto';
  /** Body count above which 'auto' switches to Barnes–Hut. */
  treeThreshold = 160;
  /** Fraction of the shortest dynamical timescale per step. Smaller = more accurate. */
  eta = 0.015;
  etaTree = 0.25;
  dtMax = 0.01;
  dtMin = 1e-8;
  /**
   * General relativity: adds the first post-Newtonian correction (perihelion precession)
   * and gravitational-wave energy loss between compact objects. Direct-summation mode only.
   */
  relativity = false;
  /** Speed of light as a fraction of the real value. Lower it to exaggerate relativistic effects. */
  lightSpeedScale = 1;
  /** Years of stellar aging per simulated year (stellar evolution time-lapse). */
  evolutionRate = 1;
  /** Plummer softening length (AU) to avoid singular forces. */
  softening = 1e-4;

  private nextDt = this.dtMax;
  private forcesDirty = true;
  private readonly absorbed: number[] = [];
  private readonly tree = new Octree();
  private readonly scratch = new Float64Array(3);
  private stepCount = 0;
  private usingTree = false;
  /** Half-step used to extrapolate velocities for velocity-dependent (relativistic) forces. */
  private relHalfDt = 0;
  private predVel = new Float64Array(0);
  /** Bodies that recently shattered merge instead of shattering again until this time. */
  private readonly shatterCooldown = new Map<number, number>();
  /** Bodies destroyed mid-step (e.g. Type Ia supernovae), removed at the end of the step. */
  private readonly doomed = new Set<Body>();
  /** Pending supernovae: body id → simulation time of detonation. */
  readonly fuses = new Map<number, number>();

  constructor(particleCapacity = 20000) {
    this.particles = new ParticleSet(particleCapacity);
  }

  get isUsingTree(): boolean {
    return this.usingTree;
  }

  addBody(init: BodyInit): Body {
    const body = createBody(init);
    this.bodies.push(body);
    this.forcesDirty = true;
    return body;
  }

  /** Create a body without adding it to the simulation (used when mirroring worker state). */
  addBodyDetached(init: BodyInit): Body {
    return createBody(init);
  }

  removeBody(id: number): void {
    this.bodies = this.bodies.filter((b) => b.id !== id);
    this.forcesDirty = true;
  }

  getBody(id: number): Body | undefined {
    return this.bodies.find((b) => b.id === id);
  }

  clear(): void {
    this.bodies = [];
    this.particles.clear();
    this.events.length = 0;
    this.shockwaves = [];
    this.fuses.clear();
    this.shatterCooldown.clear();
    this.doomed.clear();
    this.time = 0;
    this.forcesDirty = true;
  }

  /** Detonate a star after `delay` years of simulation time. */
  scheduleSupernova(id: number, delay: number): void {
    this.fuses.set(id, this.time + delay);
  }

  /** Call after mutating bodies directly (mass, position, velocity). */
  invalidate(): void {
    this.forcesDirty = true;
  }

  get effectiveG(): number {
    return G * this.gravityScale;
  }

  /** Advance by `simTime` years, stopping early if the step or wall-clock budget runs out. */
  advance(simTime: number, maxSteps = 4000, budgetMs = 14): AdvanceResult {
    let remaining = simTime;
    let steps = 0;
    const start = performance.now();
    while (remaining > 1e-12 && steps < maxSteps) {
      if (this.forcesDirty) this.computeForces();
      const dt = Math.min(this.nextDt, remaining);
      this.step(dt);
      remaining -= dt;
      steps++;
      if ((steps & 3) === 0 && performance.now() - start > budgetMs) break;
    }
    return { steps, lagging: remaining > simTime * 0.05 && remaining > 1e-9 };
  }

  /** One kick-drift-kick leapfrog step. */
  step(dt: number): void {
    if (this.forcesDirty) this.computeForces();
    const h = dt * 0.5;
    const bodies = this.bodies;
    for (const b of bodies) {
      b.vx += b.ax * h;
      b.vy += b.ay * h;
      b.vz += b.az * h;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
    }
    const p = this.particles;
    const n3 = p.count * 3;
    const pos = p.pos;
    const vel = p.vel;
    const acc = p.acc;
    for (let k = 0; k < n3; k++) {
      vel[k] += acc[k] * h;
      pos[k] += vel[k] * dt;
    }

    this.relHalfDt = h;
    this.computeForces();
    this.relHalfDt = 0;

    for (const b of bodies) {
      b.vx += b.ax * h;
      b.vy += b.ay * h;
      b.vz += b.az * h;
    }
    for (let k = 0; k < n3; k++) vel[k] += acc[k] * h;

    this.time += dt;
    this.stepCount++;
    this.removeAbsorbedParticles();
    let changed = false;
    if (this.evolutionRate > 0) {
      for (const b of bodies) b.age += dt * this.evolutionRate;
      if ((this.stepCount & 7) === 0 && this.evolveStars()) changed = true;
    }
    if (this.collisions && this.resolveCollisions()) changed = true;
    if (this.tidal && this.resolveTides()) changed = true;
    if (this.shockwaves.length) this.updateShockwaves(dt);
    if (this.fuses.size) {
      for (const [id, at] of this.fuses) {
        if (this.time < at) continue;
        this.fuses.delete(id);
        const b = this.getBody(id);
        if (b && this.supernova(b)) changed = true;
      }
    }
    if (this.doomed.size) {
      this.bodies = this.bodies.filter((b) => !this.doomed.has(b));
      this.doomed.clear();
      changed = true;
    }
    if (changed) this.computeForces();
  }

  get lightSpeed(): number {
    return C_AU_PER_YEAR * this.lightSpeedScale;
  }

  // ---------------------------------------------------------------------------
  // Gravity

  /** Compute accelerations for bodies and particles, and pick the next timestep. */
  computeForces(): void {
    const n = this.bodies.length;
    this.usingTree = this.gravityMode === 'tree' || (this.gravityMode === 'auto' && n > this.treeThreshold);
    if (this.usingTree) this.computeForcesTree();
    else this.computeForcesDirect();
    this.forcesDirty = false;
  }

  private computeForcesDirect(): void {
    const bodies = this.bodies;
    const n = bodies.length;
    const g = this.effectiveG;
    const eps2 = this.softening * this.softening;
    const rel = this.relativity;
    let minTau2 = Infinity;

    if (rel) {
      // Velocity-dependent forces: estimate full-step velocities (v + a·h) from the half-step ones,
      // otherwise leapfrog systematically mis-evaluates them and orbits drift.
      if (this.predVel.length < n * 3) this.predVel = new Float64Array(n * 6);
      const h = this.relHalfDt;
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        this.predVel[i * 3] = b.vx + b.ax * h;
        this.predVel[i * 3 + 1] = b.vy + b.ay * h;
        this.predVel[i * 3 + 2] = b.vz + b.az * h;
      }
    }

    for (const b of bodies) b.ax = b.ay = b.az = 0;

    for (let i = 0; i < n; i++) {
      const bi = bodies[i];
      for (let j = i + 1; j < n; j++) {
        const bj = bodies[j];
        const dx = bj.x - bi.x;
        const dy = bj.y - bi.y;
        const dz = bj.z - bi.z;
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const r = Math.sqrt(r2);
        const inv3 = g / (r2 * r);
        const fi = bj.mass * inv3;
        const fj = bi.mass * inv3;
        bi.ax += dx * fi;
        bi.ay += dy * fi;
        bi.az += dz * fi;
        bj.ax -= dx * fj;
        bj.ay -= dy * fj;
        bj.az -= dz * fj;
        const msum = bi.mass + bj.mass;
        if (g > 0 && msum > 0) {
          const tau2 = (r2 * r) / (g * msum);
          if (tau2 < minTau2) minTau2 = tau2;
          if (rel) this.relativisticPair(bi, bj, i, j, g, msum);
        }
      }
    }

    // Particles: attracted by bodies, absorbed when they enter one.
    const p = this.particles;
    const pos = p.pos;
    const acc = p.acc;
    const absorbed = this.absorbed;
    absorbed.length = 0;
    const cull2 = PARTICLE_CULL_DISTANCE * PARTICLE_CULL_DISTANCE;
    for (let i = 0; i < p.count; i++) {
      const k = i * 3;
      const px = pos[k];
      const py = pos[k + 1];
      const pz = pos[k + 2];
      let ax = 0;
      let ay = 0;
      let az = 0;
      let dead = px * px + py * py + pz * pz > cull2;
      for (let j = 0; j < n && !dead; j++) {
        const b = bodies[j];
        const dx = b.x - px;
        const dy = b.y - py;
        const dz = b.z - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < b.radius * b.radius) {
          dead = true;
          break;
        }
        const r2 = d2 + eps2;
        const f = (g * b.mass) / (r2 * Math.sqrt(r2));
        ax += dx * f;
        ay += dy * f;
        az += dz * f;
      }
      if (dead) absorbed.push(i);
      acc[k] = ax;
      acc[k + 1] = ay;
      acc[k + 2] = az;
    }

    // Velocity-dependent relativistic forces need finer steps to stay energy-stable in leapfrog.
    const eta = rel ? this.eta * 0.2 : this.eta;
    this.nextDt = Number.isFinite(minTau2) ? Math.min(this.dtMax, Math.max(this.dtMin, eta * Math.sqrt(minTau2))) : this.dtMax;
  }

  /**
   * 1PN (Schwarzschild-like) correction to the relative acceleration of a pair, plus
   * quadrupole gravitational-wave damping when both are compact objects. Applied to
   * the relative motion and split by mass so momentum is conserved.
   */
  private relativisticPair(bi: Body, bj: Body, i: number, j: number, g: number, M: number): void {
    const c = this.lightSpeed;
    const c2 = c * c;
    const pv = this.predVel;
    const rx = bi.x - bj.x, ry = bi.y - bj.y, rz = bi.z - bj.z;
    const vx = pv[i * 3] - pv[j * 3], vy = pv[i * 3 + 1] - pv[j * 3 + 1], vz = pv[i * 3 + 2] - pv[j * 3 + 2];
    const r2 = rx * rx + ry * ry + rz * rz;
    const r = Math.sqrt(r2);
    if (r === 0) return;
    const v2 = vx * vx + vy * vy + vz * vz;
    const rv = rx * vx + ry * vy + rz * vz;
    const gm = g * M;
    const k = gm / (c2 * r2 * r);
    const radial = 4 * (gm / r) - v2;
    let ax = k * (radial * rx + 4 * rv * vx);
    let ay = k * (radial * ry + 4 * rv * vy);
    let az = k * (radial * rz + 4 * rv * vz);
    // The post-Newtonian expansion is only valid while the correction is small. Near a merger
    // (with an exaggerated, low speed of light) it would blow up and even turn repulsive, so cap
    // it at a fraction of Newtonian gravity.
    const aN = gm / r2;
    const a1 = Math.hypot(ax, ay, az);
    if (a1 > 0.25 * aN) {
      const f = (0.25 * aN) / a1;
      ax *= f;
      ay *= f;
      az *= f;
    }
    if (isCompact(bi.kind) && isCompact(bj.kind) && v2 > 0) {
      // Peters (1964) power: P = 32/5 · G⁴ (m₁m₂)² M / (c⁵ r⁵), taken from the relative kinetic energy.
      const mu = (bi.mass * bj.mass) / M;
      const power = (32 / 5) * (g * g * g * g * (bi.mass * bj.mass) ** 2 * M) / (c2 * c2 * c * r2 * r2 * r);
      const drag = power / (mu * v2);
      ax -= drag * vx;
      ay -= drag * vy;
      az -= drag * vz;
    }
    const fi = bj.mass / M, fj = bi.mass / M;
    bi.ax += ax * fi;
    bi.ay += ay * fi;
    bi.az += az * fi;
    bj.ax -= ax * fj;
    bj.ay -= ay * fj;
    bj.az -= az * fj;
  }

  private computeForcesTree(): void {
    const bodies = this.bodies;
    const g = this.effectiveG;
    const eps2 = this.softening * this.softening;
    const tree = this.tree;
    const out = this.scratch;
    tree.build(bodies);
    let minTau2 = Infinity;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      tree.accel(b.x, b.y, b.z, i, g, eps2, out);
      b.ax = out[0];
      b.ay = out[1];
      b.az = out[2];
      const a = Math.hypot(out[0], out[1], out[2]);
      if (a > 0) {
        const len = Math.max(b.radius, this.softening);
        const tau2 = len / a;
        if (tau2 < minTau2) minTau2 = tau2;
      }
    }

    const p = this.particles;
    const pos = p.pos;
    const acc = p.acc;
    const absorbed = this.absorbed;
    absorbed.length = 0;
    const cull2 = PARTICLE_CULL_DISTANCE * PARTICLE_CULL_DISTANCE;
    for (let i = 0; i < p.count; i++) {
      const k = i * 3;
      const px = pos[k], py = pos[k + 1], pz = pos[k + 2];
      if (px * px + py * py + pz * pz > cull2) {
        absorbed.push(i);
        continue;
      }
      tree.accel(px, py, pz, -1, g, eps2, out, true);
      if (Number.isNaN(out[0])) {
        absorbed.push(i);
        acc[k] = acc[k + 1] = acc[k + 2] = 0;
        continue;
      }
      acc[k] = out[0];
      acc[k + 1] = out[1];
      acc[k + 2] = out[2];
    }

    this.nextDt = Number.isFinite(minTau2)
      ? Math.min(this.dtMax, Math.max(this.dtMin, this.etaTree * Math.sqrt(minTau2)))
      : this.dtMax;
  }

  private removeAbsorbedParticles(): void {
    const absorbed = this.absorbed;
    // Descending order keeps swap-with-last removal correct.
    for (let i = absorbed.length - 1; i >= 0; i--) this.particles.remove(absorbed[i]);
    absorbed.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Collisions

  /** Overlapping pairs via sort-and-sweep on x (O(N log N) for sparse systems). */
  private findOverlaps(): [Body, Body][] {
    const bodies = this.bodies;
    const pairs: [Body, Body][] = [];
    const n = bodies.length;
    if (n < 2) return pairs;
    if (n < 40) {
      for (let i = 0; i < n; i++) {
        const a = bodies[i];
        for (let j = i + 1; j < n; j++) if (overlaps(a, bodies[j])) pairs.push([a, bodies[j]]);
      }
      return pairs;
    }
    const sorted = bodies.slice().sort((a, b) => a.x - a.radius - (b.x - b.radius));
    const active: Body[] = [];
    for (const b of sorted) {
      const left = b.x - b.radius;
      let w = 0;
      for (let k = 0; k < active.length; k++) {
        const a = active[k];
        if (a.x + a.radius < left) continue; // drop: can no longer overlap anything later
        active[w++] = a;
        if (overlaps(a, b)) pairs.push([a, b]);
      }
      active.length = w;
      active.push(b);
    }
    return pairs;
  }

  /** Resolve every overlapping pair. Returns true if anything changed. */
  private resolveCollisions(): boolean {
    let any = false;
    for (let pass = 0; pass < 8; pass++) {
      const pairs = this.findOverlaps();
      if (pairs.length === 0) break;
      const dead = new Set<Body>();
      const added: Body[] = [];
      for (const [a, b] of pairs) {
        if (dead.has(a) || dead.has(b)) continue;
        if (!overlaps(a, b)) continue; // an earlier merge moved one of them
        const result = this.collide(a, b);
        for (const d of result.removed) dead.add(d);
        added.push(...result.added);
      }
      this.bodies = this.bodies.filter((b) => !dead.has(b)).concat(added);
      any = true;
    }
    return any;
  }

  private collide(a: Body, b: Body): { removed: Body[]; added: Body[] } {
    const big = a.mass >= b.mass ? a : b;
    const small = big === a ? b : a;
    const relV = Math.hypot(a.vx - b.vx, a.vy - b.vy, a.vz - b.vz);
    const vEsc = Math.sqrt((2 * this.effectiveG * (a.mass + b.mass)) / (a.radius + b.radius));
    if (
      this.shatter &&
      big.kind === 'rocky' &&
      small.kind === 'rocky' &&
      vEsc > 0 &&
      relV > 1.3 * vEsc &&
      small.mass > 0.05 * big.mass &&
      !this.onCooldown(big) &&
      !this.onCooldown(small)
    ) {
      const added = this.shatterPair(big, small, relV, vEsc);
      if (added) return { removed: [small], added };
    }
    this.merge(big, small);
    return { removed: [small], added: [] };
  }

  private onCooldown(b: Body): boolean {
    const until = this.shatterCooldown.get(b.id);
    if (until === undefined) return false;
    if (this.time < until) return true;
    this.shatterCooldown.delete(b.id);
    return false;
  }

  /** Merge `small` into `big` (perfectly inelastic). */
  private merge(big: Body, small: Body): void {
    const m = big.mass + small.mass;
    const g = this.effectiveG;
    const relV = Math.hypot(big.vx - small.vx, big.vy - small.vy, big.vz - small.vz);
    const nx0 = small.x - big.x;
    const ny0 = small.y - big.y;
    const nz0 = small.z - big.z;

    const cx = (big.mass * big.x + small.mass * small.x) / m;
    const cy = (big.mass * big.y + small.mass * small.y) / m;
    const cz = (big.mass * big.z + small.mass * small.z) / m;
    big.vx = (big.mass * big.vx + small.mass * small.vx) / m;
    big.vy = (big.mass * big.vy + small.mass * small.vy) / m;
    big.vz = (big.mass * big.vz + small.mass * small.vz) / m;
    big.x = cx;
    big.y = cy;
    big.z = cz;

    if (isCompact(big.kind) && isCompact(small.kind) && big.kind !== 'whitedwarf' && small.kind !== 'whitedwarf') {
      this.events.push({
        type: 'gwmerger',
        message: `${small.name} and ${big.name} merged in a burst of gravitational waves!`,
        x: cx,
        y: cy,
        z: cz,
        size: big.radius * 20,
      });
    } else {
      this.events.push({ type: 'merge', message: `${small.name} collided with ${big.name}`, x: cx, y: cy, z: cz, size: big.radius });
    }
    const starsOnly = big.kind !== 'blackhole' && small.kind !== 'blackhole' && big.kind !== 'neutron' && small.kind !== 'neutron';
    this.applyMass(big, m, mergedKind(big.kind, small.kind, m), starsOnly);
    if (this.debris && g > 0) this.spawnDebris(big, small, relV, nx0, ny0, nz0);
  }

  /**
   * Set a body's mass and kind, handling transitions: ignition, collapse to a black hole
   * (via a supernova when a star crosses the limit), neutron-star collapse.
   */
  private applyMass(body: Body, mass: number, kind: Body['kind'], allowSupernova = true): void {
    const oldKind = body.kind;
    body.mass = mass;
    if (kind === 'whitedwarf' && mass >= CHANDRASEKHAR_MASS) {
      this.typeIa(body);
      return;
    }
    if (kind === 'blackhole' && (oldKind === 'star' || oldKind === 'giant') && allowSupernova) {
      // A star pushed past the collapse limit explodes, leaving a black hole.
      body.kind = 'star';
      body.radius = radiusFor('star', mass);
      this.supernova(body);
      return;
    }
    body.kind = kind;
    body.radius = radiusFor(kind, mass);
    if (kind !== oldKind || kind === 'star') {
      if (kind !== 'rocky' && kind !== 'gas') body.color = defaultColor(kind, mass);
      else if (oldKind !== 'rocky' && oldKind !== 'gas') body.color = defaultColor(kind, mass);
    }
    const { x, y, z } = body;
    if (kind !== oldKind && kind === 'star') {
      this.events.push({ type: 'ignite', message: `${body.name} ignited into a star!`, x, y, z, size: body.radius * 3 });
    } else if (kind !== oldKind && kind === 'blackhole') {
      this.events.push({ type: 'collapse', message: `${body.name} collapsed into a black hole!`, x, y, z, size: body.radius * 6 });
    }
    this.forcesDirty = true;
  }

  /** Public mass change (e.g. from the UI). Kind follows mass; black holes and neutron stars stay compact. */
  setBodyMass(body: Body, mass: number): void {
    let kind = kindForMass(mass);
    if (body.kind === 'blackhole') kind = 'blackhole';
    else if (body.kind === 'neutron') kind = mergedKind('neutron', 'neutron', mass);
    else if (body.kind === 'whitedwarf') kind = 'whitedwarf';
    else if (body.kind === 'giant') kind = kind === 'blackhole' ? 'blackhole' : mass >= 0.08 ? 'giant' : kind;
    this.applyMass(body, mass, kind);
  }

  /** Fast impact between rocky bodies: a largest remnant plus several massive fragments. */
  private shatterPair(big: Body, small: Body, relV: number, vEsc: number): Body[] | undefined {
    const M = big.mass + small.mass;
    const q = (relV / vEsc) ** 2;
    const fLR = Math.min(0.9, Math.max(0.3, 1.1 - 0.12 * q));
    const mLR = M * fLR;
    const mEj = M - mLR;
    const k = Math.max(2, Math.min(6, Math.round(2 + 5 * (1 - fLR))));
    const mFrag = mEj / k;
    if (mFrag < MIN_FRAGMENT_MASS) return undefined;

    const cx = (big.mass * big.x + small.mass * small.x) / M;
    const cy = (big.mass * big.y + small.mass * small.y) / M;
    const cz = (big.mass * big.z + small.mass * small.z) / M;
    const cvx = (big.mass * big.vx + small.mass * small.vx) / M;
    const cvy = (big.mass * big.vy + small.mass * small.vy) / M;
    const cvz = (big.mass * big.vz + small.mass * small.vz) / M;

    // Impact normal and a perpendicular basis for spreading fragments.
    let nx = small.x - big.x, ny = small.y - big.y, nz = small.z - big.z;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const [ux, uy, uz, wx, wy, wz] = perpendicularBasis(nx, ny, nz);

    const rLR = radiusFor('rocky', mLR);
    const rF = radiusFor('rocky', mFrag);
    const g = this.effectiveG;
    const vEscLR = Math.sqrt((2 * g * mLR) / rLR);
    const fragments: Body[] = [];
    let px = 0, py = 0, pz = 0, sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < k; i++) {
      // Fragments fan out in a cone around the impact normal.
      const ang = (i / k) * Math.PI * 2 + Math.random() * 0.4;
      const tilt = 0.6 + Math.random() * 0.5;
      let dx = nx + Math.tan(tilt) * (Math.cos(ang) * ux + Math.sin(ang) * wx);
      let dy = ny + Math.tan(tilt) * (Math.cos(ang) * uy + Math.sin(ang) * wy);
      let dz = nz + Math.tan(tilt) * (Math.cos(ang) * uz + Math.sin(ang) * wz);
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl; dy /= dl; dz /= dl;
      const dist = (rLR + rF) * 1.8;
      // Mix of radial and tangential launch speeds: some escape, some orbit, some fall back.
      const speed = vEscLR * (0.55 + Math.random() * 0.7);
      const tang = 0.5 + Math.random() * 0.5;
      const tx = Math.cos(ang + Math.PI / 2) * ux + Math.sin(ang + Math.PI / 2) * wx;
      const ty = Math.cos(ang + Math.PI / 2) * uy + Math.sin(ang + Math.PI / 2) * wy;
      const tz = Math.cos(ang + Math.PI / 2) * uz + Math.sin(ang + Math.PI / 2) * wz;
      const f = createBody({
        name: `${small.name} fragment ${i + 1}`,
        kind: 'rocky',
        mass: mFrag,
        color: i % 2 ? small.color : big.color,
        x: cx + dx * dist,
        y: cy + dy * dist,
        z: cz + dz * dist,
        vx: cvx + speed * (dx * (1 - tang) + tx * tang),
        vy: cvy + speed * (dy * (1 - tang) + ty * tang),
        vz: cvz + speed * (dz * (1 - tang) + tz * tang),
      });
      fragments.push(f);
      px += mFrag * f.vx; py += mFrag * f.vy; pz += mFrag * f.vz;
      sx += mFrag * f.x; sy += mFrag * f.y; sz += mFrag * f.z;
    }
    // Remnant takes whatever momentum and centre-of-mass offset keeps the totals exact.
    big.mass = mLR;
    big.kind = 'rocky';
    big.radius = rLR;
    big.x = (M * cx - sx) / mLR;
    big.y = (M * cy - sy) / mLR;
    big.z = (M * cz - sz) / mLR;
    big.vx = (M * cvx - px) / mLR;
    big.vy = (M * cvy - py) / mLR;
    big.vz = (M * cvz - pz) / mLR;

    // Fragments re-colliding soon after should merge, not cascade into ever-smaller pieces.
    const cooldown = this.time + 2;
    this.shatterCooldown.set(big.id, cooldown);
    for (const f of fragments) this.shatterCooldown.set(f.id, cooldown);
    this.events.push({ type: 'shatter', message: `${small.name} and ${big.name} shattered on impact!`, x: cx, y: cy, z: cz, size: rLR * 2 });
    if (this.debris) this.spawnDebris(big, small, relV, nx, ny, nz);
    this.forcesDirty = true;
    return fragments;
  }

  private spawnDebris(big: Body, small: Body, relV: number, nx: number, ny: number, nz: number): void {
    const vEsc = Math.sqrt((2 * this.effectiveG * big.mass) / big.radius);
    if (!(vEsc > 0) || relV < 0.15 * vEsc) return;
    const massFactor = Math.min(1, (small.mass / big.mass) * 40);
    const count = Math.round(Math.min(150, 40 * (relV / vEsc)) * massFactor);
    if (count < 3) return;

    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const base = small.kind === 'star' || big.kind === 'star' ? kelvinToRgb(3500) : hexToRgb(small.color);
    for (let i = 0; i < count; i++) {
      // Spray roughly outward from the impact site.
      let dx = nx + gaussian() * 0.7;
      let dy = ny + gaussian() * 0.7;
      let dz = nz + gaussian() * 0.7;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      const r = big.radius * (1.15 + Math.random() * 0.4);
      const speed = vEsc * (0.35 + Math.random() * 0.9);
      const heat = Math.random();
      const rgb: Rgb = [
        Math.min(1, base[0] * 0.5 + 0.6 * heat + 0.2),
        Math.min(1, base[1] * 0.5 + 0.35 * heat),
        Math.min(1, base[2] * 0.5 + 0.1 * heat),
      ];
      this.particles.add(big.x + dx * r, big.y + dy * r, big.z + dz * r, big.vx + dx * speed, big.vy + dy * speed, big.vz + dz * speed, rgb);
    }
  }

  // ---------------------------------------------------------------------------
  // Tides

  /** Distance (AU) inside which `primary` tears `victim` apart. */
  rocheLimit(primary: Body, victim: Body): number {
    if (isCompact(primary.kind)) {
      // Classic tidal-disruption radius r_t ≈ R (M / m)^⅓.
      return 0.8 * victim.radius * Math.cbrt(primary.mass / victim.mass);
    }
    return 2.44 * primary.radius * Math.cbrt(NOMINAL_DENSITY[primary.kind] / NOMINAL_DENSITY[victim.kind]);
  }

  /** Which primaries can tidally disrupt which victims (keeps rocky-on-rocky accretion intact). */
  private canDisrupt(primary: Body, victim: Body): boolean {
    // Spacecraft are far too small and rigid to be torn apart by tides.
    if (victim.mass > 0.2 * primary.mass || victim.tag === 'probe') return false;
    switch (victim.kind) {
      case 'rocky':
        return primary.kind !== 'rocky';
      case 'gas':
        return primary.kind === 'star' || primary.kind === 'giant' || isCompact(primary.kind);
      case 'star':
      case 'giant':
        return isCompact(primary.kind);
      default:
        return false;
    }
  }

  private resolveTides(): boolean {
    const bodies = this.bodies;
    // Only certain primaries can disrupt each kind of victim (see canDisrupt), so pre-filter.
    const compact: Body[] = [];
    const luminousOrCompact: Body[] = [];
    const nonRocky: Body[] = [];
    let victimCount = 0;
    for (const b of bodies) {
      if (b.kind !== 'rocky') nonRocky.push(b);
      if (b.kind === 'star' || b.kind === 'giant' || isCompact(b.kind)) luminousOrCompact.push(b);
      if (isCompact(b.kind)) compact.push(b);
      if (b.kind === 'rocky' || b.kind === 'gas' || b.kind === 'star' || b.kind === 'giant') victimCount++;
    }
    if (victimCount === 0 || nonRocky.length === 0) return false;
    const dead = new Set<Body>();
    for (const v of bodies) {
      const candidates =
        v.kind === 'star' || v.kind === 'giant' ? compact : v.kind === 'gas' ? luminousOrCompact : v.kind === 'rocky' ? nonRocky : undefined;
      if (!candidates || candidates.length === 0 || dead.has(v)) continue;
      for (const p of candidates) {
        if (p === v || dead.has(p) || !this.canDisrupt(p, v)) continue;
        const d = Math.hypot(v.x - p.x, v.y - p.y, v.z - p.z);
        if (d < p.radius + v.radius) continue; // a collision, not a tidal event
        if (d < this.rocheLimit(p, v)) {
          this.disrupt(p, v, d);
          dead.add(v);
          break;
        }
      }
    }
    if (dead.size === 0) return false;
    this.bodies = this.bodies.filter((b) => !dead.has(b));
    return true;
  }

  /** Tear `victim` into a stream of debris; a fraction accretes onto the primary. */
  private disrupt(primary: Body, victim: Body, dist: number): void {
    const compact = isCompact(primary.kind);
    const accreted = victim.mass * (compact ? 0.5 : 0.15);
    const m = primary.mass + accreted;
    primary.vx = (primary.mass * primary.vx + accreted * victim.vx) / m;
    primary.vy = (primary.mass * primary.vy + accreted * victim.vy) / m;
    primary.vz = (primary.mass * primary.vz + accreted * victim.vz) / m;
    this.applyMass(primary, m, mergedKind(primary.kind, primary.kind, m));

    const count = victim.kind === 'star' || victim.kind === 'giant' ? 1400 : victim.kind === 'gas' ? 700 : 350;
    const ux = (victim.x - primary.x) / dist, uy = (victim.y - primary.y) / dist, uz = (victim.z - primary.z) / dist;
    const rvx = victim.vx - primary.vx, rvy = victim.vy - primary.vy, rvz = victim.vz - primary.vz;
    const base = victim.kind === 'star' || victim.kind === 'giant' ? kelvinToRgb(6000) : hexToRgb(victim.color);
    const stretch = Math.max(victim.radius * 4, dist * 0.08);
    for (let i = 0; i < count; i++) {
      // Spread along the tidal axis; each particle keeps the orbit its new distance implies.
      const s = (Math.random() * 2 - 1) * stretch;
      const r = Math.max(primary.radius * 1.05, dist + s);
      const scale = Math.sqrt(dist / r) * (1 + gaussian() * 0.015);
      const j = victim.radius * 0.6;
      const shade = 0.75 + Math.random() * 0.4;
      this.particles.add(
        primary.x + ux * r + gaussian() * j,
        primary.y + uy * r + gaussian() * j * 0.3,
        primary.z + uz * r + gaussian() * j,
        primary.vx + rvx * scale,
        primary.vy + rvy * scale,
        primary.vz + rvz * scale,
        [Math.min(1, base[0] * shade), Math.min(1, base[1] * shade), Math.min(1, base[2] * shade)],
      );
    }
    this.events.push({
      type: 'disrupt',
      message: `${victim.name} was torn apart by ${primary.name}'s tides!`,
      x: victim.x,
      y: victim.y,
      z: victim.z,
      size: victim.radius * 4,
    });
  }

  // ---------------------------------------------------------------------------
  // Supernovae

  canSupernova(body: Body): boolean {
    return (body.kind === 'star' || body.kind === 'giant') && body.mass >= SUPERNOVA_MIN_MASS;
  }

  /** Age every body by `years` (instant evolution time-lapse) and apply stellar transitions. */
  ageBy(years: number): void {
    for (const b of this.bodies) b.age += years;
    // Several transitions may be due at once (star → giant → white dwarf).
    for (let i = 0; i < 3 && this.evolveStars(); i++);
    if (this.doomed.size) {
      this.bodies = this.bodies.filter((b) => !this.doomed.has(b));
      this.doomed.clear();
    }
    this.forcesDirty = true;
  }

  /** Main-sequence stars past their lifetime swell into giants; giants shed their envelopes. */
  private evolveStars(): boolean {
    let changed = false;
    for (const b of this.bodies) {
      if (b.kind === 'star') {
        const life = mainSequenceLifetime(b.mass);
        if (b.age < life) continue;
        if (b.mass >= SUPERNOVA_MIN_MASS) {
          changed = this.supernova(b) || changed;
        } else {
          b.kind = 'giant';
          b.radius = radiusFor('giant', b.mass);
          b.color = defaultColor('giant', b.mass);
          this.events.push({ type: 'redgiant', message: `${b.name} swelled into a red giant!`, x: b.x, y: b.y, z: b.z, size: b.radius * 2 });
          changed = true;
        }
      } else if (b.kind === 'giant' && b.age >= mainSequenceLifetime(b.mass) * 1.1) {
        if (b.mass >= SUPERNOVA_MIN_MASS) changed = this.supernova(b) || changed;
        else {
          this.planetaryNebula(b);
          changed = true;
        }
      }
    }
    if (changed) this.forcesDirty = true;
    return changed;
  }

  /** A giant gently sheds its envelope as a glowing shell, leaving a white dwarf. */
  private planetaryNebula(giant: Body): void {
    const wd = Math.min(1.3, Math.max(0.5, 0.5 + 0.08 * (giant.mass - 1)));
    const R = giant.radius;
    const g = Math.max(this.effectiveG, G * 0.1);
    const v = Math.max(3, 0.5 * Math.sqrt((2 * g * giant.mass) / R));
    const p = this.particles;
    const count = Math.min(1200, p.capacity - p.count);
    const palette: Rgb[] = [
      [0.35, 0.95, 0.85],
      [1, 0.45, 0.65],
      [0.5, 0.65, 1],
    ];
    for (let i = 0; i < count; i++) {
      const u = 2 * Math.random() - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const dx = s * Math.cos(th), dy = u * 0.7, dz = s * Math.sin(th);
      const speed = v * (0.8 + Math.random() * 0.4);
      const c = palette[i % palette.length];
      p.add(giant.x + dx * R, giant.y + dy * R, giant.z + dz * R, giant.vx + dx * speed, giant.vy + dy * speed, giant.vz + dz * speed, c);
    }
    giant.kind = 'whitedwarf';
    giant.mass = wd;
    giant.radius = radiusFor('whitedwarf', wd);
    giant.color = defaultColor('whitedwarf', wd);
    this.events.push({
      type: 'nebula',
      message: `${giant.name} shed its outer layers as a planetary nebula, leaving a white dwarf.`,
      x: giant.x,
      y: giant.y,
      z: giant.z,
      size: R * 3,
    });
  }

  /** A white dwarf pushed past the Chandrasekhar limit detonates completely. */
  private typeIa(wd: Body): void {
    const g = Math.max(this.effectiveG, G * 0.1);
    const vEj = Math.max(40, 4 * Math.sqrt((2 * g * wd.mass) / 0.03));
    const p = this.particles;
    const count = Math.min(1600, p.capacity - p.count);
    for (let i = 0; i < count; i++) {
      const u = 2 * Math.random() - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const dx = s * Math.cos(th), dy = u, dz = s * Math.sin(th);
      const v = vEj * (0.8 + Math.random() * 0.4);
      p.add(wd.x, wd.y, wd.z, wd.vx + dx * v, wd.vy + dy * v, wd.vz + dz * v, kelvinToRgb(7000 + Math.random() * 8000));
    }
    this.shockwaves.push({ x: wd.x, y: wd.y, z: wd.z, radius: 0.05, speed: vEj, momentum: wd.mass * vEj, maxRadius: Math.min(3000, vEj * 20), sourceId: wd.id, hit: new Set([wd.id]) });
    this.events.push({
      type: 'supernova',
      message: `${wd.name} passed the Chandrasekhar limit and exploded as a Type Ia supernova!`,
      x: wd.x,
      y: wd.y,
      z: wd.z,
      size: 2,
    });
    wd.radius = 0;
    this.doomed.add(wd);
    this.forcesDirty = true;
  }

  /**
   * Core-collapse supernova: the star becomes a neutron star (8–20 M☉) or black hole
   * (≥ 20 M☉), its envelope is ejected as an expanding shell, and a shockwave pushes on
   * everything it passes.
   */
  supernova(star: Body): boolean {
    if (!this.canSupernova(star)) return false;
    const M = star.mass;
    const R = star.radius;
    const remnantKind = M >= 20 ? 'blackhole' : 'neutron';
    const remnant = remnantKind === 'blackhole' ? Math.max(3, M * 0.3) : 1.4;
    const ejecta = M - remnant;
    const g = Math.max(this.effectiveG, G * 0.1);
    const vEj = Math.max(30, 3 * Math.sqrt((2 * g * M) / R));

    const p = this.particles;
    const count = Math.min(1600, p.capacity - p.count);
    for (let i = 0; i < count; i++) {
      const u = 2 * Math.random() - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const dx = s * Math.cos(th), dy = u, dz = s * Math.sin(th);
      const v = vEj * (0.8 + Math.random() * 0.4);
      const rgb = kelvinToRgb(4000 + Math.random() * 12000);
      p.add(star.x + dx * R * 1.2, star.y + dy * R * 1.2, star.z + dz * R * 1.2, star.vx + dx * v, star.vy + dy * v, star.vz + dz * v, rgb);
    }
    this.shockwaves.push({
      x: star.x,
      y: star.y,
      z: star.z,
      radius: R,
      speed: vEj,
      momentum: ejecta * vEj,
      maxRadius: Math.min(3000, vEj * 20),
      sourceId: star.id,
      hit: new Set([star.id]),
    });

    const name = star.name;
    star.kind = remnantKind;
    star.mass = remnant;
    star.radius = radiusFor(remnantKind, remnant);
    star.color = defaultColor(remnantKind, remnant);
    this.events.push({
      type: 'supernova',
      message: `${name} went supernova, leaving a ${remnantKind === 'blackhole' ? 'black hole' : 'neutron star'}!`,
      x: star.x,
      y: star.y,
      z: star.z,
      size: R * 25,
    });
    this.forcesDirty = true;
    return true;
  }

  private updateShockwaves(dt: number): void {
    const p = this.particles;
    for (let w = this.shockwaves.length - 1; w >= 0; w--) {
      const sw = this.shockwaves[w];
      const prev = sw.radius;
      sw.radius += sw.speed * dt;
      for (const b of this.bodies) {
        if (sw.hit.has(b.id)) continue;
        const dx = b.x - sw.x, dy = b.y - sw.y, dz = b.z - sw.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > sw.radius) continue;
        sw.hit.add(b.id);
        // Momentum intercepted ∝ cross-section / shell area.
        const frac = Math.min(0.5, (b.radius * b.radius) / (4 * d * d));
        const dv = Math.min((sw.momentum * frac) / b.mass, 0.6 * sw.speed);
        const inv = 1 / (d || 1);
        b.vx += dx * inv * dv;
        b.vy += dy * inv * dv;
        b.vz += dz * inv * dv;
      }
      for (let i = 0; i < p.count; i++) {
        const k = i * 3;
        const dx = p.pos[k] - sw.x, dy = p.pos[k + 1] - sw.y, dz = p.pos[k + 2] - sw.z;
        const d = Math.hypot(dx, dy, dz);
        if (d <= prev || d > sw.radius) continue;
        const dv = 0.3 * sw.speed * Math.min(1, (sw.maxRadius * 0.05) / d);
        p.vel[k] += (dx / d) * dv;
        p.vel[k + 1] += (dy / d) * dv;
        p.vel[k + 2] += (dz / d) * dv;
      }
      if (sw.radius > sw.maxRadius) this.shockwaves.splice(w, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities

  /** Shift positions/velocities so the centre of mass is at rest at the origin. */
  recenter(): void {
    let m = 0;
    let x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0;
    for (const b of this.bodies) {
      m += b.mass;
      x += b.mass * b.x;
      y += b.mass * b.y;
      z += b.mass * b.z;
      vx += b.mass * b.vx;
      vy += b.mass * b.vy;
      vz += b.mass * b.vz;
    }
    if (m === 0) return;
    x /= m; y /= m; z /= m; vx /= m; vy /= m; vz /= m;
    for (const b of this.bodies) {
      b.x -= x; b.y -= y; b.z -= z;
      b.vx -= vx; b.vy -= vy; b.vz -= vz;
    }
    const p = this.particles;
    for (let i = 0; i < p.count; i++) {
      const k = i * 3;
      p.pos[k] -= x; p.pos[k + 1] -= y; p.pos[k + 2] -= z;
      p.vel[k] -= vx; p.vel[k + 1] -= vy; p.vel[k + 2] -= vz;
    }
    for (const sw of this.shockwaves) {
      sw.x -= x; sw.y -= y; sw.z -= z;
    }
    this.forcesDirty = true;
  }

  /** Body with the strongest gravitational pull at a point, excluding `exclude`. */
  dominantBodyAt(x: number, y: number, z: number, exclude?: Body): Body | undefined {
    let best: Body | undefined;
    let bestPull = 0;
    for (const b of this.bodies) {
      if (b === exclude) continue;
      const d2 = (b.x - x) ** 2 + (b.y - y) ** 2 + (b.z - z) ** 2;
      const pull = b.mass / Math.max(d2, 1e-12);
      if (pull > bestPull) {
        bestPull = pull;
        best = b;
      }
    }
    return best;
  }

  /**
   * The body `body` is actually orbiting: the heavier body it is gravitationally bound to
   * with the strongest pull. Falls back to the dominant body.
   */
  parentOf(body: Body): Body | undefined {
    let best: Body | undefined;
    let bestPull = 0;
    const g = this.effectiveG;
    for (const b of this.bodies) {
      if (b === body || b.mass < body.mass) continue;
      const dx = body.x - b.x, dy = body.y - b.y, dz = body.z - b.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const v2 = (body.vx - b.vx) ** 2 + (body.vy - b.vy) ** 2 + (body.vz - b.vz) ** 2;
      const bound = v2 / 2 - (g * (b.mass + body.mass)) / Math.sqrt(d2) < 0;
      const pull = b.mass / Math.max(d2, 1e-12);
      if (bound && pull > bestPull) {
        bestPull = pull;
        best = b;
      }
    }
    return best ?? this.dominantBodyAt(body.x, body.y, body.z, body);
  }

  totalEnergy(): number {
    const g = this.effectiveG;
    let e = 0;
    const bs = this.bodies;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      e += 0.5 * a.mass * (a.vx * a.vx + a.vy * a.vy + a.vz * a.vz);
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        e -= (g * a.mass * b.mass) / Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      }
    }
    return e;
  }

  totalMomentum(): [number, number, number] {
    let px = 0, py = 0, pz = 0;
    for (const b of this.bodies) {
      px += b.mass * b.vx;
      py += b.mass * b.vy;
      pz += b.mass * b.vz;
    }
    return [px, py, pz];
  }

  totalMass(): number {
    return this.bodies.reduce((s, b) => s + b.mass, 0);
  }
}

function overlaps(a: Body, b: Body): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const rr = a.radius + b.radius;
  return dx * dx + dy * dy + dz * dz < rr * rr;
}

function perpendicularBasis(nx: number, ny: number, nz: number): [number, number, number, number, number, number] {
  // Any vector not parallel to n.
  const ax = Math.abs(nx) < 0.9 ? 1 : 0;
  const ay = ax ? 0 : 1;
  let ux = ny * 0 - nz * ay;
  let uy = nz * ax - nx * 0;
  let uz = nx * ay - ny * ax;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const wx = ny * uz - nz * uy;
  const wy = nz * ux - nx * uz;
  const wz = nx * uy - ny * ux;
  return [ux, uy, uz, wx, wy, wz];
}

export function hexToRgb(hex: number): Rgb {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
