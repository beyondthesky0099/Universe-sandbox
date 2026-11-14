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
 *          (VizieR III/215), photometric distances from its table 28;
 *   nova   classical and recurrent novae: Schaefer 2022, MNRAS 517, 6150 (VizieR J/MNRAS/517/6150,
 *          table 6), the best distance of each of the 402 known Galactic novae (Gaia parallaxes,
 *          expansion parallaxes, extinction and the bulge/disc population), with white-dwarf and
 *          donor masses from Ritter & Kolb where known;
 *   cv     cataclysmic variables: Canbay, Bilir, Özdönmez & Ak 2023, AJ 165, 163 (VizieR
 *          J/AJ/165/163), Gaia DR3 distances, joined by name and position to the Ritter & Kolb
 *          catalogue (B/cb, 7.24) for subtypes, masses and eclipses;
 *   cep    classical Cepheids: Skowron et al. 2019, Science 365, 478 (VizieR J/other/Sci/365.478),
 *          distances from the mid-infrared period–luminosity relation (OGLE, Gaia, ASAS-SN, ATLAS);
 *   maser  methanol and water masers in high-mass star-forming regions with VLBI parallaxes: Reid et
 *          al. 2019, ApJ 885, 131 (VizieR J/ApJ/885/131; BeSSeL and VERA).
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
// Ritter & Kolb: subtypes, masses and eclipses of cataclysmic binaries, found by name or position.
const RK_TYPES = {
  DN: 'dwarf nova', NL: 'nova-like', Na: 'fast nova', Nb: 'slow nova', Nc: 'very slow nova', Nr: 'recurrent nova', N: 'nova',
  AC: 'AM CVn star', SS: 'supersoft X-ray source', VY: 'VY Scl star', UX: 'UX UMa star', SU: 'SU UMa star', UG: 'U Gem star', ZC: 'Z Cam star',
  WZ: 'WZ Sge star', AM: 'polar', IP: 'intermediate polar', DQ: 'DQ Her star', SW: 'SW Sex star', ER: 'ER UMa star', CV: 'cataclysmic variable',
  CP: 'coherent pulsator', GC: 'in a globular cluster', CB: 'cataclysmic binary', LA: 'LARP', NP: 'non-magnetic',
};
const tidyName = (s) => s.replace(/^V\* /, '').replace(/^V0+(\d)/, 'V$1').replace(/\s+/g, ' ').trim();
const rk = parseTsv(await vizier('ritter-kolb', { '-source': 'B/cb/cbdata', '-out': 'Name,AltName,RAJ2000,DEJ2000,Type1,Type2,Type3,Type4,Orb.Per,EB,SpType2,M1,M2,Incl', '-out.max': 'unlimited' })).map((r) => {
  const [ra, dec] = sexagesimal(r.RAJ2000, r.DEJ2000);
  return { ...r, ra, dec, types: [r.Type1, r.Type2, r.Type3, r.Type4].map((t) => t.trim()).filter((t) => t && RK_TYPES[t]) };
});
const rkByName = new Map();
for (const r of rk) {
  rkByName.set(tidyName(r.Name), r);
  if (r.AltName) rkByName.set(tidyName(r.AltName), r);
}
/** The Ritter & Kolb row for a name, else the one within 20″ of (ra, dec). */
function ritterKolb(name, ra, dec) {
  const byName = rkByName.get(tidyName(name));
  if (byName) return byName;
  if (!Number.isFinite(ra)) return undefined;
  const cosd = Math.cos((dec * Math.PI) / 180);
  let best, bestSep = 20 / 3600;
  for (const r of rk) {
    const sep = Math.hypot((r.ra - ra) * cosd, r.dec - dec);
    if (sep < bestSep) { best = r; bestSep = sep; }
  }
  return best;
}
const rkFields = (r) => (r ? { types: r.types.length ? r.types : undefined, m1: round(num(r.M1), 2), m2: round(num(r.M2), 2), sptype2: r.SpType2 || undefined, eclipsing: /^[D12]$/.test(r.EB) || undefined, incl: round(num(r.Incl), 0) } : {});

