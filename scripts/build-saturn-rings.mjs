#!/usr/bin/env node
/**
 * Build public/data/saturn-rings.json from the NASA Saturnian Rings Fact Sheet
 * (https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html, NASA/GSFC, public domain).
 *
 * Extracts the inner/outer radius (km), optical depth and albedo of the C, B and A rings, the
 * Cassini Division between B and A, and the F ring.
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
const gaps = [
  { name: 'Encke Gap', radius: km('Encke gap') },
  { name: 'Keeler Gap', radius: km('Keeler gap') },
];

const data = { source: `NASA Saturnian Rings Fact Sheet (${URL_SHEET})`, saturnEquatorialRadiusKm: km('Saturn Equator'), rings, gaps };
writeFileSync(new URL('../public/data/saturn-rings.json', import.meta.url), JSON.stringify(data, null, 1) + '\n');
console.log(rings.map((r) => `${r.name}: ${r.inner}–${r.outer} km, τ≈${r.tau}, albedo≈${r.albedo}`).join('\n'));
