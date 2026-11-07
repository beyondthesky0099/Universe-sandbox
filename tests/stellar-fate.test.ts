import { describe, expect, it } from 'vitest';
import { stellarFate, typeIaNickel } from '../src/sim/stellarFate';
import { ejectaLayers, hasPlateau, L_SUN, luminosity, maxEjectaSpeed, peakLuminosity, plateau } from '../src/sim/supernovaPhysics';
import { Simulation } from '../src/sim/simulation';

const peakDay = (f: ReturnType<typeof stellarFate>, span = 600) => {
  let best = 0, day = 0;
  for (let d = 1; d < span; d += 1) {
    const l = luminosity(f.explosion, d);
    if (l > best) [best, day] = [l, d];
  }
  return day;
};
const element = (f: ReturnType<typeof stellarFate>, name: string) => ejectaLayers(f.explosion).find((l) => l.element === name)?.mass ?? 0;

describe('how a star dies depends on its mass and metallicity', () => {
  it('8–9.5 M☉: a faint electron-capture supernova and a light neutron star (like SN 1054, the Crab)', () => {
    const f = stellarFate(8.8);
    expect(f.kind).toBe('ECSN');
    expect(f.explosion.energy).toBeLessThan(2e50);
    expect(f.remnant).toEqual({ kind: 'neutron', mass: 1.25 });
  });

  it('15 M☉, solar: a red supergiant (~3,500 K, 500–1,200 R☉) → Type II-P, ~100-day plateau, neutron star', () => {
    const f = stellarFate(15);
    expect(f.kind).toBe('II-P');
    expect(f.progenitor.stage).toBe('red supergiant');
    expect(f.progenitor.temperatureK).toBeCloseTo(3500, -2);
    expect(f.progenitor.radiusRsun).toBeGreaterThan(500);
    expect(f.progenitor.radiusRsun).toBeLessThan(1200);
    expect(hasPlateau(f.explosion)).toBe(true);
    expect(plateau(f.explosion).days).toBeGreaterThan(80);
    expect(plateau(f.explosion).days).toBeLessThan(150);
    expect(f.remnant?.kind).toBe('neutron');
    expect(element(f, 'hydrogen')).toBeGreaterThan(5);
  });

  it('20 M☉ at half solar metallicity: a blue supergiant (~40 R☉) whose plateau is fainter, as in SN 1987A', () => {
    const blue = stellarFate(20, 0.5);
    const red = stellarFate(20, 1);
    expect(blue.progenitor.stage).toBe('blue supergiant');
    expect(blue.progenitor.radiusRsun).toBeGreaterThan(20);
    expect(blue.progenitor.radiusRsun).toBeLessThan(90);
    expect(red.progenitor.stage).not.toBe('blue supergiant');
    // L_plateau ∝ R^(2/3): a compact progenitor gives a dimmer plateau (SN 1987A peaked near −15.5).
    expect(plateau(blue.explosion).luminosity).toBeLessThan(plateau(red.explosion).luminosity * 0.5);
  });

  it('metal-rich stars lose their envelopes to winds: 30 M☉ is a Type Ib at solar metallicity but keeps its hydrogen at 0.3 solar', () => {
    const rich = stellarFate(30, 1);
    const poor = stellarFate(30, 0.3);
    expect(rich.kind).toBe('Ib');
    expect(rich.progenitor.stage).toMatch(/Wolf–Rayet/);
    expect(rich.progenitor.temperatureK).toBeGreaterThan(40000);
    expect(element(rich, 'hydrogen')).toBe(0);
    expect(element(rich, 'helium')).toBeGreaterThan(0.5);
    expect(hasPlateau(rich.explosion)).toBe(false);
    expect(poor.kind.startsWith('II')).toBe(true);
    expect(element(poor, 'hydrogen')).toBeGreaterThan(5);
  });

  it('stripped explosions peak in 2–4 weeks; Type Ic stars lost their helium too, and the most massive make hypernovae', () => {
    const ib = stellarFate(30), ic = stellarFate(45), bl = stellarFate(60);
    expect(peakDay(ib)).toBeGreaterThan(8);
    expect(peakDay(ib)).toBeLessThan(35);
    expect(ic.kind).toBe('Ic');
    expect(element(ic, 'helium')).toBeLessThan(element(ib, 'helium'));
    expect(bl.kind).toBe('Ic-BL');
    expect(bl.explosion.energy).toBeGreaterThanOrEqual(1e52);
    expect(maxEjectaSpeed(bl.explosion)).toBeGreaterThan(20000); // "broad lines": > 20,000 km/s
    expect(ic.remnant?.kind).toBe('blackhole');
  });

  it('60 M☉ metal-poor star: no supernova — it collapses into a black hole with only a faint red glow', () => {
    const f = stellarFate(60, 0.1);
    expect(f.kind).toBe('failed');
    expect(f.remnant?.kind).toBe('blackhole');
    expect(f.remnant!.mass).toBeGreaterThan(40);
    expect(peakLuminosity(f.explosion)).toBeLessThan(1e41); // vs ~10⁴² for a supernova
  });

  it('pair instability: 200 M☉ at low metallicity is blown apart completely — tens of M☉ of ⁵⁶Ni, superluminous, slow', () => {
    const f = stellarFate(200, 0.05);
    expect(f.kind).toBe('PISN');
    expect(f.remnant).toBeUndefined();
    expect(f.explosion.nickelMass).toBeGreaterThan(10);
    expect(peakLuminosity(f.explosion) / L_SUN).toBeGreaterThan(1e10);
    expect(peakDay(f)).toBeGreaterThan(100);
    // At solar metallicity winds stop it: no pair instability.
    expect(stellarFate(200, 1).kind).not.toBe('PISN');
  });

  it('pulsational pair instability (~120 M☉, low Z): bright colliding shells, then a black hole below the ~45 M☉ mass gap', () => {
    const f = stellarFate(120, 0.05);
    expect(f.kind).toBe('PPISN');
    expect(f.remnant!.mass).toBeLessThanOrEqual(45);
    expect(luminosity(f.explosion, 60)).toBeGreaterThan(1e43);
  });

  it('Type Ia: metal-rich white dwarfs make less ⁵⁶Ni (Timmes et al. 2003)', () => {
    expect(typeIaNickel(3)).toBeLessThan(typeIaNickel(0.1));
    expect(typeIaNickel(1)).toBeCloseTo(0.566, 2);
  });

  it('the simulation uses it: same mass, different metallicity, different supernova and remnant', () => {
    const sim = new Simulation();
    const rich = sim.addBody({ name: 'Rich', kind: 'star', mass: 26, metallicity: 1 });
    const poor = sim.addBody({ name: 'Poor', kind: 'star', mass: 60, metallicity: 0.1, x: 1e5 });
    sim.supernova(rich);
    sim.supernova(poor);
    const [a, b] = sim.shockwaves.map((w) => w.explosion!);
    expect(a.subtype).toBe('Ib');
    expect(b.subtype).toBe('failed');
    expect(rich.kind).toBe('neutron');
    expect(poor.kind).toBe('blackhole');
    expect(sim.events.some((e) => /Type Ib/.test(e.message) && /Wolf–Rayet/.test(e.message))).toBe(true);
    expect(sim.events.some((e) => /failed supernova/.test(e.message))).toBe(true);
  });
});