// Novae: Schaefer's best distances for every known Galactic nova.
const nova = [];
for (const r of parseTsv(await vizier('novae', { '-source': 'J/MNRAS/517/6150/table6', '-out': 'Nova,f_Year,Year,LC,t3,Vpeak,SpType,FWHM,P,Pop,D,b_D,B_D,VMag,GLON,GLAT,E(B-V),Plx,e_Plx,Prop,_RA,_DE', '-out.max': 'unlimited' }))) {
  const d = num(r.D);
  if (!(d > 0) || d > 35000) continue;
  const pop = r.Pop.toLowerCase().replace('?', '');
  const plx = num(r.Plx), eplx = num(r.e_Plx);
  nova.push({
    name: r.Nova.trim(),
    l: round(num(r.GLON), 3),
    b: round(num(r.GLAT), 3),
    d: round(d / 1000, 3),
    dlo: round(num(r.b_D) / 1000, 3),
    dhi: round(num(r.B_D) / 1000, 3),
    year: round(num(r.Year), 1),
    recurrent: r.f_Year === 'RN' || undefined,
    lc: r.LC || undefined,
    t3: round(num(r.t3), 0),
    vpeak: round(num(r.Vpeak), 1),
    vmag: round(num(r.VMag), 1),
    sptype: r.SpType || undefined,
    fwhm: round(num(r.FWHM), 0),
    per: round(num(r.P), 5),
    pop: pop === 'globc' ? 'cluster' : pop === 'disc' || pop === 'bulge' ? pop : undefined,
    ebv: round(num(r['E(B-V)']), 2),
    gaia: plx > 0 && eplx > 0 && plx / eplx >= 3 ? true : undefined,
    prop: r.Prop || undefined,
    ...rkFields(ritterKolb(r.Nova, num(r._RA), num(r._DE))),
  });
}
const novaNames = new Set(nova.map((o) => tidyName(o.name)));

// Cataclysmic variables with Gaia DR3 distances (the novae above are left to Schaefer's list).
const cv = [];
for (const r of parseTsv(await vizier('cvs', { '-source': 'J/AJ/165/163/table1', '-out': 'Name,RAJ2000,DEJ2000,Group,Porb,Gmag,plx,e_plx,Dist,e_Dist', '-out.max': 'unlimited' }))) {
  const d = num(r.Dist);
  const name = tidyName(r.Name);
  if (!(d > 0) || d > 35000 || novaNames.has(name)) continue;
  const [ra, dec] = sexagesimal(r.RAJ2000, r.DEJ2000);
  const [l, b] = equatorialToGalactic(ra, dec);
  if (nova.some((o) => Math.hypot((o.l - l) * Math.cos((b * Math.PI) / 180), o.b - b) < 10 / 3600)) continue;
  const k = ritterKolb(name, ra, dec);
  cv.push({
    name,
    l: round(l, 3),
    b: round(b, 3),
    d: round(d / 1000, 3),
    magnetic: r.Group === 'mCV' || undefined,
    per: round(num(r.Porb) || num(k?.['Orb.Per']), 5),
    gmag: round(num(r.Gmag), 1),
    ...rkFields(k),
  });
}

