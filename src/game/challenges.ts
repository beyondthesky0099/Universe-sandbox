import { generateStarSystem } from '../procgen/starSystem';
import { hash32, mulberry32, range } from '../procgen/rng';
import type { Body } from '../sim/body';
import { bodyTemperature, isHabitable } from '../sim/climate';
import { lagrangePoints } from '../sim/analysis';
import { keplerToState } from '../sim/orbits';
import { addOrbiting, type SceneSetup } from '../sim/presets';
import { Simulation, type SimEvent } from '../sim/simulation';
import { AU_PER_YEAR_IN_KMS, EARTH_MASS, G, JUPITER_MASS } from '../sim/units';

export type ChallengeStatus = 'playing' | 'won' | 'lost';

export interface ChallengeRules {
  /** Nudges allowed on 'pushable' bodies (undefined = none). */
  pushes?: number;
  /** Maximum Δv per nudge (km/s). */
  maxDvKms?: number;
  /** Bodies the player may spawn, and which palette types. */
  spawns?: number;
  spawnTypes?: string[];
  /** Simulated years before the challenge ends. */
  timeLimit: number;
}

/** Mutable per-attempt bookkeeping, kept by the app. */
export interface ChallengeState {
  pushes: number;
  dvUsed: number;
  spawns: number;
  /** sim.time when the attempt started. */
  start: number;
  events: SimEvent[];
  data: Record<string, number>;
}

export interface ChallengeResult {
  status: ChallengeStatus;
  progress: string;
  /** 1–3 when won. */
  stars?: number;
  reason?: string;
}

export interface Challenge {
  id: string;
  title: string;
  summary: string;
  goal: string;
  hint: string;
  rules: ChallengeRules;
  setup(sim: Simulation): SceneSetup;
  evaluate(sim: Simulation, st: ChallengeState): ChallengeResult;
}

export const KMS = 1 / AU_PER_YEAR_IN_KMS; // AU/yr per km/s

export function newChallengeState(sim: Simulation): ChallengeState {
  return { pushes: 0, dvUsed: 0, spawns: 0, start: sim.time, events: [], data: {} };
}

const byName = (sim: Simulation, name: string) => sim.bodies.find((b) => b.name === name);
const elapsed = (sim: Simulation, st: ChallengeState) => sim.time - st.start;
const hitBy = (st: ChallengeState, a: string, b: string) =>
  st.events.some((e) => (e.type === 'merge' || e.type === 'disrupt' || e.type === 'shatter') && e.message.includes(a) && e.message.includes(b));
const fmtYears = (y: number) => `${y.toFixed(1)} yr`;

function timeUp(sim: Simulation, st: ChallengeState, rules: ChallengeRules): boolean {
  return elapsed(sim, st) >= rules.timeLimit;
}

// ---------------------------------------------------------------------------

function bullseyeSetup(sim: Simulation, opts: { star: number; targetA: number; targetMass: number; targetName: string; cometA: number; cometE: number; seed: number }): SceneSetup {
  const rng = mulberry32(opts.seed);
  const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: opts.star });
  addOrbiting(sim, sun, { name: opts.targetName, mass: opts.targetMass, kind: 'gas', color: 0xd8b48a }, { a: opts.targetA, nu: range(rng, 0, Math.PI * 2) });
  addOrbiting(sim, sun, { name: 'Comet', mass: 1e-4 * EARTH_MASS, kind: 'rocky', color: 0xcfe6ff, tag: 'pushable' }, {
    a: opts.cometA,
    e: opts.cometE,
    nu: Math.PI,
    argp: range(rng, 0, Math.PI * 2),
  });
  sim.recenter();
  return { cameraDistance: opts.cometA * 3.2, timeScale: 1.5, elevation: 1.2 };
}

