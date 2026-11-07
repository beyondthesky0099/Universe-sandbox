import * as THREE from 'three';
import { mulberry32 } from '../procgen/rng';
import { Noise3D } from './noise';

/**
 * A nebula's survey photograph turned into a 3D cloud of glowing gas.
 *
 * The photograph only shows the nebula as seen from Earth, so its depth is a model: particles are
 * drawn where the picture is bright (more where it is brighter), keep their place and colour in the
 * picture's plane, and are spread along the line of sight through a roughly spheroidal volume
 * (deepest in the middle, thin at the edges, about as deep as the nebula is wide), around a
 * mid-surface warped by smooth noise so that different filaments lie at different depths. Seen
 * from the Sun's direction the cloud looks like the photograph; from anywhere else it has volume
 * and parallax.
 *
 * Stars in the photograph (point sources much brighter than the gas around them) are clipped to the
 * local glow first, so they don't turn into streaks along the line of sight.
 */
export interface VolumeSource {
  /** The image's pixels (RGBA) and its width and height. */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** World-space centre, the picture's width in world units, and its axes: right and up in the
   * picture as seen from Earth, and forward (away from Earth). */
  center: [number, number, number];
  field: number;
  right: [number, number, number];
  up: [number, number, number];
  forward: [number, number, number];
  count: number;
  seed: number;
}

export interface VolumeParticles {
  positions: Float32Array;
  colors: Float32Array;
  /** World-space diameter of each particle. */
  size: number;
  count: number;
  /**
   * The particle opacity that makes the cloud, seen from Earth, as bright as the photograph:
   * each particle is a Gaussian blob of SIZE_PX picture pixels, and particles are spread in
   * proportion to the brightness, so the blobs add up to the picture.
   */
  opacity: number;
}

/** Particle diameter in picture pixels, and the light under its Gaussian profile (exp(−2.2 r²/R²)). */
export const SIZE_PX = 6;
const BLOB_AREA_PX = (Math.PI * (SIZE_PX / 2) ** 2) / 2.2;

/** Sky level and star clipping: the brightness used for each pixel (0–1), with stars removed. */
export function gasBrightness(pixels: Uint8ClampedArray, width: number, height: number): Float32Array {
  const n = width * height;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = (0.3 * pixels[i * 4] + 0.5 * pixels[i * 4 + 1] + 0.2 * pixels[i * 4 + 2]) / 255;
  // Local glow: a box blur over 9×9 pixels (summed-area table).
  const r = 4;
  const sat = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += lum[y * width + x];
      sat[(y + 1) * (width + 1) + x + 1] = sat[y * (width + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(width, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(height, y + r + 1);
      const sum = sat[y1 * (width + 1) + x1] - sat[y0 * (width + 1) + x1] - sat[y1 * (width + 1) + x0] + sat[y0 * (width + 1) + x0];
      const local = sum / ((x1 - x0) * (y1 - y0));
      // A star is a pixel far above its surroundings: clip it to the glow around it.
      const v = Math.min(lum[y * width + x], local * 1.6 + 0.03);
      // Subtract the dark sky.
      out[y * width + x] = Math.max(0, v - 0.05);
    }
  }
  return out;
}

export function volumeParticles(src: VolumeSource): VolumeParticles {
  const { pixels, width, height, count } = src;
  const gas = gasBrightness(pixels, width, height);
  // Cumulative distribution for sampling pixels in proportion to their brightness.
  const cdf = new Float64Array(gas.length);
  let total = 0;
  for (let i = 0; i < gas.length; i++) cdf[i] = total += gas[i];
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const size = (src.field / width) * SIZE_PX;
  if (total <= 0) return { positions, colors, size, count: 0, opacity: 0 };
  const rand = mulberry32(src.seed);
  const noise = new Noise3D(src.seed);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand());
  const [cx, cy, cz] = src.center;
  const [rx, ry, rz] = src.right, [ux, uy, uz] = src.up, [fx, fy, fz] = src.forward;
  for (let k = 0; k < count; k++) {
    // The pixel: binary search of the cumulative brightness.
    const t = rand() * total;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    const px = (lo % width) + rand(), py = Math.floor(lo / width) + rand();
    // Picture coordinates in [-0.5, 0.5], up positive.
    const a = px / width - 0.5, b = 0.5 - py / height;
    const r2 = Math.min(1, (a * a + b * b) * 4);
    // Depth: a spheroid as deep as it is wide, around a noise-warped mid-surface.
    const mid = noise.fbm(a * 2.5, b * 2.5, 0.5, 3) * 0.3;
    const depth = (mid + gauss() * 0.3) * Math.sqrt(1 - r2 * 0.92);
    const ox = a * src.field, oy = b * src.field, oz = depth * src.field;
    positions[k * 3] = cx + rx * ox + ux * oy + fx * oz;
    positions[k * 3 + 1] = cy + ry * ox + uy * oy + fy * oz;
    positions[k * 3 + 2] = cz + rz * ox + uz * oy + fz * oz;
    // The pixel's colour per unit brightness: the density of particles carries the brightness, so
    // together they give back the pixel (red Hα gas stays as red and as bright as in the picture).
    const i = lo * 4;
    const R = pixels[i], G = pixels[i + 1], B = pixels[i + 2];
    const lum = Math.max(0.3 * R + 0.5 * G + 0.2 * B, 8);
    colors[k * 3] = Math.min(4, R / lum);
    colors[k * 3 + 1] = Math.min(4, G / lum);
    colors[k * 3 + 2] = Math.min(4, B / lum);
  }
  return { positions, colors, size, count, opacity: total / (count * BLOB_AREA_PX) };
}

const VERTEX = /* glsl */ `
  attribute vec3 color;
  uniform float uSize;
  uniform float uViewHeight;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 1e-6);
    float px = uSize * projectionMatrix[1][1] * uViewHeight * 0.5 / dist;
    gl_PointSize = clamp(px, 1.0, 96.0);
    // Particles bigger than the cap lose light in proportion, and ones the camera is inside fade out.
    vFade = min(1.0, px / gl_PointSize) * smoothstep(0.0, uSize * 3.0, dist);
    vColor = color;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float a = exp(-d * 2.2) * uOpacity * vFade; // the profile BLOB_AREA_PX assumes
    // Premultiplied: the colour per unit brightness can exceed 1 (saturated Hα red is ~2), which
    // the framebuffer would clamp before blending; times the small opacity it stays in range.
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

/** The particles as a point cloud with soft additive sprites. */
export class NebulaVolume {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  /** The opacity at which the cloud matches its photograph (see VolumeParticles.opacity). */
  readonly fullOpacity: number;

  constructor(p: VolumeParticles) {
    this.fullOpacity = p.opacity;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p.positions.subarray(0, p.count * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(p.colors.subarray(0, p.count * 3), 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uSize: { value: p.size }, uViewHeight: { value: 800 }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3.5;
  }

  set opacity(v: number) {
    this.material.uniforms.uOpacity.value = v;
    this.points.visible = v > 0.002;
  }

  setViewHeight(px: number): void {
    this.material.uniforms.uViewHeight.value = px;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
