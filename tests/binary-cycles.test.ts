import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  discRate,
  discSurvival,
  dwarfNovaCycle,
  dwarfNovaKind,
  ignitionMass,
  kukarkinParenago,
  magnitudeBelowPeak,
  nauenbergRadius,
  novaEruption,
  novaLuminosity,
  novaMagnitude,
  shellRadius,
} from '../src/sim/binaryCycles';
import { flattenObjects, type GalacticObjects } from '../src/sim/galacticObjects';
import { transferForAccretor } from '../src/sim/massTransfer';
import { loadWhiteDwarfBinary } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';

const raw: GalacticObjects = JSON.parse(readFileSync(new URL('../public/data/galactic-objects.json', import.meta.url), 'utf8'));
const all = flattenObjects(raw);
const DAY = 1 / 365.25;

describe('dwarf-nova outbursts', () => {
  it('picks the subtype, with superoutbursts only at short periods', () => {
    expect(dwarfNovaKind(['DN', 'SU'], 1.8 / 24)).toBe('SU');
    // U Gem (4.2 h) is flagged SU in the catalogue but is the prototype of ordinary dwarf novae.
    expect(dwarfNovaKind(['DN', 'UG', 'SU'], 4.25 / 24)).toBe('UG');
    expect(dwarfNovaKind(['DN', 'SU', 'WZ'], 1.36 / 24)).toBe('WZ');
    expect(dwarfNovaKind(['NL', 'AM'], 0.13)).toBeUndefined();
    expect(dwarfNovaKind(undefined)).toBeUndefined();
  });

  it('follows the Kukarkin–Parenago relation and conserves mass over a cycle', () => {
    // SS Cyg-like: every 50 days, about 4 magnitudes.
    expect(kukarkinParenago(50)).toBeCloseTo(0.7 + 1.9 * Math.log10(50), 9);
    expect(kukarkinParenago(50)).toBeGreaterThan(3.5);
    expect(kukarkinParenago(50)).toBeLessThan(4.2);
    for (const kind of ['UG', 'SU', 'ER'] as const) {
      const c = dwarfNovaCycle(kind, 1e-9, 0);
      // Over a (super)cycle the disc passes on exactly what the donor supplied.
      const span = (c.superDays ?? c.recurrenceDays) * DAY;
      let mean = 0;
      const n = 20000;
      for (let k = 0; k < n; k++) mean += discRate(c, (span * (k + 0.5)) / n);
      expect(mean / n / 1e-9).toBeCloseTo(1, 2);
      // In outburst the disc accretes faster than the donor supplies (ER UMa stars, in outburst a
      // good part of the time, least so).
      expect(c.peakRate).toBeGreaterThan(2e-9);
      if (kind === 'UG') expect(c.peakRate).toBeGreaterThan(1e-8);
    }
  });

  it('rises in a day, holds, and fades; superoutbursts are brighter and longer', () => {
    const c = dwarfNovaCycle('UG', 1e-9, 1);
    expect(magnitudeBelowPeak(c, 0.5)).toBeCloseTo(c.amplitude, 9); // before the first outburst: quiet
    expect(magnitudeBelowPeak(c, 1 + 2 * DAY)).toBe(0); // on the plateau
    expect(magnitudeBelowPeak(c, 1 + 4 * DAY)).toBeCloseTo(1, 6); // fading 1 mag a day
    expect(magnitudeBelowPeak(c, 1 + 20 * DAY)).toBeCloseTo(c.amplitude, 9);
    expect(magnitudeBelowPeak(c, 1 + 50 * DAY + 2 * DAY)).toBe(0); // the next one
    const su = dwarfNovaCycle('SU', 1e-10, 0);
    // The first outburst of a supercycle is the superoutburst: 0.7 mag brighter, still near peak after a week.
    expect(su.superAmplitude! - su.amplitude).toBeCloseTo(0.7, 9);
    expect(magnitudeBelowPeak(su, 8 * DAY)).toBeLessThan(1);
    expect(magnitudeBelowPeak(su, 20 * DAY + 8 * DAY)).toBeCloseTo(su.superAmplitude!, 6); // a normal one is over by then
  });
});

