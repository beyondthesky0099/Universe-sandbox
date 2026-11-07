import { describe, expect, it } from 'vitest';
import { AURORAS, auroraActivity, auroraFor, ovalColatitude } from '../src/render/aurora';

describe('auroras', () => {
  it('uses real magnetic tilts and oval positions', () => {
    expect(AURORAS.Earth.tilt).toBeCloseTo(9.4, 1);
    expect(AURORAS.Uranus.tilt).toBeCloseTo(59, 0);
    expect(AURORAS.Neptune.tilt).toBeCloseTo(47, 0);
    expect(AURORAS.Saturn.tilt).toBeLessThan(0.1);
    // Earth's oval: ~67° magnetic latitude at night, ~77° by day.
    const e = AURORAS.Earth;
    expect(90 - (e.colatitude + e.nightShift)).toBeCloseTo(67, 0);
    expect(90 - (e.colatitude - e.nightShift)).toBeCloseTo(77, 0);
    // Green oxygen light is the brightest, red sits higher up.
    const [green, red] = e.layers;
    expect(green.weight).toBeGreaterThan(red.weight);
    expect(red.at).toBeGreaterThan(green.at);
    // Emission between ~100 and ~300 km.
    expect(e.bottom * 6371).toBeCloseTo(95, -1);
    expect(e.top * 6371).toBeGreaterThan(250);
  });

  it('gives auroras only to worlds with a magnetic field and air', () => {
    expect(auroraFor('Earth', true, 'rocky', true, 1, 0)).toBe(AURORAS.Earth);
    expect(auroraFor('Mars', true, 'rocky', true, 0.107, 0)).toBeUndefined();
    expect(auroraFor('Venus', true, 'rocky', true, 0.815, 0)).toBeUndefined();
    expect(auroraFor('Kepler-x b', false, 'gas', true, 300, 7)?.falseColour).toBe(true);
    expect(auroraFor('Tiny', false, 'rocky', true, 0.1, 7)).toBeUndefined();
    expect(auroraFor('Airless', false, 'rocky', false, 1, 7)).toBeUndefined();
    expect(auroraFor('Terra', false, 'rocky', true, 1, 7)?.layers[0].color).toBe(AURORAS.Earth.layers[0].color);
  });

  it('brightens and widens as the stellar wind strengthens', () => {
    // Twice as close: four times the wind.
    expect(auroraActivity(1, 0.5, 10) / auroraActivity(1, 1, 10)).toBeCloseTo(4, 5);
    expect(auroraActivity(1, 100, 10)).toBeLessThan(0.1);
    expect(ovalColatitude(AURORAS.Earth, 4)).toBeGreaterThan(ovalColatitude(AURORAS.Earth, 1));
    expect(ovalColatitude(AURORAS.Earth, 1)).toBeCloseTo(AURORAS.Earth.colatitude, 5);
  });
});
