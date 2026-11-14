import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateGalaxy } from '../src/procgen/galaxy';
import { ABELL_NAMES, COSMIC_STRUCTURES, displayName, galacticToCosmos, galaxyForm, isFamous, localPosition, universeEntries, webPosition, type LocalGalaxy, type UniverseObjects, type WebCatalog } from '../src/sim/galaxies';

const local: LocalGalaxy[] = JSON.parse(readFileSync(new URL('../public/data/galaxies-local.json', import.meta.url), 'utf8')).galaxies;
const web: WebCatalog = JSON.parse(readFileSync(new URL('../public/data/galaxies-2mrs.json', import.meta.url), 'utf8'));
const byName = (n: string) => local.find((g) => g.name === n)!;

describe('real galaxies beyond the Milky Way', () => {
  it('has the Local Group at its measured distances', () => {
    expect(local.length).toBeGreaterThan(800);
    const m31 = byName('MESSIER031');
    expect(Math.hypot(...localPosition(m31))).toBeCloseTo(0.77, 2); // Mpc
    expect(m31.v).toBeLessThan(-250); // Andromeda is approaching
    expect(Math.hypot(...localPosition(byName('LMC')))).toBeCloseTo(0.05, 2);
    expect(localPosition(byName('Milky Way'))).toEqual([0, 0, 0]);
  });

  it('puts galaxies on the right side of the sky', () => {
    // Galactic north is +y on the map: M101 (b = +59.8°) is above the plane, M31 (b = −21.6°) below.
    expect(localPosition(byName('MESSIER101'))[1]).toBeGreaterThan(0);
    expect(localPosition(byName('MESSIER031'))[1]).toBeLessThan(0);
    // l = 0 (toward the galactic centre) is +x.
    const [x, y, z] = galacticToCosmos(0, 0, 1);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('classifies and names galaxies', () => {
    expect(galaxyForm(byName('MESSIER031'))).toBe('spiral');
    expect(galaxyForm(byName('LMC'))).toBe('irregular');
    expect(galaxyForm(byName('NGC5128'))).toBe('lenticular'); // Centaurus A, T = −2
    expect(galaxyForm({ t: -5 })).toBe('elliptical');
    expect(galaxyForm(byName('MESSIER032'))).toBe('elliptical'); // M32: dwarf elliptical (dEem)
    expect(galaxyForm({ t: -1, m: 'Sph' })).toBe('dwarf spheroidal');
    expect(displayName(byName('MESSIER031'))).toBe('Andromeda Galaxy (M31)');
    expect(displayName({ name: 'MESSIER094' })).toBe('M94');
    expect(displayName({ name: 'NGC0300' })).toBe('NGC 300');
  });

  it('shows the cosmic web: galaxies crowd around the Virgo Cluster', () => {
    expect(web.galaxies.length).toBeGreaterThan(30000);
    const count = (centre: number[]) =>
      web.galaxies.filter((w) => {
        const p = webPosition(w, web.H0);
        return Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]) < 4;
      }).length;
    const virgo = COSMIC_STRUCTURES.find((s) => s.name === 'Virgo Cluster')!;
    const atVirgo = count(galacticToCosmos(virgo.l, virgo.b, virgo.d));
    // The same distance in the opposite direction is ordinary space.
    const opposite = count(galacticToCosmos((virgo.l + 180) % 360, -virgo.b, virgo.d));
    expect(atVirgo).toBeGreaterThan(5 * Math.max(1, opposite));
  });
});

describe('stand-in galaxies of other forms', () => {
  it('generates ellipticals without arms, gas or dust, and gassy irregulars', () => {
    const e = generateGalaxy(42, 2000, 2000, 500, { name: 'Test E', form: 'elliptical' });
    expect(e.name).toBe('Test E');
    expect(e.form).toBe('elliptical');
    expect(e.dust.count).toBe(0);
    expect(e.nebulae.length).toBe(0);
    const irr = generateGalaxy(42, 2000, 2000, 500, { form: 'irregular' });
    expect(irr.nebulae.length).toBeGreaterThan(0);
    expect(generateGalaxy(42, 100, 100, 10).form).toBe('spiral');
  });
});

