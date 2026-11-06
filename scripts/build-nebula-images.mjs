#!/usr/bin/env node
/**
 * Real colour images of the nebulae in public/data/nebulae.json, from the Digitized Sky
 * Survey (DSS2) photographic plates via NASA's SkyView (skyview.gsfc.nasa.gov):
 *
 *   red   = DSS2 Red  (POSS-II F / SERC-ER, ~650 nm: Hα and [N II] glow)
 *   blue  = DSS2 Blue (POSS-II J / SERC-J, ~470 nm: [O III], Hβ and scattered starlight)
 *   green = the fainter of the two at each pixel, so stars stay white and Hα-bright gas red
 *           (the plain mean of the plates turns emission nebulae orange)
 *
 * DSS2 Blue has gaps: there the blue plate comes from DSS1 (POSS-I O in the north; south of
 * δ = −17.5° the first-generation DSS is the SERC-J blue survey), and where none covers the field, the whole image comes from Axel Mellinger's all-sky colour mosaic (Mellinger 2009,
 * PASP 121, 1180), also via SkyView.
 *
 * Each image is centred on the catalogue position, 2.6 catalogue radii across, galactic north up,
 * increasing longitude to the left, and is stretched with an asinh curve after subtracting the
 * sky. Two sets:
 *   - page 0 (public/data/nebula-images.jpg): the named nebulae, 256 pixels each;
 *   - pages 1… (nebula-images-1.jpg, …): every other nebula with a measured distance that is at
 *     least 1.2′ in radius (big enough for the plates to show its shape), 128 pixels each.
 * public/data/nebula-images.json indexes them.
 *
 * Usage: node scripts/build-nebula-images.mjs   (FITS downloads are cached in
 * node_modules/.cache/nebula-images/)
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'node_modules/.cache/nebula-images');
mkdirSync(cache, { recursive: true });

/** Pixels per image and images per row on each page (pages are 2048 pixels wide). */
const PAGE_WIDTH = 2048;
const NAMED_TILE = 256;
const OTHER_TILE = 128;
const PER_PAGE = (PAGE_WIDTH / OTHER_TILE) ** 2;
const CONCURRENCY = 6;
/** Field of view: 2.6 catalogue radii, at least 3 arcminutes, at most 12°. */
const fieldDeg = (radiusDeg) => Math.min(12, Math.max(0.05, 2.6 * radiusDeg));

const raw = JSON.parse(readFileSync(join(root, 'public/data/nebulae.json'), 'utf8'));
// { l, b, radius (degrees), id, name?, kind, distance (kpc) | null } for every nebula (the row
// layouts are documented in src/sim/nebulae.ts).
const all = [
  ...raw.hii.map((r) => ({ l: r[0], b: r[1], radius: r[3] / 3600, id: r[4], name: r[5], kind: 'hii', d: r[2] })),
  ...raw.pn.map((r) => ({ l: r[0], b: r[1], radius: (r[3] ?? 0) / 3600, id: r[4], name: r[6], kind: 'pn', d: r[2] })),
  ...raw.snr.map((r) => ({ l: r[0], b: r[1], radius: Math.sqrt(r[2] * r[3]) / 2 / 60, id: r[5], name: r[7], kind: 'snr', d: r[6] })),
  ...raw.dark.map((r) => ({ l: r[0], b: r[1], radius: r[2] / 60, id: r[3], name: r[7], kind: 'dark', d: r[5] })),
  ...raw.refl.map((r) => ({ l: r[0], b: r[1], radius: r[2] / 60, id: r[3], name: r[6], kind: 'refl', d: r[5] })),
];
const named = all.filter((n) => n.name);
const others = all.filter((n) => !n.name && n.d && n.radius >= 0.02);

/** Declination (degrees, J2000) of galactic (l, b): IAU pole RA 192.85948°, Dec 27.12825°, l_NCP 122.93192°. */
function declination(l, b) {
  const D = Math.PI / 180;
  const dp = 27.12825 * D, lncp = 122.93192 * D;
  return Math.asin(Math.sin(dp) * Math.sin(b * D) + Math.cos(dp) * Math.cos(b * D) * Math.cos(lncp - l * D)) / D;
}

