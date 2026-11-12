#!/usr/bin/env node
/**
 * Build the deep-universe catalogue for the Universe map, public/data/universe-objects.json:
 *
 *   clusters   rich galaxy clusters from the Abell catalogue (Abell, Corwin & Olowin 1989,
 *              ApJS 70, 1; VizieR VII/110A), those with a redshift (Struble & Rood 1987);
 *   quasars    the brightest quasars and active galaxies (V < 17.5) and every one at z ≥ 5 from
 *              the Véron-Cetty & Véron catalogue, 13th edition (2010, A&A 518, A10; VizieR
 *              VII/258);
 *   records    a few record holders entered by hand from the papers that measured them.
 *
 * Positions are galactic longitude/latitude (degrees) plus redshift; the app places them at the
 * comoving distance for a flat ΛCDM cosmology (src/sim/cosmology.ts).
 *
 *   node scripts/build-deep-universe.mjs
 */
import { writeFileSync } from 'node:fs';
import { equatorialToGalactic, num, parseTsv, round, sexagesimal, vizierClient } from './lib/vizier.mjs';

const vizier = vizierClient('universe');

// Abell clusters: the northern (table3) and southern (table4) rich clusters.
const clusters = [];
for (const table of ['table3', 'table4']) {
  const rows = parseTsv(
    await vizier(`abell-${table}`, {
      '-source': `VII/110A/${table}`,
      '-out': 'ACO,z,Rich,Count,BMtype',
      '-out.add': '_Glon,_Glat',
      '-out.max': 'unlimited',
    }),
  );
  for (const r of rows) {
    const z = num(r.z);
    if (!(z > 0)) continue;
    // [Abell number, l, b, z, richness class, member count, Bautz–Morgan type]
    clusters.push([Number(r.ACO), round(num(r._Glon), 3), round(num(r._Glat), 3), round(z, 4), num(r.Rich) ?? null, num(r.Count) ?? null, r.BMtype || null]);
  }
}
clusters.sort((a, b) => a[3] - b[3]);

// Quasars: bright ones, plus the most distant.
const quasars = new Map();
for (const [key, constraint] of [
  ['veron-bright', { Vmag: '<17.5' }],
  ['veron-distant', { z: '>=5' }],
]) {
  const rows = parseTsv(
    await vizier(key, {
      '-source': 'VII/258/vv10',
      '-out': 'Name,z,Vmag,Sp',
      '-out.add': '_Glon,_Glat',
      '-out.max': 'unlimited',
      ...constraint,
    }),
  );
  for (const r of rows) {
    const z = num(r.z);
    if (!(z > 0)) continue;
    const name = r.Name.replace(/\s+/g, ' ').trim();
    // [name, l, b, z, V magnitude]
    quasars.set(name, [name, round(num(r._Glon), 3), round(num(r._Glat), 3), round(z, 3), round(num(r.Vmag), 2) ?? null]);
  }
}

// Record holders, by hand: name, RA/Dec (J2000), redshift, what makes it notable, and the paper.
const RECORDS = [
  ['JADES-GS-z14-0', '03 32 19.90', '-27 51 20.3', 14.32, 'galaxy', 'The most distant galaxy confirmed by spectroscopy (as of 2024), seen 290 million years after the Big Bang.', 'Carniani et al. 2024, Nature 633, 318'],
  ['GN-z11', '12 36 25.46', '+62 14 31.4', 10.603, 'galaxy', 'A luminous galaxy 430 million years after the Big Bang, the most distant known before JWST.', 'Bunker et al. 2023, A&A 677, A88'],
  ['J0313−1806', '03 13 43.84', '-18 06 36.4', 7.642, 'quasar', 'The most distant quasar known, with a 1.6-billion-solar-mass black hole 670 million years after the Big Bang.', 'Wang et al. 2021, ApJL 907, L1'],
  ['ULAS J1120+0641', '11 20 01.48', '+06 41 24.3', 7.085, 'quasar', 'The first quasar found beyond redshift 7.', 'Mortlock et al. 2011, Nature 474, 616'],
  ['TON 618', '12 28 24.97', '+31 28 37.7', 2.219, 'quasar', 'A hyperluminous quasar whose black hole may weigh 40 billion suns, one of the heaviest known.', 'Shemmer et al. 2004, ApJ 614, 547'],
  ['3C 273', '12 29 06.70', '+02 03 08.6', 0.158, 'quasar', 'The first quasar identified (1963) and the brightest in our sky: its light left two billion years ago, yet an amateur telescope shows it.', 'Schmidt 1963, Nature 197, 1040'],
];
const records = RECORDS.map(([name, ra, dec, z, kind, note, ref]) => {
  const [l, b] = equatorialToGalactic(...sexagesimal(ra, dec));
  return { name, l: round(l, 3), b: round(b, 3), z, kind, note, ref };
});

const out = {
  source:
    'Galaxy clusters: Abell, Corwin & Olowin 1989, ApJS 70, 1 (VizieR VII/110A), redshifts from Struble & Rood 1987. Quasars: Véron-Cetty & Véron 2010, A&A 518, A10, 13th edition (VizieR VII/258), V < 17.5 or z ≥ 5. Record holders from the papers cited with each. Positions in galactic coordinates; distances from redshift (flat ΛCDM, H0 = 70, Ωm = 0.3).',
  fields: { clusters: ['abell', 'l_deg', 'b_deg', 'z', 'richness', 'count', 'bm_type'], quasars: ['name', 'l_deg', 'b_deg', 'z', 'V_mag'] },
  clusters,
  quasars: [...quasars.values()].sort((a, b) => a[3] - b[3]),
  records,
};
writeFileSync(new URL('../public/data/universe-objects.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`Abell clusters with redshifts: ${clusters.length}; quasars: ${out.quasars.length}; records: ${records.length}`);
