#!/usr/bin/env node
/**
 * Build public/data/spacecraft.json: real trajectories of deep-space missions from NASA/JPL
 * Horizons. Heliocentric ecliptic J2000 position and velocity every STEP_DAYS days over each
 * craft's ephemeris coverage (clamped to 1972–2035). The app interpolates between samples.
 *
 *   node scripts/build-spacecraft.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const STEP_DAYS = 10;
const CACHE = new URL('../node_modules/.cache/horizons/', import.meta.url);
mkdirSync(CACHE, { recursive: true });

/** [Horizons ID, display name, one-line description] */
const CRAFT = [
  ['-31', 'Voyager 1', 'Launched 1977. Flew past Jupiter and Saturn; the most distant human-made object, in interstellar space since 2012.'],
  ['-32', 'Voyager 2', 'Launched 1977. The only spacecraft to visit Uranus and Neptune; in interstellar space since 2018.'],
  ['-23', 'Pioneer 10', 'Launched 1972. First spacecraft to cross the asteroid belt and fly past Jupiter. Contact lost in 2003.'],
  ['-24', 'Pioneer 11', 'Launched 1973. First spacecraft to fly past Saturn. Contact lost in 1995.'],
  ['-98', 'New Horizons', 'Launched 2006. Flew past Pluto in 2015 and the Kuiper belt object Arrokoth in 2019.'],
  ['-96', 'Parker Solar Probe', 'Launched 2018. Dives through the Sun’s corona; the fastest human-made object.'],
  ['-170', 'James Webb Space Telescope', 'Launched 2021. Infrared observatory orbiting the Sun–Earth L2 point, 1.5 million km from Earth.'],
  ['-61', 'Juno', 'Launched 2011. Orbiting Jupiter since 2016.'],
  ['-159', 'Europa Clipper', 'Launched 2024. On its way to Jupiter’s moon Europa (arrival 2030).'],
  ['-28', 'JUICE', 'ESA’s Jupiter Icy Moons Explorer, launched 2023 (arrival 2031).'],
  ['-49', 'Lucy', 'Launched 2021. Touring the Trojan asteroids that share Jupiter’s orbit.'],
  ['-121', 'BepiColombo', 'ESA/JAXA mission to Mercury, launched 2018.'],
  ['-255', 'Psyche', 'Launched 2023. Bound for the metal-rich asteroid 16 Psyche (arrival 2029).'],
  ['-82', 'Cassini', 'Orbited Saturn 2004–2017, ending with a dive into Saturn.'],
  ['-77', 'Galileo', 'Orbited Jupiter 1995–2003, ending with a dive into Jupiter.'],
  ['-226', 'Rosetta', 'ESA mission that orbited comet 67P 2014–2016 and landed Philae on it.'],
];

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

async function horizons(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', ...params })) url.searchParams.set(k, k === 'format' ? v : `'${v}'`);
  const file = new URL(createHash('sha1').update(url.href).digest('hex') + '.txt', CACHE);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const text = json.result ?? json.error ?? '';
        writeFileSync(file, text);
        await new Promise((r) => setTimeout(r, 800));
        return text;
      }
      if (attempt >= 5) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= 5) throw err;
    }
    await new Promise((r) => setTimeout(r, 3000 * 2 ** Math.min(attempt, 4)));
  }
}

/** "A.D. 2017-SEP-15 11:58:00" → "2017-09-15" */
function parseDate(text) {
  const m = text.match(/(\d{4})-([A-Z]{3})-(\d{2})/);
  return m ? `${m[1]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[3]}` : undefined;
}

function shiftDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

async function vectors(id, start, stop) {
  for (let tries = 0; tries < 4; tries++) {
    const r = await horizons({
      COMMAND: id,
      OBJ_DATA: 'NO',
      MAKE_EPHEM: 'YES',
      EPHEM_TYPE: 'VECTORS',
      CENTER: '500@10',
      START_TIME: start,
      STOP_TIME: stop,
      STEP_SIZE: `${STEP_DAYS}d`,
      REF_PLANE: 'ECLIPTIC',
      OUT_UNITS: 'AU-D',
      VEC_TABLE: '2',
      CSV_FORMAT: 'YES',
    });
    if (r.includes('$$SOE')) return r;
    // Clamp to the craft's ephemeris coverage and try again.
    const prior = r.match(/prior to (A\.D\. [^\n]*)/);
    const after = r.match(/after (A\.D\. [^\n]*)/);
    if (prior) start = shiftDays(parseDate(prior[1]), 2);
    else if (after) stop = shiftDays(parseDate(after[1]), -1);
    else throw new Error(`${id}: ${r.slice(0, 300)}`);
  }
  throw new Error(`${id}: could not find ephemeris coverage`);
}

const out = [];
for (const [id, name, about] of CRAFT) {
  const text = await vectors(id, '1972-03-10', '2035-01-01');
  const rows = text
    .split('$$SOE')[1]
    .split('$$EOE')[0]
    .trim()
    .split('\n')
    .map((l) => l.split(',').map((c) => c.trim()));
  const startJd = Number(rows[0][0]);
  const r = (v, d) => Number(Number(v).toFixed(d));
  // [x, y, z (AU), vx, vy, vz (AU/day)] per sample
  const samples = rows.map((c) => [r(c[2], 6), r(c[3], 6), r(c[4], 6), r(c[5], 8), r(c[6], 8), r(c[7], 8)]);
  out.push({ id: Number(id), name, about, startJd, stepDays: STEP_DAYS, samples });
  const endJd = startJd + (samples.length - 1) * STEP_DAYS;
  const iso = (jd) => new Date((jd - 2440587.5) * 86400000).toISOString().slice(0, 10);
  console.log(`${name}: ${samples.length} samples, ${iso(startJd)} → ${iso(endJd)}`);
}

writeFileSync(
  new URL('../public/data/spacecraft.json', import.meta.url),
  JSON.stringify({
    source: 'NASA/JPL Horizons (ssd.jpl.nasa.gov/horizons): heliocentric ecliptic J2000 state vectors, AU and AU/day',
    craft: out,
  }) + '\n',
);
