import { BODY_KINDS, type Body, type BodyKind } from '../sim/body';
import { addOrbiting, type SceneSetup } from '../sim/presets';
import type { Simulation } from '../sim/simulation';
import { AU_PER_YEAR_IN_KMS, EARTH_MASS, JUPITER_MASS } from '../sim/units';

/** Scene spec produced by the server's Claude scene builder (mirrors server/src/scene.ts). */
export interface SceneBodySpec {
  name: string;
  kind: BodyKind;
  mass: number;
  massUnit: 'earth' | 'jupiter' | 'sun';
  orbits: string;
  a: number;
  e: number;
  inclinationDeg: number;
  phaseDeg: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  color: string;
}

export interface SceneSpec {
  title: string;
  summary: string;
  timeScale: number;
  cameraDistance: number;
  relativity: boolean;
  bodies: SceneBodySpec[];
}

const UNIT = { earth: EARTH_MASS, jupiter: JUPITER_MASS, sun: 1 } as const;
const DEG = Math.PI / 180;
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Build a simulation from a scene spec. Defensive: the spec comes over the network, so every
 * field is re-validated; bodies whose parent is unknown become free bodies.
 */
export function buildFromSpec(sim: Simulation, spec: SceneSpec): SceneSetup {
  sim.relativity = !!spec.relativity;
  if (sim.relativity) sim.lightSpeedScale = 0.002;
  const byName = new Map<string, Body>();
  for (const raw of (spec.bodies ?? []).slice(0, 60)) {
    const kind: BodyKind = BODY_KINDS.includes(raw.kind) ? raw.kind : 'rocky';
    const mass = Math.max(1e-12, finite(raw.mass, 1) * (UNIT[raw.massUnit] ?? EARTH_MASS));
    const name = String(raw.name || `Body ${byName.size + 1}`).slice(0, 40);
    if (byName.has(name)) continue;
    const color = /^#[0-9a-fA-F]{6}$/.test(raw.color ?? '') ? parseInt(raw.color.slice(1), 16) : undefined;
    const kick = { x: finite(raw.vx, 0) / AU_PER_YEAR_IN_KMS, z: finite(raw.vz, 0) / AU_PER_YEAR_IN_KMS };
    const parent = raw.orbits ? byName.get(raw.orbits) : undefined;
    let body: Body;
    if (parent) {
      body = addOrbiting(sim, parent, { name, mass, kind, color }, {
        a: Math.max(1e-3, finite(raw.a, 1)),
        e: Math.min(0.95, Math.max(0, finite(raw.e, 0))),
        inc: finite(raw.inclinationDeg, 0) * DEG,
        nu: finite(raw.phaseDeg, 0) * DEG,
      });
    } else {
      body = sim.addBody({ name, mass, kind, color, x: finite(raw.x, 0), z: finite(raw.z, 0) });
    }
    body.vx += kick.x;
    body.vz += kick.z;
    byName.set(name, body);
  }
  sim.recenter();
  return {
    cameraDistance: Math.max(0.05, finite(spec.cameraDistance, 10)),
    timeScale: Math.min(50, Math.max(0.001, finite(spec.timeScale, 0.5))),
    elevation: 0.9,
    tip: spec.summary || undefined,
  };
}
