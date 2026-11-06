/**
 * Real colour images of the named nebulae (scripts/build-nebula-images.mjs): Digitized Sky Survey
 * plates via NASA SkyView, red plate → red, blue plate → blue, packed into one JPEG atlas. Each
 * image is centred on its catalogue position, `fieldDeg` across, in galactic orientation
 * (galactic north up, increasing longitude to the left).
 */
import type { NebulaKind } from './nebulae';

export interface NebulaImage {
  name: string;
  kind: NebulaKind;
  l: number;
  b: number;
  fieldDeg: number;
  tile: number;
  /** Which plates it was made from (DSS2, DSS2 Red + DSS1 Blue, DSS2 Red + SERC-J Blue, Mellinger). */
  source: string;
}

export interface NebulaImageAtlas {
  source: string;
  tile: number;
  cols: number;
  rows: number;
  images: NebulaImage[];
}

export const NEBULA_IMAGE_CREDIT =
  'Nebula images: the Digitized Sky Survey (POSS-I/II, SERC; Space Telescope Science Institute, under U.S. Government grant NAG W-2166, from photographic data of the Palomar and UK Schmidt telescopes), via NASA SkyView.';

/** Texture-space rectangle [u, v, width, height] of a tile (v measured from the bottom, as WebGL samples a flipped image). */
export function tileRect(atlas: Pick<NebulaImageAtlas, 'cols' | 'rows'>, tile: number): [number, number, number, number] {
  const col = tile % atlas.cols;
  const row = Math.floor(tile / atlas.cols);
  return [col / atlas.cols, 1 - (row + 1) / atlas.rows, 1 / atlas.cols, 1 / atlas.rows];
}

let promise: Promise<NebulaImageAtlas> | undefined;
export function loadNebulaImages(baseUrl = import.meta.env.BASE_URL): Promise<NebulaImageAtlas> {
  promise ??= fetch(`${baseUrl}data/nebula-images.json`).then((r) => {
    if (!r.ok) throw new Error(`Couldn't load the nebula images (${r.status})`);
    return r.json() as Promise<NebulaImageAtlas>;
  });
  return promise;
}

export function nebulaAtlasUrl(baseUrl = import.meta.env.BASE_URL): string {
  return `${baseUrl}data/nebula-images.jpg`;
}
