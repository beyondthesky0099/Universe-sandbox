import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { julianDate } from '../src/sim/ephemeris';
import { loadSolarSystemOnDate, loadSolarSystemTrueScale } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';
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
