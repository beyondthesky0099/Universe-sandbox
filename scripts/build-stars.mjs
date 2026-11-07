#!/usr/bin/env node
/**
 * Build real-star data from the HYG database v4.1 (David Nash / astronexus,
 * https://codeberg.org/astronexus/hyg), licensed CC BY-SA 4.0. The derived files are
 * therefore also CC BY-SA 4.0.
 *
 *   public/data/stars-near.json    every catalogued star within NEAR_PC parsecs (3D positions)
 *                                  with distances and motions from Gaia DR3 where Gaia has them
 *   public/data/stars-bright.json  every star brighter than BRIGHT_MAG (the real night sky)
 *
 * Positions are converted from equatorial J2000 to ecliptic J2000 (the frame used for the
 * Solar System everywhere else in the app).
 *
 * Nearby stars are then matched to Gaia DR3 (ESA, gea.esac.esa.int TAP; Gaia Collaboration,
 * Vallenari et al. 2023) by position and distance. For every match, the position and space
 * velocity are recomputed from Gaia's parallax and proper motion, with Gaia's radial velocity
 * (or HYG's when Gaia has none). Very bright stars that Gaia cannot measure well keep their
 * Hipparcos-era HYG values.
 *
 *   node scripts/build-stars.mjs [path-to-hygdata_v41.csv]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const URL_HYG = 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv';
const NEAR_PC = 20;
const BRIGHT_MAG = 6.5;
const OBLIQUITY = (23.4392911 * Math.PI) / 180;

const text = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(URL_HYG)).text();

/** Minimal CSV parser (quoted fields, no embedded newlines in HYG). */
function parseLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const GREEK = {
  Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ',
  Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω',
};

function starName(r) {
  if (r.proper) return r.proper;
  if (r.bayer && r.con) {
    const [letter, idx] = r.bayer.split('-');
    return `${GREEK[letter] ?? letter}${idx ? superscript(idx) : ''} ${r.con}`;
  }
  if (r.flam && r.con) return `${r.flam} ${r.con}`;
  if (r.gl) return r.gl.replace(/^Gl\s*/, 'Gliese ').replace(/^GJ\s*/, 'GJ ');
  if (r.hip) return `HIP ${r.hip}`;
  if (r.hd) return `HD ${r.hd}`;
  return `HYG ${r.id}`;
}

function superscript(s) {
  return s.replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]);
}

/** Equatorial (x, y, z) → ecliptic (x, y, z). */
function toEcliptic(x, y, z) {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return [x, c * y + s * z, -s * y + c * z];
}

const lines = text.split('\n');
const header = parseLine(lines[0]);
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const near = [];
const bright = [];
for (let k = 1; k < lines.length; k++) {
  if (!lines[k].trim()) continue;
  const f = parseLine(lines[k]);
  const r = Object.fromEntries(Object.keys(col).map((h) => [h, f[col[h]]]));
  if (r.id === '0') continue; // the Sun
  const dist = Number(r.dist);
  const mag = Number(r.mag);
  const ci = r.ci === '' ? undefined : Number(r.ci);
  const [ex, ey, ez] = toEcliptic(Number(r.x), Number(r.y), Number(r.z));
  const name = starName(r);
  const round = (v, d) => Number(v.toFixed(d));
  if (dist > 0 && dist <= NEAR_PC && dist < 100000) {
    near.push({
      name,
      xyz: [round(ex, 4), round(ey, 4), round(ez, 4)],
      mag: round(mag, 2),
      absmag: round(Number(r.absmag), 2),
      spect: r.spect || undefined,
      ci: ci === undefined ? undefined : round(ci, 3),
      lum: round(Number(r.lum), 6),
      // Space velocity (ecliptic J2000, parsecs per year) from proper motion and radial velocity.
      ...(r.vx !== '' && (Number(r.vx) || Number(r.vy) || Number(r.vz)) ? { v: toEcliptic(Number(r.vx), Number(r.vy), Number(r.vz)).map((c) => round(c, 9)) } : {}),
      ...(r.comp_primary && r.comp_primary !== r.id ? { companionOf: Number(r.comp_primary) } : {}),
      id: Number(r.id),
      // Kept for the Gaia cross-match below, then removed.
      _ra: Number(r.ra) * 15,
      _dec: Number(r.dec),
      _rv: r.rv === '' ? undefined : Number(r.rv),
      _dist: dist,
    });
  }
  if (mag <= BRIGHT_MAG) {
    const len = Math.hypot(ex, ey, ez) || 1;
    // [x, y, z unit vector, magnitude, B−V colour, name if it has a proper name]
    const row = [round(ex / len, 4), round(ey / len, 4), round(ez / len, 4), round(mag, 2), ci === undefined ? 0.6 : round(ci, 2)];
    if (r.proper) row.push(r.proper);
    bright.push(row);
  }
}
// --- Gaia DR3 cross-match -------------------------------------------------------------------
const GAIA_CACHE = new URL('../node_modules/.cache/gaia/', import.meta.url);
mkdirSync(GAIA_CACHE, { recursive: true });
const gaiaFile = new URL('near.csv', GAIA_CACHE);
const ADQL = `SELECT source_id, ra, dec, parallax, parallax_error, pmra, pmdec, radial_velocity, phot_g_mean_mag
  FROM gaiadr3.gaia_source WHERE parallax > ${(1000 / (NEAR_PC * 1.25)).toFixed(1)} AND parallax_over_error > 10`;
