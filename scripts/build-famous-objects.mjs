#!/usr/bin/env node
/**
 * Build public/data/famous-objects.json: well-known objects that none of the big catalogues
 * bring in (or bring in without the name people know them by). Positions come from SIMBAD (CDS,
 * via the Harvard mirror), never typed in by hand, except for the few SIMBAD doesn't know, which
 * are taken from their discovery papers. Distances and redshifts come from the paper cited with
 * each object, or from SIMBAD's parallax (Gaia) where marked `plx`.
 *
 *   map      stars and other single objects on the Galaxy Map (distance in kpc)
 *   nebulae  nebulae added to the nebula layer (Galaxy Map and Sky tab; distance in kpc)
 *   cosmos   galaxies, galaxy clusters and a lensed quasar in the Universe tab (redshift, or
 *            distance in Mpc for the Milky Way's satellites)
 *
 *   node scripts/build-famous-objects.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { equatorialToGalactic, round, sexagesimal } from './lib/vizier.mjs';

const cache = new URL('../node_modules/.cache/famous/', import.meta.url).pathname;
mkdirSync(cache, { recursive: true });

// [SIMBAD identifier, or { ra, dec } from the paper, or { l, b } galactic], then the entry.
const MAP = [
  // `visit`: a star shown up close at its real size (mass in M☉ is illustrative where unmeasured).
  ['V* UY Sct', { name: 'UY Scuti', kind: 'Red supergiant', plx: true, visit: { radiusSun: 1140, temperature: 3365, mass: 10, ref: 'Radius 1,708 R☉ at 2.9 kpc (Arroyo-Torres et al. 2013), scaled to the Gaia distance; mass illustrative' }, note: 'One of the largest stars known: a red supergiant roughly 900 to 1,700 times the width of the Sun (its distance, and so its size, is uncertain). In the Sun’s place it would swallow the orbit of Mars.', ref: 'Arroyo-Torres et al. 2013, A&A 554, A76; distance from its Gaia DR3 parallax' }],
  [{ ra: '18 39 02.37', dec: '-06 05 10.5' }, { name: 'Stephenson 2-18', aliases: ['St2-18', 'Stephenson 2 DFK 1'], kind: 'Red supergiant', d: 5.8, visit: { radiusSun: 2150, temperature: 3200, mass: 15, ref: 'Radius from its luminosity (4.4 × 10⁵ L☉) and temperature (3,200 K), Davies et al. 2007; mass illustrative' }, note: 'A red supergiant in the young cluster Stephenson 2, perhaps around 2,000 times the width of the Sun: a candidate for the largest star known.', ref: 'Davies et al. 2007, ApJ 671, 781 (position and the cluster’s distance)' }],
  ['KIC 8462852', { name: 'Tabby’s Star', aliases: ['Boyajian’s Star', 'KIC 8462852'], kind: 'F-type star with strange dimming', plx: true, note: 'It dims by up to 22% at irregular times, far more than any planet could cause. The likeliest explanation is uneven clumps of fine dust.', ref: 'Boyajian et al. 2016, MNRAS 457, 3988; distance from its Gaia DR3 parallax' }],
  ['HD 101065', { name: 'Przybylski’s Star', aliases: ['HD 101065'], kind: 'Chemically peculiar star', plx: true, note: 'One of the strangest spectra of any star: rich in rare-earth elements such as holmium, with reported traces of short-lived heavy elements, and very little iron.', ref: 'Przybylski 1961, Nature 189, 739; Cowley et al. 2000, MNRAS 317, 299; distance from its Gaia DR3 parallax' }],
  ['* eps Aur', { name: 'Epsilon Aurigae', aliases: ['ε Aurigae', 'Almaaz'], kind: 'Eclipsing binary', plx: true, note: 'Every 27 years its light dips for nearly two years, as a companion wrapped in a huge, dark disc of dust passes in front of it.', ref: 'Kloppenborg et al. 2010, Nature 464, 870; distance from its Gaia DR3 parallax' }],
  ['WISEA J085510.74-071442.5', { name: 'WISE 0855−0714', aliases: ['WISE 0855'], kind: 'Brown dwarf', plx: true, note: 'The coldest brown dwarf known, at about −25 °C, and the fourth-nearest system to the Sun. It may have clouds of water ice.', ref: 'Luhman 2014, ApJL 786, L18; distance from its parallax (SIMBAD)' }],
  ['NAME Scholz\'s star', { name: 'Scholz’s Star', aliases: ['WISE 0720−0846'], kind: 'Red dwarf and brown dwarf', plx: true, note: 'About 70,000 years ago this pair passed roughly 52,000 AU from the Sun, through the outer Oort cloud: the closest known flyby of another star.', ref: 'Mamajek et al. 2015, ApJL 800, L17; distance from its parallax (SIMBAD)' }],
  ['SGR 1806-20', { name: 'SGR 1806−20', aliases: ['SGR 1806-20'], kind: 'Magnetar', d: 8.7, note: 'A magnetar: a neutron star with a magnetic field about a thousand trillion times Earth’s. Its giant flare of 27 December 2004 was the brightest burst from beyond the Solar System ever recorded, and it disturbed Earth’s upper atmosphere.', ref: 'Hurley et al. 2005, Nature 434, 1098; distance: Bibby et al. 2008, MNRAS 386, L23' }],
  ['M 24', { name: 'Sagittarius Star Cloud (M24)', aliases: ['M24', 'Messier 24'], kind: 'Star cloud', d: 3.0, approx: true, note: 'Messier 24: a gap in the dust that opens onto a dense field of stars in the Sagittarius Arm, about 10,000 light-years away.', ref: 'Messier 1764; distance of the Sagittarius Arm in this direction (Reid et al. 2019, ApJ 885, 131)' }],
  ['M 40', { name: 'Winnecke 4 (M40)', aliases: ['M40', 'Messier 40'], kind: 'Double star', d: 0.16, approx: true, note: 'Messier 40: two stars that only look close together. Messier listed it while hunting for a nebula reported in the area.', ref: 'Messier 1764; Gaia DR2 parallaxes (Gaia Collaboration 2018)' }],
  ['NGC 6994', { name: 'M73', aliases: ['NGC 6994', 'Messier 73'], kind: 'Asterism', d: 0.6, approx: true, note: 'Messier 73: four stars in a little Y that lie at different distances. A chance alignment, not a cluster.', ref: 'Odenkirchen & Soubiran 2002, A&A 383, 163' }],
  [{ l: 38.67, b: -13.41 }, { name: 'Smith Cloud', kind: 'High-velocity gas cloud', d: 12.4, note: 'A comet-shaped cloud of hydrogen with at least a million suns’ worth of gas, falling into the Milky Way’s disc. It should strike in about 30 million years.', ref: 'Lockman et al. 2008, ApJL 679, L21' }],
];

const NEBULAE = [
  ['NAME Barnard\'s Loop', { name: 'Barnard’s Loop', id: 'Sh2-276', kind: 'hii', radiusDeg: 7, d: 0.44, ref: 'Orion’s distance, Zucker et al. 2019, ApJ 879, 125' }],
  ['NAME GUM Nebula', { name: 'Gum Nebula', id: 'Gum 12', kind: 'hii', radiusDeg: 18, d: 0.45, ref: 'Purcell et al. 2015, ApJ 804, 22' }],
  ['Sh 2-264', { name: 'Lambda Orionis Ring', id: 'Sh2-264', kind: 'hii', radiusDeg: 4, d: 0.40, ref: 'Dolan & Mathieu 2002, AJ 123, 387' }],
  ['SNR G180.0-01.7', { name: 'Spaghetti Nebula (Simeis 147)', id: 'G180.0-01.7', kind: 'snr', radiusDeg: 1.5, d: 1.47, ref: 'VLBI parallax of its pulsar PSR J0538+2817, Chatterjee et al. 2009, ApJ 698, 250' }],
  ['NGC 6888', { name: 'Crescent Nebula', id: 'NGC 6888', kind: 'hii', radiusDeg: 0.15, plx: true, ref: 'Gaia DR3 parallax of its star, WR 136' }],
  ['IC 2118', { name: 'Witch Head Nebula', id: 'IC 2118', kind: 'refl', radiusDeg: 1, d: 0.26, ref: 'Lit by Rigel: Hipparcos parallax, van Leeuwen 2007' }],
  ['M 43', { name: 'De Mairan’s Nebula (M43)', id: 'NGC 1982', kind: 'hii', radiusDeg: 0.15, d: 0.414, ref: 'Orion Nebula Cluster, Menten et al. 2007, A&A 474, 515' }],
];

/** The Virgo Cluster's distance (Mpc), from its galaxies' surface-brightness fluctuations. */
const VIRGO = 16.5;
const VIRGO_REF = 'Virgo Cluster’s distance: Mei et al. 2007, ApJ 655, 144';

