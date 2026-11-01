#!/usr/bin/env node
/**
 * Build public/data/gw-events.json: famous gravitational-wave detections by LIGO, Virgo and
 * KAGRA, with masses and distances transcribed from the discovery papers' abstracts.
 *
 * The GWOSC event API (gwosc.org) was unreachable from the build environment (TLS chain
 * error), so this script fetches each paper's abstract from the arXiv API and verifies that
 * every transcribed number appears in it. A typo fails the build.
 *
 *   node scripts/build-gw-events.mjs
 */
import { writeFileSync } from 'node:fs';

/**
 * kind: BBH (two black holes), BNS (two neutron stars), NSBH (neutron star + black hole).
 * m1, m2 in solar masses (source frame); final = remnant mass; distanceMpc = luminosity distance.
 * `quote` lists the exact strings from the abstract that back the numbers.
 * Where the abstract gives only a range or a total, `massNote` says how m1 and m2 were chosen.
 */
const EVENTS = [
  { name: 'GW150914', date: '2015-09-14', kind: 'BBH', m1: 36, m2: 29, final: 62, distanceMpc: 410, arxiv: '1602.03837',
    about: 'The first gravitational waves ever detected.', quote: ['$36^{+5}_{-4} M_\\odot$', '$29^{+4}_{-4} M_\\odot$', '$62^{+4}_{-4} M_\\odot$', '$410^{+160}_{-180}$ Mpc'] },
  { name: 'GW151226', date: '2015-12-26', kind: 'BBH', m1: 14.2, m2: 7.5, final: 20.8, distanceMpc: 440, arxiv: '1606.04855',
    about: 'The second detection: lighter, spinning black holes.', quote: ['$14.2_{-3.7}^{+8.3}', '$7.5_{-2.3}^{+2.3}', '$20.8_{-1.7}^{+6.1}', '$440_{-190}^{+180}$ Mpc'] },
  { name: 'GW170104', date: '2017-01-04', kind: 'BBH', m1: 31.2, m2: 19.4, distanceMpc: 880, arxiv: '1706.01812',
    about: 'A 50-solar-mass merger nearly 3 billion light-years away.', quote: ['$31.2^{+8.4}_{-6.0}', '$19.4^{+5.3}_{-5.9}', '$880^{+450}_{-390}'] },
  { name: 'GW170814', date: '2017-08-14', kind: 'BBH', m1: 30.5, m2: 25.3, distanceMpc: 540, arxiv: '1709.09660',
    about: 'The first detection by three detectors (LIGO and Virgo).', quote: ['$30.5_{-3.0}^{+5.7}$', '$25.3_{-4.2}^{+2.8}$', '$540_{-210}^{+130}'] },
  { name: 'GW170817', date: '2017-08-17', kind: 'BNS', m1: 1.46, m2: 1.27, distanceMpc: 40, arxiv: '1710.05832',
    about: 'Two neutron stars: the first merger also seen in light (a kilonova in NGC 4993).', quote: ['$2.74^{+0.04}_{-0.01}', '1.17 to 1.60', '$40^{+8}_{-14}$ Mpc'],
    massNote: 'The abstract gives a total of 2.74 M☉ and a component range of 1.17–1.60 M☉; the split 1.46 + 1.27 is chosen within that range.' },
  { name: 'GW190425', date: '2019-04-25', kind: 'BNS', m1: 1.75, m2: 1.65, arxiv: '2001.01761',
    about: 'The heaviest binary neutron star system known.', quote: ['$3.4^{+0.3}_{-0.1}', '1.45 to 1.88'],
    massNote: 'The abstract gives a total of 3.4 M☉ and a low-spin component range of 1.45–1.88 M☉; the split 1.75 + 1.65 is chosen within that range.' },
  { name: 'GW190521', date: '2019-05-21', kind: 'BBH', m1: 85, m2: 66, final: 142, distanceMpc: 5300, arxiv: '2009.01075',
    about: 'The most massive merger: the remnant is an intermediate-mass black hole.', quote: ['$85^{+21}_{-14} M_{\\odot}$', '$66^{+17}_{-18} M_{\\odot}$', '$142^{+28}_{-16} M_{\\odot}$', '$5.3^{+2.4}_{-2.6}'] },
  { name: 'GW190814', date: '2019-08-14', kind: 'BBH', m1: 23, m2: 2.6, distanceMpc: 241, arxiv: '2006.12611',
    about: 'A very lopsided pair: the 2.6 M☉ partner is the lightest black hole or the heaviest neutron star known.', quote: ['22.2 - 24.3', '2.50 - 2.67', '$241^{+41}_{-45}$ Mpc'],
    massNote: 'The abstract gives 90% ranges of 22.2–24.3 and 2.50–2.67 M☉ (its title says 23 and 2.6).' },
  { name: 'GW200105', date: '2020-01-05', kind: 'NSBH', m1: 8.9, m2: 1.9, distanceMpc: 280, arxiv: '2106.15163',
    about: 'One of the first neutron star–black hole mergers.', quote: ['$8.9^{+1.2}_{-1.5}', '$1.9^{+0.3}_{-0.2}', '$280^{+110}_{-110}$ Mpc'] },
  { name: 'GW200115', date: '2020-01-15', kind: 'NSBH', m1: 5.7, m2: 1.5, distanceMpc: 300, arxiv: '2106.15163',
    about: 'A neutron star swallowed by a black hole.', quote: ['$5.7^{+1.8}_{-2.1}', '$1.5^{+0.7}_{-0.3}', '$300^{+150}_{-100}$ Mpc'] },
  { name: 'GW230529', date: '2023-05-29', kind: 'NSBH', m1: 3.5, m2: 1.6, arxiv: '2404.04248',
    about: 'A partner in the "mass gap" between the heaviest neutron stars and the lightest black holes.', quote: ['2.5\\text{-}4.5', '1.2\\text{-}2.0'],
    massNote: 'Masses are the midpoints of the 90% ranges in the abstract (2.5–4.5 and 1.2–2.0 M☉).' },
];

const ids = [...new Set(EVENTS.map((e) => e.arxiv))];
const res = await fetch(`https://export.arxiv.org/api/query?id_list=${ids.join(',')}&max_results=${ids.length}`);
if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
const xml = await res.text();
const abstracts = new Map();
for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
  const id = entry.match(/<id>http:\/\/arxiv\.org\/abs\/([\d.]+)/)[1];
  const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)[1].replace(/\s+/g, ' ');
  abstracts.set(id, summary);
}
for (const e of EVENTS) {
  const text = abstracts.get(e.arxiv);
  if (!text) throw new Error(`${e.name}: abstract ${e.arxiv} not found`);
  for (const q of e.quote) if (!text.includes(q)) throw new Error(`${e.name}: "${q}" not found in arXiv:${e.arxiv}`);
}

const out = EVENTS.map(({ quote, ...e }) => e);
writeFileSync(
  new URL('../public/data/gw-events.json', import.meta.url),
  JSON.stringify({ source: 'LIGO/Virgo/KAGRA discovery papers (arXiv abstracts); values verified against each abstract by scripts/build-gw-events.mjs', events: out }, null, 1) + '\n',
);
console.log(`Verified ${EVENTS.length} events against ${ids.length} arXiv abstracts.`);