function bullseyeEvaluate(target: string, rules: ChallengeRules) {
  return (sim: Simulation, st: ChallengeState): ChallengeResult => {
    const t = elapsed(sim, st);
    if (hitBy(st, 'Comet', target)) {
      const stars = t < rules.timeLimit * 0.3 ? 3 : t < rules.timeLimit * 0.6 ? 2 : 1;
      return { status: 'won', progress: `Hit ${target} after ${fmtYears(t)}`, stars };
    }
    const comet = byName(sim, 'Comet');
    if (!comet) return { status: 'lost', progress: '', reason: 'The comet was destroyed somewhere else.' };
    if (timeUp(sim, st, rules)) return { status: 'lost', progress: '', reason: `Time's up: ${target} was never hit.` };
    const tgt = byName(sim, target);
    const d = tgt ? Math.hypot(comet.x - tgt.x, comet.y - tgt.y, comet.z - tgt.z) : NaN;
    return { status: 'playing', progress: `Comet is ${d.toFixed(2)} AU from ${target} · ${fmtYears(rules.timeLimit - t)} left` };
  };
}

const bullseyeRules: ChallengeRules = { pushes: 1, maxDvKms: 3, timeLimit: 40 };
const bullseye: Challenge = {
  id: 'bullseye',
  title: 'Bullseye',
  summary: 'Nudge a comet into Jupiter with a single push.',
  goal: 'Use the Nudge tool on the comet (one push, up to 3 km/s) so it hits Jupiter.',
  hint: 'Small pushes at aphelion change a lot. Watch the dashed preview line as you drag, and aim for where Jupiter will be.',
  rules: bullseyeRules,
  setup: (sim) => bullseyeSetup(sim, { star: 1, targetA: 5.2, targetMass: JUPITER_MASS, targetName: 'Jupiter', cometA: 8, cometE: 0.45, seed: 7 }),
  evaluate: bullseyeEvaluate('Jupiter', bullseyeRules),
};

// ---------------------------------------------------------------------------

const saveEarthRules: ChallengeRules = { pushes: 1, maxDvKms: 0.6, timeLimit: 1.2 };
const saveEarth: Challenge = {
  id: 'save-earth',
  title: 'Save the Earth',
  summary: 'An asteroid will hit Earth in a few months. Deflect it.',
  goal: 'Nudge the asteroid (one push, up to 0.6 km/s) so it misses Earth. Smaller pushes earn more stars.',
  hint: 'The earlier and more sideways the push, the bigger the miss. Select the asteroid to see its collision forecast update.',
  rules: saveEarthRules,
  setup(sim) {
    const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1 });
    const impactIn = 0.35;
    // Earth's position at impact time on its circular orbit.
    const earthNow = keplerToState(G * (1 + EARTH_MASS), { a: 1, nu: 0 });
    sim.addBody({ name: 'Earth', mass: EARTH_MASS, kind: 'rocky', color: 0x3f78c8, x: earthNow.pos.x, y: earthNow.pos.y, z: earthNow.pos.z, vx: earthNow.vel.x, vy: earthNow.vel.y, vz: earthNow.vel.z });
    const n = 2 * Math.PI; // rad/yr at 1 AU
    const atImpact = keplerToState(G, { a: 1, nu: n * impactIn });
    // Asteroid arrives with a 6 km/s relative velocity, mostly radial: trace it back in time.
    const rel = 6 * KMS;
    const rx = atImpact.pos.x, rz = atImpact.pos.z;
    const rl = Math.hypot(rx, rz);
    const ghost = sim.addBodyDetached({
      mass: 0.003 * EARTH_MASS,
      x: atImpact.pos.x,
      y: 0,
      z: atImpact.pos.z,
      // Negate velocity to integrate backwards in time.
      vx: -(atImpact.vel.x - (rx / rl) * rel),
      vy: 0,
      vz: -(atImpact.vel.z - (rz / rl) * rel),
    });
    const back = new Simulation(0);
    back.addBody({ kind: 'star', mass: 1 });
    const g = back.addBody({ ...ghost, id: undefined });
    back.collisions = false;
    back.advance(impactIn, 1e6, 1e9);
    sim.addBody({ name: 'Asteroid', mass: 0.003 * EARTH_MASS, kind: 'rocky', color: 0xa0785a, tag: 'pushable', x: g.x, y: g.y, z: g.z, vx: -g.vx, vy: -g.vy, vz: -g.vz });
    void sun;
    return { cameraDistance: 2.6, timeScale: 0.06, elevation: 1.3 };
  },
  evaluate(sim, st) {
    const t = elapsed(sim, st);
    if (hitBy(st, 'Asteroid', 'Earth') || !byName(sim, 'Earth')) return { status: 'lost', progress: '', reason: 'Impact! Earth was hit.' };
    if (timeUp(sim, st, saveEarthRules)) {
      const used = st.dvUsed / KMS;
      const stars = used <= 0.15 ? 3 : used <= 0.35 ? 2 : 1;
      return { status: 'won', progress: `Earth is safe. You used ${used.toFixed(2)} km/s.`, stars };
    }
    return { status: 'playing', progress: `${fmtYears(saveEarthRules.timeLimit - t)} until the danger has passed` };
  },
};