// Classical Cepheids with period–luminosity distances. GCVS names are padded with underscores.
const GREEK = { alf: 'α', bet: 'β', gam: 'γ', del: 'δ', eps: 'ε', zet: 'ζ', eta: 'η', tet: 'θ', iot: 'ι', kap: 'κ', lam: 'λ', mu: 'μ', nu: 'ν', ksi: 'ξ', omi: 'ο', pi: 'π', rho: 'ρ', sig: 'σ', tau: 'τ', ups: 'υ', phi: 'φ', khi: 'χ', psi: 'ψ', ome: 'ω' };
const cepheidName = (s) => {
  const m = s.match(/^([A-Za-z0-9.]+)_+([A-Za-z]{3})$/);
  if (!m) return s.replace(/_+/g, ' ').trim();
  return `${GREEK[m[1]] ?? m[1]} ${m[2]}`;
};
/** Nearby Cepheids whose distance is not in Skowron et al. (their Gaia parallaxes saturate): Polaris from its companion's Gaia DR2 parallax. */
const HAND_DISTANCES = { 'α UMi': { d: 0.137, dsrc: 'Bond et al. 2018 (Polaris B parallax)' } };
const COMMON = { 'α UMi': 'Polaris', 'δ Cep': 'Delta Cephei', 'η Aql': 'Eta Aquilae', 'ζ Gem': 'Mekbuda', 'β Dor': 'Beta Doradus', 'l Car': 'l Carinae' };
const cep = [];
for (const r of parseTsv(await vizier('cepheids', { '-source': 'J/other/Sci/365.478/tables1', '-out': 'r_Name,Name,GLON,GLAT,Dist,e_Dist,Age,Per,Mode,AKs,WISE1', '-out.max': 'unlimited' }))) {
  const name = cepheidName(r.Name);
  const hand = HAND_DISTANCES[name];
  const d = hand?.d ?? num(r.Dist) / 1000;
  if (!(d > 0) || d > 35) continue;
  cep.push({
    name,
    common: COMMON[name],
    l: round(num(r.GLON), 3),
    b: round(num(r.GLAT), 3),
    d: round(d, 3),
    ed: hand ? undefined : round(num(r.e_Dist) / 1000, 3),
    dsrc: hand?.dsrc,
    per: round(num(r.Per), 4),
    mode: r.Mode.trim() === '1O' ? '1O' : 'F',
    age: round(num(r.Age), 0),
    aks: round(num(r.AKs), 2),
    survey: r.r_Name.trim(),
  });
}

// Masers with VLBI parallaxes (BeSSeL and VERA). A few sources are evolved red supergiants.
const ARMS = { '3kN': 'the near 3-kpc arm', '3kF': 'the far 3-kpc arm', Nor: 'the Norma arm', ScN: 'the Scutum arm (near)', ScF: 'the Scutum arm (far)', SgN: 'the Sagittarius arm (near)', SgF: 'the Sagittarius arm (far)', Loc: 'the Local arm', Per: 'the Perseus arm', Out: 'the Outer arm', CtN: 'the Centaurus arm (near)', CtF: 'the Centaurus arm (far)', CrN: 'the Carina arm (near)', CrF: 'the Carina arm (far)', AqS: 'the Aquila spur', LoS: 'the Local spur', OSC: 'the Outer Scutum–Centaurus arm', Con: 'the Connecting arm', GC: 'the Galactic Centre region', AqR: 'the Aquila Rift' };
const MASER_NAMES = { NGC6334: 'NGC 6334', SgrB2: 'Sgr B2', W51IRS2: 'W51 IRS2', W51M: 'W51 Main', W43M: 'W43 Main', W43S: 'W43 South', W33M: 'W33 Main', W3OH: 'W3(OH)', Orion: 'Orion KL', NGC7538: 'NGC 7538', NGC281: 'NGC 281', NGC281W: 'NGC 281 West', VXSgr: 'VX Sgr', NMLCyg: 'NML Cyg', PZCas: 'PZ Cas', SPer: 'S Per', VYCMa: 'VY CMa', V838Mon: 'V838 Mon', ON1: 'ON 1', ON2N: 'ON 2N', DR21A: 'DR 21A', DR20: 'DR 20', W75N: 'W75 N', W49N: 'W49 N', W33A: 'W33 A', W33B: 'W33 B', 'OH43.8-0.1': 'OH 43.8−0.1', L1287: 'L1287', S252: 'Sh2-252', S255: 'Sh2-255', S269: 'Sh2-269' };
const EVOLVED = new Set(['VXSgr', 'NMLCyg', 'PZCas', 'SPer', 'VYCMa', 'IRC-10414', 'V838Mon']);
const maser = [];
const maserNames = new Set();
for (const r of parseTsv(await vizier('masers', { '-source': 'J/ApJ/885/131/table1', '-out': 'Name,OName,RAJ2000,DEJ2000,plx,e_plx,pmE,pmN,VLSR,Arm', '-out.max': 'unlimited' }))) {
  const plx = num(r.plx);
  if (!(plx > 0)) continue;
  const [l, b] = equatorialToGalactic(...sexagesimal(r.RAJ2000, r.DEJ2000));
  const oname = r.OName.replace(/\s+/g, '');
  const arm = r.Arm.trim();
  const gname = r.Name.trim();
  // Several maser spots share a region's name (W33 A, W43 Main): the later ones carry their G-name too.
  let name = MASER_NAMES[oname] ?? (oname && !/^(IRAS|AFGL|-+)/.test(oname) ? oname.replace(/^([A-Za-z]+)(\d)/, '$1 $2') : gname);
  if (maserNames.has(name)) name = `${name} (${gname})`;
  maserNames.add(name);
  maser.push({
    name,
    gname,
    l: round(l, 3),
    b: round(b, 3),
    d: round(1 / plx, 3),
    ed: round(num(r.e_plx) / (plx * plx), 3),
    vlsr: num(r.VLSR),
    arm: ARMS[arm] ? arm : undefined,
    evolved: EVOLVED.has(oname) || undefined,
  });
}

