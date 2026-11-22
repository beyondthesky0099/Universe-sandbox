import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flattenObjects, xrayFeed, type GalacticObjects } from '../src/sim/galacticObjects';
import {
  accretionLuminosity,
  ballisticStream,
  binaryTransfer,
  circularizationRadius,
  discTidalRadius,
  gwJdotOverJ,
  l1Distance,
  rochePotential,
  rocheLobeRadius,
  rocheShape,
  rocheTransferRate,
  transferForAccretor,
  transferForDonor,
} from '../src/sim/massTransfer';
import { loadWhiteDwarfBinary, loadXrayBinary } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';

const raw: GalacticObjects = JSON.parse(readFileSync(new URL('../public/data/galactic-objects.json', import.meta.url), 'utf8'));
const all = flattenObjects(raw);
const find = (name: string) => all.find((o) => o.name === name)!;
const DEG = Math.PI / 180;

describe('Roche geometry', () => {
  it('matches Eggleton’s lobe radii and the classic lobe shape', () => {
    // Eggleton 1983 at q = 1 and q = 0.1.
    expect(rocheLobeRadius(1)).toBeCloseTo(0.3789, 4);
    expect(rocheLobeRadius(0.1)).toBeCloseTo(0.2068, 4);
    // Equal masses: L1 halfway, and the lobe's back, side and pole radii of Kopal's tables.
    expect(l1Distance(1)).toBeCloseTo(0.5, 6);
    const s = rocheShape(1);
    expect(s.front).toBeCloseTo(0.5, 6);
    expect(s.back).toBeCloseTo(0.405, 2);
    expect(s.side).toBeCloseTo(0.374, 2);
    expect(s.pole).toBeCloseTo(0.356, 2);
    // L1 is a saddle of the potential: the force vanishes there.
    for (const q of [0.05, 0.3, 2]) {
      const x = l1Distance(q), h = 1e-6;
      const grad = (rochePotential(q, [x + h, 0, 0]) - rochePotential(q, [x - h, 0, 0])) / (2 * h);
      expect(Math.abs(grad)).toBeLessThan(1e-5);
      // The surface through L1 encloses the donor: all its points share L1's potential.
      const sh = rocheShape(q), crit = rochePotential(q, [x, 0, 0]);
      expect(rochePotential(q, [1, sh.side, 0])).toBeCloseTo(crit, 6);
      expect(rochePotential(q, [1, 0, sh.pole])).toBeCloseTo(crit, 6);
    }
  });

  it('sizes the disc between circularization and the tidal radius', () => {
    // Frank, King & Raine eq. 4.20, and Paczyński's 0.6a/(1 + q) for 0.03 < q < 1.
    expect(circularizationRadius(0.5)).toBeCloseTo(1.5 * Math.pow(0.5 + 0.227 * Math.log10(2), 4), 9);
    for (const q of [0.1, 0.3, 0.7]) {
      expect(discTidalRadius(q)).toBeCloseTo(0.6 / (1 + q), 1);
      expect(circularizationRadius(q)).toBeLessThan(discTidalRadius(q));
    }
  });

  it('bends the stream from L1 ahead of the orbit, onto the disc’s rim', () => {
    const q = 0.5;
    const rim = discTidalRadius(q);
    const { path, end } = ballisticStream(q, rim);
    expect(path[0][0]).toBeCloseTo(l1Distance(q), 2);
    expect(end).toBeDefined();
    expect(Math.hypot(...end!)).toBeCloseTo(rim, 2);
    // The Coriolis force swings the falling gas the way the orbit turns (+y).
    expect(end![1]).toBeGreaterThan(0);
    // It stays in the orbital plane.
    for (const p of path) expect(p[2]).toBe(0);
  });
});

describe('transfer rates', () => {
  it('drives short-period systems by gravitational waves and longer ones by magnetic braking', () => {
    // J̇/J from gravitational waves falls as a⁻⁴.
    expect(gwJdotOverJ(0.8, 0.2, 0.004) / gwJdotOverJ(0.8, 0.2, 0.008)).toBeCloseTo(16, 6);
    // Below the period gap (P = 1.5 h, 0.1 M☉ donor): a few × 10⁻¹¹ M☉/yr (Knigge et al. 2011).
    const below = rocheTransferRate(0.75, 0.1, 0.0036, 0.15, 1.5 / 24, 'star');
    expect(below.driver).toMatch(/gravitational waves/);
    expect(below.rate).toBeGreaterThan(1e-11);
    expect(below.rate).toBeLessThan(1.5e-10);
    // SS Cyg (6.6 h): magnetic braking, of order 10⁻⁹.
    const ss = rocheTransferRate(0.81, 0.55, 0.00917, 0.68, 0.2751, 'star');
    expect(ss.driver).toMatch(/magnetic braking/);
    expect(ss.rate).toBeGreaterThan(1e-9);
    expect(ss.rate).toBeLessThan(3e-8);
    // A donor heavier than the white dwarf overflows on its thermal timescale (CI Aql).
    const ci = rocheTransferRate(1.0, 2.32, 0.0212, 2.0, 0.618, 'star');
    expect(ci.driver).toMatch(/thermal/);
    expect(ci.rate).toBeGreaterThan(1e-7);
    // A neutron star accreting 10⁻⁹ M☉/yr shines at about 10³⁷ erg/s; nothing beats Eddington.
    expect(accretionLuminosity(1e-9, 1.4, 'neutron', 12 / 1.496e8)).toBeGreaterThan(5e36);
    expect(accretionLuminosity(1e-9, 1.4, 'neutron', 12 / 1.496e8)).toBeLessThan(2e37);
    expect(accretionLuminosity(1e-5, 1.4, 'neutron', 12 / 1.496e8)).toBeCloseTo(1.26e38 * 1.4, -35);
  });
});

