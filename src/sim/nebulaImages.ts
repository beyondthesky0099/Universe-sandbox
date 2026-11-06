/**
 * Real colour images of the nebulae (scripts/build-nebula-images.mjs): Digitized Sky Survey plates
 * via NASA SkyView, red plate → red, blue plate → blue, packed into JPEG atlas pages: page 0 holds
 * the named nebulae at 256 pixels, the later pages every other nebula with a distance that is at
 * least 1.2′ in radius, at 128 pixels. Each
 * image is centred on its catalogue position, `fieldDeg` across, in galactic orientation
 * (galactic north up, increasing longitude to the left).
 */
import type { NebulaKind } from './nebulae';

export interface NebulaImage {
  /** Familiar name (the named nebulae, on page 0), and catalogue designation. */
  name?: string;
  id: string;
  kind: NebulaKind;
  l: number;
  b: number;
  fieldDeg: number;
  /** Which atlas page and which tile on it. */
  page: number;
  tile: number;
  /** Which plates it was made from (DSS2, DSS2 Red + DSS1 Blue, DSS2 Red + SERC-J Blue, Mellinger). */
  source: string;
}

export interface AtlasPage {
  file: string;
  /** Pixels per image, images per row, rows. */
  tile: number;
  cols: number;
  rows: number;
}

export interface NebulaImageAtlas {
  source: string;
  pages: AtlasPage[];
  images: NebulaImage[];
}

/** Key that identifies a nebula across the catalogue and the images. */
export const nebulaKey = (n: { kind: string; id: string }): string => `${n.kind}:${n.id}`;

export const NEBULA_IMAGE_CREDIT =
  'Nebula images: the Digitized Sky Survey (POSS-I/II, SERC; Space Telescope Science Institute, under U.S. Government grant NAG W-2166, from photographic data of the Palomar and UK Schmidt telescopes), via NASA SkyView.';

/** Texture-space rectangle [u, v, width, height] of a tile (v measured from the bottom, as WebGL samples a flipped image). */
export function tileRect(page: Pick<AtlasPage, 'cols' | 'rows'>, tile: number): [number, number, number, number] {
  const col = tile % page.cols;
  const row = Math.floor(tile / page.cols);
  return [col / page.cols, 1 - (row + 1) / page.rows, 1 / page.cols, 1 / page.rows];
}

let promise: Promise<NebulaImageAtlas> | undefined;
export function loadNebulaImages(baseUrl = import.meta.env.BASE_URL): Promise<NebulaImageAtlas> {
  promise ??= fetch(`${baseUrl}data/nebula-images.json`).then((r) => {
    if (!r.ok) throw new Error(`Couldn't load the nebula images (${r.status})`);
    return r.json() as Promise<NebulaImageAtlas>;
  });
  return promise;
}

export function nebulaAtlasUrl(page: AtlasPage, baseUrl = import.meta.env.BASE_URL): string {
  return `${baseUrl}data/${page.file}`;
}
