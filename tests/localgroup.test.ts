import { describe, expect, it } from 'vitest';
import { loadMilkyWayAndromeda } from '../src/sim/localGroup';
import { Simulation } from '../src/sim/simulation';
import { captureState, restoreState } from '../src/sim/state';
import { KPC_PER_MYR_IN_KMS } from '../src/sim/units';

describe('Milky Way meets Andromeda (real)', () => {
  it('starts at the measured distance and closing speed', () => {
    const sim = new Simulation();
    loadMilkyWayAndromeda(sim);
    const [mw, m31] = sim.bodies;
    expect(sim.units).toBe('kpc-myr');
    const d = Math.hypot(m31.x - mw.x, m31.y - mw.y, m31.z - mw.z);
    expect(d).toBeCloseTo(770, 0);
    const radial = ((m31.vx - mw.vx) * (m31.x - mw.x) + (m31.vy - mw.vy) * (m31.y - mw.y) + (m31.vz - mw.vz) * (m31.z - mw.z)) / d;
    expect(radial * KPC_PER_MYR_IN_KMS).toBeCloseTo(-109.3, 1);
    // Units survive save and load.
    const saved = captureState(sim);
    const other = new Simulation();
    restoreState(other, saved);
    expect(other.units).toBe('kpc-myr');
  });

  it('keeps the disks stable and brings the galaxies together at about the predicted time', () => {
    const sim = new Simulation();
    loadMilkyWayAndromeda(sim);
    const mean = () => {
      const mw = sim.bodies[0];
      let s = 0;
      for (let i = 0; i < 3500; i++) s += Math.hypot(sim.particles.pos[i * 3] - mw.x, sim.particles.pos[i * 3 + 1] - mw.y, sim.particles.pos[i * 3 + 2] - mw.z);
      return s / 3500;
    };
    const r0 = mean();
    sim.advance(1000, 1e7, 1e9);
    expect(Math.abs(mean() / r0 - 1)).toBeLessThan(0.1); // circular orbits hold
    let mergedAt = Infinity;
    for (let t = 1000; t < 6000 && sim.bodies.length > 1; t += 50) {
      sim.advance(50, 1e7, 1e9);
      if (sim.bodies.length === 1) mergedAt = sim.time;
    }
    // van der Marel et al. (2012): first close passage in about 3.9 billion years.
    expect(mergedAt).toBeGreaterThan(3300);
    expect(mergedAt).toBeLessThan(4500);
    expect(sim.particles.count).toBe(8000); // stars survive the merger
    expect(sim.bodies[0].name).toBe('Milkomeda');
    expect(sim.bodies[0].kind).toBe('star'); // still a galaxy, not a collapsed object
    sim.advance(500, 1e7, 1e9);
    expect(sim.particles.count).toBe(8000);
  }, 60000);
});
