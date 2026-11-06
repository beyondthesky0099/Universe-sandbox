import { describe, expect, it } from 'vitest';
import { addOrbiting } from '../src/sim/presets';
import { Simulation } from '../src/sim/simulation';
import { EARTH_MASS, JUPITER_MASS } from '../src/sim/units';
import {
  arnettLuminosity, blastOnBody, bolometricMagnitude, coreCollapse, decayPower, L_SUN, luminosity, maxEjectaSpeed,
  neutronStarKick, plateau, remnantRadiusPc, thermonuclear,
} from '../src/sim/supernovaPhysics';

describe('supernova physics', () => {
  it('throws ejecta at thousands of km/s, not hundreds', () => {
    // 10⁵¹ erg in ~13 M☉ of ejecta: fastest ~4,000 km/s; a Type Ia's 1.4 M☉: ~13,000 km/s.
    expect(maxEjectaSpeed(coreCollapse(15, 1.4))).toBeGreaterThan(3000);
    expect(maxEjectaSpeed(coreCollapse(15, 1.4))).toBeLessThan(5500);
    expect(maxEjectaSpeed(thermonuclear())).toBeGreaterThan(10000);
    expect(maxEjectaSpeed(thermonuclear())).toBeLessThan(16000);
  });

  it('fades at the cobalt-56 rate: 0.98 magnitudes per 100 days', () => {
    const a = decayPower(0.07, 200), b = decayPower(0.07, 300);
    expect(2.5 * Math.log10(a / b)).toBeCloseTo(0.98, 1);
  });

  it('gives a Type Ia its observed peak: ~10⁴³ erg/s about 17–20 days after explosion', () => {
    const ia = thermonuclear();
    let peak = { days: 0, lum: 0 };
    for (let d = 1; d < 60; d += 0.25) {
      const l = arnettLuminosity(ia, d);
      if (l > peak.lum) peak = { days: d, lum: l };
    }
    expect(peak.days).toBeGreaterThan(14);
    expect(peak.days).toBeLessThan(22);
    expect(peak.lum).toBeGreaterThan(1.0e43);
    expect(peak.lum).toBeLessThan(1.8e43);
    expect(bolometricMagnitude(peak.lum)).toBeLessThan(-18.8); // about −19, the standard candle
  });

  it('gives a Type II-P its ~100-day plateau near magnitude −16 to −17', () => {
    const ii = coreCollapse(15, 1.4);
    const p = plateau(ii);
    expect(p.days).toBeGreaterThan(80);
    expect(p.days).toBeLessThan(140);
    const mag = bolometricMagnitude(luminosity(ii, 50));
    expect(mag).toBeLessThan(-15.5);
    expect(mag).toBeGreaterThan(-17.5);
    // After the plateau it drops onto the radioactive tail.
    expect(luminosity(ii, 250)).toBeCloseTo(decayPower(ii.nickelMass, 250), -38);
    expect(luminosity(ii, 50) / L_SUN).toBeGreaterThan(1e8); // a hundred million Suns
  });

  it('grows the remnant like a Sedov–Taylor blast wave: 12.5 pc after 10,000 years in 1 atom/cm³', () => {
    expect(remnantRadiusPc(coreCollapse(15, 1.4), 1e4)).toBeCloseTo(12.5, 0);
    // Early on it coasts: ~4,000 km/s for the first decades.
    expect(remnantRadiusPc(coreCollapse(15, 1.4), 10)).toBeGreaterThan(0.03);
    // After shell formation (~36,000 yr) it slows to R ∝ t^(2/7).
    const r1 = remnantRadiusPc(coreCollapse(15, 1.4), 1e5), r2 = remnantRadiusPc(coreCollapse(15, 1.4), 2e5);
    expect(Math.log(r2 / r1) / Math.log(2)).toBeCloseTo(2 / 7, 2);
  });

  it('destroys an Earth at 1 AU but not at 1,000 AU', () => {
    const e = coreCollapse(15, 1.4);
    const earthMass = 3.003e-6, earthRadius = 4.26e-5;
    expect(blastOnBody(e, 1, earthMass, earthRadius).destroyed).toBe(true);
    expect(blastOnBody(e, 1000, earthMass, earthRadius).destroyed).toBe(false);
  });

  it('kicks neutron stars at a few hundred km/s on average', () => {
    let rng = 7;
    const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += Math.hypot(...neutronStarKick(rand));
    expect(sum / 4000).toBeGreaterThan(380); // Maxwellian mean 2σ√(2/π) ≈ 423 km/s
    expect(sum / 4000).toBeLessThan(460);
  });
});

describe('supernovae in the simulation', () => {
  const setup = () => {
    const sim = new Simulation();
    const star = sim.addBody({ name: 'Star', kind: 'giant', mass: 15 });
    const rocky = addOrbiting(sim, star, { name: 'Rock', mass: EARTH_MASS, kind: 'rocky' }, { a: 5 });
    const gas = addOrbiting(sim, star, { name: 'Gas', mass: JUPITER_MASS, kind: 'gas' }, { a: 25 });
    return { sim, star, rocky, gas };
  };

  it('throws ejecta out at the real speeds and leaves a kicked neutron star', () => {
    const { sim, star } = setup();
    const v0 = Math.hypot(star.vx, star.vy, star.vz);
    expect(sim.supernova(star)).toBe(true);
    expect(star.kind).toBe('neutron');
    const p = sim.particles;
    let vmax = 0;
    for (let i = 0; i < p.count; i++) vmax = Math.max(vmax, Math.hypot(p.vel[i * 3] - star.vx, p.vel[i * 3 + 1], p.vel[i * 3 + 2]));
    // ~3,500 km/s for 13.6 M☉ of ejecta and 10⁵¹ erg (AU/yr × 4.74 = km/s); the kick shifts it a little.
    expect(vmax * 4.7406).toBeGreaterThan(2500);
    expect(vmax * 4.7406).toBeLessThan(5000);
    expect(Math.hypot(star.vx, star.vy, star.vz) * 4.7406).toBeGreaterThan(v0 * 4.7406 + 1);
  });

  it('the blast wave grows at the free-expansion speed, destroys the close rocky planet and spares the gas giant', () => {
    const { sim, star, rocky, gas } = setup();
    sim.supernova(star);
    sim.advance(0.1, 1e6, 1e9);
    const w = sim.shockwaves[0];
    expect(w.explosion?.type).toBe('II');
    // 0.1 yr × ~740 AU/yr.
    expect(w.radius).toBeGreaterThan(60);
    expect(w.radius).toBeLessThan(90);
    expect(sim.bodies).not.toContain(rocky);
    expect(sim.events.some((e) => e.type === 'disrupt' && e.message.includes('Rock'))).toBe(true);
    expect(sim.bodies).toContain(gas);
  });

  it('white dwarfs past the Chandrasekhar limit explode as Type Ia', () => {
    const sim = new Simulation();
    sim.addBody({ name: 'WD', kind: 'whitedwarf', mass: 1.3 });
    sim.addBody({ name: 'Donor', kind: 'whitedwarf', mass: 0.3, x: 0.0002, vz: 0 });
    for (let i = 0; i < 200 && sim.bodies.length > 0 && !sim.events.some((e) => e.type === 'supernova'); i++) sim.advance(1e-5, 1e6, 1e9);
    const sn = sim.shockwaves.find((w) => w.explosion);
    expect(sn?.explosion?.type).toBe('Ia');
    expect(sim.bodies.length).toBe(0);
  });
});