describe('named galaxies beyond the Local Volume', () => {
  it('includes M87 and the Sombrero, placed by redshift', async () => {
    const { namedFromSurvey, displayName, galaxyForm } = await import('../src/sim/galaxies');
    const raw = JSON.parse(readFileSync(new URL('../public/data/galaxies-named.json', import.meta.url), 'utf8'));
    const named = namedFromSurvey(raw.galaxies, raw.H0);
    const m87 = named.find((g) => g.name === 'MESSIER087')!;
    expect(displayName(m87)).toBe('M87 (Virgo A)');
    expect(galaxyForm(m87)).toBe('elliptical');
    expect(m87.zd).toBe(true);
    expect(m87.d).toBeGreaterThan(15); // ~18.7 Mpc from its redshift (the Virgo Cluster is ~16.5 Mpc)
    expect(m87.d).toBeLessThan(22);
    expect(m87.lk!).toBeGreaterThan(11); // one of the most luminous galaxies nearby
    expect(galaxyForm(named.find((g) => g.name === 'MESSIER104')!)).toBe('spiral');
    expect(named.every((g) => g.d > 11)).toBe(true); // nearer ones come from the Local Volume catalogue
  });
});

describe('the cosmic microwave background map', () => {
  it('is bundled as an equirectangular galactic map at the edge of the observable universe', async () => {
    const { CMB_RADIUS_MPC } = await import('../src/render/cosmosView');
    expect(CMB_RADIUS_MPC * 3.2616e6 / 1e9).toBeCloseTo(45.7, 0); // ~46 billion light-years
    const jpg = readFileSync(new URL('../public/textures/cmb.jpg', import.meta.url));
    // JPEG SOF0 marker holds the dimensions: 2048 × 1024 (2:1 equirectangular).
    const sof = jpg.indexOf(Buffer.from([0xff, 0xc0]));
    expect(jpg.readUInt16BE(sof + 5)).toBe(1024);
    expect(jpg.readUInt16BE(sof + 7)).toBe(2048);
  });
});

describe('every named galaxy, the rich clusters and the quasars', () => {
  const raw = JSON.parse(readFileSync(new URL('../public/data/galaxies-named.json', import.meta.url), 'utf8'));
  const universe: UniverseObjects = JSON.parse(readFileSync(new URL('../public/data/universe-objects.json', import.meta.url), 'utf8'));

  it('names thousands of NGC, IC and UGC galaxies with OpenNGC position angles', async () => {
    const { namedFromSurvey } = await import('../src/sim/galaxies');
    const named = namedFromSurvey(raw.galaxies, raw.H0);
    expect(named.length).toBeGreaterThan(9000);
    expect(named.filter((g) => g.pa !== undefined).length).toBeGreaterThan(3000);
    const needle = named.find((g) => g.name === 'NGC4565')!;
    expect(needle.common).toBe('Needle Galaxy');
    expect(displayName(needle)).toBe('Needle Galaxy (NGC 4565)');
    expect(needle.pa).toBe(135); // OpenNGC
    expect(isFamous(needle)).toBe(true);
    expect(displayName({ name: 'UGC07699' })).toBe('UGC 7699');
    expect(displayName({ name: 'MRK0421' })).toBe('MRK 421');
    // Axis ratios come with every 2MRS entry.
    expect(named.filter((g) => g.ba !== undefined).length).toBe(named.length);
  });

  it('places the Coma Cluster about 100 Mpc away, named, with its Abell facts', () => {
    const entries = universeEntries(universe);
    const coma = entries.find((g) => g.name === 'Abell 1656')!;
    expect(coma.kind).toBe('cluster');
    expect(coma.common).toBe(ABELL_NAMES[1656]);
    expect(coma.d).toBeGreaterThan(95);
    expect(coma.d).toBeLessThan(105);
    expect(coma.rich).toBe(2);
    expect(coma.count).toBeGreaterThan(100);
    // Near the hand-placed Coma label of old (b = 88°): same patch of sky, same distance.
    expect(coma.b).toBeGreaterThan(85);
    expect(entries.filter((g) => g.kind === 'cluster').length).toBeGreaterThan(600);
  });

  it('places quasars at comoving distances and keeps the record holders', () => {
    const entries = universeEntries(universe);
    const quasars = entries.filter((g) => g.kind === 'quasar');
    expect(quasars.length).toBeGreaterThan(2500);
    // Together with the Seyferts and blazars, the whole bright Véron set is on the map.
    expect(entries.filter((g) => g.kind === 'quasar' || g.kind === 'seyfert' || g.kind === 'blazar').length).toBeGreaterThan(6000);
    // 3C 273 is a hand-entered record holder, so the catalogue copy "3C 273.0" is dropped.
    expect(entries.filter((g) => g.name.startsWith('3C 273')).length).toBe(1);
    const q = entries.find((g) => g.name === '3C 273')!;
    expect(q.note).toContain('first quasar');
    expect(q.d).toBeCloseTo(652, -1);
    const far = entries.find((g) => g.name === 'JADES-GS-z14-0')!;
    expect(far.kind).toBe('galaxy');
    expect(far.d).toBeGreaterThan(10000); // comoving Mpc: deep in the observable universe
    expect(far.d).toBeLessThan(14000); // but inside the CMB sphere
    expect(isFamous(far)).toBe(true);
  });
});

