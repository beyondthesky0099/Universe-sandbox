import { describe, expect, it } from 'vitest';
import { galacticToMap, pictureAxes } from '../src/procgen/galaxy';
import { makeNoiseVolume } from '../src/render/nebulaRaymarch';

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unitTo = (p: number[], q: number[]) => {
  const v = q.map((x, i) => x - p[i]);
  const n = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / n);
};

describe('ray-marched nebulae', () => {
  it('orients photographs as seen from Earth: galactic north up, longitude increasing to the left', () => {
    for (const [l, b, d] of [[209, -19.4, 0.41], [287.6, -0.6, 2.3], [17, 0.8, 1.7], [60, 40, 7]]) {
      const p = galacticToMap(l, b, d);
      const { right, up, forward } = pictureAxes(l, b, d);
      expect(dot(right, unitTo(p, galacticToMap(l - 0.01, b, d)))).toBeGreaterThan(0.99);
      expect(dot(up, unitTo(p, galacticToMap(l, b + 0.01, d)))).toBeGreaterThan(0.99);
      expect(dot(forward, unitTo(p, galacticToMap(l, b, d * 1.1)))).toBeGreaterThan(0.999);
      expect(Math.abs(dot(right, up)) + Math.abs(dot(right, forward)) + Math.abs(dot(up, forward))).toBeLessThan(1e-6);
    }
  });

  it('builds tileable 3D noise: two channels, full range, and no seam where the cube wraps', () => {
    const n = 32;
    const v = makeNoiseVolume(n, 3);
    expect(v.length).toBe(n * n * n * 2);
    const at = (x: number, y: number, z: number, c: number) => v[((x % n) + n * ((y % n) + n * (z % n))) * 2 + c];
    let min = 255, max = 0, seam = 0, inner = 0;
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const f = at(x, y, z, 0);
          min = Math.min(min, f);
          max = Math.max(max, f);
        }
        // Across the wrap (31 → 0) the noise changes no more than between neighbours inside.
        seam += Math.abs(at(n - 1, y, z, 0) - at(0, y, z, 0));
        inner += Math.abs(at(n / 2 - 1, y, z, 0) - at(n / 2, y, z, 0));
      }
    }
    expect(max - min).toBeGreaterThan(150);
    expect(seam / (n * n)).toBeLessThan(2.5 * (inner / (n * n)) + 2);
  });
});

describe('the gas in a photograph', () => {
  it('removes stars (point sources far above the glow around them) and keeps the glow', async () => {
    const { starlessGas } = await import('../src/render/nebulaRaymarch');
    const w = 32;
    const px = new Uint8ClampedArray(w * w * 4);
    for (let i = 0; i < w * w; i++) {
      const x = i % w, y = Math.floor(i / w);
      const glow = Math.max(0, 1 - Math.hypot(x - 16, y - 16) / 16) * 160;
      px.set([glow, glow * 0.3, glow * 0.35, 255], i * 4);
    }
    px.set([255, 255, 255, 255], (5 * w + 5) * 4); // a star in the faint outskirts
    const gas = starlessGas(px, w, w);
    expect(gas[(5 * w + 5) * 4]).toBeLessThan(80);
    expect(gas[(16 * w + 16) * 4]).toBeGreaterThan(120);
    // Colour kept: red gas stays red.
    expect(gas[(16 * w + 16) * 4]).toBeGreaterThan(2 * gas[(16 * w + 16) * 4 + 1]);
  });
});
