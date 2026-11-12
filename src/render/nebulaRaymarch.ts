import * as THREE from 'three';
import { mulberry32 } from '../procgen/rng';

/**
 * Nebulae as true volumes, ray-marched on the GPU: for every pixel a ray steps through the
 * nebula's gas, adding the light it emits and losing light to what it absorbs (front to back:
 * L += T·j·ds, T *= e^(−σ·ds)). So dust lanes darken what lies behind them, glowing gas hides
 * behind dust, and the cloud has depth and parallax from every side.
 *
 * - A photographed nebula keeps its photograph as seen from Earth: the picture sets how much gas
 *   lies along each line of sight and its colour; the gas is spread in depth through a spheroid
 *   around a noise-warped mid-surface, broken into filaments by 3D noise, and the dark parts of
 *   the picture inside the nebula become absorbing dust. Its 3D shape is a model (no telescope
 *   sees nebulae in depth), but its look from Earth is the real one.
 * - The others are modelled by type, with their emission-line colours: HII regions are clumpy
 *   clouds with a cavity blown by their stars ([O III] teal inside, Hα red outside, dust lanes);
 *   planetary nebulae are ellipsoidal shells; supernova remnants thin filamentary shells; dark
 *   nebulae absorbing dust; reflection nebulae blue light scattered by dust.
 */

export type NebulaShape = 'photo' | 'hii' | 'pn' | 'snr' | 'dark' | 'refl';
const SHAPE_ID: Record<NebulaShape, number> = { photo: 0, hii: 1, pn: 2, snr: 3, dark: 4, refl: 5 };

/**
 * Tileable 3D noise for the shader, 2 channels × size³ bytes: R is fractal (fBm) value noise,
 * G is "ridged" noise (1 − |2n − 1|, sharpened) for filaments. Periodic over the cube, so the
 * texture repeats without seams.
 */
export function makeNoiseVolume(size = 64, seed = 7): Uint8Array {
  const rand = mulberry32(seed);
  const octaves = [4, 8, 16, 32].filter((p) => p <= size);
  const lattices = octaves.map((p) => Float32Array.from({ length: p * p * p }, () => rand()));
  const out = new Uint8Array(size * size * size * 2);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sample = (lat: Float32Array, p: number, x: number, y: number, z: number) => {
    const fx = (x / size) * p, fy = (y / size) * p, fz = (z / size) * p;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const tx = smooth(fx - ix), ty = smooth(fy - iy), tz = smooth(fz - iz);
    const at = (i: number, j: number, k: number) => lat[(((i % p) + p) % p) + p * ((((j % p) + p) % p) + p * (((k % p) + p) % p))];
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    return lerp(
      lerp(lerp(at(ix, iy, iz), at(ix + 1, iy, iz), tx), lerp(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), tx), ty),
      lerp(lerp(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), tx), lerp(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), tx), ty),
      tz,
    );
  };
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let f = 0, r = 0, amp = 0.5, norm = 0;
        octaves.forEach((p, o) => {
          const n = sample(lattices[o], p, x, y, z);
          f += amp * n;
          r += amp * (1 - Math.abs(2 * n - 1)) ** 2;
          norm += amp;
          amp *= 0.5;
        });
        const k = (x + size * (y + size * z)) * 2;
        out[k] = Math.round(255 * Math.min(1, Math.max(0, (f / norm - 0.5) * 1.6 + 0.5)));
        out[k + 1] = Math.round(255 * Math.min(1, r / norm));
      }
    }
  }
  return out;
}

/**
 * The gas in a photograph, without its stars: a star is a pixel far brighter than the glow
 * around it (9×9 box mean), so it is clipped to that glow; then a light 3×3 blur. RGBA pixels in,
 * RGBA pixels out, same size, rows in the same order.
 */
export function starlessGas(pixels: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = (0.3 * pixels[i * 4] + 0.5 * pixels[i * 4 + 1] + 0.2 * pixels[i * 4 + 2]) / 255;
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += lum[y * w + x];
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
    }
  }
  const clipped = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 4), x1 = Math.min(w, x + 5), y0 = Math.max(0, y - 4), y1 = Math.min(h, y + 5);
      const local = (sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const i = y * w + x;
      const k = lum[i] > 0 ? Math.min(1, (local * 1.5 + 0.02) / lum[i]) : 0;
      for (let c = 0; c < 3; c++) clipped[i * 3 + c] = (pixels[i * 4 + c] / 255) * k;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            sum += clipped[(yy * w + xx) * 3 + c];
            n++;
          }
        }
        out[(y * w + x) * 4 + c] = Math.round((sum / n) * 255);
      }
      out[(y * w + x) * 4 + 3] = 255;
    }
  }
  return out;
}

