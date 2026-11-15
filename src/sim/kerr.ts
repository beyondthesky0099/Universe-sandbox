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
/**
 * Tilt (rad, about x) of every black hole's spin axis, shared by the drawn disc (BodyVisual),
 * the torus and jets of an active nucleus, and the frame dragging in the simulation: the axis is
 * (0, cos DISC_TILT, sin DISC_TILT).
 */
export const DISC_TILT = 0.25;
export const SPIN_AXIS: readonly [number, number, number] = [0, Math.cos(DISC_TILT), Math.sin(DISC_TILT)];

/** Angular momentum J = a* G M² / c of a spinning hole (in the units of G, M and c given). */
export function spinAngularMomentum(spin: number, mass: number, g: number, c: number): number {
  return (spin * g * mass * mass) / c;
}

/**
 * Lense–Thirring (frame-dragging) nodal precession rate of an orbit of semi-major axis a and
 * eccentricity e around a hole of angular momentum J: Ω̇ = 2 G J / (c² a³ (1 − e²)^{3/2}),
 * prograde about the spin, whatever the inclination.
 */
export function lenseThirringNodeRate(J: number, a: number, e: number, g: number, c: number): number {
  return (2 * g * J) / (c * c * a * a * a * Math.pow(1 - e * e, 1.5));
}
export const SHADOW_RADIUS_SCHWARZSCHILD = Math.sqrt(27);
/** The shadow's radius over the Schwarzschild radius: √27 M / 2M ≈ 2.6. */
export const SHADOW_PER_SCHWARZSCHILD = Math.sqrt(27) / 2;

/**
 * The radius to draw the shadow at. With real sizes a black hole's body radius is its
 * Schwarzschild radius (body.ts), and the dark disc on the sky is 2.6 times wider than that;
 * with game sizes the radius is arbitrary and stands for the shadow itself.
 */
export function drawnShadowRadius(bodyRadius: number, trueScale: boolean): number {
  return trueScale ? bodyRadius * SHADOW_PER_SCHWARZSCHILD : bodyRadius;
}

/**
 * The Einstein radius (radians) of a black hole seen from `distance`, for light from far behind
 * it: θ_E = √(4GM / (c² D)) = √(2 R_s / D). The shadow is what the renderer knows, so the
 * Schwarzschild radius is taken as shadow / 2.6. The ring is far outside the shadow from any
 * distance: 17 shadow radii from 1,000 Schwarzschild radii away, 2.2 from 17 away.
 */
export function einsteinRadius(shadowRadius: number, distance: number): number {
  const rs = shadowRadius / SHADOW_PER_SCHWARZSCHILD;
  return Math.sqrt((2 * rs) / Math.max(distance, 3.5 * rs));
}

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
