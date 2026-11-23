#!/usr/bin/env node
/**
 * Build public/data/interstellar.json: the three interstellar objects seen passing through the
 * Solar System, with their hyperbolic orbits from the NASA/JPL Small-Body Database API
 * (ssd-api.jpl.nasa.gov/sbdb.api, full precision; heliocentric ecliptic J2000 elements: e, q,
 * i, Ω, ω and the time of perihelion).
 *
 * The speed each had far from the Sun (its "hyperbolic excess" speed) follows from the orbit:
 * v∞ = √(GM☉ (e − 1) / q). The discovery facts are from the discovery reports cited below.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/build-interstellar.mjs   (behind a proxy; plain node otherwise)
 */
import { writeFileSync } from 'node:fs';

const API = 'https://ssd-api.jpl.nasa.gov/sbdb.api';
const GM_SUN = 1.32712440018e11; // km³/s²
const AU_KM = 1.495978707e8;

const OBJECTS = [
  {
    sstr: '1I',
    name: 'ʻOumuamua',
    designation: '1I/2017 U1',
    discovered: '2017-10-19',
    by: 'Robert Weryk, Pan-STARRS1 (Haleakalā, Hawaiʻi)',
    note: 'The first interstellar object ever seen. A tumbling, very elongated body with no visible coma, it sped up slightly as it left the Sun (Micheli et al. 2018, Nature 559, 223). Its name is Hawaiian for "a messenger from afar arriving first".',
  },
  {
    sstr: '2I',
    name: 'Borisov',
    designation: '2I/2019 Q4',
    discovered: '2019-08-30',
    by: 'Gennadiy Borisov, an amateur astronomer (Nauchnij, Crimea)',
    note: 'The first interstellar comet: a coma and tail like a Solar System comet, but rich in carbon monoxide (Bodewits et al. 2020, Nature Astronomy 4, 867).',
  },
  {
    sstr: '3I',
    name: '3I/ATLAS',
    designation: '3I/2025 N1',
    discovered: '2025-07-01',
    by: 'the ATLAS survey (Río Hurtado, Chile)',
    note: 'The fastest of the three, and perhaps very old: its path suggests it comes from the Milky Way\'s thick disc, possibly older than the Sun (Seligman et al. 2025; Hopkins et al. 2025).',
  },
];

const out = [];
for (const o of OBJECTS) {
  const url = new URL(API);
  url.searchParams.set('sstr', o.sstr);
  url.searchParams.set('full-prec', '1');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SBDB ${o.sstr}: HTTP ${res.status}`);
  const json = await res.json();
  const el = Object.fromEntries(json.orbit.elements.map((e) => [e.name, Number(e.value)]));
  if (!(el.e > 1)) throw new Error(`${o.sstr}: not hyperbolic (e = ${el.e})`);
  const vInf = Math.sqrt((GM_SUN * (el.e - 1)) / (el.q * AU_KM));
  out.push({
    name: o.name,
    designation: o.designation,
    jplName: json.object.fullname,
    discovered: o.discovered,
    by: o.by,
    note: o.note,
    e: el.e,
    q: el.q,
    i: el.i,
    node: el.om,
    peri: el.w,
    tpJd: el.tp,
    epochJd: Number(json.orbit.epoch),
    solution: `JPL orbit ${json.orbit.orbit_id} (${json.orbit.soln_date})`,
    vInfKms: Math.round(vInf * 100) / 100,
  });
  console.log(`${o.name}: e = ${el.e.toFixed(4)}, q = ${el.q.toFixed(3)} AU, v∞ = ${vInf.toFixed(1)} km/s`);
}

writeFileSync(
  new URL('../public/data/interstellar.json', import.meta.url),
  JSON.stringify({ source: 'NASA/JPL Small-Body Database API (ssd-api.jpl.nasa.gov/sbdb.api), heliocentric ecliptic J2000 osculating elements', objects: out }, null, 1) + '\n',
);
