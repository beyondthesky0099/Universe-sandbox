#!/usr/bin/env node
/**
 * Build public/data/eclipses.json: central solar eclipses (total, annular, hybrid) from NASA's
 * Five Millennium Canon catalogue (Espenak & Meeus, eclipse.gsfc.nasa.gov), with JPL Horizons
 * apparent geocentric positions (RA/Dec of date, distance) of the Sun and Moon every 5 minutes
 * across each eclipse, so the app can trace the Moon's shadow over the Earth. The catalogue's
 * own values (time and place of greatest eclipse, gamma, path width, duration) are kept so the
 * tests can check the app's shadow geometry against them.
 *
 *   node scripts/build-eclipses.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FROM = 2024;
const TO = 2035;
const STEP_MIN = 5;
const HALF_SPAN_MIN = 200; // ±3 h 20 min around greatest eclipse covers every shadow on Earth
const CACHE = new URL('../node_modules/.cache/eclipse/', import.meta.url);
mkdirSync(CACHE, { recursive: true });

async function cached(url, name = createHash('sha1').update(url).digest('hex') + '.txt', validate = () => true) {
  const file = new URL(name, CACHE);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        if (validate(text)) {
          writeFileSync(file, text);
          await new Promise((r) => setTimeout(r, 600));
          return text;
        }
        if (attempt >= 6) throw new Error(`Unexpected response from ${url}: ${text.slice(0, 300)}`);
      } else if (attempt >= 6) throw new Error(`HTTP ${res.status} ${url}`);
    } catch (err) {
      if (attempt >= 6) throw err;
    }
    await new Promise((r) => setTimeout(r, 4000 * 2 ** Math.min(attempt, 4)));
  }
}

// --- NASA catalogue -----------------------------------------------------------------------
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const catHtml = await cached('https://eclipse.gsfc.nasa.gov/SEcat5/SE2001-2100.html', 'cat.html');
const catalogue = [];
for (const line of catHtml.replace(/<[^>]*>/g, '').split('\n')) {
  const m = line.match(
    /^\s*(\d{5})\s+(\d{4}) (\w{3}) (\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d+)\s+(-?\d+)\s+(\d+)\s+([TAH])\S*\s+\S+\s+(-?\d\.\d+)\s+(\d\.\d+)\s+(\d+)([NS])\s+(\d+)([EW])\s+(\d+)\s+(\d+|-)\s+(\d{2})m(\d{2})s/,
  );
  if (!m) continue;
  const year = Number(m[2]);
  if (year < FROM || year > TO) continue;
  const [hh, mm, ss] = [m[5], m[6], m[7]].map(Number);
  const tdMs = Date.UTC(year, MONTHS[m[3]] - 1, Number(m[4]), hh, mm, ss);
  catalogue.push({
    id: m[1],
    date: `${m[2]}-${String(MONTHS[m[3]]).padStart(2, '0')}-${m[4]}`,
    type: { T: 'total', A: 'annular', H: 'hybrid' }[m[11]],
    greatestTD: new Date(tdMs).toISOString().slice(0, 19).replace('T', ' '),
    greatestJdTD: tdMs / 86400000 + 2440587.5,
    deltaT: Number(m[8]),
    saros: Number(m[10]),
    gamma: Number(m[12]),
    magnitude: Number(m[13]),
    lat: Number(m[14]) * (m[15] === 'S' ? -1 : 1),
    lon: Number(m[16]) * (m[17] === 'W' ? -1 : 1),
    sunAlt: Number(m[18]),
    widthKm: m[19] === '-' ? null : Number(m[19]),
    durationSec: Number(m[20]) * 60 + Number(m[21]),
  });
}
console.log(`${catalogue.length} central eclipses ${FROM}–${TO} in NASA's catalogue`);

// --- Horizons positions ---------------------------------------------------------------------
function horizonsUrl(params) {
  const url = new URL('https://ssd.jpl.nasa.gov/api/horizons.api');
  for (const [k, v] of Object.entries({ format: 'text', ...params })) url.searchParams.set(k, k === 'format' ? v : `'${v}'`);
  return url.href;
}
const iso = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/** Rows of [RA (deg), Dec (deg), distance (AU)], apparent geocentric of date, at TT times. */
async function track(command, startMs, stopMs) {
  const text = await cached(
    horizonsUrl({
      COMMAND: command,
      OBJ_DATA: 'NO',
      MAKE_EPHEM: 'YES',
      EPHEM_TYPE: 'OBSERVER',
      CENTER: '500@399',
      START_TIME: iso(startMs),
      STOP_TIME: iso(stopMs),
      STEP_SIZE: `${STEP_MIN} m`,
      TIME_TYPE: 'TT',
      QUANTITIES: '2,20,30',
      ANG_FORMAT: 'DEG',
      EXTRA_PREC: 'YES',
      CSV_FORMAT: 'YES',
    }),
    undefined,
    (t) => t.includes('$$SOE'),
  );
  const header = text.split('$$SOE')[0].trim().split('\n').reverse().find((l) => l.includes('Date__'));
  const cols = header.split(',').map((s) => s.trim());
  const iRa = cols.findIndex((c) => c.startsWith('R.A.'));
  const iDec = cols.findIndex((c) => c.startsWith('DEC'));
  const iDelta = cols.findIndex((c) => c === 'delta');
  const iDt = cols.findIndex((c) => /^TDB-UT$|delta-T|Delta-T|TT-UT/i.test(c));
  if (iRa < 0 || iDec < 0 || iDelta < 0) throw new Error(`Unexpected Horizons columns: ${header}`);
  const rows = text.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n').map((l) => l.split(',').map((s) => s.trim()));
  return { rows: rows.map((c) => [Number(c[iRa]), Number(c[iDec]), Number(c[iDelta])]), deltaT: iDt >= 0 ? Number(rows[0][iDt]) : undefined };
}

const out = [];
for (const e of catalogue) {
  const tdMs = (e.greatestJdTD - 2440587.5) * 86400000;
  const start = Math.round((tdMs - HALF_SPAN_MIN * 60000) / (STEP_MIN * 60000)) * STEP_MIN * 60000;
  const stop = start + 2 * HALF_SPAN_MIN * 60000;
  const sun = await track('10', start, stop);
  const moon = await track('301', start, stop);
  if (sun.rows.length !== moon.rows.length) throw new Error(`${e.date}: Sun and Moon tables differ in length`);
  const round = (r) => [Number(r[0].toFixed(7)), Number(r[1].toFixed(7)), Number(r[2].toPrecision(12))];
  out.push({
    ...e,
    /** TT − UT used by Horizons (s); the NASA catalogue's own ΔT for future dates is an extrapolation. */
    horizonsDeltaT: sun.deltaT ?? moon.deltaT ?? null,
    startJdTT: start / 86400000 + 2440587.5,
    stepMin: STEP_MIN,
    sun: sun.rows.map(round),
    moon: moon.rows.map(round),
  });
  console.log(`${e.date} ${e.type}: ${sun.rows.length} samples, Horizons ΔT ${sun.deltaT ?? '?'} s`);
}

writeFileSync(
  new URL('../public/data/eclipses.json', import.meta.url),
  JSON.stringify(
    {
      source:
        "Eclipse list and reference values: NASA Five Millennium Canon of Solar Eclipses (Espenak & Meeus), eclipse.gsfc.nasa.gov. Sun and Moon: JPL Horizons apparent geocentric RA/Dec (of date, degrees) and distance (AU) every 5 minutes, TT.",
      eclipses: out,
    },
    null,
    0,
  ) + '\n',
);
