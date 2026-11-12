import { describe, expect, it } from 'vitest';
import { AdaptiveResolution, presetPixelRatio } from '../src/app/resolution';
import { QUALITY_PRESETS } from '../src/render/systemView';

describe('adaptive resolution', () => {
  it('drops after two slow samples, rises after four fast ones, within its limits', () => {
    const r = new AdaptiveResolution(0.5, 1, 55);
    expect(r.update(30)).toBeUndefined();
    expect(r.update(30)).toBeCloseTo(0.85, 2);
    for (let i = 0; i < 20; i++) r.update(20);
    expect(r.scale).toBe(0.5);
    expect(r.update(60)).toBeUndefined();
    expect(r.update(60)).toBeUndefined();
    expect(r.update(60)).toBeUndefined();
    expect(r.update(60)).toBeCloseTo(0.55, 2);
    for (let i = 0; i < 40; i++) r.update(60);
    expect(r.scale).toBe(1);
    // In between: no change, and a single dip doesn't count.
    expect(r.update(52)).toBeUndefined();
    expect(r.update(40)).toBeUndefined();
    expect(r.update(60)).toBeUndefined();
    expect(r.scale).toBe(1);
  });

  it('Ultra renders above screen resolution, within its cap', () => {
    expect(presetPixelRatio(1, QUALITY_PRESETS.ultra)).toBe(1.5);
    expect(presetPixelRatio(2, QUALITY_PRESETS.ultra)).toBe(3);
    expect(presetPixelRatio(1.25, QUALITY_PRESETS.high)).toBe(1.25);
    expect(presetPixelRatio(3, QUALITY_PRESETS.medium)).toBe(1.5);
  });
});
