/**
 * VizieR (CDS) through the Harvard mirror, as tab-separated text, cached under
 * node_modules/.cache/<cacheName>/. The CDS main site is blocked from some networks, and the
 * mirror sometimes drops big responses, answers with an Error line, or answers 200 with an
 * empty, nameless RESOURCE: all of those are retried.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const VIZIER = 'https://vizier.cfa.harvard.edu/viz-bin/asu-tsv';

export function vizierClient(cacheName) {
  const cache = new URL(`../../node_modules/.cache/${cacheName}/`, import.meta.url).pathname;
  mkdirSync(cache, { recursive: true });
  return async function vizier(name, params) {
    const file = join(cache, `${name}.tsv`);
    if (existsSync(file)) return readFileSync(file, 'utf8');
    const url = new URL(VIZIER);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      let problem;
      try {
        const res = await fetch(url);
        const text = res.ok ? await res.text() : '';
        if (res.ok && !text.includes('#INFO\tError=') && !/^#RESOURCE=\s*$/m.test(text)) {
          writeFileSync(file, text);
          return text;
        }
        problem = `HTTP ${res.status} ${text.match(/Error=.*/)?.[0] ?? ''}`;
      } catch (err) {
        problem = String(err?.cause?.code ?? err);
      }
      if (attempt >= 5) throw new Error(`VizieR ${name}: ${problem}`);
      console.warn(`VizieR ${name}: ${problem}, retrying…`);
      await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
    }
  };
}

/** Parse VizieR TSV: header line, units line, dashes line, then rows. An empty table gives []. */
export function parseTsv(text) {
  const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
  if (lines.length < 4) return [];
  const header = lines[0].split('\t').map((h) => h.trim());
  return lines.slice(3).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

export const num = (s) => (s === '' || s === undefined ? undefined : Number(s));
export const round = (v, d) => (v === undefined || !Number.isFinite(v) ? undefined : Number(v.toFixed(d)));

/** Equatorial J2000 (degrees) → galactic (l, b) degrees. */
export function equatorialToGalactic(raDeg, decDeg) {
  const D = Math.PI / 180;
  const aG = 192.85948 * D, dG = 27.12825 * D, lNCP = 122.93192 * D;
  const a = raDeg * D, d = decDeg * D;
  const sinB = Math.sin(d) * Math.sin(dG) + Math.cos(d) * Math.cos(dG) * Math.cos(a - aG);
  const b = Math.asin(Math.max(-1, Math.min(1, sinB)));
  const y = Math.cos(d) * Math.sin(a - aG);
  const x = Math.sin(d) * Math.cos(dG) - Math.cos(d) * Math.sin(dG) * Math.cos(a - aG);
  let l = lNCP - Math.atan2(y, x);
  l = ((l % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return [l / D, b / D];
}

/** "hh mm ss.s" / "±dd mm ss" → degrees. */
export function sexagesimal(ra, dec) {
  const [h, m, s] = ra.trim().split(/\s+/).map(Number);
  const dm = dec.trim().split(/\s+/);
  const sign = dm[0].startsWith('-') ? -1 : 1;
  const [dd, mm, ss] = dm.map((v) => Math.abs(Number(v)));
  return [(h + (m ?? 0) / 60 + (s ?? 0) / 3600) * 15, sign * (dd + (mm ?? 0) / 60 + (ss ?? 0) / 3600)];
}
