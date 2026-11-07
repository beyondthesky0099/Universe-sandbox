import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { DISK_LAYER } from './accretionDisk';

export const MAX_LENSES = 4;
/** Directions sampled around each shadow (kerr.ts shadowProfile). */
export const SHADOW_BINS = 32;

/** A black hole on screen. */
export interface LensInfo {
  /** Centre in uv (0–1). */
  x: number;
  y: number;
  /** Non-spinning shadow radius, in screen heights. */
  rs: number;
  /** Shadow radius in SHADOW_BINS directions from `axis`, relative to rs (all 1 = round). */
  shadow?: Float32Array;
  /** Screen direction of the side turning towards us (unit, aspect-corrected). */
  axis?: [number, number];
  /** How lopsided the photon ring's brightness is (0 = even). */
  beam?: number;
}

/**
 * Screen-space gravitational lensing. For each black hole on screen, background light is
 * bent toward the hole with the point-lens deflection α = θ_E² / θ, producing an Einstein
 * ring and a distorted starfield; inside the shadow everything is black.
 */
const LensShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAspect: { value: 1 },
    uCount: { value: 0 },
    uLenses: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector3()) },
    uLensAxis: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector3(1, 0, 0)) },
    uShadow: { value: new Float32Array(MAX_LENSES * SHADOW_BINS).fill(1) },
    uStrength: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAspect;
    uniform int uCount;
    uniform vec3 uLenses[${MAX_LENSES}];
    uniform vec3 uLensAxis[${MAX_LENSES}];   // approaching side on screen (x, y), ring beaming
    uniform float uShadow[${MAX_LENSES * 32}]; // shadow radius / rs in 32 directions per lens
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      float shadow = 0.0;
      float ring = 0.0;
      for (int i = 0; i < ${MAX_LENSES}; i++) {
        if (i >= uCount) break;
        vec3 L = uLenses[i];
        vec2 d = (vUv - L.xy) * vec2(uAspect, 1.0);
        float r = length(d);
        float rs = L.z;                 // shadow radius (screen-height units)
        float thetaE = rs * 2.2 * uStrength;
        // A spinning hole's shadow is D-shaped (kerr.ts): look up its radius in this direction.
        vec2 u = uLensAxis[i].xy;
        vec2 dn = d / max(r, 1e-6);
        float along = dot(dn, u);
        float ang = atan(dn.y * u.x - dn.x * u.y, along);
        if (ang < 0.0) ang += 6.2831853;
        float t = ang / 6.2831853 * 32.0;
        int k0 = int(floor(t));
        float f = t - float(k0);
        k0 = k0 - (k0 / 32) * 32;
        int k1 = k0 + 1 - ((k0 + 1) / 32) * 32;
        float edge = rs * mix(uShadow[i * 32 + k0], uShadow[i * 32 + k1], f);
        if (r < edge) { shadow = 1.0; continue; }
        // Point-lens deflection, faded out far from the hole to keep the rest of the image intact.
        float fade = 1.0 - smoothstep(thetaE * 6.0, thetaE * 14.0, r);
        float alpha = (thetaE * thetaE / r) * fade;
        // Source position along this direction (lens equation β = θ − α). Light from right
        // behind the hole forms the Einstein ring, but the image being lensed has the hole
        // itself there, not the sky behind it: take that light from just outside the hole.
        float beta = r - alpha;
        float hole = rs * 0.6;
        if (abs(beta) < hole) beta = sign(beta + 1e-6) * (2.0 * hole - abs(beta));
        uv -= dn * (r - beta) / vec2(uAspect, 1.0);
        // Thin photon ring just outside the shadow.
        // (Brighter on the side turning towards us.)
        ring += exp(-pow((r - edge * 1.06) / (rs * 0.06), 2.0)) * 0.6 * max(0.2, 1.0 + uLensAxis[i].z * along);
      }
      vec4 col = texture2D(tDiffuse, clamp(uv, 0.0, 1.0));
      col.rgb += vec3(1.0, 0.85, 0.65) * ring * 0.5;
      // Clamp: additive glows exceed 1.0 in HDR and bloom would smear that energy across the sky.
      // The display clamps anyway, so this changes nothing but the bloom input.
      col.rgb = min(col.rgb, vec3(1.0));
      gl_FragColor = mix(col, vec4(0.0, 0.0, 0.0, 1.0), shadow);
    }
  `,
};

/** Draws one layer of the scene over the image so far (accretion discs after the lensing pass). */
class LayerPass extends Pass {
  scene = new THREE.Scene();
  camera: THREE.Camera = new THREE.PerspectiveCamera();

  constructor(private readonly layer: number) {
    super();
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const mask = this.camera.layers.mask;
    const autoClear = renderer.autoClear;
    this.camera.layers.set(this.layer);
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    renderer.clearDepth();
    // Draw only the layer's objects: not the scene's background again over the image.
    const background = this.scene.background;
    this.scene.background = null;
    renderer.render(this.scene, this.camera);
    this.scene.background = background;
    renderer.autoClear = autoClear;
    this.camera.layers.mask = mask;
  }
}

export class PostFX {
  readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly lens: ShaderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly disks = new LayerPass(DISK_LAYER);
  enabled = true;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const size = renderer.getSize(new THREE.Vector2());
    // Half-float avoids banding in dark gradients; the lens pass clamps to 1.0 before bloom.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.lens = new ShaderPass(LensShader);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.3, 0.85);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.lens);
    this.composer.addPass(this.disks);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    this.lens.uniforms.uAspect.value = width / Math.max(1, height);
  }

  setBloom(strength: number): void {
    this.bloom.strength = strength;
    this.bloom.enabled = strength > 0;
  }

  /** Lenses in screen space: x, y in [0, 1] (uv) and shadow radius in screen-height units. */
  setLenses(lenses: LensInfo[]): void {
    const arr = this.lens.uniforms.uLenses.value as THREE.Vector3[];
    const axes = this.lens.uniforms.uLensAxis.value as THREE.Vector3[];
    const shadow = this.lens.uniforms.uShadow.value as Float32Array;
    const n = Math.min(MAX_LENSES, lenses.length);
    for (let i = 0; i < n; i++) {
      const l = lenses[i];
      arr[i].set(l.x, l.y, l.rs);
      axes[i].set(l.axis?.[0] ?? 1, l.axis?.[1] ?? 0, l.beam ?? 0);
      for (let k = 0; k < SHADOW_BINS; k++) shadow[i * SHADOW_BINS + k] = l.shadow?.[k] ?? 1;
    }
    this.lens.uniforms.uCount.value = n;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.disks.scene = scene;
    this.disks.camera = camera;
    // The discs are drawn after the lensing, over the shadow, by their own pass.
    camera.layers.disable(DISK_LAYER);
    this.composer.render();
    camera.layers.enable(DISK_LAYER);
  }
}
