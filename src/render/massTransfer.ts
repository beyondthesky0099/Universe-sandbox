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
import { discRate, discSurvival, novaLuminosity, novaMagnitude, shellRadius } from '../sim/binaryCycles';
import { starTemperature } from '../sim/color';
import { mulberry32 } from '../procgen/rng';
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

/** Keplerian shear: a pattern that winds up faster inside, so the disc visibly turns. */
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
    // Two trailing spiral arms, like the tidal spiral shocks seen in discs in outburst.
    float streak = 0.9 + 0.1 * sin(phase * 2.0 + 6.0 * log(r));
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
  mesh.userData.ring = { r0, r1, NR, NP };
  return mesh;
}

/** Recolour a ring mesh (ringMesh) with a new tint profile. */
function retint(mesh: THREE.Mesh, tint: (r: number) => [number, number, number]): void {
  const { r0, r1, NR, NP } = mesh.userData.ring as { r0: number; r1: number; NR: number; NP: number };
  const attr = mesh.geometry.attributes.tint as THREE.BufferAttribute;
  const col = attr.array as Float32Array;
  for (let a = 0; a <= NR; a++) {
    const c = tint(r0 * Math.pow(r1 / r0, a / NR));
    for (let b = 0; b <= NP; b++) col.set(c, (a * (NP + 1) + b) * 3);
  }
  attr.needsUpdate = true;
}

/**
 * Planck's law at 550 nm (the V band) up to constants: 1 / (exp(hc/λkT) − 1). Ratios of
 * area × planckV are ratios of visible light.
 */
function planckV(temperature: number): number {
  const x = 1.4388 / (5.5e-5 * temperature);
  return x > 80 ? 0 : 1 / Math.expm1(x);
}
const RSUN_CM = 6.957e10;
/** The Sun in the same units: 4πR☉² × planckV(5772 K). */
const SUN_V = 4 * Math.PI * RSUN_CM * RSUN_CM * planckV(5772);

/** A disc's half-thickness over radius at its rim, for how much shows edge-on. */
const DISC_FLARE = 0.06;
/** A typical accreting white dwarf's surface temperature (K). */
const WD_TEMPERATURE = 20000;

/** One sample of the disc for the light curve: position (units of a) and luminosity per unit accretion rate (erg/s per g/s, one face). */
interface DiscSample {
  x: number;
  y: number;
  /** σT⁴ per unit accretion rate (erg/s/cm² per g/s), and the cell's area (cm²). */
  w: number;
  area: number;
}

/** The donor's surface temperature (K): a red giant's, else a main-sequence star's for its mass. */
function donorTemperature(donor: Body): number {
  return donor.kind === 'giant' ? 3600 : donor.kind === 'whitedwarf' ? 12000 : donor.mass < 0.6 ? 3300 : starTemperature(donor.mass);
}

export class MassTransferVisual {
  /** Everything: the corotating frame and (novae) the ejected shell, centred on the accretor. */
  readonly root = new THREE.Group();
  /** Children are in the corotating frame (units of the separation); `update` sets its matrix. */
  readonly frame = new THREE.Group();
  /** Visible-light brightness seen from the camera, in Suns (as if it shone like that in every direction), for the light curve. */
  seenLuminosity = 0;
  private disc?: THREE.Mesh;
  private discTint?: (mdot: number) => (r: number) => [number, number, number];
  private lastDiscRate = -1;
  private readonly samples: DiscSample[] = [];
  private shell?: THREE.Points;
  private flash?: THREE.Sprite;
  private readonly u = new THREE.Vector3();
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
    this.root.add(this.frame);
    if (t.nova) this.makeNova();
    const mdot = (t.rate * MSUN) / YEAR;
    const aCm = t.aAu * AU_CM;
    const m1 = t.m1 * MSUN, r1 = t.accretorRadius * aCm;

