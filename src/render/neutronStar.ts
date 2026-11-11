import * as THREE from 'three';
import { beamHalfAngleDeg, compactness, displayPeriod, polarCapAngle, pulsarParams, type PulsarParams } from '../sim/neutronStar';

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
    vec3 col = vec3(0.38, 0.5, 0.85) * (0.2 + 0.8 * flux) * limb;
    col = mix(col, vec3(0.95, 0.97, 1.0) * 1.6, cap);
    col *= 1.0 + uFlash * 0.8;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const BEAM_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 nrm = normalize(normalMatrix * normal);
    vFacing = abs(dot(nrm, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    #include <logdepthbuf_fragment>
    // Brightest near the star; a hollow cone, so brighter where we look along its wall.
    float along = vUv.y;
    float a = pow(1.0 - along, 1.6) * smoothstep(0.0, 0.04, along) * (0.35 + 0.65 * (1.0 - vFacing)) * uOpacity;
    gl_FragColor = vec4(vec3(0.62, 0.82, 1.0) * a, a);
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
  private readonly beamMaterial: THREE.ShaderMaterial;
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
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.magnet.add(this.lines);
    // The beams: hollow cones along the magnetic axis, as wide as the radio beam.
    this.beamAngle = (Math.min(40, beamHalfAngleDeg(this.params.period)) * Math.PI) / 180;
    const cone = new THREE.CylinderGeometry(Math.tan(this.beamAngle), 0, 1, 40, 1, true).translate(0, 0.5, 0);
    this.beamMaterial = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      uniforms: { uOpacity: { value: 0.45 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    for (const dir of [1, -1]) {
      const beam = new THREE.Mesh(cone, this.beamMaterial);
      if (dir < 0) beam.rotation.x = Math.PI;
      this.beams.push(beam);
      this.magnet.add(beam);
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
    for (const b of this.beams) b.scale.set(30, 30, 30);
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
    this.beamMaterial.dispose();
  }
}