// ---------------------------------------------------------------------------

const duoRules: ChallengeRules = { spawns: 4, spawnTypes: ['rocky'], timeLimit: 80 };
const habitableDuo: Challenge = {
  id: 'habitable-duo',
  title: 'Twin Earths',
  summary: 'Build a system with two habitable worlds.',
  goal: 'Spawn up to 4 rocky planets. Keep 2 habitable worlds alive for 10 years in a row.',
  hint: 'Turn on Display → Habitable zones and drop planets inside the green ring with Auto-orbit on. Keep them apart so they don’t collide.',
  rules: duoRules,
  setup(sim) {
    sim.addBody({ name: 'Helios', kind: 'star', mass: 1 });
    return { cameraDistance: 3.2, timeScale: 1, elevation: 1.3 };
  },
  evaluate(sim, st) {
    const habitable = sim.bodies.filter((b) => b.kind === 'rocky' && isHabitable(b.kind, b.mass, bodyTemperature(sim.bodies, b))).length;
    if (habitable >= 2) {
      st.data.since ??= sim.time;
    } else delete st.data.since;
    const held = st.data.since !== undefined ? sim.time - st.data.since : 0;
    if (held >= 10) {
      const stars = st.spawns <= 2 ? 3 : st.spawns === 3 ? 2 : 1;
      return { status: 'won', progress: `Two habitable worlds held for 10 years using ${st.spawns} planets.`, stars };
    }
    if (timeUp(sim, st, duoRules)) return { status: 'lost', progress: '', reason: 'Out of time.' };
    return { status: 'playing', progress: `${habitable} habitable world${habitable === 1 ? '' : 's'} · held ${held.toFixed(1)}/10 yr · ${duoRules.spawns! - st.spawns} planets left` };
  },
};

// ---------------------------------------------------------------------------

