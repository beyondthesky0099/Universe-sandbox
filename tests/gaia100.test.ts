import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadNeighbourhood100, type Stars100 } from '../src/sim/gaia100';
import { Simulation } from '../src/sim/simulation';
import { AU_PER_PC, type NearStar } from '../src/sim/stars';

const read = <T>(f: string): T => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const data = read<Stars100>('stars-100pc.json');
const near = read<{ stars: NearStar[] }>('stars-near.json').stars;

describe('stars within 100 parsecs (Gaia DR3)', () => {
  it('has every Gaia star within 100 pc brighter than G = 11', () => {
    const n = data.stars.length / data.stride;
    expect(n).toBe(44529);
    for (let i = 0; i < n; i += 997) {
      const o = i * data.stride;
      expect(Math.hypot(data.stars[o], data.stars[o + 1], data.stars[o + 2])).toBeLessThanOrEqual(100.01);
    }
  });

  it('shows the Hyades as a real clump 47 pc away', () => {
    // The Hyades centre: ecliptic longitude ≈ 67.7°, latitude ≈ −5.6°, 47 pc (Gaia).
    const lon = (67.7 * Math.PI) / 180, lat = (-5.6 * Math.PI) / 180;
    const c = [47 * Math.cos(lat) * Math.cos(lon), 47 * Math.cos(lat) * Math.sin(lon), 47 * Math.sin(lat)];
    const within = (r: number, centre: number[]) => {
      let n = 0;
      for (let o = 0; o < data.stars.length; o += data.stride) if (Math.hypot(data.stars[o] - centre[0], data.stars[o + 1] - centre[1], data.stars[o + 2] - centre[2]) < r) n++;
      return n;
    };
    const hyades = within(5, c);
    const elsewhere = within(5, [-c[0], -c[1], -c[2]]); // same distance, opposite direction
    expect(hyades).toBeGreaterThan(80);
    expect(hyades).toBeGreaterThan(elsewhere * 5);
  });

  it('loads as a moving neighbourhood, adding the brightest stars Gaia cannot measure', () => {
    const sim = new Simulation();
    loadNeighbourhood100(sim, data, near);
    expect(sim.particles.count + sim.bodies.length).toBeGreaterThan(44500);
    for (const name of ['Sirius', 'Vega', 'Arcturus', 'Alcor']) expect(sim.bodies.some((b) => b.name === name), name).toBe(true);
    const alcor = sim.bodies.find((b) => b.name === 'Alcor')!;
    // Hipparcos put Alcor at 81.7 light-years; Gaia DR3 at about 80.6.
    const ly = (Math.hypot(alcor.x, alcor.y, alcor.z) / AU_PER_PC) * 3.2616;
    expect(ly).toBeGreaterThan(79.5);
    expect(ly).toBeLessThan(82.5);
    // Straight-line motion: after 10,000 years each star has moved by its velocity × time.
    const p0 = Array.from(sim.particles.pos.subarray(0, 3));
    const v0 = Array.from(sim.particles.vel.subarray(0, 3));
    sim.advance(10000, 1e6, 1e9);
    const p1 = sim.particles.pos.subarray(0, 3);
    for (let k = 0; k < 3; k++) expect(p1[k]).toBeCloseTo(p0[k] + v0[k] * 10000, 0);
  });
});
