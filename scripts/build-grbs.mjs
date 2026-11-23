#!/usr/bin/env node
/**
 * Build public/data/grbs.json: every gamma-ray burst with a measured redshift and an arcsecond-to-
 * arcminute position, from Jochen Greiner's table of localized GRBs (Max Planck Institute for
 * Extraterrestrial Physics, https://www.mpe.mpg.de/~jcg/grbgen.html). Rows whose redshift is
 * uncertain ("?", ranges, photometric limits) are left out.
 *
 * These are the bursts behind the claimed Hercules–Corona Borealis Great Wall (Horváth, Hakkila &
 * Bagoly 2014, A&A 561, L12): an excess of bursts at redshift 1.6–2.1 towards Hercules and Corona
 * Borealis. The Universe view draws them all at their comoving distances.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/build-grbs.mjs   (behind a proxy; plain node otherwise)
 */
import { writeFileSync } from 'node:fs';

const URL_TABLE = 'https://www.mpe.mpg.de/~jcg/grbgen.html';
const res = await fetch(URL_TABLE);
if (!res.ok) throw new Error(`GRB table: HTTP ${res.status}`);
const page = Buffer.from(await res.arrayBuffer()).toString('latin1');

const text = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&#176;/g, '°')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const bursts = [];
for (const row of page.split(/<TR VALIGN="TOP">/i).slice(1)) {
  const cells = [...row.matchAll(/<TD[^>]*>([\s\S]*?)<\/TD>/gi)].map((m) => text(m[1]));
  if (cells.length < 10) continue;
  const [name, pos] = cells;
  const z = cells[9];
  const p = pos.match(/(\d+)h\s*(\d+)m\s*([\d.]+)s\s*([+\-−])\s*(\d+)°\s*(\d+)'?/);
  if (!p || !/^\d*\.?\d+$/.test(z) || !/^\d{6}/.test(name)) continue;
  const ra = (Number(p[1]) + Number(p[2]) / 60 + Number(p[3]) / 3600) * 15;
  const dec = (Number(p[5]) + Number(p[6]) / 60) * (p[4] === '+' ? 1 : -1);
  bursts.push([`GRB ${name}`, Math.round(ra * 1000) / 1000, Math.round(dec * 1000) / 1000, Number(z)]);
}
if (bursts.length < 400) throw new Error(`only ${bursts.length} bursts parsed: has the table changed?`);
bursts.sort((a, b) => a[0].localeCompare(b[0]));
writeFileSync(
  new URL('../public/data/grbs.json', import.meta.url),
  JSON.stringify({ source: `Gamma-ray bursts with measured redshifts, from J. Greiner's table of localized GRBs (${URL_TABLE})`, columns: ['name', 'raDeg', 'decDeg', 'z'], bursts }) + '\n',
);
console.log(`${bursts.length} bursts with redshifts`);
