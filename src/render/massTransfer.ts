/**
 * Mass transfer drawn around the accretor (sim/massTransfer.ts gives the geometry): the disc with
 * its temperature falling outwards, the stream from L1 with gas flowing along it, the hot spot
 * where it strikes the disc, a polar's field-line column and accretion spot, a supergiant's wind,
 * and a Be star's disc. Everything lives in the binary's corotating frame (units of the
 * separation), which `update` turns and scales with the orbit each frame.
 */
import * as THREE from 'three';
import type { Body } from '../sim/body';
import { kelvinToRgb } from '../sim/color';
import type { RocheShape, TransferParams, Vec3 } from '../sim/massTransfer';
import { glowTexture } from './textures';

const SIGMA = 5.6704e-5;
const G_CGS = 6.674e-8;
const AU_CM = 1.496e13;
const MSUN = 1.989e33;
const YEAR = 3.156e7;

const DISC_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec2 polar;
  attribute vec3 tint;
  varying vec2 vPolar;
  varying vec3 vTint;
  void main() {
    vPolar = polar;
    vTint = tint;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

/** Keplerian shear: streaks that wind up faster inside, so the disc visibly turns. */
const DISC_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vPolar;
  varying vec3 vTint;
  void main() {
    #include <logdepthbuf_fragment>
    float r = vPolar.x;
    float phase = vPolar.y - uTime * 0.6 * pow(max(r, 0.02), -1.5) * 0.05;
    float streak = 0.82 + 0.18 * sin(phase * 7.0 + 9.0 * log(r)) * sin(phase * 3.0 - 5.0 * log(r));
    gl_FragColor = vec4(vTint * streak * uOpacity, 1.0);
  }
`;

interface Flow {
  /** Cumulative arc length at each vertex (0…1). */
  s: Float32Array;
  path: Vec3[];
}

function flowOf(path: Vec3[]): Flow {
  const s = new Float32Array(path.length);
  for (let k = 1; k < path.length; k++) s[k] = s[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1], path[k][2] - path[k - 1][2]);
  const total = s[path.length - 1] || 1;
  for (let k = 0; k < s.length; k++) s[k] /= total;
  return { s, path };
}

function pointOn(f: Flow, t: number, out: Float32Array, at: number): void {
  // Binary search for the segment holding t.
  let lo = 0, hi = f.s.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (f.s[m] <= t) lo = m;
    else hi = m;
  }
  const span = f.s[hi] - f.s[lo] || 1;
  const u = (t - f.s[lo]) / span;
  const a = f.path[lo], b = f.path[hi];
  out[at] = a[0] + (b[0] - a[0]) * u;
  out[at + 1] = a[1] + (b[1] - a[1]) * u;
  out[at + 2] = a[2] + (b[2] - a[2]) * u;
}

/** Gas flowing along a set of paths: dots that run from start to end and start again. */
class FlowDots {
  readonly points: THREE.Points;
  private readonly flows: Flow[];
  private readonly perPath: number;
  private readonly pos: Float32Array;
  private phase = 0;

  constructor(paths: Vec3[][], perPath: number, color: number, size: number, opacity: number, private readonly period: number) {
    this.flows = paths.filter((p) => p.length > 1).map(flowOf);
    this.perPath = perPath;
    this.pos = new Float32Array(this.flows.length * perPath * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), color, size, sizeAttenuation: false, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.update(0);
  }

  update(dt: number): void {
    this.phase = (this.phase + dt / this.period) % 1;
    let k = 0;
    this.flows.forEach((f, i) => {
      for (let j = 0; j < this.perPath; j++) {
        // Stagger the paths so the dots don't march in step; ease in, as the gas speeds up as it falls.
        const t = (this.phase + j / this.perPath + i * 0.137) % 1;
        pointOn(f, t * t * 0.4 + t * 0.6, this.pos, k * 3);
        k++;
      }
    });
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

function line(path: Vec3[], color: number, opacity: number): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(path.map((p) => new THREE.Vector3(...p)));
  const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  l.frustumCulled = false;
  l.renderOrder = 4;
  return l;
}

function spot(color: number, opacity: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.renderOrder = 6;
  return s;
}

/**
 * A steady thin disc's temperature (K) at radius r (cm) around mass M (g) of radius R (cm),
 * accreting Ṁ (g/s): T⁴ = 3GMṀ / (8πσr³) · (1 − √(R/r)) (Shakura & Sunyaev 1973).
 */
export function discTemperature(r: number, mass: number, radius: number, mdot: number): number {
  const f = Math.max(0, 1 - Math.sqrt(radius / r));
  return Math.pow((3 * G_CGS * mass * mdot * f) / (8 * Math.PI * SIGMA * r * r * r), 0.25);
}

/** A flat ring in the frame's xy plane, from r0 to r1 (log-spaced), coloured by `tint(r)`. */
function ringMesh(r0: number, r1: number, centre: Vec3, tint: (r: number) => [number, number, number], opacity: number): THREE.Mesh {
  const NR = 40, NP = 160;
  const pos = new Float32Array((NR + 1) * (NP + 1) * 3);
  const polar = new Float32Array((NR + 1) * (NP + 1) * 2);
  const col = new Float32Array((NR + 1) * (NP + 1) * 3);
  for (let a = 0; a <= NR; a++) {
    const r = r0 * Math.pow(r1 / r0, a / NR);
    const c = tint(r);
    for (let b = 0; b <= NP; b++) {
      const phi = (2 * Math.PI * b) / NP;
      const k = a * (NP + 1) + b;
      pos.set([centre[0] + r * Math.cos(phi), centre[1] + r * Math.sin(phi), centre[2]], k * 3);
      polar.set([r / r1, phi], k * 2);
      col.set(c, k * 3);
    }
  }
  const index: number[] = [];
  for (let a = 0; a < NR; a++)
    for (let b = 0; b < NP; b++) {
      const k = a * (NP + 1) + b;
      index.push(k, k + 1, k + NP + 1, k + 1, k + NP + 2, k + NP + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('polar', new THREE.BufferAttribute(polar, 2));
  geo.setAttribute('tint', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      vertexShader: DISC_VERTEX,
      fragmentShader: DISC_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: opacity } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

export class MassTransferVisual {
  /** Children are in the corotating frame (units of the separation); `update` sets its matrix. */
  readonly frame = new THREE.Group();
  private readonly flows: FlowDots[] = [];
  private readonly meshes: (THREE.Mesh | THREE.Line)[] = [];
  private readonly sprites: THREE.Sprite[] = [];
  private readonly hot?: THREE.Sprite;
  private readonly hotSize: number;
  private readonly x = new THREE.Vector3();
  private readonly y = new THREE.Vector3();
  private readonly z = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private time = 0;

  constructor(readonly params: TransferParams) {
    const t = params;
    this.frame.matrixAutoUpdate = false;
    const mdot = (t.rate * MSUN) / YEAR;
    const aCm = t.aAu * AU_CM;
    const m1 = t.m1 * MSUN, r1 = t.accretorRadius * aCm;

    if (t.discOuter > 0) {
      const inner = Math.max(t.discInner, t.accretorRadius * 1.02);
      const tIn = discTemperature(Math.max(inner, t.accretorRadius * 1.37) * aCm, m1, r1, mdot);
      const disc = ringMesh(inner, t.discOuter, [0, 0, 0], (r) => {
        const temp = discTemperature(Math.max(r, t.accretorRadius * 1.37) * aCm, m1, r1, mdot);
        const c = kelvinToRgb(Math.max(1500, Math.min(40000, temp)));
        // Brightness ~ T⁴, compressed so the cool outer disc still shows.
        const b = Math.min(1, 0.3 + 1.2 * Math.pow(temp / tIn, 1.1));
        const edge = 1 - THREE.MathUtils.smoothstep(r / t.discOuter, 0.9, 1.001);
        return [c[0] * b * edge, c[1] * b * edge, c[2] * b * edge];
      }, 0.9);
      this.frame.add(disc);
      this.meshes.push(disc);
    }
    // The stream from L1 (and a polar's column).
    if (t.stream.length > 1) {
      const l = line(t.stream, 0xffb070, 0.35);
      this.frame.add(l);
      this.meshes.push(l);
      const f = new FlowDots([t.stream], 16, 0xffd8a8, 8, 1, 3.5);
      this.frame.add(f.points);
      this.flows.push(f);
    }
    if (t.column && t.column.length > 1) {
      const l = line(t.column, 0xa8d0ff, 0.5);
      this.frame.add(l);
      this.meshes.push(l);
      const f = new FlowDots([t.column], 8, 0xd8ecff, 6, 0.95, 1.2);
      this.frame.add(f.points);
      this.flows.push(f);
    }
    // The hot spot (or a polar's accretion spot), sized to the stream's width.
    this.hotSize = t.magnetic === 'polar' ? Math.max(t.accretorRadius * 1.2, 0.01) : 0.05;
    if (t.hotSpot) {
      this.hot = spot(t.magnetic === 'polar' ? 0xd8eaff : 0xfff0d8, 0.95);
      this.hot.position.set(...t.hotSpot);
      this.frame.add(this.hot);
      this.sprites.push(this.hot);
    }
    // A supergiant's wind.
    if (t.wind?.length) {
      for (const path of t.wind) {
        const l = line(path, 0x8fb8ff, 0.12);
        this.frame.add(l);
        this.meshes.push(l);
      }
      const f = new FlowDots(t.wind, 8, 0xb4d4ff, 7, 0.9, 5);
      this.frame.add(f.points);
      this.flows.push(f);
      // The accretion wake: where the captured wind piles up behind the compact object.
      if (t.accretionRadius) {
        const wake = spot(0x9cc4ff, 0.35);
        wake.scale.setScalar(t.accretionRadius * 2);
        this.frame.add(wake);
        this.sprites.push(wake);
      }
    }
    // A Be star's decretion disc, in hydrogen-alpha pink fading outwards.
    if (t.beDisc) {
      const r0 = t.donorRadius * 1.05;
      const be = ringMesh(r0, t.beDisc, [1, 0, 0], (r) => {
        const fall = Math.pow(r0 / r, 1.6);
        const edge = 1 - THREE.MathUtils.smoothstep(r / t.beDisc!, 0.85, 1.001);
        return [0.95 * fall * edge, 0.55 * fall * edge, 0.7 * fall * edge];
      }, 0.8);
      this.frame.add(be);
      this.meshes.push(be);
    }
  }

  /**
   * Per frame: turn and scale the frame with the orbit (accretor → donor is +x, the orbit's
   * angular momentum +z) and move the gas along.
   */
  update(accretor: Body, donor: Body, dt: number, worldPerPixel: number): void {
    this.x.set(donor.x - accretor.x, donor.y - accretor.y, donor.z - accretor.z);
    const a = this.x.length();
    if (!(a > 0)) return;
    this.x.divideScalar(a);
    this.v.set(donor.vx - accretor.vx, donor.vy - accretor.vy, donor.vz - accretor.vz);
    this.z.crossVectors(this.x, this.v);
    if (this.z.lengthSq() === 0) this.z.set(0, 1, 0);
    this.z.normalize();
    this.y.crossVectors(this.z, this.x);
    this.basis.makeBasis(this.x, this.y, this.z).scale(new THREE.Vector3(a, a, a));
    this.frame.matrix.copy(this.basis);
    this.frame.matrixWorldNeedsUpdate = true;
    this.time += dt;
    for (const f of this.flows) f.update(dt);
    for (const m of this.meshes) {
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      if (u?.uTime) u.uTime.value = this.time;
    }
    // The hot spot flickers, and stays visible when zoomed out.
    if (this.hot) {
      const s = Math.max(this.hotSize, (worldPerPixel * 10) / a);
      this.hot.scale.setScalar(s * (0.9 + 0.1 * Math.sin(this.time * 9.0) * Math.sin(this.time * 3.7)));
    }
  }

  dispose(): void {
    for (const f of this.flows) f.dispose();
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    for (const s of this.sprites) s.material.dispose();
  }
}

/**
 * A Roche-lobe-filling donor's shape: an ellipsoid with the lobe's extent towards L1 and away from
 * it, sideways and to the pole, its centre shifted towards L1. Returns the mesh's scale (in units
 * of the volume-equivalent radius) and the shift along the line to the companion.
 */
export function rocheEllipsoid(shape: RocheShape, lobe: number): { along: number; side: number; pole: number; shift: number } {
  const along = (shape.front + shape.back) / 2, k = Math.cbrt(along * shape.side * shape.pole);
  // Normalized to the lobe's volume (Eggleton's radius), so the star keeps its size.
  return { along: along / k, side: shape.side / k, pole: shape.pole / k, shift: (shape.front - shape.back) / 2 / lobe };
}
