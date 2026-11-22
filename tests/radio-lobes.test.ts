import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { angularDiameterDistance, comovingDistance, luminosityDistance } from '../src/sim/cosmology';
import type { LocalGalaxy } from '../src/sim/galaxies';
import { lobeBasis, lobeHost, lobeSizeKpc, lobeTileRect, type RadioLobeAtlas } from '../src/sim/radioLobes';

const atlas: RadioLobeAtlas = JSON.parse(readFileSync(new URL('../public/data/radio-lobes.json', import.meta.url), 'utf8'));
const local: LocalGalaxy[] = JSON.parse(readFileSync(new URL('../public/data/galaxies-local.json', import.meta.url), 'utf8')).galaxies;
const lobe = (prefix: string) => atlas.lobes.find((l) => l.name.startsWith(prefix))!;
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

describe('radio lobes of nearby radio galaxies', () => {
  it('bundles resolved pictures of the famous ones with unique atlas tiles', () => {
    expect(atlas.lobes.length).toBeGreaterThanOrEqual(35);
    expect(new Set(atlas.lobes.map((l) => l.tile)).size).toBe(atlas.lobes.length);
    for (const l of atlas.lobes) {
      expect(l.tile).toBeLessThan(atlas.cols * atlas.rows);
      expect(l.lasDeg).toBeGreaterThan(0);
      expect(l.lasDeg).toBeLessThanOrEqual(l.fieldDeg);
      expect(l.z).toBeGreaterThan(0);
      expect(l.z).toBeLessThan(0.2);
    }
    // Cygnus A: the classic FR II, lobes about 2.2′ apart (Perley, Dreher & Cowan 1984).
    const cyg = lobe('Cygnus A');
    expect(cyg.fr).toBe('II');
    expect(cyg.survey).toMatch(/NVSS/);
    expect(cyg.lasDeg * 60).toBeGreaterThan(2);
    expect(cyg.lasDeg * 60).toBeLessThan(3.5);
    // Its lobes lie along the jet, at position angle 105° east of north. Galactic north points at
    // position angle −58.8° there, so in the picture the axis is at 105° + 58.8° = 163.8°.
    const off = ((cyg.paGal - 163.8) % 180 + 270) % 180 - 90;
    expect(Math.abs(off)).toBeLessThan(10);
    // Centaurus A's lobes span about 8°, from the low-frequency survey and a published size.
    const cen = lobe('Centaurus A');
    expect(cen.survey).toMatch(/GLEAM/);
    expect(cen.sizeRef).toMatch(/Junkes/);
    expect(cen.lasDeg).toBeCloseTo(8, 0);
    // M87's halo is about 10′ across in NVSS (Owen, Eilek & Kassim 2000: 14′ at 327 MHz).
    expect(lobe('3C 274').lasDeg * 60).toBeGreaterThan(7);
    expect(lobe('3C 274').lasDeg * 60).toBeLessThan(15);
  });

  it('turns angles into kiloparsecs with the angular-diameter distance', () => {
    expect(angularDiameterDistance(0.5) * luminosityDistance(0.5)).toBeCloseTo(comovingDistance(0.5) ** 2, 6);
    // Cygnus A spans roughly 140–200 kpc (H0 = 70).
    const cyg = lobeSizeKpc(lobe('Cygnus A'));
    expect(cyg).toBeGreaterThan(120);
    expect(cyg).toBeLessThan(220);
    // Centaurus A at 3.8 Mpc: about 530 kpc of lobes, two thirds of the way from the Milky Way to M31.
    const cen = lobeSizeKpc(lobe('Centaurus A'), 3.8);
    expect(cen).toBeGreaterThan(450);
    expect(cen).toBeLessThan(600);
  });

  it('lays the pictures out as seen from the Milky Way', () => {
    for (const [l, b] of [[0, 0], [76.19, 5.76], [309.5, 19.4], [283.8, 74.5], [120, -60]]) {
      const { up, right, los } = lobeBasis(l, b);
      for (const v of [up, right, los]) expect(Math.hypot(...v)).toBeCloseTo(1, 9);
      expect(dot(up, right)).toBeCloseTo(0, 9);
      expect(dot(up, los)).toBeCloseTo(0, 9);
      expect(dot(right, los)).toBeCloseTo(0, 9);
      // A camera looking out along los sees right × up pointing back at itself.
      const c = cross(right, up);
      for (let a = 0; a < 3; a++) expect(c[a]).toBeCloseTo(-los[a], 9);
    }
    // At the Galactic Centre, up is galactic north (scene +y) and right is towards l = 270°.
    const gc = lobeBasis(0, 0);
    expect(gc.up[1]).toBeCloseTo(1, 9);
    const l270 = lobeBasis(270, 0).los;
    expect(dot(gc.right, l270)).toBeCloseTo(1, 9);
  });

  it('finds atlas tiles and host galaxies', () => {
    expect(lobeTileRect({ cols: 8, rows: 5 }, 0)).toEqual([0, 0.8, 0.125, 0.2]);
    const r = lobeTileRect({ cols: 8, rows: 5 }, 9);
    expect(r[0]).toBeCloseTo(0.125, 12);
    expect(r[1]).toBeCloseTo(0.6, 12);
    expect(lobeHost(lobe('Centaurus A'), local)?.name).toMatch(/Centaurus|5128/);
    expect(lobeHost({ l: 10, b: -89 }, local)).toBeUndefined();
  });
});
