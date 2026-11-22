/**
 * The warped water-maser disc of NGC 4258 (M106), the best-measured accretion disc around a
 * supermassive black hole (headless).
 *
 * VLBI maps of its 22 GHz water masers show a thin disc 0.1–0.3 pc from the hole, seen nearly
 * edge-on and in Keplerian rotation, with a warp in both inclination and position angle. The
 * model is the base model of Humphreys et al. 2013 (ApJ 775, 13, Table 3; coordinates from their
 * Appendix A, after Herrnstein et al. 2005, ApJ 629, 719):
 *
 * - Sky frame (X, Y, Z): X east, Y north, Z along the line of sight away from us. A maser at
 *   radius r and disc azimuth φ (from the disc's x-axis, which lies in the sky plane) sits at
 *   X = r(sin Ω cos φ − cos Ω cos i sin φ), Y = r(cos Ω cos φ + sin Ω cos i sin φ), Z = r sin i sin φ.
 * - The warp: i(r) = i₀ + (di/dr) r and Ω(r) = Ω₀ + (dΩ/dr) r + (d²Ω/2dr²) r², r in mas.
 * - The disc rotates about +z, its angular momentum, so φ = 0 recedes (the redshifted
 *   high-velocity masers, east), φ = π approaches (the blueshifted ones, west), and the systemic
 *   masers sit at φ ≈ −π/2, in front of the hole (Z < 0), moving across the sky.
 *
 * The AGN scene (sim/agn.ts, render/agn.ts) works in a local frame whose +z is the spin axis; here
 * that is the disc's normal at the systemic masers, with local x along the disc's x-axis there.
 */
import { mulberry32 } from '../procgen/rng';

export type Vec3 = [number, number, number];

export interface MaserDisc {
  galaxy: string;
  ref: string;
  /** Distance (Mpc), black-hole mass (M☉), systemic velocity (km/s). */
  distanceMpc: number;
  massMsun: number;
  vsys: number;
  /** The warp (degrees, degrees per mas, degrees per mas²). */
  i0: number;
  diDr: number;
  omega0: number;
  dOmegaDr: number;
  d2OmegaDr2: number;
  /** The disc's extent, the systemic masers' radius, and the high-velocity masers' radii (mas). */
  innerMas: number;
  outerMas: number;
  systemicMas: number;
  red: [number, number];
  blue: [number, number];
  /** Bolometric luminosity (erg/s) and its source. */
  lbol: number;
  lbolRef: string;
}

/**
 * NGC 4258. The radii: the disc between 0.1 and 0.3 pc (Humphreys et al. 2013, §5) and the
 * systemic masers in a narrow annulus at 0.14 pc (Herrnstein et al. 2005). The high-velocity
 * masers span the radii where the midline's speed matches the velocities observed, 1,227.5 to
 * 1,647.5 km/s (red) and −516.5 to −280.5 km/s (blue) (Humphreys et al. 2013, Table 1).
 */
export const NGC4258_MASERS: MaserDisc = {
  galaxy: 'NGC 4258',
  ref: 'Humphreys et al. 2013, ApJ 775, 13',
  distanceMpc: 7.6,
  massMsun: 4.0e7,
  vsys: 474.25,
  i0: 71.74,
  diDr: 2.49,
  omega0: 65.46,
  dOmegaDr: 5.23,
  d2OmegaDr2: -0.24,
  innerMas: 2.8,
  outerMas: 8.3,
  systemicMas: 3.85,
  red: [3.29, 8.22],
  blue: [4.69, 8.19],
  lbol: 1e42,
  lbolRef: 'Herrnstein et al. 2005, ApJ 629, 719',
};

/** The maser disc of a galaxy, by any of its names ("NGC 4258", "NGC4258", "M106", "MESSIER106"). */
export function maserDiscFor(name: string): MaserDisc | undefined {
  const n = name.replace(/\s+/g, '').toUpperCase();
  return n === 'NGC4258' || n === 'M106' || n === 'MESSIER106' ? NGC4258_MASERS : undefined;
}

const DEG = Math.PI / 180;
const MAS = DEG / 3.6e6;
const AU_PER_PC = 206264.8;
/** G in pc (km/s)² / M☉. */
const G_PC = 4.3009e-3;

/** Astronomical units per milliarcsecond at the disc's distance (about 7,600 at 7.6 Mpc). */
export function auPerMas(m: Pick<MaserDisc, 'distanceMpc'>): number {
  return m.distanceMpc * 1e6 * MAS * AU_PER_PC;
}

/** Parsecs per milliarcsecond. */
export function pcPerMas(m: Pick<MaserDisc, 'distanceMpc'>): number {
  return m.distanceMpc * 1e6 * MAS;
}

/** Inclination and position angle (radians) of the ring at radius r (mas). */
export function warpAt(m: MaserDisc, rMas: number): { i: number; omega: number } {
  return { i: (m.i0 + m.diDr * rMas) * DEG, omega: (m.omega0 + m.dOmegaDr * rMas + m.d2OmegaDr2 * rMas * rMas) * DEG };
}

/** Circular orbital speed at radius r (km/s). */
export function orbitalSpeed(m: MaserDisc, rMas: number): number {
  return Math.sqrt((G_PC * m.massMsun) / (rMas * pcPerMas(m)));
}

