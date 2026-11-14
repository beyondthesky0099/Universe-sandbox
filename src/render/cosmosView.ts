import * as THREE from 'three';
import { LabelDeclutter } from './labelDeclutter';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  COSMIC_STRUCTURES,
  type CosmosKind,
  displayName,
  galacticToCosmos,
  galaxyForm,
  isFamous,
  localPosition,
  webPosition,
  type GalaxyForm,
  type LocalGalaxy,
  type WebCatalog,
} from '../sim/galaxies';
import { labelHitDepth, textSprite } from './galaxyView';
import { ringTexture } from './textures';
import { relativity, RELATIVITY_PARS } from './relativity';
import { GalaxyShapes } from './galaxyShapes';

/**
 * The Universe map: real galaxies around the Milky Way, in megaparsecs. The Local Volume
 * (Karachentsev et al.) is drawn at true diameters and is clickable; the 2MASS Redshift Survey
 * shows the cosmic web out to ~200 Mpc.
 */

const VERTEX = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  uniform float uScale;
  uniform float uMinSize;
  uniform float uMaxSize;
  uniform float uPxPerUnit;
  varying vec3 vColor;
  varying float vFade;
  ${RELATIVITY_PARS}
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Near light speed: aberration, Doppler colour and beaming (relativity.ts).
    float relD = relAberrate(mv);
    vColor = relShift(color, relD);
    gl_PointSize = clamp(size * uScale / -mv.z, uMinSize, uMaxSize);
    // Once the galaxy is more than a few pixels across its drawn shape (galaxyShapes.ts) takes over.
    float truePx = (size / 1.6) * uPxPerUnit / max(-mv.z, 1e-9);
    vFade = 1.0 - smoothstep(4.0, 11.0, truePx);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float a = (exp(-d * 5.0) + 0.25 * exp(-d * 1.2)) * (1.0 - smoothstep(0.6, 1.0, d));
    gl_FragColor = vec4(vColor, a * uOpacity * vFade);
  }
`;

/** A thin ring with a faint fill: the extent of a galaxy cluster. */
const RING_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float ring = smoothstep(0.62, 0.78, d) * (1.0 - smoothstep(0.86, 1.0, d));
    float a = 0.08 * (1.0 - d) + 0.9 * ring;
    gl_FragColor = vec4(vColor, a * uOpacity);
  }
`;

function material(opacity: number, minSize: number, maxSize: number, ring = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: ring ? RING_FRAGMENT : FRAGMENT,
    uniforms: { uScale: { value: 300 }, uOpacity: { value: opacity }, uMinSize: { value: minSize }, uMaxSize: { value: maxSize }, uPxPerUnit: { value: 1000 }, uBeta: relativity.uBeta },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}

const FORM_COLOR: Record<GalaxyForm, [number, number, number]> = {
  spiral: [0.72, 0.82, 1],
  elliptical: [1, 0.84, 0.6],
  lenticular: [0.95, 0.88, 0.72],
  irregular: [0.62, 0.78, 1],
  'dwarf spheroidal': [0.85, 0.78, 0.66],
};

/** Comoving distance to the last-scattering surface: ~14 Gpc, about 46 billion light-years. */
export const CMB_RADIUS_MPC = 14000;

const CMB_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Look up the equirectangular galactic map (u = l / 360°, v = 0.5 + b / 180°) from the direction. */
const CMB_FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform float uOpacity;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    // Map frame (x, y, z) = galactic (x, z, -y).
    float gx = d.x, gy = -d.z, gz = d.y;
    float l = atan(gy, gx);
    if (l < 0.0) l += 6.28318530718;
    float b = asin(clamp(gz, -1.0, 1.0));
    vec2 uv = vec2(l / 6.28318530718, 0.5 + b / 3.14159265359);
    gl_FragColor = vec4(texture2D(map, uv).rgb * uOpacity, 1.0);
  }
