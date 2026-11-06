#!/usr/bin/env node
/**
 * Real colour images of the named nebulae in public/data/nebulae.json, from the Digitized Sky
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
 * Each image is centred on the catalogue position, 2.6 catalogue radii across, north up, east
 * left, and is stretched with an asinh curve after subtracting the sky. They are packed into one
 * JPEG atlas, public/data/nebula-images.jpg, indexed by public/data/nebula-images.json.
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

const TILE = 256;
const COLS = 8;
/** Field of view: 2.6 catalogue radii, at least 3 arcminutes, at most 12°. */
const fieldDeg = (radiusDeg) => Math.min(12, Math.max(0.05, 2.6 * radiusDeg));

const raw = JSON.parse(readFileSync(join(root, 'public/data/nebulae.json'), 'utf8'));
// [l, b, radius in degrees, name, kind] for every named nebula (the row layouts are documented in
// src/sim/nebulae.ts).
const targets = [];
for (const r of raw.hii) if (r[5]) targets.push([r[0], r[1], r[3] / 3600, r[5], 'hii']);
for (const r of raw.pn) if (r[6]) targets.push([r[0], r[1], (r[3] ?? 0) / 3600, r[6], 'pn']);
for (const r of raw.snr) if (r[7]) targets.push([r[0], r[1], Math.sqrt(r[2] * r[3]) / 2 / 60, r[7], 'snr']);
for (const r of raw.dark ?? []) if (r[5]) targets.push([r[0], r[1], r[2] / 60, r[5], 'dark']);
for (const r of raw.refl ?? []) if (r[6]) targets.push([r[0], r[1], r[2] / 60, r[6], 'refl']);

/** Declination (degrees, J2000) of galactic (l, b): IAU pole RA 192.85948°, Dec 27.12825°, l_NCP 122.93192°. */
function declination(l, b) {
  const D = Math.PI / 180;
  const dp = 27.12825 * D, lncp = 122.93192 * D;
  return Math.asin(Math.sin(dp) * Math.sin(b * D) + Math.cos(dp) * Math.cos(b * D) * Math.cos(lncp - l * D)) / D;
}

async function fetchFits(survey, l, b, size) {
  const key = `${survey.replace(/\s/g, '')}_${l}_${b}_${size.toFixed(4)}.fits`.replace(/[^\w.-]/g, '_');
  const file = join(cache, key);
  if (existsSync(file)) return readFileSync(file);
  const url = `https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl?Position=${l},${b}&Coordinates=Galactic&Projection=Tan&Rotation=0&Survey=${encodeURIComponent(survey)}&Pixels=${TILE}&Size=${size.toFixed(4)}&Return=FITS`;
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
function readFits(buf) {
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
  if (Number(header.NAXIS) !== 2 || w !== TILE || h !== TILE) return undefined;
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

const rows = Math.ceil(targets.length / COLS);
const atlas = Buffer.alloc(COLS * TILE * rows * TILE * 4);
const index = [];
for (let t = 0; t < targets.length; t++) {
  const [l, b, radius, name, kind] = targets[t];
  const size = fieldDeg(radius);
  let source = 'DSS2';
  let R, G, B;
  const red = readFits(await fetchFits('DSS2 Red', l, b, size));
  let blue = readFits(await fetchFits('DSS2 Blue', l, b, size));
  if (!blue) {
    blue = readFits(await fetchFits('DSS1 Blue', l, b, size));
    source = 'DSS2 Red + DSS1 Blue';
  }
  if (!blue && declination(l, b) < -17.5) {
    blue = readFits(await fetchFits('DSS', l, b, size));
    source = 'DSS2 Red + SERC-J Blue';
  }
  if (red && blue) {
    R = stretch(red);
    B = stretch(blue);
    // Where only one plate has data, show it in grey.
    for (let i = 0; i < R.length; i++) {
      if (Number.isNaN(R[i])) R[i] = B[i];
      if (Number.isNaN(B[i])) B[i] = R[i];
    }
    // Green: the fainter of the two plates. Stars (bright on both) stay white, Hα-bright gas
    // stays red-pink rather than turning orange, and gas bright in both looks white.
    G = R.map((r, i) => Math.min(r, B[i]));
  } else {
    source = 'Mellinger';
    const mel = await Promise.all(['Red', 'Green', 'Blue'].map(async (c) => readFits(await fetchFits(`Mellinger ${c}`, l, b, size))));
    if (mel.some((m) => !m)) throw new Error(`no survey covers ${name}`);
    [R, G, B] = mel.map(stretch);
  }
  const col = t % COLS, row = Math.floor(t / COLS);
  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      // FITS rows run south to north; the atlas runs top to bottom, so flip.
      const s = (TILE - 1 - j) * TILE + i;
      // Fade the square edge so the image blends into space.
      const r = Math.hypot(i - TILE / 2 + 0.5, j - TILE / 2 + 0.5) / (TILE / 2);
      const fade = Math.min(1, Math.max(0, (1 - r) / 0.18));
      const k = ((row * TILE + j) * COLS * TILE + col * TILE + i) * 4;
      atlas[k] = Math.round(255 * (R[s] || 0) * fade);
      atlas[k + 1] = Math.round(255 * (G[s] || 0) * fade);
      atlas[k + 2] = Math.round(255 * (B[s] || 0) * fade);
      atlas[k + 3] = 255;
    }
  }
  index.push({ name, kind, l, b, fieldDeg: Number(size.toFixed(4)), tile: t, source });
  process.stdout.write(`${t + 1}/${targets.length} ${name} (${size.toFixed(2)}°, ${source})\n`);
}

const jpg = jpeg.encode({ data: atlas, width: COLS * TILE, height: rows * TILE }, 82);
writeFileSync(join(root, 'public/data/nebula-images.jpg'), jpg.data);
writeFileSync(
  join(root, 'public/data/nebula-images.json'),
  JSON.stringify({
    source: 'Digitized Sky Survey (DSS2 Red; DSS2 or DSS1 Blue) via NASA SkyView: red = Red plate, blue = Blue plate, green = the fainter of the two. Where no blue plate covers the field: Mellinger (2009) all-sky colour mosaic.',
    tile: TILE,
    cols: COLS,
    rows,
    images: index,
  }) + '\n',
);
console.log(`wrote ${index.length} images, ${(jpg.data.length / 1024).toFixed(0)} KB`);
