#!/usr/bin/env node
/**
 * Build public/data/nebulae.json: real Milky Way nebulae from professional catalogues, via
 * VizieR (CDS, Harvard mirror):
 *
 * - HII regions: the WISE Catalog of Galactic HII Regions (Anderson et al. 2014, ApJS 212, 1;
 *   J/ApJS/212/1). Every known HII region (class K) with its position and radius; those with
 *   measured distances (parallax, kinematic or spectrophotometric) are placed in 3D.
 * - Planetary nebulae: names and positions from the Strasbourg-ESO Catalogue of Galactic PNe
 *   (Acker et al. 1992; V/84). Distances from Gaia EDR3 parallaxes of their central stars
 *   (Gonzalez-Santamaria et al. 2021, A&A 656, A51; J/A+A/656/A51) where good, otherwise the
 *   statistical distances of Stanghellini & Haywood 2010 (ApJ 714, 1096; J/ApJ/714/1096).
 * - Supernova remnants: Green's catalogue (Green 2019, J. Astrophys. Astr. 40, 36; VII/284).
 *   It has positions and sizes but no distances, so remnants appear on the sky only.
 *
 *   node scripts/build-nebulae.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VIZIER = 'https://vizier.cfa.harvard.edu/viz-bin/asu-tsv';
const cache = new URL('../node_modules/.cache/nebulae/', import.meta.url).pathname;
mkdirSync(cache, { recursive: true });

async function vizier(name, params) {
  const file = join(cache, `${name}.tsv`);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const url = new URL(VIZIER);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    let problem;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
      const text = res.ok ? await res.text() : '';
      const rows = text.split('\n').filter((l) => l && !l.startsWith('#')).length;
      if (res.ok && !text.includes('#INFO\tError=') && rows > 3) {
        writeFileSync(file, text);
        return text;
      }
      problem = `HTTP ${res.status}, ${rows} lines ${text.match(/Error=.*/)?.[0] ?? ''}`;
    } catch (err) {
      problem = String(err?.cause?.code ?? err?.name ?? err);
    }
    if (attempt >= 7) throw new Error(`VizieR ${name}: ${problem}`);
    console.warn(`VizieR ${name}: ${problem}, retrying…`);
    await new Promise((r) => setTimeout(r, 4000 * 2 ** Math.min(attempt, 4)));
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

const wise = parseTsv(await vizier('wise-hii', {
  '-source': 'J/ApJS/212/1/wisecat', '-out': 'WISE,Cl,GLON,GLAT,Rad,HIIName,Name,Dist,e_Dist,r_Dist,Meth', '-out.max': 'unlimited',
}));
const acker = parseTsv(await vizier('pn-acker', {
  '-source': 'V/84/main', '-out': 'PNG,Name', '-out.add': '_Glon,_Glat', '-out.max': 'unlimited',
}));
const gaiaPn = parseTsv(await vizier('pn-gaia', {
  '-source': 'J/A+A/656/A51/tablea2', '-out': 'PNG,Plx,e_Plx,Dist,b_Dist,B_Dist,Radang,Radphys,Morph', '-out.max': 'unlimited',
}));
const stang = parseTsv(await vizier('pn-stanghellini', {
  '-source': 'J/ApJ/714/1096/table1', '-out': 'PNG,d,e_d,theta,Morph', '-out.add': '_Glon,_Glat', '-out.max': 'unlimited',
}));
const green = parseTsv(await vizier('snr-green', {
  '-source': 'VII/284/snrs', '-out': 'SNR,MajDiam,MinDiam,type,Names', '-out.add': '_Glon,_Glat', '-out.max': 'unlimited',
}));

// --- Familiar names, resolved by SIMBAD (position + identifiers), never typed in by hand. ---
const FAMOUS = [
  // [SIMBAD identifier, display name, kind]
  ['M 42', 'Orion Nebula (M42)', 'hii'], ['M 8', 'Lagoon Nebula (M8)', 'hii'], ['M 16', 'Eagle Nebula (M16)', 'hii'],
  ['M 17', 'Omega Nebula (M17)', 'hii'], ['M 20', 'Trifid Nebula (M20)', 'hii'], ['NGC 2237', 'Rosette Nebula', 'hii'],
  ['NGC 7000', 'North America Nebula', 'hii'], ['IC 1805', 'Heart Nebula', 'hii'], ['IC 1848', 'Soul Nebula', 'hii'],
  ['NGC 1499', 'California Nebula', 'hii'], ['NGC 7635', 'Bubble Nebula', 'hii'], ['NGC 6888', 'Crescent Nebula', 'hii'],
  ['IC 405', 'Flaming Star Nebula', 'hii'], ['NGC 2264', 'Cone Nebula', 'hii'], ['NGC 281', 'Pacman Nebula', 'hii'],
  ['IC 1396', "Elephant's Trunk Nebula", 'hii'], ['NGC 3372', 'Carina Nebula', 'hii'], ['W 51', 'W51', 'hii'],
  ['Sgr B2', 'Sagittarius B2', 'hii'], ['NGC 6334', "Cat's Paw Nebula", 'hii'], ['NGC 6357', 'Lobster Nebula', 'hii'],
  ['IC 2944', 'Running Chicken Nebula', 'hii'], ['NGC 3603', 'NGC 3603', 'hii'], ['W 49', 'W49', 'hii'],
  ['M 57', 'Ring Nebula (M57)', 'pn'], ['NGC 7293', 'Helix Nebula', 'pn'], ['M 27', 'Dumbbell Nebula (M27)', 'pn'],
  ['NGC 6543', "Cat's Eye Nebula", 'pn'], ['NGC 2392', 'Eskimo Nebula', 'pn'], ['M 97', 'Owl Nebula (M97)', 'pn'],
  ['NGC 7009', 'Saturn Nebula', 'pn'], ['NGC 3132', 'Southern Ring Nebula', 'pn'], ['NGC 6302', 'Butterfly Nebula', 'pn'],
  ['NGC 7662', 'Blue Snowball Nebula', 'pn'], ['IC 418', 'Spirograph Nebula', 'pn'], ['M 76', 'Little Dumbbell (M76)', 'pn'],
  ['NGC 3242', 'Ghost of Jupiter', 'pn'], ['NGC 6826', 'Blinking Planetary', 'pn'], ['NGC 6720', 'Ring Nebula (M57)', 'pn'],
  ['M 1', 'Crab Nebula (M1)', 'snr'], ['Cassiopeia A', 'Cassiopeia A', 'snr'], ['NAME Vela SNR', 'Vela Supernova Remnant', 'snr'],
  ['NAME Cygnus Loop', 'Cygnus Loop (Veil Nebula)', 'snr'], ['SN 1572', "Tycho's Supernova Remnant", 'snr'],
  ['SN 1604', "Kepler's Supernova Remnant", 'snr'], ['IC 443', 'Jellyfish Nebula (IC 443)', 'snr'], ['W 50', 'W50 (around SS 433)', 'snr'],
];

const DEG = Math.PI / 180;
/** Equatorial J2000 → galactic (deg). */
function toGalactic(ra, dec) {
  const ap = 192.85948 * DEG, dp = 27.12825 * DEG, lncp = 122.93192 * DEG;
  const a = ra * DEG, d = dec * DEG;
  const sb = Math.sin(dp) * Math.sin(d) + Math.cos(dp) * Math.cos(d) * Math.cos(a - ap);
  const y = Math.cos(d) * Math.sin(a - ap);
  const x = Math.cos(dp) * Math.sin(d) - Math.sin(dp) * Math.cos(d) * Math.cos(a - ap);
  return { l: ((lncp - Math.atan2(y, x)) / DEG + 360) % 360, b: Math.asin(sb) / DEG };
}
/** Angular separation (deg) between two galactic positions. */
function sep(l1, b1, l2, b2) {
  const c = Math.sin(b1 * DEG) * Math.sin(b2 * DEG) + Math.cos(b1 * DEG) * Math.cos(b2 * DEG) * Math.cos((l1 - l2) * DEG);
  return Math.acos(Math.min(1, c)) / DEG;
}

const simbadFile = join(cache, 'simbad-famous.txt');
let simbad;
if (existsSync(simbadFile)) simbad = readFileSync(simbadFile, 'utf8');
else {
  const script = ['output console=off script=off', 'format object "%IDLIST(1)|%COO(d;A D)|%IDLIST[%*;]"', ...FAMOUS.map((f) => f[0])].join('\n');
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`https://simbad.cfa.harvard.edu/simbad/sim-script?script=${encodeURIComponent(script)}`, { signal: AbortSignal.timeout(120000) });
      simbad = await res.text();
      if (res.ok && !simbad.includes('::error')) break;
      throw new Error(simbad.slice(0, 300));
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 4000 * 2 ** attempt));
    }
  }
  writeFileSync(simbadFile, simbad);
}
const resolved = simbad.split('\n').filter((l) => l.includes('|')).map((l) => {
  const [, coo, ids] = l.split('|');
  const [ra, dec] = coo.trim().split(/\s+/).map(Number);
  return { ...toGalactic(ra, dec), ids: ids.split(';').map((s) => s.replace(/\s+/g, ' ').trim()) };
});
if (resolved.length !== FAMOUS.length) throw new Error(`SIMBAD resolved ${resolved.length} of ${FAMOUS.length} names`);
const norm = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();

