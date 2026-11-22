#!/usr/bin/env node
/**
 * Build public/data/radio-lobes.{jpg,json}: the real radio lobes of nearby radio galaxies, as the
 * radio sky surveys record them, for the Universe view.
 *
 * Sources:
 *   - every 3CRR radio galaxy closer than z = 0.1 (Laing, Riley & Longair 1983, MNRAS 204, 151,
 *     1992 update; VizieR J/MNRAS/204/151), with its Fanaroff–Riley class (FR I: jets that fade
 *     into plumes; FR II: edge-brightened lobes with hot spots);
 *   - famous radio galaxies 3CRR leaves out (it avoids the Milky Way's plane and the southern
 *     sky): Cygnus A, Centaurus A, Fornax A, Pictor A, Hydra A and Hercules A, resolved by SIMBAD.
 *
 * Images: NVSS (1.4 GHz, 45″ beam, Condon et al. 1998) north of δ = −40°, else SUMSS (843 MHz,
 * Bock et al. 1999), both via NASA SkyView, galactic north up and longitude increasing to the
 * left. For each galaxy the field grows until the emission connected to the galaxy (above 3σ,
 * around the brightest pixel near the centre) no longer touches the edge; that emission's extent
 * along its principal axis is the largest angular size, and its axis the lobes' orientation. The
 * picture is then fetched at 1.3 times that size, stretched (asinh) and false-coloured (radio is
 * invisible: faint dark red to bright yellow-white). Galaxies whose emission is unresolved (under
 * three beams) are left out. The size is the length along the axis that holds 99% of the flux, so
 * the surveys' faint artefacts around the brightest sources (Cygnus A) don't stretch it, less one
 * beam width (45″), by which the beam blurs the edges outwards.
 *
 * Giants whose lobes lie far from the galaxy, detached at the surveys' resolution (DA 240, 3C 236,
 * NGC 6251, Fornax A, and Centaurus A's outer lobes), would be measured as their core alone; for
 * them GIANTS gives the published size, used as the picture's field. Their pictures come from the
 * surveys made for large scales, which the interferometers NVSS and SUMSS filter out: GLEAM
 * (170–231 MHz, Hurley-Walker et al. 2017) in the south, WENSS (325 MHz, Rengelink et al. 1997) in
 * the north. Every picture is resampled with linear interpolation.
 *
 *   node scripts/build-radio-lobes.mjs   (FITS cached in node_modules/.cache/radio-lobes/)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { equatorialToGalactic, num, parseTsv, round, vizierClient } from './lib/vizier.mjs';

const root = new URL('..', import.meta.url).pathname;
const cache = join(root, 'node_modules/.cache/radio-lobes');
mkdirSync(cache, { recursive: true });
const vizier = vizierClient('radio-lobes');

const TILE = 256;
const COLS = 8;
const BEAM_DEG = 45 / 3600;

// --- The galaxies -------------------------------------------------------------------------------
const crr = parseTsv(
  await vizier('3crr', { '-source': 'J/MNRAS/204/151/table3', '-out': 'IAU,Name,FR,OT,z', '-out.add': '_Glon,_Glat,_RAJ2000,_DEJ2000', '-out.max': 'unlimited' }),
)
  .filter((r) => r.OT.trim() === 'G' && num(r.z) > 0 && num(r.z) < 0.1)
  // 3C 231 is M82: its radio glow comes from the starburst's supernova remnants, not from jets.
  .filter((r) => r.Name.trim() !== '3C 231')
  .map((r) => ({ name: r.Name.trim() || r.IAU.trim(), l: num(r._Glon), b: num(r._Glat), dec: num(r._DEJ2000), z: num(r.z), fr: r.FR.trim() }));

/** [SIMBAD identifier, name shown, Fanaroff–Riley class] */
const EXTRAS = [
  ['Cygnus A', 'Cygnus A (3C 405)', 'II'],
  ['Centaurus A', 'Centaurus A (NGC 5128)', 'I'],
  ['Fornax A', 'Fornax A (NGC 1316)', 'I'],
  ['Pictor A', 'Pictor A', 'II'],
  ['Hydra A', 'Hydra A (3C 218)', 'I'],
  ['Hercules A', 'Hercules A (3C 348)', 'II'],
];
const simbadFile = join(cache, `simbad-${createHash('sha1').update(JSON.stringify(EXTRAS)).digest('hex').slice(0, 10)}.txt`);
let simbad = existsSync(simbadFile) ? readFileSync(simbadFile, 'utf8') : undefined;
for (let attempt = 0; !simbad; attempt++) {
  try {
    const script = ['output console=off script=off', 'format object "%IDLIST(1)|%COO(d;A D)|%RV(Z)"', ...EXTRAS.map((e) => e[0])].join('\n');
    const res = await fetch(`https://simbad.cfa.harvard.edu/simbad/sim-script?script=${encodeURIComponent(script)}`, { signal: AbortSignal.timeout(120000) });
    const text = await res.text();
    if (!res.ok || text.includes('::error')) throw new Error(text.slice(0, 300));
    writeFileSync(simbadFile, text);
    simbad = text;
  } catch (err) {
    if (attempt >= 5) throw err;
    await new Promise((r) => setTimeout(r, 4000 * 2 ** attempt));
  }
}
const resolved = simbad.split('\n').filter((line) => line.includes('|'));
if (resolved.length !== EXTRAS.length) throw new Error(`SIMBAD resolved ${resolved.length} of ${EXTRAS.length}`);
const extras = EXTRAS.map(([, name, fr], i) => {
  const [, coo, zText] = resolved[i].split('|');
  const [ra, dec] = coo.trim().split(/\s+/).map(Number);
  const [l, b] = equatorialToGalactic(ra, dec);
  return { name, l, b, dec, z: Number(zText.split(/\s+/).filter(Boolean)[1] ?? zText.trim().split(/\s+/)[0]), fr };
});
const galaxies = [...crr, ...extras];

