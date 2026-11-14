#!/usr/bin/env node
/**
 * Build the deep-universe catalogue for the Universe map, public/data/universe-objects.json:
 *
 *   clusters   rich galaxy clusters from the Abell catalogue (Abell, Corwin & Olowin 1989,
 *              ApJS 70, 1; VizieR VII/110A), those with a redshift (Struble & Rood 1987);
 *   agn        the brightest active galactic nuclei (V < 17.5) and every quasar at z ≥ 5 from the
 *              Véron-Cetty & Véron catalogue, 13th edition (2010, A&A 518, A10; VizieR VII/258):
 *              quasars (class Q), Seyfert galaxies and LINERs (A) and BL Lac objects (B), with
 *              the spectral class and the 5 GHz radio flux;
 *   hosts      the named galaxies of galaxies-local.json and galaxies-named.json that are those
 *              active nuclei (matched by position), so the galaxy carries the nucleus;
 *   blackHoles measured masses of famous central black holes, by hand from the papers;
 *   records    a few record holders entered by hand from the papers that measured them.
 *
 * Positions are galactic longitude/latitude (degrees) plus redshift; the app places them at the
 * comoving distance for a flat ΛCDM cosmology (src/sim/cosmology.ts).
 *
 *   node scripts/build-deep-universe.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
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

// Active galactic nuclei: bright ones, plus the most distant quasars.
const agnByName = new Map();
for (const [key, constraint] of [
  ['veron-bright-class', { Vmag: '<17.5' }],
  ['veron-distant-class', { z: '>=5' }],
]) {
  const rows = parseTsv(
    await vizier(key, {
      '-source': 'VII/258/vv10',
      '-out': 'Name,Cl,Sp,z,Vmag,F6cm',
      '-out.add': '_Glon,_Glat',
      '-out.max': 'unlimited',
      ...constraint,
    }),
  );
  for (const r of rows) {
    const z = num(r.z);
    // M81 and a few other nearby nuclei have z ≤ 0 (they approach us): they can only be hosts.
    if (!Number.isFinite(z)) continue;
    const name = r.Name.replace(/\s+/g, ' ').trim();
    // [name, l, b, z, V magnitude, class (Q quasar, A Seyfert/LINER, B BL Lac), spectrum code, 5 GHz flux (Jy)]
    agnByName.set(name, [name, round(num(r._Glon), 3), round(num(r._Glat), 3), round(z, 3), round(num(r.Vmag), 2) ?? null, r.Cl.trim() || 'Q', r.Sp.trim(), round(num(r.F6cm), 3) ?? null]);
  }
}

// Measured masses of famous central black holes (M☉), with the method and the paper.
const BLACK_HOLES = {
  'NGC 4486': [6.5e9, 'Event Horizon Telescope image of its shadow', 'EHT Collaboration 2019, ApJL 875, L1'],
  'NGC 4258': [4.0e7, 'water-maser disc', 'Humphreys et al. 2013, ApJ 775, 13'],
  'NGC 1068': [1.5e7, 'water-maser disc', 'Greenhill et al. 1996, ApJL 472, L21'],
  Circinus: [1.7e6, 'water-maser disc', 'Greenhill et al. 2003, ApJ 590, 162'],
  'NGC 4151': [4.6e7, 'reverberation mapping', 'Bentz et al. 2006, ApJ 651, 775'],
  'NGC 5128': [5.5e7, 'stellar dynamics', 'Cappellari et al. 2009, MNRAS 394, 660'],
  'NGC 1275': [8e8, 'gas dynamics', 'Scharwächter et al. 2013, MNRAS 429, 2315'],
  '3C 405.0': [2.5e9, 'gas dynamics', 'Tadhunter et al. 2003, MNRAS 342, 861'],
  '3C 273.0': [8.9e8, 'reverberation mapping', 'Peterson et al. 2004, ApJ 613, 682'],
  '3C 120': [5.5e7, 'reverberation mapping', 'Peterson et al. 2004, ApJ 613, 682'],
  'NGC 5548': [6.7e7, 'reverberation mapping', 'Peterson et al. 2004, ApJ 613, 682'],
  'NGC 7469': [1.2e7, 'reverberation mapping', 'Peterson et al. 2004, ApJ 613, 682'],
  'NGC 3783': [3.0e7, 'reverberation mapping', 'Peterson et al. 2004, ApJ 613, 682'],
  'MARK 509': [1.4e8, 'reverberation mapping', 'Peterson et al. 2004, ApJ 613, 682'],
  'NGC 4051': [1.7e6, 'reverberation mapping', 'Denney et al. 2009, ApJ 702, 1353'],
  'NGC 4395': [3.6e5, 'reverberation mapping (the lightest Seyfert black hole known)', 'Peterson et al. 2005, ApJ 632, 799'],
  'NGC 3031': [7e7, 'gas dynamics', 'Devereux et al. 2003, AJ 125, 1226'],
  'NGC 4594': [6.6e8, 'stellar dynamics', 'Jardel et al. 2011, ApJ 739, 21'],
  'OJ 287': [1.8e10, 'the 12-year outburst cycle of its binary', 'Valtonen et al. 2008, Nature 452, 851'],
  'TON 618': [4e10, 'broad-line width', 'Shemmer et al. 2004, ApJ 614, 547'],
  'J0313−1806': [1.6e9, 'broad-line width', 'Wang et al. 2021, ApJL 907, L1'],
  'ULAS J1120+0641': [2e9, 'broad-line width', 'Mortlock et al. 2011, Nature 474, 616'],
};
const blackHoles = Object.entries(BLACK_HOLES).map(([name, [mass, method, ref]]) => [name, mass, method, ref]);
for (const name of Object.keys(BLACK_HOLES)) if (!agnByName.has(name) && !/^(J0313|ULAS|TON)/.test(name)) console.warn(`Black hole ${name}: no Véron entry of that name`);

// Host galaxies: a named galaxy within 1.5′ of an active nucleus carries it instead of a second point.
const localGalaxies = JSON.parse(readFileSync(new URL('../public/data/galaxies-local.json', import.meta.url), 'utf8')).galaxies.filter((g) => g.name !== 'Milky Way');
const namedGalaxies = JSON.parse(readFileSync(new URL('../public/data/galaxies-named.json', import.meta.url), 'utf8')).galaxies;
const galaxies = [...localGalaxies.map((g) => ({ name: g.name, l: g.l, b: g.b })), ...namedGalaxies.map((r) => ({ name: r[0], l: r[1], b: r[2] }))];
const hosts = [];
const hosted = new Set();
for (const a of agnByName.values()) {
  const [name, l, b, , vmag, cl, sp, radio] = a;
  if (a[3] > 0.2) continue; // Seyferts and nearby quasars only: the named galaxies stop around z = 0.1
  const cosb = Math.cos((b * Math.PI) / 180);
  let best, bestSep = 1.5 / 60;
  for (const g of galaxies) {
    const dl = Math.abs(((g.l - l + 540) % 360) - 180);
    const sep = Math.hypot(dl * cosb, g.b - b);
    if (sep < bestSep) { best = g; bestSep = sep; }
  }
  if (!best || hosted.has(best.name)) {
    if (!(a[3] > 0)) agnByName.delete(name);
    continue;
  }
  hosted.add(best.name);
  // [catalogue name of the galaxy, Véron name, class, spectrum code, V magnitude, 5 GHz flux]
  hosts.push([best.name, name, cl, sp, vmag, radio]);
  agnByName.delete(name);
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
    'Galaxy clusters: Abell, Corwin & Olowin 1989, ApJS 70, 1 (VizieR VII/110A), redshifts from Struble & Rood 1987. Active galactic nuclei (quasars, Seyferts, LINERs, BL Lacs): Véron-Cetty & Véron 2010, A&A 518, A10, 13th edition (VizieR VII/258), V < 17.5 or z ≥ 5; class Q/A/B and spectrum codes as in its ReadMe. Black-hole masses and record holders from the papers cited with each. Positions in galactic coordinates; distances from redshift (flat ΛCDM, H0 = 70, Ωm = 0.3).',
  fields: {
    clusters: ['abell', 'l_deg', 'b_deg', 'z', 'richness', 'count', 'bm_type'],
    agn: ['name', 'l_deg', 'b_deg', 'z', 'V_mag', 'class', 'spectrum', 'flux_5GHz_Jy'],
    hosts: ['galaxy', 'veron_name', 'class', 'spectrum', 'V_mag', 'flux_5GHz_Jy'],
    blackHoles: ['veron_name', 'mass_msun', 'method', 'ref'],
  },
  clusters,
  agn: [...agnByName.values()].filter((a) => a[3] > 0).sort((a, b) => a[3] - b[3]),
  hosts,
  blackHoles,
  records,
};
writeFileSync(new URL('../public/data/universe-objects.json', import.meta.url), JSON.stringify(out) + '\n');
const count = (cl) => out.agn.filter((a) => a[5] === cl).length;
console.log(`Abell clusters with redshifts: ${clusters.length}; AGN: ${out.agn.length} (${count('Q')} quasars, ${count('A')} Seyferts/LINERs, ${count('B')} BL Lacs); host galaxies: ${hosts.length}; black holes: ${blackHoles.length}; records: ${records.length}`);
