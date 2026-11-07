/**
 * Spinning (Kerr) black holes. Lengths are in units of M = GM/c² (half a non-spinning hole's
 * Schwarzschild radius). The spin a* = cJ/(GM²) runs from 0 to just under 1 (accretion can't
 * spin a hole past ~0.998: Thorne 1974).
 *
 * - Event horizon r₊ = 1 + √(1 − a²): 2M without spin, shrinking to 1M at maximal spin.
 * - Innermost stable circular orbit (Bardeen, Press & Teukolsky 1972): 6M without spin, 1.24M
 *   for prograde orbits at a* = 0.998, 9M for retrograde orbits at maximal spin. The accretion
 *   disc's inner edge sits here, so spin lets the gas get closer and hotter.
 * - Radiative efficiency η = 1 − √(1 − 2/(3 r_isco)): the share of the rest-mass energy that
 *   infalling gas radiates away. It is 5.7% without spin and 32% at a* = 0.998, against 0.7% for
 *   hydrogen fusion.
 * - Shadow (Bardeen 1973): the edge of the dark region is set by unstable spherical photon orbits
 *   between r = 2(1 + cos(⅔ arccos(∓a))). Without spin it is a circle of radius √27 M. With spin,
 *   seen from the side, it is flattened on the side turning towards us and shifted the other way.
 * - Final spin of a black-hole merger with spins aligned to the orbit: the fit of Rezzolla et al.
 *   2008 (ApJ 674, L29). Equal non-spinning holes give 0.69 (GW150914 was measured at 0.67).
 */

export const MAX_SPIN = 0.998;
export const SHADOW_RADIUS_SCHWARZSCHILD = Math.sqrt(27);

export function clampSpin(a: number): number {
  return Math.max(-MAX_SPIN, Math.min(MAX_SPIN, a));
}

/** Outer event horizon radius (M). */
export function horizonRadius(a: number): number {
  return 1 + Math.sqrt(Math.max(0, 1 - a * a));
}

/** Innermost stable circular orbit (M), prograde or retrograde. */
export function iscoRadius(a: number, prograde = true): number {
  const s = Math.abs(a);
  const z1 = 1 + Math.cbrt(1 - s * s) * (Math.cbrt(1 + s) + Math.cbrt(1 - s));
  const z2 = Math.sqrt(3 * s * s + z1 * z1);
  const root = Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  return 3 + z2 + (prograde ? -root : root);
}

/** Radii (M) of the prograde and retrograde circular photon orbits in the equatorial plane. */
export function photonOrbits(a: number): [number, number] {
  const s = Math.abs(a);
  return [2 * (1 + Math.cos((2 / 3) * Math.acos(-s))), 2 * (1 + Math.cos((2 / 3) * Math.acos(s)))];
}

/** Fraction of rest-mass energy radiated by gas spiralling in to the ISCO. */
export function radiativeEfficiency(a: number): number {
  return 1 - Math.sqrt(1 - 2 / (3 * iscoRadius(a)));
}

/**
 * The shadow's edge for an observer at inclination `incl` (radians from the spin axis), as points
 * (x, y) in M. x runs towards the side turning towards the observer, y along the projected spin
 * axis.
 */
export function shadowOutline(a: number, incl: number, samples = 400): [number, number][] {
  const s = Math.abs(a);
  if (s < 1e-3) {
    return Array.from({ length: samples }, (_, i) => {
      const t = (i / samples) * Math.PI * 2;
      return [SHADOW_RADIUS_SCHWARZSCHILD * Math.cos(t), SHADOW_RADIUS_SCHWARZSCHILD * Math.sin(t)];
    });
  }
  // Very near the pole the formulas are singular; the shadow is a circle there anyway.
  const th = Math.max(0.03, Math.min(Math.PI / 2, incl));
  const sin = Math.sin(th), cos = Math.cos(th);
  const [r1, r2] = photonOrbits(s);
  const upper: [number, number][] = [];
  for (let i = 0; i <= samples / 2; i++) {
    const r = r1 + ((r2 - r1) * i) / (samples / 2);
    const xi = (r * r * (3 - r) - s * s * (r + 1)) / (s * (r - 1));
    const eta = (r ** 3 * (4 * s * s - r * (r - 3) ** 2)) / (s * s * (r - 1) ** 2);
    const beta2 = eta + s * s * cos * cos - (xi * xi * cos * cos) / (sin * sin);
    if (beta2 < 0) continue;
    // Bardeen's α = −ξ / sin θ is negative on the prograde (approaching) side: flip it so +x is
    // that side.
    upper.push([xi / sin, Math.sqrt(beta2)]);
  }
  const lower = upper.map(([x, y]) => [x, -y] as [number, number]).reverse();
  return [...upper, ...lower];
}

/**
 * The shadow's radius in `bins` directions around the hole (bin k at angle 2πk/bins from +x, the
 * approaching side), relative to the non-spinning shadow's radius √27 M.
 */
export function shadowProfile(a: number, incl: number, bins = 32): Float32Array {
  const out = new Float32Array(bins);
  const pts = shadowOutline(a, incl).map(([x, y]) => ({ ang: Math.atan2(y, x), r: Math.hypot(x, y) }));
  if (pts.length < 8) return out.fill(1);
  pts.sort((p, q) => p.ang - q.ang);
  for (let k = 0; k < bins; k++) {
    let ang = (k / bins) * Math.PI * 2;
    if (ang > Math.PI) ang -= Math.PI * 2;
    // Interpolate between the samples on either side of this direction (wrapping round).
    let j = pts.findIndex((p) => p.ang >= ang);
    if (j === -1) j = 0;
    const hi = pts[j];
    const lo = pts[(j - 1 + pts.length) % pts.length];
    let span = hi.ang - lo.ang;
    if (span <= 0) span += Math.PI * 2;
    let along = ang - lo.ang;
    if (along < 0) along += Math.PI * 2;
    const t = span > 0 ? Math.min(1, along / span) : 0;
    out[k] = (lo.r + (hi.r - lo.r) * t) / SHADOW_RADIUS_SCHWARZSCHILD;
  }
  return out;
}

/**
 * Spin of the black hole left by merging two black holes (masses m1, m2; spins a1, a2 aligned
 * with the orbit, negative if anti-aligned). Rezzolla et al. 2008.
 */
export function mergerSpin(m1: number, m2: number, a1 = 0, a2 = 0): number {
  // Order so that q = m2/m1 ≤ 1.
  if (m2 > m1) [m1, m2, a1, a2] = [m2, m1, a2, a1];
  const q = m2 / m1;
  const nu = q / (1 + q) ** 2;
  const at = (a1 + a2 * q * q) / (1 + q * q);
  const s4 = -0.129, s5 = -0.384, t0 = -2.686, t2 = -3.454, t3 = 2.353;
  const a = at + s4 * at * at * nu + s5 * at * nu * nu + t0 * at * nu + 2 * Math.sqrt(3) * nu + t2 * nu * nu + t3 * nu ** 3;
  return clampSpin(a);
}
