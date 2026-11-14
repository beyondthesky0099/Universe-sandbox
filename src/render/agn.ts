/**
 * An active galactic nucleus around a black hole (sim/agn.ts gives the sizes): the dusty torus,
 * ray-marched with absorption so that it hides the nucleus when seen edge-on; twin jets as
 * analytic Gaussian tubes, Doppler-boosted towards the camera; and the nuclear glare, dimmed
 * when the torus is in the way. All in the disc's frame: local +z is the spin axis.
 */
import * as THREE from 'three';
import type { AgnParams } from '../sim/agn';
import { glowTexture } from './textures';

const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

/** The torus: a flared, clumpy ring of dust from uInner out to about 5 uInner, lit from inside. */
const TORUS_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uCam;      // camera in the torus frame
  uniform vec3 uBox;      // half-sizes of the bounding box
  uniform float uInner;   // sublimation radius
  uniform float uTanOpen; // tan of the half-opening angle of the clear cone
  uniform float uTime;
  uniform float uSeed;
  varying vec3 vLocal;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // Dust density at p (in sublimation radii).
  float density(vec3 p) {
    float r = length(p.xy);
    float h = abs(p.z);
    // Inside the sublimation radius the dust is gone; outside, the ring thins over a few radii.
    float radial = smoothstep(0.8, 1.15, r) * exp(-(r - 1.0) / 2.2);
    // Flared: the dust fills the region below the clear cone, with a soft edge.
    float top = (r + 0.15) / uTanOpen * 0.85;
    float vertical = 1.0 - smoothstep(top * 0.75, top * 1.1, h);
    float d = radial * vertical;
    if (d < 0.002) return 0.0;
    // Clumps, at two scales, slowly drifting.
    float ang = atan(p.y, p.x);
    float n1 = noise(vec3(r * 2.4, ang * 2.2 + uSeed, p.z * 2.6 + uTime * 0.02));
    float n2 = noise(vec3(r * 7.0 + uSeed, ang * 6.5, p.z * 7.0));
    float clump = pow(n1, 2.2) * (0.5 + 1.4 * n2);
    return d * (0.12 + 2.2 * clump);
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 ro = uCam;
    vec3 rd = normalize(vLocal - uCam);
    // Slab test against the bounding box.
    vec3 inv = 1.0 / rd;
    vec3 ta = (-uBox - ro) * inv, tb = (uBox - ro) * inv;
    vec3 tn = min(ta, tb), tf = max(ta, tb);
    float t0 = max(max(tn.x, tn.y), max(tn.z, 0.0));
    float t1 = min(min(tf.x, tf.y), tf.z);
    if (t1 <= t0) discard;
    const int STEPS = 44;
    float dt = (t1 - t0) / float(STEPS);
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float T = 1.0;
    vec3 col = vec3(0.0);
    // Opacity per unit length (in sublimation radii): a few optical depths across the ring.
    float kappa = 1.3;
    for (int i = 0; i < STEPS; i++) {
      float t = t0 + (float(i) + jitter) * dt;
      vec3 p = (ro + rd * t) / uInner;
      float d = density(p);
      if (d <= 0.0) continue;
      float r = max(length(p.xy), 0.5);
      // The inner face is heated by the nucleus (∝ 1/r², and only where the dust is thin in front).
      float heat = exp(-2.6 * max(r - 1.0, 0.0)) / (r * r);
      vec3 warm = vec3(1.0, 0.46, 0.16) * heat * 2.2;
      // The funnel walls also scatter the blue light of the disc.
      float wall = smoothstep(0.3, 0.8, abs(p.z) / max(r, 0.3)) * heat;
      vec3 scatter = vec3(0.5, 0.68, 1.0) * wall * 0.5;
      vec3 cool = vec3(0.42, 0.14, 0.07) * 0.08;
      float a = 1.0 - exp(-kappa * d * dt / uInner);
      col += (warm + scatter + cool) * a * T;
      T *= 1.0 - a;
      if (T < 0.01) break;
    }
    float alpha = 1.0 - T;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

/** Twin jets along the local y axis of their hull, from −1 to +1 (scaled to the jet length). */
const JET_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uCam;        // camera in the jet frame
  uniform float uBeta;      // jet speed / c
  uniform float uGamma;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uBase;      // width at the base (fraction of the length)
  uniform float uLength;    // jet length (AU)
  varying vec3 vLocal;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vLocal - uCam);
    // Closest approach between the sight line (uCam + t d) and the axis (0, y, 0).
    float b = d.y;
    float den = max(1.0 - b * b, 1e-4);
    float t = max((b * uCam.y - dot(d, uCam)) / den, 0.0);
    float y = clamp(uCam.y + t * d.y, -uLength, uLength);
    vec3 axisP = vec3(0.0, y, 0.0);
    float tc = max(dot(axisP - uCam, d), 0.0);
    float dist = length(uCam + d * tc - axisP);
    float sinT = sqrt(den);
    float ay = abs(y) / uLength;
    // A narrow spine that opens at about 1.5°, with knots streaming outwards.
    float w = (uBase + ay * 0.028) * uLength;
    float knots = 0.55 + 0.9 * pow(noise1(ay * 14.0 - uTime * 0.25 + (y > 0.0 ? 0.0 : 37.0)), 2.0);
    float along = pow(max(1.0 - ay, 0.0), 1.6) * smoothstep(0.0, 0.004, ay) * knots;
    // Looking along the jet the sight line runs down its length; cap the path so the base does not blow out.
    float path = 1.0 / max(sinT, 0.35);
    float core = exp(-pow(dist / w, 2.0)) * along * path;
    float halo = exp(-pow(dist / (w * 3.0), 2.0)) * along * path * 0.1;
    // Relativistic beaming: the jet coming towards us is boosted by δ^2.7, the other dimmed.
    vec3 toCam = normalize(uCam - axisP);
    float s = y > 0.0 ? 1.0 : -1.0;
    float delta = 1.0 / (uGamma * (1.0 - uBeta * s * toCam.y));
    float boost = clamp(pow(delta, 2.7), 0.02, 6.0);
    vec3 col = (vec3(0.8, 0.9, 1.0) * core + vec3(0.35, 0.55, 1.0) * halo) * boost * uIntensity;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class AgnVisual {
  readonly root = new THREE.Group();
  private readonly torus: THREE.Mesh;
  private readonly jets: THREE.Mesh;
  private readonly glare: THREE.Sprite;
  private readonly tmp = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();

  constructor(readonly params: AgnParams) {
    const R = params.torusOuterAu * 1.1;
    const H = params.torusOuterAu * 0.9;
    this.torus = new THREE.Mesh(
      new THREE.BoxGeometry(2 * R, 2 * R, 2 * H),
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: TORUS_FRAGMENT,
        uniforms: {
          uCam: { value: new THREE.Vector3() },
          uBox: { value: new THREE.Vector3(R, R, H) },
          uInner: { value: params.torusInnerAu },
          uTanOpen: { value: Math.tan(params.torusOpening) },
          uTime: { value: 0 },
          uSeed: { value: (params.name.length * 1.7) % 10 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        premultipliedAlpha: true,
      }),
    );
    this.torus.frustumCulled = false;
    this.torus.renderOrder = 4;
    this.root.add(this.torus);

    // The jets' hull: a cylinder along y, scaled to the jet length, turned onto the spin axis (local z).
    const L = params.jetLengthAu;
    const w = L * 0.12;
    const beta = params.jetBeta;
    this.jets = new THREE.Mesh(
      new THREE.CylinderGeometry(w, w, 2 * L, 20, 1, false),
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: JET_FRAGMENT,
        uniforms: {
          uCam: { value: new THREE.Vector3() },
          uBeta: { value: beta },
          uGamma: { value: 1 / Math.sqrt(1 - beta * beta) },
          uIntensity: { value: params.radioLoud ? 0.4 : 0.15 },
          uTime: { value: 0 },
          uBase: { value: 0.0025 },
          uLength: { value: L },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.jets.rotation.x = Math.PI / 2;
    this.jets.frustumCulled = false;
    this.jets.renderOrder = 5;
    this.root.add(this.jets);

    // The nucleus itself, seen from torus distances: a point of glare, hidden behind the dust.
    this.glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xdde6ff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glare.scale.setScalar(params.torusInnerAu * 0.7);
    this.glare.renderOrder = 6;
    this.root.add(this.glare);
  }

  /** Per frame, with the camera's world position. */
  update(camera: THREE.Vector3, dt: number, worldPerPixel: number): void {
    const px = this.params.torusOuterAu / worldPerPixel;
    this.root.visible = px > 1.5;
    if (!this.root.visible) return;
    this.root.updateMatrixWorld();
    const tu = (this.torus.material as THREE.ShaderMaterial).uniforms;
    tu.uCam.value.copy(this.torus.worldToLocal(this.tmp.copy(camera)));
    tu.uTime.value += dt;
    const ju = (this.jets.material as THREE.ShaderMaterial).uniforms;
    ju.uCam.value.copy(this.jets.worldToLocal(this.tmp.copy(camera)));
    ju.uTime.value += dt;
    // The glare dims when we look at the nucleus through the torus (outside its clear cone),
    // and shrinks when we are close enough to see the disc itself.
    this.axis.set(0, 0, 1).transformDirection(this.root.matrixWorld);
    const toCam = this.tmp.copy(camera).sub(this.root.getWorldPosition(new THREE.Vector3())).normalize();
    const cosView = Math.abs(toCam.dot(this.axis));
    const clear = THREE.MathUtils.smoothstep(cosView, Math.cos(this.params.torusOpening + 0.12), Math.cos(this.params.torusOpening - 0.08));
    const near = THREE.MathUtils.smoothstep(px, 1.5, 12);
    const far = 1 - THREE.MathUtils.smoothstep(this.params.torusInnerAu / worldPerPixel, 200, 2000);
    this.glare.material.opacity = (0.06 + 0.94 * clear) * near * far;
    this.glare.scale.setScalar(Math.max(this.params.torusInnerAu * 0.7, worldPerPixel * 16));
  }

  dispose(): void {
    for (const m of [this.torus, this.jets]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.glare.material.dispose();
  }
}
