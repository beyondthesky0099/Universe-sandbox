import * as THREE from 'three';
import { galaxyCentre, galaxyLook, galaxyOrientation, galaxyRadius } from '../sim/galaxyLook';
import type { LocalGalaxy } from '../sim/galaxies';
import { relativity, RELATIVITY_PARS } from './relativity';

/**
 * Real galaxies on the Universe map, drawn as little volumes rather than dots.
 *
 * Each galaxy is one instanced billboard. Its fragment shader casts the pixel's ray through a
 * model of the galaxy in its own frame (disc plane from the catalogue's inclination and
 * HyperLEDA's position angle) and integrates starlight and dust front to back:
 *
 * - an exponential disc with an exact vertical integral per step, so a thin disc is smooth at
 *   any step count and any viewing angle;
 * - logarithmic spiral arms (count, pitch and contrast by Hubble type), blue young stars on the
 *   arms and pink H II knots when the galaxy is big on screen;
 * - a flattened bulge, or the whole body for ellipticals and dwarf spheroidals;
 * - dust in the mid-plane, reddening and darkening what lies behind it: dust lanes across the
 *   near side of an inclined bulge, a dark lane through an edge-on disc;
 * - clumps for irregulars.
 *
 * Below a few pixels across, the galaxy collapses and the point sprite shows instead.
 */

