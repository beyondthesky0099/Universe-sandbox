/**
 * Travelling at a chosen speed, from walking pace to the speed of light (and, as a labelled
 * fiction, beyond it): the speeds of real things, trip times in the galaxy's frame ("Earth time")
 * and on board ("ship time", shorter by the Lorentz factor γ), and the time warp that lets a
 * trip play out in seconds.
 */

export const C_KMS = 299792.458;
/** Seconds per Julian year, km per light-year. */
export const YEAR_S = 3.15576e7;
export const LY_KM = C_KMS * YEAR_S;

export interface Speed {
  label: string;
  /** Speed as a multiple of the speed of light. */
  c: number;
  /** Why it's there (shown in the menu's tooltip and the HUD). */
  about?: string;
}

const kms = (v: number) => v / C_KMS;

/** Real speeds, then fractions of light speed, then faster-than-light (not physically possible). */
export const SPEEDS: Speed[] = [
  { label: 'Walking (5 km/h)', c: kms(5 / 3600) },
  { label: 'Car (100 km/h)', c: kms(100 / 3600) },
  { label: 'Airliner (900 km/h)', c: kms(900 / 3600) },
  { label: 'Rifle bullet (1 km/s)', c: kms(1) },
  { label: 'Space station in orbit (7.7 km/s)', c: kms(7.66) },
  { label: 'Escaping Earth (11.2 km/s)', c: kms(11.2) },
  { label: 'Voyager 1 (17 km/s)', c: kms(16.95), about: 'the fastest spacecraft leaving the Solar System' },
  { label: 'Earth around the Sun (30 km/s)', c: kms(29.78) },
  { label: 'Parker Solar Probe (192 km/s)', c: kms(191.7), about: 'the fastest spacecraft, near the Sun in 2024' },
  { label: 'The Sun around the Galaxy (230 km/s)', c: kms(230) },
  { label: 'Fastest known star (1,700 km/s)', c: kms(1755), about: 'S5-HVS1, flung out of the Galactic Centre' },
  { label: '1% of light', c: 0.01 },
  { label: '10% of light', c: 0.1 },
  { label: '20% of light (light-sail probe goal)', c: 0.2, about: 'the speed light-sail probe concepts aim for' },
  { label: '50% of light', c: 0.5 },
  { label: '90% of light', c: 0.9 },
  { label: '99% of light', c: 0.99 },
  { label: '99.9% of light', c: 0.999 },
  { label: '99.99% of light', c: 0.9999 },
  { label: 'Speed of light', c: 1, about: 'only light itself: no time passes for it at all' },
  { label: '10× light (not possible)', c: 10 },
  { label: '1,000× light (not possible)', c: 1000 },
  { label: '1 light-year per second (not possible)', c: YEAR_S },
  { label: '1,000 light-years per second (not possible)', c: 1000 * YEAR_S },
  { label: '1 million light-years per second (not possible)', c: 1e6 * YEAR_S },
  { label: '1 billion light-years per second (not possible)', c: 1e9 * YEAR_S },
];

/** Lorentz factor; Infinity at light speed; undefined above it (no physics there). */
export function lorentz(c: number): number | undefined {
  if (c > 1) return undefined;
  if (c >= 1) return Infinity;
  return 1 / Math.sqrt(1 - c * c);
}

/** Time for a trip of `ly` light-years at `c` (multiple of light speed): in the galaxy's frame, and on board. */
export function tripTimes(ly: number, c: number): { earthYears: number; shipYears: number | undefined } {
  const earthYears = ly / c;
  const g = lorentz(c);
  return { earthYears, shipYears: g === undefined ? undefined : g === Infinity ? 0 : earthYears / g };
}

/** "4.2 years", "3 hours", "12 billion years"… */
export function formatDuration(years: number): string {
  const s = years * YEAR_S;
  if (!Number.isFinite(years)) return '∞';
  if (s < 1) return s < 1e-3 ? `${(s * 1e6).toPrecision(2)} µs` : `${(s * 1e3).toPrecision(3)} ms`;
  if (s < 60) return `${s.toPrecision(3)} s`;
  if (s < 3600) return `${(s / 60).toPrecision(3)} min`;
  if (s < 86400) return `${(s / 3600).toPrecision(3)} hours`;
  if (years < 1) return `${(s / 86400).toPrecision(3)} days`;
  if (years < 1e3) return `${years.toPrecision(3)} years`;
  if (years < 1e6) return `${Math.round(years).toLocaleString('en-US')} years`;
  if (years < 1e9) return `${(years / 1e6).toPrecision(3)} million years`;
  return `${(years / 1e9).toPrecision(3)} billion years`;
}

/** "17 km/s", "0.99 c", "1,000 ly/s"… */
export function formatSpeed(c: number): string {
  if (c >= YEAR_S) return `${(c / YEAR_S).toLocaleString('en-US', { maximumSignificantDigits: 3 })} ly/s`;
  if (c > 1) return `${c.toLocaleString('en-US', { maximumSignificantDigits: 3 })} c`;
  if (c >= 0.01) return `${c.toPrecision(c > 0.99 ? 6 : 3).replace(/0+$/, '').replace(/\.$/, '')} c`;
  const v = c * C_KMS;
  if (v >= 1) return `${v.toLocaleString('en-US', { maximumSignificantDigits: 3 })} km/s`;
  return `${(v * 3600).toLocaleString('en-US', { maximumSignificantDigits: 3 })} km/h`;
}

/**
 * Time warp (galaxy-frame seconds per real second) that makes a trip of `ly` at `c` take about
 * `seconds` of real time; at least 1 (real time).
 */
export function autoWarp(ly: number, c: number, seconds = 25): number {
  return Math.max(1, ((ly / c) * YEAR_S) / seconds);
}

/** The state of a trip in progress. */
export class Trip {
  /** Galaxy-frame and on-board time so far (years), and distance covered (light-years). */
  earthYears = 0;
  shipYears = 0;
  coveredLy = 0;

  constructor(
    /** Speed (multiple of c). */
    public speed: number,
    /** Galaxy-frame seconds per real second. */
    public warp: number,
    /** Distance to go (light-years), or Infinity when cruising with no destination. */
    public remainingLy: number,
  ) {}

  /** Advances by `dt` real seconds; returns the distance moved (light-years) and whether it arrived. */
  step(dt: number): { ly: number; arrived: boolean } {
    const years = (dt * this.warp) / YEAR_S;
    let ly = this.speed * years;
    let arrived = false;
    let used = years;
    if (ly >= this.remainingLy) {
      ly = this.remainingLy;
      used = ly / this.speed;
      arrived = true;
    }
    this.remainingLy -= ly;
    this.coveredLy += ly;
    this.earthYears += used;
    const g = lorentz(this.speed);
    this.shipYears += g === undefined ? used : g === Infinity ? 0 : used / g;
    return { ly, arrived };
  }
}
