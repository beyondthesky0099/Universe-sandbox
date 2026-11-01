import type { SimEventType } from './sim/simulation';

/**
 * Procedural sound: a slowly breathing ambient drone and synthesized impact effects.
 * No audio files: everything is built from oscillators and filtered noise. The
 * AudioContext is created lazily on the first user gesture (browser autoplay rules).
 */
export class AudioEngine {
  private ctx?: AudioContext;
  private master?: GainNode;
  private sfx?: GainNode;
  private noise?: AudioBuffer;
  private enabled = false;
  private lastPlayed = new Map<string, number>();

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.ensure();
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(on ? 0.8 : 0, t, 0.3);
      if (on) void this.ctx.resume();
    }
  }

  private ensure(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.7;
    this.sfx.connect(this.master);

    // White noise buffer shared by effects.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startDrone();
  }

  private startDrone(): void {
    const ctx = this.ctx!;
    const drone = ctx.createGain();
    drone.gain.value = 0.06;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 3;
    filter.connect(drone);
    drone.connect(this.master!);
    // Two slightly detuned low fifths.
    for (const [freq, detune] of [[55, -4], [55, 5], [82.5, 2], [110, -7]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = freq > 100 ? 0.12 : 0.25;
      osc.connect(g).connect(filter);
      osc.start();
    }
    // Slow LFO sweeping the filter makes the drone "breathe".
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    // Airy noise layer.
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900;
    band.Q.value = 0.7;
    const air = ctx.createGain();
    air.gain.value = 0.015;
    src.connect(band).connect(air).connect(this.master!);
    src.start();
  }

  private rateLimit(key: string, minGapMs: number): boolean {
    const now = performance.now();
    if (now - (this.lastPlayed.get(key) ?? 0) < minGapMs) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  private noiseBurst(duration: number, freq: number, endFreq: number, gain: number, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f).connect(g).connect(this.sfx!);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  private tone(freq: number, endFreq: number, duration: number, gain: number, type: OscillatorType = 'sine', attack = 0.005): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(10, endFreq), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.sfx!);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /** Sound for a simulation event. `size` (AU) scales loudness. */
  play(type: SimEventType, size = 0.05): void {
    if (!this.enabled || !this.ctx) return;
    const loud = Math.min(1, 0.35 + Math.log10(1 + size * 20) * 0.4);
    switch (type) {
      case 'merge':
        if (!this.rateLimit(type, 120)) return;
        this.noiseBurst(0.5, 900, 60, 0.35 * loud);
        this.tone(90, 40, 0.4, 0.25 * loud);
        break;
      case 'shatter':
        if (!this.rateLimit(type, 200)) return;
        this.noiseBurst(0.9, 3000, 200, 0.4 * loud, 'bandpass');
        this.noiseBurst(0.6, 600, 50, 0.4 * loud);
        break;
      case 'disrupt':
        if (!this.rateLimit(type, 400)) return;
        this.noiseBurst(2.2, 200, 2500, 0.3, 'bandpass');
        this.tone(160, 60, 2, 0.12, 'triangle', 0.4);
        break;
      case 'ignite':
        if (!this.rateLimit(type, 400)) return;
        for (const [f, d] of [[440, 1.6], [660, 1.9], [880, 2.2]] as const) this.tone(f, f * 1.01, d, 0.08, 'sine', 0.08);
        break;
      case 'collapse':
        if (!this.rateLimit(type, 400)) return;
        this.tone(70, 20, 3, 0.45, 'sine', 0.02);
        this.noiseBurst(2.5, 300, 30, 0.3);
        break;
      case 'supernova':
        if (!this.rateLimit(type, 600)) return;
        this.noiseBurst(4.5, 5000, 40, 0.7);
        this.tone(60, 18, 5, 0.6, 'sine', 0.01);
        this.noiseBurst(6, 120, 30, 0.3, 'lowpass');
        break;
    }
  }

  /** Subtle UI tick. */
  click(): void {
    if (!this.enabled || !this.ctx || !this.rateLimit('click', 40)) return;
    this.tone(1800, 1200, 0.05, 0.03, 'sine', 0.002);
  }
}
