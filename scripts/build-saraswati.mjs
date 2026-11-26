#!/usr/bin/env node
/**
 * Build public/data/saraswati.json: the galaxy clusters of the Saraswati Supercluster (Bagchi et al.
 * 2017, ApJ 844, 25), chosen as the paper chose them. Every cluster of the WHL catalogue (Wen, Han
 * & Liu 2012, ApJS 199, 34; VizieR J/ApJS/199/34) at its redshift (spectroscopic where measured,
 * else photometric, as the paper's Table 1 does) in SDSS Stripe 82 (|Dec| < 1.26°) lying within
 * 90 Mpc (comoving) of Abell 2631, the supercluster's most massive cluster and centre. The ones
 * within 20 Mpc make up its gravitationally bound core. The selection uses the paper's cosmology
 * (H0 = 70, Ωm = 0.3); the app then places each cluster at its redshift in its own (Planck 2018).
 *
 *   node scripts/build-saraswati.mjs
 */
import { writeFileSync } from 'node:fs';
import { equatorialToGalactic, num, parseTsv, round, vizierClient } from './lib/vizier.mjs';

const vizier = vizierClient('saraswati');
// The paper's cosmology, for choosing the members as it did.
const H0 = 70, OM = 0.3, OL = 1 - OM;
/** Comoving distance (Mpc) for redshift z, flat ΛCDM (Simpson's rule). */
function comoving(z) {
  const n = 400;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const zi = (z * i) / n;
    const f = 1 / Math.sqrt(OM * (1 + zi) ** 3 + OL);
    s += f * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2);
  }
  return ((299792.458 / H0) * (z / n) * s) / 3;
}
const D = Math.PI / 180;
/** Cartesian position (Mpc) of RA, Dec (deg) at comoving distance d. */
const xyz = (ra, dec, d) => [d * Math.cos(dec * D) * Math.cos(ra * D), d * Math.cos(dec * D) * Math.sin(ra * D), d * Math.sin(dec * D)];

// Abell 2631 (WHL J233739.7+001617): the centre.
const CENTRE = { ra: 354.41553, dec: 0.27137, z: 0.2772 };
const rows = parseTsv(
  await vizier('whl-saraswati', {
    '-source': 'J/ApJS/199/34/table1',
    '-out': 'WHL,RAJ2000,DEJ2000,zsp,zph,N200,r200,Other',
    '-c': `${CENTRE.ra} +${CENTRE.dec}`,
    '-c.bd': '14x6', // a 14° × 6° box around it: 90 Mpc is about 5° at this distance
    'zph': '0.20..0.36',
    '-out.max': 'unlimited',
  }),
);
const c = xyz(CENTRE.ra, CENTRE.dec, comoving(CENTRE.z));
const members = [];
for (const r of rows) {
  const ra = num(r.RAJ2000), dec = num(r.DEJ2000);
  const spectroscopic = num(r.zsp) > 0;
  const z = spectroscopic ? num(r.zsp) : num(r.zph);
  if (!(z > 0)) continue;
  // The paper's survey: SDSS Stripe 82, a strip 2.5° wide along the celestial equator.
  if (Math.abs(dec) > 1.26) continue;
  const p = xyz(ra, dec, comoving(z));
  const sep = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
  if (sep > 90) continue;
  const [l, b] = equatorialToGalactic(ra, dec);
  const other = (r.Other || '').split(',').filter(Boolean);
  members.push({ name: `WHL ${r.WHL}`, l: round(l, 4), b: round(b, 4), z, ...(spectroscopic ? {} : { zPhot: true }), n200: num(r.N200), r200: num(r.r200), core: sep < 20, fromCentre: round(sep, 1), ...(other.includes('Abell') ? { abell: true } : {}) });
}
members.sort((a, b) => a.fromCentre - b.fromCentre);
if (members.length < 30) throw new Error(`Only ${members.length} members: the query went wrong`);
writeFileSync(
  new URL('../public/data/saraswati.json', import.meta.url),
  JSON.stringify({
    source: 'Galaxy clusters of the WHL catalogue (Wen, Han & Liu 2012, ApJS 199, 34; VizieR J/ApJS/199/34) with spectroscopic redshifts within 90 comoving Mpc of Abell 2631, as in Bagchi et al. 2017 (ApJ 844, 25). Core: within 20 Mpc.',
    fields: { z: 'redshift (spectroscopic, or photometric where zPhot)', n200: 'richness (galaxies within r200)', r200: 'Mpc', fromCentre: 'comoving Mpc from Abell 2631' },
    members,
  }) + '\n',
);
console.log(`Saraswati: ${members.length} clusters, ${members.filter((m) => m.core).length} in the core`);
