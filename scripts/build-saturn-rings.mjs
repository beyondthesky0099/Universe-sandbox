#!/usr/bin/env node
/**
 * Build public/data/saturn-rings.json from the NASA Saturnian Rings Fact Sheet
 * (https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html, NASA/GSFC, public domain).
 *
 * Extracts the inner/outer radius (km), optical depth and albedo of the C, B and A rings, the
 * Cassini Division between B and A, and the F ring.
 *
 * The named gaps (Encke, Keeler, Huygens, Maxwell, Colombo and the rest) come from the IAU ring
 * nomenclature table in the USGS Gazetteer of Planetary Nomenclature
 * (https://planetarynames.wr.usgs.gov/Page/Rings): each gap's radius or radial range, and its
 * width. A gap given as one radius is centred there; a width given as a range uses its middle.
 *
 *   node scripts/build-saturn-rings.mjs [path-to-saved-html]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const URL_SHEET = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html';
const html = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(URL_SHEET)).text();

const decode = (s) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();

/** label → cells after the label */
const rows = new Map();
for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
  const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => decode(m[1]));
  if (cells.length > 1 && cells[0]) rows.set(cells[0], cells.slice(1));
}

const km = (label) => {
  const cells = rows.get(label);
  const v = cells && Number(cells[0].replace(/,/g, ''));
  if (!Number.isFinite(v)) throw new Error(`No radius for "${label}" in the fact sheet`);
  return v;
};
/** "0.4 - 2.5" → midpoint; "0.1" → 0.1 */
const mid = (text) => {
  const nums = (text ?? '')
    .split('-')
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map(Number)
    .filter(Number.isFinite);
  return nums.length ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(3)) : undefined;
};
const col = (label, i) => rows.get(label)?.[i];

const rings = [
  { name: 'C ring', inner: km('C inner edge'), outer: km('C outer edge'), tau: mid(col('C inner edge', 2)), albedo: mid(col('C inner edge', 3)) },
  { name: 'B ring', inner: km('B inner edge'), outer: km('B outer edge'), tau: mid(col('B inner edge', 2)), albedo: mid(col('B inner edge', 3)) },
  // The Cassini Division row has no radius: it spans the B ring's outer edge to the A ring's inner edge.
  { name: 'Cassini Division', inner: km('B outer edge'), outer: km('A inner edge'), tau: mid(col('Cassini division', 1)), albedo: mid(col('Cassini division', 2)) },
  { name: 'A ring', inner: km('A inner edge'), outer: km('A outer edge'), tau: mid(col('A inner edge', 2)), albedo: mid(col('A inner edge', 3)) },
  // A narrow ring: give it a nominal 50 km width around its radius.
  { name: 'F ring', inner: km('F ring') - 25, outer: km('F ring') + 25, tau: mid(col('F ring', 2)), albedo: mid(col('F ring', 3)) },
];
const URL_IAU = 'https://planetarynames.wr.usgs.gov/Page/Rings';
const iau = await (await fetch(URL_IAU)).text();
const saturn = iau.slice(iau.indexOf('Rings of Saturn'));
const gaps = [];
for (const [, row] of saturn.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
  const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => decode(m[1]));
  if (cells.length < 3 || !/Gap$/.test(cells[0])) continue;
  const nums = (t) => t.split('-').map((x) => Number(x.replace(/,/g, '').trim())).filter(Number.isFinite);
  const where = nums(cells[1]);
  const widths = nums(cells[2]);
  const width = widths.reduce((a, b) => a + b, 0) / widths.length;
  const [inner, outer] = where.length === 2 ? where : [where[0] - width / 2, where[0] + width / 2];
  if (!Number.isFinite(inner) || !Number.isFinite(outer)) throw new Error(`Bad gap row: ${cells.join(' | ')}`);
  gaps.push({ name: cells[0], inner: Math.round(inner), outer: Math.round(outer) });
}
for (const name of ['Encke Gap', 'Keeler Gap', 'Huygens Gap']) if (!gaps.some((g) => g.name === name)) throw new Error(`${name} missing from the IAU table`);

const data = {
  source: `NASA Saturnian Rings Fact Sheet (${URL_SHEET}); gaps: IAU/USGS Gazetteer of Planetary Nomenclature (${URL_IAU})`,
  saturnEquatorialRadiusKm: km('Saturn Equator'),
  rings,
  gaps,
};
writeFileSync(new URL('../public/data/saturn-rings.json', import.meta.url), JSON.stringify(data, null, 1) + '\n');
console.log(rings.map((r) => `${r.name}: ${r.inner}–${r.outer} km, τ≈${r.tau}, albedo≈${r.albedo}`).join('\n'));
console.log(gaps.map((g) => `${g.name}: ${g.inner}–${g.outer} km`).join('\n'));
