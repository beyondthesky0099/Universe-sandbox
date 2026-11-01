import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  COSMIC_STRUCTURES,
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
import { textSprite } from './galaxyView';
import { ringTexture } from './textures';

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
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(size * uScale / -mv.z, uMinSize, uMaxSize);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float a = (exp(-d * 5.0) + 0.25 * exp(-d * 1.2)) * (1.0 - smoothstep(0.6, 1.0, d));
    gl_FragColor = vec4(vColor, a * uOpacity);
  }
`;

function material(opacity: number, minSize: number, maxSize: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uScale: { value: 300 }, uOpacity: { value: opacity }, uMinSize: { value: minSize }, uMaxSize: { value: maxSize } },
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

interface Label {
  sprite: THREE.Sprite;
  /** Visible while the camera distance (Mpc) is within this range. */
  min: number;
  max: number;
}

export class CosmosView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  local: LocalGalaxy[] = [];
  selected = -1;

  private positions = new Float32Array(0);
  private localPoints?: THREE.Points;
  private webPoints?: THREE.Points;
  private readonly labels: Label[] = [];
  private readonly marker: THREE.Sprite;
  private pointScale = 300;
  private anim?: { fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromPos: THREE.Vector3; toPos: THREE.Vector3; t: number; speed: number };

  constructor(domElement: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(55, 1, 1e-5, 1e5);
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 1.4;
    this.controls.minDistance = 0.004;
    this.controls.maxDistance = 900;
    this.controls.enabled = false;
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: 0x7fdcff, sizeAttenuation: false, depthTest: false, transparent: true }));
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

  /** Build the map from the Local Volume catalogue (and, once loaded, the redshift survey). */
  setLocal(galaxies: LocalGalaxy[]): void {
    this.local = galaxies;
    const n = galaxies.length;
    this.positions = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    galaxies.forEach((g, i) => {
      this.positions.set(localPosition(g), i * 3);
      const [r, gr, b] = FORM_COLOR[galaxyForm(g)];
      const bright = THREE.MathUtils.clamp(((g.lk ?? 7) - 4.5) / 6, 0.25, 1);
      col.set([r * bright, gr * bright, b * bright], i * 3);
      // Real diameter (kpc → Mpc); the Milky Way is about 30 kpc across.
      size[i] = ((g.name === 'Milky Way' ? 30 : (g.size ?? 1)) / 1000) * 1.6;
    });
    this.localPoints?.geometry.dispose();
    if (this.localPoints) this.scene.remove(this.localPoints);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    this.localPoints = new THREE.Points(geo, material(1, 2.2, 90));
    this.localPoints.frustumCulled = false;
    this.localPoints.renderOrder = 5;
    this.scene.add(this.localPoints);

    for (const l of this.labels) this.scene.remove(l.sprite);
    this.labels.length = 0;
    galaxies.forEach((g, i) => {
      if (!isFamous(g)) return;
      const sprite = textSprite(displayName(g), g.name === 'Milky Way' ? '#ffd36b' : '#cfe3ff', 0.75);
      sprite.position.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
      // Nearby companions only make sense when zoomed in; big galaxies stay labelled longer.
      const far = g.d < 0.3 ? 3 : g.d < 1.5 ? 12 : 45;
      this.labels.push({ sprite, min: 0, max: far });
      this.scene.add(sprite);
    });
    for (const s of COSMIC_STRUCTURES) {
      const sprite = textSprite(s.name, '#ffb38a', 0.85);
      sprite.position.set(...galacticToCosmos(s.l, s.b, s.d));
      this.labels.push({ sprite, min: s.d < 1 ? 1.5 : s.d * 0.25, max: s.d < 1 ? 40 : 1e9 });
      this.scene.add(sprite);
    }
    this.applyPointScale();
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
    this.applyPointScale();
  }

  private applyPointScale(): void {
    for (const pts of [this.localPoints, this.webPoints]) {
      if (pts) (pts.material as THREE.ShaderMaterial).uniforms.uScale.value = this.pointScale;
    }
  }

  get cameraDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
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
    for (const l of this.labels) l.sprite.visible = camDist >= l.min && camDist <= l.max;
  }
}
