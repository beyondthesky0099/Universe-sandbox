#!/usr/bin/env node
/**
 * Build real galaxy catalogues for the "Universe" map from VizieR (CDS, via the Harvard mirror):
 *
 *   public/data/galaxies-local.json  Updated Nearby Galaxy Catalog (Karachentsev, Makarov &
 *                                    Kaisina 2013, AJ 145, 101; VizieR J/AJ/145/101): every
 *                                    known galaxy within ~26 Mpc with a measured distance.
 *   public/data/galaxies-2mrs.json   2MASS Redshift Survey (Huchra et al. 2012, ApJS 199, 26;
 *                                    VizieR J/ApJS/199/26): ~44,000 galaxies across the whole
 *                                    sky. Distances come from redshift (cz / H0), so they include
 *                                    peculiar-velocity distortions ("fingers of God").
 *
 * Positions are stored as galactic longitude/latitude (degrees) plus distance (Mpc).
 *
 *   node scripts/build-galaxies.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VIZIER = 'https://vizier.cfa.harvard.edu/viz-bin/asu-tsv';
const H0 = 70; // km/s/Mpc
const MAX_CZ = 15000; // km/s, about 214 Mpc

const cache = new URL('../node_modules/.cache/galaxies/', import.meta.url).pathname;
mkdirSync(cache, { recursive: true });

async function vizier(name, params) {
  const file = join(cache, `${name}.tsv`);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const url = new URL(VIZIER);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    let problem;
    try {
      const res = await fetch(url);
      const text = res.ok ? await res.text() : '';
      if (res.ok && !text.includes('#INFO\tError=')) {
        writeFileSync(file, text);
        return text;
      }
      problem = `HTTP ${res.status} ${text.match(/Error=.*/)?.[0] ?? ''}`;
    } catch (err) {
      // Dropped connections happen on large responses; retry.
      problem = String(err?.cause?.code ?? err);
    }
    if (attempt >= 5) throw new Error(`VizieR ${name}: ${problem}`);
    console.warn(`VizieR ${name}: ${problem}, retrying…`);
    await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
  }
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

// ---------------------------------------------------------------------------
// Local Volume: Updated Nearby Galaxy Catalog

const ungc = parseTsv(
  await vizier('ungc', {
    '-source': 'J/AJ/145/101/catalog',
    '-out': 'Name,Dist,TT,Mcl,A26,b/a,i,KLum,M26,MHI,HRV,Vlg,MD',
    '-out.add': '_Glon,_Glat',
    '-out.max': 'unlimited',
  }),
);
const local = [];
for (const r of ungc) {
  const dist = num(r.Dist);
  const l = num(r._Glon);
  const b = num(r._Glat);
  if (!(dist > 0) || !Number.isFinite(l) || !Number.isFinite(b)) continue;
  const g = {
    name: r.Name.replace(/\s+/g, ' '),
    l: round(l, 3),
    b: round(b, 3),
    d: round(dist, 3), // Mpc
    t: num(r.TT), // de Vaucouleurs T-type: <=-1 elliptical/lenticular, 0-8 spiral, 9-10 irregular
    m: r.Mcl || undefined, // dwarf morphology (Sph, Im, Ir, dE, BCD, ...)
    size: round(num(r.A26), 2), // kpc, major linear diameter
    ba: round(num(r['b/a']), 2),
    inc: num(r.i),
    lk: round(num(r.KLum), 2), // log10 Ks luminosity (Lsun)
    mass: round(num(r.M26), 2), // log10 mass within the Holmberg radius (Msun)
    hi: round(num(r.MHI), 2), // log10 HI gas mass (Msun)
    v: num(r.HRV), // heliocentric radial velocity (km/s)
    md: r.MD || undefined, // main gravitational disturber
  };
  for (const k of Object.keys(g)) if (g[k] === undefined || Number.isNaN(g[k])) delete g[k];
  local.push(g);
}
local.sort((a, b) => a.d - b.d);

// ---------------------------------------------------------------------------
// Cosmic web: 2MASS Redshift Survey

const tmrs = parseTsv(
  await vizier('2mrs', {
    '-source': 'J/ApJS/199/26/table3',
    '-out': 'GLON,GLAT,Ktmag,cz,type,CAT',
    '-out.max': 'unlimited',
  }),
);
const web = [];
for (const r of tmrs) {
  const cz = num(r.cz);
  const l = num(r.GLON);
  const b = num(r.GLAT);
  if (!(cz > 0) || cz > MAX_CZ || !Number.isFinite(l) || !Number.isFinite(b)) continue;
  // [l, b, cz (km/s), Ks total magnitude]
  web.push([round(l, 2), round(b, 2), Math.round(cz), round(num(r.Ktmag), 1)]);
}

// Named galaxies beyond the Local Volume: the brightest 2MRS galaxies (total Ks < 8.5), with
// their catalogue names and numeric T-types (leading integer of the ZCAT type code).
const named = [];
for (const r of tmrs) {
  const cz = num(r.cz);
  const kt = num(r.Ktmag);
  if (!(cz / H0 > 11) || cz > MAX_CZ || !(kt < 8.5)) continue;
  const t = r.type.match(/^-?\d+/);
  named.push([r.CAT.replace(/_/g, ''), round(num(r.GLON), 3), round(num(r.GLAT), 3), Math.round(cz), round(kt, 2), t ? Number(t[0]) : null]);
}

const credit = {
  local:
    'Updated Nearby Galaxy Catalog: Karachentsev, Makarov & Kaisina 2013, AJ 145, 101 (VizieR J/AJ/145/101). Positions in galactic coordinates; distances in Mpc.',
  web: `2MASS Redshift Survey: Huchra et al. 2012, ApJS 199, 26 (VizieR J/ApJS/199/26). Distances are cz/H0 with H0 = ${H0} km/s/Mpc, cz ≤ ${MAX_CZ} km/s.`,
};
const out = new URL('../public/data/', import.meta.url);
writeFileSync(new URL('galaxies-local.json', out), JSON.stringify({ source: credit.local, galaxies: local }) + '\n');
writeFileSync(
  new URL('galaxies-2mrs.json', out),
  JSON.stringify({ source: credit.web, H0, fields: ['l_deg', 'b_deg', 'cz_kms', 'Kt_mag'], galaxies: web }) + '\n',
);
writeFileSync(
  new URL('galaxies-named.json', out),
  JSON.stringify({ source: credit.web, H0, fields: ['name', 'l_deg', 'b_deg', 'cz_kms', 'Kt_mag', 'T_type'], galaxies: named }) + '\n',
);
console.log(`Named distant galaxies: ${named.length}`);
console.log(`Local Volume: ${local.length} galaxies (nearest: ${local.slice(0, 5).map((g) => g.name).join(', ')})`);
console.log(`2MRS: ${web.length} galaxies with cz ≤ ${MAX_CZ} km/s`);
