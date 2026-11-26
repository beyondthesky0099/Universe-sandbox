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

// Added in the second "what did we miss" pass.
MAP.push(
  ['* eta Car', { name: 'Eta Carinae', aliases: ['η Carinae', 'Eta Car'], kind: 'Luminous blue variable (binary)', d: 2.35, note: 'One of the most massive and luminous stars known: a binary whose main star holds around 100 times the Sun’s mass. In its “Great Eruption” of the 1840s it became the second-brightest star in the sky and threw off the Homunculus Nebula.', ref: 'Smith 2006, ApJ 644, 1151 (distance)' }],
  ['* rho Cas', { name: 'Rho Cassiopeiae', aliases: ['ρ Cassiopeiae'], kind: 'Yellow hypergiant', plx: true, approx: true, note: 'One of the rare yellow hypergiants, hundreds of thousands of times as luminous as the Sun. Every few decades it throws off a shell of gas and briefly fades.', ref: 'Lobel et al. 2003, ApJ 583, 923; distance from its Gaia DR3 parallax (uncertain)' }],
  ['NAME Pistol Star', { name: 'Pistol Star', aliases: ['V4647 Sgr'], kind: 'Luminous blue variable', d: 8.0, approx: true, note: 'One of the most luminous stars in the Milky Way, near the Galactic Centre and hidden from the eye by dust. It has blown off the Pistol Nebula around itself.', ref: 'Figer et al. 1998, ApJ 506, 384' }],
  ['WR 104', { name: 'WR 104', aliases: ['Pinwheel star'], kind: 'Wolf–Rayet binary', d: 2.58, note: 'A “pinwheel”: dust made where the winds of two massive stars collide is spun into a spiral by their eight-month orbit.', ref: 'Tuthill et al. 2008, ApJ 675, 698' }],
  ['* zet Oph', { name: 'Zeta Ophiuchi', aliases: ['ζ Ophiuchi'], kind: 'Runaway O-type star', plx: true, note: 'A hot, fast-spinning star racing through space, probably flung free when its companion exploded; its wind ploughs a glowing bow shock ahead of it.', ref: 'Hoogerwerf et al. 2001, A&A 365, 49; distance from its parallax (SIMBAD)' }],
  ['V* RR Lyr', { name: 'RR Lyrae', aliases: ['RR Lyr'], kind: 'Pulsating variable star', plx: true, note: 'The prototype of the RR Lyrae stars: old stars that pulse about every half day with a known luminosity, used as standard candles for globular clusters and nearby galaxies.', ref: 'Distance from its Gaia DR3 parallax' }],
  ['* chi Cyg', { name: 'Chi Cygni', aliases: ['χ Cygni'], kind: 'Mira variable', plx: true, note: 'A Mira variable whose brightness swings by more than 10,000 times every 408 days, from easily seen to telescopic: the largest range of any star.', ref: 'Distance from its Gaia DR3 parallax' }],
  ['V* R Lep', { name: 'Hind’s Crimson Star', aliases: ['R Leporis', 'R Lep'], kind: 'Carbon star (Mira variable)', plx: true, approx: true, note: 'A carbon star so sooty that it glows a deep blood red, brightening and fading every 430 days or so.', ref: 'Hind 1845; distance from its Gaia DR3 parallax' }],
  ['* mu. Cep', { name: 'Garnet Star', aliases: ['Mu Cephei', 'μ Cephei', 'Herschel’s Garnet Star'], kind: 'Red supergiant', d: 0.94, approx: true, note: 'One of the largest and reddest stars visible to the naked eye. William Herschel called it “a very fine deep garnet colour”.', ref: 'Herschel 1783; distance of its association, Cep OB2 (Gaia)' }],
  [{ ra: '18 44 20.3', dec: '+39 40 12' }, { name: 'Epsilon Lyrae', aliases: ['Double Double', 'ε Lyrae'], kind: 'Quadruple star', d: 0.049, note: 'The “Double Double”: binoculars split it into two stars, and a telescope splits each of those into two again. All four are bound together.', ref: 'Hipparcos parallax (van Leeuwen 2007)' }],
  ['NAME Arches Cluster', { name: 'Arches Cluster', kind: 'Young massive cluster', d: 8.2, approx: true, note: 'The densest young star cluster known in the Milky Way, about 100 light-years from the Galactic Centre and hidden behind dust. It holds dozens of the most massive stars known.', ref: 'Figer et al. 2002, ApJ 581, 258' }],
  ['NAME Quintuplet Cluster', { name: 'Quintuplet Cluster', kind: 'Young massive cluster', d: 8.2, approx: true, note: 'A massive young cluster near the Galactic Centre, named for five bright infrared sources. The Pistol Star is one of its members.', ref: 'Figer et al. 1999, ApJ 525, 750' }],
  ['Westerlund 1', { name: 'Westerlund 1', kind: 'Super star cluster', plx: true, approx: true, note: 'The most massive young star cluster known in the Milky Way, tens of thousands of suns’ worth of stars, among them red supergiants and yellow hypergiants. Dust hides it from the eye.', ref: 'Clark et al. 2005, A&A 434, 949; distance from Gaia parallaxes (SIMBAD)' }],
);

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

