/**
 * Laniakea, our home supercluster, as the motions of galaxies define it (scripts/build-laniakea.py):
 * flow lines of the CosmicFlows-4 peculiar-velocity field (Courtois et al. 2023, A&A 670, L15;
 * CC BY 4.0), the surface of the Milky Way's basin of attraction in it (Dupuy & Courtois 2023,
 * A&A 678, A176), and that basin as a bit mask. Positions are in the Universe view's frame (Mpc).
 */

export interface Laniakea {
  /** The basin's attractor, where its flows converge (Mpc, Universe frame). */
  attractor: [number, number, number];
  /** Flow lines: point counts, 1 for those starting in Laniakea, and all points (x, y, z, Mpc). */
  lineLengths: Uint16Array;
  lineInside: Uint8Array;
  points: Float32Array;
  /** Laniakea's surface: vertices (x, y, z, Mpc) and triangles. */
  vertices: Float32Array;
  triangles: Uint32Array;
  /** The basin: one bit per voxel of the N³ grid (SGX, SGY, SGZ order). */
  mask: Uint8Array;
  n: number;
  voxel: number;
  centre: number;
  h: number;
}

const HEADER = 56;

export function decodeLaniakea(buffer: ArrayBuffer): Laniakea {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== 'LANI') throw new Error('Not a Laniakea file');
  if (view.getUint32(4, true) !== 1) throw new Error('Unknown Laniakea file version');
  const unit = view.getFloat32(8, true);
  const attractor: [number, number, number] = [view.getFloat32(12, true), view.getFloat32(16, true), view.getFloat32(20, true)];
  const [nLines, nPoints, nVerts, nTris] = [24, 28, 32, 36].map((o) => view.getUint32(o, true));
  const n = view.getFloat32(40, true);
  const voxel = view.getFloat32(44, true);
  const centre = view.getFloat32(48, true);
  const h = view.getFloat32(52, true);
  let pos = HEADER;
  const take = (bytes: number) => {
    const out = buffer.slice(pos, pos + bytes);
    pos += bytes;
    if (out.byteLength !== bytes) throw new Error('Laniakea file is truncated');
    return out;
  };
  const scaled = (raw: ArrayBuffer) => Float32Array.from(new Int16Array(raw), (q) => q * unit);
  const lineLengths = new Uint16Array(take(nLines * 2));
  const lineInside = new Uint8Array(take(nLines));
  const points = scaled(take(nPoints * 6));
  const vertices = scaled(take(nVerts * 6));
  const triangles = new Uint32Array(take(nTris * 12));
  const mask = new Uint8Array(take(Math.ceil((n * n * n) / 8)));
  return { attractor, lineLengths, lineInside, points, vertices, triangles, mask, n, voxel, centre, h };
}

let promise: Promise<Laniakea> | undefined;

export function loadLaniakea(baseUrl = import.meta.env.BASE_URL): Promise<Laniakea> {
  promise ??= fetch(`${baseUrl}data/laniakea.bin`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load Laniakea (HTTP ${r.status})`);
      return r.arrayBuffer();
    })
    .then(decodeLaniakea);
  promise.catch(() => (promise = undefined));
  return promise;
}

const DEG = Math.PI / 180;
function galacticUnit(l: number, b: number): [number, number, number] {
  return [Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG)];
}
// The supergalactic axes in galactic coordinates (de Vaucouleurs; as in the build script).
const SGZ = galacticUnit(47.37, 6.32);
const SGX = galacticUnit(137.37, 0);
const SGY: [number, number, number] = [SGZ[1] * SGX[2] - SGZ[2] * SGX[1], SGZ[2] * SGX[0] - SGZ[0] * SGX[2], SGZ[0] * SGX[1] - SGZ[1] * SGX[0]];

/** Is this point of the Universe view (Mpc) inside Laniakea's basin? */
export function inLaniakea(l: Pick<Laniakea, 'mask' | 'n' | 'voxel' | 'centre' | 'h'>, [x, y, z]: [number, number, number]): boolean {
  // Universe frame (x, y, z) = galactic (x, z, −y).
  const g = [x, -z, y];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const idx = [SGX, SGY, SGZ].map((axis) => Math.round((dot(axis, g) * l.h) / l.voxel + l.centre));
  if (idx.some((i) => i < 0 || i >= l.n)) return false;
  const bit = (idx[0] * l.n + idx[1]) * l.n + idx[2];
  return ((l.mask[bit >> 3] >> (bit & 7)) & 1) === 1;
}
