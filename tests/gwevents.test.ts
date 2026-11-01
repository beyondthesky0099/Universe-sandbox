import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGwEvent, separationForInspiral, type GwEvent } from '../src/sim/gwEvents';
import { Simulation } from '../src/sim/simulation';

const events: GwEvent[] = JSON.parse(readFileSync(new URL('../public/data/gw-events.json', import.meta.url), 'utf8')).events;

describe('real gravitational-wave events', () => {
  it('has the famous detections with their published masses', () => {
    const gw150914 = events.find((e) => e.name === 'GW150914')!;
    expect([gw150914.m1, gw150914.m2, gw150914.final, gw150914.distanceMpc]).toEqual([36, 29, 62, 410]);
    expect(events.find((e) => e.name === 'GW170817')!.kind).toBe('BNS');
    expect(events.length).toBeGreaterThanOrEqual(10);
  });

  it('sizes orbits by the Peters inspiral time', () => {
    // a ∝ c^(-5/4) at fixed inspiral time.
    expect(separationForInspiral(30, 30, 200, 10) / separationForInspiral(30, 30, 100, 10)).toBeCloseTo(2 ** -1.25, 6);
  });

  for (const ev of events) {
    it(`${ev.name} spirals in and merges with its real masses`, () => {
      const sim = new Simulation();
      loadGwEvent(sim, ev);
      expect(sim.bodies.map((b) => b.mass).sort((a, b) => b - a)).toEqual([ev.m1, ev.m2]);
      let mergedAt = Infinity;
      for (let t = 0; t < 60 && sim.bodies.length > 1; t += 0.5) {
        sim.advance(0.5, 1e7, 1e9);
        if (sim.bodies.length === 1) mergedAt = sim.time;
      }
      expect(mergedAt).toBeGreaterThan(8);
      expect(mergedAt).toBeLessThan(40);
      expect(sim.bodies[0].mass).toBeCloseTo(ev.m1 + ev.m2, 6);
    }, 60000);
  }
});
