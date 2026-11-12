import * as THREE from 'three';
import { beamHalfAngleDeg, compactness, displayPeriod, lightCylinderKm, NS_RADIUS_KM, polarCapAngle, pulsarParams, spinDownPower, type PulsarParams } from '../sim/neutronStar';

/**
 * What a neutron star looks like up close (physics in sim/neutronStar.ts):
 *
 * - **Surface, through bent light.** Its gravity bends light so much that you see about three
 *   quarters of the surface at once: the shader works out, for each point of the disc, which
 *   point of the star the light really left (Beloborodov 2002). Both magnetic poles can show at
 *   the same time.
 * - **Temperature.** Heat flows more easily along the magnetic field, so the magnetic poles are
 *   warmer than the equator (Greenstein & Hartke 1983). The polar caps, where particles from the
 *   open field lines rain back down, are hotter still. At a million kelvin it glows blue-white.
 * - **Magnetic field.** A dipole tilted from the spin axis. Closed loops near the star; the open
 *   field lines over the poles stream out to the beams.
 * - **Beams.** Radio (and, in young pulsars, light and gamma rays) beamed along the magnetic axis,
 *   as wide as the radio beams measured at 1 GHz (Rankin 1993). They are drawn faintly; you would
 *   only notice one as a flash when it sweeps across you, which is when the star brightens here.
 * - **Spin.** At the real period when a screen can show it; faster pulsars are slowed to four turns
 *   a second.
 */

const SURFACE_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const SURFACE_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uView;     // direction to the camera, in the star's own (spinning) frame
  uniform vec3 uMag;      // magnetic axis, same frame
  uniform float uU;       // compactness R_s / R
  uniform float uCap;     // polar-cap angular radius (radians)
  uniform float uFlash;   // a beam pointing at us: 0…1
  varying vec3 vLocal;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vLocal);
    // Where on the disc: the ray left the surface at α to the vertical, cos α = n·view.
    float cosA = clamp(dot(n, uView), 0.0, 1.0);
    // Light bending: it left from ψ round the star, 1 − cos ψ = (1 − cos α) / (1 − u).
    float cosPsi = max(1.0 - (1.0 - cosA) / (1.0 - uU), -1.0);
    float sinPsi = sqrt(max(0.0, 1.0 - cosPsi * cosPsi));
    vec3 t = n - uView * cosA;
    float tl = length(t);
    t = tl > 1e-6 ? t / tl : vec3(0.0);
    vec3 s = uView * cosPsi + t * sinPsi;
    float cb = dot(s, uMag);
    // Warmer magnetic poles: the light given off (∝ T⁴) goes as cos²θ + 0.25 sin²θ in the
    // magnetic colatitude θ.
    float flux = cb * cb + 0.25 * (1.0 - cb * cb);
    // Hot polar caps.
    float theta = acos(min(abs(cb), 1.0));
    float cap = 1.0 - smoothstep(uCap * 0.6, uCap * 1.4, theta);
    // A hydrogen atmosphere beams its light outwards: darker towards the limb.
    float limb = 0.45 + 0.55 * cosA;
    vec3 col = vec3(0.62, 0.78, 1.25) * (0.3 + 0.7 * flux) * limb;
    col = mix(col, vec3(1.0, 1.0, 1.0) * 2.2, cap);
    col *= 1.0 + uFlash * 0.8;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * A beam as glowing gas: its brightness at each pixel is the light gathered along the line of
 * sight through a Gaussian tube around the beam's axis (local y, from 0 at the star to 1 at its
 * end), worked out at the point where the sight line passes closest to the axis. Looking down the
 * beam the path through it is long, so it blazes. Drawn on the back faces of a hull, once a pixel.
 */
const BEAM_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uCam;        // camera position in the beam's frame
  uniform float uWidth;     // tan of the beam's half-angle
  uniform float uIntensity;
  varying vec3 vLocal;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vLocal - uCam);
    // Closest approach between the sight line (uCam + t d) and the axis (0, y, 0).
    float b = d.y;
    float den = max(1.0 - b * b, 1e-4);
    float t = max((b * uCam.y - dot(d, uCam)) / den, 0.0);
    float y = clamp(uCam.y + t * d.y, 0.0, 1.0);
    // Axis point and the sight line's nearest point to it.
    vec3 axisP = vec3(0.0, y, 0.0);
    float tc = max(dot(axisP - uCam, d), 0.0);
    float dist = length(uCam + d * tc - axisP);
    float sinT = sqrt(den);
    // A bright core and a wider blue halo; both widen with distance from the star.
    float wCore = max(y * uWidth * 0.22, 0.003);
    float wHalo = max(y * uWidth * 0.75, 0.01);
    float along = pow(1.0 - y, 1.8) * (0.35 + 0.65 * exp(-y * 5.0)) * smoothstep(0.0, 0.01, y);
    float path = 1.0 / max(sinT, 0.2);
    float core = exp(-pow(dist / wCore, 2.0)) * along * path;
    float halo = exp(-pow(dist / wHalo, 2.0)) * along * path * 0.16;
    vec3 col = (vec3(0.85, 0.93, 1.0) * core + vec3(0.32, 0.55, 1.0) * halo) * uIntensity;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Beyond the light cylinder the field can't keep up with the star and is wound into a spiral
 * that streams away (the "striped wind"). Drawn as a disc of spiral streaks in the spin equator,
 * turning with the star, much closer in than to scale.
 */
