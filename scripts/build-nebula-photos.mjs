#!/usr/bin/env node
/**
 * Observatory photographs of the best-known nebulae, for when the camera flies up to them.
 *
 * The survey plates (scripts/build-nebula-images.mjs) show every nebula the same honest way, but
 * up close they are blurry and saturated: the Orion Nebula and the Ring Nebula burn out to flat
 * blobs. Here the famous ones get a real observatory photograph instead, all CC BY 4.0, from the
 * image archives of ESO (eso.org), ESA/Hubble (esahubble.org), ESA/Webb (esawebb.org) and NSF
 * NOIRLab (noirlab.edu). Each archive page gives the picture's position on the sky (its AVM
 * coordinates, as a WorldWide Telescope link: reference pixel, RA/Dec, arcseconds per pixel,
 * rotation) and its credit line.
 *
 * Each photograph is reprojected into the frame of the nebula's survey picture (centred on the
 * catalogue position, galactic north up, longitude increasing to the left, the same field), so it
 * drops into the same place in the 3D volume. Its alignment is checked against the survey plates:
 * the mirror image, the opposite rotation and small shifts are tried, and the best match by star
 * positions is kept (the correlation is printed). Where the photograph doesn't cover the field,
 * the survey picture fills in, matched in brightness and blended across the edge. The sky's
 * black point is set from the photograph's darkest pixels, so a hazy background turns black.
 *
 * A low match is expected where the survey plate is burnt out (the Orion Nebula, small
 * planetary nebulae): those were checked by eye, overlaying the two pictures.
 *
 * Writes public/data/nebula-photos/<slug>.jpg (1024 pixels), replaces the named nebula's tile on
 * atlas page 0 (nebula-images.jpg) so the far view matches, and adds `photo` and `photoCredit` to
 * its entry in public/data/nebula-images.json. Run it after build-nebula-images.mjs.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/build-nebula-photos.mjs   (behind a proxy; plain node otherwise)
 *
 * Downloads are cached in node_modules/.cache/nebula-photos/.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'node_modules/.cache/nebula-photos');
mkdirSync(cache, { recursive: true });
const OUT = 1024;

/**
 * Which photograph for which nebula (the name as in nebulae.json). Chosen for visible light where
 * there is a good one, covering the survey picture's field, and sharp enough for 1024 pixels.
 */
const PHOTOS = [
  // HII regions
  ['Orion Nebula (M42)', 'hub', 'heic0601a'],
  ['Lagoon Nebula (M8)', 'eso', 'eso1403a'],
  ['Trifid Nebula (M20)', 'noir', 'noirlab2521ah'],
  ['Omega Nebula (M17)', 'eso', 'eso1119a'],
  ['Eagle Nebula (M16)', 'eso', 'eso1719a'],
  ['Carina Nebula', 'eso', 'eso1250a'],
  ['Rosette Nebula', 'noir', 'noirlab2424a'],
  ['North America Nebula', 'noir', 'noao-n7000mosblock'],
  ['Bubble Nebula', 'noir', 'noao1207a'],
  ['Pacman Nebula', 'noir', 'noao-ngc281'],
  ['Flaming Star Nebula', 'noir', 'noao0157a'],
  ['Cone Nebula', 'noir', 'noao-04493'],
  ['Running Chicken Nebula', 'eso', 'eso2320a'],
  ["Cat's Paw Nebula", 'eso', 'eso1003a'],
  // Planetary nebulae
  ['Helix Nebula', 'eso', 'eso0907a'],
  ['Dumbbell Nebula (M27)', 'eso', 'eso9846a'],
  ['Ring Nebula (M57)', 'hub', 'heic1310a'],
  ['Southern Ring Nebula', 'webb', 'weic2207b'],
  ['Butterfly Nebula', 'noir', 'noirlab2530a'],
  ['Little Dumbbell (M76)', 'hub', 'heic2408a'],
  ["Cat's Eye Nebula", 'hub', 'heic0414a'],
  ['Owl Nebula (M97)', 'noir', 'geminiann10008a'],
  // Supernova remnants
  ['Crab Nebula (M1)', 'hub', 'heic0515a'],
  ['Cassiopeia A', 'hub', 'heic0609a'],
  ['Cygnus Loop (Veil Nebula)', 'hub', 'heic0712g'],
  ['Jellyfish Nebula (IC 443)', 'noir', 'noao-ic443block2'],
  // Dark and reflection nebulae (a dark cloud's picture is used only when glowing gas lies
  // behind it, as with the Horsehead: Barnard 68 and the Pipe, seen against stars, stay modelled)
  ['Horsehead Nebula (B33)', 'eso', 'eso0202a'],
  ['M78', 'eso', 'eso1105a'],
];

