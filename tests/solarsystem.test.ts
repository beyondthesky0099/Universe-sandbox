import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSolarData, relativeState, smallBodyState, elementsFromState, stateFromElements, type SolarData } from '../src/sim/solarSystemData';
import { G } from '../src/sim/units';

const solar = JSON.parse(readFileSync(new URL('../public/data/solar-system.json', import.meta.url), 'utf8'));
const small = JSON.parse(readFileSync(new URL('../public/data/small-bodies.json', import.meta.url), 'utf8'));
const data: SolarData = parseSolarData(solar, small);

/** JPL Horizons geometric vectors (ecliptic J2000, AU) on 2027-03-15 00:00 TDB, relative to the parent. */
const JD = 2461479.5;
const REFERENCE: [string, number[]][] = [
  ['Ceres', [-1.385835206844169, 2.141242301539523, 0.3230402082367674]],
  ['Halley', [-19.26355022442704, 27.48544309333707, -9.831344712972086]],
  ['Eris', [85.00219966214058, 39.8369330409797, -17.0885440297878]],
  ['Moon', [6.484321508979871e-4, 2.401110840311344e-3, 2.047763148517021e-4]],
  ['Titan', [-7.261891455610195e-3, 3.983937648511906e-3, -1.331797802278815e-3]],
  ['Io', [-2.816802509077735e-3, 6.151701274603363e-5, -3.863514410122685e-5]],
  ['Charon', [-2.995503366777047e-5, 4.242191512292724e-5, 1.202504720170554e-4]],
];

function muFor(name: string): number {
  const b = data.byName.get(name)!;
  const parentMass = b.parent === 'Sun' ? 1 : data.byName.get(b.parent)!.mass!;
  return G * (parentMass + (b.mass ?? 0));
}

describe('real Solar System data', () => {
  it('has physical data for every planet and major moon', () => {
    for (const name of ['Mercury', 'Earth', 'Jupiter', 'Saturn', 'Neptune', 'Pluto', 'Moon', 'Titan', 'Ganymede', 'Triton', 'Charon']) {
      const b = data.byName.get(name)!;
      expect(b, name).toBeDefined();
      expect(b.mass, name).toBeGreaterThan(0);
      expect(b.radiusKm, name).toBeGreaterThan(0);
    }
    // Earth: GM 398600 km³/s² → 3.003e-6 M☉, radius 6371 km, tilt 23.44°
    const earth = data.byName.get('Earth')!;
    expect(earth.mass! / 3.003e-6).toBeCloseTo(1, 2);
    expect(earth.radiusKm).toBeCloseTo(6371, 0);
    expect(earth.obliquityDeg).toBeCloseTo(23.44, 1);
    expect(data.byName.get('Jupiter')!.rotationHours).toBeCloseTo(9.925, 2);
  });

  it('round-trips elements and state vectors', () => {
    const mu = G;
    const s = stateFromElements(2.7, 0.3, 0.2, 1.1, 2.3, 4.0, mu);
    const k = elementsFromState(s, mu);
    expect(k.a).toBeCloseTo(2.7, 9);
    expect(k.e).toBeCloseTo(0.3, 9);
    expect(k.i).toBeCloseTo(0.2, 9);
    expect(k.node).toBeCloseTo(1.1, 9);
    expect(k.peri).toBeCloseTo(2.3, 9);
    expect(k.M).toBeCloseTo(4.0, 9);
  });

  it('propagates heliocentric bodies to within 0.01 AU of JPL Horizons after 4.5 months', () => {
    for (const [name, ref] of REFERENCE.slice(0, 3)) {
      const s = relativeState(data.byName.get(name)!, JD, muFor(name));
      const err = Math.hypot(s.pos[0] - ref[0], s.pos[1] - ref[1], s.pos[2] - ref[2]);
      expect(err, name).toBeLessThan(0.01);
    }
  });

  it('propagates moons to within a few percent of their orbit size', () => {
    for (const [name, ref] of REFERENCE.slice(3)) {
      const s = relativeState(data.byName.get(name)!, JD, muFor(name));
      const r = Math.hypot(ref[0], ref[1], ref[2]);
      const err = Math.hypot(s.pos[0] - ref[0], s.pos[1] - ref[1], s.pos[2] - ref[2]);
      // Fitted mean elements leave only short-period wobbles (the Moon is the worst, ~2%).
      expect(err / r, name).toBeLessThan(0.05);
    }
  });

  it('places real asteroids and Kuiper belt objects', () => {
    expect(data.small.length).toBeGreaterThan(3000);
    const classes = new Set(data.small.map((b) => b.cls));
    for (const c of ['MBA', 'TJN', 'TNO']) expect(classes.has(c)).toBe(true);
    // Ceres from the small-body file agrees with the Horizons-based entry.
    const ceres = data.small.find((b) => b.name.includes('Ceres'))!;
    const s = smallBodyState(ceres, JD);
    const ref = REFERENCE[0][1];
    expect(Math.hypot(s.pos[0] - ref[0], s.pos[1] - ref[1], s.pos[2] - ref[2])).toBeLessThan(0.02);
  });
});

