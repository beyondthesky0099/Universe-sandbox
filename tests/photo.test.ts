import { describe, expect, it } from 'vitest';
import { captureRatio, gradeFilter, photoFileName } from '../src/ui/photo';

describe('photo mode', () => {
  it('builds the colour grade filter', () => {
    expect(gradeFilter({ exposure: 1, contrast: 1, saturation: 1 })).toBe('none');
    expect(gradeFilter({ exposure: 1.5, contrast: 1, saturation: 0 })).toBe('brightness(1.50) saturate(0.00)');
  });

  it('captures at the asked scale within GPU and memory limits', () => {
    expect(captureRatio(1000, 500, 2, 2, 8192, 1e9)).toBe(4);
    // The long side may not exceed the GPU's limit.
    expect(captureRatio(4000, 2000, 1, 4, 8192, 1e9)).toBeCloseTo(8192 / 4000, 6);
    // Nor the pixel budget.
    const r = captureRatio(1920, 1080, 1, 4, 16384, 16e6);
    expect(1920 * 1080 * r * r).toBeCloseTo(16e6, -3);
  });

  it('names the file after the view and the time', () => {
    const d = new Date(2026, 10, 7, 9, 5, 3);
    expect(photoFileName('Solar System (today)', d)).toBe('astrarium-solar-system-today-2026-11-07-090503.png');
    expect(photoFileName('galaxy', d)).toBe('astrarium-galaxy-2026-11-07-090503.png');
  });
});
