#!/usr/bin/env node
/**
 * Build public/data/huge-lqg.json: the quasars of the Huge Large Quasar Group (U1.27; Clowes et al.
 * 2013, MNRAS 429, 2910), found as the paper found them. SDSS DR7 quasars (Schneider et al. 2010;
 * VizieR VII/260) with 1.0 ≤ z ≤ 1.8 and i ≤ 19.1 are linked friends-of-friends at 100 Mpc
 * (comoving, the paper's cosmology: H0 = 70, Ωm = 0.27); the Huge-LQG is the group holding the
 * first quasar of the paper's Table 1, SDSS J104139.15+143530.2.
 *
 *   node scripts/build-huge-lqg.mjs
 */
import { writeFileSync } from 'node:fs';
import { equatorialToGalactic, num, parseTsv, round, vizierClient } from './lib/vizier.mjs';

const vizier = vizierClient('huge-lqg');
const H0 = 70, OM = 0.27, OL = 1 - OM;
/** Comoving distance (Mpc), flat ΛCDM (Simpson's rule). */
function comoving(z) {
  const n = 400;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const zi = (z * i) / n;
    s += (1 / Math.sqrt(OM * (1 + zi) ** 3 + OL)) * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2);
  }
  return ((299792.458 / H0) * (z / n) * s) / 3;
}
const D = Math.PI / 180;
const xyz = (ra, dec, d) => [d * Math.cos(dec * D) * Math.cos(ra * D), d * Math.cos(dec * D) * Math.sin(ra * D), d * Math.sin(dec * D)];

// A wide region around the group (about 30° by 30°), so the linking isn't cut off at its edge.
const rows = parseTsv(
  await vizier('dr7qso-u127', {
    '-source': 'VII/260',
    '-out': 'SDSS,z,imag',
    '-out.add': '_RA,_DE',
    '-c': '162.0 +15.0', // decimals: VizieR reads "162 +15" as sexagesimal
    '-c.bd': '34x30',
    'z': '1.0..1.8',
    'imag': '<=19.1',
    '-out.max': 'unlimited',
  }),
);
const q = rows
  .map((r) => ({ name: r.SDSS, ra: num(r._RAJ2000), dec: num(r._DEJ2000), z: num(r.z), i: num(r.imag) }))
  .filter((r) => Number.isFinite(r.ra) && r.z >= 1 && r.z <= 1.8 && r.i <= 19.1)
  .map((r) => ({ ...r, p: xyz(r.ra, r.dec, comoving(r.z)) }));
console.log(`DR7 quasars in the region: ${q.length}`);

// Friends of friends at 100 Mpc, grown from the paper's first member.
const LINK = 100;
const start = q.findIndex((r) => r.name === '104139.15+143530.2');
if (start < 0) throw new Error('The seed quasar is not in the query');
const inGroup = new Set([start]);
const queue = [start];
while (queue.length) {
  const i = queue.pop();
  for (let j = 0; j < q.length; j++) {
    if (inGroup.has(j)) continue;
    const [a, b] = [q[i].p, q[j].p];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= LINK) {
      inGroup.add(j);
      queue.push(j);
    }
  }
}
const members = [...inGroup].map((i) => q[i]).map((r) => {
  const [l, b] = equatorialToGalactic(r.ra, r.dec);
  return { name: `SDSS J${r.name}`, l: round(l, 4), b: round(b, 4), z: r.z };
});
members.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(
  new URL('../public/data/huge-lqg.json', import.meta.url),
  JSON.stringify({
    source: 'SDSS DR7 quasars (Schneider et al. 2010; VizieR VII/260), 1.0 ≤ z ≤ 1.8 and i ≤ 19.1, linked friends-of-friends at 100 Mpc as by Clowes et al. 2013 (MNRAS 429, 2910): the group of SDSS J104139.15+143530.2.',
    members,
  }) + '\n',
);
console.log(`Huge-LQG: ${members.length} quasars (the paper: 73)`);