describe('real Solar System scenes', () => {
  it('builds the whole Solar System with real small bodies', async () => {
    const { setSolarData } = await import('../src/sim/solarSystemData');
    const { loadSolarSystemOnDate } = await import('../src/sim/presets');
    const { Simulation } = await import('../src/sim/simulation');
    setSolarData(data);
    const sim = new Simulation();
    loadSolarSystemOnDate(sim, new Date('2026-11-01T00:00:00Z'));
    const names = sim.bodies.map((b) => b.name);
    for (const n of ['Sun', 'Earth', 'Pluto', 'Ceres', 'Eris', 'Halley', 'Apophis']) expect(names).toContain(n);
    expect(sim.particles.count).toBeGreaterThan(3900);
    const before = sim.bodies.length;
    sim.advance(2, 1e7, 1e9);
    expect(sim.bodies.length).toBe(before);
    setSolarData(undefined);
  }, 60000);

  for (const planet of ['Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']) {
    it(`keeps ${planet}'s real moons intact for many orbits`, async () => {
      const { loadMoonSystem } = await import('../src/sim/presets');
      const { Simulation } = await import('../src/sim/simulation');
      const sim = new Simulation();
      const setup = loadMoonSystem(sim, planet, new Date('2026-11-01T00:00:00Z'), data);
      const moons = data.bodies.filter((b) => b.parent === planet && b.kind === 'moon');
      expect(sim.bodies.length).toBe(moons.length + 1);
      // Sizes are real: the planet's radius is its true radius in AU.
      const p = sim.bodies.find((b) => b.name === planet)!;
      expect(p.radius * 149597870.7).toBeCloseTo(data.byName.get(planet)!.radiusKm!, 0);
      // Run ~30 orbits of the innermost moon (setup.timeScale is a sixth of its period).
      sim.advance(setup.timeScale * 6 * 30, 1e7, 1e9);
      expect(sim.bodies.length).toBe(moons.length + 1);
      for (const m of moons) {
        const b = sim.bodies.find((x) => x.name === m.name)!;
        const r = Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
        // Still on its orbit: within its periapsis/apoapsis band (with some slack).
        expect(r, m.name).toBeGreaterThan(m.elements.a * (1 - m.elements.e) * 0.8);
        expect(r, m.name).toBeLessThan(m.elements.a * (1 + m.elements.e) * 1.25);
      }
    }, 60000);
  }
});

describe('real spin axes (IAU poles)', () => {
  const angleDeg = (a: number[], b: number[]) =>
    (Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))))) * 180) / Math.PI;

  it("matches each planet's obliquity reported by JPL Horizons", async () => {
    const { poleScene } = await import('../src/sim/solarSystemData');
    const DEG = Math.PI / 180;
    for (const name of ['Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) {
      const b = data.byName.get(name)!;
      // Rotation axis (right-hand rule): the IAU north pole, flipped for retrograde rotators.
      const p = poleScene(b)!.map((v) => (b.retrograde ? -v : v));
      // Orbit normal from the heliocentric elements, ecliptic → scene (x, z, −y).
      const i = b.elements.i * DEG, node = b.elements.node * DEG;
      const n = [Math.sin(i) * Math.sin(node), -Math.sin(i) * Math.cos(node), Math.cos(i)];
      expect(angleDeg(p, [n[0], n[2], -n[1]]), name).toBeCloseTo(b.obliquityDeg!, 0);
    }
    // Earth's axis is 23.44° from the ecliptic pole (scene +Y).
    expect(angleDeg(poleScene(data.byName.get('Earth')!)!, [0, 1, 0])).toBeCloseTo(23.44, 1);
  });

  it("agrees with the orbits of Saturn's inner moons, which lie in its equator", async () => {
    const { poleScene } = await import('../src/sim/solarSystemData');
    const pole = poleScene(data.byName.get('Saturn')!)!;
    for (const name of ['Mimas', 'Enceladus', 'Tethys', 'Dione', 'Rhea']) {
      const s = relativeState(data.byName.get(name)!, 2461345.5, muFor(name));
      // Orbit normal r × v, converted from ecliptic to scene coordinates (x, z, −y).
      const [x, y, z] = s.pos;
      const [vx, vy, vz] = s.vel;
      const h = [y * vz - z * vy, z * vx - x * vz, x * vy - y * vx];
      expect(angleDeg([h[0], h[2], -h[1]], pole), name).toBeLessThan(2);
    }
  });
});

describe('parent bodies', () => {
  it('reports moons orbiting their planet and the planet orbiting nothing', async () => {
    const { loadMoonSystem } = await import('../src/sim/presets');
    const { Simulation } = await import('../src/sim/simulation');
    const sim = new Simulation();
    loadMoonSystem(sim, 'Saturn', new Date('2026-11-01T00:00:00Z'), data);
    const byName = (n: string) => sim.bodies.find((b) => b.name === n)!;
    expect(sim.parentOf(byName('Titan'))?.name).toBe('Saturn');
    expect(sim.parentOf(byName('Mimas'))?.name).toBe('Saturn');
    expect(sim.parentOf(byName('Saturn'))).toBeUndefined();
  });
});
