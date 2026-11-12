#!/usr/bin/env node
/**
 * Build public/data/compact-objects.json: famous black holes and pulsars in the Milky Way.
 * Positions come from SIMBAD (Harvard mirror); masses and distances are transcribed from the
 * discovery papers and verified against their arXiv abstracts (a typo fails the build).
 *
 * Black holes also carry their companion star's orbit (`companion`: mass M☉, period days,
 * eccentricity, kind), so the Galaxy Map can open them in the Sandbox. Gaia BH1 and BH2 are
 * verified against their abstracts; the others come from the papers named in `companion.note`
 * (their abstracts don't give them).
 *
 *   node scripts/build-compact-objects.mjs
 */
import { writeFileSync } from 'node:fs';

/** `simbad`: SIMBAD identifier; `quote`: strings that must appear in the arXiv abstract. */
const OBJECTS = [
  { name: 'Gaia BH1', kind: 'blackhole', simbad: 'Gaia DR3 4373465352415301632', distanceKpc: 0.48, mass: 9.62, arxiv: '2209.06833',
    about: 'The nearest known black hole: a dormant 9.6 M☉ black hole orbited by a Sun-like star.', quote: ['d = 480\\,\\rm pc', '9.62\\pm 0.18', '$P_{\\rm orb}=185.6$ days', '($e=0.45$)', '$M=0.93\\,M_{\\odot}$'],
    companion: { mass: 0.93, periodDays: 185.6, ecc: 0.45, kind: 'star', dormant: true } },
  { name: 'Gaia BH2', kind: 'blackhole', simbad: 'Gaia DR3 5870569352746779008', distanceKpc: 1.16, mass: 8.9, arxiv: '2302.07880',
    about: 'A dormant black hole orbited by a red giant.', quote: ['1.16 kpc', '8.9\\pm 0.3', '$P_{\\rm orb} = 1277$ days', '($e=0.52$)', '$\\sim 1M_{\\odot}$ red giant'],
    companion: { mass: 1.0, periodDays: 1277, ecc: 0.52, kind: 'giant', dormant: true } },
  { name: 'Gaia BH3', kind: 'blackhole', simbad: 'Gaia DR3 4318465066420528000', distanceKpc: 0.59, mass: 33, arxiv: '2404.10486',
    about: 'The most massive stellar black hole known in the Milky Way.', quote: ['590 pc', 'period of 11.6 yr'],
    companion: { mass: 0.76, periodDays: 4253, ecc: 0.7291, kind: 'giant', dormant: true, note: 'Eccentricity 0.7291 and companion mass 0.76 M☉ from Gaia Collaboration, Panuzzo et al. 2024 (A&A 686, L2), not the abstract.' } },
  { name: 'Cygnus X-1', kind: 'blackhole', simbad: 'Cyg X-1', mass: 21.2, arxiv: '2102.09091', distanceKpc: 2.22,
    about: 'The first black hole ever identified (1971), feeding on a blue supergiant companion.', quote: ['21.2\\pm2.2'],
    companion: { mass: 40.6, periodDays: 5.599829, ecc: 0.0189, kind: 'star', note: 'Supergiant mass 40.6 M☉ from Miller-Jones et al. 2021 (Science 371, 1046); period and eccentricity from Orosz et al. 2011 (ApJ 742, 84).' } },
  { name: 'V404 Cygni', kind: 'blackhole', simbad: 'V404 Cyg', distanceKpc: 2.39, arxiv: '0910.5253',
    about: 'An X-ray binary whose distance was the first measured to a black hole by parallax.', quote: ['2.39 +/- 0.14 kpc'], mass: 9,
    companion: { mass: 0.7, periodDays: 6.4714, ecc: 0, kind: 'star', note: 'Black hole 9.0 M☉ and donor 0.7 M☉ from Khargharia et al. 2010 (ApJ 716, 1105); period from Casares et al. 1992.' } },
  { name: 'A0620-00', kind: 'blackhole', simbad: 'V* V616 Mon', distanceKpc: 1.06, mass: 6.6, arxiv: '1001.0261',
    about: 'One of the nearest black holes, in an X-ray binary in Monoceros.', quote: ['6.6 plus or minus 0.25', 'd=1.06 plus or minus 0.12 kpc'],
    companion: { mass: 0.4, periodDays: 0.32301, ecc: 0, kind: 'star', note: 'Donor 0.4 M☉ (K5 V) from Cantrell et al. 2010 (ApJ 710, 1127, the body of this paper); period 7.75 h from McClintock & Remillard 1986.' } },
  { name: 'Vela Pulsar', kind: 'pulsar', simbad: 'PSR B0833-45', distanceKpc: 0.293, arxiv: 'astro-ph/0302374',
    about: 'A young pulsar spinning 11 times a second, left by a supernova about 11,000 years ago.', quote: ['$293_{-17}^{+19}$ pc'] },
  { name: 'PSR J0437-4715', kind: 'pulsar', simbad: 'PSR J0437-4715', distanceKpc: 0.15679, mass: 1.44, arxiv: '1510.04434',
    about: 'The nearest millisecond pulsar, spinning 174 times a second.', quote: ['$D=156.79\\pm0.25$ pc', '$M_p=1.44\\pm0.07$'] },
];

