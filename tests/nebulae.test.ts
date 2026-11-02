import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diameterPc, galacticToEcliptic, parseNebulae } from '../src/sim/nebulae';

const nebulae = parseNebulae(JSON.parse(readFileSync(new URL('../public/data/nebulae.json', import.meta.url), 'utf8')));
const byName = (n: string) => nebulae.find((x) => x.name === n)!;

describe('real nebulae', () => {
  it('includes every confirmed WISE HII region, every Strasbourg-ESO planetary nebula and every Green SNR', () => {
    expect(nebulae.filter((n) => n.kind === 'hii').length).toBe(2174);
    expect(nebulae.filter((n) => n.kind === 'pn').length).toBe(1143);
    expect(nebulae.filter((n) => n.kind === 'snr').length).toBe(294);
    expect(nebulae.filter((n) => n.kind === 'hii' && n.distanceKpc).length).toBeGreaterThan(900);
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