`;

interface Label {
  sprite: THREE.Sprite;
  /** Visible while the camera distance (Mpc) is within this range. */
  min: number;
  max: number;
  /** The layer it belongs to, when it can be switched off. */
  kind?: CosmosKind;
}

const KIND_COLOR: Record<CosmosKind, string> = { galaxy: '#cfe3ff', cluster: '#ffb38a', quasar: '#d9b8ff', seyfert: '#ff9ad6', blazar: '#9ff5d8' };
/** Point colours of the active nuclei: quasars violet, Seyferts and LINERs magenta, blazars mint. */
const AGN_RGB: Partial<Record<CosmosKind, [number, number, number]>> = { quasar: [0.82, 0.66, 1.0], seyfert: [1.0, 0.55, 0.82], blazar: [0.6, 1.0, 0.85] };

export class CosmosView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly declutter = new LabelDeclutter();
  readonly controls: OrbitControls;
  local: LocalGalaxy[] = [];
  selected = -1;

  private positions = new Float32Array(0);
  private readonly kindPoints = new Map<CosmosKind, THREE.Points>();
  private readonly kindVisible: Record<CosmosKind, boolean> = { galaxy: true, cluster: true, quasar: true, seyfert: true, blazar: true };
  private webPoints?: THREE.Points;
  private shapes?: GalaxyShapes;
  private readonly labels: Label[] = [];
  private readonly marker: THREE.Sprite;
  private pointScale = 300;
  private pxPerUnit = 1000;
  private cmb?: THREE.Mesh;
  private cmbVisible = true;
  private anim?: { fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromPos: THREE.Vector3; toPos: THREE.Vector3; t: number; speed: number };

  constructor(domElement: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(55, 1, 1e-5, 1e5);
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 1.4;
    this.controls.minDistance = 0.004;
    this.controls.maxDistance = 40000; // far enough to see the whole observable universe from outside
    this.controls.enabled = false;
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: 0x5ea7ff, sizeAttenuation: false, depthTest: false, transparent: true }));
    this.marker.scale.setScalar(0.05);
    this.marker.visible = false;
    this.marker.renderOrder = 10;
    this.scene.add(this.marker);
    this.resetCamera();
  }

  resetCamera(): void {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0.6, 1.4, 2.4);
    this.controls.update();
  }

  /** Build the map from the catalogues: galaxies, rich clusters, quasars, Seyferts and blazars (and, once loaded, the redshift survey). */
  setLocal(galaxies: LocalGalaxy[]): void {
    this.local = galaxies;
    const n = galaxies.length;
    this.positions = new Float32Array(n * 3);
    galaxies.forEach((g, i) => this.positions.set(localPosition(g), i * 3));
    for (const pts of this.kindPoints.values()) {
      this.scene.remove(pts);
      pts.geometry.dispose();
    }
    this.kindPoints.clear();
    const kinds: CosmosKind[] = ['galaxy', 'cluster', 'quasar', 'seyfert', 'blazar'];
    for (const kind of kinds) {
      const idx = galaxies.map((_, i) => i).filter((i) => (galaxies[i].kind ?? 'galaxy') === kind);
      if (!idx.length) continue;
      const pos = new Float32Array(idx.length * 3);
      const col = new Float32Array(idx.length * 3);
      const size = new Float32Array(idx.length);
      idx.forEach((i, k) => {
        const g = galaxies[i];
        pos.set(this.positions.subarray(i * 3, i * 3 + 3), k * 3);
        if (kind === 'galaxy') {
          const [r, gr, b] = FORM_COLOR[galaxyForm(g)];
          const bright = THREE.MathUtils.clamp(((g.lk ?? 7) - 4.5) / 6, 0.25, 1);
          col.set([r * bright, gr * bright, b * bright], k * 3);
          // Real diameter (kpc → Mpc); the Milky Way is about 30 kpc across.
          size[k] = ((g.name === 'Milky Way' ? 30 : (g.size ?? 1)) / 1000) * 1.6;
        } else if (kind === 'cluster') {
          // The Abell radius is about 2 Mpc; richer clusters draw a little bolder.
          const bold = 0.6 + 0.1 * (g.rich ?? 0);
          col.set([1.0 * bold, 0.62 * bold, 0.35 * bold], k * 3);
          size[k] = 4;
        } else {
          const record = !!g.note;
          const bright = record ? 1 : THREE.MathUtils.clamp((18.5 - (g.vmag ?? 17)) / 6, 0.45, 1);
          const [cr, cg, cb] = AGN_RGB[kind] ?? AGN_RGB.quasar!;
          col.set([cr * bright, cg * bright, cb * bright], k * 3);
          size[k] = record ? 1.2 : g.bh ? 0.8 : 0.5;
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
      const pts = new THREE.Points(geo, kind === 'galaxy' ? material(1, 2.2, 90) : kind === 'cluster' ? material(0.5, 5, 400, true) : material(0.9, 1.8, 7));
      pts.frustumCulled = false;
      pts.renderOrder = kind === 'cluster' ? 3 : 5;
      pts.visible = this.kindVisible[kind];
      this.kindPoints.set(kind, pts);
      this.scene.add(pts);
    }
    // Each galaxy's drawn shape: an oriented disc or spheroid, shown once it is big enough on screen.
    if (this.shapes) {
      this.scene.remove(this.shapes.mesh);
      this.shapes.dispose();
    }
    this.shapes = new GalaxyShapes(galaxies.filter((g) => (g.kind ?? 'galaxy') === 'galaxy'));
    this.scene.add(this.shapes.mesh);

    for (const l of this.labels) this.scene.remove(l.sprite);
    this.labels.length = 0;
    galaxies.forEach((g, i) => {
      if (!isFamous(g)) return;
      const kind = g.kind ?? 'galaxy';
      const sprite = textSprite(displayName(g), g.name === 'Milky Way' ? '#ffd36b' : KIND_COLOR[kind], 0.75);
      sprite.position.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
      sprite.userData.goto = { index: i };
      // Where labels collide, the brighter galaxy (M31 over M32, the Milky Way over its satellites)
      // or the richer cluster keeps its name; record holders always do.
      sprite.userData.priority = g.name === 'Milky Way' ? 80 : g.note ? 79 : kind === 'cluster' ? 77 + (g.rich ?? 0) * 0.4 : 76 + THREE.MathUtils.clamp((g.lk ?? 8) - 8, 0, 3);
      let min = 0;
      // Nearby companions only make sense when zoomed in; big galaxies stay labelled longer.
      let far = g.d < 0.3 ? 3 : g.d < 1.5 ? 12 : 45;
      if (kind === 'cluster') {
        min = g.d * 0.04;
        far = g.d * 6;
      } else if (g.note) {
        // Record holders: signposts once the view is out at the cosmic-web scale.
        min = 60;
        far = 1e9;
      }
      this.labels.push({ sprite, min, max: far, kind: kind === 'galaxy' ? undefined : kind });
      this.scene.add(sprite);
    });
    for (const s of COSMIC_STRUCTURES) {
      const sprite = textSprite(s.name, '#ffb38a', 0.85);
      sprite.position.set(...galacticToCosmos(s.l, s.b, s.d));
      // The Local Group is ~3 Mpc across, a rich galaxy cluster a few Mpc, a supercluster tens.
      sprite.userData.goto = { distance: s.name === 'Local Group' ? 3 : s.d < 30 ? 8 : s.d * 0.25 };
      this.labels.push({ sprite, min: s.d < 1 ? 1.5 : s.d * 0.25, max: s.d < 1 ? 40 : 5000 });
      this.scene.add(sprite);
    }
    this.applyPointScale();
  }

  /** Show or hide a layer: the rich clusters, the quasars, the Seyferts or the blazars. */
  setKindVisible(kind: CosmosKind, on: boolean): void {
    this.kindVisible[kind] = on;
    const pts = this.kindPoints.get(kind);
    if (pts) pts.visible = on;
    for (const l of this.labels) if (l.kind === kind) l.sprite.visible = on && l.sprite.visible;
  }

  kindOf(index: number): CosmosKind {
    return this.local[index]?.kind ?? 'galaxy';
  }

  /** Add the cosmic web: galaxies beyond the Local Volume, placed by redshift. */
  setWeb(cat: WebCatalog): void {
    const keep = cat.galaxies.filter((w) => w[2] / cat.H0 > 11); // nearer ones are in the Local Volume catalogue
    const pos = new Float32Array(keep.length * 3);
    const col = new Float32Array(keep.length * 3);
    const size = new Float32Array(keep.length);
    keep.forEach((w, i) => {
      pos.set(webPosition(w, cat.H0), i * 3);
      // Brighter (lower magnitude) galaxies get bigger, whiter points.
      const lum = THREE.MathUtils.clamp((11.75 - w[3]) / 4, 0, 1);
      const shade = 0.35 + 0.55 * lum;
      col.set([0.75 * shade, 0.8 * shade, shade], i * 3);
      size[i] = 0.04 + 0.12 * lum;
    });
    if (this.webPoints) {
      this.scene.remove(this.webPoints);
      this.webPoints.geometry.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    this.webPoints = new THREE.Points(geo, material(0.85, 1.3, 14));
    this.webPoints.frustumCulled = false;
    this.webPoints.renderOrder = 4;
    this.scene.add(this.webPoints);
    this.applyPointScale();
  }

  /** The cosmic microwave background (WMAP 9-year map) on a sphere at the edge of the observable universe. */
  setCmb(texture: THREE.Texture): void {
    texture.colorSpace = THREE.SRGBColorSpace;
    // No mipmaps: the longitude wrap at l = 0 would otherwise show a seam.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(CMB_RADIUS_MPC, 128, 64),
      new THREE.ShaderMaterial({ vertexShader: CMB_VERTEX, fragmentShader: CMB_FRAGMENT, uniforms: { map: { value: texture }, uOpacity: { value: 0.15 } }, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.renderOrder = -20;
    mesh.frustumCulled = false;
    mesh.visible = this.cmbVisible;
    this.cmb = mesh;
    this.scene.add(mesh);
    const sprite = textSprite('Cosmic microwave background · edge of the observable universe, 46 billion light-years', '#ffcf9a', 0.85);
    sprite.position.set(0, CMB_RADIUS_MPC * 1.02, 0);
    // Out past the edge, to see the whole observable universe inside it.
    sprite.userData.goto = { distance: CMB_RADIUS_MPC * 2.6, center: true };
    this.labels.push({ sprite, min: CMB_RADIUS_MPC * 0.8, max: 1e9 });
    this.scene.add(sprite);
  }

  setCmbVisible(on: boolean): void {
    this.cmbVisible = on;
    if (this.cmb) this.cmb.visible = on;
  }

  get webCount(): number {
    return this.webPoints ? (this.webPoints.geometry.attributes.position.count as number) : 0;
  }

  setWebVisible(on: boolean): void {
    if (this.webPoints) this.webPoints.visible = on;
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.pointScale = 0.45 * height * pixelRatio;
    this.pxPerUnit = (0.5 * height * pixelRatio) / Math.tan((this.camera.fov * Math.PI) / 360);
    this.applyPointScale();
  }

  private applyPointScale(): void {
    for (const pts of [...this.kindPoints.values(), this.webPoints]) {
      if (!pts) continue;
      const u = (pts.material as THREE.ShaderMaterial).uniforms;
      u.uScale.value = this.pointScale;
      u.uPxPerUnit.value = this.pxPerUnit;
    }
    this.shapes?.setPxPerUnit(this.pxPerUnit);
  }

  get cameraDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  /** Stop a flight in progress (a trip at speed takes over the camera). */
  cancelFlight(): void {
    this.anim = undefined;
  }

  get animating(): boolean {
    return !!this.anim;
  }

  position(index: number): THREE.Vector3 {
    return new THREE.Vector3(this.positions[index * 3], this.positions[index * 3 + 1], this.positions[index * 3 + 2]);
  }

  indexOf(name: string): number {
    return this.local.findIndex((g) => g.name === name);
  }

  select(index: number): void {
    this.selected = index;
    this.marker.visible = index !== -1;
    if (index !== -1) this.marker.position.copy(this.position(index));
  }

  /** A comfortable viewing distance for a galaxy (Mpc). */
  viewDistance(index: number): number {
    const g = this.local[index];
    const sizeMpc = (g.name === 'Milky Way' ? 30 : (g.size ?? 2)) / 1000;
    return Math.max(0.02, sizeMpc * 5);
  }

  flyTo(index: number, distance = this.viewDistance(index), speed = 0.8): void {
    const to = this.position(index);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.anim = { fromTarget: this.controls.target.clone(), toTarget: to, fromPos: this.camera.position.clone(), toPos: to.clone().add(dir.multiplyScalar(distance)), t: 0, speed };
  }

  /** Animate the camera to a point, stopping `distance` from it on the side it's looking from. */
  flyToPoint(to: THREE.Vector3, distance: number, speed = 0.8): void {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.anim = { fromTarget: this.controls.target.clone(), toTarget: to.clone(), fromPos: this.camera.position.clone(), toPos: to.clone().add(dir.multiplyScalar(distance)), t: 0, speed };
  }

  /** The label under a screen point (normalised device coordinates), nearest first, if any. */
  pickLabel(ndcX: number, ndcY: number): { name: string; index?: number; pos: THREE.Vector3; distance: number } | undefined {
    this.camera.updateMatrixWorld();
    let best: { name: string; index?: number; pos: THREE.Vector3; distance: number } | undefined;
    let bestDepth = Infinity;
    for (const { sprite } of this.labels) {
      const goto = sprite.userData.goto as { index?: number; distance?: number; center?: boolean } | undefined;
      if (!goto || !sprite.visible || !sprite.parent || sprite.material.opacity < 0.3) continue;
      const depth = labelHitDepth(sprite, this.camera, ndcX, ndcY);
      if (depth >= bestDepth) continue;
      bestDepth = depth;
      const name = String(sprite.userData.labelText).split(' · ')[0];
      best =
        goto.index !== undefined
          ? { name, index: goto.index, pos: this.position(goto.index), distance: this.viewDistance(goto.index) }
          : { name, pos: goto.center ? new THREE.Vector3() : sprite.position.clone(), distance: goto.distance ?? 8 };
    }
    return best;
  }

  /** Start close to a galaxy and pull back (arriving from its galaxy map). */
  arriveFrom(index: number): void {
    const to = this.position(index);
    const dir = new THREE.Vector3(0.3, 0.55, 1).normalize();
    const near = this.viewDistance(index) * 0.6;
    this.controls.target.copy(to);
    this.camera.position.copy(to).add(dir.clone().multiplyScalar(near));
    this.anim = { fromTarget: to.clone(), toTarget: to.clone(), fromPos: this.camera.position.clone(), toPos: to.clone().add(dir.multiplyScalar(Math.max(1.2, near * 25))), t: 0, speed: 0.5 };
  }

  /** Nearest Local Volume galaxy to the cursor (within a few pixels), preferring closer ones. */
  pick(ndcX: number, ndcY: number, width: number, height: number): number {
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const e = m.elements;
    const p = this.positions;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < this.local.length; i++) {
      if (!this.kindVisible[this.local[i].kind ?? 'galaxy']) continue;
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 0) continue;
      const sx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      const sy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      const d = Math.hypot(((sx - ndcX) * width) / 2, ((sy - ndcY) * height) / 2);
      if (d > 12) continue;
      const score = d + w * 0.002 - ((this.local[i].lk ?? 6) - 6) * 0.8;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  update(dt: number): void {
    this.declutter.update(this.scene, this.camera, dt);
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt * a.speed);
      const e = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
      this.controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
      // Interpolate the camera distance logarithmically so huge zooms feel even.
      const fromOff = a.fromPos.clone().sub(a.fromTarget);
      const toOff = a.toPos.clone().sub(a.toTarget);
      const dist = Math.exp(THREE.MathUtils.lerp(Math.log(fromOff.length()), Math.log(toOff.length()), e));
      const dir = fromOff.normalize().lerp(toOff.normalize(), e).normalize();
      this.camera.position.copy(this.controls.target).add(dir.multiplyScalar(dist));
      if (a.t >= 1) this.anim = undefined;
    }
    this.controls.update();
    const camDist = this.cameraDistance;
    for (const l of this.labels) l.sprite.visible = camDist >= l.min && camDist <= l.max && (!l.kind || this.kindVisible[l.kind]);
    if (this.cmb) {
      // A faint backdrop from inside; full strength once you fly out past it.
      // Near a galaxy it fades further so the galaxy stands out against black.
      const outside = this.camera.position.length() > CMB_RADIUS_MPC;
      const near = THREE.MathUtils.smoothstep(camDist, 1, 25);
      (this.cmb.material as THREE.ShaderMaterial).uniforms.uOpacity.value = outside ? 1 : 0.04 + 0.11 * near;
    }
  }
}
