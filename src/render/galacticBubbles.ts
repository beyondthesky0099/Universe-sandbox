import * as THREE from 'three';
import { UNITS_PER_KPC } from '../procgen/galaxy';
import { textSprite } from './galaxyView';

/**
 * Two pairs of giant bubbles above and below the Milky Way's centre, blown by an outburst from
 * the centre a few million years ago (from its black hole or a burst of star formation):
 *
 * - the Fermi bubbles, in gamma rays: each about 25,000 light-years (7.7 kpc) tall and ~40° wide
 *   as seen from here (Su, Slatyer & Finkbeiner 2010, ApJ 724, 1044);
 * - the eROSITA bubbles, in X-rays, around them: each about 14 kpc tall (Predehl et al. 2020,
 *   Nature 588, 227).
 *
 * Drawn as rim-lit ellipsoids standing on the Galactic Centre, narrowing to their base; the real
 * edges are more irregular. Galaxy map frame: the centre at the origin, y towards the north
 * galactic pole, in map units (UNITS_PER_KPC per kpc).
 */
const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;
const FRAGMENT = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    #include <logdepthbuf_fragment>
    float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.2);
    gl_FragColor = vec4(uColor * (0.04 + 0.6 * rim) * uOpacity, 1.0);
  }
`;

/** An ellipsoid of half-height h and half-width w (kpc) standing on the origin, pinched at its base. */
function bubble(w: number, h: number, up: number, color: THREE.Color): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1, 48, 32);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); // −1 (base) … 1 (top)
    // Narrower towards the base, like the observed bubbles' "hourglass" waist.
    const pinch = 0.45 + 0.55 * Math.sqrt((y + 1) / 2);
    p.setXYZ(i, p.getX(i) * w * pinch, (y + 1) * h * up, p.getZ(i) * w * pinch);
  }
  geo.computeVertexNormals();
  geo.scale(UNITS_PER_KPC, UNITS_PER_KPC, UNITS_PER_KPC);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uColor: { value: color }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  mesh.renderOrder = -1;
  return mesh;
}

export class GalacticBubbles {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly labels: THREE.Sprite[] = [];

  constructor() {
    const fermi = new THREE.Color(0.85, 0.45, 1.0);
    const erosita = new THREE.Color(0.35, 0.9, 0.85);
    for (const up of [1, -1]) {
      this.meshes.push(bubble(3.0, 3.85, up, fermi), bubble(6.0, 7.0, up, erosita));
    }
    this.group.add(...this.meshes);
    const fl = textSprite('Fermi bubbles (gamma rays) · 25,000 ly tall', '#e0a8ff', 0.85);
    fl.position.set(0, 8.2 * UNITS_PER_KPC, 0);
    const el = textSprite('eROSITA bubbles (X-rays) · 45,000 ly tall', '#8ff0e4', 0.85);
    el.position.set(0, 14.6 * UNITS_PER_KPC, 0);
    this.labels.push(fl, el);
    this.group.add(fl, el);
  }

  /** Show for the Milky Way only, fading in once the view is out at their scale. */
  update(camera: THREE.Camera, milkyWay: boolean): void {
    this.group.visible = milkyWay;
    if (!milkyWay) return;
    const d = camera.position.length() / UNITS_PER_KPC;
    const k = THREE.MathUtils.smoothstep(d, 6, 20);
    for (const m of this.meshes) (m.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.5 * k;
    for (const l of this.labels) l.visible = k > 0.3;
  }
}
