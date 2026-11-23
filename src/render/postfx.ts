import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { SavePass } from 'three/addons/postprocessing/SavePass.js';
import { DISC_GLSL, DISK_LAYER } from './accretionDisk';
import { MAX_STEPS, PHI_STEP } from '../sim/geodesic';

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
  /** Einstein radius, in screen heights: how far out the starfield is bent (kerr.ts einsteinRadius). */
  thetaE: number;
  /** Shadow radius in SHADOW_BINS directions from `axis`, relative to rs (all 1 = round). */
  shadow?: Float32Array;
  /** Screen direction of the side turning towards us (unit, aspect-corrected). */
  axis?: [number, number];
  /** How lopsided the photon ring's brightness is (0 = even). */
  beam?: number;
  /** The accretion disc to draw by tracing light around the hole (sim/geodesic.ts); lengths in M. */
  disc?: {
    inner: number;
    outer: number;
    brightness: number;
    /** Disc normal (world), the azimuth reference in the disc plane (world), and the hole's position relative to the camera in M. */
    normal: [number, number, number];
    m1: [number, number, number];
    holeRel: [number, number, number];
  };
}

/**
 * Screen-space gravitational lensing. For each black hole on screen, background light is
 * bent toward the hole with the point-lens deflection α = θ_E² / θ, where the Einstein radius
 * θ_E = √(2 R_s / D) follows the camera's distance D (kerr.ts einsteinRadius), producing an
 * Einstein ring and a distorted starfield; inside the shadow everything is black. Each black
 * hole's accretion disc is drawn here too, by tracing the pixel's ray around the hole
 * (sim/geodesic.ts), so the far side of the disc appears bent over and under the shadow.
 */
const LensShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAspect: { value: 1 },
    uCount: { value: 0 },
    uLenses: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector3()) },
    uLensAxis: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector3(1, 0, 0)) },
    uShadow: { value: new Float32Array(MAX_LENSES * SHADOW_BINS).fill(1) },
    uThetaE: { value: new Float32Array(MAX_LENSES) },
    uStrength: { value: 1 },
    uCamRight: { value: new THREE.Vector3(1, 0, 0) },
    uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uCamForward: { value: new THREE.Vector3(0, 0, -1) },
    uTanHalf: { value: 0.5 },
    uTime: { value: 0 },
    uHoleRel: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector3()) },
    uDiscN: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector3(0, 1, 0)) },
    uDiscM1: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector3(1, 0, 0)) },
    uDisc: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector4()) },
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
    uniform float uThetaE[${MAX_LENSES}];      // Einstein radius (screen-height units) per lens
    uniform float uStrength;
    uniform vec3 uCamRight, uCamUp, uCamForward;
    uniform float uTanHalf;
    uniform float uTime;
    uniform vec3 uHoleRel[${MAX_LENSES}];   // hole relative to the camera, in M
    uniform vec3 uDiscN[${MAX_LENSES}];     // disc normal (world)
    uniform vec3 uDiscM1[${MAX_LENSES}];    // azimuth reference in the disc plane (world)
    uniform vec4 uDisc[${MAX_LENSES}];      // inner and outer radius (M), brightness, 1 when there is a disc
    varying vec2 vUv;
    ${DISC_GLSL}

    // Trace this pixel's ray back around hole i (sim/geodesic.ts: u'' = 3u² − u, u = 1/r in M) and
    // return the disc's shading where the ray first crosses the disc, or nothing. Sets captured when
    // the ray falls into the hole first.
    vec4 traceDisc(int i, vec3 d, out bool captured) {
      captured = false;
      vec3 H = uHoleRel[i];
      float r0 = length(H);
      vec3 e1 = -H / r0;                      // from the hole towards the camera
      float cosT = -dot(d, e1);
      float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
      float b = r0 * sinT / sqrt(max(1.0 - 2.0 / r0, 1e-3));
      vec4 disc = uDisc[i];
      if (b > disc.y) return vec4(0.0);      // never comes closer than b: cannot reach the disc
      if (sinT < 1e-5) { captured = true; return vec4(0.0); }
      vec3 e2 = normalize(d - dot(d, e1) * e1);
      vec3 n = uDiscN[i];
      float n1 = dot(n, e1), n2 = dot(n, e2);
      float u = 1.0 / r0;
      float up = (dot(d, e1) < 0.0 ? 1.0 : -1.0) * sqrt(max(1.0 / (b * b) - u * u * (1.0 - 2.0 * u), 0.0));
      float phi = 0.0;
      float hPrev = r0 * n1, rPrev = r0, phiPrev = 0.0;
      const float h = ${PHI_STEP.toFixed(3)};
      for (int k = 0; k < ${MAX_STEPS}; k++) {
        float a0 = 3.0 * u * u - u;
        float uHalf = up + 0.5 * h * a0;
        float u1 = u + h * uHalf;
        float a1 = 3.0 * u1 * u1 - u1;
        up = uHalf + 0.5 * h * a1;
        u = u1;
        phi += h;
        if (u >= 0.5) { captured = true; return vec4(0.0); }
        if (u <= 0.0 || (up < 0.0 && u < 1.0 / (3.0 * r0) && u < 0.5 / disc.y)) return vec4(0.0);
        float r = 1.0 / u;
        float hh = r * (cos(phi) * n1 + sin(phi) * n2);
        if (hh * hPrev < 0.0) {
          float t = hPrev / (hPrev - hh);
          float rc = mix(rPrev, r, t);
          float phic = mix(phiPrev, phi, t);
          // The rays are traced in the non-spinning (Schwarzschild) geometry, where no gas orbits
          // inside the photon sphere (3 M). A fast prograde spin puts the disc's inner edge below
          // that (2.3 M at a = 0.9); drawing gas there filled the whole shadow with dim light.
          if (rc >= max(disc.x, 3.0) && rc <= disc.y) {
            vec3 P = e1 * (rc * cos(phic)) + e2 * (rc * sin(phic));
            vec3 m2 = cross(n, uDiscM1[i]);
            float az = atan(dot(P, m2), dot(P, uDiscM1[i]));
            float drdphi = -up / (u * u);
            vec3 T = e1 * (drdphi * cos(phic) - rc * sin(phic)) + e2 * (drdphi * sin(phic) + rc * cos(phic));
            vec3 kdir = -normalize(T);
            // Gas on a circular orbit, prograde about the normal: β = 1/√r; then gravitational redshift.
            vec3 v = normalize(cross(n, P));
            float beta = min(0.95, inversesqrt(rc));
            float D = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(v, kdir));
            float g = D * sqrt(max(0.0, 1.0 - 3.0 / rc));
            return discShade(rc, disc.x, disc.y, g, az, uTime, disc.z);
          }
        }
        hPrev = hh; rPrev = r; phiPrev = phi;
      }
      return vec4(0.0);
    }

    void main() {
      vec2 uv = vUv;
      float shadow = 0.0;
      float ring = 0.0;
      vec3 discLight = vec3(0.0);
      vec2 ndc = (vUv - 0.5) * 2.0;
      vec3 ray = normalize(uCamForward + uCamRight * (ndc.x * uTanHalf * uAspect) + uCamUp * (ndc.y * uTanHalf));
      for (int i = 0; i < ${MAX_LENSES}; i++) {
        if (i >= uCount) break;
        vec3 L = uLenses[i];
        vec2 d = (vUv - L.xy) * vec2(uAspect, 1.0);
        float r = length(d);
        // The disc, traced around the hole: it can show in front of the shadow and bent over it.
        if (uDisc[i].w > 0.5) {
          bool captured = false;
          vec4 dc = traceDisc(i, ray, captured);
          discLight += dc.rgb;
        }
        float rs = L.z;                 // shadow radius (screen-height units)
        // The Einstein radius grows with distance from the hole (√(2 R_s / D)): never inside the shadow.
        float thetaE = max(uThetaE[i], rs * 1.2) * uStrength;
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
      vec4 outc = mix(col, vec4(0.0, 0.0, 0.0, 1.0), shadow);
      outc.rgb = min(outc.rgb + discLight, vec3(1.0));
      gl_FragColor = outc;
    }
  `,
};

/**
 * After the bloom: put each black hole's shadow back as it was before the bloom. The disc right
 * next to the shadow is the brightest thing on screen, and its glow otherwise fills the shadow
 * with grey (worst on phones, where the image is rendered smaller and the glow is wider), so the
 * hole looked like a grey, half-lit moon. The disc light traced in front of the shadow stays.
 */
function shadowKeepShader(lens: ShaderPass) {
  const u = lens.uniforms;
  return {
    uniforms: {
      tDiffuse: { value: null },
      tPre: { value: null as THREE.Texture | null },
      // Replaced by the lens pass's own uniforms once the pass exists (PostFX constructor).
      uAspect: u.uAspect,
      uCount: u.uCount,
      uLenses: u.uLenses,
      uLensAxis: u.uLensAxis,
      uShadow: u.uShadow,
    },
    vertexShader: LensShader.vertexShader,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform sampler2D tPre;
      uniform float uAspect;
      uniform int uCount;
      uniform vec3 uLenses[${MAX_LENSES}];
      uniform vec3 uLensAxis[${MAX_LENSES}];
      uniform float uShadow[${MAX_LENSES * 32}];
      varying vec2 vUv;
      void main() {
        float keep = 0.0;
        for (int i = 0; i < ${MAX_LENSES}; i++) {
          if (i >= uCount) break;
          vec3 L = uLenses[i];
          vec2 d = (vUv - L.xy) * vec2(uAspect, 1.0);
          float r = length(d);
          vec2 u = uLensAxis[i].xy;
          vec2 dn = d / max(r, 1e-6);
          float ang = atan(dn.y * u.x - dn.x * u.y, dot(dn, u));
          if (ang < 0.0) ang += 6.2831853;
          float t = ang / 6.2831853 * 32.0;
          int k0 = int(floor(t));
          float f = t - float(k0);
          k0 = k0 - (k0 / 32) * 32;
          int k1 = k0 + 1 - ((k0 + 1) / 32) * 32;
          float edge = L.z * mix(uShadow[i * 32 + k0], uShadow[i * 32 + k1], f);
          keep = max(keep, 1.0 - smoothstep(edge * 0.85, edge, r));
        }
        gl_FragColor = mix(texture2D(tDiffuse, vUv), texture2D(tPre, vUv), keep);
      }
    `,
  };
}

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
  private readonly preBloom = new SavePass();
  private readonly shadowKeep: ShaderPass;
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
    this.composer.addPass(this.preBloom);
    this.composer.addPass(this.bloom);
    this.shadowKeep = new ShaderPass(shadowKeepShader(this.lens));
    this.shadowKeep.uniforms.tPre.value = this.preBloom.renderTarget.texture;
    // ShaderPass clones its uniforms: share the lens pass's own objects so the shadows match.
    for (const k of ['uAspect', 'uCount', 'uLenses', 'uLensAxis', 'uShadow']) this.shadowKeep.uniforms[k] = this.lens.uniforms[k];
    this.composer.addPass(this.shadowKeep);
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
    this.preBloom.enabled = this.shadowKeep.enabled = strength > 0;
  }

  /** Lenses in screen space: x, y in [0, 1] (uv) and shadow radius in screen-height units. */
  setLenses(lenses: LensInfo[]): void {
    const arr = this.lens.uniforms.uLenses.value as THREE.Vector3[];
    const axes = this.lens.uniforms.uLensAxis.value as THREE.Vector3[];
    const shadow = this.lens.uniforms.uShadow.value as Float32Array;
    const thetaE = this.lens.uniforms.uThetaE.value as Float32Array;
    const holeRel = this.lens.uniforms.uHoleRel.value as THREE.Vector3[];
    const discN = this.lens.uniforms.uDiscN.value as THREE.Vector3[];
    const discM1 = this.lens.uniforms.uDiscM1.value as THREE.Vector3[];
    const disc = this.lens.uniforms.uDisc.value as THREE.Vector4[];
    const n = Math.min(MAX_LENSES, lenses.length);
    for (let i = 0; i < n; i++) {
      const l = lenses[i];
      arr[i].set(l.x, l.y, l.rs);
      thetaE[i] = l.thetaE;
      if (l.disc) {
        holeRel[i].set(...l.disc.holeRel);
        discN[i].set(...l.disc.normal);
        discM1[i].set(...l.disc.m1);
        disc[i].set(l.disc.inner, l.disc.outer, l.disc.brightness, 1);
      } else disc[i].set(0, 0, 0, 0);
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
    // The lens pass traces each pixel's ray from the camera: it needs the camera's frame.
    const u = this.lens.uniforms;
    (u.uCamRight.value as THREE.Vector3).set(1, 0, 0).applyQuaternion(camera.quaternion);
    (u.uCamUp.value as THREE.Vector3).set(0, 1, 0).applyQuaternion(camera.quaternion);
    (u.uCamForward.value as THREE.Vector3).set(0, 0, -1).applyQuaternion(camera.quaternion);
    u.uTanHalf.value = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2)) : 0.5;
    u.uTime.value = performance.now() / 1000;
    // White dwarfs' discs are drawn flat after the lensing by their own pass; black holes' are traced above.
    camera.layers.disable(DISK_LAYER);
    this.composer.render();
    camera.layers.enable(DISK_LAYER);
  }
}
