import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { julianDate } from '../src/sim/ephemeris';
import { loadSolarSystemOnDate, loadSolarSystemTrueScale } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';
import { contactDistance, physicalRadius } from '../src/sim/body';
import { EARTH_MASS } from '../src/sim/units';
import { parseSolarData, setSolarData } from '../src/sim/solarSystemData';
import { spacecraftState, type SpacecraftData } from '../src/sim/spacecraft';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8'));
const craft: SpacecraftData[] = read('spacecraft.json').craft;
const byName = (n: string) => craft.find((c) => c.name === n)!;

beforeAll(() => setSolarData(parseSolarData(read('solar-system.json'), read('small-bodies.json'), read('saturn-rings.json'), read('spacecraft.json'))));
afterAll(() => setSolarData(undefined));

/** JPL Horizons heliocentric ecliptic positions (AU) on dates between the stored samples. */
const REFERENCE: [string, string, number[], number][] = [
  ['Voyager 1', '2026-11-06', [-32.20605629148761, -137.1076009272904, 99.19965229283098], 0.001],
  ['New Horizons', '2015-07-14', [8.001332913122692, -31.89782629233863, 1.097711736220263], 0.005], // Pluto flyby day
  ['Voyager 2', '1989-08-25', [5.999167774477492, -29.60633460723524, 0.4716511963825736], 0.01], // Neptune flyby day
];

describe('real spacecraft (JPL Horizons)', () => {
  it('interpolates to within a small distance of Horizons between samples', () => {
    for (const [name, date, ref, tol] of REFERENCE) {
      const st = spacecraftState(byName(name), julianDate(new Date(`${date}T00:00:00Z`)))!;
      const err = Math.hypot(st.pos[0] - ref[0], st.pos[1] - ref[1], st.pos[2] - ref[2]);
      expect(err, name).toBeLessThan(tol);
    }
    // Voyager 1 is about 172 AU from the Sun in late 2026 and moving at ~17 km/s.
    const v1 = spacecraftState(byName('Voyager 1'), julianDate(new Date('2026-11-01T00:00:00Z')))!;
    expect(Math.hypot(...v1.pos)).toBeGreaterThan(165);
    expect(Math.hypot(...v1.pos)).toBeLessThan(180);
    expect((Math.hypot(...v1.vel) * 1.496e8) / (365.25 * 86400)).toBeCloseTo(16.9, 0);
    expect(spacecraftState(byName('Cassini'), julianDate(new Date('2026-11-01T00:00:00Z')))).toBeUndefined();
  });

  it('adds the spacecraft flying on the scene date, minus orbiters and craft inside enlarged planets', () => {
    const sim = new Simulation();
    loadSolarSystemOnDate(sim, new Date('2026-11-01T00:00:00Z'));
    const probes = sim.bodies.filter((b) => b.tag === 'probe').map((b) => b.name);
    for (const n of ['Voyager 1', 'Voyager 2', 'New Horizons', 'Europa Clipper']) expect(probes).toContain(n);
    expect(probes).not.toContain('Juno'); // orbiting Jupiter
    expect(probes).not.toContain('James Webb Space Telescope'); // would sit inside the enlarged Earth
    expect(probes).not.toContain('Cassini'); // mission over

    const real = new Simulation();
    loadSolarSystemTrueScale(real, new Date('2026-11-01T00:00:00Z'));
    expect(real.bodies.some((b) => b.name === 'James Webb Space Telescope')).toBe(true);

    // In 2004 Cassini was arriving at Saturn and Voyager 1 was beyond 90 AU.
    const past = new Simulation();
    loadSolarSystemOnDate(past, new Date('2004-01-01T00:00:00Z'));
    const names = past.bodies.map((b) => b.name);
    expect(names).toContain('Cassini');
    expect(names).not.toContain('New Horizons'); // launched 2006
  });
});

describe('spacecraft touch real surfaces only', () => {
  it('meets a planet at its real radius, not its enlarged drawing', () => {
    const earth = { kind: 'rocky' as const, mass: EARTH_MASS, radius: 0.02, tag: undefined };
    const probe = { kind: 'rocky' as const, mass: 1e-20, radius: 0.001, tag: 'probe' };
    // 0.02 AU drawn, but contact at Earth's real radius (about 6,400 km).
    expect(contactDistance(earth, probe) * 1.496e8).toBeCloseTo(physicalRadius('rocky', EARTH_MASS) * 1.496e8, 6);
    expect(contactDistance(earth, probe) * 1.496e8).toBeLessThan(7000);
    // Two ordinary bodies (a thrown-in asteroid of 0.01 Earth masses) still touch at their drawn radii.
    expect(contactDistance(earth, { ...probe, mass: 0.01 * EARTH_MASS, tag: undefined })).toBeCloseTo(0.021, 12);
    // A small real asteroid or a comet meets the real surface too.
    expect(contactDistance(earth, { ...probe, tag: undefined }) * 1.496e8).toBeLessThan(7000);
    expect(contactDistance(earth, { ...probe, mass: 1e-12, tag: 'comet' }) * 1.496e8).toBeLessThan(7000);
  });

  it('flies JUICE past Earth in January 2029 without a crash', () => {
    const sim = new Simulation();
    loadSolarSystemOnDate(sim, new Date('2026-11-22T00:00:00Z'));
    sim.particles.clear(); // the asteroids don't matter here, and slow the test
    const juice = () => sim.bodies.find((b) => b.name === 'JUICE');
    const earth = () => sim.bodies.find((b) => b.name === 'Earth')!;
    expect(juice()).toBeDefined();
    let closest = Infinity;
    // To March 2029, past the flyby.
    for (let t = 0; t < 2.3; t += 0.002) {
      sim.advance(0.002, 100000, 1e9);
      const j = juice();
      if (!j) break;
      closest = Math.min(closest, Math.hypot(j.x - earth().x, j.y - earth().y, j.z - earth().z));
    }
    expect(juice()).toBeDefined();
    // It really does pass close: well inside the Moon's orbit's scale, a few Earth radii up.
    expect(closest).toBeLessThan(0.01);
  }, 120_000);

  it('passes Apophis by Earth on 13 April 2029 without a crash', () => {
    const sim = new Simulation();
    loadSolarSystemOnDate(sim, new Date('2029-03-01T00:00:00Z'));
    sim.particles.clear();
    const apophis = () => sim.bodies.find((b) => b.name === 'Apophis');
    const earth = () => sim.bodies.find((b) => b.name === 'Earth')!;
    expect(apophis()).toBeDefined();
    let closest = Infinity;
    // To late May 2029, past the flyby.
    for (let t = 0; t < 0.24; t += 0.0002) {
      sim.advance(0.0002, 100000, 1e9);
      const a = apophis();
      if (!a) break;
      closest = Math.min(closest, Math.hypot(a.x - earth().x, a.y - earth().y, a.z - earth().z));
    }
    expect(apophis()).toBeDefined();
    // JPL: 38,000 km from Earth's centre. This scene starts Apophis from catalogue elements a month
    // out and gets about 290,000 km; the Events pane's flyby (flybys.json) follows JPL's path exactly.
    // Either way, a close pass inside the Moon's orbit, not a collision.
    expect(closest * 1.496e8).toBeLessThan(384400);
    expect(closest * 1.496e8).toBeGreaterThan(6371);
  }, 120_000);
});
