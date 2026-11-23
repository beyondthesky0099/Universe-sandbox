#!/usr/bin/env node
/**
 * Build public/data/frbs.json: fast radio bursts traced to their host galaxies, with redshifts.
 *
 * - The DSA-110 sample of Sharma et al. 2024 (Nature 635, 61, "Preferential occurrence of fast radio
 *   bursts in massive star-forming galaxies"): host positions and spectroscopic redshifts from the
 *   authors' data release (github.com/krittisharma/frb_host_sharma2024, frbs_data/dsa_frbs.csv).
 * - Two famous ones by hand: FRB 20121102A, the first known repeater (Tendulkar et al. 2017, ApJL
 *   834, L7: RA 05h31m58.70s, Dec +33°08′52.5″, z = 0.19273), and FRB 20220610A, one of the most
 *   distant (Ryder et al. 2023, Science 382, 294: RA 23h24m17.6s, Dec −33°30′49.9″, z = 1.016).
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/build-frbs.mjs   (behind a proxy; plain node otherwise)
 */
import { writeFileSync } from 'node:fs';

const CSV = 'https://raw.githubusercontent.com/krittisharma/frb_host_sharma2024/main/frbs_data/dsa_frbs.csv';
const res = await fetch(CSV);
if (!res.ok) throw new Error(`DSA-110 FRB hosts: HTTP ${res.status}`);
const text = await res.text();

/** Minimal CSV: quoted fields with commas inside, no embedded newlines. */
function parseLine(line) {
  const out = [];
  let cur = '', quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const [head, ...rows] = text.trim().split('\n');
const cols = parseLine(head);
const col = (name) => cols.indexOf(name);
const bursts = [];
for (const line of rows) {
  const f = parseLine(line);
  const name = f[col('FRB_TNS_name')].trim();
  const [ra, dec] = f[col('host_loc (deg, deg)')].split(',').map(Number);
  const z = Number(f[col('redshift')]);
  if (!name || !Number.isFinite(ra) || !Number.isFinite(dec) || !(z > 0)) continue;
  bursts.push([name, Math.round(ra * 1e5) / 1e5, Math.round(dec * 1e5) / 1e5, z, f[col('frb_name')].trim()]);
}
if (bursts.length < 20) throw new Error(`only ${bursts.length} bursts parsed: has the file changed?`);
bursts.push(['FRB 20121102A', 82.99458, 33.14792, 0.19273, 'the first repeater']);
bursts.push(['FRB 20220610A', 351.07333, -33.51386, 1.016, 'one of the most distant']);
bursts.sort((a, b) => a[3] - b[3]);
writeFileSync(
  new URL('../public/data/frbs.json', import.meta.url),
  JSON.stringify({ source: 'Sharma et al. 2024 (Nature 635, 61), DSA-110 hosts; Tendulkar et al. 2017; Ryder et al. 2023', columns: ['name', 'raDeg', 'decDeg', 'z', 'nickname'], bursts }) + '\n',
);
console.log(`${bursts.length} fast radio bursts with host redshifts`);
