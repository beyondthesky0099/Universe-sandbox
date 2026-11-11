#!/usr/bin/env node
/**
 * Build public/data/pulsars.json: every Milky Way pulsar with a distance in the ATNF Pulsar
 * Catalogue (Manchester, Hobbs, Teoh & Hobbs 2005, AJ 129, 1993; https://www.atnf.csiro.au/research/pulsar/psrcat/).
 *
 * Per pulsar: J name, B name (if any), spin period P (s), spin-down Ṗ (the intrinsic value where
 * the catalogue corrects for the pulsar's motion), distance (kpc; mostly from the dispersion
 * measure and the YMW16 electron-density model, parallaxes where measured), position (J2000
 * degrees), and flags:
 *   m = magnetar (anomalous X-ray pulsar / soft gamma repeater), b = in a binary,
 *   h = seen at high energies (X-rays or gamma rays), g = in a globular cluster,
 *   r = rotating radio transient. `snr`: the supernova remnant it sits in, if any.
 * Pulsars in the Magellanic Clouds (EXGAL) are left out.
 *
 *   node scripts/build-pulsars.mjs
 */
import { writeFileSync } from 'node:fs';

const VERSION = '2.6.1';
const params = new URLSearchParams({
  version: VERSION,
  JName: 'JName', Name: 'Name', P0: 'P0', P1: 'P1', P1_I: 'P1_I', Dist: 'Dist', RaJD: 'RaJD', DecJD: 'DecJD',
  Binary: 'Binary', Type: 'Type', Assoc: 'Assoc',
  startUserDefined: 'true', pulsar_names: '', ephemeris: 'short', submit_table: 'Get Table', coords_unit: 'raj/decj',
  style: 'Short without errors', no_value: '*', fsize: '3', state: 'query',
});
const url = `https://www.atnf.csiro.au/research/pulsar/psrcat/proc_form.php?${params}`;

async function text(u) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(u);
      if (res.ok) return await res.text();
      if (attempt >= 4) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= 4) throw err;
    }
    await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
  }
}

const html = await text(url);
const lines = html.replace(/<[^>]*>/g, '').split('\n').filter((l) => /^\s*\d+\s+J/.test(l));
if (lines.length < 3000) throw new Error(`only ${lines.length} rows: the catalogue's format may have changed`);

const num = (s) => (s === '*' ? undefined : Number(s));
const sig = (x, n) => Number(x.toPrecision(n));
const rows = [];
let skipped = 0;
for (const line of lines) {
  const f = line.trim().split(/\s+/);
  if (f.length !== 12) throw new Error(`unexpected row: ${line}`);
  const [, jname, name, p0s, p1s, p1is, dists, ras, decs, binary, type, assoc] = f;
  const p0 = num(p0s), dist = num(dists), ra = num(ras), dec = num(decs);
  if (!p0 || !dist || ra === undefined || dec === undefined || assoc.includes('EXGAL')) {
    skipped++;
    continue;
  }
  const p1 = num(p1is) ?? num(p1s);
  let flags = '';
  if (/AXP|SGR/.test(type)) flags += 'm';
  if (binary !== '*') flags += 'b';
  if (/HE/.test(type)) flags += 'h';
  if (/(^|,)GC:/.test(assoc)) flags += 'g';
  if (/RRAT/.test(type)) flags += 'r';
  const snr = /(?:^|,)SNR:([^,[]+)/.exec(assoc)?.[1]?.replace(/_/g, ' ');
  const row = [jname, name !== jname ? name : '', sig(p0, 7), p1 !== undefined && p1 > 0 ? sig(p1, 3) : 0, sig(dist, 3), Number(ra.toFixed(4)), Number(dec.toFixed(4)), flags];
  if (snr) row.push(snr);
  rows.push(row);
}

const out = {
  source: `ATNF Pulsar Catalogue v${VERSION} (Manchester et al. 2005, AJ 129, 1993), https://www.atnf.csiro.au/research/pulsar/psrcat/`,
  fields: ['jname', 'bname', 'period_s', 'pdot', 'distance_kpc', 'ra_deg', 'dec_deg', 'flags', 'snr'],
  flags: { m: 'magnetar', b: 'binary', h: 'high-energy emission', g: 'in a globular cluster', r: 'rotating radio transient' },
  rows,
};
writeFileSync(new URL('../public/data/pulsars.json', import.meta.url), JSON.stringify(out));
console.log(`${rows.length} pulsars (${skipped} without a period, distance or position, or outside the Milky Way)`);
