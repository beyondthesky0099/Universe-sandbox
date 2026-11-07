import { describe, expect, it } from 'vitest';
import { ATMOSPHERES, atmosphereFor, shellScale } from '../src/render/atmosphere';

describe('planetary atmospheres', () => {
  it("Earth's sky: Rayleigh scattering ∝ λ⁻⁴ (blue 440 nm vs red 680 nm: (680/440)⁴ ≈ 5.7)", () => {
    const [r, g, b] = ATMOSPHERES.Earth.rayleigh;
    expect(b / r).toBeCloseTo((680 / 440) ** 4, 0);
    expect(g / r).toBeCloseTo((680 / 550) ** 4, 0);
    expect(ATMOSPHERES.Earth.rayleighH).toBe(8e3);
  });

  it('Mars has ~1–2% of Earth’s Rayleigh scattering (thin CO₂) but dust that absorbs blue; Venus far more of both', () => {
    const ratio = ATMOSPHERES.Mars.rayleigh[2] / ATMOSPHERES.Earth.rayleigh[2];
    expect(ratio).toBeGreaterThan(0.01);
    expect(ratio).toBeLessThan(0.03);
    expect(ATMOSPHERES.Mars.absorb[2]).toBeGreaterThan(ATMOSPHERES.Mars.absorb[0]);
    expect(ATMOSPHERES.Venus.mie[1]).toBeGreaterThan(10 * ATMOSPHERES.Earth.mie[1]);
  });

  it('draws each atmosphere to its real proportion of the radius, never under 2%; Titan’s is huge', () => {
    expect(shellScale(ATMOSPHERES.Earth)).toBeCloseTo(1.02, 6); // real 1.6%, drawn at the 2% floor
    expect(shellScale(ATMOSPHERES.Titan)).toBeCloseTo(1 + 600 / 2575, 6);
    for (const a of Object.values(ATMOSPHERES)) expect(shellScale(a)).toBeGreaterThanOrEqual(1.02);
  });

  it('gives procedural worlds an atmosphere from their look, and airless worlds none', () => {
    expect(atmosphereFor('Kepler-x b', 0x6fb6ff, 'rocky')).toBe(ATMOSPHERES.Earth);
    expect(atmosphereFor('Hot one', 0xffc070, 'rocky')).toBe(ATMOSPHERES.Venus);
    expect(atmosphereFor('Rock', undefined, 'rocky')).toBeUndefined();
    expect(atmosphereFor('Mars', undefined, 'rocky')).toBe(ATMOSPHERES.Mars);
  });
});
