#!/usr/bin/env node
/**
 * Build public/data/solar-system.json from NASA/JPL Horizons (https://ssd.jpl.nasa.gov/horizons/).
 *
 * For every body: osculating Keplerian elements at EPOCH (ecliptic and mean equinox J2000,
 * relative to the body's parent), plus physical data parsed from the Horizons object header
 * (GM, mean radius, rotation period, obliquity) where Horizons provides it.
 *
 *   node scripts/build-solar-system.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Responses are cached so a rerun after a Horizons outage (HTTP 503) resumes where it stopped.
const CACHE = new URL('../node_modules/.cache/horizons/', import.meta.url);
mkdirSync(CACHE, { recursive: true });

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const EPOCH = '2026-11-01';
const EPOCH_NEXT = '2026-11-02';
const GM_SUN = 1.32712440041e11; // km^3/s^2

/** [name, Horizons command, parent command (Horizons centre id), kind, extra] */
const BODIES = [
  // Planets (orbits come from the JPL approximate elements in the app; this adds physical data)
  ['Mercury', '199', '10', 'planet'],
  ['Venus', '299', '10', 'planet'],
  ['Earth', '399', '10', 'planet'],
  ['Mars', '499', '10', 'planet'],
  ['Jupiter', '599', '10', 'planet'],
  ['Saturn', '699', '10', 'planet'],
  ['Uranus', '799', '10', 'planet'],
  ['Neptune', '899', '10', 'planet'],
  // Dwarf planets
  ['Pluto', '999', '10', 'dwarf'],
  ['Ceres', '1;', '10', 'dwarf'],
  ['Eris', '136199;', '10', 'dwarf'],
  ['Haumea', '136108;', '10', 'dwarf'],
  ['Makemake', '136472;', '10', 'dwarf'],
  // Large asteroids
  ['Vesta', '4;', '10', 'asteroid'],
  ['Pallas', '2;', '10', 'asteroid'],
  ['Hygiea', '10;', '10', 'asteroid'],
  ['Apophis', '99942;', '10', 'asteroid'],
  ['Bennu', '101955;', '10', 'asteroid'],
  // Comets (closest apparition solution)
  ['Halley', 'DES=1P;CAP;', '10', 'comet'],
  ['Encke', 'DES=2P;CAP;', '10', 'comet'],
  ['Churyumov–Gerasimenko', 'DES=67P;CAP;', '10', 'comet'],
  ['Hale–Bopp', 'DES=C/1995 O1;CAP;', '10', 'comet'],
  // Moons
  ['Moon', '301', '399', 'moon'],
  ['Phobos', '401', '499', 'moon'],
  ['Deimos', '402', '499', 'moon'],
  ['Io', '501', '599', 'moon'],
  ['Europa', '502', '599', 'moon'],
  ['Ganymede', '503', '599', 'moon'],
  ['Callisto', '504', '599', 'moon'],
  ['Amalthea', '505', '599', 'moon'],
  ['Mimas', '601', '699', 'moon'],
  ['Enceladus', '602', '699', 'moon'],
  ['Tethys', '603', '699', 'moon'],
  ['Dione', '604', '699', 'moon'],
  ['Rhea', '605', '699', 'moon'],
  ['Titan', '606', '699', 'moon'],
  ['Hyperion', '607', '699', 'moon'],
  ['Iapetus', '608', '699', 'moon'],
  ['Phoebe', '609', '699', 'moon'],
  ['Miranda', '705', '799', 'moon'],
  ['Ariel', '701', '799', 'moon'],
  ['Umbriel', '702', '799', 'moon'],
  ['Titania', '703', '799', 'moon'],
  ['Oberon', '704', '799', 'moon'],
  ['Triton', '801', '899', 'moon'],
  ['Nereid', '802', '899', 'moon'],
  ['Proteus', '808', '899', 'moon'],
  ['Charon', '901', '999', 'moon'],
  ['Nix', '902', '9', 'moon'],
  ['Hydra', '903', '9', 'moon'],
];

const PARENT_NAME = { 10: 'Sun', 399: 'Earth', 499: 'Mars', 599: 'Jupiter', 699: 'Saturn', 799: 'Uranus', 899: 'Neptune', 999: 'Pluto', 9: 'Pluto' };