/** Largest angular size (degrees) of giants whose lobes are detached from the core, and the paper. */
const GIANTS = {
  'DA 240': [34 / 60, 'Willis, Strom & Wilson 1974, Nature 250, 625'],
  '3C 236': [40 / 60, 'Willis, Strom & Wilson 1974, Nature 250, 625'],
  'NGC 6251': [1.2, 'Waggett, Warner & Baldwin 1977, MNRAS 181, 465'],
  'Fornax A (NGC 1316)': [1.0, 'Ekers et al. 1983, A&A 127, 361'],
  'Centaurus A (NGC 5128)': [8.0, 'Junkes et al. 1993, A&A 269, 29'],
};

// --- Radio images -------------------------------------------------------------------------------
async function fetchFits(survey, l, b, size, pixels) {
  const file = join(cache, `${survey.replace(/\W+/g, '')}_${l.toFixed(4)}_${b.toFixed(4)}_${size.toFixed(4)}_${pixels}_li.fits`);
  if (existsSync(file)) return readFileSync(file);
  const url = `https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl?Position=${l},${b}&Coordinates=Galactic&Projection=Tan&Rotation=0&Survey=${encodeURIComponent(survey)}&Pixels=${pixels}&Size=${size.toFixed(4)}&Sampler=LI&Return=FITS`;
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
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

/** The image as floats (rows south to north, as FITS stores them), or undefined outside the survey. */
function readFits(buf, pixels) {
  const header = {};
  let offset = 0;
  for (;;) {
    const card = buf.subarray(offset, offset + 80).toString('latin1');
    offset += 80;
    const key = card.slice(0, 8).trim();
    if (key === 'END' || offset > buf.length) break;
    if (card[8] === '=') header[key] = card.slice(10).split('/')[0].trim().replace(/^'|'$/g, '').trim();
  }
  offset = Math.ceil(offset / 2880) * 2880;
  const w = Number(header.NAXIS1), h = Number(header.NAXIS2), bitpix = Number(header.BITPIX);
  if (Number(header.NAXIS) !== 2 || w !== pixels || h !== pixels || buf.length < offset + w * h * Math.abs(bitpix) / 8) return undefined;
  const bscale = Number(header.BSCALE ?? 1), bzero = Number(header.BZERO ?? 0);
  const data = new Float32Array(w * h);
  let covered = 0;
  for (let i = 0; i < w * h; i++) {
    const v = bitpix === -32 ? buf.readFloatBE(offset + i * 4) : bitpix === -64 ? buf.readDoubleBE(offset + i * 8) : bitpix === 16 ? buf.readInt16BE(offset + i * 2) : buf.readInt32BE(offset + i * 4);
    data[i] = Number.isFinite(v) && v !== 0 ? v * bscale + bzero : NaN;
    if (Number.isFinite(data[i])) covered++;
  }
  return covered > 0.8 * w * h ? data : undefined;
}

const finite = (data) => Array.from(data).filter(Number.isFinite).sort((a, b) => a - b);
/** Robust noise: 1.4826 × the median absolute deviation from the median. */
function noise(data) {
  const v = finite(data);
  const med = v[v.length >> 1];
  const dev = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  return { med, sigma: Math.max(1e-9, 1.4826 * dev[dev.length >> 1]) };
}

/**
 * The emission connected to the galaxy: pixels above 3σ, 8-connected to the brightest pixel within
 * the central 10% of the field. Returns its pixels and whether it reaches the edge.
 */
function component(data, n) {
  const { med, sigma } = noise(data);
  const c = n / 2;
  let seed = -1, best = -Infinity;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (Math.hypot(x + 0.5 - c, y + 0.5 - c) > n * 0.1) continue;
    const v = data[y * n + x];
    if (v > best) [best, seed] = [v, y * n + x];
  }
  if (seed < 0 || !((best - med) / sigma > 8)) return undefined;
  const floor = 3 * sigma;
  const inside = new Uint8Array(n * n);
  const stack = [seed];
  inside[seed] = 1;
  const pix = [];
  let edge = false;
  while (stack.length) {
    const k = stack.pop();
    const x = k % n, y = (k / n) | 0;
    pix.push({ x, y, w: data[k] - med });
    if (x < 2 || y < 2 || x >= n - 2 || y >= n - 2) edge = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const kk = yy * n + xx;
      if (!inside[kk] && data[kk] - med > floor) {
        inside[kk] = 1;
        stack.push(kk);
      }
    }
  }
  return { pix, edge, med, sigma };
}