const COSMOS = [
  // Messier galaxies of the Virgo Cluster that the redshift survey places too near (they move
  // slowly, or towards us, as they fall through the cluster) and the Local Volume catalogue
  // leaves out: here at the cluster's distance.
  ['M 59', { name: 'M59', aliases: ['NGC 4621', 'Messier 59'], kind: 'galaxy', label: 'Elliptical galaxy', t: -5, d: VIRGO, note: 'Messier 59: one of the giant elliptical galaxies of the Virgo Cluster.', ref: VIRGO_REF }],
  ['M 85', { name: 'M85', aliases: ['NGC 4382', 'Messier 85'], kind: 'galaxy', label: 'Lenticular galaxy', t: -1, d: VIRGO, note: 'Messier 85: the northernmost big galaxy of the Virgo Cluster, with young stars at its centre left by a merger a few billion years ago.', ref: VIRGO_REF }],
  ['M 86', { name: 'M86', aliases: ['NGC 4406', 'Messier 86'], kind: 'galaxy', label: 'Elliptical galaxy', t: -5, d: VIRGO, note: 'A giant elliptical galaxy falling through the Virgo Cluster so fast that it is coming towards us, at about 240 km/s: one of the few galaxies with a blueshift.', ref: VIRGO_REF }],
  ['M 89', { name: 'M89', aliases: ['NGC 4552', 'Messier 89'], kind: 'galaxy', label: 'Elliptical galaxy', t: -5, d: VIRGO, note: 'An almost perfectly round elliptical galaxy in the Virgo Cluster, wrapped in faint shells and plumes of stars left by past mergers.', ref: VIRGO_REF }],
  ['M 90', { name: 'M90', aliases: ['NGC 4569', 'Messier 90'], kind: 'galaxy', label: 'Spiral galaxy', t: 2, d: VIRGO, note: 'A spiral galaxy of the Virgo Cluster coming towards us. The cluster’s hot gas is stripping away the gas it needs to make new stars.', ref: VIRGO_REF }],
  ['M 91', { name: 'M91', aliases: ['NGC 4548', 'Messier 91'], kind: 'galaxy', label: 'Barred spiral galaxy', t: 3, d: VIRGO, note: 'A barred spiral in the Virgo Cluster. For two centuries it was Messier’s “missing” object, because he wrote down its position wrongly.', ref: VIRGO_REF }],
  ['M 98', { name: 'M98', aliases: ['NGC 4192', 'Messier 98'], kind: 'galaxy', label: 'Spiral galaxy', t: 2, d: VIRGO, note: 'A spiral galaxy seen nearly edge-on in the Virgo Cluster, coming towards us at about 140 km/s.', ref: VIRGO_REF }],
  ['M 102', { name: 'Spindle Galaxy (M102)', aliases: ['NGC 5866', 'M102', 'Messier 102'], kind: 'galaxy', label: 'Lenticular galaxy, edge-on', t: -1, d: 15.3, note: 'Usually taken to be Messier 102 (his own record is ambiguous): a lenticular galaxy seen edge-on, cut by a sharp, thin lane of dust.', ref: 'Distance: Tonry et al. 2001, ApJ 546, 681' }],
  ['PGC 54559', { name: 'Hoag’s Object', aliases: ['PGC 54559'], kind: 'galaxy', label: 'Ring galaxy', t: -3, z: 0.04242, size: 40, note: 'A nearly perfect ring of young blue stars around an old yellow core, with a dark gap between them. How it formed is still debated.', ref: 'Hoag 1950, AJ 55, 170; Schweizer et al. 1987, ApJ 320, 454' }],
  ['Malin 1', { name: 'Malin 1', kind: 'galaxy', label: 'Giant low-surface-brightness spiral', t: 3, z: 0.0827, size: 250, note: 'One of the largest disc galaxies known: its faint spiral disc spans several hundred thousand light-years, several times the Milky Way.', ref: 'Bothun et al. 1987, AJ 94, 23; Galaz et al. 2015, ApJL 815, L29' }],
  ['IC 1101', { name: 'IC 1101', kind: 'galaxy', label: 'Supergiant elliptical galaxy', t: -5, z: 0.0778, size: 300, note: 'The central galaxy of the cluster Abell 2029, one of the largest galaxies known, with the largest core of stars ever measured, scoured out by its giant black hole.', ref: 'Dullo et al. 2017, ApJ 840, 69' }],
  [{ ra: '13 00 58.0', dec: '+26 58 35' }, { name: 'Dragonfly 44', kind: 'galaxy', label: 'Ultra-diffuse galaxy', t: -3, z: 0.0231, size: 30, note: 'An ultra-diffuse galaxy in the Coma Cluster, nearly as wide as the Milky Way but with about 1% of its stars: almost all of its mass is dark matter.', ref: 'van Dokkum et al. 2016, ApJL 828, L6 (position and redshift)' }],
  ['ESO 350-40', { name: 'Cartwheel Galaxy', aliases: ['ESO 350-40'], kind: 'galaxy', label: 'Ring galaxy', t: 5, z: 0.0298, size: 45, note: 'A smaller galaxy plunged through its disc a few hundred million years ago, sending a ring of new stars rippling outward like a stone dropped in a pond.', ref: 'Higdon 1995, ApJ 455, 524' }],
  ['HCG 92', { name: 'Stephan’s Quintet', aliases: ['HCG 92', 'Hickson Compact Group 92'], kind: 'galaxy', label: 'Compact group of galaxies', t: 4, z: 0.0215, size: 100, note: 'Four galaxies locked in a slow collision about 290 million light-years away. The fifth, NGC 7320, only lines up with them: it is several times closer.', ref: 'Stephan 1877; Hickson 1982, ApJ 255, 382' }],
  ['NAME Crater II Dwarf Galaxy', { name: 'Crater II', aliases: ['Crater 2'], kind: 'galaxy', label: 'Dwarf galaxy (satellite of the Milky Way)', t: -3, m: 'Sph', d: 0.117, size: 2.2, note: 'One of the Milky Way’s largest satellite galaxies, yet so faint and spread out that it was only found in 2016: one of the most diffuse galaxies known.', ref: 'Torrealba et al. 2016, MNRAS 459, 2370' }],
  ['NAME Antlia II Dwarf Galaxy', { name: 'Antlia II', aliases: ['Antlia 2'], kind: 'galaxy', label: 'Dwarf galaxy (satellite of the Milky Way)', t: -3, m: 'Sph', d: 0.132, size: 5.8, note: 'A ghostly dwarf galaxy hidden behind the Milky Way’s disc, found with Gaia in 2018: about as large as the Large Magellanic Cloud, yet thousands of times fainter.', ref: 'Torrealba et al. 2019, MNRAS 488, 2743' }],
  ['ACT-CL J0102-4915', { name: 'El Gordo', aliases: ['ACT-CL J0102−4915'], kind: 'cluster', label: 'Colliding galaxy clusters', z: 0.870, note: '“The Fat One”: two galaxy clusters in collision, the most massive cluster known from when the universe was half its present age.', ref: 'Menanteau et al. 2012, ApJ 748, 7' }],
  ['SPT-CL J2344-4243', { name: 'Phoenix Cluster', aliases: ['SPT-CL J2344−4243'], kind: 'cluster', label: 'Galaxy cluster', z: 0.596, note: 'Its central galaxy forms several hundred new suns a year, hundreds of times the Milky Way’s rate, fed by gas cooling out of the cluster.', ref: 'McDonald et al. 2012, Nature 488, 349' }],
  ['QSO J2240+0321', { name: 'Einstein Cross', aliases: ['Q2237+030', 'QSO 2237+0305'], kind: 'quasar', label: 'Gravitationally lensed quasar', z: 1.695, note: 'A quasar seen as four images around the core of a much nearer galaxy (redshift 0.04), whose gravity bends its light: a gravitational lens, as Einstein predicted.', ref: 'Huchra et al. 1985, AJ 90, 691' }],
  [{ ra: '01 37 23.232', dec: '-08 27 52.20' }, { name: 'Earendel', aliases: ['WHL0137-LS', 'Sunrise Arc'], kind: 'galaxy', label: 'Single star, seen through a gravitational lens', t: 9, z: 6.2, size: 1, note: 'The most distant single star ever seen. Its light, from about 900 million years after the Big Bang, is magnified thousands of times by a galaxy cluster in front.', ref: 'Welch et al. 2022, Nature 603, 815 (position and redshift)' }],
];

