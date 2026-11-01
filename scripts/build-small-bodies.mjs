#!/usr/bin/env node
/**
 * Build public/data/small-bodies.json: the brightest numbered asteroids and trans-Neptunian
 * objects (lowest absolute magnitude H) from the NASA/JPL Small-Body Database Query API.
 * These replace the illustrative asteroid belt in the Solar System scene.
 *
 *   node scripts/build-small-bodies.mjs
 */
import { writeFileSync } from 'node:fs';

const API = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api';
const LIMIT = 4000;

const url = new URL(API);
url.searchParams.set('fields', 'full_name,a,e,i,om,w,ma,epoch,class');
url.searchParams.set('sb-kind', 'a');
url.searchParams.set('sb-ns', 'n');
url.searchParams.set('sort', 'H');
url.searchParams.set('limit', String(LIMIT));

const res = await fetch(url);
if (!res.ok) throw new Error(`SBDB HTTP ${res.status}`);
const json = await res.json();

const classes = [];
const rows = [];
for (const [name, a, e, i, om, w, ma, epoch, cls] of json.data) {
  const nums = [a, e, i, om, w, ma, epoch].map(Number);
  if (nums.some((v) => !Number.isFinite(v)) || nums[1] >= 1) continue;
  let c = classes.indexOf(cls);
  if (c === -1) c = classes.push(cls) - 1;
  const round = (v, d) => Number(v.toFixed(d));
  rows.push([
    String(name).trim(),
    round(nums[0], 5),
    round(nums[1], 5),
    round(nums[2], 3),
    round(nums[3], 3),
    round(nums[4], 3),
    round(nums[5], 3),
    nums[6],
    c,
  ]);
}

const data = {
  source: 'NASA/JPL Small-Body Database (ssd-api.jpl.nasa.gov/sbdb_query.api), heliocentric ecliptic J2000 osculating elements',
  fields: ['name', 'a_au', 'e', 'i_deg', 'node_deg', 'peri_deg', 'M_deg', 'epoch_jd', 'class'],
  classes,
  bodies: rows,
};
writeFileSync(new URL('../public/data/small-bodies.json', import.meta.url), JSON.stringify(data) + '\n');
const counts = Object.fromEntries(classes.map((c, k) => [c, rows.filter((r) => r[8] === k).length]));
console.log(`Wrote ${rows.length} small bodies`, counts);