/**
 * Extent along the principal axis (degrees) and that axis's angle, measured from galactic north
 * towards increasing longitude (left in the picture), for pixels with x to the right and y up.
 */
function extent(pix, field, n) {
  const W = pix.reduce((s, p) => s + p.w, 0);
  const mx = pix.reduce((s, p) => s + p.w * p.x, 0) / W, my = pix.reduce((s, p) => s + p.w * p.y, 0) / W;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pix) {
    sxx += p.w * (p.x - mx) ** 2;
    syy += p.w * (p.y - my) ** 2;
    sxy += p.w * (p.x - mx) * (p.y - my);
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // major axis angle from +x (right)
  const ux = Math.cos(theta), uy = Math.sin(theta);
  // The length along the axis that holds 99% of the flux (0.5% cut at each end): faint wings,
  // such as the survey's artefacts around the brightest sources, don't stretch it; a halo that
  // carries real flux (M87's) still counts.
  const along = pix.map((p) => ({ t: (p.x - mx) * ux + (p.y - my) * uy, w: p.w })).sort((a, b) => a.t - b.t);
  let acc = 0, lo = along[0].t, hi = along[along.length - 1].t, loSet = false;
  for (const a of along) {
    acc += a.w;
    if (!loSet && acc >= 0.005 * W) [lo, loSet] = [a.t, true];
    if (acc >= 0.995 * W) {
      hi = a.t;
      break;
    }
  }
  const deg = field / n;
  // Angle from north (+y) towards +l, which is left (−x): 0° up, 90° left.
  let pa = (Math.atan2(-ux, uy) * 180) / Math.PI;
  pa = ((pa % 180) + 180) % 180;
  return { las: (hi - lo + 1) * deg, paGal: pa };
}

/** Radio false colour, from faint dark red through orange to bright yellow-white. */
function palette(t) {
  const r = Math.min(1, t * 1.8);
  const g = Math.min(1, Math.max(0, t * 1.6 - 0.35));
  const b = Math.min(1, Math.max(0, t * 2.2 - 1.3));
  return [r, g, b];
}

