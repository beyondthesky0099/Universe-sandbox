#!/usr/bin/env node
/**
 * Build tests/fixtures/sky-reference.json: JPL Horizons topocentric azimuth/elevation (airless)
 * and the Moon's illuminated fraction for a few sites and times. tests/sky.test.ts checks the
 * planetarium's own calculation (src/sim/sky.ts) against these.
 *
 *   node scripts/build-sky-reference.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CACHE = new URL('../node_modules/.cache/horizons/', import.meta.url);
mkdirSync(CACHE, { recursive: true });

const SITES = [
  { name: 'Greenwich', lon: -0.0015, lat: 51.4778, km: 0.046 },
  { name: 'Mauna Kea', lon: -155.4681, lat: 19.8207, km: 4.2 },
  { name: 'Sydney', lon: 151.2093, lat: -33.8688, km: 0.05 },
];
// Horizons returns TLIST rows in time order, so keep these sorted.
const TIMES = ['2001-01-01T00:00:00Z', '2026-11-01T20:00:00Z', '2027-03-15T04:30:00Z', '2030-06-21T12:00:00Z'];
const TARGETS = { Sun: '10', Moon: '301', Mercury: '199', Venus: '299', Mars: '499', Jupiter: '599', Saturn: '699', Uranus: '799', Neptune: '899' };

async function horizons(params) {
  const url = new URL('https://ssd.jpl.nasa.gov/api/horizons.api');
  for (const [k, v] of Object.entries({ format: 'json', ...params })) url.searchParams.set(k, k === 'format' ? v : `'${v}'`);
  const file = new URL(createHash('sha1').update(url.href).digest('hex') + '.txt', CACHE);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (!json.result?.includes('$$SOE')) throw new Error(`Horizons: ${String(json.result ?? json.error).slice(0, 300)}`);
        writeFileSync(file, json.result);
        await new Promise((r) => setTimeout(r, 600));
        return json.result;
      }
      if (attempt >= 5) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= 5) throw err;
    }
    await new Promise((r) => setTimeout(r, 3000 * 2 ** Math.min(attempt, 4)));
  }
}

const jd = (iso) => Date.parse(iso) / 86400000 + 2440587.5;
const out = [];
for (const site of SITES) {
  for (const [name, id] of Object.entries(TARGETS)) {
    const r = await horizons({
      COMMAND: id,
      OBJ_DATA: 'NO',
      MAKE_EPHEM: 'YES',
      EPHEM_TYPE: 'OBSERVER',
      CENTER: 'coord@399',
      COORD_TYPE: 'GEODETIC',
      SITE_COORD: `${site.lon},${site.lat},${site.km}`,
      TLIST: TIMES.map(jd).join(' '),
      TIME_TYPE: 'UT',
      QUANTITIES: '4,10',
      ANG_FORMAT: 'DEG',
      APPARENT: 'AIRLESS',
      CSV_FORMAT: 'YES',
    });
    const header = r.split('$$SOE')[0].split('\n').reverse().find((l) => l.includes('Azi'));
    const cols = header.split(',').map((s) => s.trim());
    const iAz = cols.findIndex((c) => c.startsWith('Azi'));
    const iEl = cols.findIndex((c) => c.startsWith('Elev'));
    const iIl = cols.findIndex((c) => c.startsWith('Illu'));
    const rows = r.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n');
    rows.forEach((line, k) => {
      const c = line.split(',').map((s) => s.trim());
      out.push({ site: site.name, lat: site.lat, lon: site.lon, time: TIMES[k], body: name, az: Number(c[iAz]), alt: Number(c[iEl]), illumination: Number(c[iIl]) });
    });
  }
}
writeFileSync(
  new URL('../tests/fixtures/sky-reference.json', import.meta.url),
  JSON.stringify({ source: 'JPL Horizons observer tables: topocentric airless azimuth/elevation (deg) and illuminated fraction (%)', rows: out }, null, 1) + '\n',
);
console.log(`${out.length} reference positions`);
