import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  beamHalfAngleDeg,
  bentAngle,
  characteristicAge,
  compactness,
  dipoleField,
  displayPeriod,
  neutronFacts,
  escapeSpeedC,
  KNOWN_PULSARS,
  knownPulsar,
  lightCylinderKm,
  meanDensity,
  periodDerivative,
  polarCapAngle,
  pulsarParams,
  spinDownPower,
  surfaceRedshift,
  surfaceTemperature,
  visibleFraction,
} from '../src/sim/neutronStar';
import { describePulsar, isMillisecond, parsePulsars, pulsarName } from '../src/sim/pulsars';
import { loadPulsarSystem, PRESETS } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';
import { EARTH_MASS } from '../src/sim/units';


const pulsars = parsePulsars(JSON.parse(readFileSync(new URL('../public/data/pulsars.json', import.meta.url), 'utf8')));

describe('neutron stars', () => {
  it('a 1.4 M☉, 12 km star is very compact', () => {
    const u = compactness(1.4);
    expect(u).toBeCloseTo(0.345, 2);
    expect(escapeSpeedC(u)).toBeCloseTo(0.59, 2);
    expect(surfaceRedshift(u)).toBeCloseTo(0.235, 2);
    // About 4 × 10¹⁷ kg/m³.
    expect(meanDensity(1.4)).toBeGreaterThan(3e17);
    expect(meanDensity(1.4)).toBeLessThan(5e17);
  });

  it('light bending shows more than half the star (Beloborodov 2002)', () => {
    expect(bentAngle(0, 0.345)).toBe(0);
    expect(bentAngle(1, 0)).toBeCloseTo(1, 9);
    expect(visibleFraction(0)).toBeCloseTo(0.5, 9);
    // u = 0.345: the limb ray comes from ψ ≈ 122°, so about 76% of the surface shows.
    expect(visibleFraction(compactness(1.4))).toBeCloseTo(0.763, 2);
    expect(visibleFraction(0.5)).toBeCloseTo(1, 9);
  });

  it('spin-down quantities match the ATNF catalogue for the Crab and Vela', () => {
    const crab = KNOWN_PULSARS['Crab Pulsar'];
    // ATNF derived values: B_surf 3.79 × 10¹² G, age 1.26 kyr, Ė 4.5 × 10³⁸ erg/s, R_LC 1,590 km.
    expect(dipoleField(crab.period, crab.pdot) / 1e12).toBeCloseTo(3.79, 1);
    expect(characteristicAge(crab.period, crab.pdot)).toBeCloseTo(1257, -1);
    expect(spinDownPower(crab.period, crab.pdot) / 1e31).toBeCloseTo(4.46, 1);
    expect(lightCylinderKm(crab.period)).toBeCloseTo(1593, -1);
    const vela = KNOWN_PULSARS['Vela Pulsar'];
    expect(dipoleField(vela.period, vela.pdot) / 1e12).toBeCloseTo(3.38, 1);
    // The field ↔ Ṗ conversion runs both ways.
    expect(periodDerivative(vela.period, dipoleField(vela.period, vela.pdot))).toBeCloseTo(vela.pdot, 20);
  });

  it('beams and polar caps narrow for slow pulsars', () => {
    expect(beamHalfAngleDeg(1)).toBeCloseTo(5.4, 9);
    expect(beamHalfAngleDeg(0.089)).toBeCloseTo(18.1, 1);
    expect(polarCapAngle(1)).toBeLessThan(polarCapAngle(0.01));
    expect((polarCapAngle(1) * 180) / Math.PI).toBeCloseTo(0.9, 1);
  });

  it('cools from a million kelvin', () => {
    expect(surfaceTemperature(1e3)).toBeGreaterThan(1e6);
    let last = Infinity;
    for (const age of [1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e9]) {
      const t = surfaceTemperature(age);
      expect(t).toBeLessThanOrEqual(last);
      last = t;
    }
    expect(surfaceTemperature(1e9)).toBe(3e4);
  });

  it('known pulsars are matched by name and agree with the bundled catalogue', () => {
    expect(knownPulsar('Lich (PSR B1257+12)')).toBe(KNOWN_PULSARS['PSR B1257+12']);
    expect(knownPulsar('Hulse–Taylor pulsar')).toBe(KNOWN_PULSARS['PSR B1913+16']);
    expect(knownPulsar('Neutron star 3')).toBeUndefined();
    for (const [name, k] of Object.entries(KNOWN_PULSARS)) {
      const row = pulsars.find((p) => [name, ...k.aliases].some((n) => n.endsWith(p.bname ?? '#') || n.endsWith(p.jname)));
      expect(row, name).toBeDefined();
      expect(row!.period).toBeCloseTo(k.period, 6);
      expect(row!.pdot / k.pdot).toBeCloseTo(1, 2);
    }
  });

  it('other neutron stars are typical newborn pulsars, the same each time', () => {
    expect(pulsarParams('Neutron star', 7)).toEqual(pulsarParams('Neutron star', 7));
    const many = Array.from({ length: 2000 }, (_, i) => pulsarParams('Neutron star', i));
    const meanP = many.reduce((s, p) => s + p.period, 0) / many.length;
    const meanLogB = many.reduce((s, p) => s + Math.log10(p.field), 0) / many.length;
    const meanCos = many.reduce((s, p) => s + Math.cos((p.obliquity * Math.PI) / 180), 0) / many.length;
    expect(meanP).toBeCloseTo(0.3, 1);
    expect(meanLogB).toBeCloseTo(12.65, 1);
    // An isotropic tilt: cos α uniform on 0…1.
    expect(meanCos).toBeCloseTo(0.5, 1);
    expect(many.every((p) => p.period >= 0.01 && !p.real)).toBe(true);
    expect(displayPeriod(0.005)).toBe(0.25);
    expect(displayPeriod(1.2)).toBe(1.2);
  });

  it('the info panel lists its facts', () => {
    const facts = Object.fromEntries(neutronFacts({ name: 'Vela Pulsar', id: 1, mass: 1.4 }));
    expect(facts['Spin period']).toMatch(/^89\.3 ms \(11 turns a second\), shown slowed/);
    expect(facts['Magnetic field']).toMatch(/^3\.4 × 10¹² G/);
    expect(facts['Visible at once']).toMatch(/^76%/);
    expect(facts['Pulsar']).toMatch(/ATNF/);
  });
});