/** Sky position (mas) of the disc at radius r and azimuth φ. */
export function skyPosition(m: MaserDisc, rMas: number, phi: number): Vec3 {
  const { i, omega } = warpAt(m, rMas);
  const c = Math.cos(phi), s = Math.sin(phi);
  return [
    rMas * (Math.sin(omega) * c - Math.cos(omega) * Math.cos(i) * s),
    rMas * (Math.cos(omega) * c + Math.sin(omega) * Math.cos(i) * s),
    rMas * Math.sin(i) * s,
  ];
}

/** Orbital velocity (km/s) in the sky frame; its Z component is the line-of-sight velocity relative to the galaxy. */
export function skyVelocity(m: MaserDisc, rMas: number, phi: number): Vec3 {
  const { i, omega } = warpAt(m, rMas);
  const v = orbitalSpeed(m, rMas);
  const c = Math.cos(phi), s = Math.sin(phi);
  return [
    v * (-Math.sin(omega) * s - Math.cos(omega) * Math.cos(i) * c),
    v * (-Math.cos(omega) * s + Math.sin(omega) * Math.cos(i) * c),
    v * Math.sin(i) * c,
  ];
}

/** The disc's axes at radius r in the sky frame: x (in the sky plane), y, and the normal n (its angular momentum). */
export function discAxes(m: MaserDisc, rMas: number): { x: Vec3; y: Vec3; n: Vec3 } {
  const { i, omega } = warpAt(m, rMas);
  return {
    x: [Math.sin(omega), Math.cos(omega), 0],
    y: [-Math.cos(omega) * Math.cos(i), Math.sin(omega) * Math.cos(i), Math.sin(i)],
    n: [Math.cos(omega) * Math.sin(i), -Math.sin(omega) * Math.sin(i), Math.cos(i)],
  };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A sky-frame vector in the scene's local frame (+z the disc's normal at the systemic masers). */
export function skyToLocal(m: MaserDisc, v: Vec3): Vec3 {
  const { x, y, n } = discAxes(m, m.systemicMas);
  return [dot(v, x), dot(v, y), dot(v, n)];
}

/** The direction from the black hole to Earth in the local frame. */
export function earthDirection(m: MaserDisc): Vec3 {
  return skyToLocal(m, [0, 0, -1]);
}

/** Sky north in the local frame. */
export function northDirection(m: MaserDisc): Vec3 {
  return skyToLocal(m, [0, 1, 0]);
}

export type MaserKind = 'red' | 'blue' | 'systemic';

export interface MaserSpot {
  kind: MaserKind;
  rMas: number;
  phi: number;
  /** Observed line-of-sight velocity (km/s, with the galaxy's own). */
  vObs: number;
  /** Position in the local frame (AU). */
  local: Vec3;
}

/**
 * Maser spots where the surveys find them: high-velocity masers along the disc's midline (φ ≈ 0
 * and π, within a few degrees, where the gas's velocity points along our line of sight), and
 * systemic masers in a narrow arc in front of the hole (φ ≈ −90° ± 4°), where the line of sight
 * runs along the disc and the gain path is longest.
 */
export function maserSpots(m: MaserDisc, counts = { red: 70, blue: 30, systemic: 50 }, seed = 4258): MaserSpot[] {
  const rand = mulberry32(seed);
  const au = auPerMas(m);
  const spots: MaserSpot[] = [];
  const add = (kind: MaserKind, rMas: number, phi: number) => {
    const p = skyPosition(m, rMas, phi);
    spots.push({ kind, rMas, phi, vObs: m.vsys + skyVelocity(m, rMas, phi)[2], local: skyToLocal(m, [p[0] * au, p[1] * au, p[2] * au]) });
  };
  // The redshifted side has more masers than the blueshifted one, as observed.
  for (let k = 0; k < counts.red; k++) add('red', m.red[0] + (m.red[1] - m.red[0]) * rand(), (rand() - 0.5) * 6 * DEG);
  for (let k = 0; k < counts.blue; k++) add('blue', m.blue[0] + (m.blue[1] - m.blue[0]) * rand(), Math.PI + (rand() - 0.5) * 6 * DEG);
  for (let k = 0; k < counts.systemic; k++) add('systemic', m.systemicMas + (rand() - 0.5) * 0.15, -Math.PI / 2 + (rand() - 0.5) * 8 * DEG);
  return spots;
}

/** One sentence of the measured numbers, for the scene tip. */
export function describeMaserDisc(m: MaserDisc): string {
  const pc = pcPerMas(m);
  const [a, b] = [warpAt(m, m.innerMas), warpAt(m, m.outerMas)];
  const vIn = Math.round(orbitalSpeed(m, m.innerMas) / 10) * 10, vOut = Math.round(orbitalSpeed(m, m.outerMas) / 10) * 10;
  return (
    `Water masers map its disc (${m.ref}): gas from ${(m.innerMas * pc).toFixed(2)} to ${(m.outerMas * pc).toFixed(2)} pc out, orbiting at ${vIn.toLocaleString('en-US')} to ${vOut.toLocaleString('en-US')} km/s, ` +
    `warped so that its tilt to us goes from ${Math.round(a.i / DEG)}° to ${Math.round(b.i / DEG)}° and it twists ${Math.round((b.omega - a.omega) / DEG)}° on the sky. ` +
    'The red and blue points on its edges are the high-velocity masers, receding and approaching; the gold ones in front are the systemic masers. ' +
    'They beam their 22 GHz light only towards Earth, so they fade if you fly round. The camera starts where Earth is (north is down). ' +
    `Their orbits weigh the black hole and their drift and acceleration give the galaxy's distance, ${m.distanceMpc} Mpc, a rung of the cosmic distance ladder.`
  );
}
