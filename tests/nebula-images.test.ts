import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { nebulaKey, tileRect, type NebulaImageAtlas } from '../src/sim/nebulaImages';
import { parseNebulae } from '../src/sim/nebulae';

const atlas = JSON.parse(readFileSync('public/data/nebula-images.json', 'utf8')) as NebulaImageAtlas;
const nebulae = parseNebulae(JSON.parse(readFileSync('public/data/nebulae.json', 'utf8')));
const pages = atlas.pages.map((p) => jpeg.decode(readFileSync(`public/data/${p.file}`), { useTArray: true, maxMemoryUsageInMB: 1024 }));

/** Mean red/blue ratio and peak brightness of a tile's central half. */
function tileStats(page: number, tile: number) {
  const p = atlas.pages[page];
  const img = pages[page];
  const [u, v, du, dv] = tileRect(p, tile);
  // The tile in image rows (top-down) is the texture rectangle flipped.
  const x0 = Math.round(u * img.width), y0 = Math.round((1 - v - dv) * img.height);
  const q = p.tile / 4;
  let r = 0, b = 0, sum = 0, max = 0;
  for (let y = y0 + q; y < y0 + 3 * q; y++) {
    for (let x = x0 + q; x < x0 + 3 * q; x++) {
      const k = (y * img.width + x) * 4;
      r += img.data[k];
      b += img.data[k + 2];
      const lum = img.data[k] + img.data[k + 1] + img.data[k + 2];
      sum += lum;
      max = Math.max(max, lum);
    }
  }
  expect(du * img.width).toBeCloseTo(p.tile, 6);
  return { redBlue: r / Math.max(1, b), mean: sum / (4 * q * q), max };
}

describe('nebula images (DSS via SkyView)', () => {
  it('cover every named nebula on page 0, and hundreds more nebulae with distances', () => {
    const named = nebulae.filter((n) => n.name);
    const page0 = atlas.images.filter((i) => i.page === 0);
    expect(page0.length).toBe(named.length);
    for (const n of named) {
      const im = page0.find((i) => i.name === n.name);
      expect(im, n.name).toBeDefined();
      expect(im!.kind).toBe(n.kind);
      expect(im!.l).toBeCloseTo(n.l, 3);
      expect(im!.b).toBeCloseTo(n.b, 3);
      // 2.6 catalogue radii across, within the script's limits.
      expect(im!.fieldDeg).toBeCloseTo(Math.min(12, Math.max(0.05, 2.6 * n.radiusDeg)), 3);
    }
    const others = atlas.images.filter((i) => i.page > 0);
    // Glowing nebulae whose plates show them, and dark clouds (which show as a starless patch).
    expect(others.filter((i) => i.kind !== 'dark').length).toBeGreaterThan(150);
    expect(others.filter((i) => i.kind === 'dark').length).toBeGreaterThan(350);
    const byKey = new Map(nebulae.map((n) => [nebulaKey(n), n]));
    for (const im of others) {
      const n = byKey.get(nebulaKey(im));
      expect(n, im.id).toBeDefined();
      expect(n!.distanceKpc).toBeGreaterThan(0);
      expect(n!.radiusDeg).toBeGreaterThanOrEqual(0.02);
      expect(im.l).toBeCloseTo(n!.l, 3);
    }
    // Every image has its own tile.
    expect(new Set(atlas.images.map((i) => `${i.page}/${i.tile}`)).size).toBe(atlas.images.length);
  });

  it('every page decodes at its stated size, and every tile holds a real picture', () => {
    atlas.pages.forEach((p, i) => {
      expect(pages[i].width).toBe(p.cols * p.tile);
      expect(pages[i].height).toBe(p.rows * p.tile);
    });
    for (const im of atlas.images) {
      expect(im.tile).toBeLessThan(atlas.pages[im.page].cols * atlas.pages[im.page].rows);
      const s = tileStats(im.page, im.tile);
      expect(s.max, im.id).toBeGreaterThan(150);
    }
  });

  it('shows emission nebulae red and reflection nebulae blue, as the plates record them', () => {
    const colour = (name: string) => {
      const im = atlas.images.find((i) => i.name === name)!;
      return tileStats(im.page, im.tile).redBlue;
    };
    // Hα glow of HII regions; starlight scattered by dust in the Iris and NGC 2023.
    for (const name of ['Rosette Nebula', 'Heart Nebula', 'Carina Nebula']) expect(colour(name), name).toBeGreaterThan(1.3);
    for (const name of ['Iris Nebula', 'NGC 2023']) expect(colour(name), name).toBeLessThan(0.9);
    // Across all the photographed HII regions, red dominates on average.
    const hii = atlas.images.filter((i) => i.kind === 'hii').map((i) => tileStats(i.page, i.tile).redBlue);
    expect(hii.reduce((a, b) => a + b, 0) / hii.length).toBeGreaterThan(1.1);
  });
});