// Cygnus X-1's distance (2.22 kpc, Miller-Jones et al. 2021) is in a companion paper, not this abstract.
const UNVERIFIED_DISTANCE = new Set(['Cygnus X-1']);

async function text(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      if (attempt >= 4) throw new Error(`HTTP ${res.status} ${url}`);
    } catch (err) {
      if (attempt >= 4) throw err;
    }
    await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
  }
}

// Positions from SIMBAD.
const script = ['output console=off script=off', 'format object "%IDLIST(1)|%COO(d;A D)"', ...OBJECTS.map((o) => o.simbad)].join('\n');
const simbad = await text(`https://simbad.cfa.harvard.edu/simbad/sim-script?script=${encodeURIComponent(script)}`);
if (simbad.includes('::error')) throw new Error(`SIMBAD: ${simbad}`);
const coords = simbad
  .split('\n')
  .filter((l) => l.includes('|'))
  .map((l) => l.split('|')[1].trim().split(/\s+/).map(Number));
if (coords.length !== OBJECTS.length) throw new Error(`SIMBAD returned ${coords.length} positions for ${OBJECTS.length} objects:\n${simbad}`);

// Verify the transcribed numbers against the arXiv abstracts.
const ids = [...new Set(OBJECTS.map((o) => o.arxiv))];
const xml = await text(`https://export.arxiv.org/api/query?id_list=${ids.join(',')}&max_results=${ids.length}`);
const abstracts = new Map();
for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
  const id = entry.match(/<id>http:\/\/arxiv\.org\/abs\/(.+?)(v\d+)?<\/id>/)[1];
  const body = (entry.match(/<title>([\s\S]*?)<\/title>/)[1] + ' ' + entry.match(/<summary>([\s\S]*?)<\/summary>/)[1]).replace(/\s+/g, ' ');
  abstracts.set(id, body);
}
for (const o of OBJECTS) {
  const body = abstracts.get(o.arxiv);
  if (!body) throw new Error(`${o.name}: arXiv:${o.arxiv} not found`);
  for (const q of o.quote) if (!body.includes(q)) throw new Error(`${o.name}: "${q}" not in arXiv:${o.arxiv}`);
}

const out = OBJECTS.map(({ quote, simbad: id, ...o }, i) => ({
  ...o,
  simbad: id,
  raDeg: coords[i][0],
  decDeg: coords[i][1],
  ...(UNVERIFIED_DISTANCE.has(o.name) ? { distanceNote: 'Distance from Miller-Jones et al. 2021 (Science 371, 1046), not this abstract.' } : {}),
}));
writeFileSync(
  new URL('../public/data/compact-objects.json', import.meta.url),
  JSON.stringify({ source: 'Positions: SIMBAD. Masses and distances: discovery papers (verified against arXiv abstracts).', objects: out }, null, 1) + '\n',
);
console.log(out.map((o) => `${o.name}: RA ${o.raDeg.toFixed(3)} Dec ${o.decDeg.toFixed(3)} d=${o.distanceKpc} kpc`).join('\n'));
