import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseClusters } from '../src/sim/clusters';
import { loadRealCluster } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';
import { G } from '../src/sim/units';

const clusters = parseClusters(JSON.parse(readFileSync('public/data/clusters.json', 'utf8')));
const byName = (n: string) => clusters.find((c) => c.name?.startsWith(n))!;

/** 2T / |W| for the scene's stars (1 in virial equilibrium). */
function virialRatio(sim: Simulation): number {
  const b = sim.bodies;
  let T = 0, W = 0;
  for (const s of b) T += 0.5 * s.mass * (s.vx ** 2 + s.vy ** 2 + s.vz ** 2);
  const g = G * sim.gravityScale;
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++) W -= (g * b[i].mass * b[j].mass) / Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y, b[i].z - b[j].z);
  return (2 * T) / -W;
}

describe('entering a real star cluster', () => {
  it('builds the Pleiades from its Gaia members, size and age: young, so few remnants and hot massive stars still shining', () => {
    const c = byName('Pleiades');
    const sim = new Simulation();
    const setup = loadRealCluster(sim, c);
    expect(sim.bodies.length).toBe(Math.min(2000, c.members!));
    // About 100 million years old: only its few most massive stars have died (the real Pleiades has white dwarfs too).
    expect(sim.bodies.filter((s) => s.kind === 'whitedwarf').length).toBeLessThan(0.05 * sim.bodies.length);
    expect(sim.bodies.some((s) => s.kind === 'star' && s.mass > 3)).toBe(true);
    expect(setup.tip).toMatch(/Pleiades/);
    const r = virialRatio(sim);
    expect(r).toBeGreaterThan(0.6);
    expect(r).toBeLessThan(1.5);
  });

  it('builds a globular (Omega Centauri) from 2,000 stars with gravity scaled to its mass: old, with remnants', () => {
    const c = clusters.find((x) => x.kind === 'globular' && /5139|Omega/.test(`${x.id} ${x.name}`))!;
    const sim = new Simulation();
    loadRealCluster(sim, c);
    expect(sim.bodies.length).toBe(2000);
    // About a million suns from its luminosity: gravity scaled far above the 2,000 drawn stars.
    expect(sim.gravityScale).toBeGreaterThan(100);
    expect(sim.bodies.some((s) => s.kind === 'whitedwarf')).toBe(true);
    expect(sim.bodies.filter((s) => s.kind === 'star').every((s) => s.mass < 0.95)).toBe(true);
  });
});
