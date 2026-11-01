#!/usr/bin/env node
/**
 * Build public/data/exoplanets.json from the NASA Exoplanet Archive.
 *
 *   node scripts/build-exoplanets.mjs            # downloads the latest catalogue
 *   node scripts/build-exoplanets.mjs file.csv   # uses a local CSV export of pscomppars
 *
 * Output groups planets by host star in compact arrays (see HOST_FIELDS / PLANET_FIELDS).
 * Data: NASA Exoplanet Archive, Planetary Systems Composite Parameters (pscomppars).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const COLUMNS =
  'pl_name,hostname,sy_dist,ra,dec,st_mass,st_rad,st_teff,st_lum,st_age,pl_orbsmax,pl_orbper,pl_orbeccen,pl_orbincl,pl_bmasse,pl_rade,pl_eqt,disc_year,sy_pnum,sy_snum';
const ARCHIVE_URL = `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+${COLUMNS}+from+pscomppars&format=csv`;

function parseCsv(text) {
  const rows = [];
  for (const line of text.trim().split('\n')) {
    const out = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}

const num = (s, digits = 4) => {
  if (s === '' || s === undefined) return null;
  const v = Number(s);
  return Number.isFinite(v) ? Number(v.toPrecision(digits)) : null;
};

const csv = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(ARCHIVE_URL)).text();
const [header, ...rows] = parseCsv(csv);
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const hosts = new Map();
for (const r of rows) {
  const g = (k) => r[col[k]];
  const name = g('hostname');
  if (!hosts.has(name)) {
    hosts.set(name, {
      host: [name, num(g('sy_dist'), 5), num(g('ra'), 6), num(g('dec'), 6), num(g('st_mass')), num(g('st_rad')), num(g('st_teff')), num(g('st_age')), Number(g('sy_snum')) || 1],
      planets: [],
    });
  }
  const plName = g('pl_name');
  const suffix = plName.startsWith(name) ? plName.slice(name.length).trim() : plName;
  hosts.get(name).planets.push([
    suffix,
    num(g('pl_orbsmax'), 5),
    num(g('pl_orbper'), 6),
    num(g('pl_orbeccen'), 3),
    num(g('pl_orbincl'), 4),
    num(g('pl_bmasse'), 4),
    num(g('pl_rade'), 4),
    num(g('pl_eqt'), 4),
    Number(g('disc_year')) || null,
  ]);
}
const out = {
  source: 'NASA Exoplanet Archive, Planetary Systems Composite Parameters (pscomppars)',
  acknowledgement:
    'This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program.',
  retrieved: new Date().toISOString().slice(0, 10),
  hostFields: ['name', 'distancePc', 'raDeg', 'decDeg', 'massSun', 'radiusSun', 'teffK', 'ageGyr', 'starsInSystem'],
  planetFields: ['suffix', 'aAU', 'periodDays', 'ecc', 'inclDeg', 'massEarth', 'radiusEarth', 'eqTempK', 'discoveryYear'],
  systems: [...hosts.values()].map((h) => [...h.host, h.planets]),
};
writeFileSync(new URL('../public/data/exoplanets.json', import.meta.url), JSON.stringify(out));
console.log(`${out.systems.length} systems, ${rows.length} planets`);
