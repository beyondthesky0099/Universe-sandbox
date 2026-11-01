import { Body, BodyInit, createBody, defaultColor, mergedKind, radiusFor } from './body';
import { kelvinToRgb } from './color';
import { ParticleSet } from './particles';
import { G } from './units';

export type SimEventType = 'merge' | 'ignite' | 'collapse';

export interface SimEvent {
  type: SimEventType;
  message: string;
  x: number;
  y: number;
  z: number;
  /** Visual size hint (AU) for effects. */
  size: number;
}

export interface AdvanceResult {
  steps: number;
  /** True if the simulation could not keep up and dropped time this frame. */
  lagging: boolean;
}

const PARTICLE_CULL_DISTANCE = 5000; // AU

/**
 * N-body gravity simulation.
 *
 * Integrator: kick-drift-kick leapfrog (second order, symplectic for fixed dt) with a
 * global adaptive timestep: dt = eta · min over pairs of sqrt(r³ / G(m₁+m₂)), i.e. a
 * fixed fraction of the shortest orbital / free-fall timescale in the system.
 *
 * Collisions are perfectly inelastic merges that conserve mass and momentum, and can
 * eject massless debris particles.
 */
export class Simulation {
  bodies: Body[] = [];
  readonly particles: ParticleSet;
  readonly events: SimEvent[] = [];

  time = 0;
  /** Multiplier on G. 0 disables gravity entirely. */
  gravityScale = 1;
  collisions = true;
  debris = true;
  /** Fraction of the shortest dynamical timescale per step. Smaller = more accurate. */
  eta = 0.015;
  dtMax = 0.01;
  dtMin = 1e-8;
  /** Plummer softening length (AU) to avoid singular forces. */
  softening = 1e-4;

  private nextDt = this.dtMax;
  private forcesDirty = true;
  private readonly absorbed: number[] = [];

  constructor(particleCapacity = 20000) {
    this.particles = new ParticleSet(particleCapacity);
  }

  addBody(init: BodyInit): Body {
    const body = createBody(init);
    this.bodies.push(body);
    this.forcesDirty = true;
    return body;
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
    this.time = 0;
    this.forcesDirty = true;
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
      if ((steps & 15) === 0 && performance.now() - start > budgetMs) break;
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

    this.computeForces();

    for (const b of bodies) {
      b.vx += b.ax * h;
      b.vy += b.ay * h;
      b.vz += b.az * h;
    }
    for (let k = 0; k < n3; k++) vel[k] += acc[k] * h;

    this.time += dt;
    this.removeAbsorbedParticles();
    if (this.collisions && this.resolveCollisions()) this.computeForces();
  }

  /** Compute accelerations for bodies and particles, and pick the next timestep. */
  computeForces(): void {
    const bodies = this.bodies;
    const n = bodies.length;
    const g = this.effectiveG;
    const eps2 = this.softening * this.softening;
    let minTau2 = Infinity;

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

    this.nextDt = Number.isFinite(minTau2)
      ? Math.min(this.dtMax, Math.max(this.dtMin, this.eta * Math.sqrt(minTau2)))
      : this.dtMax;
    this.forcesDirty = false;
  }

  private removeAbsorbedParticles(): void {
    const absorbed = this.absorbed;
    // Descending order keeps swap-with-last removal correct.
    for (let i = absorbed.length - 1; i >= 0; i--) this.particles.remove(absorbed[i]);
    absorbed.length = 0;
  }

  /** Merge every overlapping pair. Returns true if anything merged. */
  private resolveCollisions(): boolean {
    let any = false;
    let changed = true;
    while (changed) {
      changed = false;
      const bodies = this.bodies;
      search: for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          const rr = a.radius + b.radius;
          if (dx * dx + dy * dy + dz * dz < rr * rr) {
            const loser = this.merge(a, b);
            this.bodies = bodies.filter((x) => x !== loser);
            changed = any = true;
            break search;
          }
        }
      }
    }
    return any;
  }

  /** Merge two bodies into the heavier one. Returns the body that was absorbed (caller removes it). */
  private merge(a: Body, b: Body): Body {
    const big = a.mass >= b.mass ? a : b;
    const small = big === a ? b : a;
    const m = a.mass + b.mass;
    const g = this.effectiveG;

    const relV = Math.hypot(a.vx - b.vx, a.vy - b.vy, a.vz - b.vz);
    const nx0 = small.x - big.x;
    const ny0 = small.y - big.y;
    const nz0 = small.z - big.z;

    const cx = (a.mass * a.x + b.mass * b.x) / m;
    const cy = (a.mass * a.y + b.mass * b.y) / m;
    const cz = (a.mass * a.z + b.mass * b.z) / m;
    const cvx = (a.mass * a.vx + b.mass * b.vx) / m;
    const cvy = (a.mass * a.vy + b.mass * b.vy) / m;
    const cvz = (a.mass * a.vz + b.mass * b.vz) / m;

    const oldKind = big.kind;
    const kind = mergedKind(a.kind, b.kind, m);
    big.kind = kind;
    big.mass = m;
    big.radius = radiusFor(kind, m);
    big.x = cx;
    big.y = cy;
    big.z = cz;
    big.vx = cvx;
    big.vy = cvy;
    big.vz = cvz;
    if (kind !== oldKind || kind === 'star') big.color = defaultColor(kind, m);

    this.events.push({
      type: 'merge',
      message: `${small.name} collided with ${big.name}`,
      x: cx,
      y: cy,
      z: cz,
      size: big.radius,
    });
    if (kind !== oldKind && kind === 'star') {
      this.events.push({ type: 'ignite', message: `${big.name} ignited into a star!`, x: cx, y: cy, z: cz, size: big.radius * 3 });
    } else if (kind !== oldKind && kind === 'blackhole') {
      this.events.push({ type: 'collapse', message: `${big.name} collapsed into a black hole!`, x: cx, y: cy, z: cz, size: big.radius * 6 });
    }

    if (this.debris && g > 0) this.spawnDebris(big, small, relV, nx0, ny0, nz0);
    return small;
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
      const rgb: [number, number, number] = [
        Math.min(1, base[0] * 0.5 + 0.6 * heat + 0.2),
        Math.min(1, base[1] * 0.5 + 0.35 * heat),
        Math.min(1, base[2] * 0.5 + 0.1 * heat),
      ];
      this.particles.add(
        big.x + dx * r,
        big.y + dy * r,
        big.z + dz * r,
        big.vx + dx * speed,
        big.vy + dy * speed,
        big.vz + dz * speed,
        rgb,
      );
    }
  }

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
}

function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