/** SIMBAD, one identifier at a time: { ra, dec, plx } (degrees, mas). Cached. */
async function simbad(id) {
  const file = join(cache, `${id.replace(/[^A-Za-z0-9]+/g, '_')}.txt`);
  let line = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  if (!line) {
    const script = ['output console=off script=off', 'format object "%IDLIST(1)|%COO(d;A D)|%PLX(V)"', id].join('\n');
    for (let attempt = 0; !line; attempt++) {
      try {
        const res = await fetch(`https://simbad.cfa.harvard.edu/simbad/sim-script?script=${encodeURIComponent(script)}`, { signal: AbortSignal.timeout(60000) });
        const text = res.ok ? await res.text() : '';
        if (text.includes('::error')) throw new Error(`SIMBAD doesn't know ${id}`);
        line = text.split('\n').find((l) => l.includes('|'));
      } catch (err) {
        if (String(err.message).startsWith('SIMBAD')) throw err;
      }
      if (!line) {
        if (attempt >= 5) throw new Error(`SIMBAD: no answer for ${id}`);
        await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
      }
    }
    writeFileSync(file, line);
  }
  const [, coo, plx] = line.split('|');
  const [ra, dec] = coo.trim().split(/\s+/).map(Number);
  return { ra, dec, plx: Number(plx) || undefined };
}