async function horizons(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', ...params })) url.searchParams.set(k, k === 'format' ? v : `'${v}'`);
  const cacheFile = new URL(createHash('sha1').update(url.href).digest('hex') + '.txt', CACHE);
  if (existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8');
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      writeFileSync(cacheFile, json.result);
      await new Promise((r) => setTimeout(r, 1000));
      return json.result;
    } catch (err) {
      if (attempt === 6) throw err;
      await new Promise((r) => setTimeout(r, 3000 * 2 ** Math.min(attempt, 4)));
    }
  }
}

const num = (s) => {
  const v = Number(String(s).replace(/,/g, '').replace(/\s*\+-.*$/, '').replace(/\s*\+\/-.*$/, ''));
  return Number.isFinite(v) ? v : undefined;
};

/** Pull a number following one of the labels in the Horizons header. */
function headerValue(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const v = num(m[1]);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

/** Parse "9h 55m 29.711 s", "17.24+-0.01 h", "153.29 h", "58.6463 d" into hours. */
function parseDuration(text) {
  const hms = text.match(/^\s*(\d+)h\s*(\d+)m\s*([\d.]+)\s*s/);
  if (hms) return Number(hms[1]) + Number(hms[2]) / 60 + Number(hms[3]) / 3600;
  const m = text.match(/^\s*([\d.]+)(?:\s*\+-?\s*[\d.]+)?\s*(hr|h|d)\b/);
  if (!m) return undefined;
  return Number(m[1]) * (m[2] === 'd' ? 24 : 1);
}

function parsePhysical(header) {
  const gm = headerValue(header, [
    /GM,\s*km\^3\/s\^2\s*=\s*([-\d.,Ee+]+)/,
    /GM\s*\(km\^3\/s\^2\)\s*=\s*([-\d.,Ee+]+)/,
    /GM\s*\(planet\)\s*km\^3\/s\^2\s*=\s*([-\d.,Ee+]+)/,
    /\bGM=\s*([-\d.,Ee+]+)/,
  ]);
  const radiusKm = headerValue(header, [
    /Vol\.?\s*Mean Radius,?\s*(?:\(km\)|km)\s*=\s*([-\d.,Ee+]+)/i,
    /Mean radius\s*\(km\)\s*=\s*([-\d.,Ee+]+)/i,
    /Radius\s*\(km(?:,[^)]*)?\)\s*=\s*([-\d.,Ee+]+)/i,
    /\bRAD=\s*([-\d.,Ee+]+)/,
  ]);
  let rotationHours;
  const rot = header.match(/Sid(?:ereal|\.)\s*rot\.?\s*period[^=]*=\s*([^\n]{0,30})/i);
  if (rot) rotationHours = parseDuration(rot[1]);
  if (rotationHours === undefined) {
    const rate = headerValue(header, [/Sid\.?\s*rot\.?\s*rat[e]?,?\s*(?:\(rad\/s\)|rad\/s)\s*=\s*([-\d.Ee+]+)/i]);
    if (rate) rotationHours = (2 * Math.PI) / Math.abs(rate) / 3600;
  }
  if (rotationHours === undefined) rotationHours = headerValue(header, [/Mean sidereal day,?\s*hr\s*=\s*([-\d.]+)/i, /\bROTPER=\s*([-\d.,Ee+]+)/]);
  let obliquityDeg = headerValue(header, [/Obliquity to orbit,\s*deg\s*=\s*([-\d.]+)/i, /Obliquity to orbit[^=]*=\s*([-\d.]+)\s*deg/i]);
  const arcmin = header.match(/Obliquity to orbit[^=]*=\s*([\d.]+)'/i);
  if (obliquityDeg === undefined && arcmin) obliquityDeg = Number(arcmin[1]) / 60;
  const albedo = headerValue(header, [/Geometric Albedo\s*=\s*([-\d.,Ee+]+)/i, /\bALBEDO=\s*([-\d.,Ee+]+)/]);
  return {
    gm,
    radiusKm,
    rotationHours,
    synchronous: /rot(?:ational|\.)?\s*period\s*=\s*Synchronous/i.test(header) || undefined,
    obliquityDeg,
    albedo,
  };
}

/**
 * Published values for bodies whose Horizons record has no GM or radius. Each is cited; masses
 * marked estimated are uncertain by tens of percent.
 */
const LITERATURE = {
  Eris: { gm: 1108, radiusKm: 1163, source: 'Holler et al. 2021 (mass); Sicardy et al. 2011 (radius)' },
  Haumea: { gm: 267.4, radiusKm: 798, source: 'Ragozzine & Brown 2009 (mass); Ortiz et al. 2017 (shape, volumetric mean radius)' },
  Makemake: { gm: 207, radiusKm: 715, estimated: true, source: 'Parker et al. 2018 (mass, estimated); Ortiz et al. 2012 (radius)' },
};
/** Bulk densities (g/cm³) used to estimate masses of small bodies from their radius. */
const DENSITY = { comet: 0.5, asteroid: 1.9, moon: 1.5, dwarf: 2 };

/**
 * North-pole directions (RA, Dec in degrees, ICRF J2000) from the IAU Working Group on
 * Cartographic Coordinates and Rotational Elements (Archinal et al. 2018, Celest. Mech. Dyn.
 * Astr. 130:22), constant terms only. `retrograde`: the body spins clockwise about this pole.
 */
const POLES = {
  Mercury: [281.0103, 61.4155],
  Venus: [272.76, 67.16, true],
  Earth: [0, 90],
  Moon: [269.9949, 66.5392],
  Mars: [317.68143, 52.8865], // IAU 2009 (Archinal et al. 2011)
  Jupiter: [268.0566, 64.4953],
  Saturn: [40.589, 83.537],
  Uranus: [257.311, -15.175, true],
  Neptune: [299.36, 43.46],
  Pluto: [132.993, -6.163, true],
  Charon: [132.993, -6.163, true],
  Ceres: [291.418, 66.764],
};

function parseElements(result) {
  const block = result.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!block) throw new Error('no ephemeris block');
  const cols = block.trim().split('\n')[0].split(',').map((s) => s.trim());
  // JDTDB, Cal, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR
  return {
    epochJd: Number(cols[0]),
    e: Number(cols[2]),
    q: Number(cols[3]),
    i: Number(cols[4]),
    node: Number(cols[5]),
    peri: Number(cols[6]),
    tp: Number(cols[7]),
    n: Number(cols[8]),
    M: Number(cols[9]),
    a: Number(cols[11]),
  };
}

