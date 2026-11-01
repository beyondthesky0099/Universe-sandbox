import { describe, expect, it } from 'vitest';
import { applyNudge, CHALLENGES, dailyChallenge, KMS, newChallengeState, type Challenge, type ChallengeResult } from '../src/game/challenges';
import { burnDirections, planHohmann } from '../src/game/transfer';
import { lagrangePoints } from '../src/sim/analysis';
import { forecast } from '../src/sim/forecast';
import { addOrbiting } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';
import { EARTH_MASS } from '../src/sim/units';

const get = (id: string) => CHALLENGES.find((c) => c.id === id)!;

/** Play a challenge headlessly: `act` runs once at the start, then time advances until it ends. */
function play(ch: Challenge, act: (sim: Simulation) => { pushes?: number; dv?: number; spawns?: number } | void, step = 0.25): ChallengeResult {
  const sim = new Simulation();
  ch.setup(sim);
  const st = newChallengeState(sim);
  const used = act(sim) ?? {};
  st.pushes = used.pushes ?? 0;
  st.dvUsed = used.dv ?? 0;
  st.spawns = used.spawns ?? 0;
  for (let t = 0; t < ch.rules.timeLimit + step * 2; t += step) {
    sim.advance(step, 1e7, 1e9);
    st.events.push(...sim.events.splice(0));
    const r = ch.evaluate(sim, st);
    if (r.status !== 'playing') return r;
  }
  return ch.evaluate(sim, st);
}

function pushInPlane(body: { vx: number; vz: number }, angle: number, kms: number) {
  body.vx += Math.cos(angle) * kms * KMS;
  body.vz += Math.sin(angle) * kms * KMS;
}

