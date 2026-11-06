#!/usr/bin/env node
/**
 * Build public/data/stars-100pc.json: every star within 100 parsecs (326 light-years) brighter
 * than Gaia G = 11, from ESA Gaia DR3 (gea.esac.esa.int TAP), with parallaxes measured to better
 * than 10%. Positions and space velocities are heliocentric, ecliptic J2000 (the app's frame).
 *
 * - Velocities combine Gaia's proper motions with its radial velocities; the ~10% of stars with
 *   no radial velocity are given only their motion across the sky (flagged).
 * - Temperatures are Gaia's GSP-Phot estimates where given; otherwise from the star's BP−RP
 *   colour, using the median temperature of the stars of the same colour in this very sample.
 * - Bright stars get their proper names from the HYG bright-star list (public/data/stars-bright.json),
 *   matched by direction.
 *
 *   node scripts/build-stars-100pc.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const MAX_PC = 100;
const MAX_G = 11;
const cache = new URL('../node_modules/.cache/gaia/', import.meta.url);
mkdirSync(cache, { recursive: true });
const file = new URL(`within-${MAX_PC}pc-G${MAX_G}.csv`, cache);

const ADQL = `SELECT source_id, ra, dec, parallax, pmra, pmdec, radial_velocity, phot_g_mean_mag, bp_rp, teff_gspphot
  FROM gaiadr3.gaia_source
  WHERE parallax > ${1000 / MAX_PC} AND parallax_over_error > 10 AND phot_g_mean_mag < ${MAX_G}`;

if (!existsSync(file)) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch('https://gea.esac.esa.int/tap-server/tap/sync', {
        method: 'POST',
        body: new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: ADQL }),
        signal: AbortSignal.timeout(600000),
      });
      const text = await res.text();
      if (res.ok && text.startsWith('source_id')) {
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
console.log(`Gaia DR3: ${rows.length} stars within ${MAX_PC} pc brighter than G = ${MAX_G}`);

// --- Colour → temperature, from this sample's own GSP-Phot temperatures -----------------------
const bins = new Map();
for (const r of rows) {
  const c = num(r[col.bp_rp]), t = num(r[col.teff_gspphot]);
  if (c === undefined || t === undefined) continue;
  const k = Math.round(c * 20); // 0.05-mag bins
  if (!bins.has(k)) bins.set(k, []);
  bins.get(k).push(t);
}
const binKeys = [...bins.keys()].filter((k) => bins.get(k).length >= 10).sort((a, b) => a - b);
const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
const table = binKeys.map((k) => [k / 20, median(bins.get(k))]);
function teffFromColour(c) {
  if (c <= table[0][0]) return table[0][1];
  if (c >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 1; i < table.length; i++) {
    if (c <= table[i][0]) {
      const [c0, t0] = table[i - 1], [c1, t1] = table[i];
      return t0 + ((c - c0) / (c1 - c0)) * (t1 - t0);
    }
  }
  return 5800;
}

// --- Names of bright stars, by direction (HYG bright-star list) -------------------------------
const OBL = (23.4392911 * Math.PI) / 180;
const toEcliptic = (x, y, z) => [x, Math.cos(OBL) * y + Math.sin(OBL) * z, -Math.sin(OBL) * y + Math.cos(OBL) * z];
const bright = JSON.parse(readFileSync(new URL('../public/data/stars-bright.json', import.meta.url), 'utf8')).stars.filter((s) => s[5]);

const DEG = Math.PI / 180;
const KMS_TO_PC_PER_YR = 1 / 977792.2;
const out = [];
const names = [];
let noRv = 0;
for (const r of rows) {
  const ra = num(r[col.ra]) * DEG, dec = num(r[col.dec]) * DEG;
  const d = 1000 / num(r[col.parallax]); // pc
  const rhat = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const ahat = [-Math.sin(ra), Math.cos(ra), 0];
  const dhat = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
  const rv = num(r[col.radial_velocity]);
  if (rv === undefined) noRv++;
  const k = (4.74047 * d) / 1000;
  const pmra = num(r[col.pmra]) ?? 0, pmdec = num(r[col.pmdec]) ?? 0;
  const v = [0, 1, 2].map((i) => (rv ?? 0) * rhat[i] + k * (pmra * ahat[i] + pmdec * dhat[i])); // km/s
  const [x, y, z] = toEcliptic(...rhat.map((c) => c * d));
  const [vx, vy, vz] = toEcliptic(...v);
  const g = num(r[col.phot_g_mean_mag]);
  const absG = g + 5 * Math.log10(num(r[col.parallax]) / 100);
  const teff = num(r[col.teff_gspphot]) ?? (num(r[col.bp_rp]) !== undefined ? teffFromColour(num(r[col.bp_rp])) : 5800);
  const i = out.length / 9;
  // x, y, z (pc), vx, vy, vz (km/s), Teff (K), absolute G, radial velocity measured (1/0)
  out.push(+x.toFixed(2), +y.toFixed(2), +z.toFixed(2), +vx.toFixed(1), +vy.toFixed(1), +vz.toFixed(1), Math.round(teff / 10) * 10, +absG.toFixed(2), rv === undefined ? 0 : 1);
  if (g < 4.5) {
    const [ux, uy, uz] = toEcliptic(...rhat);
    const match = bright.find((s) => s[0] * ux + s[1] * uy + s[2] * uz > Math.cos(0.15 * DEG) && Math.abs(s[3] - g) < 1.2);
    if (match) names.push([i, match[5]]);
  }
}
writeFileSync(
  new URL('../public/data/stars-100pc.json', import.meta.url),
  JSON.stringify({
    source: `ESA Gaia DR3 (Gaia Collaboration, Vallenari et al. 2023): stars within ${MAX_PC} pc with G < ${MAX_G} and parallax_over_error > 10. Names from the HYG database v4.1 (CC BY-SA 4.0).`,
    frame: 'heliocentric ecliptic J2000; positions in pc, velocities in km/s',
    fields: ['x', 'y', 'z', 'vx', 'vy', 'vz', 'teffK', 'absG', 'hasRadialVelocity'],
    stride: 9,
    stars: out,
    names,
  }) + '\n',
);
console.log(`${out.length / 9} stars written (${noRv} without radial velocity), ${names.length} named; colour→Teff table from ${table.length} bins`);