/** Every ephemeris row (JD, e, i, node, peri, M, a). */
function parseRows(result) {
  const block = result.split('$$SOE')[1]?.split('$$EOE')[0] ?? '';
  return block
    .trim()
    .split('\n')
    .map((line) => line.split(',').map((s) => s.trim()))
    .filter((c) => c.length > 12)
    .map((c) => ({ jd: Number(c[0]), e: Number(c[2]), i: Number(c[4]), node: Number(c[5]), peri: Number(c[6]), M: Number(c[9]), a: Number(c[11]) }));
}

function unwrap(values) {
  const out = [values[0]];
  for (let k = 1; k < values.length; k++) {
    let d = values[k] - values[k - 1];
    d -= 360 * Math.round(d / 360);
    out.push(out[k - 1] + d);
  }
  return out;
}

/** Least-squares line through (t, y): returns [value at t = 0, slope]. */
function lineFit(t, y) {
  const n = t.length;
  const mt = t.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let k = 0; k < n; k++) {
    num += (t[k] - mt) * (y[k] - my);
    den += (t[k] - mt) ** 2;
  }
  const slope = num / den;
  return [my - slope * mt, slope];
}

/**
 * Mean elements for a moon. Osculating elements of moons wobble strongly (the Sun's pull on
 * the Moon, resonances among Jupiter's moons, planetary oblateness), so propagating a single
 * snapshot drifts by tens of degrees within months. Instead, sample ~200 orbits centred on the
 * epoch and fit a constant a, e, i and linearly advancing mean longitude, node and longitude of
 * periapsis.
 */
async function meanElements(command, center, periodDays, epochJd) {
  const spanDays = Math.min(200 * periodDays, 20 * 365.25);
  const stepMin = Math.max(1, Math.round((periodDays * 1440) / 6));
  const start = epochJd - spanDays / 2;
  const stop = epochJd + spanDays / 2;
  const result = await horizons({
    COMMAND: command,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'ELEMENTS',
    CENTER: `500@${center}`,
    START_TIME: `JD${start}`,
    STOP_TIME: `JD${stop}`,
    STEP_SIZE: `${stepMin}m`,
    REF_PLANE: 'ECLIPTIC',
    OUT_UNITS: 'AU-D',
    CSV_FORMAT: 'YES',
  });
  const rows = parseRows(result);
  const t = rows.map((r) => r.jd - epochJd);
  const node = unwrap(rows.map((r) => r.node));
  const varpi = unwrap(rows.map((r) => r.node + r.peri));
  const L = unwrap(rows.map((r) => r.node + r.peri + r.M));
  const [node0, nodeRate] = lineFit(t, node);
  const [varpi0, varpiRate] = lineFit(t, varpi);
  const [L0, LRate] = lineFit(t, L);
  const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  const norm = (d) => ((d % 360) + 360) % 360;
  return {
    samples: rows.length,
    a: mean('a'),
    e: mean('e'),
    i: mean('i'),
    node: norm(node0),
    peri: norm(varpi0 - node0),
    M: norm(L0 - varpi0),
    n: LRate - varpiRate, // mean anomaly rate, deg/day
    nodeRate,
    periRate: varpiRate, // longitude of periapsis rate, deg/day
  };
}