NEBULAE.push(
  ['NGC 2024', { name: 'Flame Nebula (NGC 2024)', id: 'NGC 2024', kind: 'hii', radiusDeg: 0.25, d: 0.414, ref: 'Orion’s distance, Menten et al. 2007' }],
  ['NGC 1977', { name: 'Running Man Nebula (NGC 1977)', id: 'NGC 1977', kind: 'refl', radiusDeg: 0.33, plx: true, ref: 'Gaia parallax (SIMBAD)' }],
  ['IC 5070', { name: 'Pelican Nebula (IC 5070)', id: 'IC 5070', kind: 'hii', radiusDeg: 0.5, d: 0.8, ref: 'North America–Pelican complex, Kuhn et al. 2020, ApJ 899, 128' }],
  ['NGC 1499', { name: 'California Nebula (NGC 1499)', id: 'NGC 1499', kind: 'hii', radiusDeg: 1.25, d: 0.38, ref: 'Lit by Xi Persei (Hipparcos parallax)' }],
  ['NGC 7380', { name: 'Wizard Nebula (NGC 7380)', id: 'NGC 7380', kind: 'hii', radiusDeg: 0.2, plx: true, ref: 'Gaia parallax of its cluster (SIMBAD)' }],
  ['NGC 2174', { name: 'Monkey Head Nebula (NGC 2174)', id: 'NGC 2174', kind: 'hii', radiusDeg: 0.33, d: 2.1, ref: 'Gem OB1 association, ≈2.1 kpc' }],
  ['IC 5146', { name: 'Cocoon Nebula (IC 5146)', id: 'IC 5146', kind: 'hii', radiusDeg: 0.1, plx: true, ref: 'Gaia parallax of its cluster (SIMBAD)' }],
  ['NAME Coalsack Nebula', { name: 'Coalsack', id: 'Coalsack', kind: 'dark', radiusDeg: 3.5, d: 0.18, ref: '≈180 pc, Seidensticker & Schmidt-Kaler 1989' }],
  ['NAME Boomerang Nebula', { name: 'Boomerang Nebula (the coldest known place, 1 K)', id: 'Boomerang Nebula', kind: 'pn', radiusDeg: 0.006, d: 1.5, ref: 'Sahai & Nyman 1997, ApJL 487, L155' }],
  ['NAME Red Rectangle', { name: 'Red Rectangle', id: 'HD 44179', kind: 'pn', radiusDeg: 0.005, d: 0.71, ref: 'Men’shchikov et al. 2002, A&A 393, 867' }],
  ['NAME Egg Nebula', { name: 'Egg Nebula', id: 'CRL 2688', kind: 'pn', radiusDeg: 0.004, d: 0.42, ref: 'Ueta et al. 2006, ApJL 648, L39' }],
  ['NGC 2736', { name: 'Pencil Nebula (NGC 2736)', id: 'NGC 2736', kind: 'snr', radiusDeg: 0.25, d: 0.29, ref: 'Part of the Vela remnant, Dodson et al. 2003, ApJ 596, 1137' }],
  ['NAME Keyhole Nebula', { name: 'Keyhole Nebula', id: 'Keyhole', kind: 'dark', radiusDeg: 0.05, d: 2.35, ref: 'In the Carina Nebula; Smith 2006' }],
  ['NAME Homunculus Nebula', { name: 'Homunculus Nebula', id: 'Homunculus', kind: 'refl', radiusDeg: 0.003, d: 2.35, ref: 'Thrown off by Eta Carinae in the 1840s; Smith 2006, ApJ 644, 1151' }],
  ['IC 4628', { name: 'Prawn Nebula (IC 4628)', id: 'IC 4628', kind: 'hii', radiusDeg: 0.75, d: 1.8, ref: 'Sco OB1, ≈1.8 kpc' }],
  ['NGC 3576', { name: 'Statue of Liberty Nebula (NGC 3576)', id: 'NGC 3576', kind: 'hii', radiusDeg: 0.25, d: 2.8, ref: 'de Pree et al. 1999, AJ 117, 2902' }],
  ['Sh 2-106', { name: 'Sh2-106 (Celestial Snow Angel)', id: 'Sh2-106', kind: 'hii', radiusDeg: 0.05, d: 1.09, ref: 'Distance of its molecular cloud (Zucker et al. 2020)' }],
  ['NAME Calabash Nebula', { name: 'Calabash Nebula (Rotten Egg)', id: 'OH 231.8+4.2', kind: 'pn', radiusDeg: 0.005, d: 1.5, ref: 'In the open cluster M46 (Jura & Morris 1985)' }],
);

