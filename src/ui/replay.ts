import type { Body, BodyKind } from '../sim/body';
import type { Simulation } from '../sim/simulation';

/**
 * Replays: lightweight recordings of what was on screen (body positions + a subsample of
 * particles) at a fixed rate, independent of the physics. Playable with a scrubber, savable
 * as a file, and exportable to video via the canvas.
 */

export const REPLAY_FPS = 15;
const MAX_PARTICLES = 1500;
const MAX_BYTES = 80 * 1024 * 1024;

interface BodyMeta {
  name: string;
  kind: BodyKind;
  color: number;
  mass: number;
  tag?: string;
}

export interface ReplayFrame {
  /** Simulation time (years). */
  t: number;
  ids: number[];
  /** x, y, z, radius per body. */
  bodies: Float32Array;
  particles: Float32Array;
  colors: Float32Array;
}

export interface Replay {
  name: string;
  meta: Map<number, BodyMeta>;
  frames: ReplayFrame[];
}

export class ReplayRecorder {
  private replay?: Replay;
  private bytes = 0;
  private acc = 0;

  get recording(): boolean {
    return !!this.replay;
  }

  get frameCount(): number {
    return this.replay?.frames.length ?? 0;
  }

  start(name: string): void {
    this.replay = { name, meta: new Map(), frames: [] };
    this.bytes = 0;
    this.acc = 1; // capture immediately
  }

  /** Call every rendered frame; captures at REPLAY_FPS. Returns false if it stopped (memory cap). */
  tick(sim: Simulation, dt: number): boolean {
    const r = this.replay;
    if (!r) return false;
    this.acc += dt;
    if (this.acc < 1 / REPLAY_FPS) return true;
    this.acc = 0;
    const n = sim.bodies.length;
    const bodies = new Float32Array(n * 4);
    const ids: number[] = [];
    sim.bodies.forEach((b, i) => {
      ids.push(b.id);
      bodies.set([b.x, b.y, b.z, b.radius], i * 4);
      const m = r.meta.get(b.id);
      if (!m || m.kind !== b.kind || m.color !== b.color) r.meta.set(b.id, { name: b.name, kind: b.kind, color: b.color, mass: b.mass, tag: b.tag });
    });
    const p = sim.particles;
    const stride = Math.max(1, Math.ceil(p.count / MAX_PARTICLES));
    const m = Math.floor(p.count / stride);
    const particles = new Float32Array(m * 3);
    const colors = new Float32Array(m * 3);
    for (let i = 0; i < m; i++) {
      const k = i * stride * 3;
      particles.set([p.pos[k], p.pos[k + 1], p.pos[k + 2]], i * 3);
      colors.set([p.color[k], p.color[k + 1], p.color[k + 2]], i * 3);
    }
    r.frames.push({ t: sim.time, ids, bodies, particles, colors });
    this.bytes += bodies.byteLength + particles.byteLength * 2 + ids.length * 8;
    return this.bytes < MAX_BYTES;
  }

  stop(): Replay | undefined {
    const r = this.replay;
    this.replay = undefined;
    return r && r.frames.length > 1 ? r : undefined;
  }
}

/** Drive the simulation mirror from a replay (the physics stays paused while playing). */
export class ReplayPlayer {
  readonly replay: Replay;
  position = 0; // fractional frame index
  speed = 1;
  playing = true;
  private readonly cache = new Map<number, Body>();

  constructor(replay: Replay) {
    this.replay = replay;
  }

  get duration(): number {
    return (this.replay.frames.length - 1) / REPLAY_FPS;
  }

  get time(): number {
    return this.position / REPLAY_FPS;
  }

  tick(dt: number): void {
    if (!this.playing) return;
    this.position += dt * REPLAY_FPS * this.speed;
    if (this.position >= this.replay.frames.length - 1) {
      this.position = this.replay.frames.length - 1;
      this.playing = false;
    }
  }

  seek(fraction: number): void {
    this.position = Math.min(1, Math.max(0, fraction)) * (this.replay.frames.length - 1);
  }

  apply(sim: Simulation): void {
    const frames = this.replay.frames;
    const i = Math.min(frames.length - 1, Math.floor(this.position));
    const a = frames[i];
    const b = frames[Math.min(frames.length - 1, i + 1)];
    const f = this.position - i;
    const sameSet = a.ids.length === b.ids.length && a.ids.every((id, k) => b.ids[k] === id);
    const next: Body[] = [];
    a.ids.forEach((id, k) => {
      let body = this.cache.get(id);
      const meta = this.replay.meta.get(id)!;
      if (!body) {
        body = sim.addBodyDetached({ id, name: meta.name, kind: meta.kind, mass: meta.mass, color: meta.color, tag: meta.tag });
        this.cache.set(id, body);
      }
      body.kind = meta.kind;
      body.color = meta.color;
      const o = k * 4;
      const lerp = (j: number) => (sameSet ? a.bodies[o + j] + (b.bodies[o + j] - a.bodies[o + j]) * f : a.bodies[o + j]);
      body.x = lerp(0);
      body.y = lerp(1);
      body.z = lerp(2);
      body.radius = a.bodies[o + 3];
      body.vx = body.vy = body.vz = 0;
      next.push(body);
    });
    sim.bodies = next;
    sim.time = a.t + (b.t - a.t) * f;
    const p = sim.particles;
    const count = Math.min(p.capacity, a.particles.length / 3);
    p.pos.set(a.particles.subarray(0, count * 3));
    p.color.set(a.colors.subarray(0, count * 3));
    p.count = count;
    sim.shockwaves = [];
  }
}

// ---------------------------------------------------------------------------
// Files

function b64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s: string): Float32Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function serializeReplay(r: Replay): string {
  return JSON.stringify({
    app: 'astrarium-replay',
    version: 1,
    name: r.name,
    fps: REPLAY_FPS,
    meta: [...r.meta],
    frames: r.frames.map((f) => ({ t: f.t, ids: f.ids, b: b64(f.bodies), p: b64(f.particles), c: b64(f.colors) })),
  });
}

export function parseReplay(text: string): Replay {
  const data = JSON.parse(text) as {
    app?: string;
    name?: string;
    meta?: [number, BodyMeta][];
    frames?: { t: number; ids: number[]; b: string; p: string; c: string }[];
  };
  if (data.app !== 'astrarium-replay' || !Array.isArray(data.frames) || !Array.isArray(data.meta)) throw new Error('That is not an Astrarium replay.');
  return {
    name: data.name ?? 'Replay',
    meta: new Map(data.meta),
    frames: data.frames.map((f) => ({ t: f.t, ids: f.ids, bodies: unb64(f.b), particles: unb64(f.p), colors: unb64(f.c) })),
  };
}

// ---------------------------------------------------------------------------
// Video

/** Record the WebGL canvas to a WebM video using MediaRecorder. */
export class VideoRecorder {
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];

  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  get active(): boolean {
    return this.recorder?.state === 'recording';
  }

  start(canvas: HTMLCanvasElement): void {
    const stream = canvas.captureStream(30);
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(250);
  }

  /** Stop and resolve with the finished video. */
  stop(): Promise<Blob> {
    const rec = this.recorder;
    if (!rec) return Promise.reject(new Error('Not recording'));
    return new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType || 'video/webm' }));
      rec.stop();
      this.recorder = undefined;
    });
  }
}