/** The gas-only picture of one atlas tile as a texture (rows bottom-up, as WebGL samples it). */
function gasTexture(atlas: THREE.Texture, rect: [number, number, number, number]): THREE.DataTexture | undefined {
  const image = atlas.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!image?.width) return undefined;
  const W = image.width, H = image.height;
  const size = Math.round(rect[2] * W);
  const x0 = Math.round(rect[0] * W), y0 = Math.round((1 - rect[1] - rect[3]) * H);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.drawImage(image, x0, y0, size, size, 0, 0, size, size);
  const gas = starlessGas(ctx.getImageData(0, 0, size, size).data, size, size);
  // Flip rows: image rows run top-down, texture rows bottom-up.
  const flipped = new Uint8Array(gas.length);
  for (let y = 0; y < size; y++) flipped.set(gas.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  const tex = new THREE.DataTexture(flipped, size, size, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

let noiseTexture: THREE.Data3DTexture | undefined;
function noise3D(): THREE.Data3DTexture {
  if (noiseTexture) return noiseTexture;
  const size = 64;
  const tex = new THREE.Data3DTexture(makeNoiseVolume(size), size, size, size);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  noiseTexture = tex;
  return tex;
}

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform highp sampler3D uNoise;
  uniform sampler2D uPhoto;
  uniform float uHasPhoto;
  uniform vec3 uCenter;
  uniform float uRadius;
  uniform mat3 uAxes;
  uniform int uShape;
  uniform vec3 uSeed;
  uniform float uOpacity;
  uniform float uSteps;
  varying vec3 vWorld;

  const vec3 OIII = vec3(0.30, 0.95, 0.82);
  const vec3 HALPHA = vec3(1.0, 0.26, 0.34);

  float n3(vec3 p) { return texture(uNoise, p).r; }
  float r3(vec3 p) { return texture(uNoise, p).g; }

  // Emission (light per unit length) and extinction at local point q (|q| < 1 inside).
  void field(vec3 q, out vec3 emit, out float sigma) {
    emit = vec3(0.0);
    sigma = 0.0;
    float r = length(q);
    if (r > 1.0) return;
    vec3 np = q * 0.55 + uSeed;
    // Domain warp, so the noise turns into swirls and filaments rather than blobs.
    vec3 w = vec3(n3(np * 0.6), n3(np * 0.6 + vec3(0.31, 0.17, 0.53)), n3(np * 0.6 + vec3(0.71, 0.43, 0.29))) - 0.5;
    vec3 pw = np + w * 0.35;
    float n = n3(pw);
    float rg = r3(pw * 1.4);
    float edge = 1.0 - smoothstep(0.7, 1.0, r);
    if (uShape == 0) {
      // The photograph (stars removed) sets the gas along each line of sight, as seen from Earth.
      // Where it is read shifts with depth (3D noise), so its features don't stretch into columns.
      vec2 uv = q.xy * 0.5 + 0.5 + w.xy * 0.16 * clamp(abs(q.z) * 2.0, 0.0, 1.0);
      vec3 ph = texture2D(uPhoto, uv).rgb;
      float lum = dot(ph, vec3(0.3, 0.5, 0.2));
      float gas = max(0.0, lum - 0.06);
      float rxy = length(q.xy);
      float h = sqrt(max(0.0, 1.0 - rxy * rxy)) * (0.3 + 0.5 * gas) + 0.03;
      float mid = (n3(vec3(q.xy * 0.4, 0.5) + uSeed) - 0.5) * 1.2 * h;
      float dz = (q.z - mid) / h;
      float prof = exp(-dz * dz * 2.5);
      float detail = 0.3 + 1.4 * n * n + 0.8 * rg * rg;
      float rho = gas * prof * detail / (0.56 * h);
      emit = ph / max(lum, 0.03) * rho;
      // Dark lanes within the nebula: absorbing dust where the picture is dark between bright gas.
      float dust = prof * smoothstep(0.5, 0.8, rg) * (1.0 - smoothstep(0.03, 0.2, gas)) * edge * smoothstep(0.0, 0.08, h - 0.03);
      sigma = 0.7 * rho + 5.0 * dust;
    } else if (uShape == 1) {
      // HII region: a cavity blown by the hot stars, clumpy gas around it; [O III] inside, Hα outside.
      float cavity = smoothstep(0.12, 0.42, r);
      float clump = pow(n, 2.0) * 3.5 + pow(rg, 3.0) * 2.0;
      float rho = cavity * edge * clump;
      emit = mix(OIII * 0.75, HALPHA, smoothstep(0.3, 0.75, r)) * rho * 0.8;
      sigma = 0.5 * rho + 5.0 * edge * smoothstep(0.62, 0.86, rg) * smoothstep(0.45, 0.9, r);
    } else if (uShape == 2) {
      // Planetary nebula: an ellipsoidal shell, [O III] inside and an Hα rim.
      float e = length(q * vec3(1.0, 1.35, 1.0));
      float shell = exp(-pow((e - 0.62) / 0.09, 2.0)) * (0.6 + 0.8 * n);
      float rho = shell + exp(-pow(e / 0.45, 2.0)) * 0.25;
      emit = mix(OIII, HALPHA, smoothstep(0.55, 0.8, e)) * rho * 0.9;
      sigma = 0.3 * rho;
    } else if (uShape == 3) {
      // Supernova remnant: a thin shell of filaments where the blast wave sweeps up gas.
      float shell = exp(-pow((r - 0.86) / 0.05, 2.0));
      float rho = shell * pow(rg, 3.0) * 3.0 + exp(-pow((r - 0.86) / 0.12, 2.0)) * 0.12;
      emit = mix(HALPHA, vec3(0.45, 0.75, 1.0), step(0.55, n)) * rho * 1.6;
      sigma = 0.2 * rho;
    } else if (uShape == 4) {
      // Dark nebula: cold dust that absorbs, faintly lit at its edges.
      // Real dark clouds show in deep images as brownish dust, faintly lit by the Galaxy's starlight.
      float rho = pow(n, 1.5) * edge * 1.6;
      emit = vec3(0.30, 0.20, 0.13) * rho * 2.2;
      sigma = 9.0 * rho;
    } else {
      // Reflection nebula: starlight scattered by dust, bluest near the star.
      float rho = n * edge * (1.0 - r * 0.6);
      emit = vec3(0.45, 0.6, 1.0) * rho * (1.3 - r);
      sigma = 2.5 * rho * smoothstep(0.5, 0.8, rg) + 0.3 * rho;
    }
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);
    vec3 oc = ro - uCenter;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - uRadius * uRadius;
    float disc = b * b - c;
    if (disc <= 0.0) discard;
    float sq = sqrt(disc);
    float t0 = max(-b - sq, 0.0);
    float t1 = -b + sq;
    if (t1 <= 0.0) discard;
    float dt = (t1 - t0) / uSteps;
    // Jitter the start per pixel so the steps don't show as rings.
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float t = t0 + dt * jitter;
    float ds = dt / uRadius;
    mat3 toLocal = transpose(uAxes);
    vec3 L = vec3(0.0);
    float T = 1.0;
    for (int i = 0; i < 128; i++) {
      if (float(i) >= uSteps) break;
      vec3 q = toLocal * (ro + rd * t - uCenter) / uRadius;
      vec3 e;
      float s;
      field(q, e, s);
      float a = exp(-s * ds);
      // Light emitted in this step, as much of it as gets out of the step (∫ e^(−σx) dx).
      L += T * e * (s > 1e-4 ? (1.0 - a) / s : ds);
      T *= a;
      if (T < 0.01) break;
      t += dt;
    }
    if (uShape == 2) {
      // The planetary nebula's central star: the hot white-dwarf core that lights the shell. It is
      // a point, so it is drawn from how close the ray passes to the centre, not by the steps.
      float miss = length(oc - rd * dot(oc, rd)) / uRadius;
      L += T * vec3(0.85, 0.92, 1.0) * (exp(-pow(miss / 0.01, 2.0)) * 2.0 + exp(-miss / 0.025) * 0.12);
    }
    // Premultiplied: the background is dimmed by the transmittance T.
    gl_FragColor = vec4(L * uOpacity, (1.0 - T) * uOpacity);
  }
`;

export interface NebulaVolumeSpec {
  center: [number, number, number];
  /** Radius of the volume (world units). */
  radius: number;
  shape: NebulaShape;
  seed: number;
  /** Photographed nebulae: the atlas, the picture's rectangle in it (texture space), and its axes
   * (right, up as seen from Earth; forward away from Earth). The picture spans the volume's width;
   * its stars are removed before use (starlessGas). */
  photo?: { atlas: THREE.Texture; rect: [number, number, number, number] };
  axes?: { right: [number, number, number]; up: [number, number, number]; forward: [number, number, number] };
}

export class NebulaRaymarch {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly gas?: THREE.DataTexture;

  constructor(spec: NebulaVolumeSpec, steps: number) {
    this.gas = spec.photo ? gasTexture(spec.photo.atlas, spec.photo.rect) : undefined;
    const rand = mulberry32(spec.seed);
    const ax = spec.axes ?? { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uNoise: { value: noise3D() },
        uPhoto: { value: this.gas ?? null },
        uHasPhoto: { value: this.gas ? 1 : 0 },
        uCenter: { value: new THREE.Vector3(...spec.center) },
        uRadius: { value: spec.radius },
        uAxes: { value: new THREE.Matrix3().set(ax.right[0], ax.up[0], ax.forward[0], ax.right[1], ax.up[1], ax.forward[1], ax.right[2], ax.up[2], ax.forward[2]) },
        // Without a usable picture, fall back to the type's own model.
        uShape: { value: SHAPE_ID[this.gas ? 'photo' : spec.shape === 'photo' ? 'hii' : spec.shape] },
        uSeed: { value: new THREE.Vector3(rand(), rand(), rand()) },
        uOpacity: { value: 0 },
        uSteps: { value: steps },
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.material);
    this.mesh.position.set(...spec.center);
    this.mesh.scale.setScalar(spec.radius);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3.5;
  }

  set opacity(v: number) {
    this.material.uniforms.uOpacity.value = v;
    this.mesh.visible = v > 0.002;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.gas?.dispose();
  }
}