describe('nova eruptions', () => {
  it('ignites once enough hydrogen piles up: far less on massive white dwarfs', () => {
    // Nauenberg's radii: ~0.0124 R☉ at 0.6 M☉, shrinking towards the Chandrasekhar mass.
    expect(nauenbergRadius(0.6)).toBeCloseTo(0.0124, 3);
    expect(nauenbergRadius(1.35)).toBeLessThan(0.004);
    // ΔM = 4πR⁴P/(GM): ~10⁻⁴ M☉ for 1 M☉ (Yaron et al. 2005 give 10⁻⁵–10⁻⁴), ~10⁻⁶ for recurrent novae's 1.35 M☉.
    expect(ignitionMass(1.0)).toBeGreaterThan(3e-5);
    expect(ignitionMass(1.0)).toBeLessThan(3e-4);
    expect(ignitionMass(1.35)).toBeGreaterThan(5e-7);
    expect(ignitionMass(1.35)).toBeLessThan(5e-6);
    expect(ignitionMass(0.6)).toBeGreaterThan(ignitionMass(1.0));
  });

  it('replays the catalogue’s light curve and shell', () => {
    const e = novaEruption({ vmag: -7.5, t3: 30, fwhm: 2000, year: 1975.7 }, 1.0, 1e-9, 0);
    expect(e.ejectaKms).toBe(1000);
    expect(novaMagnitude(e, -DAY)).toBeUndefined();
    expect(novaMagnitude(e, 1 * DAY)).toBeCloseTo(-7.5, 9);
    expect(novaMagnitude(e, 31 * DAY)).toBeCloseTo(-4.5, 9); // 3 magnitudes in t₃
    expect(novaLuminosity(e, 1 * DAY)).toBeCloseTo(3.828e33 * 10 ** (-0.4 * (-7.5 - 4.74)), -33);
    // 1,000 km/s for a year: 211 AU.
    expect(shellRadius(e, 1)).toBeCloseTo(1000 / 4.7406, 6);
    // The ejecta clear the disc, which comes back over weeks.
    expect(discSurvival(e, 1 * DAY)).toBeLessThan(0.1);
    expect(discSurvival(e, 100 * DAY)).toBeGreaterThan(0.95);
    expect(e.recurrenceYears).toBeCloseTo(e.ejectaMass / 1e-9, 0);
  });
});

describe('the Sandbox scenes', () => {
  it('gives SS Cyg its outbursts and DQ Her its eruption, seen from Earth', () => {
    const ss = all.find((o) => o.name === 'SS Cyg')!;
    if (ss.kind !== 'cv') throw new Error('kind');
    const setup = loadWhiteDwarfBinary(new Simulation(), ss);
    const t = transferForAccretor('SS Cyg')!;
    expect(t.dwarfNova?.kind).toBe('UG');
    // The first outburst starts one orbit in.
    expect(t.dwarfNova!.startYears).toBeCloseTo(ss.per! / 365.25, 9);
    expect(setup.tip).toMatch(/live graph/);

    const dq = all.find((o) => o.name === 'DQ Her')!;
    if (dq.kind !== 'nova') throw new Error('kind');
    const s2 = loadWhiteDwarfBinary(new Simulation(), dq);
    const n = transferForAccretor('DQ Her')!;
    expect(n.nova?.year).toBeCloseTo(1934.9, 1);
    expect(n.nova?.t3Days).toBe(dq.t3);
    // Eclipsing and catalogued at 90°: the camera starts in the orbital plane.
    expect(n.inclination).toBe(dq.incl);
    expect(s2.elevation).toBeCloseTo(Math.PI / 2 - (dq.incl! * Math.PI) / 180, 9);
    expect(s2.tip).toMatch(/replays its 1934 eruption/);
    expect(s2.tip).toMatch(/eclipse/);
  });
});
