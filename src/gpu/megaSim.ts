import * as THREE from 'three';

/**
 * Massive N-body simulation on the GPU with WebGPU compute shaders: every particle
 * attracts every other (O(N²), tiled through workgroup shared memory), integrated with
 * symplectic Euler and drawn as additive point sprites coloured by speed.
 *
 * Units are arbitrary (G = 1). Runs on its own canvas, independent of the Three.js
 * WebGL renderer.
 */

export type MegaScenario = 'disk' | 'collision' | 'collapse';

const WORKGROUP = 256;

const COMPUTE = /* wgsl */ `
struct Params { n: u32, dt: f32, eps2: f32, g: f32 };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> posIn: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> posOut: array<vec4f>;
var<workgroup> tile: array<vec4f, ${WORKGROUP}>;

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  let i = gid.x;
  var p = vec4f(0.0);
  if (i < params.n) { p = posIn[i]; }
  var acc = vec3f(0.0);
  let tiles = (params.n + ${WORKGROUP}u - 1u) / ${WORKGROUP}u;
  for (var t = 0u; t < tiles; t++) {
    let j = t * ${WORKGROUP}u + lid.x;
    if (j < params.n) { tile[lid.x] = posIn[j]; } else { tile[lid.x] = vec4f(0.0); }
    workgroupBarrier();
    for (var k = 0u; k < ${WORKGROUP}u; k++) {
      let q = tile[k];
      let d = q.xyz - p.xyz;
      let r2 = dot(d, d) + params.eps2;
      let inv = inverseSqrt(r2);
      acc += d * (q.w * inv * inv * inv);
    }
    workgroupBarrier();
  }
  if (i < params.n) {
    let v = vel[i].xyz + acc * (params.g * params.dt);
    vel[i] = vec4f(v, 0.0);
    posOut[i] = vec4f(p.xyz + v * params.dt, p.w);
  }
}
`;

const RENDER = /* wgsl */ `
struct View { viewProj: mat4x4f, size: vec2f, pointSize: f32, speedScale: f32 };
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;

struct Out { @builtin(position) clip: vec4f, @location(0) uv: vec2f, @location(1) color: vec3f };

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
  var corners = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
  let c = corners[vi];
  let p = pos[ii];
  var clip = view.viewProj * vec4f(p.xyz, 1.0);
  clip = vec4f(clip.xy + c * view.pointSize / view.size * clip.w, clip.zw);
  let s = clamp(length(vel[ii].xyz) * view.speedScale, 0.0, 1.0);
  // Slow: warm orange; fast: blue-white.
  let color = mix(vec3f(1.0, 0.55, 0.25), vec3f(0.55, 0.75, 1.0), s);
  var o: Out;
  o.clip = clip;
  o.uv = c;
  o.color = color;
  return o;
}

@fragment
fn fs(in: Out) -> @location(0) vec4f {
  let d = dot(in.uv, in.uv);
  if (d > 1.0) { discard; }
  let a = exp(-d * 3.0) * 0.55;
  return vec4f(in.color * a, a);
}
`;

export interface MegaStats {
  n: number;
  fps: number;
  /** Pairwise interactions evaluated per second. */
  interactionsPerSecond: number;
}

export function webgpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

