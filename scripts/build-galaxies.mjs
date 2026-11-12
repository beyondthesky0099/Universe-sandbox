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
 * Orientations on the sky come from HyperLEDA (Paturel et al. 2003, VizieR VII/237): the position
 * angle of the major axis (degrees, north through east) and, where the Local Volume catalogue
 * has none, the axis ratio. Each galaxy is cross-matched by position in a small cone.
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
      // A body with a nameless, empty RESOURCE is the mirror failing quietly, not an empty result.
      if (res.ok && !text.includes('#INFO\tError=') && !/^#RESOURCE=\s*$/m.test(text)) {
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
  if (lines.length < 4) return []; // an empty cone search has no table at all
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

// ---------------------------------------------------------------------------
// Orientations from HyperLEDA (VII/237): a cone search around each galaxy

const GAL_TO_EQ = [
  [-0.0548755604, 0.4941094279, -0.8676661490],
  [-0.8734370902, -0.4448296300, -0.1980763734],
  [-0.4838350155, 0.7469822445, 0.4559837762],
];
/** Galactic (l, b) degrees → equatorial J2000 (RA, Dec) degrees. */
function galacticToEquatorial(l, b) {
  const lr = (l * Math.PI) / 180, br = (b * Math.PI) / 180;
  const g = [Math.cos(br) * Math.cos(lr), Math.cos(br) * Math.sin(lr), Math.sin(br)];
  const e = GAL_TO_EQ.map((row) => row[0] * g[0] + row[1] * g[1] + row[2] * g[2]);
  let ra = (Math.atan2(e[1], e[0]) * 180) / Math.PI;
  if (ra < 0) ra += 360;
  return [ra, (Math.asin(Math.max(-1, Math.min(1, e[2]))) * 180) / Math.PI];
}

/**
 * The HyperLEDA entry for a galaxy: { pa, ba, d25 } (degrees, ratio, arcmin), or undefined.
 * `sizeArcmin` is the galaxy's known diameter, used to widen the cone and to prefer the big
 * galaxy over small companions and knots catalogued near its centre.
 */
async function ledaOrientation(name, l, b, sizeArcmin) {
  const [ra, dec] = galacticToEquatorial(l, b);
  const radius = Math.min(600, Math.max(90, (sizeArcmin ?? 0) * 60 * 0.5)); // arcsec
  const key = `leda-${name.replace(/[^A-Za-z0-9]+/g, '_')}`;
  const text = await vizier(key, {
    '-source': 'VII/237',
    '-out': 'PGC,logD25,logR25,PA,MType',
    '-out.add': '_r',
    '-c': `${ra.toFixed(5)} ${dec >= 0 ? '+' : ''}${dec.toFixed(5)}`,
    '-c.rs': String(radius),
    '-out.max': '50',
    '-sort': '_r',
  });
  let best;
  for (const r of parseTsv(text)) {
    const sep = num(r._r);
    const d25 = r.logD25 ? 10 ** num(r.logD25) * 0.1 : undefined; // arcmin
    if (!Number.isFinite(sep)) continue;
    // Separation in units of the catalogued size: the galaxy itself scores lowest.
    const score = sep / Math.max(30, (d25 ?? 0) * 60 * 0.5);
    if (score > 2) continue;
    if (!best || score < best.score) best = { score, pa: num(r.PA), ba: r.logR25 ? 10 ** -num(r.logR25) : undefined, d25 };
  }
  if (!best) return undefined;
  return { pa: best.pa, ba: round(best.ba, 2), d25: round(best.d25, 2) };
}

/** Run `fn` over `items` with a few in flight at a time. */
async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

let oriented = 0;
await mapLimited(local, 6, async (g) => {
  if (g.name === 'Milky Way') return;
  const sizeArcmin = g.size ? ((g.size / (g.d * 1000)) * 180 * 60) / Math.PI : undefined;
  const o = await ledaOrientation(g.name, g.l, g.b, sizeArcmin).catch((err) => {
    console.warn(`HyperLEDA ${g.name}: ${err.message}`);
    return undefined;
  });
  if (!o) return;
  if (Number.isFinite(o.pa)) {
    g.pa = o.pa;
    oriented++;
  }
  if (g.ba === undefined && o.ba !== undefined) g.ba = o.ba;
});
console.log(`HyperLEDA position angles: ${oriented} of ${local.length} Local Volume galaxies`);

// The named distant galaxies get [..., PA, b/a] appended (null when unknown).
let orientedNamed = 0;
await mapLimited(named, 6, async (row) => {
  const [name, l, b, cz] = row;
  const o = await ledaOrientation(`named-${name}`, l, b, undefined).catch(() => undefined);
  const pa = o && Number.isFinite(o.pa) ? o.pa : null;
  const ba = o?.ba ?? null;
  if (pa !== null) orientedNamed++;
  row.push(pa, ba);
  void cz;
});
console.log(`HyperLEDA position angles: ${orientedNamed} of ${named.length} named distant galaxies`);

const credit = {
  local:
    'Updated Nearby Galaxy Catalog: Karachentsev, Makarov & Kaisina 2013, AJ 145, 101 (VizieR J/AJ/145/101). Positions in galactic coordinates; distances in Mpc. Position angles (pa, degrees north through east) from HyperLEDA (Paturel et al. 2003, VizieR VII/237).',
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
  JSON.stringify({ source: credit.web, H0, fields: ['name', 'l_deg', 'b_deg', 'cz_kms', 'Kt_mag', 'T_type', 'PA_deg', 'b/a'], galaxies: named }) + '\n',
);
console.log(`Named distant galaxies: ${named.length}`);
console.log(`Local Volume: ${local.length} galaxies (nearest: ${local.slice(0, 5).map((g) => g.name).join(', ')})`);
console.log(`2MRS: ${web.length} galaxies with cz ≤ ${MAX_CZ} km/s`);