const out = [];
for (const [name, command, center, kind] of BODIES) {
  process.stdout.write(`${name} … `);
  const result = await horizons({
    COMMAND: command,
    OBJ_DATA: 'YES',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'ELEMENTS',
    CENTER: `500@${center}`,
    START_TIME: EPOCH,
    STOP_TIME: EPOCH_NEXT,
    STEP_SIZE: '1d',
    REF_PLANE: 'ECLIPTIC',
    OUT_UNITS: 'AU-D',
    CSV_FORMAT: 'YES',
  });
  const header = result.split('$$SOE')[0];
  let el = parseElements(result);
  let fitted;
  if (kind === 'moon') {
    const periodDays = 360 / el.n;
    fitted = await meanElements(command, center, periodDays, el.epochJd);
    el = { ...el, ...fitted };
  }
  const phys = parsePhysical(header);
  const lit = LITERATURE[name];
  let massEstimated;
  let note;
  if (lit) {
    phys.gm ??= lit.gm;
    phys.radiusKm ??= lit.radiusKm;
    massEstimated = lit.estimated;
    note = lit.source;
  }
  if (!phys.gm && phys.radiusKm) {
    // M = 4/3 π R³ ρ, expressed as GM in km³/s² (G = 6.674e-20 km³ kg⁻¹ s⁻²).
    const kg = (4 / 3) * Math.PI * (phys.radiusKm * 1e3) ** 3 * DENSITY[kind] * 1000;
    phys.gm = kg * 6.6743e-20;
    massEstimated = true;
  }
  const entry = {
    name,
    kind,
    parent: PARENT_NAME[center],
    // Elements of Nix and Hydra are relative to the Pluto–Charon barycentre.
    barycentric: center === '9' || undefined,
    // Mass in solar masses from GM, when Horizons lists one.
    mass: phys.gm ? phys.gm / GM_SUN : undefined,
    massEstimated,
    note,
    radiusKm: phys.radiusKm,
    rotationHours: phys.rotationHours,
    synchronous: phys.synchronous,
    obliquityDeg: phys.obliquityDeg,
    pole: POLES[name] ? { ra: POLES[name][0], dec: POLES[name][1] } : undefined,
    retrograde: POLES[name]?.[2] || undefined,
    albedo: phys.albedo,
    elements: {
      epochJd: el.epochJd,
      a: el.a, // AU (negative for hyperbolic)
      e: el.e,
      q: el.q,
      i: el.i, // degrees
      node: el.node,
      peri: el.peri,
      M: el.M,
      n: el.n, // degrees per day
      ...(fitted
        ? { nodeRate: fitted.nodeRate, periRate: fitted.periRate, mean: true }
        : { tp: el.tp }), // JD of perihelion
    },
  };
  for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];
  out.push(entry);
  console.log(`${fitted ? `[mean, ${fitted.samples} samples] ` : ''}a=${el.a.toPrecision(5)} e=${el.e.toFixed(4)} GM=${phys.gm ?? '–'} R=${phys.radiusKm ?? '–'} rot=${phys.rotationHours?.toFixed?.(2) ?? (phys.synchronous ? 'sync' : '–')} tilt=${phys.obliquityDeg ?? '–'}`);
}

const data = {
  source: 'NASA/JPL Horizons (ssd.jpl.nasa.gov/horizons), osculating elements, ecliptic & mean equinox J2000; pole directions: IAU WGCCRE (Archinal et al. 2018)',
  epoch: EPOCH,
  bodies: out,
};
writeFileSync(new URL('../public/data/solar-system.json', import.meta.url), JSON.stringify(data, null, 1) + '\n');
console.log(`Wrote ${out.length} bodies.`);
