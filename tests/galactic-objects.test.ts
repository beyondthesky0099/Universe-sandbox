import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cepheidLuminosity,
  cepheidMass,
  cepheidRadius,
  cvTypeLabel,
  describeObject,
  flattenObjects,
  novaSpeedClass,
  objectFacts,
  objectKindLabel,
  whiteDwarfMasses,
  whiteDwarfPeriodDays,
  xrayMasses,
  xrayPeriodDays,
  type GalacticObject,
  type GalacticObjects,
} from '../src/sim/galacticObjects';
import { loadCepheid, loadGalacticObject, loadMaser, loadWhiteDwarfBinary, loadWolfRayet, loadXrayBinary } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';

const data: GalacticObjects = JSON.parse(readFileSync(new URL('../public/data/galactic-objects.json', import.meta.url), 'utf8'));
const all = flattenObjects(data);
const find = (re: RegExp, kind?: GalacticObject['kind']) => all.find((o) => (!kind || o.kind === kind) && re.test(o.name))!;
const xray = (re: RegExp) => {
  const o = find(re);
  if (o.kind !== 'hmxb' && o.kind !== 'lmxb') throw new Error(`${o.name} is not an X-ray binary`);
  return o;
};

describe('X-ray binaries and Wolf–Rayet stars with measured distances', () => {
  it('has the famous systems at their Gaia distances', () => {
    expect(data.hmxb.length).toBeGreaterThan(90);
    expect(data.lmxb.length).toBeGreaterThan(180);
    expect(data.wr.length).toBeGreaterThan(200);
    const cyg = xray(/^Cyg X-1$/);
    expect(cyg.kind).toBe('hmxb');
    expect(cyg.compact).toBe('BH');
    expect(cyg.d).toBeGreaterThan(1.8); // kpc: Miller-Jones et al. 2021 found 2.2
    expect(cyg.d).toBeLessThan(2.5);
    expect(cyg.per).toBeCloseTo(5.6, 1); // days
    expect(cyg.mx).toBeGreaterThan(15);
    const sco = xray(/^Sco X-1/);
    expect(sco.kind).toBe('lmxb');
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
    const cyg = xray(/^Cyg X-1$/);
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
    const cyg = xray(/^Cyg X-1$/);
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

describe('novae and cataclysmic variables', () => {
  it('has every known Galactic nova (Schaefer 2022) and the Gaia cataclysmic variables', () => {
    expect(data.nova.length).toBeGreaterThanOrEqual(400);
    expect(data.cv.length).toBeGreaterThan(1400);
    // T Coronae Borealis: the recurrent nova due again, 227.5-day orbit, about 900 pc.
    const tcrb = find(/^T CrB$/, 'nova');
    if (tcrb.kind !== 'nova') throw new Error('kind');
    expect(tcrb.recurrent).toBe(true);
    expect(tcrb.per).toBeCloseTo(227.5, 0);
    expect(tcrb.d).toBeGreaterThan(0.85);
    expect(tcrb.d).toBeLessThan(1.0);
    expect(objectKindLabel(tcrb)).toBe('recurrent nova');
    expect(describeObject(tcrb)).toMatch(/recurrent nova.*red giant every 228 days/);
    // GK Persei (Nova Persei 1901): the Ritter & Kolb masses and the intermediate-polar type come along.
    const gk = find(/^GK Per$/, 'nova');
    if (gk.kind !== 'nova') throw new Error('kind');
    expect(Math.floor(gk.year!)).toBe(1901);
    expect(gk.types).toContain('IP');
    expect(gk.m1).toBeCloseTo(0.87, 2);
    expect(gk.d).toBeCloseTo(0.43, 1);
    expect(objectKindLabel(gk)).toBe('classical nova of 1901');
    expect(describeObject(gk)).toContain('erupted in 1901');
    expect(describeObject(gk)).toContain('Neon');
    expect(objectFacts(gk).find(([k]) => k === 'Speed')![1]).toBe('fast (t₃ = 13 days)');
    // The novae are not repeated in the cataclysmic-variable list.
    expect(data.cv.some((o) => o.name === 'GK Per' || o.name === 'V1500 Cyg')).toBe(false);
    // SS Cygni: the brightest dwarf nova, 6.6-hour orbit, 112 pc.
    const ss = find(/^SS Cyg$/, 'cv');
    if (ss.kind !== 'cv') throw new Error('kind');
    expect(ss.types).toContain('DN');
    expect(ss.per! * 24).toBeCloseTo(6.6, 1);
    expect(ss.d).toBeGreaterThan(0.1);
    expect(ss.d).toBeLessThan(0.13);
    expect(cvTypeLabel(ss)).toBe('dwarf nova, U Gem star');
    expect(describeObject(ss)).toMatch(/^A dwarf nova: a white dwarf of 0\.81 M☉ pulling a stream of gas from a red dwarf \(K4-5\) every 6\.60 hours/);
    // AM Herculis: the prototype polar.
    const am = find(/^AM Her$/, 'cv');
    if (am.kind !== 'cv') throw new Error('kind');
    expect(am.magnetic).toBe(true);
    expect(cvTypeLabel(am)).toBe('polar, nova-like variable');
    expect(describeObject(am)).toContain('funnels the gas onto its magnetic poles');
  });

  it('fills in typical masses and periods, and classifies nova speeds', () => {
    const bare = { kind: 'cv' as const, name: 'X', l: 0, b: 0, d: 1 };
    const m = whiteDwarfMasses(bare);
    expect(m.wd).toBe(0.8);
    expect(m.donorKind).toBe('star');
    expect(m.assumed).toEqual(['the white dwarf mass', 'the donor mass']);
    expect(whiteDwarfPeriodDays(bare)).toEqual({ days: 4 / 24, assumed: true });
    // Knigge's donor sequence: a 4-hour orbit holds a 0.37 M☉ red dwarf, a 90-minute one 0.1 M☉.
    expect(whiteDwarfMasses({ ...bare, per: 4 / 24 }).donor).toBeCloseTo(0.37, 1);
    expect(whiteDwarfMasses({ ...bare, per: 1.5 / 24 }).donor).toBeCloseTo(0.1, 1);
    // A recurrent nova's white dwarf is near the Chandrasekhar limit; a giant donor for a year-long orbit.
    const rn = whiteDwarfMasses({ kind: 'nova', name: 'RN', l: 0, b: 0, d: 1, recurrent: true, per: 453, prop: 'RG' });
    expect(rn.wd).toBe(1.35);
    expect(rn.donorKind).toBe('giant');
    expect(novaSpeedClass(4)).toBe('very fast');
    expect(novaSpeedClass(13)).toBe('fast');
    expect(novaSpeedClass(100)).toBe('slow');
    expect(novaSpeedClass(300)).toBe('very slow');
  });

  it('builds SS Cyg in the Sandbox: a white dwarf with a disc and its red dwarf on the 6.6-hour orbit', () => {
    const sim = new Simulation();
    const ss = find(/^SS Cyg$/, 'cv');
    if (ss.kind !== 'cv') throw new Error('kind');
    const setup = loadWhiteDwarfBinary(sim, ss);
    expect(sim.bodies.length).toBe(2);
    const wd = sim.bodies.find((b) => b.kind === 'whitedwarf')!;
    const star = sim.bodies.find((b) => b.kind === 'star')!;
    expect(wd.mass).toBeCloseTo(0.81, 2);
    expect(wd.tag).toBe('accreting');
    expect(star.mass).toBeCloseTo(0.55, 2);
    const years = ss.per! / 365.25;
    const a = Math.cbrt(years * years * (0.81 + 0.55));
    const sep = Math.hypot(wd.x - star.x, wd.y - star.y, wd.z - star.z);
    expect(sep).toBeCloseTo(a, 4);
    expect(setup.tip).toContain('dwarf nova');
    expect(setup.tip).not.toContain('typical values');
    // A polar has no disc.
    const sim2 = new Simulation();
    const am = find(/^AM Her$/, 'cv');
    if (am.kind !== 'cv') throw new Error('kind');
    loadWhiteDwarfBinary(sim2, am);
    expect(sim2.bodies.find((b) => b.kind === 'whitedwarf')!.tag).toBe('magnetic');
    // An unknown system says what was assumed.
    const sim3 = new Simulation();
    const tip = loadWhiteDwarfBinary(sim3, { kind: 'cv', name: 'X', l: 0, b: 0, d: 1 }).tip!;
    expect(tip).toContain('typical values are shown for the white dwarf mass, the donor mass, the orbit');
  });
});

describe('classical Cepheids', () => {
  it('has the Milky Way Cepheids with period–luminosity distances, Delta Cephei and Polaris among them', () => {
    expect(data.cep.length).toBeGreaterThan(2000);
    const delta = find(/^δ Cep$/, 'cep');
    if (delta.kind !== 'cep') throw new Error('kind');
    expect(delta.common).toBe('Delta Cephei');
    expect(delta.per).toBeCloseTo(5.366, 2);
    expect(delta.mode).toBe('F');
    expect(delta.d).toBeGreaterThan(0.25);
    expect(delta.d).toBeLessThan(0.29);
    // Its luminosity from the Benedict et al. relation: about 2,000 Suns, radius about 45 R☉.
    expect(cepheidLuminosity(delta.per)).toBeGreaterThan(1700);
    expect(cepheidLuminosity(delta.per)).toBeLessThan(2300);
    expect(cepheidRadius(delta.per)).toBeGreaterThan(38);
    expect(cepheidRadius(delta.per)).toBeLessThan(50);
    // 106 Myr old: the star whose main-sequence life just ended is about 6 M☉.
    expect(cepheidMass(delta)).toBeCloseTo(6.2, 0);
    expect(describeObject(delta)).toMatch(/A classical Cepheid \(Delta Cephei\): a yellow supergiant of about 6 M☉ that swells and shrinks every 5\.37 days/);
    const polaris = find(/^α UMi$/, 'cep');
    if (polaris.kind !== 'cep') throw new Error('kind');
    expect(polaris.common).toBe('Polaris');
    expect(polaris.mode).toBe('1O');
    expect(polaris.d).toBeCloseTo(0.137, 3);
    expect(objectFacts(polaris).find(([k]) => k === 'Source')![1]).toContain('Bond');
    // Every Cepheid has a period between a quarter of a day and about 70 days.
    for (const o of data.cep) {
      expect(o.per).toBeGreaterThan(0.2);
      expect(o.per).toBeLessThan(80);
    }
  });

  it('builds Delta Cephei as a pulsing yellow supergiant', () => {
    const sim = new Simulation();
    const delta = find(/^δ Cep$/, 'cep');
    if (delta.kind !== 'cep') throw new Error('kind');
    const setup = loadCepheid(sim, delta);
    expect(sim.bodies.length).toBe(1);
    expect(sim.bodies[0].kind).toBe('giant');
    expect(sim.bodies[0].tag).toBe('cepheid:5.3663');
    expect(sim.bodies[0].mass).toBeCloseTo(6.2, 0);
    // One pulse takes about four seconds at the scene's speed.
    expect(setup.timeScale * 4 * 365.25).toBeCloseTo(delta.per, 3);
  });
});

describe('masers', () => {
  it('has the BeSSeL/VERA parallaxes: W49 N in the Perseus arm at 11 kpc, Orion at 410 pc', () => {
    expect(data.maser.length).toBeGreaterThan(190);
    const w49 = find(/^W49 N$/, 'maser');
    if (w49.kind !== 'maser') throw new Error('kind');
    expect(w49.d).toBeCloseTo(11.1, 0);
    expect(w49.arm).toBe('Per');
    expect(describeObject(w49)).toContain('in the Perseus arm');
    expect(objectFacts(w49).find(([k]) => k === 'Spiral arm')![1]).toBe('Perseus arm');
    const orion = find(/^Orion KL$/, 'maser');
    if (orion.kind !== 'maser') throw new Error('kind');
    expect(orion.d).toBeCloseTo(0.41, 1);
    expect(orion.ed! / orion.d).toBeLessThan(0.02);
    const vy = find(/^VY CMa$/, 'maser');
    if (vy.kind !== 'maser') throw new Error('kind');
    expect(vy.evolved).toBe(true);
    expect(objectKindLabel(vy)).toBe('maser around a red supergiant');
    // Distinct names for the spots that share a region.
    expect(new Set(data.maser.map((o) => o.name)).size).toBe(data.maser.length);
  });

  it('builds a star-forming region (protostar with its gas disc and young neighbours) or a red supergiant', () => {
    const sim = new Simulation();
    const w49 = find(/^W49 N$/, 'maser');
    if (w49.kind !== 'maser') throw new Error('kind');
    const setup = loadMaser(sim, w49);
    expect(sim.bodies.length).toBe(7);
    expect(sim.bodies[0].mass).toBe(20);
    expect(sim.formation?.starId).toBe(sim.bodies[0].id);
    expect(setup.tip).toContain('illustrative, not measured');
    const sim2 = new Simulation();
    const vy = find(/^VY CMa$/, 'maser');
    if (vy.kind !== 'maser') throw new Error('kind');
    loadMaser(sim2, vy);
    expect(sim2.bodies.length).toBe(1);
    expect(sim2.bodies[0].kind).toBe('giant');
  });

  it('opens any kind from the Galaxy Map', () => {
    for (const re of [/^Cyg X-1$/, /^WR 140$/, /^T CrB$/, /^SS Cyg$/, /^δ Cep$/, /^W49 N$/]) {
      const sim = new Simulation();
      const setup = loadGalacticObject(sim, find(re));
      expect(sim.bodies.length).toBeGreaterThan(0);
      expect(setup.tip).toBeTruthy();
    }
  });
});
