#!/usr/bin/env node
/**
 * Build public/data/gaia-bright.bin: every star brighter than Gaia G = 8 whose parallax is measured
 * to better than 20% (about 62,000 stars, out to a few thousand light-years), from ESA Gaia DR3
 * (gea.esac.esa.int TAP). They are drawn on the Galaxy Map around the Sun.
 *
 * - Distances are 1 / parallax, after removing Gaia DR3's mean parallax zero-point of
 *   −0.017 mas (Lindegren et al. 2021).
 * - Temperatures are Gaia's GSP-Phot estimates where given. Otherwise they come from the star's
 *   BP−RP colour: the median temperature of the stars of the same colour in this sample.
 *
 * File layout (little-endian), struct of arrays for n stars:
 *   "GAIA" · uint32 n · uint32 version (1)
 *   int16[n]  galactic longitude × 180 (degrees, −180…180)
 *   int16[n]  galactic latitude × 360 (degrees)
 *   uint16[n] distance (parsecs)
 *   uint16[n] temperature (kelvin)
 *   uint16[n] G magnitude × 1000 (plus 2000, so negatives fit)
 *
 *   node scripts/build-gaia-bright.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const MAX_G = 8;
const MIN_POE = 5;
const ZERO_POINT = -0.017; // mas (Lindegren et al. 2021)
const cache = new URL('../node_modules/.cache/gaia/', import.meta.url);
mkdirSync(cache, { recursive: true });
const file = new URL(`bright-G${MAX_G}-poe${MIN_POE}.csv`, cache);

const ADQL = `SELECT l, b, parallax, phot_g_mean_mag, bp_rp, teff_gspphot
  FROM gaiadr3.gaia_source
  WHERE phot_g_mean_mag < ${MAX_G} AND parallax_over_error > ${MIN_POE} AND parallax > 0`;

if (!existsSync(file)) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch('https://gea.esac.esa.int/tap-server/tap/sync', {
        method: 'POST',
        body: new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', MAXREC: '500000', QUERY: ADQL }),
        signal: AbortSignal.timeout(600000),
      });
      const text = await res.text();
      if (res.ok && text.startsWith('l,')) {
        writeFileSync(file, text);
        break;
      }
      throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
    } catch (err) {
      if (attempt >= 5) throw err;
      console.warn(`Gaia archive: ${err.message}, retrying…`);
      await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt));
    }
  }
}

const lines = readFileSync(file, 'utf8').trim().split('\n');
const head = lines[0].split(',');
const col = Object.fromEntries(head.map((h, i) => [h, i]));
const num = (s) => (s === '' || s === undefined ? undefined : Number(s));
const rows = lines.slice(1).map((l) => l.split(','));
console.log(`Gaia DR3: ${rows.length} stars brighter than G = ${MAX_G} with parallax_over_error > ${MIN_POE}`);

// Colour → temperature from this sample's own GSP-Phot temperatures (bins of 0.05 mag).
const bins = new Map();
for (const r of rows) {
  const c = num(r[col.bp_rp]), t = num(r[col.teff_gspphot]);
  if (c === undefined || t === undefined) continue;
  const k = Math.round(c / 0.05);
  if (!bins.has(k)) bins.set(k, []);
  bins.get(k).push(t);
}
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const binTemp = new Map([...bins].filter(([, v]) => v.length >= 5).map(([k, v]) => [k, median(v)]));
const keys = [...binTemp.keys()].sort((a, b) => a - b);
function tempFromColour(c) {
  if (c === undefined) return 5800;
  const k = Math.round(c / 0.05);
  if (binTemp.has(k)) return binTemp.get(k);
  // Nearest bin.
  let best = keys[0];
  for (const q of keys) if (Math.abs(q - k) < Math.abs(best - k)) best = q;
  return binTemp.get(best);
}

const n = rows.length;
const header = 12;
const buf = Buffer.alloc(header + n * 10);
buf.write('GAIA', 0, 'ascii');
buf.writeUInt32LE(n, 4);
buf.writeUInt32LE(1, 8);
const off = { l: header, b: header + n * 2, d: header + n * 4, t: header + n * 6, g: header + n * 8 };
let farthest = 0;
rows.forEach((r, i) => {
  let l = num(r[col.l]);
  if (l > 180) l -= 360;
  const b = num(r[col.b]);
  const plx = num(r[col.parallax]) - ZERO_POINT;
  const d = Math.min(65535, Math.round(1000 / plx));
  farthest = Math.max(farthest, d);
  const t = Math.round(Math.min(65535, num(r[col.teff_gspphot]) ?? tempFromColour(num(r[col.bp_rp]))));
  const g = Math.round((num(r[col.phot_g_mean_mag]) + 2) * 1000);
  buf.writeInt16LE(Math.round(l * 180), off.l + i * 2);
  buf.writeInt16LE(Math.round(b * 360), off.b + i * 2);
  buf.writeUInt16LE(d, off.d + i * 2);
  buf.writeUInt16LE(t, off.t + i * 2);
  buf.writeUInt16LE(Math.max(0, Math.min(65535, g)), off.g + i * 2);
});
const out = new URL('../public/data/gaia-bright.bin', import.meta.url);
writeFileSync(out, buf);
console.log(`Wrote ${n} stars (${(buf.length / 1024).toFixed(0)} KB), farthest ${farthest} pc`);