const PAGE = { eso: 'https://www.eso.org/public/images/', hub: 'https://esahubble.org/images/', webb: 'https://esawebb.org/images/', noir: 'https://noirlab.edu/public/images/' };
const MEDIA = { eso: 'https://cdn.eso.org/images/', hub: 'https://cdn.esahubble.org/archives/images/', webb: 'https://cdn.esawebb.org/archives/images/', noir: 'https://storage.noirlab.edu/media/archives/images/' };

async function download(url, file, { text = false, optional = false } = {}) {
  const path = join(cache, file);
  if (existsSync(path)) return text ? readFileSync(path, 'utf8') : readFileSync(path);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
      if (!res.ok) {
        if (optional && (res.status === 403 || res.status === 404)) return undefined;
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(path, buf);
      return text ? buf.toString('utf8') : buf;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The archive page: its WorldWide Telescope link (the AVM coordinates of the "screen" picture) and the credit line. */
async function pageInfo(site, id) {
  const html = await download(PAGE[site] + id + '/', `${site}-${id}.html`, { text: true });
  const link = html.match(/worldwidetelescope\.org\/wwtweb\/ShowImage\.aspx\?([^"']+)/);
  if (!link) throw new Error(`${id}: no coordinates on its page`);
  const q = new URLSearchParams(unescape(link[1]));
  const num = (k) => Number(q.get(k));
  const credit = html.match(/<div class="credit">([\s\S]*?)<\/div>/) ?? html.match(/Credit:\s*<\/[^>]+>([\s\S]*?)<\/(?:div|p)>/);
  if (!credit) throw new Error(`${id}: no credit line`);
  return {
    ra: num('ra'),
    dec: num('dec'),
    x: num('x'),
    y: num('y'),
    scale: num('scale'),
    rotation: num('rotation'),
    credit: unescape(credit[1].replace(/<br\s*\/?>/g, '; ').replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .replace(/[\s;.]+$/, '')
      .trim(),
  };
}

/** Width and height of a JPEG from its frame header. */
function jpegSize(buf) {
  for (let i = 2; i < buf.length; ) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  throw new Error('no JPEG frame header');
}

/** The biggest picture the archive serves that is still a sensible download (≤ 60 MB). */
async function bestPicture(site, id) {
  for (const v of ['publicationjpg', 'large']) {
    const url = `${MEDIA[site]}${v}/${id}.jpg`;
    const file = `${site}-${id}-${v}.jpg`;
    if (!existsSync(join(cache, file))) {
      const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(60000) }).catch(() => undefined);
      if (!head?.ok || Number(head.headers.get('content-length') ?? 0) > 60e6) continue;
    }
    const buf = await download(url, file, { optional: true });
    if (buf) return buf;
  }
  return download(`${MEDIA[site]}screen/${id}.jpg`, `${site}-${id}-screen.jpg`);
}

/** Box-average an RGBA picture down by an integer factor into float RGB. */
function shrink(img, k) {
  const w = Math.floor(img.width / k), h = Math.floor(img.height / k);
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < k; dy++) {
        let s = ((y * k + dy) * img.width + x * k) * 4;
        for (let dx = 0; dx < k; dx++, s += 4) {
          r += img.data[s];
          g += img.data[s + 1];
          b += img.data[s + 2];
        }
      }
      const o = (y * w + x) * 3, n = 255 * k * k;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  }
  return { w, h, rgb: out };
}

// ICRS → galactic rotation (Hipparcos, ESA 1997).
const R = [
  [-0.0548755604162154, -0.873437090234885, -0.4838350155487132],
  [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
];
const D = Math.PI / 180;

/**
 * For each output pixel (galactic TAN frame of `field` degrees, n pixels), where it falls in the
 * photograph: pixel coordinates in its full-size picture (NaN off the sky side). `t` is the
 * photograph's placement: AVM values plus a trial parity, rotation sign and shift.
 */
function mapping(neb, field, n, t) {
  const out = new Float32Array(n * n * 2);
  const l0 = neb.l * D, b0 = neb.b * D;
  const c = [Math.cos(b0) * Math.cos(l0), Math.cos(b0) * Math.sin(l0), Math.sin(b0)];
  const el = [-Math.sin(l0), Math.cos(l0), 0];
  const eb = [-Math.sin(b0) * Math.cos(l0), -Math.sin(b0) * Math.sin(l0), Math.cos(b0)];
  const a0 = t.ra * D, d0 = t.dec * D;
  const c0 = [Math.cos(d0) * Math.cos(a0), Math.cos(d0) * Math.sin(a0), Math.sin(d0)];
  const eE = [-Math.sin(a0), Math.cos(a0), 0];
  const eN = [-Math.sin(d0) * Math.cos(a0), -Math.sin(d0) * Math.sin(a0), Math.cos(d0)];
  const theta = t.rotSign * (180 - t.rotation) * D;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const s = (field * D) / n;
  const toArcsec = 180 / Math.PI * 3600;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = Math.tan((n / 2 - 0.5 - i + t.dx) * s), y = Math.tan((n / 2 - 0.5 - j + t.dy) * s);
      const g = [c[0] + x * el[0] + y * eb[0], c[1] + x * el[1] + y * eb[1], c[2] + x * el[2] + y * eb[2]];
      // galactic → ICRS: Rᵀ g
      const e = [R[0][0] * g[0] + R[1][0] * g[1] + R[2][0] * g[2], R[0][1] * g[0] + R[1][1] * g[1] + R[2][1] * g[2], R[0][2] * g[0] + R[1][2] * g[1] + R[2][2] * g[2]];
      const w = e[0] * c0[0] + e[1] * c0[1] + e[2] * c0[2];
      const k = (j * n + i) * 2;
      if (w <= 0) {
        out[k] = out[k + 1] = NaN;
        continue;
      }
      const xi = (t.parity * (e[0] * eE[0] + e[1] * eE[1] + e[2] * eE[2]) / w) * toArcsec;
      const eta = ((e[0] * eN[0] + e[1] * eN[1] + e[2] * eN[2]) / w) * toArcsec;
      // North is θ left of vertical, east 90° anticlockwise from it (east left of north).
      const right = -xi * cos - eta * sin, up = -xi * sin + eta * cos;
      out[k] = (t.x - 0.5 + right / t.scale) * t.toFull;
      // AVM reference pixels count rows up from the bottom (FITS), image rows run down from the
      // top; some archive entries count from the top instead (fromTop), so both are tried.
      out[k + 1] = ((t.fromTop ? t.y - 0.5 : t.height - t.y + 0.5) - up / t.scale) * t.toFull;
    }
  }
  return out;
}

/** Bilinear sample of a shrunk picture at full-size coordinates (u, v); undefined outside. */
function sample(p, k, u, v, out) {
  const x = u / k - 0.5, y = v / k - 0.5;
  if (!(x >= 0 && y >= 0 && x <= p.w - 1 && y <= p.h - 1)) return false;
  const x0 = Math.min(p.w - 2, Math.floor(x)), y0 = Math.min(p.h - 2, Math.floor(y));
  const fx = x - x0, fy = y - y0;
  for (let ch = 0; ch < 3; ch++) {
    const a = p.rgb[(y0 * p.w + x0) * 3 + ch], b = p.rgb[(y0 * p.w + x0 + 1) * 3 + ch];
    const c = p.rgb[((y0 + 1) * p.w + x0) * 3 + ch], d = p.rgb[((y0 + 1) * p.w + x0 + 1) * 3 + ch];
    out[ch] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  return true;
}

/** Luminance minus its local mean (stars and sharp structure), normalised, for matching. */
function highpass(lum, n, mask) {
  const out = new Float32Array(n * n);
  const r = 3;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let s = 0, m = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = i + dx, y = j + dy;
          if (x < 0 || y < 0 || x >= n || y >= n || !Number.isFinite(lum[y * n + x])) continue;
          s += lum[y * n + x];
          m++;
        }
      }
      out[j * n + i] = mask[j * n + i] && m ? lum[j * n + i] - s / m : NaN;
    }
  }
  return out;
}

