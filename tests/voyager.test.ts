import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { parseSolarData } from '../src/sim/solarSystemData';
import { loadVoyagerEncounter, type VoyagerEncounter } from '../src/sim/voyager';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const encounters: VoyagerEncounter[] = read('voyager-encounters.json').encounters;
const data = parseSolarData(read('solar-system.json'));
const KM = 149597870.7;

/** Fly the encounter; return the closest distance to the planet (km) and its time (hours after the start). */
function fly(e: VoyagerEncounter): { km: number; hours: number } {
  const sim = new Simulation();
  loadVoyagerEncounter(sim, e, data);
  sim.particles.clear();
  const planet = sim.bodies.find((b) => b.name === e.planet)!;
  const craft = sim.bodies.find((b) => b.name === e.craft)!;
  const step = 1 / (24 * 60 * 365.25); // one minute
  let best = { km: Infinity, hours: 0 };
  sim.advance(1.9 / 365.25, 1e7, 1e9);
  for (let t = 0; t < 0.2 / 365.25; t += step) {
    sim.advance(step, 1e7, 1e9);
    const km = Math.hypot(craft.x - planet.x, craft.y - planet.y, craft.z - planet.z) * KM;
    if (km < best.km) best = { km, hours: sim.time * 365.25 * 24 };
  }
  return best;
}

describe('Voyager Grand Tour', () => {
  it('has all six planetary flybys at the distances JPL gives', () => {
    expect(encounters.map((e) => `${e.craft} ${e.planet}`)).toEqual([
      'Voyager 1 Jupiter', 'Voyager 1 Saturn', 'Voyager 2 Jupiter', 'Voyager 2 Saturn', 'Voyager 2 Uranus', 'Voyager 2 Neptune',
    ]);
    const neptune = encounters.find((e) => e.planet === 'Neptune')!;
    expect(neptune.closestUtc.startsWith('1989-08-25 03:5')).toBe(true);
    // 4,950 km above the cloud tops (Neptune's equatorial radius is 24,764 km; the pass was over the pole).
    expect(neptune.closestKm).toBeGreaterThan(29000);
    expect(neptune.closestKm).toBeLessThan(29500);
  });

  for (const e of encounters) {
    it(`reproduces ${e.craft} at ${e.planet} from its real starting conditions`, () => {
      const best = fly(e);
      expect(Math.abs(best.km - e.closestKm) / e.closestKm).toBeLessThan(0.01); // within 1%
      expect(Math.abs(best.hours - (e.closestJd - e.startJd) * 24) * 60).toBeLessThan(10); // within 10 minutes
    }, 60000);
  }
});