describe('the ATNF pulsar catalogue', () => {
  it('has the Milky Way pulsars with periods and distances', () => {
    expect(pulsars.length).toBeGreaterThan(3000);
    expect(pulsars.every((p) => p.period > 0.001 && p.period < 100 && p.distanceKpc > 0 && p.distanceKpc < 60)).toBe(true);
    const crab = pulsars.find((p) => p.bname === 'B0531+21')!;
    expect(crab.snr).toBe('Crab');
    expect(pulsarName(crab)).toBe('PSR B0531+21');
    expect(describePulsar(crab)).toBe("pulsar · spins every 33.4 ms · field 3.8 × 10¹² G · 1,257 years old · in the Crab remnant");
    const j0437 = pulsars.find((p) => p.jname === 'J0437-4715')!;
    expect(isMillisecond(j0437)).toBe(true);
    expect(j0437.binary).toBe(true);
    expect(pulsars.filter((p) => p.magnetar).length).toBeGreaterThan(5);
    expect(pulsars.filter((p) => isMillisecond(p)).length).toBeGreaterThan(300);
  });
});

describe('Pulsar Planets preset', () => {
  it('puts the three planets of PSR B1257+12 on their measured orbits, and they stay there', () => {
    const sim = new Simulation();
    PRESETS.find((p) => p.id === 'pulsar-planets')!.load(sim);
    const lich = sim.bodies.find((b) => b.kind === 'neutron')!;
    expect(pulsarParams(lich.name, lich.id).real).toBe(true);
    const dist = (name: string) => {
      const b = sim.bodies.find((x) => x.name === name)!;
      return Math.hypot(b.x - lich.x, b.y - lich.y, b.z - lich.z);
    };
    expect(dist('Draugr')).toBeCloseTo(0.19, 2);
    expect(dist('Poltergeist')).toBeCloseTo(0.36, 1);
    expect(dist('Phobetor')).toBeCloseTo(0.46, 1);
    expect(sim.bodies.find((x) => x.name === 'Poltergeist')!.mass / EARTH_MASS).toBeCloseTo(4.3, 6);
    sim.advance(1, 1e6, 1e9);
    expect(sim.bodies.length).toBe(4);
    expect(dist('Draugr')).toBeCloseTo(0.19, 2);
    expect(dist('Phobetor')).toBeGreaterThan(0.44);
    expect(dist('Phobetor')).toBeLessThan(0.48);
  });
});