    if (t.discOuter > 0) {
      const inner = Math.max(t.discInner, t.accretorRadius * 1.02);
      // Colours follow the temperature at the disc's current accretion rate, and brightness is
      // measured against the hottest it gets (a dwarf nova's outburst peak), so a quiet disc is dim and red.
      const peak = ((t.dwarfNova?.peakRate ?? t.rate) * MSUN) / YEAR;
      const tRef = discTemperature(Math.max(inner, t.accretorRadius * 1.37) * aCm, m1, r1, peak);
      this.discTint = (rate: number) => (r: number) => {
        const temp = discTemperature(Math.max(r, t.accretorRadius * 1.37) * aCm, m1, r1, rate);
        const c = kelvinToRgb(Math.max(1500, Math.min(40000, temp)));
        // Brightness ~ T⁴, compressed so the cool outer disc still shows.
        const b = Math.min(1, 0.22 + 1.1 * Math.pow(temp / tRef, 1.2));
        const edge = 1 - THREE.MathUtils.smoothstep(r / t.discOuter, 0.9, 1.001);
        return [c[0] * b * edge, c[1] * b * edge, c[2] * b * edge];
      };
      this.disc = ringMesh(inner, t.discOuter, [0, 0, 0], this.discTint(mdot), 0.9);
      this.lastDiscRate = mdot;
      this.frame.add(this.disc);
      this.meshes.push(this.disc);
      // Light-curve samples: rings log-spaced in radius, each split in azimuth.
      const NR = 24, NA = 36;
      for (let i = 0; i < NR; i++) {
        const ra = inner * Math.pow(t.discOuter / inner, i / NR), rb = inner * Math.pow(t.discOuter / inner, (i + 1) / NR);
        const r = Math.sqrt(ra * rb);
        const rc = r * aCm;
        // σT⁴ per unit Ṁ (Shakura–Sunyaev) times the area of the cell.
        const flux = ((3 * G_CGS * m1) / (8 * Math.PI * rc ** 3)) * Math.max(0, 1 - Math.sqrt(r1 / rc));
        const area = ((Math.PI * (rb * rb - ra * ra)) / NA) * aCm * aCm;
        for (let k = 0; k < NA; k++) {
          const phi = (2 * Math.PI * (k + 0.5)) / NA;
          this.samples.push({ x: r * Math.cos(phi), y: r * Math.sin(phi), w: flux, area });
        }
      }
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

  /** A nova's shell: clumps of gas on a thin sphere (unit radius, scaled as it expands), and the flash. */
  private makeNova(): void {
    const rand = mulberry32(7);
    const n = 1400;
    const pos = new Float32Array(n * 3);
    // Clumpy: points gather round a few dozen knots, as in imaged nova shells.
    const knots: [number, number, number][] = [];
    for (let k = 0; k < 40; k++) {
      const z = 2 * rand() - 1, ph = 2 * Math.PI * rand(), s = Math.sqrt(1 - z * z);
      knots.push([s * Math.cos(ph), s * Math.sin(ph), z]);
    }
    for (let i = 0; i < n; i++) {
      let v: [number, number, number];
      if (rand() < 0.6) {
        const c = knots[Math.floor(rand() * knots.length)];
        v = [c[0] + (rand() - 0.5) * 0.35, c[1] + (rand() - 0.5) * 0.35, c[2] + (rand() - 0.5) * 0.35];
      } else {
        const z = 2 * rand() - 1, ph = 2 * Math.PI * rand(), s = Math.sqrt(1 - z * z);
        v = [s * Math.cos(ph), s * Math.sin(ph), z];
      }
      const l = Math.hypot(...v) / (0.88 + 0.12 * rand());
      pos.set([v[0] / l, v[1] / l, v[2] / l], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.shell = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xffffff, size: 4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.shell.frustumCulled = false;
    this.shell.visible = false;
    this.shell.renderOrder = 6;
    this.root.add(this.shell);
    this.flash = spot(0xf4f6ff, 1);
    this.flash.visible = false;
    this.root.add(this.flash);
  }

  /**
   * Per frame: turn and scale the frame with the orbit (accretor → donor is +x, the orbit's
   * angular momentum +z), move the gas along, follow a dwarf nova's or nova's state at `simTime`
   * (years), and measure the brightness seen from `camera`.
   */
  update(accretor: Body, donor: Body, dt: number, worldPerPixel: number, simTime = 0, camera?: THREE.Vector3): void {
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
    const t = this.params;
    // The disc's accretion rate now: a dwarf nova's cycle, dimmed while a nova's ejecta clear it.
    let rate = t.dwarfNova ? discRate(t.dwarfNova, simTime) : t.rate;
    if (t.nova) rate *= discSurvival(t.nova, simTime);
    const mdot = (rate * MSUN) / YEAR;
    if (this.disc && this.discTint && Math.abs(mdot / this.lastDiscRate - 1) > 0.02) {
      retint(this.disc, this.discTint(mdot));
      this.lastDiscRate = mdot;
    }
    // The hot spot flickers, and stays visible when zoomed out.
    if (this.hot) {
      const s = Math.max(this.hotSize, (worldPerPixel * 10) / a);
      this.hot.scale.setScalar(s * (0.9 + 0.1 * Math.sin(this.time * 9.0) * Math.sin(this.time * 3.7)));
    }
    // A nova: the flash at the white dwarf and the expanding shell.
    let novaL = 0;
    if (t.nova && this.shell && this.flash) {
      novaL = novaLuminosity(t.nova, simTime);
      const r = shellRadius(t.nova, simTime);
      const days = (simTime - t.nova.startYears) * 365.25;
      this.flash.visible = novaL > 0;
      if (novaL > 0) this.flash.scale.setScalar(Math.max(a * 0.5 * Math.pow(novaL / 1e38, 0.25), worldPerPixel * 30 * Math.min(1, novaL / 1e37)));
      this.shell.visible = r > 0;
      if (r > 0) {
        this.shell.scale.setScalar(r);
        const m = this.shell.material as THREE.PointsMaterial;
        // White while the fireball is thick, then the pink-red of hydrogen-alpha as it thins.
        const k = Math.min(1, days / (2 * t.nova.t3Days));
        m.color.setRGB(1, 1 - 0.55 * k, 1 - 0.4 * k);
        m.opacity = Math.min(1, days * 4) * Math.exp(-Math.max(0, days - t.nova.t3Days) / (4 * t.nova.t3Days));
      }
    }
    // The nova in visible light, in Suns, from its absolute V magnitude (the Sun's is 4.83).
    const novaMag = t.nova ? novaMagnitude(t.nova, simTime) : undefined;
    if (camera) this.measure(accretor, donor, mdot, novaMag === undefined ? 0 : Math.pow(10, -0.4 * (novaMag - 4.83)), camera);
  }

  /**
   * The brightness in visible light (V, 550 nm) seen from the camera, in units of the Sun's: each
   * part shines as a blackbody, σT⁴ → Planck at 550 nm. The disc (each cell at its Shakura–Sunyaev
   * temperature, foreshortened), the white dwarf and where the gas lands on it, the hot spot, the
   * donor and a nova's flash, less whatever the donor hides (an eclipse). X-rays from neutron stars
   * and black holes don't count: this is the light an optical telescope sees.
   */
  private measure(accretor: Body, donor: Body, mdot: number, novaSuns: number, camera: THREE.Vector3): void {
    const t = this.params;
    this.u.set(camera.x - accretor.x, camera.y - accretor.y, camera.z - accretor.z).normalize();
    // The view direction in the corotating frame.
    const ux = this.u.dot(this.x), uy = this.u.dot(this.y), uz = this.u.dot(this.z);
    const rd2 = t.donorRadius * t.donorRadius;
    const hidden = (px: number, py: number, pz: number) => {
      const dx = 1 - px, dy = -py, dz = -pz;
      const along = dx * ux + dy * uy + dz * uz;
      return along > 0 && dx * dx + dy * dy + dz * dz - along * along < rd2;
    };
    // Everything as area × Planck(550 nm, T) (the constants cancel against the Sun's).
    let seen = 0;
    // The disc: per steradian a cell gives B dA |cos θ|; 4π times that. Real discs flare
    // (H/R ≈ 0.06), so seen edge-on the rim still shows, and it hides the white dwarf.
    const tilt = Math.abs(uz);
    if (this.samples.length && mdot > 0) {
      let sum = 0;
      for (const s of this.samples) if (!hidden(s.x, s.y, 0)) sum += s.area * planckV(Math.pow((s.w * mdot) / SIGMA, 0.25));
      // Both faces' worth of isotropic-equivalent light: 4 (|cos θ| + flare) × Σ B dA, over 4π × π.
      seen += (4 * (tilt + DISC_FLARE) * sum) / Math.PI;
    }
    const rimHides = this.samples.length ? THREE.MathUtils.smoothstep(tilt, DISC_FLARE, 2.5 * DISC_FLARE) : 1;
    const aCm = t.aAu * AU_CM;
    const r1 = t.accretorRadius * aCm;
    const gm = G_CGS * t.m1 * MSUN;
    const transferMdot = (t.rate * MSUN) / YEAR;
    if (!hidden(0, 0, 0)) {
      let star = 0;
      if (t.accretorKind === 'whitedwarf') {
        // Its surface, and where the gas lands: half of GMṀ/R in a disc's boundary layer, all of it
        // in a polar's column, from a spot a twentieth of the surface (hot, so mostly ultraviolet).
        star += 4 * Math.PI * r1 * r1 * planckV(WD_TEMPERATURE);
        const landing = t.discOuter > 0 ? (0.5 * gm * mdot) / r1 : (gm * transferMdot) / r1;
        const spotArea = 0.05 * 4 * Math.PI * r1 * r1;
        if (landing > 0) star += spotArea * planckV(Math.pow(landing / (SIGMA * spotArea), 0.25));
      }
      seen += star * rimHides + novaSuns * SUN_V;
    }
    // The hot spot (about 12,000 K), radiating the stream's fall from L1 to the rim.
    if (t.hotSpot && t.discOuter > 0 && !hidden(...t.hotSpot)) {
      const lSpot = gm * transferMdot * (1 / (t.discOuter * aCm) - 1 / (t.l1 * aCm));
      if (lSpot > 0) seen += (lSpot / (SIGMA * 12000 ** 4)) * planckV(12000);
    }
    // The donor itself (its tidal stretching and the heating of its inner face left out).
    const rDonor = t.donorRadius * aCm;
    seen += 4 * Math.PI * rDonor * rDonor * planckV(donorTemperature(donor));
    this.seenLuminosity = seen / SUN_V;
  }

  dispose(): void {
    for (const f of this.flows) f.dispose();
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    for (const s of this.sprites) s.material.dispose();
    if (this.shell) {
      this.shell.geometry.dispose();
      (this.shell.material as THREE.Material).dispose();
    }
    this.flash?.material.dispose();
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
