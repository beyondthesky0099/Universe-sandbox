import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deltaT, discOverlap, greatestEclipse, groundKm, localCircumstances, type Eclipse } from '../src/sim/eclipse';

const eclipses: Eclipse[] = JSON.parse(readFileSync(new URL('../public/data/eclipses.json', import.meta.url), 'utf8')).eclipses;

describe('solar eclipses', () => {
  it('lists the central eclipses of 2024–2035 from NASA’s catalogue', () => {
    expect(eclipses.length).toBe(18);
    const e = eclipses.find((x) => x.date === '2027-08-02')!;
    expect(e.type).toBe('total');
    expect(e.durationSec).toBe(6 * 60 + 23); // the longest totality on land this century, over Egypt
  });

  for (const e of eclipses) {
    it(`traces the ${e.date} ${e.type} eclipse where NASA puts it`, () => {
      const g = greatestEclipse(e);
      // Time of greatest eclipse (TD) within 2 s, and gamma within 0.0005.
      expect(Math.abs(g.jdTT - e.greatestJdTD) * 86400).toBeLessThan(2);
      expect(Math.abs(g.shadow.gamma - e.gamma)).toBeLessThan(0.0005);
      // Place of greatest eclipse (NASA rounds to whole degrees); NASA's future ΔT differs from today's by a few seconds.
      expect(g.shadow.centre).toBeDefined();
      const dLon = ((g.shadow.centre!.lon - e.lon + 540) % 360) - 180;
      expect(Math.abs(g.shadow.centre!.lat - e.lat)).toBeLessThan(0.75);
      expect(Math.abs(dLon) * Math.cos((e.lat * Math.PI) / 180)).toBeLessThan(0.75);
      // Duration of totality/annularity at that point within 2 s.
      const local = localCircumstances(e, g.shadow.centre!.lat, g.shadow.centre!.lon);
      expect(Math.abs(local.centralSec - e.durationSec)).toBeLessThan(2);
      // Path width within 2% (or 1.5 km, as NASA rounds to whole km); grazing eclipses (|γ| > 0.95, the Sun only ~12° up) within 10%, since
      // the width is measured across the shadow's motion rather than across the track on the ground.
      if (e.widthKm && g.shadow.limits) {
        const tolerance = Math.abs(e.gamma) > 0.95 ? 0.1 : 0.02;
        expect(Math.abs(groundKm(...g.shadow.limits) - e.widthKm)).toBeLessThan(Math.max(1.5, tolerance * e.widthKm));
      }
      expect(deltaT(e)).toBeGreaterThan(60);
    });
  }

  it('computes how much of the Sun is covered', () => {
    expect(discOverlap(1, 1, 3)).toBe(0);
    expect(discOverlap(1, 1.05, 0)).toBe(1);
    expect(discOverlap(1, 0.9, 0)).toBeCloseTo(0.81, 6);
    expect(discOverlap(1, 1, 1)).toBeCloseTo(0.391, 3); // two equal discs one radius apart
  });
});

describe('watching an eclipse from the ground', () => {
  it('puts the Sun high over Egypt with the Moon covering it on 2 August 2027', async () => {
    const { topocentric } = await import('../src/sim/eclipse');
    const e = eclipses.find((x) => x.date === '2027-08-02')!;
    const g = greatestEclipse(e);
    const local = localCircumstances(e, g.shadow.centre!.lat, g.shadow.centre!.lon);
    const t = topocentric(e, local.maxJdTT, g.shadow.centre!.lat, g.shadow.centre!.lon);
    expect(Math.abs(t.sun.alt - e.sunAlt)).toBeLessThan(1); // NASA: Sun 82° up
    expect(t.moon.radius).toBeGreaterThan(t.sun.radius); // the Moon looks bigger: total
    const sep = Math.hypot(t.sun.alt - t.moon.alt, (t.sun.az - t.moon.az) * Math.cos((t.sun.alt * Math.PI) / 180));
    expect(sep).toBeLessThan(0.01);
    expect(local.obscuration).toBe(1);
  });
});
