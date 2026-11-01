import type { Body, BodyInit } from '../sim/body';
import type { OrbitalElements } from '../sim/orbits';
import { addOrbiting } from '../sim/presets';
import type { CustomForce, Simulation } from '../sim/simulation';
import { AU_PER_YEAR_IN_KMS, EARTH_MASS, G, JUPITER_MASS } from '../sim/units';

/**
 * In-browser scripting. Scripts run in the page with an `api` object (documented in
 * SCRIPT_HELP) and can add bodies, push them around, react every frame, and install custom
 * force laws. Force laws run inside the physics worker, so they must be self-contained
 * functions (no closures over outside variables).
 */

export interface ScriptHost {
  sim: Simulation;
  commit(): void;
  setRunning(on: boolean): void;
  setTimeScale(yearsPerSecond: number): void;
  select(body: Body | undefined): void;
  follow(body: Body | undefined): void;
  setForces(forces: CustomForce[]): void;
  getForces(): CustomForce[];
  log(text: string, kind?: 'out' | 'error'): void;
}

export type FrameHook = (dt: number) => void;

export const SCRIPT_HELP = `api.bodies()                      all bodies
api.body(name)                    find a body by name
api.add({ name, mass, kind, x, z, vx, vz, color })     add a body (mass in M☉)
api.orbit(parentName, { name, mass, kind }, { a, e, inc, nu })   add a body on an orbit
api.remove(name)                  delete a body
api.nudge(name, [vx, vy, vz])     change velocity by km/s
api.pause() · api.play() · api.speed(yearsPerSecond)
api.select(name) · api.follow(name)
api.force(name, (body, time, sim) => [ax, ay, az])     custom force law (AU/yr²), runs in the physics worker
api.clearForces()
api.onFrame(dt => { ... })        run code every frame (stopped by "Stop")
api.log(...values)
Constants: api.G, api.EARTH, api.JUPITER, api.KMS (AU/yr per km/s)`;

export const EXAMPLES: { name: string; code: string }[] = [
  {
    name: 'Ring of moons',
    code: `// Put 12 small moons on circular orbits around the most massive planet.
const planet = api.bodies().filter((b) => b.kind === 'gas').sort((a, b) => b.mass - a.mass)[0];
if (!planet) throw new Error('Load a scene with a gas giant first (e.g. Solar System).');
for (let i = 0; i < 12; i++) {
  api.orbit(planet.name, { name: 'Moonlet ' + (i + 1), mass: 0.001 * api.EARTH, kind: 'rocky' }, { a: 0.25, nu: (i / 12) * 2 * Math.PI });
}
api.follow(planet.name);
api.log('Added 12 moons around ' + planet.name);`,
  },
  {
    name: 'Drag: orbits spiral in',
    code: `// A gentle drag force: every body slowly loses speed relative to the system centre.
api.force('drag', (b) => [-0.05 * b.vx, -0.05 * b.vy, -0.05 * b.vz]);
api.log('Drag on. Run api.clearForces() to remove it.');`,
  },
  {
    name: 'Stronger gravity far away (MOND-like)',
    code: `// Adds an extra 1/r pull toward every star, flattening orbital speeds at large distances.
api.force('mond', (b, t, sim) => {
  let ax = 0, ay = 0, az = 0;
  for (const s of sim.bodies) {
    if (s === b || s.kind !== 'star') continue;
    const dx = s.x - b.x, dy = s.y - b.y, dz = s.z - b.z;
    const r2 = dx * dx + dy * dy + dz * dz + 1e-6;
    const k = 2.0 * Math.sqrt(s.mass) / r2;
    ax += dx * k; ay += dy * k; az += dz * k;
  }
  return [ax, ay, az];
});`,
  },
  {
    name: 'Comet shower',
    code: `// Spawn a comet from the edge of the system every second, aimed loosely inward.
let timer = 0, n = 0;
api.onFrame((dt) => {
  timer += dt;
  if (timer < 1 || n >= 20) return;
  timer = 0; n++;
  const ang = Math.random() * Math.PI * 2;
  const r = 12;
  api.add({ name: 'Comet ' + n, mass: 1e-4 * api.EARTH, kind: 'rocky', x: Math.cos(ang) * r, z: Math.sin(ang) * r,
    vx: -Math.cos(ang + 0.3) * 2, vz: -Math.sin(ang + 0.3) * 2, color: 0xcfe6ff });
});`,
  },
  {
    name: 'List orbital periods',
    code: `// Print each body's distance and speed relative to the heaviest body.
const sun = api.bodies().sort((a, b) => b.mass - a.mass)[0];
for (const b of api.bodies()) {
  if (b === sun) continue;
  const r = Math.hypot(b.x - sun.x, b.y - sun.y, b.z - sun.z);
  const period = Math.sqrt(r ** 3 / sun.mass);
  api.log(b.name.padEnd(14), 'r =', r.toFixed(2), 'AU', ' T ≈', period.toFixed(2), 'yr');
}`,
  },
];

