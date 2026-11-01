#!/usr/bin/env node
/**
 * Download real surface maps from NASA (public domain) and shrink them for the web into
 * public/textures/*.jpg, plus public/textures/CREDITS.md. Each map is an equirectangular
 * (cylindrical) projection. Bodies without a suitable NASA map keep their procedural look.
 *
 * Needs ImageMagick (`convert`).
 *
 *   node scripts/build-planet-textures.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** [output name, URL, output width, credit] */
const MAPS = [
  [
    'earth',
    'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg',
    2048,
    'NASA Visible Earth, "The Blue Marble: Land Surface, Shallow Water, and Shaded Topography" (NASA Goddard Space Flight Center)',
  ],
  [
    'earth-clouds',
    'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg',
    1024,
    'NASA Visible Earth, "The Blue Marble: Clouds" (NASA Goddard Space Flight Center)',
  ],
  [
    'moon',
    'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_1k.jpg',
    1024,
    'NASA Scientific Visualization Studio, CGI Moon Kit (Lunar Reconnaissance Orbiter Camera colour map)',
  ],
  [
    'jupiter',
    'https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia07/pia07782/PIA07782.jpg',
    1024,
    'NASA/JPL/Space Science Institute, Cassini map of Jupiter (PIA07782)',
  ],
];

const outDir = new URL('../public/textures/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const work = join(tmpdir(), 'astrarium-textures');
mkdirSync(work, { recursive: true });

for (const [name, url, width] of MAPS) {
  const res = await fetch(url);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('image/')) throw new Error(`${url}: HTTP ${res.status} (${type})`);
  const src = join(work, `${name}-source.jpg`);
  writeFileSync(src, Buffer.from(await res.arrayBuffer()));
  const dest = new URL(`${name}.jpg`, outDir).pathname;
  execFileSync('convert', [src, '-resize', `${width}x${width / 2}!`, '-strip', '-quality', '82', dest]);
  console.log(`${name}.jpg (${width}×${width / 2}) ← ${url}`);
}

writeFileSync(
  new URL('CREDITS.md', outDir),
  `# Planet texture credits

All maps here are NASA imagery, which is generally not subject to copyright in the United
States (see https://www.nasa.gov/nasa-brand-center/images-and-media/). They were resized and
recompressed by \`scripts/build-planet-textures.mjs\`.

| File | Credit | Source |
| --- | --- | --- |
${MAPS.map(([name, url, , credit]) => `| ${name}.jpg | ${credit} | ${url} |`).join('\n')}
`,
);