const ringRules: ChallengeRules = { pushes: 1, maxDvKms: 1.2, timeLimit: 6 };
const ringChallenge: Challenge = {
  id: 'ring',
  title: 'Lord of the Rings',
  summary: 'Give a gas giant rings by sacrificing a moon.',
  goal: 'Nudge the moon so tides tear it apart (inside the Roche limit) without it crashing into the planet.',
  hint: 'Push backwards (retrograde) to drop its closest approach. The Roche limit is about 1.5 planet radii; too low and it just crashes.',
  rules: ringRules,
  setup(sim) {
    const sun = sim.addBody({ name: 'Helion', kind: 'star', mass: 1 });
    const giant = addOrbiting(sim, sun, { name: 'Colossus', mass: 1.2 * JUPITER_MASS, kind: 'gas', color: 0xc99e6b }, { a: 20 });
    addOrbiting(sim, giant, { name: 'Moonlet', mass: 0.02 * EARTH_MASS, kind: 'rocky', color: 0xb8a58c, tag: 'pushable' }, { a: 0.5 });
    return { cameraDistance: 1.6, timeScale: 0.15, elevation: 1.3, focus: 'Colossus' };
  },
  evaluate(sim, st) {
    if (st.events.some((e) => e.type === 'disrupt' && e.message.includes('Moonlet'))) {
      return { status: 'won', progress: 'The moon became a ring!', stars: st.dvUsed / KMS < 0.8 ? 3 : 2 };
    }
    if (hitBy(st, 'Moonlet', 'Colossus')) return { status: 'lost', progress: '', reason: 'The moon crashed into the planet: too low!' };
    if (!byName(sim, 'Moonlet')) return { status: 'lost', progress: '', reason: 'The moon was lost.' };
    if (timeUp(sim, st, ringRules)) return { status: 'lost', progress: '', reason: "Time's up." };
    return { status: 'playing', progress: `${fmtYears(ringRules.timeLimit - elapsed(sim, st))} left` };
  },
};

// ---------------------------------------------------------------------------

const slingRules: ChallengeRules = { timeLimit: 25 };
const SLING_FUEL_KMS = 9.6;
const slingshot: Challenge = {
  id: 'slingshot',
  title: 'Slingshot',
  summary: 'Reach 9 AU with too little fuel for a direct trip.',
  goal: `Get the probe beyond 9 AU from the Sun. It has ${SLING_FUEL_KMS} km/s of Δv; a direct transfer needs 10.3 km/s, so borrow speed from the super-Jupiter Goliath.`,
  hint: 'Select the probe and use Plan transfer → Goliath, then add a little extra. Pass close behind Goliath: its gravity flings you forward.',
  rules: slingRules,
  setup(sim) {
    const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1 });
    // A 10 Jupiter-mass planet ~97° ahead, so a Hohmann transfer launched now arrives on time.
    addOrbiting(sim, sun, { name: 'Goliath', mass: 10 * JUPITER_MASS, kind: 'gas', color: 0xc99e6b }, { a: 5.2, nu: (97 * Math.PI) / 180 });
    addOrbiting(sim, sun, { name: 'Probe', mass: 1e-15, kind: 'rocky', color: 0x7fdcff, tag: 'probe', fuel: SLING_FUEL_KMS * KMS }, { a: 1, nu: 0 });
    return { cameraDistance: 14, timeScale: 0.6, elevation: 1.3 };
  },
  evaluate(sim, st) {
    const probe = sim.bodies.find((b) => b.tag === 'probe');
    const sun = byName(sim, 'Sun');
    if (!probe || !sun) return { status: 'lost', progress: '', reason: 'The probe was destroyed.' };
    const r = Math.hypot(probe.x - sun.x, probe.y - sun.y, probe.z - sun.z);
    st.data.maxR = Math.max(st.data.maxR ?? 0, r);
    if (r >= 9) {
      const fuelLeft = (probe.fuel ?? 0) / KMS;
      return { status: 'won', progress: `Reached ${r.toFixed(1)} AU with ${fuelLeft.toFixed(1)} km/s to spare.`, stars: fuelLeft > 0.8 ? 3 : fuelLeft > 0.3 ? 2 : 1 };
    }
    if (timeUp(sim, st, slingRules)) return { status: 'lost', progress: '', reason: `Out of time: furthest distance ${st.data.maxR.toFixed(1)} AU.` };
    return { status: 'playing', progress: `Distance ${r.toFixed(2)} AU (goal 9) · fuel ${((probe.fuel ?? 0) / KMS).toFixed(2)} km/s` };
  },
};

// ---------------------------------------------------------------------------

