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
