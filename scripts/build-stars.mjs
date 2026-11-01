#!/usr/bin/env node
/**
 * Build real-star data from the HYG database v4.1 (David Nash / astronexus,
 * https://codeberg.org/astronexus/hyg), licensed CC BY-SA 4.0. The derived files are
 * therefore also CC BY-SA 4.0.
 *
 *   public/data/stars-near.json    every catalogued star within NEAR_PC parsecs (3D positions)
 *   public/data/stars-bright.json  every star brighter than BRIGHT_MAG (the real night sky)
 *
 * Positions are converted from equatorial J2000 to ecliptic J2000 (the frame used for the
 * Solar System everywhere else in the app).
 *
 *   node scripts/build-stars.mjs [path-to-hygdata_v41.csv]
 */
import { readFileSync, writeFileSync } from 'node:fs';

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
      ...(r.comp_primary && r.comp_primary !== r.id ? { companionOf: Number(r.comp_primary) } : {}),
      id: Number(r.id),
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
near.sort((a, b) => Math.hypot(...a.xyz) - Math.hypot(...b.xyz));
bright.sort((a, b) => a[3] - b[3]);

const credit = 'HYG database v4.1 by David Nash (astronexus), CC BY-SA 4.0 — https://codeberg.org/astronexus/hyg';
writeFileSync(
  new URL('../public/data/stars-near.json', import.meta.url),
  JSON.stringify({ source: credit, license: 'CC BY-SA 4.0', frame: 'ecliptic J2000, parsecs', maxPc: NEAR_PC, stars: near }) + '\n',
);
writeFileSync(
  new URL('../public/data/stars-bright.json', import.meta.url),
  JSON.stringify({ source: credit, license: 'CC BY-SA 4.0', frame: 'ecliptic J2000 unit vectors', maxMag: BRIGHT_MAG, fields: ['x', 'y', 'z', 'mag', 'bv', 'name?'], stars: bright }) + '\n',
);
console.log(`near: ${near.length} stars within ${NEAR_PC} pc; bright: ${bright.length} stars brighter than mag ${BRIGHT_MAG}`);