const WIND_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vXY;
  void main() {
    vXY = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const WIND_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uPitch;    // radii per turn of the spiral (2π × the drawn light cylinder)
  uniform float uOpacity;
  uniform float uSeed;
  varying vec2 vXY;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i + uSeed), hash(i + 1.0 + uSeed), f); }
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(vXY);
    float phi = atan(vXY.y, vXY.x);
    // Spiral coordinate: constant along a wound field line, φ + 2π r / pitch.
    float s = phi + 6.2831853 * r / uPitch;
    // Fine streaks along the spiral, with patchy brightness along them.
    float streak = 0.0;
    for (int k = 0; k < 2; k++) {
      float n = float(k);
      float f = 9.0 + n * 14.0;
      float v = 0.5 + 0.5 * cos(f * s + 1.2 * noise1(r * 0.6 + n * 3.1));
      streak += pow(v, 6.0 + n * 6.0) * (0.4 + 0.9 * noise1(s * 3.0 + n * 7.0)) * (1.0 - 0.4 * n);
    }
    float fade = smoothstep(1.1, 2.2, r) * exp(-r / (uPitch * 0.45)) * (1.0 - smoothstep(0.7, 1.0, r / (uPitch * 1.6)));
    float a = streak * fade * uOpacity;
    gl_FragColor = vec4(vec3(0.55, 0.72, 1.0) * a, 1.0);
  }