function correlate(a, b) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    n++;
    sa += a[i];
    sb += b[i];
    saa += a[i] * a[i];
    sbb += b[i] * b[i];
    sab += a[i] * b[i];
  }
  if (n < 200) return { r: -1, n };
  const cov = sab / n - (sa / n) * (sb / n);
  return { r: cov / Math.sqrt(Math.max(1e-12, (saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2))), n };
}

const index = JSON.parse(readFileSync(join(root, 'public/data/nebula-images.json'), 'utf8'));
const page0 = index.pages[0];
const atlas = jpeg.decode(readFileSync(join(root, 'public/data', page0.file)), { useTArray: true, maxMemoryUsageInMB: 1024 });
const photoDir = join(root, 'public/data/nebula-photos');
rmSync(photoDir, { recursive: true, force: true });
mkdirSync(photoDir, { recursive: true });
const slug = (name) => name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
let total = 0;

for (const [name, site, id] of PHOTOS) {
  const entry = index.images.find((e) => e.name === name && e.page === 0);
  if (!entry?.hd) throw new Error(`${name}: no survey picture (run build-nebula-images.mjs first)`);
  const info = await pageInfo(site, id);
  const screenSize = jpegSize(await download(`${MEDIA[site]}screen/${id}.jpg`, `${site}-${id}-screen.jpg`));
  const full = jpeg.decode(await bestPicture(site, id), { useTArray: true, maxMemoryUsageInMB: 4096, maxResolutionInMP: 1000 });
  const toFull = full.width / screenSize.w;
  if (Math.abs(full.height / screenSize.h - toFull) > 0.02 * toFull) throw new Error(`${id}: the big picture isn't the screen one scaled`);

  // The survey picture (512 pixels, same frame), for matching and to fill in around the photo.
  const dss = jpeg.decode(readFileSync(join(root, 'public/data', entry.hd)), { useTArray: true });
  const field = entry.fieldDeg;
  // Photograph pixels per output pixel; shrink it so sampling doesn't alias.
  const photoArcsecPerPx = info.scale / toFull;
  const perOut = (field * 3600) / OUT / photoArcsecPerPx;
  const k = Math.max(1, Math.floor(perOut));
  const pic = shrink(full, k);

  // Match at 256 pixels: survey high-pass vs photograph high-pass, inside the faded disc.
  const M = 256;
  const dssLum = new Float32Array(M * M);
  const mask = new Uint8Array(M * M);
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      let s = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const p = ((j * 2 + dy) * 512 + i * 2 + dx) * 4;
        s += 0.3 * dss.data[p] + 0.5 * dss.data[p + 1] + 0.2 * dss.data[p + 2];
      }
      dssLum[j * M + i] = Math.sqrt(s / 4 / 255);
      // Burnt-out plate (the cores of bright nebulae) carries no information to match.
      mask[j * M + i] = Math.hypot(i - M / 2 + 0.5, j - M / 2 + 0.5) < M * 0.38 && s / 4 / 255 < 0.85 ? 1 : 0;
    }
  }
  const dssHp = highpass(dssLum, M, mask);
  const kM = Math.max(1, Math.floor((field * 3600) / M / photoArcsecPerPx));
  const picM = kM === k ? pic : shrink(full, kM);
  const px = [0, 0, 0];
  const tryPlacement = (t) => {
    const map = mapping(entry, field, M, { ...info, ...t, toFull, height: screenSize.h });
    const lum = new Float32Array(M * M).fill(NaN);
    for (let i = 0; i < M * M; i++) if (sample(picM, kM, map[i * 2], map[i * 2 + 1], px)) lum[i] = Math.sqrt(0.3 * px[0] + 0.5 * px[1] + 0.2 * px[2]);
    return correlate(dssHp, highpass(lum, M, mask)).r;
  };
  let best = { r: -2, parity: 1, rotSign: 1, fromTop: false, dx: 0, dy: 0 };
  for (const fromTop of [false, true]) {
    for (const parity of [1, -1]) {
      for (const rotSign of [1, -1]) {
        if (rotSign === -1 && Math.abs(Math.sin((180 - info.rotation) * D)) < 0.02) continue;
        const r = tryPlacement({ parity, rotSign, fromTop, dx: 0, dy: 0 });
        // The standard reading wins unless another is clearly better.
        if (r > best.r + (best.r > -2 ? 0.03 : 0)) best = { r, parity, rotSign, fromTop, dx: 0, dy: 0 };
      }
    }
  }
  const asGiven = best.parity === 1 && best.rotSign === 1;
  // Small shifts (up to 3% of the field) in case the reference pixel is off.
  const zero = best.r;
  for (let dy = -8; dy <= 8; dy += 2) {
    for (let dx = -8; dx <= 8; dx += 2) {
      if (!dx && !dy) continue;
      const r = tryPlacement({ ...best, dx, dy });
      if (r > best.r + 0.02) best = { ...best, r, dx, dy };
    }
  }

  // The final picture.
  const map = mapping(entry, field, OUT, { ...info, ...best, dx: (best.dx * OUT) / M, dy: (best.dy * OUT) / M, toFull, height: screenSize.h });
  // Distance inside the photograph's edge (output pixels), for the blend into the survey picture.
  const inside = new Float32Array(OUT * OUT);
  const ppo = 1 / perOut; // output pixels per photo pixel
  for (let i = 0; i < OUT * OUT; i++) {
    const u = map[i * 2], v = map[i * 2 + 1];
    inside[i] = Number.isFinite(u) ? Math.min(u, v, full.width - u, full.height - v) * ppo : -1;
  }
  const feather = OUT * 0.04;
  // Brightness match: per-channel gain for the survey picture over the overlap.
  const sums = [0, 0, 0, 0, 0, 0];
  const photoPx = new Float32Array(OUT * OUT * 3);
  const dssAt = (i, j, out) => {
    const x = Math.min(511, Math.max(0, (i + 0.5) / 2 - 0.5)), y = Math.min(511, Math.max(0, (j + 0.5) / 2 - 0.5));
    const x0 = Math.min(510, Math.floor(x)), y0 = Math.min(510, Math.floor(y)), fx = x - x0, fy = y - y0;
    for (let ch = 0; ch < 3; ch++) {
      const at = (xx, yy) => dss.data[(yy * 512 + xx) * 4 + ch] / 255;
      out[ch] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  };
  const d3 = [0, 0, 0];
  let covered = 0, disc = 0, countGain = 0;
  for (let j = 0; j < OUT; j++) {
    for (let i = 0; i < OUT; i++) {
      const q = j * OUT + i;
      const r = Math.hypot(i - OUT / 2 + 0.5, j - OUT / 2 + 0.5) / (OUT / 2);
      if (r < 0.82) {
        disc++;
        if (inside[q] > 0) covered++;
      }
      if (inside[q] > 0 && sample(pic, k, map[q * 2], map[q * 2 + 1], px)) {
        photoPx.set(px, q * 3);
        if (inside[q] > feather && inside[q] < feather * 3 && r < 0.8) {
          countGain++;
          dssAt(i, j, d3);
          for (let ch = 0; ch < 3; ch++) {
            sums[ch] += px[ch];
            sums[3 + ch] += d3[ch];
          }
        }
      } else inside[q] = -1;
    }
  }
  // Black point: the photograph's darkest 2% of sky inside the disc goes to black.
  const black = [0, 1, 2].map((ch) => {
    const v = [];
    for (let j = 0; j < OUT; j += 2) for (let i = 0; i < OUT; i += 2) {
      const q = j * OUT + i;
      if (inside[q] > 0 && Math.hypot(i - OUT / 2, j - OUT / 2) < OUT * 0.41) v.push(photoPx[q * 3 + ch]);
    }
    v.sort((a, b) => a - b);
    return v.length ? Math.min(0.25, v[Math.floor(v.length * 0.02)]) : 0;
  });
  for (let q = 0; q < OUT * OUT; q++) {
    if (inside[q] <= 0) continue;
    for (let ch = 0; ch < 3; ch++) photoPx[q * 3 + ch] = Math.max(0, (photoPx[q * 3 + ch] - black[ch]) / (1 - black[ch]));
  }
  // The gain is measured after the black point (below).
  for (let i = 0; i < 3; i++) sums[i] = Math.max(0, sums[i] - black[i] * countGain) / (1 - black[i]);
  const gain = [0, 1, 2].map((ch) => (sums[3 + ch] > 1 ? Math.min(3, Math.max(0.3, sums[ch] / sums[3 + ch])) : 1));
  const img = Buffer.alloc(OUT * OUT * 4);
  for (let j = 0; j < OUT; j++) {
    for (let i = 0; i < OUT; i++) {
      const q = j * OUT + i;
      const r = Math.hypot(i - OUT / 2 + 0.5, j - OUT / 2 + 0.5) / (OUT / 2);
      const fade = Math.min(1, Math.max(0, (1 - r) / 0.18));
      const w = inside[q] <= 0 ? 0 : Math.min(1, inside[q] / feather);
      if (w < 1) dssAt(i, j, d3);
      for (let ch = 0; ch < 3; ch++) {
        const photo = w > 0 ? photoPx[q * 3 + ch] * fade : 0;
        // The survey picture is already faded at the edge.
        img[q * 4 + ch] = Math.round(255 * Math.min(1, w * photo + (1 - w) * d3[ch] * gain[ch]));
      }
      img[q * 4 + 3] = 255;
    }
  }
  const file = `nebula-photos/${slug(name)}.jpg`;
  const bytes = jpeg.encode({ data: img, width: OUT, height: OUT }, 84).data;
  writeFileSync(join(root, 'public/data', file), bytes);
  total += bytes.length;

  // The far view: its tile on atlas page 0, box-averaged down from the new picture.
  const T = page0.tile, f = OUT / T;
  const col = entry.tile % page0.cols, row = Math.floor(entry.tile / page0.cols);
  for (let j = 0; j < T; j++) {
    for (let i = 0; i < T; i++) {
      for (let ch = 0; ch < 3; ch++) {
        let s = 0;
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += img[((j * f + dy) * OUT + i * f + dx) * 4 + ch];
        atlas.data[((row * T + j) * atlas.width + col * T + i) * 4 + ch] = Math.round(s / (f * f));
      }
    }
  }
  entry.photo = file;
  entry.photoCredit = info.credit;
  const line = `${name.padEnd(28)} ${site}/${id.padEnd(18)} match ${best.r.toFixed(2)} (unshifted ${zero.toFixed(2)}${asGiven ? '' : `, ${best.parity < 0 ? 'mirrored' : ''}${best.rotSign < 0 ? ' rotation reversed' : ''}`}${best.fromTop ? ', reference row from the top' : ''}${best.dx || best.dy ? `, shifted ${best.dx},${best.dy} px of ${M}` : ''}) covers ${((100 * covered) / disc).toFixed(0)}%  ${(bytes.length / 1024).toFixed(0)} KB`;
  console.log(line);
  if (best.r < 0.2) console.warn(`  ⚠ ${name}: weak match with the survey plates; check the picture`);
}

writeFileSync(join(root, 'public/data', page0.file), jpeg.encode({ data: atlas.data, width: atlas.width, height: atlas.height }, 82).data);
index.photoSource = 'Observatory photographs (CC BY 4.0) from the image archives of ESO, ESA/Hubble, ESA/Webb and NSF NOIRLab, reprojected into the survey frame; credit lines in photoCredit.';
writeFileSync(join(root, 'public/data/nebula-images.json'), JSON.stringify(index) + '\n');
console.log(`${PHOTOS.length} photographs, ${(total / 1024 / 1024).toFixed(1)} MB`);