/** Galactic position (and parallax) of a source: a SIMBAD id, a paper's RA/Dec, or galactic l/b. */
async function locate(src) {
  if (typeof src === 'string') {
    const s = await simbad(src);
    const [l, b] = equatorialToGalactic(s.ra, s.dec);
    return { l, b, plx: s.plx };
  }
  if ('l' in src) return { l: src.l, b: src.b };
  const [l, b] = equatorialToGalactic(...sexagesimal(src.ra, src.dec));
  return { l, b };
}

async function build(list, fn) {
  const out = [];
  for (const [src, e] of list) {
    const at = await locate(src);
    const { plx, ...rest } = e;
    let d = e.d;
    if (plx) {
      if (!at.plx) throw new Error(`${e.name}: no parallax in SIMBAD`);
      d = 1 / at.plx; // kpc
    }
    out.push(fn({ ...rest, l: round(at.l, 3), b: round(at.b, 3), ...(d !== undefined ? { d: round(d, 4) } : {}) }));
  }
  return out;
}

const map = await build(MAP, (e) => e);
const nebulae = await build(NEBULAE, (e) => e);
const cosmos = await build(COSMOS, (e) => e);

writeFileSync(
  new URL('../public/data/famous-objects.json', import.meta.url),
  JSON.stringify({
    source: 'Positions from SIMBAD (Wenger et al. 2000, A&AS 143, 9) except where the cited paper gives them; distances, redshifts and sizes from the papers cited with each object, or from the Gaia DR3 parallax where stated.',
    fields: { map: 'd in kpc', nebulae: 'd in kpc; radiusDeg on the sky', cosmos: 'z (redshift), or d in Mpc; size in kpc' },
    map,
    nebulae,
    cosmos,
  }, null, 1) + '\n',
);
console.log(`famous objects: ${map.length} on the Galaxy Map, ${nebulae.length} nebulae, ${cosmos.length} in the Universe tab`);