describe('active galactic nuclei', () => {
  const raw: UniverseObjects = JSON.parse(readFileSync(new URL('../public/data/universe-objects.json', import.meta.url), 'utf8'));
  const entries = universeEntries(raw);

  it('splits the Véron catalogue into quasars, Seyferts and blazars', async () => {
    const { agnTypeLabel, agnNucleusLabel } = await import('../src/sim/galaxies');
    expect(entries.filter((g) => g.kind === 'quasar').length).toBeGreaterThan(2500);
    expect(entries.filter((g) => g.kind === 'seyfert').length).toBeGreaterThan(3000);
    expect(entries.filter((g) => g.kind === 'blazar').length).toBeGreaterThan(100);
    const bllac = entries.find((g) => g.name === 'BL LAC')!;
    expect(bllac.kind).toBe('blazar');
    expect(bllac.z).toBeCloseTo(0.069, 3);
    expect(agnTypeLabel(bllac.cl!, bllac.sp!)).toBe('BL Lac object (blazar, highly polarized)');
    const oj = entries.find((g) => g.name === 'OJ 287')!;
    expect(oj.bh!.mass).toBe(1.8e10);
    // 3C 273 stays the record holder, now with its black hole and class.
    const c273 = entries.filter((g) => /^3C 273/.test(g.name));
    expect(c273.length).toBe(1);
    expect(c273[0].note).toBeTruthy();
    expect(c273[0].cl).toBe('Q');
    expect(c273[0].bh!.mass).toBe(8.9e8);
    expect(agnTypeLabel('A', 'S1h')).toBe('Seyfert 2 with hidden broad lines (seen in polarized light)');
    expect(agnTypeLabel('A', 'S3')).toBe('LINER');
    expect(agnTypeLabel('A', 'S1.5')).toBe('Seyfert 1.5 galaxy');
    expect(agnTypeLabel('Q', 'HP')).toBe('Quasar (highly polarized: a blazar)');
    expect(agnNucleusLabel({ name: 'x', cl: 'A', sp: 'S2' })).toBe('Seyfert 2 nucleus');
  });

  it('gives named galaxies their nucleus and black hole instead of a second point', async () => {
    const { markActiveHosts, namedFromSurvey } = await import('../src/sim/galaxies');
    const namedRaw = JSON.parse(readFileSync(new URL('../public/data/galaxies-named.json', import.meta.url), 'utf8'));
    const all = [...local, ...namedFromSurvey(namedRaw.galaxies, namedRaw.H0)];
    const n = markActiveHosts(all, raw);
    expect(n).toBeGreaterThan(400);
    const m77 = all.find((g) => g.name === 'MESSIER077')!;
    expect(m77.agn).toMatchObject({ name: 'NGC 1068', cl: 'A', sp: 'S1h' });
    expect(m77.bh!.mass).toBe(1.5e7);
    const m87 = all.find((g) => g.name === 'MESSIER087')!;
    expect(m87.agn!.sp).toBe('S3'); // a LINER
    expect(m87.bh!.mass).toBe(6.5e9);
    expect(m87.agn!.radio).toBeGreaterThan(50); // Virgo A, radio-loud
    const cenA = all.find((g) => g.name === 'NGC5128')!;
    expect(cenA.agn!.cl).toBe('B');
    expect(cenA.bh!.mass).toBe(5.5e7);
    // M81 approaches us (z < 0): it is a host, not a point.
    expect(all.find((g) => g.name === 'MESSIER081')?.agn?.name).toBe('NGC 3031');
    expect(entries.some((g) => g.name === 'NGC 3031' || g.name === 'NGC 1068' || g.name === 'NGC 4486')).toBe(false);
    // Hosts count as famous, so they keep a label.
    expect(isFamous(m77)).toBe(true);
  });
});