const parkRules: ChallengeRules = { timeLimit: 40 };
const lagrangePark: Challenge = {
  id: 'lagrange',
  title: 'Trojan Parking',
  summary: 'Park a probe at Jupiter’s L4 Lagrange point.',
  goal: 'Your probe arrived at Jupiter’s L4 point with the wrong velocity. Correct it so it stays within 0.4 AU of L4 for 10 years. Fuel: 3 km/s.',
  hint: 'L4 circles the Sun exactly like Jupiter. Select the probe: it is drifting outward and too slow, so burn radial-in and prograde.',
  rules: parkRules,
  setup(sim) {
    const sun = sim.addBody({ name: 'Sun', kind: 'star', mass: 1 });
    const jup = addOrbiting(sim, sun, { name: 'Jupiter', mass: JUPITER_MASS, kind: 'gas', color: 0xd8b48a }, { a: 5.2, nu: 0 });
    const l4 = lagrangePoints(sun, jup).find((p) => p.name === 'L4')!;
    const r = Math.hypot(l4.x - sun.x, l4.z - sun.z);
    const v = Math.sqrt((G * sun.mass) / r);
    const ux = (l4.x - sun.x) / r, uz = (l4.z - sun.z) / r;
    // Correct orbital velocity at L4 is v·(uz, −ux); the probe is 0.9 km/s slow and drifting out at 1.1 km/s.
    const slow = v - 0.9 * KMS;
    const out = 1.1 * KMS;
    sim.addBody({ name: 'Probe', mass: 1e-15, kind: 'rocky', color: 0x7fdcff, tag: 'probe', fuel: 3 * KMS, x: l4.x, y: l4.y, z: l4.z, vx: uz * slow + ux * out, vz: -ux * slow + uz * out });
    return { cameraDistance: 14, timeScale: 0.8, elevation: 1.4 };
  },
  evaluate(sim, st) {
    const probe = sim.bodies.find((b) => b.tag === 'probe');
    const sun = byName(sim, 'Sun');
    const jup = byName(sim, 'Jupiter');
    if (!probe || !sun || !jup) return { status: 'lost', progress: '', reason: 'The probe was lost.' };
    const l4 = lagrangePoints(sun, jup).find((p) => p.name === 'L4')!;
    const d = Math.hypot(probe.x - l4.x, probe.y - l4.y, probe.z - l4.z);
    if (d < 0.4) st.data.since ??= sim.time;
    else delete st.data.since;
    const held = st.data.since !== undefined ? sim.time - st.data.since : 0;
    if (held >= 10) {
      const fuel = (probe.fuel ?? 0) / KMS;
      return { status: 'won', progress: `Parked at L4 with ${fuel.toFixed(2)} km/s left.`, stars: fuel > 1.5 ? 3 : fuel > 0.5 ? 2 : 1 };
    }
    if (timeUp(sim, st, parkRules)) return { status: 'lost', progress: '', reason: "Time's up." };
    return { status: 'playing', progress: `${d.toFixed(2)} AU from L4 · held ${held.toFixed(1)}/10 yr` };
  },
};

// ---------------------------------------------------------------------------

const snackRules: ChallengeRules = { pushes: 3, maxDvKms: 20, timeLimit: 30 };
const bhSnack: Challenge = {
  id: 'bh-snack',
  title: 'Black Hole Snack',
  summary: 'Feed the black hole two of its stars.',
  goal: 'With three nudges (up to 20 km/s each), make the black hole swallow or shred two stars.',
  hint: 'Slow a star down (push against its motion) and it falls inward. Stars are shredded before they reach the horizon.',
  rules: snackRules,
  setup(sim) {
    const bh = sim.addBody({ name: 'Gargantua', kind: 'blackhole', mass: 5 });
    const names = ['Ada', 'Brin', 'Cael', 'Dara', 'Eos'];
    names.forEach((name, i) => {
      // Each star starts at the far point (apoapsis) of a mildly eccentric orbit.
      addOrbiting(sim, bh, { name, mass: 0.3 + i * 0.05, kind: 'star', tag: 'pushable' }, { a: 3 + i * 1.8, e: 0.3, nu: Math.PI, argp: i * 1.26 });
    });
    return { cameraDistance: 30, timeScale: 0.6, elevation: 1.2 };
  },
  evaluate(sim, st) {
    const eaten = st.events.filter((e) => (e.type === 'disrupt' || e.type === 'merge') && e.message.includes('Gargantua')).length;
    if (eaten >= 2) {
      const t = elapsed(sim, st);
      return { status: 'won', progress: `Gargantua ate ${eaten} stars in ${fmtYears(t)}.`, stars: st.pushes <= 2 ? 3 : t < 15 ? 2 : 1 };
    }
    if (timeUp(sim, st, snackRules)) return { status: 'lost', progress: '', reason: `Only ${eaten} star${eaten === 1 ? '' : 's'} eaten.` };
    return { status: 'playing', progress: `${eaten}/2 stars eaten · ${fmtYears(snackRules.timeLimit - elapsed(sim, st))} left` };
  },
};

