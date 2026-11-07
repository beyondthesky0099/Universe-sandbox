/**
 * Every star brighter than Gaia G = 8 with a parallax good to 20% (about 62,000 stars, out to a
 * few thousand light-years), from ESA Gaia DR3 (scripts/build-gaia-bright.mjs). They are drawn on
 * the Galaxy Map around the Sun, so the real neighbourhood shows its real stars: the bright blue
 * giants of Orion and Scorpius–Centaurus, the band of the Gould Belt, and the gaps where dust
 * hides what lies behind.
 *
 * Binary layout, little-endian, struct of arrays for n stars: "GAIA", uint32 n, uint32 version,
 * then int16 l×180, int16 b×360, uint16 distance (pc), uint16 temperature (K), uint16 (G+2)×1000.
 */
import { kelvinToRgb } from './color';

export interface GaiaBright {
  count: number;
  /** Galactic longitude and latitude (degrees), distance (pc), temperature (K), G magnitude. */
  l: Float32Array;
  b: Float32Array;
  distancePc: Float32Array;
  teffK: Float32Array;
  gMag: Float32Array;
}

const HEADER = 12;

export function decodeGaiaBright(buffer: ArrayBuffer): GaiaBright {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'GAIA') throw new Error('Not a Gaia star file');
  const n = view.getUint32(4, true);
  if (buffer.byteLength < HEADER + n * 10) throw new Error('Gaia star file is truncated');
  const out: GaiaBright = { count: n, l: new Float32Array(n), b: new Float32Array(n), distancePc: new Float32Array(n), teffK: new Float32Array(n), gMag: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    out.l[i] = view.getInt16(HEADER + i * 2, true) / 180;
    out.b[i] = view.getInt16(HEADER + n * 2 + i * 2, true) / 360;
    out.distancePc[i] = view.getUint16(HEADER + n * 4 + i * 2, true);
    out.teffK[i] = view.getUint16(HEADER + n * 6 + i * 2, true);
    out.gMag[i] = view.getUint16(HEADER + n * 8 + i * 2, true) / 1000 - 2;
  }
  return out;
}

/** The inverse of decodeGaiaBright (the build script writes the same layout); for tests. */
export function encodeGaiaBright(s: GaiaBright): ArrayBuffer {
  const n = s.count;
  const buf = new ArrayBuffer(HEADER + n * 10);
  const view = new DataView(buf);
  'GAIA'.split('').forEach((c, i) => view.setUint8(i, c.charCodeAt(0)));
  view.setUint32(4, n, true);
  view.setUint32(8, 1, true);
  for (let i = 0; i < n; i++) {
    view.setInt16(HEADER + i * 2, Math.round((s.l[i] > 180 ? s.l[i] - 360 : s.l[i]) * 180), true);
    view.setInt16(HEADER + n * 2 + i * 2, Math.round(s.b[i] * 360), true);
    view.setUint16(HEADER + n * 4 + i * 2, Math.round(s.distancePc[i]), true);
    view.setUint16(HEADER + n * 6 + i * 2, Math.round(s.teffK[i]), true);
    view.setUint16(HEADER + n * 8 + i * 2, Math.round((s.gMag[i] + 2) * 1000), true);
  }
  return buf;
}

let promise: Promise<GaiaBright> | undefined;

export function loadGaiaBright(baseUrl = import.meta.env.BASE_URL): Promise<GaiaBright> {
  promise ??= fetch(`${baseUrl}data/gaia-bright.bin`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the Gaia stars (HTTP ${r.status})`);
      return r.arrayBuffer();
    })
    .then(decodeGaiaBright);
  promise.catch(() => (promise = undefined));
  return promise;
}

/** Absolute magnitude from apparent magnitude and distance (no extinction correction). */
export function absoluteMagnitude(g: number, distancePc: number): number {
  return g - 5 * Math.log10(Math.max(distancePc, 1) / 10);
}

/**
 * Points for the map: positions from `toMap(l, b, kpc)`, colours from temperature, and sizes
 * that grow with luminosity (a supergiant ~4× a Sun-like star).
 */
export function gaiaPoints(s: GaiaBright, toMap: (l: number, b: number, dKpc: number) => [number, number, number], baseSize: number): { positions: Float32Array; colors: Float32Array; sizes: Float32Array; count: number } {
  const n = s.count;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    positions.set(toMap(s.l[i], s.b[i], s.distancePc[i] / 1000), i * 3);
    const [r, g, b] = kelvinToRgb(s.teffK[i]);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
    const M = absoluteMagnitude(s.gMag[i], s.distancePc[i]);
    sizes[i] = baseSize * Math.min(4, Math.max(0.6, 10 ** (-0.12 * (M - 4.8))));
  }
  return { positions, colors, sizes, count: n };
}