function gauss(): number {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

/** Initial positions (xyz, mass) and velocities for a scenario. Exported for testing. */
export function initialConditions(n: number, scenario: MegaScenario): { pos: Float32Array<ArrayBuffer>; vel: Float32Array<ArrayBuffer> } {
  const pos = new Float32Array(n * 4);
  const vel = new Float32Array(n * 4);
  const totalMass = 1000;
  const m = totalMass / n;
  const disk = (offset: number, count: number, cx: number, cz: number, vx: number, vz: number, tilt: number) => {
    const radii: number[] = [];
    for (let i = 0; i < count; i++) radii.push(Math.min(60, -Math.log(1 - Math.random()) * 9 + 0.5));
    radii.sort((a, b) => a - b);
    const mass = (totalMass * count) / n;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    for (let i = 0; i < count; i++) {
      const r = radii[i];
      const enclosed = (mass * (i + 1)) / count;
      const v = Math.sqrt(enclosed / Math.sqrt(r * r + 1));
      const th = Math.random() * Math.PI * 2;
      let x = Math.cos(th) * r, y = gauss() * 0.4, z = Math.sin(th) * r;
      let ux = -Math.sin(th) * v + gauss() * v * 0.08, uy = gauss() * v * 0.03, uz = Math.cos(th) * v + gauss() * v * 0.08;
      [y, z] = [y * ct - z * st, y * st + z * ct];
      [uy, uz] = [uy * ct - uz * st, uy * st + uz * ct];
      const k = (offset + i) * 4;
      pos[k] = cx + x;
      pos[k + 1] = y;
      pos[k + 2] = cz + z;
      pos[k + 3] = m;
      vel[k] = vx + ux;
      vel[k + 1] = uy;
      vel[k + 2] = vz + uz;
    }
  };
  if (scenario === 'disk') disk(0, n, 0, 0, 0, 0, 0);
  else if (scenario === 'collision') {
    const half = Math.floor(n / 2);
    disk(0, half, -45, -12, 1.4, 0.4, 0.3);
    disk(half, n - half, 45, 12, -1.4, -0.4, -0.9);
  } else {
    for (let i = 0; i < n; i++) {
      let x, y, z;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
      } while (x * x + y * y + z * z > 1);
      const k = i * 4;
      pos[k] = x * 40;
      pos[k + 1] = y * 40;
      pos[k + 2] = z * 40;
      pos[k + 3] = m;
      // Slight spin so the collapse forms a flattened, rotating structure.
      vel[k] = -z * 0.08;
      vel[k + 2] = x * 0.08;
    }
  }
  return { pos, vel };
}

export class MegaSim {
  /** Held so the adapter (and its instance) stay alive as long as the simulation. */
  adapter?: GPUAdapter;
  private device!: GPUDevice;
  /** Set if the GPU device was lost (driver reset, too much work, …). */
  lostReason?: string;
  onLost?: (reason: string) => void;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private computePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private params!: GPUBuffer;
  private viewBuffer!: GPUBuffer;
  private posBuffers: GPUBuffer[] = [];
  private velBuffer!: GPUBuffer;
  private computeGroups: GPUBindGroup[] = [];
  private renderGroups: GPUBindGroup[] = [];
  private current = 0;
  private n = 0;
  private running = false;
  private frameHandle = 0;
  private yaw = 0.6;
  private pitch = 0.9;
  private distance = 180;
  private frames = 0;
  private fpsTime = performance.now();
  stepsPerFrame = 1;
  dt = 0.02;
  paused = false;
  stats: MegaStats = { n: 0, fps: 0, interactionsPerSecond: 0 };

  constructor(private readonly canvas: HTMLCanvasElement) {}

