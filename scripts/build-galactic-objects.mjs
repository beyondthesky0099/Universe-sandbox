#!/usr/bin/env node
/**
 * Build public/data/galactic-objects.json, the Milky Way's X-ray binaries and Wolf–Rayet stars for
 * the Galaxy Map (every one with a measured distance):
 *
 *   hmxb   high-mass X-ray binaries: Fortin, García, Chaty & Coleiro 2023, A&A 671, A149
 *          (VizieR J/A+A/671/A149), with Gaia EDR3 distances (Bailer-Jones et al. 2021);
 *   lmxb   low-mass X-ray binaries: Fortin, Kalsi, García, Simaz-Bunzel & Chaty 2024, A&A 684,
 *          A124 (VizieR J/A+A/684/A124), Gaia or literature distances;
 *   wr     Wolf–Rayet stars: van der Hucht 2001, New Astron. Rev. 45, 135, the VIIth catalogue
 *          (VizieR III/215), photometric distances from its table 28.
 *
 *   node scripts/build-galactic-objects.mjs
 */
import { writeFileSync } from 'node:fs';
import { equatorialToGalactic, num, parseTsv, round, sexagesimal, vizierClient } from './lib/vizier.mjs';

const vizier = vizierClient('galactic-objects');
const clean = (s) => s.replace(/^(V\*|EM\*|Cl\*|HD) /, (m) => (m.startsWith('HD') ? 'HD ' : '')).replace(/\s+/g, ' ').trim();
/** X-ray names of famous low-mass X-ray binaries whose SIMBAD main identifier is a variable-star name. */
const XRAY_NAMES = {
  'V818 Sco': 'Sco X-1',
  'HZ Her': 'Her X-1',
  'V821 Ara': 'GX 339-4',
  'V616 Mon': 'A0620-00',
  'V1487 Aql': 'GRS 1915+105',
  'V1033 Sco': 'GRO J1655-40',
  'KV UMa': 'XTE J1118+480',
  'V1333 Aql': 'Aql X-1',
  'V1341 Cyg': 'Cyg X-2',
  'BR Cir': 'Cir X-1',
  'GU Mus': 'Nova Muscae 1991',
  'V381 Nor': 'XTE J1550-564',
  'QZ Vul': 'GS 2000+25',
  'V518 Per': 'GRO J0422+32',
};

// High-mass X-ray binaries
const hmxb = [];
for (const r of parseTsv(await vizier('hmxb', { '-source': 'J/A+A/671/A149/tablea', '-out': 'ID,RAJ2000,DEJ2000,Mx,Mo,Per,Ecc,PerSpin,Dist', '-out.max': 'unlimited' }))) {
  const dist = num(r.Dist);
  if (!(dist > 0) || dist > 35000) continue;
  const [l, b] = equatorialToGalactic(num(r.RAJ2000), num(r.DEJ2000));
  const mx = num(r.Mx);
  const spin = num(r.PerSpin);
  // The compact object: a measured mass above 3 M☉ means a black hole; a spin period means a pulsar.
  const compact = mx > 3 ? 'BH' : spin > 0 || (mx > 0 && mx <= 3) ? 'NS' : '?';
  hmxb.push({ name: clean(r.ID), l: round(l, 3), b: round(b, 3), d: round(dist / 1000, 3), compact, mx: round(mx, 2), mo: round(num(r.Mo), 2), per: round(num(r.Per), 4), ecc: round(num(r.Ecc), 3), spin: round(spin, 4) });
}

