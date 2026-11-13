import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeObject, flattenObjects, objectFacts, objectKindLabel, xrayMasses, xrayPeriodDays, type GalacticObjects } from '../src/sim/galacticObjects';
import { loadWolfRayet, loadXrayBinary } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';

const data: GalacticObjects = JSON.parse(readFileSync(new URL('../public/data/galactic-objects.json', import.meta.url), 'utf8'));
const all = flattenObjects(data);
const find = (re: RegExp) => all.find((o) => re.test(o.name))!;

describe('X-ray binaries and Wolf–Rayet stars with measured distances', () => {
  it('has the famous systems at their Gaia distances', () => {
    expect(data.hmxb.length).toBeGreaterThan(90);
    expect(data.lmxb.length).toBeGreaterThan(180);
    expect(data.wr.length).toBeGreaterThan(200);
    const cyg = find(/^Cyg X-1$/);
    expect(cyg.kind).toBe('hmxb');
    if (cyg.kind !== 'hmxb') return;
    expect(cyg.compact).toBe('BH');
    expect(cyg.d).toBeGreaterThan(1.8); // kpc: Miller-Jones et al. 2021 found 2.2
    expect(cyg.d).toBeLessThan(2.5);
    expect(cyg.per).toBeCloseTo(5.6, 1); // days
    expect(cyg.mx).toBeGreaterThan(15);
    const sco = find(/^Sco X-1/);
    expect(sco.kind).toBe('lmxb');
    if (sco.kind !== 'lmxb') return;
    expect(sco.compact).toBe('NS');
    expect(sco.per! * 24).toBeCloseTo(18.9, 0); // hours
    expect(sco.d).toBeGreaterThan(1.5);
    expect(sco.d).toBeLessThan(3);
    // Every distance is inside the Galaxy.
    for (const o of all) {
      expect(o.d).toBeGreaterThan(0);
      expect(o.d).toBeLessThan(35);
    }
  });

  it('describes each kind and fills in typical values where the catalogue has none', () => {
    const cyg = find(/^Cyg X-1$/);
    expect(objectKindLabel(cyg)).toBe('black-hole high-mass X-ray binary');
    expect(describeObject(cyg)).toMatch(/black hole feeding on the wind of a \d+ M☉ supergiant every 5\.60 days/);
    const wr140 = find(/^WR 140$/);
    expect(objectKindLabel(wr140)).toBe('Wolf–Rayet star (WC7pd)');
    expect(describeObject(wr140)).toContain('2,870 km/s');
    expect(objectFacts(wr140).map(([k]) => k)).toContain('Wind speed');
    const unknown = { kind: 'lmxb' as const, name: 'X', l: 0, b: 0, d: 1, compact: '?' as const };
    expect(xrayMasses(unknown)).toEqual({ compact: 1.4, companion: 0.5, isBlackHole: false });
    expect(xrayPeriodDays(unknown)).toEqual({ days: 0.4, assumed: true });
    expect(objectFacts(unknown).find(([k]) => k === 'Orbit')![1]).toBe('period unknown');
  });

  it('builds Cyg X-1 in the Sandbox: a black hole and its supergiant on a 5.6-day orbit', () => {
    const sim = new Simulation();
    const cyg = find(/^Cyg X-1$/);
    if (cyg.kind === 'wr') throw new Error('Cyg X-1 is a binary');
    const setup = loadXrayBinary(sim, cyg);
    expect(sim.bodies.length).toBe(2);
    const hole = sim.bodies.find((b) => b.kind === 'blackhole')!;
    const star = sim.bodies.find((b) => b.kind !== 'blackhole')!;
    expect(hole.mass).toBeCloseTo(21.2, 1);
    expect(star.mass).toBeCloseTo(40.6, 1);
    // Kepler: a³ = P² (M1 + M2) in AU, years and solar masses.
    const years = 5.5998 / 365.25;
    const a = Math.cbrt(years * years * (21.2 + 40.6));
    const sep = Math.hypot(hole.x - star.x, hole.y - star.y, hole.z - star.z);
    expect(sep).toBeCloseTo(a, 2);
    expect(setup.tip).toContain('black hole');
    expect(setup.tip).not.toContain('typical values'); // everything is measured
  });

  it('shows a neutron-star binary with relativity on and says what is assumed', () => {
    const sim = new Simulation();
    const o = { kind: 'lmxb' as const, name: 'Test NS', l: 0, b: 0, d: 2, compact: 'NS' as const };
    const setup = loadXrayBinary(sim, o);
    expect(sim.bodies.map((b) => b.kind).sort()).toEqual(['neutron', 'star']);
    expect(sim.relativity).toBe(true);
    expect(setup.tip).toContain('typical values are shown for the neutron star mass, the companion mass, the orbit');
  });

  it('builds a Wolf–Rayet star as a massive evolved star', () => {
    const sim = new Simulation();
    const wr = data.wr.find((o) => o.name === 'WR 140')!;
    loadWolfRayet(sim, wr);
    expect(sim.bodies.length).toBe(1);
    expect(sim.bodies[0].kind).toBe('star');
    expect(sim.bodies[0].mass).toBe(12); // WC
  });
});