// --- HII regions: confirmed ones (classes K and G) ------------------------------------------
const hii = wise
  .filter((r) => r.Cl === 'K' || r.Cl === 'G')
  .map((r) => ({ l: num(r.GLON), b: num(r.GLAT), d: num(r.Dist), rad: num(r.Rad), id: r.HIIName || `WISE ${r.WISE}`, meth: r.Meth || undefined }));

// --- Planetary nebulae ------------------------------------------------------------------------
const pngKey = (s) => s.replace(/^PN\s*G/, '').trim();
const gaiaBy = new Map(gaiaPn.map((r) => [pngKey(r.PNG), r]));
const stangBy = new Map(stang.map((r) => [pngKey(r.PNG), r]));
const pn = acker.map((r) => {
  const key = pngKey(r.PNG);
  const g = gaiaBy.get(key);
  const s = stangBy.get(key);
  // Gaia parallax distance when the parallax is at least 3σ; else the statistical distance.
  const gaiaOk = g && num(g.Dist) && num(g.Plx) / num(g.e_Plx) >= 3;
  const d = gaiaOk ? num(g.Dist) / 1000 : s ? num(s.d) : undefined;
  const radArcsec = g && num(g.Radang) ? num(g.Radang) : s && num(s.theta) ? num(s.theta) : undefined;
  return { l: num(r._Glon), b: num(r._Glat), d, rad: radArcsec, id: r.Name.replace(/\s+/g, ' '), png: key, src: gaiaOk ? 'gaia' : d ? 'stat' : undefined };
});

