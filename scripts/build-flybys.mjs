#!/usr/bin/env node
/**
 * Build public/data/flybys.json: upcoming close approaches of asteroids to Earth from the JPL
 * Close-Approach Data API (ssd-api.jpl.nasa.gov/cad.api), with geocentric state vectors of the
 * asteroid, the Moon and the Sun from JPL Horizons a few days before each approach, so the app
 * can fly the encounter with real starting conditions.
 *
 *   node scripts/build-flybys.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const LEAD_DAYS = 4;
const MAX_EVENTS = 8;
const CACHE = new URL('../node_modules/.cache/horizons/', import.meta.url);
mkdirSync(CACHE, { recursive: true });

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (attempt >= 5) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= 5) throw err;
    }
    await new Promise((r) => setTimeout(r, 3000 * 2 ** Math.min(attempt, 4)));
  }
}

async function horizons(params) {
  const url = new URL('https://ssd.jpl.nasa.gov/api/horizons.api');
  for (const [k, v] of Object.entries({ format: 'json', ...params })) url.searchParams.set(k, k === 'format' ? v : `'${v}'`);
  const file = new URL(createHash('sha1').update(url.href).digest('hex') + '.txt', CACHE);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const json = await getJson(url);
  if (!json.result?.includes('$$SOE')) throw new Error(`Horizons: ${String(json.result ?? json.error).slice(0, 300)}`);
  writeFileSync(file, json.result);
  await new Promise((r) => setTimeout(r, 800));
  return json.result;
}

/** Geocentric ecliptic J2000 state [x, y, z (AU), vx, vy, vz (AU/day)] at a Julian date. */
async function geocentric(command, jd) {
  const r = await horizons({
    COMMAND: command,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: '500@399',
    TLIST: String(jd),
    REF_PLANE: 'ECLIPTIC',
    OUT_UNITS: 'AU-D',
    VEC_TABLE: '2',
    CSV_FORMAT: 'YES',
  });
  const cols = r.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n')[0].split(',').map((c) => c.trim());
  return cols.slice(2, 8).map(Number);
}

const cad = await getJson('https://ssd-api.jpl.nasa.gov/cad.api?date-min=2026-11-01&date-max=2040-01-01&dist-max=0.01&h-max=24&sort=dist');
const f = Object.fromEntries(cad.fields.map((k, i) => [k, i]));
const out = [];
for (const row of cad.data) {
  const dist = Number(row[f.dist]);
  const spread = (Number(row[f.dist_max]) - Number(row[f.dist_min])) / dist;
  if (spread > 0.05) continue; // keep only well-determined orbits
  const des = row[f.des];
  const jd = Number(row[f.jd]);
  const start = jd - LEAD_DAYS;
  const command = /^\d+$/.test(des) ? `${des};` : `DES=${des};`;
  const [asteroid, moon, sun] = [await geocentric(command, start), await geocentric('301', start), await geocentric('10', start)];
  out.push({
    des,
    name: des === '99942' ? '99942 Apophis' : des,
    date: row[f.cd],
    jd,
    distAu: dist,
    vRelKms: Number(row[f.v_rel]),
    h: Number(row[f.h]),
    startJd: start,
    states: { asteroid, moon, sun },
  });
  console.log(`${des}: ${row[f.cd]} at ${(dist * 149597870.7).toFixed(0)} km`);
  if (out.length >= MAX_EVENTS) break;
}

writeFileSync(
  new URL('../public/data/flybys.json', import.meta.url),
  JSON.stringify(
    {
      source: 'JPL Close-Approach Data API and JPL Horizons; geocentric ecliptic J2000 states (AU, AU/day) four days before closest approach',
      flybys: out,
    },
    null,
    1,
  ) + '\n',
);
