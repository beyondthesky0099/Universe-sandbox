import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diameterFromH, loadFlyby, type Flyby } from '../src/sim/flybys';
import { Simulation } from '../src/sim/simulation';

const flybys: Flyby[] = JSON.parse(readFileSync(new URL('../public/data/flybys.json', import.meta.url), 'utf8')).flybys;
const KM = 149597870.7;

/** Fly the encounter and return the closest distance (km) and its time (days after the start). */
function fly(f: Flyby): { km: number; day: number } {
  const sim = new Simulation();
  loadFlyby(sim, f);
  const earth = sim.bodies.find((b) => b.name === 'Earth')!;
  const rock = sim.bodies.find((b) => b.name === f.name)!;
  const step = 5 / (24 * 60 * 365.25); // 5 minutes
  let best = { km: Infinity, day: 0 };
  sim.advance(3.5 / 365.25, 1e7, 1e9);
  for (let t = 0; t < 1 / 365.25; t += step) {
    sim.advance(step, 1e7, 1e9);
    const km = Math.hypot(rock.x - earth.x, rock.y - earth.y, rock.z - earth.z) * KM;
    if (km < best.km) best = { km, day: sim.time * 365.25 };
  }
  return best;
}

describe('real asteroid flybys', () => {
  it('has Apophis passing 38,000 km from Earth on 13 April 2029', () => {
    const a = flybys.find((f) => f.des === '99942')!;
    expect(a.date).toBe('2029-Apr-13 21:46');
    expect(a.distAu * KM).toBeCloseTo(38011, -2);
    expect(diameterFromH(a.h) * 1000).toBeGreaterThan(250); // a few hundred metres
    expect(diameterFromH(a.h) * 1000).toBeLessThan(600);
  });

  it('reproduces the Apophis encounter from its real starting conditions', () => {
    const a = flybys.find((f) => f.des === '99942')!;
    const best = fly(a);
    expect(Math.abs(best.km - a.distAu * KM) / (a.distAu * KM)).toBeLessThan(0.02); // within 2%
    expect(Math.abs(best.day - 4) * 24).toBeLessThan(1); // within an hour of the predicted time
  }, 60000);

  it('reproduces 2024 YR4 in 2032 too', () => {
    const f = flybys.find((x) => x.des === '2024 YR4')!;
    const best = fly(f);
    expect(Math.abs(best.km - f.distAu * KM) / (f.distAu * KM)).toBeLessThan(0.02);
  }, 60000);
});