// Low-mass X-ray binaries
const lmxb = [];
for (const r of parseTsv(await vizier('lmxb', { '-source': 'J/A+A/684/A124/lmxbcat', '-out': 'MainID,RAJ2000,DEJ2000,Status,SpType,Compact,Bursts,Mx,Mo,Period,SpinPer,GaiaDist,OtherDist,GC', '-out.max': 'unlimited' }))) {
  // Gaia distances are in parsecs, literature ones in kiloparsecs; periods are in hours.
  const dist = num(r.GaiaDist) > 0 ? num(r.GaiaDist) / 1000 : num(r.OtherDist);
  const ra = num(r.RAJ2000), dec = num(r.DEJ2000);
  // Milky Way only: the Magellanic Clouds' binaries sit 50 kpc away, off the map.
  if (!(dist > 0) || dist > 35 || !Number.isFinite(ra) || !Number.isFinite(dec)) continue;
  const [l, b] = equatorialToGalactic(ra, dec);
  const c = r.Compact.toUpperCase();
  const compact = c.startsWith('BH') ? 'BH' : c.startsWith('NS') || r.Bursts === 'Yes' || num(r.SpinPer) > 0 ? 'NS' : '?';
  const main = clean(r.MainID);
  lmxb.push({
    name: XRAY_NAMES[main] ? `${XRAY_NAMES[main]} (${main})` : main,
    l: round(l, 3),
    b: round(b, 3),
    d: round(dist, 3),
    compact,
    candidate: r.Status.toLowerCase().startsWith('cand') || undefined,
    sptype: r.SpType || undefined,
    mx: round(num(r.Mx), 2),
    mo: round(num(r.Mo), 2),
    per: round(num(r.Period) / 24, 5),
    spin: round(num(r.SpinPer), 5),
    bursts: r.Bursts === 'Yes' || undefined,
    gc: r.GC || undefined,
  });
}

// Wolf–Rayet stars: positions (table 13) joined with distances (table 28) and winds (table 15).
const positions = new Map();
for (const r of parseTsv(await vizier('wr-pos', { '-source': 'III/215/table13', '-out': 'WR,Name,RAJ2000,DEJ2000', '-out.max': 'unlimited' }))) positions.set(r.WR, r);
const winds = new Map();
for (const r of parseTsv(await vizier('wr-par', { '-source': 'III/215/table15', '-out': 'WR,vinf,vmag', '-out.max': 'unlimited' }))) winds.set(r.WR, r);
const wr = [];
for (const r of parseTsv(await vizier('wr-dist', { '-source': 'III/215/table28', '-out': 'WR,SpType,d', '-out.max': 'unlimited' }))) {
  const d = num(r.d);
  const p = positions.get(r.WR);
  if (!(d > 0) || d > 35 || !p) continue;
  const [l, b] = equatorialToGalactic(...sexagesimal(p.RAJ2000, p.DEJ2000));
  const w = winds.get(r.WR);
  wr.push({ wr: r.WR, name: clean(p.Name) || `WR ${r.WR}`, l: round(l, 3), b: round(b, 3), d: round(d, 2), sptype: r.SpType, vinf: num(w?.vinf), vmag: round(num(w?.vmag), 2) });
}
for (const list of [hmxb, lmxb, wr]) for (const o of list) for (const k of Object.keys(o)) if (o[k] === undefined || Number.isNaN(o[k])) delete o[k];

const out = {
  source:
    'HMXBs: Fortin et al. 2023, A&A 671, A149 (VizieR J/A+A/671/A149), Gaia EDR3 distances (Bailer-Jones et al. 2021). LMXBs: Fortin et al. 2024, A&A 684, A124 (VizieR J/A+A/684/A124), Gaia or literature distances. Wolf–Rayet stars: van der Hucht 2001, VIIth catalogue (VizieR III/215), photometric distances. Positions in galactic coordinates, distances in kpc, periods in days, spins in seconds, masses in solar masses.',
  hmxb,
  lmxb,
  wr,
};
writeFileSync(new URL('../public/data/galactic-objects.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`HMXBs: ${hmxb.length} (${hmxb.filter((o) => o.compact === 'BH').length} black holes); LMXBs: ${lmxb.length} (${lmxb.filter((o) => o.compact === 'BH').length} black holes); WR stars: ${wr.length}`);
