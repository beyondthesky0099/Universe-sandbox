import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hostPosition, parseCatalog } from '../src/sim/exoplanets';
import { Simulation } from '../src/sim/simulation';
import { AU_PER_PC, loadStarNeighbourhood, starPhysics, type BrightStar, type NearStar } from '../src/sim/stars';

const near: NearStar[] = JSON.parse(readFileSync(new URL('../public/data/stars-near.json', import.meta.url), 'utf8')).stars;
const bright: BrightStar[] = JSON.parse(readFileSync(new URL('../public/data/stars-bright.json', import.meta.url), 'utf8')).stars;
const catalog = parseCatalog(JSON.parse(readFileSync(new URL('../public/data/exoplanets.json', import.meta.url), 'utf8')));
const star = (name: string) => near.find((s) => s.name === name)!;

describe('real stars (HYG)', () => {
  it('has the nearest stars at their real distances', () => {
    const d = (n: string) => Math.hypot(...star(n).xyz);
    expect(d('Proxima Centauri')).toBeCloseTo(1.30, 2);
    expect(d('Sirius')).toBeCloseTo(2.64, 1);
    expect(d("Barnard's Star")).toBeCloseTo(1.82, 1);
    expect(near.length).toBeGreaterThan(1500);
    expect(bright.length).toBeGreaterThan(8000);
  });

  it('classifies stars and estimates masses sensibly', () => {
    const sirius = starPhysics(star('Sirius'));
    expect(sirius.kind).toBe('star');
    expect(sirius.mass).toBeGreaterThan(1.6);
    expect(sirius.mass).toBeLessThan(2.6);
    expect(sirius.temperature).toBeGreaterThan(8000);
    expect(starPhysics(star('Gliese 244B')).kind).toBe('whitedwarf'); // Sirius B
    const proxima = starPhysics(star('Proxima Centauri'));
    expect(proxima.mass).toBeLessThan(0.2);
    expect(proxima.temperature).toBeLessThan(3600);
    expect(starPhysics({ spect: 'K1.5III', ci: 1.24, lum: 100 }).kind).toBe('giant'); // Arcturus-like
    expect(starPhysics({ spect: 'G2V', ci: 0.65, lum: 1 }).mass).toBeCloseTo(1, 1);
  });

  it('puts Sirius in the right place in the sky (ecliptic J2000)', () => {
    const s = bright.find((b) => b[5] === 'Sirius')!;
    const lon = (Math.atan2(s[1], s[0]) * 180) / Math.PI;
    const lat = (Math.asin(s[2]) * 180) / Math.PI;
    // Sirius: ecliptic longitude ≈ 104.1°, latitude ≈ −39.6°
    expect(lon).toBeCloseTo(104.1, 0);
    expect(lat).toBeCloseTo(-39.6, 0);
  });

  it('agrees with exoplanet host positions in the same frame', () => {
    const host = catalog.hosts.find((h) => h.name === 'Proxima Cen')!;
    const [hx, hy, hz] = hostPosition(host);
    const [x, y, z] = star('Proxima Centauri').xyz;
    // Scene (x, z, −y) of the ecliptic HYG position
    const d = Math.hypot(hx - x * AU_PER_PC, hy - z * AU_PER_PC, hz + y * AU_PER_PC) / AU_PER_PC;
    expect(d).toBeLessThan(0.01);
  });

  it('builds the solar neighbourhood with every star within 10 pc', () => {
    const sim = new Simulation();
    loadStarNeighbourhood(sim, near, catalog, 10);
    expect(sim.bodies.length).toBeGreaterThan(300);
    expect(sim.bodies.find((b) => b.name === 'Proxima Centauri')?.tag).toBe('exohost:Proxima Cen');
    expect(sim.bodies.some((b) => b.kind === 'whitedwarf')).toBe(true);
    expect(sim.gravityScale).toBe(0);
  });
});
