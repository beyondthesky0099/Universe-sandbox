import { describe, expect, it } from 'vitest';
import { galacticToMap, pictureAxes } from '../src/procgen/galaxy';
import { gasBrightness, SIZE_PX, volumeParticles } from '../src/render/nebulaVolume';

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unitTo = (p: number[], q: number[]) => {
  const v = q.map((x, i) => x - p[i]);
  const n = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / n);
};

/** A synthetic picture: a glowing red disc with a bright star in its upper-left quarter. */
function picture(w = 64) {
  const px = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.hypot(x - w / 2, y - w / 2) / (w / 2);
      const k = (y * w + x) * 4;
      const glow = Math.max(0, 1 - r) * 200;
      px[k] = glow;
      px[k + 1] = glow * 0.3;
      px[k + 2] = glow * 0.35;
      px[k + 3] = 255;
    }
  }
  // A star: one saturated white pixel.
  const s = (16 * w + 16) * 4;
  px[s] = px[s + 1] = px[s + 2] = 255;
  return px;
}

describe('3D nebulae from photographs', () => {
  it('orients pictures as seen from Earth: galactic north up, longitude increasing to the left', () => {
    for (const [l, b, d] of [[209, -19.4, 0.41], [287.6, -0.6, 2.3], [17, 0.8, 1.7], [60, 40, 7]]) {
      const p = galacticToMap(l, b, d);
      const { right, up, forward } = pictureAxes(l, b, d);
      expect(dot(right, unitTo(p, galacticToMap(l - 0.01, b, d)))).toBeGreaterThan(0.99);
      expect(dot(up, unitTo(p, galacticToMap(l, b + 0.01, d)))).toBeGreaterThan(0.99);
      expect(dot(forward, unitTo(p, galacticToMap(l, b, d * 1.1)))).toBeGreaterThan(0.999);
      expect(Math.abs(dot(right, up)) + Math.abs(dot(right, forward)) + Math.abs(dot(up, forward))).toBeLessThan(1e-6);
    }
  });

  it('clips stars to the glow around them and leaves the dark sky empty', () => {
    const w = 64;
    const gas = gasBrightness(picture(w), w, w);
    expect(gas[16 * w + 16]).toBeLessThan(0.6); // the star was 1.0
    expect(gas[0]).toBe(0); // a dark corner
    expect(gas[32 * w + 32]).toBeGreaterThan(0.2); // the glowing middle
  });

  it('draws particles where the picture is bright, in its colour, with real depth', () => {
    const w = 64;
    const axes = pictureAxes(209, -19.4, 0.41);
    const center = galacticToMap(209, -19.4, 0.41);
    const field = 0.1;
    const v = volumeParticles({ pixels: picture(w), width: w, height: w, center, field, ...axes, count: 6000, seed: 3 });
    expect(v.count).toBe(6000);
    let inner = 0, depth2 = 0, side2 = 0, red = 0;
    for (let i = 0; i < v.count; i++) {
      const rel = [0, 1, 2].map((k) => v.positions[i * 3 + k] - center[k]);
      const a = dot(rel, axes.right), b = dot(rel, axes.up), z = dot(rel, axes.forward);
      if (Math.hypot(a, b) < field * 0.25) inner++;
      depth2 += z * z;
      side2 += a * a;
      // Red gas: red is the strongest channel (the clipped star's few particles aside), and the
      // colour carries unit brightness.
      const [r, g, bl] = [v.colors[i * 3], v.colors[i * 3 + 1], v.colors[i * 3 + 2]];
      if (r > 1.5 * g) red++;
      expect(0.3 * r + 0.5 * g + 0.2 * bl).toBeCloseTo(1, 1);
    }
    expect(red / v.count).toBeGreaterThan(0.98);
    // Brighter middle → more particles there than its share of the area (a quarter of the disc's).
    expect(inner / v.count).toBeGreaterThan(0.4);
    // Genuinely three-dimensional: the depth spread is comparable to the width.
    const ratio = Math.sqrt(depth2 / side2);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(2);
  });
});

describe('brightness of a 3D nebula', () => {
  it('adds up to the photograph: total light = picture brightness, whatever the particle count', () => {
    const w = 64;
    const axes = pictureAxes(209, -19.4, 0.41);
    const center = galacticToMap(209, -19.4, 0.41);
    const gasTotal = gasBrightness(picture(w), w, w).reduce((a, b) => a + b, 0);
    for (const count of [2000, 8000]) {
      const v = volumeParticles({ pixels: picture(w), width: w, height: w, center, field: 0.1, ...axes, count, seed: 1 });
      // Each particle's light in picture pixels is opacity × the Gaussian's area.
      const blob = (Math.PI * (SIZE_PX / 2) ** 2) / 2.2;
      expect((v.opacity * blob * v.count) / gasTotal).toBeCloseTo(1, 6);
    }
  });
});
