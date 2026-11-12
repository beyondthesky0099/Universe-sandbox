import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { galaxyCentre, galaxyLook, galaxyOrientation, galaxyRadius, galacticUnit, skyBasis, type Vec3 } from '../src/sim/galaxyLook';
import { galacticToCosmos, type LocalGalaxy } from '../src/sim/galaxies';

const local: LocalGalaxy[] = JSON.parse(readFileSync(new URL('../public/data/galaxies-local.json', import.meta.url), 'utf8')).galaxies;
const byName = (n: string) => local.find((g) => g.name === n)!;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(...a);
const deg = (x: number) => (x * 180) / Math.PI;

describe('how real galaxies sit on the sky', () => {
  it('has a sky basis that is orthonormal, with north toward the celestial pole', () => {
    const { los, north, east } = skyBasis(121.17, -21.57); // M31
    for (const v of [los, north, east]) expect(len(v)).toBeCloseTo(1, 9);
    expect(dot(los, north)).toBeCloseTo(0, 9);
    expect(dot(los, east)).toBeCloseTo(0, 9);
    expect(dot(north, east)).toBeCloseTo(0, 9);
    // Moving north from M31 gets closer to the pole.
    const pole = galacticUnit(122.93192, 27.12825);
    expect(dot(north, pole)).toBeGreaterThan(0);
  });

  it('tilts Andromeda by its measured inclination and position angle', () => {
    const m31 = byName('MESSIER031');
    expect(m31.pa).toBe(35); // HyperLEDA
    expect(m31.inc).toBe(78);
    const o = galaxyOrientation(m31);
    expect(o.measuredInclination).toBe(true);
    expect(o.measuredPositionAngle).toBe(true);
    // Line of sight in map coordinates.
    const los = galacticToCosmos(m31.l, m31.b, 1);
    // The disc axis makes the inclination angle with the line of sight.
    expect(deg(Math.acos(Math.abs(dot(o.normal, los))))).toBeCloseTo(78, 5);
    // The major axis lies across the sky and in the disc.
    expect(dot(o.major, los)).toBeCloseTo(0, 9);
    expect(dot(o.major, o.normal)).toBeCloseTo(0, 9);
    // It points 35° from north toward east: the sky basis says the same in map coordinates.
    const { north, east } = skyBasis(m31.l, m31.b);
    const northMap: Vec3 = [north[0], north[2], -north[1]];
    const eastMap: Vec3 = [east[0], east[2], -east[1]];
    expect(deg(Math.atan2(dot(o.major, eastMap), dot(o.major, northMap)))).toBeCloseTo(35, 5);
  });

  it('keeps the Milky Way flat in the map plane with its centre 8.2 kpc from the Sun', () => {
    const mw = byName('Milky Way');
    expect(galaxyOrientation(mw).normal).toEqual([0, 1, 0]);
    const c = galaxyCentre(mw);
    expect(len(c)).toBeCloseTo(0.0082, 6);
    expect(c[0]).toBeGreaterThan(0); // toward l = 0
    expect(galaxyRadius(mw)).toBeCloseTo(0.015, 6);
  });

  it('is stable: the same galaxy gets the same seeded choices every time', () => {
    const g = byName('Sag dSph');
    expect(galaxyOrientation(g)).toEqual(galaxyOrientation(g));
    expect(galaxyLook(g)).toEqual(galaxyLook(g));
  });

  it('gives most Local Volume galaxies a measured position angle', () => {
    const measured = local.filter((g) => g.pa !== undefined).length;
    expect(measured).toBeGreaterThan(local.length * 0.45);
    // An unmeasured one is still oriented, but says so.
    const o = galaxyOrientation({ name: 'test', l: 10, b: 20, d: 1 });
    expect(o.measuredPositionAngle).toBe(false);
    expect(o.measuredInclination).toBe(false);
    expect(len(o.normal)).toBeCloseTo(1, 9);
  });

  it('shapes galaxies by their type', () => {
    const m31 = galaxyLook(byName('MESSIER031'));
    expect(m31.form).toBe(0);
    expect(m31.arms).toBe(2);
    expect(m31.dust).toBeGreaterThan(0.5);
    const m32 = galaxyLook(byName('MESSIER032'));
    expect(m32.form).toBe(2);
    expect(m32.dust).toBe(0);
    expect(m32.armContrast).toBe(0);
    const lmc = galaxyLook(byName('LMC'));
    expect(lmc.form).toBe(3);
    expect(lmc.blue).toBeGreaterThan(m31.blue);
    // Late-type spirals are bluer with smaller bulges and more open arms than early ones.
    const early = galaxyLook({ name: 'Sa', l: 0, b: 0, d: 1, t: 1 });
    const late = galaxyLook({ name: 'Sd', l: 0, b: 0, d: 1, t: 7 });
    expect(late.blue).toBeGreaterThan(early.blue);
    expect(late.bulgeWeight).toBeLessThan(early.bulgeWeight);
    expect(Math.abs(late.pitch)).toBeGreaterThan(Math.abs(early.pitch));
    // Surface brightness follows luminosity over area, within the visible range.
    for (const g of local) {
      const sb = galaxyLook(g).surfaceBrightness;
      expect(sb).toBeGreaterThanOrEqual(0.35);
      expect(sb).toBeLessThanOrEqual(1.8);
    }
  });
});