describe('challenges are winnable', () => {
  it('Bullseye: some single push hits Jupiter', () => {
    let wins = 0;
    for (let a = 0; a < 24 && !wins; a++) {
      for (const kms of [0.5, 1, 1.5, 2, 2.5, 3]) {
        const r = play(get('bullseye'), (sim) => {
          pushInPlane(sim.bodies.find((b) => b.name === 'Comet')!, (a / 24) * Math.PI * 2, kms);
          return { pushes: 1, dv: kms * KMS };
        }, 0.5);
        if (r.status === 'won') {
          wins++;
          break;
        }
      }
    }
    expect(wins).toBeGreaterThan(0);
  }, 120000);

  it('Save the Earth: doing nothing loses, a sideways push wins', () => {
    const sim = new Simulation();
    get('save-earth').setup(sim);
    const asteroid = sim.bodies.find((b) => b.name === 'Asteroid')!;
    expect(forecast(sim, asteroid.id, 0.6).impact?.otherName).toBe('Earth');
    expect(play(get('save-earth'), () => {}).status).toBe('lost');
    const r = play(get('save-earth'), (s) => {
      const a = s.bodies.find((b) => b.name === 'Asteroid')!;
      const sun = s.bodies[0];
      const { prograde } = burnDirections(a, sun);
      applyNudge(a, [prograde[0] * 0.3 * KMS, prograde[1] * 0.3 * KMS, prograde[2] * 0.3 * KMS]);
      return { pushes: 1, dv: 0.3 * KMS };
    }, 0.02);
    expect(r.status).toBe('won');
  }, 60000);

  it('Lord of the Rings: a retrograde push makes a ring', () => {
    let won = false;
    for (let kms = 0.3; kms <= 1.2 && !won; kms += 0.05) {
      const r = play(get('ring'), (sim) => {
        const moon = sim.bodies.find((b) => b.name === 'Moonlet')!;
        const giant = sim.bodies.find((b) => b.name === 'Colossus')!;
        const { prograde } = burnDirections(moon, giant);
        applyNudge(moon, [-prograde[0] * kms * KMS, -prograde[1] * kms * KMS, -prograde[2] * kms * KMS]);
        return { pushes: 1, dv: kms * KMS };
      }, 0.05);
      won = r.status === 'won';
    }
    expect(won).toBe(true);
  }, 120000);

  it('Twin Earths: two planets in the habitable zone win', () => {
    const r = play(get('habitable-duo'), (sim) => {
      const star = sim.bodies[0];
      addOrbiting(sim, star, { name: 'A', mass: EARTH_MASS, kind: 'rocky' }, { a: 0.95 });
      addOrbiting(sim, star, { name: 'B', mass: EARTH_MASS, kind: 'rocky' }, { a: 1.25, nu: 2 });
      return { spawns: 2 };
    }, 0.5);
    expect(r).toMatchObject({ status: 'won', stars: 3 });
  }, 60000);

  it('Slingshot: a Hohmann burn toward Goliath can reach 9 AU on the fuel available', () => {
    let won = false;
    for (let extra = 0.3; extra <= 0.81 && !won; extra += 0.1) {
      for (const radialKms of [-0.5, -1, -1.5]) {
        const r = play(get('slingshot'), (sim) => {
          const probe = sim.bodies.find((b) => b.tag === 'probe')!;
          const sun = sim.bodies[0];
          const jup = sim.bodies.find((b) => b.name === 'Goliath')!;
          const plan = planHohmann(probe, jup, sun);
          const { prograde, radial } = burnDirections(probe, sun);
          const p = plan.dv1 + extra * KMS;
          applyNudge(probe, [0, 1, 2].map((i) => prograde[i] * p + radial[i] * radialKms * KMS) as [number, number, number]);
        }, 0.25);
        if (r.status === 'won') {
          won = true;
          break;
        }
      }
    }
    expect(won).toBe(true);
  }, 180000);

  it('Trojan Parking: matching L4’s velocity wins', () => {
    const r = play(get('lagrange'), (sim) => {
      const probe = sim.bodies.find((b) => b.tag === 'probe')!;
      const sun = sim.bodies[0];
      const jup = sim.bodies.find((b) => b.name === 'Jupiter')!;
      const l4 = lagrangePoints(sun, jup).find((p) => p.name === 'L4')!;
      const rr = Math.hypot(l4.x - sun.x, l4.z - sun.z);
      const v = Math.sqrt((39.478 * sun.mass) / rr);
      const ux = (l4.x - sun.x) / rr, uz = (l4.z - sun.z) / rr;
      applyNudge(probe, [uz * v - probe.vx + sun.vx, 0, -ux * v - probe.vz + sun.vz]);
    }, 0.5);
    expect(r.status).toBe('won');
  }, 60000);

  it('Black Hole Snack: two full retrograde pushes feed it', () => {
    const r = play(get('bh-snack'), (sim) => {
      const bh = sim.bodies[0];
      for (const name of ['Ada', 'Brin']) {
        const s = sim.bodies.find((b) => b.name === name)!;
        const { prograde } = burnDirections(s, bh);
        applyNudge(s, [-prograde[0] * 20 * KMS, -prograde[1] * 20 * KMS, -prograde[2] * 20 * KMS]);
      }
      return { pushes: 2 };
    }, 0.1);
    expect(r.status).toBe('won');
  }, 60000);

  it('the daily puzzle is deterministic and usually solvable with one push', () => {
    const dates = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((d) => new Date(`${d}T12:00:00Z`));
    expect(dailyChallenge(dates[0]).goal).toBe(dailyChallenge(dates[0]).goal);
    let solved = 0;
    for (const date of dates) {
      const ch = dailyChallenge(date);
      search: for (let a = 0; a < 16; a++) {
        for (const kms of [0.75, 1.5, 2.25, 3]) {
          const r = play(ch, (sim) => {
            pushInPlane(sim.bodies.find((b) => b.name === 'Comet')!, (a / 16) * Math.PI * 2, kms);
            return { pushes: 1 };
          }, 0.5);
          if (r.status === 'won') {
            solved++;
            break search;
          }
        }
      }
    }
    expect(solved).toBeGreaterThanOrEqual(3);
  }, 300000);
});

describe('nudges and transfers', () => {
  it('nudges respect probe fuel', () => {
    const sim = new Simulation();
    const probe = sim.addBody({ mass: 1e-15, tag: 'probe', fuel: 1 });
    const used = applyNudge(probe, [3, 0, 0]);
    expect(used).toBeCloseTo(1);
    expect(probe.vx).toBeCloseTo(1);
    expect(probe.fuel).toBe(0);
  });

  it('plans an Earth→Mars Hohmann transfer with textbook numbers', () => {
    const sim = new Simulation();
    const sun = sim.addBody({ kind: 'star', mass: 1 });
    const e = addOrbiting(sim, sun, { name: 'E', mass: 1e-15 }, { a: 1 });
    const m = addOrbiting(sim, sun, { name: 'M', mass: 1e-15 }, { a: 1.524, nu: 1 });
    const plan = planHohmann(e, m, sun);
    expect(plan.dv1 / KMS).toBeCloseTo(2.94, 1);
    expect(plan.timeOfFlight).toBeCloseTo(0.709, 2);
    expect((plan.phaseNeeded * 180) / Math.PI).toBeCloseTo(44.3, 0);
  });
});
