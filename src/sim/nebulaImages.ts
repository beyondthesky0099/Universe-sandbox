/**
 * Real colour images of the nebulae (scripts/build-nebula-images.mjs): Digitized Sky Survey plates
 * via NASA SkyView, red plate → red, blue plate → blue, packed into JPEG atlas pages: page 0 holds
 * the named nebulae at 256 pixels, the later pages other nebulae with a distance that are at
 * least 1.2′ in radius and visible on the plates (and dark clouds), at 128 pixels. Each
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
  /** Named nebulae: a 512-pixel picture of it alone (path under data/), loaded up close. */
  hd?: string;
  /**
   * The best-known nebulae: an observatory photograph (ESO, NASA/ESA Hubble, NASA/ESA/CSA Webb,
   * NOIRLab; CC BY 4.0) reprojected into the same frame and field as `hd`, 1024 pixels
   * (scripts/build-nebula-photos.mjs). Preferred to `hd` up close; its credit must be shown.
   */
  photo?: string;
  photoCredit?: string;
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

/**
 * Key that identifies a nebula across the catalogue and the images. The designation alone isn't
 * unique (the WISE catalogue gives the components of a complex one name), so the position is part
 * of it; both files carry the same rounded coordinates.
 */
export const nebulaKey = (n: { kind: string; id: string; l: number; b: number }): string => `${n.kind}:${n.id}:${n.l.toFixed(3)}:${n.b.toFixed(3)}`;

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

/** URL of a nebula's own sharp picture (NebulaImage.hd). */
export function nebulaHdUrl(file: string, baseUrl = import.meta.env.BASE_URL): string {
  return `${baseUrl}data/${file}`;
}