for (const list of [hmxb, lmxb, wr, nova, cv, cep, maser]) for (const o of list) for (const k of Object.keys(o)) if (o[k] === undefined || Number.isNaN(o[k])) delete o[k];

const out = {
  source:
    'HMXBs: Fortin et al. 2023, A&A 671, A149 (VizieR J/A+A/671/A149), Gaia EDR3 distances (Bailer-Jones et al. 2021). LMXBs: Fortin et al. 2024, A&A 684, A124 (VizieR J/A+A/684/A124), Gaia or literature distances. Wolf–Rayet stars: van der Hucht 2001, VIIth catalogue (VizieR III/215), photometric distances. Novae: Schaefer 2022, MNRAS 517, 6150 (VizieR J/MNRAS/517/6150). Cataclysmic variables: Canbay et al. 2023, AJ 165, 163 (VizieR J/AJ/165/163), Gaia DR3 distances; subtypes, masses and eclipses from Ritter & Kolb (VizieR B/cb). Cepheids: Skowron et al. 2019, Science 365, 478 (VizieR J/other/Sci/365.478), period–luminosity distances. Masers: Reid et al. 2019, ApJ 885, 131 (VizieR J/ApJ/885/131), VLBI parallaxes. Positions in galactic coordinates, distances in kpc, periods in days, spins in seconds, masses in solar masses, ages in Myr.',
  hmxb,
  lmxb,
  wr,
  nova,
  cv,
  cep,
  maser,
};
writeFileSync(new URL('../public/data/galactic-objects.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`HMXBs: ${hmxb.length} (${hmxb.filter((o) => o.compact === 'BH').length} black holes); LMXBs: ${lmxb.length} (${lmxb.filter((o) => o.compact === 'BH').length} black holes); WR stars: ${wr.length}`);
console.log(`Novae: ${nova.length} (${nova.filter((o) => o.recurrent).length} recurrent, ${nova.filter((o) => o.types).length} with Ritter & Kolb data); CVs: ${cv.length} (${cv.filter((o) => o.types).length} with subtypes, ${cv.filter((o) => o.magnetic).length} magnetic); Cepheids: ${cep.length}; masers: ${maser.length}`);