export class ScriptRunner {
  private hooks: FrameHook[] = [];
  private readonly host: ScriptHost;

  constructor(host: ScriptHost) {
    this.host = host;
  }

  get active(): boolean {
    return this.hooks.length > 0;
  }

  private api() {
    const h = this.host;
    const sim = () => h.sim;
    const find = (name: string) => {
      const b = sim().bodies.find((x) => x.name === name);
      if (!b) throw new Error(`No body named "${name}"`);
      return b;
    };
    const fmt = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(Number(v.toPrecision(6))) : JSON.stringify(v));
    return {
      G,
      EARTH: EARTH_MASS,
      JUPITER: JUPITER_MASS,
      KMS: 1 / AU_PER_YEAR_IN_KMS,
      get sim() {
        return sim();
      },
      bodies: () => [...sim().bodies],
      body: (name: string) => sim().bodies.find((b) => b.name === name),
      add: (init: BodyInit) => {
        const b = sim().addBody(init);
        h.commit();
        return b;
      },
      orbit: (parent: string, init: { name: string; mass: number; kind?: Body['kind']; color?: number }, el: OrbitalElements) => {
        const b = addOrbiting(sim(), find(parent), init, el);
        h.commit();
        return b;
      },
      remove: (name: string) => {
        sim().removeBody(find(name).id);
        h.commit();
      },
      nudge: (name: string, dvKms: [number, number, number]) => {
        const b = find(name);
        const k = 1 / AU_PER_YEAR_IN_KMS;
        b.vx += dvKms[0] * k;
        b.vy += dvKms[1] * k;
        b.vz += dvKms[2] * k;
        h.commit();
      },
      pause: () => h.setRunning(false),
      play: () => h.setRunning(true),
      speed: (yps: number) => h.setTimeScale(yps),
      select: (name: string) => h.select(find(name)),
      follow: (name: string) => h.follow(find(name)),
      force: (name: string, fn: ((b: Body, t: number, s: Simulation) => [number, number, number] | void) | string) => {
        const code = typeof fn === 'function' ? `return (${fn.toString()})(body, time, sim);` : fn;
        // Compile here first so syntax errors surface in the console, not silently in the worker.
        new Function('body', 'time', 'sim', code);
        const forces = h.getForces().filter((f) => f.name !== name);
        forces.push({ name, code });
        h.setForces(forces);
      },
      clearForces: () => h.setForces([]),
      onFrame: (fn: FrameHook) => {
        this.hooks.push(fn);
      },
      log: (...values: unknown[]) => h.log(values.map(fmt).join(' ')),
    };
  }

  /** Run a script. Returns false if it threw. */
  run(code: string): boolean {
    try {
      const fn = new Function('api', `"use strict";\n${code}`);
      const result = fn(this.api());
      if (result instanceof Promise) result.catch((e: unknown) => this.host.log(String(e), 'error'));
      this.host.commit();
      return true;
    } catch (err) {
      this.host.log(err instanceof Error ? err.message : String(err), 'error');
      return false;
    }
  }

  /** Run per-frame hooks; a hook that throws is removed. */
  frame(dt: number): void {
    for (const hook of [...this.hooks]) {
      try {
        hook(dt);
      } catch (err) {
        this.hooks = this.hooks.filter((h) => h !== hook);
        this.host.log(`onFrame stopped: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    }
  }

  stop(): void {
    this.hooks = [];
  }
}