if (!existsSync(gaiaFile)) {
  const url = `https://gea.esac.esa.int/tap-server/tap/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(ADQL)}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      const body = await res.text();
      if (res.ok && body.startsWith('source_id')) {
        writeFileSync(gaiaFile, body);
        break;
      }
      if (attempt >= 5) throw new Error(`Gaia archive: HTTP ${res.status} ${body.slice(0, 200)}`);
    } catch (err) {
      if (attempt >= 5) throw err;
    }
    await new Promise((r) => setTimeout(r, 4000 * 2 ** attempt));
  }
}
const gaiaLines = readFileSync(gaiaFile, 'utf8').trim().split('\n');
const gh = gaiaLines[0].split(',');
const gaia = gaiaLines.slice(1).map((l) => {
  const c = l.split(',');
  const g = Object.fromEntries(gh.map((h, i) => [h, c[i] === '' ? undefined : h === 'source_id' ? c[i] : Number(c[i])]));
  return g;
});
const DEG = Math.PI / 180;
const KMS_TO_PC_PER_YR = 1 / 977792.2;
const GAIA_EPOCH = 2016.0;
/** Angular separation (arcsec) between two RA/Dec positions in degrees. */
function sepArcsec(ra1, d1, ra2, d2) {
  const c = Math.sin(d1 * DEG) * Math.sin(d2 * DEG) + Math.cos(d1 * DEG) * Math.cos(d2 * DEG) * Math.cos((ra1 - ra2) * DEG);
  return (Math.acos(Math.min(1, c)) / DEG) * 3600;
}
let matched = 0;
let withGaiaRv = 0;
for (const s of near) {
  // Gaia positions are for 2016.0; move them back to 2000.0 with the proper motion to compare with HYG.
  let best;
  for (const g of gaia) {
    const dt = 2000 - GAIA_EPOCH;
    const ra = g.ra + ((g.pmra / 3.6e6) * dt) / Math.cos(g.dec * DEG);
    const dec = g.dec + (g.pmdec / 3.6e6) * dt;
    const sep = sepArcsec(s._ra, s._dec, ra, dec);
    if (sep > 20) continue;
    const dist = 1000 / g.parallax;
    if (Math.abs(dist - s._dist) / s._dist > 0.3) continue;
    if (!best || sep < best.sep) best = { g, sep };
  }
  if (best) {
    const { g } = best;
    const d = 1000 / g.parallax;
    const a = g.ra * DEG, de = g.dec * DEG;
    const rhat = [Math.cos(de) * Math.cos(a), Math.cos(de) * Math.sin(a), Math.sin(de)];
    const ahat = [-Math.sin(a), Math.cos(a), 0];
    const dhat = [-Math.sin(de) * Math.cos(a), -Math.sin(de) * Math.sin(a), Math.cos(de)];
    const rv = g.radial_velocity ?? s._rv;
    const round = (v, k) => Number(v.toFixed(k));
    s.xyz = toEcliptic(...rhat.map((c) => c * d)).map((c) => round(c, 4));
    if (rv !== undefined) {
      // km/s: radial velocity along the line of sight, 4.74047 km/s per (arcsec/yr × pc) across it.
      const k = 4.74047 * d / 1000;
      const v = [0, 1, 2].map((i) => rv * rhat[i] + k * (g.pmra * ahat[i] + g.pmdec * dhat[i]));
      s.v = toEcliptic(...v.map((c) => c * KMS_TO_PC_PER_YR)).map((c) => round(c, 9));
    }
    s.gaia = g.source_id;
    matched++;
    if (g.radial_velocity !== undefined) withGaiaRv++;
  }
  delete s._ra;
  delete s._dec;
  delete s._rv;
  delete s._dist;
}
console.log(`Gaia DR3: ${gaia.length} sources within ${NEAR_PC * 1.25} pc; matched ${matched} of ${near.length} nearby stars (${withGaiaRv} with Gaia radial velocities)`);

near.sort((a, b) => Math.hypot(...a.xyz) - Math.hypot(...b.xyz));
bright.sort((a, b) => a[3] - b[3]);

const credit = 'HYG database v4.1 by David Nash (astronexus), CC BY-SA 4.0 — https://codeberg.org/astronexus/hyg';
const nearCredit = `${credit}. Distances and motions from ESA Gaia DR3 (gaia field = source_id) where matched.`;
writeFileSync(
  new URL('../public/data/stars-near.json', import.meta.url),
  JSON.stringify({ source: nearCredit, license: 'CC BY-SA 4.0', frame: 'ecliptic J2000; positions in parsecs, velocities v in parsecs per year', maxPc: NEAR_PC, stars: near }) + '\n',
);
writeFileSync(
  new URL('../public/data/stars-bright.json', import.meta.url),
  JSON.stringify({ source: credit, license: 'CC BY-SA 4.0', frame: 'ecliptic J2000 unit vectors', maxMag: BRIGHT_MAG, fields: ['x', 'y', 'z', 'mag', 'bv', 'name?'], stars: bright }) + '\n',
);
console.log(`near: ${near.length} stars within ${NEAR_PC} pc; bright: ${bright.length} stars brighter than mag ${BRIGHT_MAG}`);
