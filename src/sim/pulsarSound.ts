/**
 * What a pulsar sounds like: its radio pulses played as sound, one click per turn, the way radio
 * astronomers listen to them. Slow pulsars tick, the Vela Pulsar (11 a second) buzzes, the Crab
 * (30) growls, and millisecond pulsars (hundreds a second) sing a note.
 *
 * - Each pulse is a narrow Gaussian about 3% of a turn wide: the beam sweeping past (a typical
 *   radio duty cycle; Lyne & Manchester 1988).
 * - Pulses vary from one to the next (log-normal, ±40%), as single pulses do.
 * - A little receiver hiss under it.
 *
 * This is synthesized at the real period, not a recording.
 */
export function pulsarSamples(periodS: number, seconds = 5, sampleRate = 44100, seed = 1): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  let s = (seed * 2654435761) >>> 0 || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  // Pulse width: 3% of a turn, but at least 0.2 ms (so it is a click, not a single sample).
  const sigma = Math.max(0.0002, 0.03 * periodS) / 2.355;
  const half = Math.ceil(sigma * 4 * sampleRate);
  for (let t = rand() * periodS; t < seconds; t += periodS) {
    const amp = Math.exp(0.4 * gauss() - 0.08);
    const c = Math.round(t * sampleRate);
    for (let k = -half; k <= half; k++) {
      const i = c + k;
      if (i < 0 || i >= n) continue;
      const x = k / sampleRate / sigma;
      out[i] += amp * Math.exp(-0.5 * x * x);
    }
  }
  // Remove the average (so the speaker isn't pushed one way), add hiss, normalize, fade in/out.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    out[i] = out[i] - mean + 0.03 * gauss();
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const fade = Math.round(0.05 * sampleRate);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[i] = (out[i] / (peak || 1)) * 0.9 * env;
  }
  return out;
}

/** How a pulsar spinning with this period sounds, in a few words. */
export function soundsLike(periodS: number): string {
  const hz = 1 / periodS;
  if (hz < 4) return `${hz < 1 ? `a tick every ${periodS.toFixed(1)} s` : `${hz.toFixed(1)} ticks a second`}`;
  if (hz < 20) return `a buzz, ${hz.toFixed(0)} pulses a second`;
  if (hz < 60) return `a growl, ${hz.toFixed(0)} pulses a second`;
  return `a hum at ${hz.toFixed(0)} Hz`;
}