const VERTEX = /* glsl */ `
  attribute vec3 iCenter;
  attribute float iRadius;
  attribute vec3 iU;
  attribute vec3 iN;
  attribute vec4 iA;
  attribute vec4 iB;
  attribute vec4 iC;
  uniform float uPxPerUnit;
  varying vec3 vRay;
  varying vec3 vCen;
  varying vec3 vU;
  varying vec3 vV;
  varying vec3 vN;
  varying float vR;
  varying vec4 vA;
  varying vec4 vB;
  varying vec4 vC;
  varying float vPx;
  varying float vD;
  ${RELATIVITY_PARS}
  void main() {
    vec4 mv = modelViewMatrix * vec4(iCenter, 1.0);
    vD = relAberrate(mv);
    float dist = length(mv.xyz);
    vPx = 2.0 * iRadius * uPxPerUnit / max(dist, 1e-9);
    // The quad sits at the centre, facing the eye, big enough for the bounding sphere's silhouette
    // (which grows without bound as the eye reaches the sphere). Tiny on screen: collapse it.
    float ratio = min(iRadius / max(dist, 1e-9), 0.98);
    float halfSize = vPx < 2.5 ? 0.0 : iRadius * 1.06 / sqrt(1.0 - ratio * ratio);
    vec3 fwd = mv.xyz / max(dist, 1e-9);
    vec3 up0 = abs(fwd.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 right = normalize(cross(fwd, up0));
    vec3 up = cross(right, fwd);
    vec3 p = mv.xyz + (position.x * right + position.y * up) * halfSize;
    vRay = p;
    vCen = mv.xyz;
    vU = normalize(normalMatrix * iU);
    vN = normalize(normalMatrix * iN);
    vV = cross(vN, vU);
    vR = iRadius;
    vA = iA;
    vB = iB;
    vC = iC;
    gl_Position = projectionMatrix * vec4(p, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uGain;
  varying vec3 vRay;
  varying vec3 vCen;
  varying vec3 vU;
  varying vec3 vV;
  varying vec3 vN;
  varying float vR;
  varying vec4 vA;
  varying vec4 vB;
  varying vec4 vC;
  varying float vPx;
  varying float vD;
  ${RELATIVITY_PARS}

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // Antiderivative of exp(-|z| / h).
  float vert(float z, float h) {
    return sign(z) * h * (1.0 - exp(-abs(z) / h));
  }
  // Mean of exp(-|z| / h) over a segment whose height runs from za to zb: exact, so a thin disc
  // never falls between samples.
  float vmean(float za, float zb, float h) {
    float dz = zb - za;
    if (abs(dz) < 1e-4 * h) return exp(-abs(0.5 * (za + zb)) / h);
    return abs(vert(zb, h) - vert(za, h)) / abs(dz);
  }

  void main() {
    vec3 d = normalize(vRay);
    // The ray in the galaxy's frame, in units of its radius: eye at og, direction dg.
    vec3 og = vec3(dot(-vCen, vU), dot(-vCen, vV), dot(-vCen, vN)) / vR;
    vec3 dg = vec3(dot(d, vU), dot(d, vV), dot(d, vN));
    int form = int(vC.x + 0.5);
    float bulgeScale = vA.x, bulgeWeight = vA.y, hz = vA.z, q = vA.w;
    float arms = vB.x, pitch = vB.y, armC = vB.z, dust = vB.w;
    float seed = vC.y, sb = vC.z, blue = vC.w;
    bool spheroid = form == 2 || form == 4;
    float zmax = spheroid ? q * 1.1 : max(6.0 * hz, 3.5 * bulgeScale * q);

    // Clip the ray to the bounding sphere and the slab the light lives in.
    float b = dot(og, dg);
    float c = dot(og, og) - 1.1025;
    float h = b * b - c;
    if (h < 0.0) discard;
    h = sqrt(h);
    float t0 = max(0.0, -b - h), t1 = -b + h;
    if (abs(dg.z) > 1e-6) {
      float ta = (-zmax - og.z) / dg.z, tb = (zmax - og.z) / dg.z;
      t0 = max(t0, min(ta, tb));
      t1 = min(t1, max(ta, tb));
    } else if (abs(og.z) > zmax) discard;
    if (t1 <= t0) discard;

    float fade = smoothstep(2.5, 9.0, vPx);
    float detail = smoothstep(12.0, 70.0, vPx);
    int steps = int(clamp(vPx * 0.3, 6.0, 32.0));
    float dt = (t1 - t0) / float(steps);
    // A per-pixel offset turns step banding into fine grain.
    float jitter = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y)) - 0.5;
    float tanP = tan(max(abs(pitch), 0.02));
    float chir = pitch < 0.0 ? -1.0 : 1.0;
    float hd = 0.45 * hz;

    vec3 colOld = mix(vec3(1.0, 0.86, 0.68), vec3(0.95, 0.95, 1.0), blue * 0.6);
    vec3 colArm = vec3(0.68, 0.80, 1.0);
    vec3 colHII = vec3(1.0, 0.5, 0.6);
    vec3 colBulge = mix(vec3(1.0, 0.84, 0.6), vec3(1.0, 0.92, 0.8), blue * 0.5);

    vec3 L = vec3(0.0);
    vec3 T = vec3(1.0);
    for (int i = 0; i < 32; i++) {
      if (i >= steps) break;
      float ta = t0 + (float(i) + jitter) * dt, tb = ta + dt;
      vec3 pa = og + dg * ta, pb = og + dg * tb;
      vec3 pm = 0.5 * (pa + pb);
      float r = length(pm.xy);
      vec3 e = vec3(0.0);
      float tau = 0.0;

      // Bulge or spheroid: a cored profile with a cusp, flattened along the axis.
      float m = length(vec3(pm.xy, pm.z / q)) / bulgeScale;
      // Hernquist-like: a bright cusp (softened) and faint, extended wings.
      float body = 0.6 / ((m + 0.08) * pow(1.0 + m, 3.0));
      body *= 1.0 - smoothstep(0.75, 1.05, length(vec3(pm.xy, pm.z / q)));
      e += colBulge * body * bulgeWeight * 2.5 * dt;

      if (!spheroid) {
        float radial = exp(-r / 0.32) * (1.0 - smoothstep(0.8, 1.05, r));
        // Old stars in the whole disc; young stars and dust in a layer half as thick.
        float vz = vmean(pa.z, pb.z, hz) * dt;
        float vzThin = vmean(pa.z, pb.z, 0.5 * hz) * dt;
        float armOld = 0.0, armYoung = 0.0, armDust = 0.0;
        if (form == 0) {
          float theta = atan(pm.y, pm.x);
          float phase = arms * (theta - chir * log(max(r, 0.02) / 0.12) / tanP);
          float inner = smoothstep(0.06, 0.28, r);
          float ridge = 0.5 + 0.5 * cos(phase);
          armOld = pow(ridge, 2.0) * inner;
          // Flocculence: noise breaks the young arms into pieces when seen close.
          float n = vnoise(pm.xy * 9.0 + seed * 100.0);
          armYoung = pow(ridge, 6.0) * inner * mix(1.0, 0.3 + 1.4 * n, detail * 0.8);
          armDust = pow(0.5 + 0.5 * cos(phase - chir * 0.7), 6.0) * inner;
        }
        float knots = 0.0;
        if (form == 0 || form == 3) {
          float n2 = vnoise(pm.xy * 30.0 + seed * 37.0);
          knots = smoothstep(0.7, 0.9, n2) * detail * (form == 0 ? armYoung * armC : 0.8);
        }
        float lumpy = form == 3 ? 0.5 + 1.0 * vnoise(pm.xy * 6.0 + seed * 11.0) : 1.0;
        e += colOld * radial * lumpy * (1.0 + 0.5 * armC * armOld) * vz * 3.5;
        e += (colArm * armC * armYoung * 2.5 + colHII * knots * 3.0) * radial * vzThin * 3.5;
        // Dust in the mid-plane, piled on the inner edges of the arms.
        float vd = vmean(pa.z, pb.z, hd) * dt;
        float dn = mix(1.0, 0.4 + 1.2 * vnoise(pm.xy * 14.0 + seed * 53.0), detail);
        tau = dust * radial * (0.35 + 2.5 * armDust) * dn * vd * 60.0;
      }
      if (form == 3) {
        // Irregulars: a few bright star-forming clumps.
        for (int k = 0; k < 5; k++) {
          float fk = float(k);
          vec2 cpos = (vec2(hash12(vec2(seed * 77.0, fk)), hash12(vec2(fk, seed * 91.0))) - 0.5) * 1.1;
          float cs = 0.07 + 0.12 * hash12(vec2(seed * 13.0, fk * 3.1));
          vec2 dp = pm.xy - cpos;
          float gauss = exp(-dot(dp, dp) / (2.0 * cs * cs)) * exp(-abs(pm.z) / (0.6 * hz));
          e += mix(colArm, colHII, 0.35 * hash12(vec2(fk, seed))) * gauss * 0.9 * dt;
        }
      }
      L += T * e;
      T *= exp(-tau * vec3(1.0, 0.8, 0.55));
    }
    L *= uGain * sb * fade;
    // Soft shoulder that keeps the hue: bright cores go pale, not flat white.
    float lum = dot(L, vec3(0.3, 0.5, 0.2));
    L /= 1.0 + 0.8 * lum;
    L = relShift(L, vD);
    gl_FragColor = vec4(L, 1.0);
  }
`;