/**
 * Familiar names for nebulae already in the catalogues of build-nebulae.mjs (run that first):
 * each is matched to the nearest row of the same kind within its size (at least 0.1°) of the
 * SIMBAD position. [SIMBAD identifier, name, kind]
 */
const CATALOGUE_NAMES = [
  ['NGC 2359', 'Thor’s Helmet (NGC 2359)', 'hii'], ['Sh 2-155', 'Cave Nebula (Sh2-155)', 'hii'], ['IC 2177', 'Seagull Nebula (IC 2177)', 'hii'],
  ['NGC 6537', 'Red Spider Nebula (NGC 6537)', 'pn'], ['PN Mz 3', 'Ant Nebula (Mz 3)', 'pn'], ['PN MyCn 18', 'Hourglass Nebula (MyCn 18)', 'pn'],
  ['IC 4406', 'Retina Nebula (IC 4406)', 'pn'], ['PN A66 21', 'Medusa Nebula (Abell 21)', 'pn'], ['W 50', 'Manatee Nebula (W50, around SS 433)', 'snr'],
];

/** Asterisms: chance alignments of stars at different distances, so they are found in the Sky tab. */
const SKY = [
  [{ ra: '04 01 00', dec: '+62 50 00' }, { name: 'Kemble’s Cascade', kind: 'Asterism', radiusDeg: 1.3, note: 'A straight chain of about 20 stars, 2.5° long, ending at the small cluster NGC 1502. Named after Father Lucian Kemble; the stars lie at different distances.', ref: 'Houston 1980, Sky & Telescope; position approximate' }],
  ['Collinder 399', { name: 'Coathanger (Collinder 399)', aliases: ['Brocchi’s Cluster', 'Al Sufi’s Cluster'], kind: 'Asterism', radiusDeg: 0.75, note: 'Ten stars that make an upside-down coat hanger. Gaia shows they lie at different distances: a chance alignment, not a cluster.', ref: 'Position from SIMBAD' }],
];

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
  ['Arp 148', { name: 'Mayall’s Object', aliases: ['Arp 148'], kind: 'galaxy', label: 'Colliding galaxies (ring and tail)', t: 5, z: 0.0352, size: 40, note: 'Two galaxies just after a head-on collision: one has become a ring, the other is stretched into a tail, so the pair looks like a ring on a stalk.', ref: 'Mayall 1940; Arp 1966' }],
  ['I Zw 18', { name: 'I Zwicky 18', aliases: ['I Zw 18', 'Mrk 116'], kind: 'galaxy', label: 'Blue compact dwarf galaxy', t: 10, d: 18.2, size: 3, note: 'One of the most metal-poor galaxies known, almost as pristine as galaxies in the early universe, yet only 59 million light-years away and still forming stars.', ref: 'Aloisi et al. 2007, ApJL 667, L151' }],
  ['NAME CMa Dwarf Galaxy', { name: 'Canis Major Dwarf Galaxy', aliases: ['Canis Major Overdensity'], kind: 'galaxy', label: 'Dwarf galaxy (disputed)', t: -3, m: 'Sph', d: 0.0077, size: 3, note: 'Claimed in 2003 as the Milky Way’s nearest satellite galaxy, 25,000 light-years from the Sun and being torn apart. It may instead be part of the Milky Way’s warped outer disc.', ref: 'Martin et al. 2004, MNRAS 348, 12' }],
  ['Mrk 421', { name: 'Markarian 421', aliases: ['Mrk 421'], kind: 'quasar', label: 'Blazar (BL Lac object)', z: 0.03, note: 'One of the nearest blazars: a galaxy whose jet points almost straight at us, one of the first sources of very-high-energy (TeV) gamma rays found beyond the Milky Way.', ref: 'Punch et al. 1992, Nature 358, 477' }],
  ['3C 348', { name: 'Hercules A', aliases: ['3C 348'], kind: 'galaxy', label: 'Radio galaxy', t: -5, z: 0.1549, size: 100, note: 'A giant elliptical galaxy whose black hole blows jets more than a million light-years long: one of the brightest radio sources in the sky.', ref: 'O’Dea et al. 2013, ApJ 771, 38' }],
  ['ACO 2667', { name: 'Comet Galaxy', kind: 'galaxy', label: 'Spiral galaxy being stripped', t: 5, z: 0.23, size: 50, note: 'A spiral galaxy falling into the cluster Abell 2667 so fast that the cluster’s gas strips it, leaving a tail of gas and new stars hundreds of thousands of light-years long.', ref: 'Cortese et al. 2007, MNRAS 376, 157 (position: its cluster, Abell 2667)' }],
  [{ ra: '06 47 55.73', dec: '+70 14 35.8' }, { name: 'MACS0647-JD', kind: 'galaxy', label: 'Early galaxy, seen through a gravitational lens', t: 10, z: 10.17, size: 1, note: 'One of the most distant galaxies known, seen about 460 million years after the Big Bang and magnified by a galaxy cluster. Webb showed it is two clumps.', ref: 'Coe et al. 2013, ApJ 762, 32 (position); Hsiao et al. 2023 (redshift)' }],
  [{ ra: '10 00 58.005', dec: '+01 48 15.25' }, { name: 'CR7', aliases: ['COSMOS Redshift 7', 'Cosmos Redshift 7'], kind: 'galaxy', label: 'Early galaxy', t: 10, z: 6.604, size: 3, note: 'One of the brightest galaxies of the early universe, 800 million years after the Big Bang. Its unusual light once suggested the very first generation of stars.', ref: 'Sobral et al. 2015, ApJ 808, 139' }],
  ['ACO S 1063', { name: 'Abell S1063', aliases: ['RXC J2248.7−4431'], kind: 'cluster', label: 'Galaxy cluster (gravitational lens)', z: 0.348, note: 'A massive cluster whose gravity magnifies the galaxies far behind it: one of Hubble’s Frontier Fields.', ref: 'Lotz et al. 2017, ApJ 837, 97' }],
  ['MACS J0717.5+3745', { name: 'MACS J0717', aliases: ['MACS J0717.5+3745'], kind: 'cluster', label: 'Merging galaxy clusters', z: 0.546, note: 'Four galaxy clusters colliding, fed by a long filament of matter: one of the most complex cluster mergers known, and a Hubble Frontier Field.', ref: 'Ebeling et al. 2004, ApJL 609, L49; Lotz et al. 2017' }],
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
const sky = await build(SKY, (e) => e);