`;

/**
 * A pulsar wind nebula (young, powerful pulsars such as the Crab and Vela): the wind is stopped in
 * a shock and glows by synchrotron light. Chandra images show the same pattern in both: a torus in
 * the spin equator, a thin inner ring of knots, and jets along the spin axis (Weisskopf et al.
 * 2000; Helfand et al. 2001). Ray-marched in a sphere (local units: radius 1, y = spin axis). The
 * gas flows out at about half light speed, so the side coming towards us is brighter (Doppler
 * boosting, δ^(2+α)).
 */
const PWN_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const PWN_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uCam;       // camera position in the nebula's frame
  uniform float uBright;
  uniform float uTime;
  varying vec3 vLocal;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float emission(vec3 p, vec3 toCam) {
    float rho = length(p.xz);
    float ang = atan(p.z, p.x);
    // Doppler boosting of gas flowing outwards in the equator at 0.5 c.
    vec3 flow = rho > 1e-4 ? vec3(p.x, 0.0, p.z) / rho : vec3(0.0);
    float beta = 0.5;
    float delta = 1.0 / (1.1547 * (1.0 - beta * dot(flow, toCam)));
    float boost = pow(delta, 2.6);
    // Torus: a thick, wispy ring.
    float torus = exp(-(pow(rho - 0.48, 2.0) + p.y * p.y * 2.2) / 0.012) * (0.55 + 0.9 * noise(vec3(ang * 3.0, p.y * 8.0, uTime * 0.05)));
    // Inner ring of knots.
    float ring = exp(-(pow(rho - 0.2, 2.0) + p.y * p.y * 6.0) / 0.0008) * (0.4 + 1.4 * pow(noise(vec3(ang * 9.0, 0.0, uTime * 0.1)), 3.0));
    // Jets along the spin axis, gently kinked; the one coming towards us brighter.
    float kink = 0.04 * sin(p.y * 9.0 + uTime * 0.3);
    float jr = length(vec2(p.x - kink, p.z));
    float jet = exp(-jr * jr / (0.0015 + 0.004 * abs(p.y))) * smoothstep(0.05, 0.12, abs(p.y)) * (1.0 - smoothstep(0.55, 0.95, abs(p.y)));
    jet *= 0.8 + 0.6 * noise(vec3(0.0, p.y * 12.0 - uTime * 0.4, 0.0));
    float jetDelta = 1.0 / (1.1547 * (1.0 - 0.5 * sign(p.y) * toCam.y));
    // Faint synchrotron haze filling the bubble.
    float r = length(p);
    float haze = exp(-r * r / 0.18) * 0.12 * (0.6 + 0.8 * noise(p * 4.0));
    return (torus * 1.2 + ring * 1.6 + haze) * boost + jet * 1.3 * pow(jetDelta, 2.6);
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 ro = uCam;
    vec3 rd = normalize(vLocal - uCam);
    float b = dot(ro, rd);
    float c = dot(ro, ro) - 1.0;
    float disc = b * b - c;
    if (disc <= 0.0) discard;
    float sq = sqrt(disc);
    float t0 = max(-b - sq, 0.0), t1 = -b + sq;
    if (t1 <= t0) discard;
    const int STEPS = 56;
    float dt = (t1 - t0) / float(STEPS);
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float sum = 0.0;
    vec3 toCam = -rd;
    for (int i = 0; i < STEPS; i++) {
      vec3 p = ro + rd * (t0 + (float(i) + jitter) * dt);
      sum += emission(p, toCam) * dt;
    }
    vec3 col = vec3(0.7, 0.82, 1.0) * sum * uBright;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Dipole field lines r = L sin²θ (in star radii), in the magnetic frame (y = magnetic axis). */
export function dipoleLines(): { positions: Float32Array; colors: Float32Array } {
  const pos: number[] = [];
  const col: number[] = [];
  const segment = (pts: THREE.Vector3[], bright: number, fadeOut: boolean) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      for (const k of [i, i + 1]) {
        pos.push(pts[k].x, pts[k].y, pts[k].z);
        const f = fadeOut ? bright * (1 - k / pts.length) : bright;
        col.push(0.45 * f, 0.7 * f, 1.0 * f);
      }
    }
  };
  const point = (L: number, theta: number, phi: number) => {
    const r = L * Math.sin(theta) ** 2;
    return new THREE.Vector3(r * Math.sin(theta) * Math.cos(phi), r * Math.cos(theta), r * Math.sin(theta) * Math.sin(phi));
  };
  for (let a = 0; a < 6; a++) {
    const phi = (a / 6) * Math.PI * 2;
    // Closed loops.
    for (const L of [1.8, 3, 5, 8]) {
      const t0 = Math.asin(Math.sqrt(1 / L));
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 48; i++) pts.push(point(L, t0 + ((Math.PI - 2 * t0) * i) / 48, phi));
      segment(pts, 0.5 / Math.sqrt(L), false);
    }
    // Open field lines from each polar cap, flaring out towards the beams.
    for (const L of [40, 120]) {
      const t0 = Math.asin(Math.sqrt(1 / L));
      for (const north of [true, false]) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 40; i++) {
          const th = t0 * (1 + i * 0.06);
          const p = point(L, north ? th : Math.PI - th, phi);
          if (p.length() > 16) break;
          pts.push(p);
        }
        segment(pts, 0.55, true);
      }
    }
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col) };
}

/** Beam length in star radii (drawn). */
const BEAM_LENGTH = 60;
/** Wind-nebula radius in star radii (drawn). */
const NEBULA_RADIUS = 45;

export class NeutronStarVisual {
  /** Add to the body's spin group (whose y axis is the spin axis). */
  readonly root = new THREE.Group();
  /** The material for the star's own sphere. */
  readonly surface: THREE.ShaderMaterial;
  readonly params: PulsarParams;
  /** Rotation angle (radians); the body's sphere must turn with it. */
  phase = 0;
  /** How strongly a beam points at the camera (0…1), for the flash. */
  flash = 0;
  private readonly magnet = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly beams: THREE.Mesh[] = [];
  private readonly wind: THREE.Mesh;
  /** The pulsar wind nebula, if it has one. Not spinning: counter-turned against the star. */
  private nebula?: THREE.Mesh;
  private time = 0;
  private readonly beamAngle: number;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(name: string, id: number, mass: number) {
    this.params = pulsarParams(name, id);
    const alpha = (this.params.obliquity * Math.PI) / 180;
    this.magnet.rotation.z = alpha;
    this.root.add(this.magnet);
    const mag = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), alpha);
    this.surface = new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERTEX,
      fragmentShader: SURFACE_FRAGMENT,
      uniforms: {
        uView: { value: new THREE.Vector3(0, 0, 1) },
        uMag: { value: mag },
        uU: { value: Math.min(0.49, compactness(mass)) },
        // Real caps are a few degrees across for ordinary pulsars; at least 4° so they show.
        uCap: { value: Math.max(polarCapAngle(this.params.period), (4 * Math.PI) / 180) },
        uFlash: { value: 0 },
      },
    });
    const { positions, colors } = dipoleLines();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.magnet.add(this.lines);
    // The beams along the magnetic axis: glowing tubes as wide as the radio beam.
    this.beamAngle = (Math.min(25, beamHalfAngleDeg(this.params.period)) * Math.PI) / 180;
    const tanW = Math.tan(this.beamAngle);
    // The hull is a closed cone a little wider than the halo; the shader does the rest.
    const hull = new THREE.CylinderGeometry(tanW * 1.6 + 0.03, 0.03, 1, 32, 1, false).translate(0, 0.5, 0);
    for (const dir of [1, -1]) {
      const material = new THREE.ShaderMaterial({
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        uniforms: { uCam: { value: new THREE.Vector3() }, uWidth: { value: tanW }, uIntensity: { value: 0.85 } },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      });
      const beam = new THREE.Mesh(hull, material);
      if (dir < 0) beam.rotation.x = Math.PI;
      beam.frustumCulled = false;
      this.beams.push(beam);
      this.magnet.add(beam);
    }
    // The wound field (striped wind) in the spin equator, turning with the star.
    const pitch = THREE.MathUtils.clamp(lightCylinderKm(this.params.period) / NS_RADIUS_KM, 1.2, 2.2) * Math.PI * 2;
    this.wind = new THREE.Mesh(
      new THREE.RingGeometry(1.1, pitch * 1.6, 160, 24).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        vertexShader: WIND_VERTEX,
        fragmentShader: WIND_FRAGMENT,
        uniforms: { uPitch: { value: pitch }, uOpacity: { value: 0.45 }, uSeed: { value: (id % 97) * 1.7 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.root.add(this.wind);
    // A wind nebula around pulsars powerful enough to blow one (Ė > 10²⁹ W, as the Crab's
    // 4.5 × 10³¹ W and Vela's 7 × 10²⁹ W).
    const edot = this.params.pdot > 0 ? spinDownPower(this.params.period, this.params.pdot) : 0;
    if (edot > 1e29) {
      this.nebula = new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 16),
        new THREE.ShaderMaterial({
          vertexShader: PWN_VERTEX,
          fragmentShader: PWN_FRAGMENT,
          uniforms: { uCam: { value: new THREE.Vector3() }, uBright: { value: THREE.MathUtils.clamp((Math.log10(edot) - 29) / 2.7, 0.55, 1) * 1.4 }, uTime: { value: 0 } },
          transparent: true,
          depthWrite: false,
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      this.nebula.frustumCulled = false;
      this.root.add(this.nebula);
    }
  }

  /**
   * Per frame: turn the star, size the field lines (`r`, its drawn radius) and beams, aim the
   * shading at the camera. Returns the flash (0…1).
   */
  update(r: number, camera: THREE.Vector3, dt: number, mesh: THREE.Object3D): number {
    this.phase = (this.phase + (dt * Math.PI * 2) / displayPeriod(this.params.period)) % (Math.PI * 2);
    this.root.rotation.y = this.phase;
    mesh.rotation.y = this.phase;
    this.magnet.scale.setScalar(r);
    for (const b of this.beams) b.scale.setScalar(BEAM_LENGTH);
    this.wind.scale.setScalar(r);
    this.time += dt;
    if (this.nebula) {
      // Drawn much closer in than to scale (the Crab's torus is 10¹³ times the star's radius).
      this.nebula.scale.setScalar(r * NEBULA_RADIUS);
      this.nebula.rotation.y = -this.phase;
      const m = this.nebula.material as THREE.ShaderMaterial;
      this.nebula.updateWorldMatrix(true, false);
      m.uniforms.uCam.value.copy(this.nebula.worldToLocal(this.tmp.copy(camera)));
      m.uniforms.uTime.value = this.time;
    }
    // The camera's direction in the star's frame, for the bent-light shading.
    mesh.updateWorldMatrix(true, false);
    const local = mesh.worldToLocal(this.tmp.copy(camera)).normalize();
    (this.surface.uniforms.uView.value as THREE.Vector3).copy(local);
    // The lighthouse: how close a beam points to us (a little wider than the beam, so a frame
    // catches it even when the star turns fast).
    const away = this.tmp.copy(camera).sub(this.tmp2.setFromMatrixPosition(mesh.matrixWorld)).normalize();
    this.magnet.updateWorldMatrix(true, false);
    const axis = this.tmp2.set(0, 1, 0).transformDirection(this.magnet.matrixWorld);
    const gamma = Math.acos(Math.min(1, Math.abs(axis.dot(away))));
    for (const b of this.beams) {
      b.updateWorldMatrix(true, false);
      (b.material as THREE.ShaderMaterial).uniforms.uCam.value.copy(b.worldToLocal(this.tmp2.copy(camera)));
    }
    const width = Math.max(this.beamAngle, 0.26);
    this.flash = Math.exp(-((gamma / width) ** 2) * 2);
    this.surface.uniforms.uFlash.value = this.flash;
    return this.flash;
  }

  dispose(): void {
    this.surface.dispose();
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    this.beams[0]?.geometry.dispose();
    for (const b of this.beams) (b.material as THREE.Material).dispose();
    this.wind.geometry.dispose();
    if (this.nebula) {
      this.nebula.geometry.dispose();
      (this.nebula.material as THREE.Material).dispose();
    }
    (this.wind.material as THREE.Material).dispose();
  }
}