export class GalaxyShapes {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(galaxies: LocalGalaxy[]) {
    const n = galaxies.length;
    const center = new Float32Array(n * 3);
    const radius = new Float32Array(n);
    const u = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    const a = new Float32Array(n * 4);
    const b = new Float32Array(n * 4);
    const c = new Float32Array(n * 4);
    galaxies.forEach((g, i) => {
      const o = galaxyOrientation(g);
      const look = galaxyLook(g, o);
      center.set(galaxyCentre(g), i * 3);
      radius[i] = galaxyRadius(g);
      u.set(o.major, i * 3);
      nrm.set(o.normal, i * 3);
      // Spirals keep a flattened bulge; spheroids use the flattening that matches their axis ratio.
      const spheroid = look.form === 2 || look.form === 4;
      a.set([look.bulgeScale, look.bulgeWeight, look.scaleHeight, spheroid ? look.flattening : 0.7], i * 4);
      b.set([look.arms, look.pitch, look.armContrast, look.dust], i * 4);
      c.set([look.form, look.seed, look.surfaceBrightness, look.blue], i * 4);
    });
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('iCenter', new THREE.InstancedBufferAttribute(center, 3));
    geo.setAttribute('iRadius', new THREE.InstancedBufferAttribute(radius, 1));
    geo.setAttribute('iU', new THREE.InstancedBufferAttribute(u, 3));
    geo.setAttribute('iN', new THREE.InstancedBufferAttribute(nrm, 3));
    geo.setAttribute('iA', new THREE.InstancedBufferAttribute(a, 4));
    geo.setAttribute('iB', new THREE.InstancedBufferAttribute(b, 4));
    geo.setAttribute('iC', new THREE.InstancedBufferAttribute(c, 4));
    geo.instanceCount = n;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uPxPerUnit: { value: 1000 }, uGain: { value: 2.2 }, uBeta: relativity.uBeta },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  /** Screen pixels per map unit at unit distance: (height / 2) / tan(fov / 2). */
  setPxPerUnit(v: number): void {
    this.material.uniforms.uPxPerUnit.value = v;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
