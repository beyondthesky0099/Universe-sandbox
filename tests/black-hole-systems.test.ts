import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompactObject } from '../src/sim/compactObjects';
import { loadBlackHoleSystem } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';

const objects = (JSON.parse(readFileSync(new URL('../public/data/compact-objects.json', import.meta.url), 'utf8')) as { objects: CompactObject[] }).objects;
const holes = objects.filter((o) => o.kind === 'blackhole');

describe('real black holes and their companions', () => {
  it('every black hole has its companion orbit from the papers', () => {
    expect(holes.length).toBe(6);
    for (const o of holes) {
      expect(o.companion, o.name).toBeDefined();
      expect(o.mass, o.name).toBeGreaterThan(5);
    }
    const bh1 = holes.find((o) => o.name === 'Gaia BH1')!;
    expect(bh1.companion).toMatchObject({ periodDays: 185.6, ecc: 0.45, mass: 0.93, dormant: true });
  });

  for (const o of holes) {
    it(`${o.name}: the companion stays on its orbit for a few turns`, () => {
      const sim = new Simulation();
      loadBlackHoleSystem(sim, o);
      expect(sim.bodies).toHaveLength(2);
      const [hole, star] = sim.bodies;
      expect(hole.tag === 'dormant').toBe(!!o.companion!.dormant);
      const years = o.companion!.periodDays / 365.25;
      const a = Math.cbrt(years * years * (hole.mass + star.mass));
      const dist = () => Math.hypot(star.x - hole.x, star.y - hole.y, star.z - hole.z);
      let min = Infinity, max = 0;
      for (let k = 0; k < 60; k++) {
        sim.advance((3 * years) / 60, 1e6, 1e9);
        min = Math.min(min, dist());
        max = Math.max(max, dist());
      }
      expect(sim.bodies).toHaveLength(2);
      // Periastron and apastron as the orbit says (sampled, so a little inside them).
      expect(max).toBeLessThanOrEqual(a * (1 + o.companion!.ecc) * 1.01);
      expect(min).toBeGreaterThanOrEqual(a * (1 - o.companion!.ecc) * 0.99);
    });
  }
});
