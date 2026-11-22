/**
 * The radio lobes of nearby radio galaxies (scripts/build-radio-lobes.mjs): real radio-survey
 * pictures (NVSS, SUMSS, GLEAM, WENSS) in false colour, drawn in the Universe view at their true
 * size and orientation around their galaxies.
 *
 * Each picture is in galactic orientation, as seen from the Milky Way: galactic north up and
 * galactic longitude increasing to the left. `lobeBasis` turns that into directions in the
 * Universe map, and `lobeSizeKpc` its measured largest angular size into kiloparsecs.
 */
import { angularDiameterDistance } from './cosmology';
import { galacticToScene, galacticUnit } from './galaxyLook';
import type { LocalGalaxy } from './galaxies';

export interface RadioLobe {
  name: string;
  /** Galactic position (degrees) and redshift. */
  l: number;
  b: number;
  z: number;
  /** Fanaroff–Riley class: I (jets fading into plumes) or II (edge-brightened lobes with hot spots). */
  fr?: 'I' | 'II';
  /** The survey the picture comes from ("NVSS 1.4 GHz"). */
  survey: string;
  /** The picture's width, the lobes' largest angular size, and their axis (degrees; axis from galactic north towards increasing longitude). */
  fieldDeg: number;
  lasDeg: number;
  paGal: number;
  /** For giants whose detached lobes the surveys can't connect: the paper giving their size. */
  sizeRef?: string;
  /** Tile index in the atlas. */
  tile: number;
}

export interface RadioLobeAtlas {
  source: string;
  tile: number;
  cols: number;
  rows: number;
  lobes: RadioLobe[];
}

let promise: Promise<RadioLobeAtlas> | undefined;
export function loadRadioLobes(baseUrl = import.meta.env.BASE_URL): Promise<RadioLobeAtlas> {
  promise ??= fetch(`${baseUrl}data/radio-lobes.json`).then((r) => {
    if (!r.ok) throw new Error(`radio-lobes.json: HTTP ${r.status}`);
    return r.json() as Promise<RadioLobeAtlas>;
  });
  return promise;
}

export function radioAtlasUrl(baseUrl = import.meta.env.BASE_URL): string {
  return `${baseUrl}data/radio-lobes.jpg`;
}

/** The atlas rectangle of a tile, in texture coordinates [u, v, width, height] (v up). */
export function lobeTileRect(atlas: Pick<RadioLobeAtlas, 'cols' | 'rows'>, tile: number): [number, number, number, number] {
  const col = tile % atlas.cols, row = Math.floor(tile / atlas.cols);
  return [col / atlas.cols, 1 - (row + 1) / atlas.rows, 1 / atlas.cols, 1 / atlas.rows];
}

type Vec3 = [number, number, number];
const norm = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

/**
 * The picture's directions in the Universe map at galactic (l, b): `up` towards galactic north,
 * `right` towards decreasing longitude (the sky seen from inside: longitude increases to the
 * left), and `los` away from us.
 */
export function lobeBasis(lDeg: number, bDeg: number): { up: Vec3; right: Vec3; los: Vec3 } {
  const l = (lDeg * Math.PI) / 180, b = (bDeg * Math.PI) / 180;
  const up: Vec3 = [-Math.sin(b) * Math.cos(l), -Math.sin(b) * Math.sin(l), Math.cos(b)];
  const lInc: Vec3 = [-Math.sin(l), Math.cos(l), 0];
  return { up: norm(galacticToScene(up)), right: norm(galacticToScene([-lInc[0], -lInc[1], -lInc[2]])), los: norm(galacticToScene(galacticUnit(lDeg, bDeg))) };
}

/** The lobes' largest size in kiloparsecs, from the angle and the angular-diameter distance (or a measured distance in Mpc). */
export function lobeSizeKpc(lobe: Pick<RadioLobe, 'lasDeg' | 'z'>, distanceMpc?: number): number {
  const d = distanceMpc ?? angularDiameterDistance(lobe.z);
  return d * 1000 * ((lobe.lasDeg * Math.PI) / 180);
}

/** The galaxy a lobe picture belongs to: the nearest map entry within 2′ (by galactic position). */
export function lobeHost(lobe: Pick<RadioLobe, 'l' | 'b'>, galaxies: LocalGalaxy[]): LocalGalaxy | undefined {
  const D = Math.PI / 180;
  let best: LocalGalaxy | undefined, bestSep = 2 / 60;
  for (const g of galaxies) {
    if (Math.abs(g.b - lobe.b) > bestSep) continue;
    const c = Math.sin(lobe.b * D) * Math.sin(g.b * D) + Math.cos(lobe.b * D) * Math.cos(g.b * D) * Math.cos((lobe.l - g.l) * D);
    const sep = Math.acos(Math.min(1, c)) / D;
    if (sep < bestSep) [best, bestSep] = [g, sep];
  }
  return best;
}