describe('real systems in the Sandbox', () => {
  it('fills SS Cyg’s donor’s Roche lobe and feeds a disc through a stream', () => {
    const sim = new Simulation();
    const o = find('SS Cyg');
    if (o.kind !== 'cv') throw new Error('kind');
    const setup = loadWhiteDwarfBinary(sim, o);
    const [wd, donor] = sim.bodies;
    const a = Math.hypot(wd.x - donor.x, wd.y - donor.y, wd.z - donor.z);
    const t = transferForAccretor(wd.name)!;
    expect(transferForDonor(donor.name)).toBe(t);
    expect(donor.radius / a).toBeCloseTo(rocheLobeRadius(donor.mass / wd.mass), 4);
    expect(t.discOuter).toBeGreaterThan(t.circularization);
    expect(t.discInner).toBeCloseTo(wd.radius / a, 6);
    expect(t.hotSpot).toBeDefined();
    expect(setup.tip).toMatch(/M☉ a year/);
    expect(setup.tip).toMatch(/hot spot/);
  });

  it('leads a polar’s gas along the field onto the white dwarf, with no disc', () => {
    const sim = new Simulation();
    const o = find('AM Her');
    if (o.kind !== 'cv') throw new Error('kind');
    const setup = loadWhiteDwarfBinary(sim, o);
    const t = transferForAccretor('AM Her')!;
    expect(t.magnetic).toBe('polar');
    expect(t.discOuter).toBe(0);
    const col = t.column!;
    // From where the stream stops to the white dwarf's surface, within 25° of the magnetic pole.
    expect(col[0]).toEqual(t.stream[t.stream.length - 1]);
    const foot = col[col.length - 1];
    expect(Math.hypot(...foot)).toBeCloseTo(t.accretorRadius, 6);
    const tilt = 25 * DEG;
    const axis = [Math.sin(tilt) * 0.5, Math.sin(tilt) * 0.87, Math.cos(tilt)];
    const n = Math.hypot(...axis);
    const cos = Math.abs(foot[0] * axis[0] + foot[1] * axis[1] + foot[2] * axis[2]) / (n * Math.hypot(...foot));
    expect(Math.acos(cos) / DEG).toBeLessThan(25);
    expect(setup.tip).toMatch(/magnetic field takes hold/);
  });

  it('gives V404 Cyg a donor that fits inside the binary, and Cyg X-1 a wind', () => {
    const sim = new Simulation();
    const v = find('V404 Cyg');
    if (v.kind !== 'lmxb') throw new Error('kind');
    loadXrayBinary(sim, v);
    const [bh, donor] = sim.bodies;
    const a = Math.hypot(bh.x - donor.x, bh.y - donor.y, bh.z - donor.z);
    expect(donor.radius / a).toBeCloseTo(rocheLobeRadius(donor.mass / bh.mass), 4);
    expect(donor.radius).toBeLessThan(a / 2);
    expect(transferForAccretor('V404 Cyg')!.discOuter).toBeGreaterThan(0.3);

    const sim2 = new Simulation();
    const c = find('Cyg X-1');
    if (c.kind !== 'hmxb') throw new Error('kind');
    expect(c.cls).toBe('sg');
    expect(xrayFeed(c)).toEqual({ mode: 'wind', fill: 0.9 });
    const setup = loadXrayBinary(sim2, c);
    const t = transferForAccretor('Cyg X-1')!;
    expect(t.mode).toBe('wind');
    // About 10³⁷ erg/s, as observed in its hard state.
    expect(t.luminosity).toBeGreaterThan(2e36);
    expect(t.luminosity).toBeLessThan(5e37);
    // Some of the wind is bent onto the black hole.
    expect(t.wind!.some((p) => Math.hypot(...p[p.length - 1]) < t.accretionRadius! * 1.01)).toBe(true);
    expect(setup.tip).toMatch(/wind/);
  });

  it('gives Be/X-ray binaries the Be star’s disc', () => {
    const be = all.find((o) => o.kind === 'hmxb' && o.cls === 'Be' && (o.ecc ?? 0) > 0.2 && o.per)!;
    if (be.kind !== 'hmxb') throw new Error('kind');
    expect(xrayFeed(be).mode).toBe('be');
    const sim = new Simulation();
    loadXrayBinary(sim, be);
    const t = transferForAccretor(be.name)!;
    expect(t.beDisc).toBeGreaterThan(t.donorRadius);
    // Inside the Be star's Roche lobe at periastron.
    expect(t.beDisc!).toBeLessThan(t.lobe * (1 - be.ecc!) + 1e-9);
  });

  it('builds a binary’s parameters directly', () => {
    const t = binaryTransfer({ accretor: 'A', donor: 'B', accretorKind: 'whitedwarf', donorKind: 'star', m1: 0.8, m2: 0.3, aAu: 0.005, periodDays: 0.15, accretorRadiusAu: 4.6e-5, mode: 'roche', magnetic: 'ip' });
    // An intermediate polar's field clears the middle of its disc.
    expect(t.discInner).toBeGreaterThan(t.accretorRadius * 1.4);
    expect(t.discInner).toBeLessThan(t.discOuter);
  });
});
