import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { moonPosition, skyAt, starAltAz } from '../src/sim/sky';

interface Row { site: string; lat: number; lon: number; time: string; body: string; az: number; alt: number; illumination: number }
const ref: Row[] = JSON.parse(readFileSync(new URL('./fixtures/sky-reference.json', import.meta.url), 'utf8')).rows;
const DEG = Math.PI / 180;

/** Angle between two alt/az directions (degrees). */
function separation(a: { alt: number; az: number }, b: { alt: number; az: number }): number {
  const c = Math.sin(a.alt * DEG) * Math.sin(b.alt * DEG) + Math.cos(a.alt * DEG) * Math.cos(b.alt * DEG) * Math.cos((a.az - b.az) * DEG);
  return Math.acos(Math.min(1, c)) / DEG;
}

describe('planetarium sky', () => {
  it('matches JPL Horizons for the Sun, Moon and planets at three sites and four times', () => {
    for (const r of ref) {
      const sky = skyAt(new Date(r.time), { lat: r.lat, lon: r.lon });
      const o = sky.objects.find((x) => x.name === r.body)!;
      const sep = separation(o, r);
      // Measured worst cases: Sun 0.25′, Moon 0.4′, Mercury–Mars and Uranus–Neptune under 1′.
      // Jupiter and Saturn use JPL's approximate elements, whose stated errors reach about 10′.
      const limit = { Sun: 0.02, Moon: 0.05, Jupiter: 0.1, Saturn: 0.2 }[r.body] ?? 0.05;
      expect(sep, `${r.body} at ${r.site} ${r.time}`).toBeLessThan(limit);
    }
  });

  it('gets the Moon’s phase right', () => {
    for (const r of ref.filter((x) => x.body === 'Moon' && x.site === 'Greenwich')) {
      const sky = skyAt(new Date(r.time), { lat: r.lat, lon: r.lon });
      expect(Math.abs(sky.moonIllumination * 100 - r.illumination), r.time).toBeLessThan(1.5);
    }
  });

  it('reproduces Meeus’s worked example for the Moon (1992 April 12, 0h TD)', () => {
    // Meeus, Astronomical Algorithms, example 47.a: λ = 133.162655°, β = −3.229126°, Δ = 368409.7 km.
    const m = moonPosition(2448724.5);
    expect(m.lon).toBeCloseTo(133.1627, 2);
    expect(m.lat).toBeCloseTo(-3.2291, 2);
    expect(Math.abs(m.km - 368409.7)).toBeLessThan(20);
  });

  it('puts Polaris at the observer’s latitude above the north horizon', () => {
    // Polaris, J2000 ecliptic unit vector from RA 37.95°, Dec +89.264°.
    const ra = 37.954 * DEG, dec = 89.264 * DEG, eps = 23.4393 * DEG;
    const x = Math.cos(dec) * Math.cos(ra), y = Math.cos(dec) * Math.sin(ra), z = Math.sin(dec);
    const v: [number, number, number] = [x, y * Math.cos(eps) + z * Math.sin(eps), -y * Math.sin(eps) + z * Math.cos(eps)];
    for (const hour of [0, 6, 12, 18]) {
      const date = new Date(Date.UTC(2026, 10, 1, hour));
      const obs = { lat: 51.48, lon: 0 };
      const p = starAltAz(v, skyAt(date, obs), obs);
      expect(Math.abs(p.alt - 51.48)).toBeLessThan(1); // within its 0.7° circle around the pole
      expect(Math.min(p.az, 360 - p.az)).toBeLessThan(1.5);
    }
  });
});

describe('sky rotation matrix', () => {
  it('moves stars exactly as the per-star calculation does', async () => {
    const { skyMatrix, altAzToScene } = await import('../src/sim/sky');
    const obs = { lat: -33.87, lon: 151.21 };
    const snap = skyAt(new Date('2027-03-15T10:00:00Z'), obs);
    const m = skyMatrix(snap, obs);
    for (const v of [[1, 0, 0], [0.3, -0.5, 0.81], [-0.2, 0.9, -0.38]] as [number, number, number][]) {
      const n = Math.hypot(...v);
      const u = v.map((c) => c / n) as [number, number, number];
      const p = starAltAz(u, snap, obs);
      const want = altAzToScene(p.alt, p.az);
      const got = [0, 1, 2].map((r) => m[r * 3] * u[0] + m[r * 3 + 1] * u[1] + m[r * 3 + 2] * u[2]);
      got.forEach((g, k) => expect(g).toBeCloseTo(want[k], 9));
    }
  });
});
