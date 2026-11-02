import type { GwEvent } from './gwEvents';

/**
 * The sound of a gravitational-wave event: the leading-order (quadrupole) inspiral chirp of the
 * real masses, shifted by the source's redshift as the detectors heard it, ending in the
 * ringdown of the final black hole at its fundamental quasi-normal-mode frequency. This is a
 * sonification from the published parameters, not the detector data.
 */

/** Seconds per solar mass: G M☉ / c³. */
export const T_SUN = 4.925490947e-6;

export function chirpMass(m1: number, m2: number): number {
  return Math.pow(m1 * m2, 3 / 5) / Math.pow(m1 + m2, 1 / 5);
}

/** Time (s) left until coalescence when the wave frequency is f (Hz), for a chirp mass in seconds. */
export function timeToMerger(f: number, mcSec: number): number {
  return (5 / 256) * Math.pow(Math.PI * f, -8 / 3) * Math.pow(mcSec, -5 / 3);
}

/** Wave frequency (Hz) with τ seconds left, the inverse of timeToMerger. */
export function frequencyAt(tau: number, mcSec: number): number {
  return (1 / Math.PI) * Math.pow(5 / (256 * tau), 3 / 8) * Math.pow(mcSec, -5 / 8);
}

/** Wave frequency (Hz) at the innermost stable circular orbit of total mass M (seconds). */
export function iscoFrequency(mSec: number): number {
  return 1 / (Math.pow(6, 1.5) * Math.PI * mSec);
}

/** Fundamental (l = m = 2) ringdown frequency (Hz) and damping time (s) of a Kerr black hole (Berti et al. 2006 fits). */
export function ringdown(mFinalSec: number, spin = 0.69): { f: number; tau: number } {
  const f = (1.5251 - 1.1568 * Math.pow(1 - spin, 0.1292)) / (2 * Math.PI * mFinalSec);
  const Q = 0.7 + 1.4187 * Math.pow(1 - spin, -0.499);
  return { f, tau: Q / (Math.PI * f) };
}

/** Redshift for a luminosity distance (Mpc) in flat ΛCDM (Planck 2015: H0 = 67.7, Ωm = 0.307). */
export function redshiftFromDistance(dMpc: number, H0 = 67.7, Om = 0.307): number {
  const c = 299792.458;
  const dl = (z: number) => {
    // Comoving distance by Simpson's rule, then D_L = (1 + z) D_C.
    const n = 200;
    let s = 0;
    for (let i = 0; i <= n; i++) {
      const x = (z * i) / n;
      const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
      s += w / Math.sqrt(Om * (1 + x) ** 3 + 1 - Om);
    }
    return (1 + z) * (c / H0) * (s * z) / (3 * n);
  };
  let lo = 0, hi = 5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (dl(mid) < dMpc) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface Chirp {
  samples: Float32Array;
  sampleRate: number;
  /** Seconds of inspiral included, the start and ISCO frequencies (Hz, as heard), and the ringdown frequency. */
  inspiralSeconds: number;
  fStart: number;
  fIsco: number;
  fRing?: number;
  redshift: number;
}

/**
 * Synthesize an event's chirp as heard on Earth (detector-frame masses), from `fLow` Hz, playing
 * at most `maxSeconds` of the inspiral. `pitch` multiplies every frequency (and shortens time
 * to match) to make low chirps easier to hear on small speakers.
 */
export function synthesizeChirp(e: GwEvent, opts: { sampleRate?: number; fLow?: number; maxSeconds?: number; pitch?: number } = {}): Chirp {
  const sampleRate = opts.sampleRate ?? 44100;
  const pitch = opts.pitch ?? 1;
  const z = e.distanceMpc ? redshiftFromDistance(e.distanceMpc) : 0;
  const m1 = e.m1 * (1 + z), m2 = e.m2 * (1 + z);
  const mc = chirpMass(m1, m2) * T_SUN;
  const mTotal = (m1 + m2) * T_SUN;
  const fIsco = iscoFrequency(mTotal);
  // Neutron stars touch before a final black hole can ring at its natural frequency.
  const blackHoles = e.kind !== 'BNS';
  const ring = blackHoles ? ringdown((e.final ?? 0.95 * (e.m1 + e.m2)) * (1 + z) * T_SUN) : undefined;
  const fEnd = ring ? ring.f : fIsco;
  let fStart = opts.fLow ?? 30;
  const maxSeconds = (opts.maxSeconds ?? 12) * pitch;
  if (timeToMerger(fStart, mc) > maxSeconds) fStart = frequencyAt(maxSeconds, mc);
  const tStart = timeToMerger(fStart, mc);
  const tEnd = timeToMerger(fEnd, mc);
  const inspiral = tStart - tEnd; // seconds of real time, up to the switch to ringdown
  const ringSeconds = ring ? ring.tau * 8 : 0.05;
  const n = Math.ceil(((inspiral + ringSeconds) / pitch) * sampleRate);
  const samples = new Float32Array(n);
  let phase = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const t = (i / sampleRate) * pitch; // real (source-as-heard) time since the start
    let f: number, a: number;
    if (t < inspiral) {
      f = frequencyAt(tStart - t, mc);
      a = Math.pow(f / fEnd, 2 / 3); // strain amplitude grows as f^(2/3)
      last = a;
    } else {
      f = fEnd;
      a = ring ? last * Math.exp(-(t - inspiral) / ring.tau) : last * Math.max(0, 1 - (t - inspiral) / ringSeconds);
    }
    phase += (2 * Math.PI * f * pitch) / sampleRate;
    // Fade in over the first 50 ms to avoid a click.
    const fade = Math.min(1, i / (0.05 * sampleRate));
    samples[i] = 0.8 * a * fade * Math.sin(phase);
  }
  return { samples, sampleRate, inspiralSeconds: inspiral, fStart, fIsco, fRing: ring?.f, redshift: z };
}
