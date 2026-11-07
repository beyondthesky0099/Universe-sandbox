import * as THREE from 'three';
import { mulberry32 } from '../procgen/rng';
import { Noise3D } from './noise';

/**
 * Nebulae as glowing clouds at their true physical size, drawn as camera-facing quads (one GPU
 * instance each). A cloud either shows a real survey image (a tile of the nebula-image atlas) or,
 * for the thousands without one, a puff of turbulent gas tinted by its emission-line colour;
 * those are built from a few overlapping puffs so they have depth as you orbit them.
 */
export interface Cloud {
  pos: [number, number, number];
  /** Diameter in world units (true size). */
  size: number;
  color: [number, number, number];
  /** Atlas rectangle [u, v, w, h] of a real image, or undefined for a procedural puff. */
  tile?: [number, number, number, number];
  /** Never drawn smaller than this many pixels across. */
  minPx: number;
  brightness: number;
  rotation: number;
  /** Which of the four procedural puff shapes. */
  puff: number;
}

/** Four 128-pixel puffs of fractal noise in a 2×2 atlas (white; tinted per cloud). */
function puffAtlas(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * 2;
  const ctx = canvas.getContext('2d')!;
  for (let p = 0; p < 4; p++) {
    const img = ctx.createImageData(size, size);
    const n = new Noise3D(1000 + p * 77);
    const ox = mulberry32(p + 5)() * 100;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = i / size - 0.5, y = j / size - 0.5;
        const r = Math.hypot(x, y) * 2;
        const v = n.fbm(x * 3.2 + ox, y * 3.2, ox, 5) * 0.5 + 0.5;
        const a = Math.max(0, 1 - r) ** 1.4 * Math.max(0, v * 1.7 - 0.5);
        const k = (j * size + i) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
        img.data[k + 3] = Math.min(255, a * 300);
      }
    }
    ctx.putImageData(img, (p % 2) * size, Math.floor(p / 2) * size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const VERTEX = /* glsl */ `
  attribute vec3 iCenter;
  attribute float iSize;
  attribute vec3 iColor;
  attribute vec4 iTile;
  attribute vec3 iParams; // min pixels, brightness, rotation
  attribute float iPuff;
  uniform float uViewHeight;
  uniform float uSizeScale;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec4 vTile;
  varying float vBright;
  varying float vPuff;
  void main() {
    vec4 mv = modelViewMatrix * vec4(iCenter, 1.0);
    float dist = max(-mv.z, 1e-6);
    float pxPerUnit = projectionMatrix[1][1] * uViewHeight * 0.5 / dist;
    float trueSize = iSize * uSizeScale;
    float size = max(trueSize, iParams.x / pxPerUnit);
    // Clouds enlarged to stay visible from afar are dimmed in proportion.
    vBright = iParams.y * mix(1.0, sqrt(trueSize / size), 0.7);
    float c = cos(iParams.z), s = sin(iParams.z);
    vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
    mv.xy += corner * size;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy + 0.5;
    vColor = iColor;
    vTile = iTile;
    vPuff = iPuff;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform sampler2D uPuffs;
  uniform float uOpacity;
  uniform float uAbsorb;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec4 vTile;
  varying float vBright;
  varying float vPuff;
  void main() {
    vec3 rgb;
    if (uAbsorb > 0.5) {
      // Dust: dims what lies behind it (normal blending), faintly tinted by its own colour.
      vec2 cell = vec2(mod(vPuff, 2.0), floor(vPuff / 2.0)) * 0.5;
      float a = texture2D(uPuffs, cell + vUv * 0.5).a * vBright * uOpacity;
      if (a < 0.01) discard;
      gl_FragColor = vec4(vColor * 0.06, min(a, 0.92));
      return;
    }
    if (vTile.z > 0.0) {
      rgb = texture2D(uAtlas, vTile.xy + vUv * vTile.zw).rgb;
    } else {
      vec2 cell = vec2(mod(vPuff, 2.0), floor(vPuff / 2.0)) * 0.5;
      rgb = vColor * texture2D(uPuffs, cell + vUv * 0.5).a;
    }
    rgb *= vBright * uOpacity;
    if (max(rgb.r, max(rgb.g, rgb.b)) < 0.003) discard;
    gl_FragColor = vec4(rgb, 1.0);
  }
`;

export class NebulaClouds {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly puffs = puffAtlas();

  /** `absorb`: dark dust clouds that dim the light behind them instead of glowing. */
  constructor(clouds: Cloud[], atlas?: THREE.Texture, absorb = false) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const n = clouds.length;
    const center = new Float32Array(n * 3), size = new Float32Array(n), color = new Float32Array(n * 3);
    const tile = new Float32Array(n * 4), params = new Float32Array(n * 3), puff = new Float32Array(n);
    clouds.forEach((c, i) => {
      center.set(c.pos, i * 3);
      size[i] = c.size;
      color.set(c.color, i * 3);
      tile.set(c.tile && atlas ? c.tile : [0, 0, 0, 0], i * 4);
      params.set([c.minPx, c.brightness, c.rotation], i * 3);
      puff[i] = c.puff % 4;
    });
    geo.setAttribute('iCenter', new THREE.InstancedBufferAttribute(center, 3));
    geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(size, 1));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(color, 3));
    geo.setAttribute('iTile', new THREE.InstancedBufferAttribute(tile, 4));
    geo.setAttribute('iParams', new THREE.InstancedBufferAttribute(params, 3));
    geo.setAttribute('iPuff', new THREE.InstancedBufferAttribute(puff, 1));
    geo.instanceCount = n;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uAtlas: { value: atlas ?? this.puffs }, uPuffs: { value: this.puffs }, uOpacity: { value: 1 }, uViewHeight: { value: 800 }, uSizeScale: { value: 1 }, uAbsorb: { value: absorb ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: absorb ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
  }

  /** Viewport height in device pixels (for the minimum on-screen size). */
  setViewHeight(px: number): void {
    this.material.uniforms.uViewHeight.value = px;
  }

  /**
   * Place the whole cloud: clouds were given in local units; this centres them on `center` and
   * scales positions and sizes by `scale` (a homologous expansion), at `opacity`.
   */
  place(center: { x: number; y: number; z: number }, scale: number, opacity = 1): void {
    this.mesh.position.set(center.x, center.y, center.z);
    this.mesh.scale.setScalar(scale);
    this.material.uniforms.uSizeScale.value = scale;
    this.material.uniforms.uOpacity.value = opacity;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.puffs.dispose();
  }
}
