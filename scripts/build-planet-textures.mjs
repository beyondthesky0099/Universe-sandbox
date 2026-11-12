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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** [output name, URL, output width, credit, extra ImageMagick options] */
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
    'earth-night',
    'https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg',
    2048,
    'NASA Earth Observatory, "Black Marble 2016" night lights (Suomi NPP VIIRS; NASA Goddard / Miguel Román)',
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
  // USGS Astrogeology global mosaics (browse versions). USGS-produced data are in the U.S.
  // public domain: https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits
  [
    'mercury',
    'https://astrogeology.usgs.gov/ckan/dataset/b8ad92a0-5cb2-4db9-ae66-d0ef3a747bb7/resource/4f5968f1-cae7-4b6a-9967-d576c10f9475/download/mercury_messenger_clrmosaic_global_1024.jpg',
    1024,
    'NASA/JHUAPL/Carnegie Institution, MESSENGER MDIS global colour mosaic, via USGS Astrogeology (saturation reduced here: the mosaic is tinted, Mercury looks grey)',
    ['-modulate', '100,30'],
  ],
  [
    'mars',
    'https://astrogeology.usgs.gov/ckan/dataset/dfdc2242-52dc-4126-bc89-03af8253ae79/resource/0d7b31dc-0b2e-4ca6-89dc-e3c1404c0232/download/mars_viking_clrmosaic_global_1024.jpg',
    1024,
    'NASA Viking Orbiter global colour mosaic, via USGS Astrogeology',
  ],
  [
    'phobos',
    'https://astrogeology.usgs.gov/ckan/dataset/85290c2c-7524-44ba-9251-61ea69fcd9dd/resource/876ae3aa-ac7b-434c-86f4-a2e50cc9826d/download/phobos_viking_mosaic_dlrcontrol_1024.jpg',
    1024,
    'NASA Viking Orbiter global mosaic of Phobos (DLR control), via USGS Astrogeology',
    ['-colorspace', 'Gray'],
  ],
  [
    'europa',
    'https://astrogeology.usgs.gov/ckan/dataset/4080036f-afc5-422e-abe9-1c0c8e4f98ea/resource/3647e7b3-425e-4dcf-951b-cc4a22fb0129/download/europa_voyager_galileossi_global_mosaic_500m_1024.jpg',
    1024,
    'NASA Voyager and Galileo SSI global mosaic of Europa, via USGS Astrogeology',
    ['-colorspace', 'Gray'],
  ],
  [
    'ganymede',
    'https://astrogeology.usgs.gov/ckan/dataset/b2d0bf2c-1335-424b-a952-da3d8374723b/resource/19e807a2-9eee-4f24-9965-5e25f0bcb9fc/download/full.jpg',
    1024,
    'NASA Voyager and Galileo global mosaic of Ganymede, via USGS Astrogeology',
    ['-colorspace', 'Gray'],
  ],
  [
    'rhea',
    'https://astrogeology.usgs.gov/ckan/dataset/22bc1015-d9c9-4212-86c3-e42061b204d4/resource/77fa77f8-6d6b-4072-9360-17138caa6e7d/download/full.jpg',
    1024,
    'NASA Cassini and Voyager global mosaic of Rhea, via USGS Astrogeology',
    ['-colorspace', 'Gray'],
  ],
  [
    'iapetus',
    'https://astrogeology.usgs.gov/ckan/dataset/6ac8ecfb-36e7-4113-8d16-c92ba857c3d7/resource/141c2d1e-aa01-4e2f-969a-e46a581db4b9/download/full.jpg',
    1024,
    'NASA Cassini and Voyager global mosaic of Iapetus, via USGS Astrogeology',
    ['-colorspace', 'Gray'],
  ],
  [
    // Simple cylindrical, the whole globe. USGS: the true colours are "similar but much more muted",
    // so saturation is reduced here.
    'io',
    'https://astrogeology.usgs.gov/ckan/dataset/f6924861-ce9c-490d-8a4b-7812a20f2de5/resource/a9fab679-8081-4144-9f58-45848836c8f5/download/full.jpg',
    1024,
    'NASA Galileo SSI / Voyager colour-merged global mosaic of Io, via USGS Astrogeology (saturation reduced here: the true colours are more muted)',
    ['-modulate', '100,60'],
  ],
  [
    'vesta',
    'https://astrogeology.usgs.gov/ckan/dataset/ec63e420-a8bd-4a90-9341-a5754b551574/resource/9306febf-0c7a-49ee-b7b0-a1f043297bf7/download/vesta_dawn_fc_hamo_mosaic_global_1024.jpg',
    1024,
    'NASA Dawn Framing Camera HAMO global mosaic of Vesta, via USGS Astrogeology',
    ['-colorspace', 'Gray'],
  ],
];

const outDir = new URL('../public/textures/', import.meta.url);
mkdirSync(outDir, { recursive: true });
// Downloads are cached, so a rerun after a server hiccup (HTTP 503) only fetches what's missing.
const work = join(new URL('../node_modules/.cache/textures/', import.meta.url).pathname);
mkdirSync(work, { recursive: true });

/** NASA Earth Observatory images are mirrored here; used when eoimages.gsfc.nasa.gov is down. */
const mirror = (url) => url.replace('https://eoimages.gsfc.nasa.gov/images/', 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/');

async function download(url, dest) {
  if (existsSync(dest)) return;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(attempt % 2 ? mirror(url) : url);
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type.startsWith('image/')) {
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      return;
    }
    if (attempt >= 4) throw new Error(`${url}: HTTP ${res.status} (${type})`);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
}

for (const [name, url, width, , extra = []] of MAPS) {
  const src = join(work, `${name}-source.jpg`);
  await download(url, src);
  const dest = new URL(`${name}.jpg`, outDir).pathname;
  execFileSync('convert', [src, ...extra, '-resize', `${width}x${width / 2}!`, '-strip', '-quality', '82', dest]);
  console.log(`${name}.jpg (${width}×${width / 2}) ← ${url}`);
}

writeFileSync(
  new URL('CREDITS.md', outDir),
  `# Planet texture credits

All maps here are NASA mission imagery, some processed into global mosaics by the USGS
Astrogeology Science Center. NASA imagery is generally not subject to copyright in the United
States (https://www.nasa.gov/nasa-brand-center/images-and-media/), and USGS-produced data are
in the U.S. public domain
(https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits). They were
resized and recompressed (and, where noted, converted to greyscale or desaturated) by
\`scripts/build-planet-textures.mjs\`.

| File | Credit | Source |
| --- | --- | --- |
${MAPS.map(([name, url, , credit]) => `| ${name}.jpg | ${credit} | ${url} |`).join('\n')}
| cmb.jpg | NASA/WMAP Science Team, WMAP 9-year Internal Linear Combination map, reprojected from HEALPix by \`scripts/build-cmb.py\` (public domain) | https://lambda.gsfc.nasa.gov/data/map/dr5/dfp/ilc/wmap_ilc_9yr_v5.fits |
`,
);
