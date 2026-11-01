import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateGalaxy } from '../src/procgen/galaxy';
import { COSMIC_STRUCTURES, displayName, galacticToCosmos, galaxyForm, localPosition, webPosition, type LocalGalaxy, type WebCatalog } from '../src/sim/galaxies';

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
