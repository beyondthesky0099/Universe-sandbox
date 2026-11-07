#!/usr/bin/env node
/**
 * Build public/data/halley-2061.json: Comet 1P/Halley's next return, from NASA/JPL Horizons
 * (its orbit solution includes the comet's non-gravitational forces). Records the heliocentric
 * state a few months before perihelion for the app's starting point, and, for checking, the
 * time and distance of perihelion and of the closest approaches to Earth and Venus (daily
 * scan, refined hourly).
 *
 *   node scripts/build-halley.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const START = '2061-04-01';
const COMET = 'DES=1P;CAP;NOFRAG';
const CACHE = new URL('../node_modules/.cache/horizons/', import.meta.url);
mkdirSync(CACHE, { recursive: true });
const KM_PER_AU = 149597870.7;

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
        if (!json.result?.includes('$$SOE')) throw new Error(`Horizons: ${String(json.result ?? json.error).slice(0, 400)}`);
        writeFileSync(file, json.result);
        await new Promise((r) => setTimeout(r, 800));
        return json.result;
      }
      if (attempt >= 5) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= 5) throw err;
    }
    await new Promise((r) => setTimeout(r, 3000 * 2 ** Math.min(attempt, 4)));
  }
}

/** Rows of [JD (TDB), x, y, z (AU), vx, vy, vz (AU/day)], ecliptic J2000. */
async function vectors(center, time) {
  const r = await horizons({
    COMMAND: COMET, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'VECTORS', CENTER: center,
    REF_PLANE: 'ECLIPTIC', OUT_UNITS: 'AU-D', VEC_TABLE: '2', CSV_FORMAT: 'YES', ...time,
  });
  return r.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n').map((l) => {
    const c = l.split(',').map((s) => s.trim());
    return [Number(c[0]), ...c.slice(2, 8).map(Number)];
  });
}

const iso = (jd) => new Date((jd - 2440587.5) * 86400000).toISOString().slice(0, 16).replace('T', ' ');
async function closest(center, from, to) {
  const daily = await vectors(center, { START_TIME: from, STOP_TIME: to, STEP_SIZE: '1 d' });
  const d = daily.reduce((a, b) => (Math.hypot(b[1], b[2], b[3]) < Math.hypot(a[1], a[2], a[3]) ? b : a));
  const hourly = await vectors(center, { START_TIME: iso(d[0] - 1.5), STOP_TIME: iso(d[0] + 1.5), STEP_SIZE: '1 h' });
  const h = hourly.reduce((a, b) => (Math.hypot(b[1], b[2], b[3]) < Math.hypot(a[1], a[2], a[3]) ? b : a));
  return { jd: h[0], date: iso(h[0]), au: Math.hypot(h[1], h[2], h[3]), kms: (Math.hypot(h[4], h[5], h[6]) * KM_PER_AU) / 86400 };
}

const start = (await vectors('500@10', { TLIST: String(Date.parse(`${START}T00:00:00Z`) / 86400000 + 2440587.5) }))[0];
const perihelion = await closest('500@10', '2061-05-01', '2061-10-01');
const earth = await closest('500@399', '2061-05-01', '2061-10-01');
const venus = await closest('500@299', '2061-05-01', '2061-12-01');
const out = {
  source: 'NASA/JPL Horizons, 1P/Halley (orbit solution with non-gravitational forces); heliocentric ecliptic J2000, AU and AU/day, TDB',
  startJd: start[0],
  start: start.slice(1),
  perihelion,
  earthApproach: earth,
  venusApproach: venus,
};
writeFileSync(new URL('../public/data/halley-2061.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`Perihelion ${perihelion.date} at ${perihelion.au.toFixed(4)} AU (${perihelion.kms.toFixed(1)} km/s); closest to Earth ${earth.date} at ${earth.au.toFixed(4)} AU; to Venus ${venus.date} at ${venus.au.toFixed(4)} AU`);