// Names for catalogue nebulae: the nearest row of the same kind within its size of SIMBAD's position.
const catalogue = JSON.parse(readFileSync(new URL('../public/data/nebulae.json', import.meta.url), 'utf8'));
/** [l, b, id, radius (deg)] of a catalogue row, by kind (the column orders of build-nebulae.mjs). */
const rowOf = {
  hii: (r) => [r[0], r[1], r[4], r[3] / 3600],
  pn: (r) => [r[0], r[1], r[4], (r[3] ?? 0) / 3600],
  snr: (r) => [r[0], r[1], r[5], Math.sqrt(r[2] * r[3]) / 120],
  dark: (r) => [r[0], r[1], r[3], r[2] / 60],
  refl: (r) => [r[0], r[1], r[3], r[2] / 60],
};
const D = Math.PI / 180;
const sep = (l1, b1, l2, b2) => Math.acos(Math.min(1, Math.sin(b1 * D) * Math.sin(b2 * D) + Math.cos(b1 * D) * Math.cos(b2 * D) * Math.cos((l1 - l2) * D))) / D;
const nebulaNames = [];
for (const [id, name, kind] of CATALOGUE_NAMES) {
  const at = await locate(id);
  let best;
  for (const r of catalogue[kind]) {
    const [l, b, rid, rad] = rowOf[kind](r);
    const s = sep(at.l, at.b, l, b);
    if (s < Math.max(0.1, rad) && (!best || s < best.s)) best = { s, id: rid };
  }
  if (!best) throw new Error(`No catalogue ${kind} near ${id} (${name})`);
  nebulaNames.push({ kind, id: best.id, name });
}

writeFileSync(
  new URL('../public/data/famous-objects.json', import.meta.url),
  JSON.stringify({
    source: 'Positions from SIMBAD (Wenger et al. 2000, A&AS 143, 9) except where the cited paper gives them; distances, redshifts and sizes from the papers cited with each object, or from the Gaia DR3 parallax where stated.',
    fields: { map: 'd in kpc', nebulae: 'd in kpc; radiusDeg on the sky', cosmos: 'z (redshift), or d in Mpc; size in kpc' },
    map,
    nebulae,
    nebulaNames,
    sky,
    cosmos,
  }, null, 1) + '\n',
);
console.log(`famous objects: ${map.length} on the Galaxy Map, ${nebulae.length} nebulae (+ ${nebulaNames.length} catalogue names), ${sky.length} asterisms, ${cosmos.length} in the Universe tab`);
