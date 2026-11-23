import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hyperbolicState, perihelionDate, type InterstellarObject } from '../src/sim/interstellar';
import { julianDate } from '../src/sim/ephemeris';
import { AU_PER_YEAR_IN_KMS } from '../src/sim/units';

const objects: InterstellarObject[] = JSON.parse(readFileSync(new URL('../public/data/interstellar.json', import.meta.url), 'utf8')).objects;
const byName = (n: string) => objects.find((o) => o.name === n)!;
const r = (o: InterstellarObject, iso: string) => Math.hypot(...hyperbolicState(o, julianDate(new Date(iso))).pos);

describe('interstellar visitors (JPL hyperbolic orbits)', () => {
  it('has the three known objects, all unbound', () => {
    expect(objects.map((o) => o.designation)).toEqual(['1I/2017 U1', '2I/2019 Q4', '3I/2025 N1']);
    for (const o of objects) expect(o.e).toBeGreaterThan(1);
  });

  it('passes perihelion at q, on the published dates', () => {
    for (const o of objects) expect(Math.hypot(...hyperbolicState(o, o.tpJd).pos)).toBeCloseTo(o.q, 9);
    expect(perihelionDate(byName('ʻOumuamua')).toISOString().slice(0, 10)).toBe('2017-09-09');
    expect(perihelionDate(byName('Borisov')).toISOString().slice(0, 10)).toBe('2019-12-08');
    expect(perihelionDate(byName('3I/ATLAS')).toISOString().slice(0, 10)).toBe('2025-10-29');
  });

  it('was where the discovery reports put it', () => {
    // ʻOumuamua 1.22 AU from the Sun (Meech et al. 2017), Borisov ~3.0 AU, 3I/ATLAS ~4.5 AU (Seligman et al. 2025).
    expect(r(byName('ʻOumuamua'), '2017-10-19T00:00:00Z')).toBeCloseTo(1.22, 1);
    expect(r(byName('Borisov'), '2019-08-30T00:00:00Z')).toBeCloseTo(3.0, 1);
    expect(r(byName('3I/ATLAS'), '2025-07-01T00:00:00Z')).toBeCloseTo(4.5, 1);
  });

  it('leaves at its hyperbolic excess speed', () => {
    for (const o of objects) {
      const v = Math.hypot(...hyperbolicState(o, o.tpJd + 365.25 * 3000).vel) * AU_PER_YEAR_IN_KMS;
      expect(v).toBeCloseTo(o.vInfKms, 0);
    }
    // 26.3, 32.2 and 58 km/s in the literature.
    expect(byName('3I/ATLAS').vInfKms).toBeGreaterThan(byName('Borisov').vInfKms);
  });
});
