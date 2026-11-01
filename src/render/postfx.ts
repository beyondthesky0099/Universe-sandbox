import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export const MAX_LENSES = 4;

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
        if (r < rs) { shadow = 1.0; continue; }
        // Point-lens deflection, faded out far from the hole to keep the rest of the image intact.
        float fade = 1.0 - smoothstep(thetaE * 6.0, thetaE * 14.0, r);
        float alpha = (thetaE * thetaE / r) * fade;
        uv -= (d / r) * alpha / vec2(uAspect, 1.0);
        // Thin photon ring just outside the shadow.
        ring += exp(-pow((r - rs * 1.08) / (rs * 0.06), 2.0)) * 0.6;
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

export class PostFX {
  readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly lens: ShaderPass;
  private readonly bloom: UnrealBloomPass;
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
  setLenses(lenses: THREE.Vector3[]): void {
    const arr = this.lens.uniforms.uLenses.value as THREE.Vector3[];
    const n = Math.min(MAX_LENSES, lenses.length);
    for (let i = 0; i < n; i++) arr[i].copy(lenses[i]);
    this.lens.uniforms.uCount.value = n;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.composer.render();
  }
}