// ---------------------------------------------------------------------------

/** Day number used for the daily puzzle (UTC). */
export function dailyNumber(date = new Date()): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000) - 20089; // #1 = 2025-01-01
}

/** Today's puzzle: hit a generated planet with a comet, everyone gets the same one. */
export function dailyChallenge(date = new Date()): Challenge {
  const day = dailyNumber(date);
  const seed = hash32(day, 0xda11);
  const rng = mulberry32(seed);
  const spec = generateStarSystem(hash32(seed, 1));
  const star = Math.min(2, Math.max(0.5, spec.star.mass));
  const target = spec.planets.find((p) => p.kind === 'gas') ?? spec.planets[spec.planets.length - 1];
  const targetName = target ? target.name : `${spec.star.name} b`;
  const targetA = Math.min(12, Math.max(1.5, target?.a ?? 3));
  const cometA = targetA * range(rng, 1.3, 1.8);
  const rules: ChallengeRules = { pushes: 2, maxDvKms: 3, timeLimit: 50 };
  return {
    id: `daily-${day}`,
    title: `Daily #${day}`,
    summary: `Everyone gets the same puzzle today: hit ${targetName} with a comet.`,
    goal: `Nudge the comet (two pushes, up to 3 km/s each) into ${targetName}. Faster and fewer pushes score better.`,
    hint: 'Adjust the comet’s period so it arrives when the planet does; the dashed preview helps.',
    rules,
    setup: (sim) =>
      bullseyeSetup(sim, {
        star,
        targetA,
        targetMass: Math.max(target?.mass ?? 0, 100 * EARTH_MASS),
        targetName,
        cometA,
        cometE: Math.min(0.75, 1 - (targetA * 0.85) / cometA),
        seed,
      }),
    evaluate(sim, st) {
      const res = bullseyeEvaluate(targetName, rules)(sim, st);
      if (res.status === 'won' && st.pushes > 1) res.stars = Math.max(1, (res.stars ?? 1) - 1);
      return res;
    },
  };
}

export const CHALLENGES: Challenge[] = [bullseye, saveEarth, ringChallenge, habitableDuo, slingshot, lagrangePark, bhSnack];

export function shareText(ch: Challenge, res: ChallengeResult): string {
  const stars = '⭐'.repeat(res.stars ?? 0) + '☆'.repeat(3 - (res.stars ?? 0));
  return `Astrarium ${ch.title} ${stars}\n${res.progress}`;
}

/** Apply a nudge to a body (Δv in AU/yr), respecting fuel for probes. Returns the Δv actually applied. */
export function applyNudge(body: Body, dv: [number, number, number]): number {
  let mag = Math.hypot(...dv);
  let scale = 1;
  if (body.fuel !== undefined) {
    if (mag > body.fuel) scale = body.fuel / mag;
    mag *= scale;
    body.fuel = Math.max(0, body.fuel - mag);
  }
  body.vx += dv[0] * scale;
  body.vy += dv[1] * scale;
  body.vz += dv[2] * scale;
  return mag;
}
