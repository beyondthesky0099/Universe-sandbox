#!/usr/bin/env node
/**
 * Build public/data/clusters.json: real Milky Way star clusters, via VizieR (CDS, Harvard mirror).
 *
 * - Open clusters and moving groups: Hunt & Reffert 2023, "Improving the open cluster census.
 *   II." (A&A 673, A114; J/A+A/673/A114), the Gaia DR3 census of about 7,000 clusters with
 *   distances, sizes, member counts and ages.
 * - Globular clusters: Harris's catalogue of Milky Way globular clusters (VII/202), with their
 *   distances from the Sun, half-light radii and metallicities.
 *
 * Familiar names (Pleiades, Hyades, Omega Centauri, ...) are resolved with SIMBAD and matched to
 * the catalogues by position, never typed against a catalogue entry by hand.
 *
 *   node scripts/build-clusters.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VIZIER = 'https://vizier.cfa.harvard.edu/viz-bin/asu-tsv';
const cache = new URL('../node_modules/.cache/clusters/', import.meta.url).pathname;
mkdirSync(cache, { recursive: true });

async function fetchCached(file, url, ok) {
  if (existsSync(file)) return readFileSync(file, 'utf8');
  for (let attempt = 0; ; attempt++) {
    let problem;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(240000) });
      const text = res.ok ? await res.text() : '';
      if (res.ok && ok(text)) {
        writeFileSync(file, text);
        return text;
      }
      problem = `HTTP ${res.status} ${text.slice(0, 160)}`;
    } catch (err) {
      problem = String(err?.cause?.code ?? err?.name ?? err);
    }
    if (attempt >= 7) throw new Error(`${url}: ${problem}`);
    console.warn(`${file.split('/').pop()}: ${problem}, retrying…`);
    await new Promise((r) => setTimeout(r, 4000 * 2 ** Math.min(attempt, 4)));
  }
}

function vizier(name, params) {
  const url = new URL(VIZIER);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return fetchCached(join(cache, `${name}.tsv`), url, (t) => !t.includes('#INFO\tError=') && t.split('\n').filter((l) => l && !l.startsWith('#')).length > 3);
}

/** Parse VizieR TSV: header line, units line, dashes line, then rows. */
function parseTsv(text) {
  const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
  const header = lines[0].split('\t').map((h) => h.trim());
  return lines.slice(3).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

const num = (s) => (s === '' || s === undefined ? undefined : Number(s));
const round = (v, d) => (v === undefined || !Number.isFinite(v) ? undefined : Number(v.toFixed(d)));

const hr = parseTsv(await vizier('hunt-reffert-2023', {
  '-source': 'J/A+A/673/A114/clusters',
  '-out': 'Name,AllNames,Type,N,GLON,GLAT,r50,r50pc,dist50,logAge50',
  '-out.max': 'unlimited',
}));
const harris = parseTsv(await vizier('harris-globulars', {
  '-source': 'VII/202/catalog', '-out': 'ID,Name,GLON,GLAT,Rsun,Rh,[Fe/H],MVt', '-out.max': 'unlimited',
}));
console.log(`Hunt & Reffert: ${hr.length} clusters; Harris: ${harris.length} globular clusters`);

// --- Familiar names via SIMBAD ------------------------------------------------------------------
const FAMOUS = [
  ['M 45', 'Pleiades (M45)'], ['Melotte 25', 'Hyades'], ['M 44', 'Beehive Cluster (M44)'], ['NGC 869', 'Double Cluster (h Persei)'],
  ['NGC 884', 'Double Cluster (χ Persei)'], ['Melotte 20', 'Alpha Persei Cluster'], ['Melotte 111', 'Coma Star Cluster'],
  ['IC 2602', 'Southern Pleiades (IC 2602)'], ['NGC 4755', 'Jewel Box (NGC 4755)'], ['M 11', 'Wild Duck Cluster (M11)'],
  ['M 6', 'Butterfly Cluster (M6)'], ['M 7', 'Ptolemy Cluster (M7)'], ['M 67', 'M67'], ['NGC 2547', 'NGC 2547'],
  ['IC 2391', 'Omicron Velorum Cluster'], ['M 35', 'M35'], ['M 41', 'M41'], ['M 47', 'M47'], ['NGC 3532', 'Wishing Well Cluster'],
  ['Trumpler 14', 'Trumpler 14'], ['NGC 2516', 'Southern Beehive (NGC 2516)'],
  // Globular clusters: matched only against Harris's catalogue.
  ['NGC 5139', 'Omega Centauri', 'globular'], ['NGC 104', '47 Tucanae', 'globular'], ['M 13', 'Hercules Cluster (M13)', 'globular'],
  ['M 4', 'M4', 'globular'], ['M 22', 'M22', 'globular'], ['M 3', 'M3', 'globular'], ['M 15', 'M15', 'globular'], ['M 5', 'M5', 'globular'],
  ['M 92', 'M92', 'globular'], ['NGC 6397', 'NGC 6397', 'globular'], ['M 80', 'M80', 'globular'],
];
const DEG = Math.PI / 180;
function toGalactic(ra, dec) {
  const ap = 192.85948 * DEG, dp = 27.12825 * DEG, lncp = 122.93192 * DEG;
  const a = ra * DEG, d = dec * DEG;
  const sb = Math.sin(dp) * Math.sin(d) + Math.cos(dp) * Math.cos(d) * Math.cos(a - ap);
  const y = Math.cos(d) * Math.sin(a - ap);
  const x = Math.cos(dp) * Math.sin(d) - Math.sin(dp) * Math.cos(d) * Math.cos(a - ap);
  return { l: ((lncp - Math.atan2(y, x)) / DEG + 360) % 360, b: Math.asin(sb) / DEG };
}
function sep(l1, b1, l2, b2) {
  const c = Math.sin(b1 * DEG) * Math.sin(b2 * DEG) + Math.cos(b1 * DEG) * Math.cos(b2 * DEG) * Math.cos((l1 - l2) * DEG);
  return Math.acos(Math.min(1, c)) / DEG;
}
const script = ['output console=off script=off', 'format object "%IDLIST(1)|%COO(d;A D)|%IDLIST[%*;]"', ...FAMOUS.map((f) => f[0])].join('\n');
const simbad = await fetchCached(
  join(cache, `simbad-${createHash('sha1').update(script).digest('hex').slice(0, 10)}.txt`),
  `https://simbad.cfa.harvard.edu/simbad/sim-script?script=${encodeURIComponent(script)}`,
  (t) => !t.includes('::error') && t.split('\n').filter((l) => l.includes('|')).length === FAMOUS.length,
);
/** Catalogue designation in a comparable form: "Cl Melotte 20", "Mel 20" and "Melotte_20" all → "MELOTTE20". */
const normId = (s) =>
  s.toUpperCase().replace(/^CL\s+/, '').replace(/^MEL\b/, 'MELOTTE').replace(/^CR\b/, 'COLLINDER').replace(/^TR\b/, 'TRUMPLER').replace(/[\s_]+/g, '').replace(/^([A-Z]+)0+(\d)/, '$1$2');
const resolved = simbad.split('\n').filter((l) => l.includes('|')).map((l) => {
  const [, coo, ids] = l.split('|');
  const [ra, dec] = coo.trim().split(/\s+/).map(Number);
  return { ...toGalactic(ra, dec), ids: new Set(ids.split(';').map(normId).filter(Boolean)) };
});

// --- Clusters -------------------------------------------------------------------------------------
/** A readable catalogue designation: the first NGC/IC/Melotte/Collinder/... name, else the catalogue's own. */
function designation(r) {
  const names = r.AllNames.split(',').map((s) => s.replace(/_/g, ' ').trim()).filter(Boolean);
  return names.find((n) => /^(NGC|IC|Melotte|Collinder|Trumpler|Berkeley|Stock|King|Ruprecht|Westerlund|Blanco|Platais)\b/.test(n)) ?? r.Name.replace(/_/g, ' ');
}
const open = hr
  .filter((r) => r.Type !== 'g') // globulars come from Harris
  .map((r) => ({
    kind: r.Type === 'm' ? 'group' : 'open',
    l: num(r.GLON), b: num(r.GLAT), d: num(r.dist50), rPc: num(r.r50pc), rDeg: num(r.r50), n: num(r.N), age: num(r.logAge50), id: designation(r),
    ids: r.AllNames.split(',').map(normId).filter(Boolean),
  }));
const globular = harris.map((r) => ({
  kind: 'globular', l: num(r.GLON), b: num(r.GLAT), d: num(r.Rsun) * 1000, rDeg: (num(r.Rh) ?? 1) / 60, feh: num(r['[Fe/H]']), mv: num(r.MVt),
  id: r.ID + (r.Name ? ` (${r.Name})` : ''), ids: [normId(r.ID), ...(r.Name ? [normId(r.Name)] : [])],
}));
for (const g of globular) g.rPc = g.d * Math.tan(g.rDeg * DEG);

FAMOUS.forEach(([, display, kind], i) => {
  const s = resolved[i];
  const all = kind === 'globular' ? globular : open;
  // 1. A shared designation (NGC, Melotte, Collinder, ...). The Gaia census lists older
  //    designations as cross-identifications, sometimes on more than one cluster, so take the
  //    richest of those.
  let best;
  for (const c of all) {
    if (c.ids.some((id) => s.ids.has(id)) && (!best || (c.n ?? 0) > (best.n ?? 0))) best = c;
  }
  // 2. Otherwise the richest cluster within its half-member radius of SIMBAD's position, so a
  //    small cluster that happens to lie in the same direction is not picked.
  if (!best) {
    for (const c of all) {
      if (sep(s.l, s.b, c.l, c.b) < Math.max(0.15, c.rDeg ?? 0) && (!best || (c.n ?? 0) > (best.n ?? 0))) best = c;
    }
  }
  if (!best) console.warn(`No catalogue match for ${display}`);
  else if (!best.name) best.name = display;
});

const out = {
  source:
    'Open clusters and moving groups: Hunt & Reffert 2023 (A&A 673, A114), Gaia DR3; globular clusters: Harris catalogue (VII/202). Via VizieR (CDS). Familiar names resolved with SIMBAD.',
  fields: {
    open: ['l', 'b', 'distancePc', 'halfRadiusPc', 'halfRadiusDeg', 'members', 'log10 age (yr)', 'moving group (1) or open cluster (0)', 'id', 'name?'],
    globular: ['l', 'b', 'distancePc', 'halfRadiusPc', 'halfLightRadiusDeg', '[Fe/H]', 'absolute V magnitude', 'id', 'name?'],
  },
  open: open.map((c) => [round(c.l, 3), round(c.b, 3), round(c.d, 0), round(c.rPc, 2), round(c.rDeg, 4), c.n, round(c.age, 2), c.kind === 'group' ? 1 : 0, c.id, ...(c.name ? [c.name] : [])]),
  globular: globular.map((c) => [round(c.l, 3), round(c.b, 3), round(c.d, 0), round(c.rPc, 2), round(c.rDeg, 4), c.feh ?? null, c.mv ?? null, c.id, ...(c.name ? [c.name] : [])]),
};
writeFileSync(new URL('../public/data/clusters.json', import.meta.url), JSON.stringify(out) + '\n');
const named = [...open, ...globular].filter((c) => c.name).length;
console.log(`open clusters: ${open.filter((c) => c.kind === 'open').length}; moving groups: ${open.filter((c) => c.kind === 'group').length}; globular clusters: ${globular.length}; ${named} with familiar names`);
