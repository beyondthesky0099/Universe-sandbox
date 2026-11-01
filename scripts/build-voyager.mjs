#!/usr/bin/env node
/**
 * Build public/data/voyager-encounters.json: the Voyager planetary flybys (the "Grand Tour")
 * from NASA/JPL Horizons. For each encounter it finds the time and distance of closest approach
 * (searching the spacecraft's planetocentric vectors at one-minute steps), then records, two days
 * before it, the planetocentric states of the spacecraft, the planet's major moons and the Sun,
 * so the app can fly the encounter with real starting conditions and check the result.
 *
 *   node scripts/build-voyager.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const LEAD_DAYS = 2;
const CACHE = new URL('../node_modules/.cache/horizons/', import.meta.url);
mkdirSync(CACHE, { recursive: true });

const MOONS = {
  Jupiter: ['501', '502', '503', '504'],
  Saturn: ['601', '602', '603', '604', '605', '606', '608'],
  Uranus: ['705', '701', '702', '703', '704'],
  Neptune: ['801'],
};
const PLANET_ID = { Jupiter: '599', Saturn: '699', Uranus: '799', Neptune: '899' };
const MOON_NAMES = {
  501: 'Io', 502: 'Europa', 503: 'Ganymede', 504: 'Callisto',
  601: 'Mimas', 602: 'Enceladus', 603: 'Tethys', 604: 'Dione', 605: 'Rhea', 606: 'Titan', 608: 'Iapetus',
  701: 'Ariel', 702: 'Umbriel', 703: 'Titania', 704: 'Oberon', 705: 'Miranda',
  801: 'Triton',
};

/** [spacecraft, Horizons id, planet, approximate date, what it found] */
const ENCOUNTERS = [
  ['Voyager 1', '-31', 'Jupiter', '1979-03-05', 'Discovered active volcanoes on Io, the first seen beyond Earth, and Jupiter’s faint ring.'],
  ['Voyager 1', '-31', 'Saturn', '1980-11-12', 'Flew 6,500 km from Titan to study its thick atmosphere, which bent its path up and out of the planets’ plane for good.'],
  ['Voyager 2', '-32', 'Jupiter', '1979-07-09', 'Mapped Europa’s cracked ice shell, the first hint of the ocean beneath it.'],
  ['Voyager 2', '-32', 'Saturn', '1981-08-26', 'Imaged the rings’ thousands of ringlets and the moons Enceladus and Tethys; Saturn’s gravity bent its path on to Uranus.'],
  ['Voyager 2', '-32', 'Uranus', '1986-01-24', 'The only visit to Uranus: found 10 new moons, two new rings and Miranda’s jumbled cliffs.'],
  ['Voyager 2', '-32', 'Neptune', '1989-08-25', 'The only visit to Neptune: skimmed 4,950 km over its north pole, found the Great Dark Spot and Triton’s nitrogen geysers.'],
];

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
  if (!json.result?.includes('$$SOE')) throw new Error(`Horizons: ${String(json.result ?? json.error).slice(0, 400)}`);
  writeFileSync(file, json.result);
  await new Promise((r) => setTimeout(r, 800));
  return json.result;
}

/** Rows of [jd (UT), x, y, z (AU), vx, vy, vz (AU/day)], ecliptic J2000, relative to `center`. */
async function vectors(command, center, timeParams) {
  const r = await horizons({
    COMMAND: command,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: `500@${center}`,
    REF_PLANE: 'ECLIPTIC',
    OUT_UNITS: 'AU-D',
    VEC_TABLE: '2',
    TIME_TYPE: 'UT',
    CSV_FORMAT: 'YES',
    ...timeParams,
  });
  return r
    .split('$$SOE')[1]
    .split('$$EOE')[0]
    .trim()
    .split('\n')
    .map((line) => {
      const c = line.split(',').map((s) => s.trim());
      return [Number(c[0]), ...c.slice(2, 8).map(Number)];
    });
}

const KM_PER_AU = 149597870.7;

function jdToIso(jd) {
  return new Date((jd - 2440587.5) * 86400000).toISOString().slice(0, 16).replace('T', ' ');
}

/** Closest approach: a 10-minute scan over ±2 days, refined at one-minute steps. */
async function closestApproach(craft, center, date) {
  const day = Date.parse(`${date}T00:00:00Z`);
  const iso = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  const coarse = await vectors(craft, center, { START_TIME: iso(day - 2 * 86400000), STOP_TIME: iso(day + 3 * 86400000), STEP_SIZE: '10 m' });
  const best = coarse.reduce((a, b) => (Math.hypot(b[1], b[2], b[3]) < Math.hypot(a[1], a[2], a[3]) ? b : a));
  const t = (best[0] - 2440587.5) * 86400000;
  const fine = await vectors(craft, center, { START_TIME: iso(t - 15 * 60000), STOP_TIME: iso(t + 15 * 60000), STEP_SIZE: '1 m' });
  const ca = fine.reduce((a, b) => (Math.hypot(b[1], b[2], b[3]) < Math.hypot(a[1], a[2], a[3]) ? b : a));
  return { jd: ca[0], km: Math.hypot(ca[1], ca[2], ca[3]) * KM_PER_AU, kms: (Math.hypot(ca[4], ca[5], ca[6]) * KM_PER_AU) / 86400 };
}

const out = [];
for (const [craft, id, planet, date, about] of ENCOUNTERS) {
  const center = PLANET_ID[planet];
  const ca = await closestApproach(id, center, date);
  const startJd = Math.round((ca.jd - LEAD_DAYS) * 24) / 24; // on the hour
  const at = { TLIST: String(startJd) };
  const state = async (cmd) => (await vectors(cmd, center, at))[0].slice(1);
  const moons = [];
  for (const m of MOONS[planet]) moons.push({ name: MOON_NAMES[m], state: await state(m) });
  // Moon closest approaches, for the record (the app reports them).
  out.push({
    craft,
    planet,
    about,
    closestJd: ca.jd,
    closestUtc: jdToIso(ca.jd),
    closestKm: Math.round(ca.km),
    speedKms: Math.round(ca.kms * 10) / 10,
    startJd,
    states: { craft: await state(id), sun: await state('10'), moons },
  });
  console.log(`${craft} at ${planet}: ${jdToIso(ca.jd)} UT, ${Math.round(ca.km).toLocaleString('en-US')} km from the centre, ${ca.kms.toFixed(1)} km/s`);
}

writeFileSync(
  new URL('../public/data/voyager-encounters.json', import.meta.url),
  JSON.stringify(
    {
      source: `JPL Horizons; planetocentric ecliptic J2000 states (AU, AU/day) ${LEAD_DAYS} days before closest approach; times UT`,
      encounters: out,
    },
    null,
    1,
  ) + '\n',
);
