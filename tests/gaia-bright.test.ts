import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { absoluteMagnitude, decodeGaiaBright, encodeGaiaBright, gaiaPoints, type GaiaBright } from '../src/sim/gaiaBright';
import { galacticToMap } from '../src/procgen/galaxy';

function load(): GaiaBright {
  const buf = readFileSync(new URL('../public/data/gaia-bright.bin', import.meta.url));
  return decodeGaiaBright(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

describe('Gaia bright stars', () => {
  it('round-trips the binary format', () => {
    const s: GaiaBright = { count: 2, l: Float32Array.from([10.5, -170]), b: Float32Array.from([-23.5, 60]), distancePc: Float32Array.from([135, 4000]), teffK: Float32Array.from([12000, 3500]), gMag: Float32Array.from([2.9, -1.2]) };
    const back = decodeGaiaBright(encodeGaiaBright(s));
    expect(back.count).toBe(2);
    expect(back.l[0]).toBeCloseTo(10.5, 2);
    expect(back.b[0]).toBeCloseTo(-23.5, 2);
    expect(back.distancePc[1]).toBe(4000);
    expect(back.gMag[1]).toBeCloseTo(-1.2, 3);
    expect(() => decodeGaiaBright(new ArrayBuffer(12))).toThrow();
  });

  it('holds tens of thousands of real stars around the Sun', () => {
    const s = load();
    expect(s.count).toBeGreaterThan(55000);
    const d = [...s.distancePc].sort((a, b) => a - b);
    // Bright stars are seen out to a few thousand light-years; most are within ~500 pc.
    expect(d[d.length >> 1]).toBeGreaterThan(150);
    expect(d[d.length >> 1]).toBeLessThan(800);
    for (let i = 0; i < s.count; i += 997) {
      expect(s.gMag[i]).toBeLessThanOrEqual(8.001);
      expect(s.teffK[i]).toBeGreaterThan(2000);
    }
  });

  it('shows the Pleiades where they are: l = 166.6°, b = −23.5°, ~135 pc', () => {
    const s = load();
    let n = 0;
    for (let i = 0; i < s.count; i++) {
      if (Math.hypot(s.l[i] - 166.57, s.b[i] + 23.52) < 1.2 && s.distancePc[i] > 120 && s.distancePc[i] < 150) n++;
    }
    expect(n).toBeGreaterThanOrEqual(15);
  });

  it('places, colours and sizes stars for the map', () => {
    const s = load();
    const p = gaiaPoints(s, galacticToMap, 1);
    expect(p.count).toBe(s.count);
    // A hot star is bluer than a cool one.
    const hot = s.teffK.findIndex((t) => t > 15000);
    const cool = s.teffK.findIndex((t) => t < 3800);
    expect(p.colors[hot * 3 + 2]).toBeGreaterThan(p.colors[cool * 3 + 2]);
    expect(absoluteMagnitude(4.8, 10)).toBeCloseTo(4.8, 6);
    expect(Math.max(...p.sizes)).toBeLessThanOrEqual(4);
  });
});
