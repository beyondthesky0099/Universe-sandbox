import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { tileRect, type NebulaImageAtlas } from '../src/sim/nebulaImages';
import { parseNebulae } from '../src/sim/nebulae';

const atlas = JSON.parse(readFileSync('public/data/nebula-images.json', 'utf8')) as NebulaImageAtlas;
const nebulae = parseNebulae(JSON.parse(readFileSync('public/data/nebulae.json', 'utf8')));
const image = jpeg.decode(readFileSync('public/data/nebula-images.jpg'), { useTArray: true });

describe('nebula images (DSS via SkyView)', () => {
  it('cover every named nebula, once, at its catalogue position', () => {
    const named = nebulae.filter((n) => n.name);
    expect(atlas.images.length).toBe(named.length);
    for (const n of named) {
      const im = atlas.images.find((i) => i.name === n.name);
      expect(im, n.name).toBeDefined();
      expect(im!.kind).toBe(n.kind);
      expect(im!.l).toBeCloseTo(n.l, 3);
      expect(im!.b).toBeCloseTo(n.b, 3);
      // 2.6 catalogue radii across, within the script's limits.
      expect(im!.fieldDeg).toBeCloseTo(Math.min(12, Math.max(0.05, 2.6 * n.radiusDeg)), 3);
    }
    expect(new Set(atlas.images.map((i) => i.tile)).size).toBe(atlas.images.length);
  });

  it('the atlas holds a real, non-blank picture in every tile', () => {
    expect(image.width).toBe(atlas.cols * atlas.tile);
    expect(image.height).toBe(atlas.rows * atlas.tile);
    for (const im of atlas.images) {
      const [u, v, du, dv] = tileRect(atlas, im.tile);
      expect(u + du).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      // The tile in image rows (top-down) is the texture rectangle flipped.
      const x0 = Math.round(u * image.width), y0 = Math.round((1 - v - dv) * image.height);
      let sum = 0, max = 0;
      for (let y = y0; y < y0 + atlas.tile; y += 2) {
        for (let x = x0; x < x0 + atlas.tile; x += 2) {
          const k = (y * image.width + x) * 4;
          const lum = image.data[k] + image.data[k + 1] + image.data[k + 2];
          sum += lum;
          max = Math.max(max, lum);
        }
      }
      expect(max, im.name).toBeGreaterThan(300);
      expect(sum / (atlas.tile * atlas.tile / 4), im.name).toBeGreaterThan(5);
    }
  });

  it('shows emission nebulae red and reflection nebulae blue, as the plates record them', () => {
    const meanColour = (name: string) => {
      const im = atlas.images.find((i) => i.name === name)!;
      const col = im.tile % atlas.cols, row = Math.floor(im.tile / atlas.cols);
      let r = 0, b = 0;
      for (let y = row * atlas.tile + 64; y < row * atlas.tile + 192; y++) {
        for (let x = col * atlas.tile + 64; x < col * atlas.tile + 192; x++) {
          const k = (y * image.width + x) * 4;
          r += image.data[k];
          b += image.data[k + 2];
        }
      }
      return r / b;
    };
    // Hα glow of HII regions; starlight scattered by dust in the Iris and NGC 2023.
    for (const name of ['Rosette Nebula', 'Heart Nebula', 'Carina Nebula']) expect(meanColour(name), name).toBeGreaterThan(1.3);
    for (const name of ['Iris Nebula', 'NGC 2023']) expect(meanColour(name), name).toBeLessThan(0.9);
  });
});