describe('tides around compact stars', () => {
  it('use the planet’s true density, not its enlarged radius', () => {
    const sim = new Simulation();
    const ns = sim.addBody({ name: 'NS', kind: 'neutron', mass: 1.4 });
    const earth = sim.addBody({ name: 'Rock', kind: 'rocky', mass: EARTH_MASS, x: 1 });
    // (3M / 4πρ)^⅓ for 1.4 M☉ and 5.5 g/cm³: about 4.9 × 10⁵ km.
    expect(sim.rocheLimit(ns, earth) * 1.496e8).toBeCloseTo(4.9e5, -4);
    // Stars are still torn apart before they touch a black hole.
    const bh = sim.addBody({ name: 'BH', kind: 'blackhole', mass: 1000 });
    const star = sim.addBody({ name: 'Star', kind: 'star', mass: 1, x: 3 });
    expect(sim.rocheLimit(bh, star)).toBeGreaterThan(bh.radius + star.radius);
  });
});

describe('visiting a catalogue pulsar', () => {
  const find = (j: string) => pulsars.find((p) => p.jname === j)!;
  it('a lone pulsar spins at its catalogued rate', () => {
    const sim = new Simulation();
    const crab = find('J0534+2200');
    loadPulsarSystem(sim, crab);
    expect(sim.bodies).toHaveLength(1);
    const p = pulsarParams(sim.bodies[0].name, sim.bodies[0].id);
    expect(p.real).toBe(true);
    expect(p.period).toBeCloseTo(0.033392, 6);
  });

  it('a millisecond pulsar keeps its white dwarf on the catalogued orbit, at real sizes', () => {
    const sim = new Simulation();
    const psr = find('J0437-4715');
    expect(psr.pbDays).toBeCloseTo(5.741, 3);
    loadPulsarSystem(sim, psr);
    expect(sim.trueScale).toBe(true);
    const [ns, wd] = sim.bodies;
    expect(wd.kind).toBe('whitedwarf');
    const r0 = Math.hypot(wd.x - ns.x, wd.y - ns.y, wd.z - ns.z);
    // a = (P² M)^⅓ ≈ 0.077 AU for 5.74 days and 1.56 M☉.
    expect(r0).toBeCloseTo(0.077, 2);
    sim.advance((5 * psr.pbDays) / 365.25, 1e6, 1e9);
    expect(sim.bodies).toHaveLength(2);
    expect(Math.hypot(wd.x - ns.x, wd.y - ns.y, wd.z - ns.z)).toBeCloseTo(0.077, 2);
  });

  it('the Double Pulsar is two neutron stars, both pulsars', () => {
    const sim = new Simulation();
    loadPulsarSystem(sim, find('J0737-3039A'));
    expect(sim.bodies.map((b) => b.kind)).toEqual(['neutron', 'neutron']);
    expect(sim.relativity).toBe(true);
    expect(pulsarParams(sim.bodies[1].name, sim.bodies[1].id).period).toBeCloseTo(2.773, 3);
  });
});