async function fetchFits(survey, l, b, size, pixels) {
  const key = `${survey.replace(/\s/g, '')}_${l}_${b}_${size.toFixed(4)}${pixels === NAMED_TILE ? '' : `_${pixels}`}.fits`.replace(/[^\w.-]/g, '_');
  const file = join(cache, key);
  if (existsSync(file)) return readFileSync(file);
  const url = `https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl?Position=${l},${b}&Coordinates=Galactic&Projection=Tan&Rotation=0&Survey=${encodeURIComponent(survey)}&Pixels=${pixels}&Size=${size.toFixed(4)}&Return=FITS`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.subarray(0, 6).toString().startsWith('SIMPLE')) throw new Error('not a FITS file');
      writeFileSync(file, buf);
      return buf;
    } catch (e) {
      if (attempt >= 5) throw new Error(`${survey} at ${l},${b}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/** A minimal FITS reader for SkyView's 2D images (BITPIX −32 or 16). */
function readFits(buf, pixels) {
  const header = {};
  let offset = 0;
  for (;;) {
    const card = buf.subarray(offset, offset + 80).toString('latin1');
    offset += 80;
    const key = card.slice(0, 8).trim();
    if (key === 'END') break;
    if (card[8] === '=') header[key] = card.slice(10).split('/')[0].trim().replace(/^'|'$/g, '').trim();
  }
  offset = Math.ceil(offset / 2880) * 2880;
  const w = Number(header.NAXIS1), h = Number(header.NAXIS2), bitpix = Number(header.BITPIX);
  const bscale = Number(header.BSCALE ?? 1), bzero = Number(header.BZERO ?? 0);
  if (Number(header.NAXIS) !== 2 || w !== pixels || h !== pixels) return undefined;
  const data = new Float32Array(w * h);
  let covered = 0;
  for (let i = 0; i < w * h; i++) {
    const v = bitpix === -32 ? buf.readFloatBE(offset + i * 4) : bitpix === 16 ? buf.readInt16BE(offset + i * 2) : buf.readInt32BE(offset + i * 4);
    // Exact zeros are outside the plate.
    data[i] = v === 0 ? NaN : v * bscale + bzero;
    if (Number.isFinite(data[i])) covered++;
  }
  return covered > 0.6 * w * h ? { w, h, data, header } : undefined;
}

function percentile(data, p) {
  const v = Array.from(data).filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))] : 0;
}

/** Sky-subtracted, asinh-stretched channel in 0..1 (NaN where the plate has no data). */
function stretch(img) {
  const sky = percentile(img.data, 25);
  // Pixel noise from neighbour differences (robust to nebulosity filling the field), so empty
  // fields stay dark instead of being stretched into speckle.
  const diffs = new Float32Array(img.data.length);
  for (let i = 0; i < img.data.length - 1; i++) diffs[i] = Math.abs(img.data[i + 1] - img.data[i]);
  const noise = Math.max(1e-6, (1.4826 * percentile(diffs, 50)) / Math.SQRT2);
  const hi = Math.max(sky + 25 * noise, percentile(img.data, 99.8));
  const soft = (hi - sky) / 12;
  const top = Math.asinh((hi - sky) / soft);
  const out = new Float32Array(img.data.length);
  for (let i = 0; i < out.length; i++) {
    const v = img.data[i];
    out[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, Math.asinh((v - sky) / soft) / top)) : NaN;
  }
  return out;
}

/** The three colour channels of one nebula, from the best plates that cover it. */
async function picture(n, size, pixels) {
  const get = async (survey) => readFits(await fetchFits(survey, n.l, n.b, size, pixels), pixels);
  let source = 'DSS2';
  const red = await get('DSS2 Red');
  let blue = await get('DSS2 Blue');
  if (!blue) {
    blue = await get('DSS1 Blue');
    source = 'DSS2 Red + DSS1 Blue';
  }
  if (!blue && declination(n.l, n.b) < -17.5) {
    blue = await get('DSS');
    source = 'DSS2 Red + SERC-J Blue';
  }
  if (red && blue) {
    const R = stretch(red);
    const B = stretch(blue);
    // Where only one plate has data, show it in grey.
    for (let i = 0; i < R.length; i++) {
      if (Number.isNaN(R[i])) R[i] = B[i];
      if (Number.isNaN(B[i])) B[i] = R[i];
    }
    // Green: the fainter of the two plates. Stars (bright on both) stay white, Hα-bright gas
    // stays red-pink rather than turning orange, and gas bright in both looks white.
    return { R, G: R.map((r, i) => Math.min(r, B[i])), B, source };
  }
  const mel = await Promise.all(['Red', 'Green', 'Blue'].map((c) => get(`Mellinger ${c}`)));
  if (mel.some((m) => !m)) return undefined;
  const [R, G, B] = mel.map(stretch);
  return { R, G, B, source: 'Mellinger' };
}

/** Run `fn` over `items`, `limit` at a time, keeping the order of the results. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
        if (++done % 50 === 0) process.stdout.write(`  ${done}/${items.length}\n`);
      }
    }),
  );
  return out;
}

const pages = [];
const index = [];
async function buildPages(list, pixels, firstPage) {
  const cols = PAGE_WIDTH / pixels;
  const perPage = list === named ? list.length : PER_PAGE;
  const pics = await pool(list, CONCURRENCY, (n) => picture(n, fieldDeg(n.radius), pixels).catch((e) => (console.warn(`${n.id}: ${e.message}`), undefined)));
  const kept = list.map((n, i) => [n, pics[i]]).filter(([, p]) => p);
  for (let start = 0, page = firstPage; start < kept.length; start += perPage, page++) {
    const chunk = kept.slice(start, start + perPage);
    const rows = Math.ceil(chunk.length / cols);
    const atlas = Buffer.alloc(PAGE_WIDTH * rows * pixels * 4);
    chunk.forEach(([n, pic], t) => {
      const col = t % cols, row = Math.floor(t / cols);
      for (let j = 0; j < pixels; j++) {
        for (let i = 0; i < pixels; i++) {
          // FITS rows run south to north; the atlas runs top to bottom, so flip.
          const s = (pixels - 1 - j) * pixels + i;
          // Fade the square edge so the image blends into space.
          const r = Math.hypot(i - pixels / 2 + 0.5, j - pixels / 2 + 0.5) / (pixels / 2);
          const fade = Math.min(1, Math.max(0, (1 - r) / 0.18));
          const k = ((row * pixels + j) * PAGE_WIDTH + col * pixels + i) * 4;
          atlas[k] = Math.round(255 * (pic.R[s] || 0) * fade);
          atlas[k + 1] = Math.round(255 * (pic.G[s] || 0) * fade);
          atlas[k + 2] = Math.round(255 * (pic.B[s] || 0) * fade);
          atlas[k + 3] = 255;
        }
      }
      index.push({ ...(n.name ? { name: n.name } : {}), id: n.id, kind: n.kind, l: n.l, b: n.b, fieldDeg: Number(fieldDeg(n.radius).toFixed(4)), page, tile: t, source: pic.source });
    });
    const file = page === 0 ? 'nebula-images.jpg' : `nebula-images-${page}.jpg`;
    const jpg = jpeg.encode({ data: atlas, width: PAGE_WIDTH, height: rows * pixels }, 82);
    writeFileSync(join(root, 'public/data', file), jpg.data);
    pages.push({ file, tile: pixels, cols, rows });
    console.log(`page ${page}: ${chunk.length} images, ${(jpg.data.length / 1024).toFixed(0)} KB`);
  }
}

console.log(`${named.length} named nebulae, ${others.length} others with distances`);
await buildPages(named, NAMED_TILE, 0);
await buildPages(others, OTHER_TILE, 1);
writeFileSync(
  join(root, 'public/data/nebula-images.json'),
  JSON.stringify({
    source: 'Digitized Sky Survey (DSS2 Red; DSS2, DSS1 or SERC-J Blue) via NASA SkyView: red = Red plate, blue = Blue plate, green = the fainter of the two. Where no blue plate covers the field: Mellinger (2009) all-sky colour mosaic.',
    pages,
    images: index,
  }) + '\n',
);
console.log(`wrote ${index.length} images on ${pages.length} pages`);