  async init(): Promise<void> {
    if (!webgpuAvailable()) throw new Error('WebGPU is not available in this browser. Try a recent Chrome, Edge or Safari.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter was found on this device.');
    this.adapter = adapter;
    this.device = await adapter.requestDevice();
    void this.device.lost.then((info) => {
      if (info.reason !== 'destroyed') {
        this.lostReason = info.message || 'unknown';
        console.warn('WebGPU device lost:', info.message);
        this.stop();
        this.onLost?.(this.lostReason);
      }
    });
    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: this.device.createShaderModule({ code: COMPUTE }), entryPoint: 'main' },
    });
    const module = this.device.createShaderModule({ code: RENDER });
    this.renderPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [{ format: this.format, blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } } }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.params = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.viewBuffer = this.device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bindControls();
  }

  /** (Re)create particle buffers for N particles of a scenario. */
  reset(n: number, scenario: MegaScenario): void {
    n = Math.max(WORKGROUP, Math.round(n / WORKGROUP) * WORKGROUP);
    for (const b of [...this.posBuffers, this.velBuffer]) b?.destroy();
    const { pos, vel } = initialConditions(n, scenario);
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.posBuffers = [0, 1].map(() => this.device.createBuffer({ size: pos.byteLength, usage }));
    this.velBuffer = this.device.createBuffer({ size: vel.byteLength, usage });
    this.device.queue.writeBuffer(this.posBuffers[0], 0, pos);
    this.device.queue.writeBuffer(this.posBuffers[1], 0, pos);
    this.device.queue.writeBuffer(this.velBuffer, 0, vel);
    this.computeGroups = [0, 1].map((i) =>
      this.device.createBindGroup({
        layout: this.computePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.params } },
          { binding: 1, resource: { buffer: this.posBuffers[i] } },
          { binding: 2, resource: { buffer: this.velBuffer } },
          { binding: 3, resource: { buffer: this.posBuffers[1 - i] } },
        ],
      }),
    );
    this.renderGroups = [0, 1].map((i) =>
      this.device.createBindGroup({
        layout: this.renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.viewBuffer } },
          { binding: 1, resource: { buffer: this.posBuffers[i] } },
          { binding: 2, resource: { buffer: this.velBuffer } },
        ],
      }),
    );
    this.current = 0;
    this.n = n;
    this.distance = scenario === 'collision' ? 260 : 180;
    const eps = scenario === 'collapse' ? 1.2 : 0.8;
    this.device.queue.writeBuffer(this.params, 0, new Uint32Array([n]));
    this.device.queue.writeBuffer(this.params, 4, new Float32Array([this.dt, eps * eps, 1]));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.frame();
      this.frameHandle = requestAnimationFrame(loop);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  destroy(): void {
    this.stop();
    for (const b of [...this.posBuffers, this.velBuffer, this.params, this.viewBuffer]) b?.destroy();
    this.device?.destroy();
  }

  private frame(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const encoder = this.device.createCommandEncoder();
    if (!this.paused) {
      for (let s = 0; s < this.stepsPerFrame; s++) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.computePipeline);
        pass.setBindGroup(0, this.computeGroups[this.current]);
        pass.dispatchWorkgroups(Math.ceil(this.n / WORKGROUP));
        pass.end();
        this.current = 1 - this.current;
      }
    }
    this.writeView(w, h);
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: { r: 0.008, g: 0.012, b: 0.04, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderGroups[this.current]);
    pass.draw(6, this.n);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    this.frames++;
    const now = performance.now();
    if (now - this.fpsTime > 500) {
      const fps = (this.frames * 1000) / (now - this.fpsTime);
      this.stats = { n: this.n, fps, interactionsPerSecond: this.paused ? 0 : fps * this.stepsPerFrame * this.n * this.n };
      this.frames = 0;
      this.fpsTime = now;
    }
  }

  private writeView(w: number, h: number): void {
    const cam = new THREE.PerspectiveCamera(55, w / Math.max(1, h), 0.5, 5000);
    cam.position.set(
      Math.cos(this.pitch) * Math.sin(this.yaw) * this.distance,
      Math.sin(this.pitch) * this.distance,
      Math.cos(this.pitch) * Math.cos(this.yaw) * this.distance,
    );
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const data = new Float32Array(20);
    data.set(vp.elements, 0);
    data[16] = w;
    data[17] = h;
    data[18] = Math.max(1.5, 3 * (window.devicePixelRatio || 1));
    data[19] = 0.12;
    this.device.queue.writeBuffer(this.viewBuffer, 0, data);
  }

  private bindControls(): void {
    let drag: { x: number; y: number } | undefined;
    this.canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw -= (e.clientX - drag.x) * 0.005;
      this.pitch = Math.min(1.5, Math.max(-1.5, this.pitch + (e.clientY - drag.y) * 0.005));
      drag = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointerup', () => (drag = undefined));
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = Math.min(2000, Math.max(10, this.distance * Math.exp(e.deltaY * 0.001)));
    }, { passive: false });
  }

  /** Read positions back (for tests / debugging). */
  async readPositions(): Promise<Float32Array> {
    const src = this.posBuffers[this.current];
    const staging = this.device.createBuffer({ size: src.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, staging, 0, src.size);
    this.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return out;
  }
}