const results = [];
for (const g of galaxies) {
  const survey = g.dec > -39.5 ? 'NVSS' : 'SUMSS 843 MHz';
  let found;
  for (const field of [0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4, 12]) {
    const data = readFits(await fetchFits(survey, g.l, g.b, field, 128), 128);
    if (!data) continue;
    const comp = component(data, 128);
    if (!comp) continue;
    found = { field, ...comp, data };
    if (!comp.edge) break;
  }
  if (!found) {
    console.warn(`${g.name}: no ${survey} image with emission`);
    continue;
  }
  let { las, paGal } = extent(found.pix, found.field, 128);
  const giant = GIANTS[g.name];
  // Giants: a survey that keeps the large scales.
  const picSurvey = giant ? (g.dec < 25 ? 'GLEAM 170-231 MHz' : 'WENSS') : survey;
  if (giant) {
    // Measure the axis on a picture of the published size: the lobes are the brightest emission there.
    const wide = readFits(await fetchFits(picSurvey, g.l, g.b, giant[0] * 1.3, 128), 128);
    const n = wide ? noise(wide) : undefined;
    if (wide && n) {
      const bright = [];
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const v = wide[y * 128 + x] - n.med;
        if (v > 5 * n.sigma && Math.hypot(x + 0.5 - 64, y + 0.5 - 64) < 64 / 1.3) bright.push({ x, y, w: v });
      }
      if (bright.length > 10) paGal = extent(bright, giant[0] * 1.3, 128).paGal;
    }
    las = giant[0];
  }
  if (las < 3 * BEAM_DEG) {
    console.log(`${g.name}: unresolved (${(las * 60).toFixed(1)}′), left out`);
    continue;
  }
  const fieldDeg = Math.max(1.3 * las, 6 * BEAM_DEG);
  // The survey beam blurs the edges outwards by about its width: take it off the measured size
  // (Hercules A then comes out at the published 3.2′). Published sizes stand as they are.
  if (!giant) las -= BEAM_DEG;
  const pic = readFits(await fetchFits(picSurvey, g.l, g.b, fieldDeg, TILE), TILE);
  if (!pic) {
    console.warn(`${g.name}: no ${TILE}-pixel ${picSurvey} image`);
    continue;
  }
  const { med, sigma } = noise(pic);
  const v = finite(pic);
  const top = Math.max(v[Math.floor(v.length * 0.9995)] - med, 20 * sigma);
  const soft = 3 * sigma;
  const norm = Math.asinh(top / soft);
  const rgb = new Float32Array(TILE * TILE * 3);
  for (let i = 0; i < TILE * TILE; i++) {
    const s = pic[i] - med;
    // Below 2σ is noise: black (invisible when drawn additively).
    const t = Number.isFinite(s) && s > 2 * sigma ? Math.min(1, Math.asinh((s - 2 * sigma) / soft) / norm) : 0;
    rgb.set(palette(t), i * 3);
  }
  const label = { NVSS: 'NVSS 1.4 GHz', 'SUMSS 843 MHz': 'SUMSS 843 MHz', 'GLEAM 170-231 MHz': 'GLEAM 200 MHz', WENSS: 'WENSS 325 MHz' }[picSurvey];
  results.push({ ...g, survey: label, fieldDeg, lasDeg: las, paGal, rgb, sizeRef: giant?.[1] });
  console.log(`${g.name}: ${(las * 60).toFixed(1)}′ across at ${paGal.toFixed(0)}° (galactic), field ${(fieldDeg * 60).toFixed(1)}′ (${picSurvey})`);
}

// --- Atlas --------------------------------------------------------------------------------------
const rows = Math.ceil(results.length / COLS);
const W = COLS * TILE, H = rows * TILE;
const atlas = Buffer.alloc(W * H * 4);
results.forEach((r, t) => {
  const col = t % COLS, row = Math.floor(t / COLS);
  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      const s = ((TILE - 1 - j) * TILE + i) * 3; // FITS rows run south to north: flip
      // Fade the square's edge so the picture blends into space.
      const rr = Math.hypot(i - TILE / 2 + 0.5, j - TILE / 2 + 0.5) / (TILE / 2);
      const fade = Math.min(1, Math.max(0, (1 - rr) / 0.12));
      const k = ((row * TILE + j) * W + col * TILE + i) * 4;
      atlas[k] = Math.round(255 * r.rgb[s] * fade);
      atlas[k + 1] = Math.round(255 * r.rgb[s + 1] * fade);
      atlas[k + 2] = Math.round(255 * r.rgb[s + 2] * fade);
      atlas[k + 3] = 255;
    }
  }
});
writeFileSync(join(root, 'public/data/radio-lobes.jpg'), jpeg.encode({ data: atlas, width: W, height: H }, 85).data);
writeFileSync(
  join(root, 'public/data/radio-lobes.json'),
  JSON.stringify({
    source:
      'Radio galaxies: the 3CRR sample (Laing, Riley & Longair 1983; VizieR J/MNRAS/204/151), z < 0.1, plus Cygnus A, Centaurus A, Fornax A, Pictor A, Hydra A and Hercules A (SIMBAD). Images: NVSS 1.4 GHz (Condon et al. 1998) or SUMSS 843 MHz (Bock et al. 1999); for giants GLEAM 170-231 MHz (Hurley-Walker et al. 2017) or WENSS 325 MHz (Rengelink et al. 1997); via NASA SkyView, galactic north up, linear interpolation, false colour. Sizes and axes measured from the images (emission above 3σ connected to the galaxy; the length holding 99% of its flux); for giants with detached lobes (sizeRef) the published size.',
    tile: TILE,
    cols: COLS,
    rows,
    lobes: results.map((r, t) => ({ name: r.name, l: round(r.l, 4), b: round(r.b, 4), z: round(r.z, 5), fr: r.fr || undefined, survey: r.survey, fieldDeg: round(r.fieldDeg, 4), lasDeg: round(r.lasDeg, 4), paGal: round(r.paGal, 1), sizeRef: r.sizeRef, tile: t })),
  }) + '\n',
);
console.log(`${results.length} radio galaxies with resolved lobes, atlas ${W}×${H}`);
