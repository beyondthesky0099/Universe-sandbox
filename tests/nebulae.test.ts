import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diameterPc, galacticToEcliptic, parseNebulae } from '../src/sim/nebulae';

const nebulae = parseNebulae(JSON.parse(readFileSync(new URL('../public/data/nebulae.json', import.meta.url), 'utf8')));
const byName = (n: string) => nebulae.find((x) => x.name === n)!;

describe('real nebulae', () => {
  it('includes every confirmed WISE HII region, every Strasbourg-ESO planetary nebula, every Green SNR, and the dark and reflection nebulae', () => {
    const count = (k: string) => nebulae.filter((n) => n.kind === k).length;
    expect(count('hii')).toBe(2174);
    expect(count('pn')).toBe(1143);
    expect(count('snr')).toBe(294);
    expect(count('dark')).toBe(1907); // Barnard's 349 plus the Lynds clouds Barnard didn't list
    expect(count('refl')).toBe(158); // van den Bergh
    expect(nebulae.filter((n) => n.kind === 'hii' && n.distanceKpc).length).toBeGreaterThan(900);
    expect(nebulae.filter((n) => n.kind === 'snr' && n.distanceKpc).length).toBeGreaterThan(150);
  });

  it('places supernova remnants at their measured distances (Ranasinghe & Leahy 2023)', () => {
    expect(byName('Vela Supernova Remnant').distanceKpc!).toBeCloseTo(0.25, 1);
    expect(byName('Cygnus Loop (Veil Nebula)').distanceKpc!).toBeCloseTo(0.73, 1);
    expect(byName('Cassiopeia A').distanceKpc!).toBeCloseTo(3.3, 0);
  });

  it('finds the Horsehead (Barnard 33) and the Iris Nebula where they are', () => {
    const horsehead = byName('Horsehead Nebula (B33)');
    expect(horsehead.kind).toBe('dark');
    expect(horsehead.l).toBeCloseTo(206.95, 1);
    expect(horsehead.b).toBeCloseTo(-16.8, 1);
    const iris = byName('Iris Nebula');
    expect(iris.kind).toBe('refl');
    expect(iris.star).toBe('HD 200775'); // the star that lights it
    // At its star's distance: Gaia parallax 2.82 mas → about 355 pc.
    expect(iris.distanceKpc!).toBeCloseTo(0.355, 2);
    const refl = nebulae.filter((n) => n.kind === 'refl');
    expect(refl.filter((n) => n.distanceKpc).length).toBeGreaterThan(130);
  });

  it('puts famous nebulae at their measured distances', () => {
    expect(byName('Orion Nebula (M42)').distanceKpc).toBeCloseTo(0.41, 1); // parallax ≈ 0.41 kpc
    const helix = byName('Helix Nebula');
    expect(helix.distanceSource).toBe('gaia');
    expect(helix.distanceKpc!).toBeGreaterThan(0.18); // Gaia: ~200 pc, the nearest bright PN
    expect(helix.distanceKpc!).toBeLessThan(0.22);
    expect(byName('Ring Nebula (M57)').distanceKpc!).toBeCloseTo(0.79, 1);
    // The Crab Nebula is about 7 arcminutes across (Green), and Cygnus Loop about 3 degrees.
    expect(byName('Crab Nebula (M1)').radiusDeg * 120).toBeCloseTo(6, 0);
    expect(byName('Cygnus Loop (Veil Nebula)').radiusDeg * 2).toBeGreaterThan(2.5);
    // The Helix is about 0.8 pc across at its Gaia distance.
    expect(diameterPc(helix)!).toBeGreaterThan(0.5);
    expect(diameterPc(helix)!).toBeLessThan(1.2);
  });

  it('converts galactic positions to the sky correctly (Orion Nebula: RA 83.82°, Dec −5.39°)', () => {
    const orion = byName('Orion Nebula (M42)');
    const [x, y, z] = galacticToEcliptic(orion.l, orion.b);
    // Ecliptic → equatorial.
    const e = (23.4392911 * Math.PI) / 180;
    const ye = Math.cos(e) * y - Math.sin(e) * z, ze = Math.sin(e) * y + Math.cos(e) * z;
    const ra = ((Math.atan2(ye, x) * 180) / Math.PI + 360) % 360;
    const dec = (Math.asin(ze) * 180) / Math.PI;
    expect(ra).toBeCloseTo(83.82, 0);
    expect(dec).toBeCloseTo(-5.39, 0);
  });
});