// --- Supernova remnants -----------------------------------------------------------------------
const snr = green.map((r) => ({
  l: num(r._Glon), b: num(r._Glat), maj: num(r.MajDiam), min: num(r.MinDiam) ?? num(r.MajDiam), type: r.type.trim(),
  id: r.Names ? r.Names.split(',')[0].replace(/[()]/g, '').trim() : r.SNR, snr: r.SNR,
}));

// --- Attach familiar names ----------------------------------------------------------------------
FAMOUS.forEach(([, display, kind], i) => {
  const s = resolved[i];
  const ids = new Set(s.ids.map(norm));
  const list = kind === 'hii' ? hii : kind === 'pn' ? pn : snr;
  // Prefer an identifier match (NGC/IC/M names in the catalogue), else the nearest by position.
  let best = list.find((o) => ids.has(norm(o.id)));
  if (!best) {
    let bestSep = kind === 'pn' ? 0.05 : kind === 'snr' ? 0.5 : 0.35;
    for (const o of list) {
      const d = sep(s.l, s.b, o.l, o.b);
      if (d < bestSep) {
        bestSep = d;
        best = o;
      }
    }
  }
  if (!best) console.warn(`No catalogue match for ${display}`);
  else if (!best.name) best.name = display;
});

const out = {
  source:
    'HII: WISE Catalog of Galactic HII Regions (Anderson et al. 2014); PNe: Strasbourg-ESO catalogue (Acker et al. 1992), Gaia EDR3 distances (Gonzalez-Santamaria et al. 2021) and statistical distances (Stanghellini & Haywood 2010); SNRs: Green (2019). Via VizieR (CDS). Familiar names resolved with SIMBAD.',
  fields: {
    hii: ['l', 'b', 'distanceKpc|null', 'radiusArcsec', 'id', 'name?'],
    pn: ['l', 'b', 'distanceKpc|null', 'radiusArcsec|null', 'id', 'distanceSource (g=Gaia, s=statistical, null)', 'name?'],
    snr: ['l', 'b', 'majorArcmin', 'minorArcmin', 'type (S shell, F filled, C composite)', 'id', 'name?'],
  },
  hii: hii.map((o) => [round(o.l, 3), round(o.b, 3), o.d ? round(o.d, 2) : null, o.rad ?? 0, o.id, ...(o.name ? [o.name] : [])]),
  pn: pn.map((o) => [round(o.l, 3), round(o.b, 3), o.d ? round(o.d, 3) : null, o.rad ? round(o.rad, 1) : null, o.id, o.src === 'gaia' ? 'g' : o.src === 'stat' ? 's' : null, ...(o.name ? [o.name] : [])]),
  snr: snr.map((o) => [round(o.l, 3), round(o.b, 3), o.maj ?? 1, o.min ?? 1, o.type, o.id, ...(o.name ? [o.name] : [])]),
};
writeFileSync(new URL('../public/data/nebulae.json', import.meta.url), JSON.stringify(out) + '\n');
const named = [...hii, ...pn, ...snr].filter((o) => o.name).length;
console.log(`HII regions: ${hii.length} (${hii.filter((o) => o.d).length} with distances); planetary nebulae: ${pn.length} (${pn.filter((o) => o.src === 'gaia').length} Gaia, ${pn.filter((o) => o.src === 'stat').length} statistical distances); supernova remnants: ${snr.length}; ${named} with familiar names`);
