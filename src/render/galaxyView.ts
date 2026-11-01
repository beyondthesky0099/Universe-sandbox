import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateGalaxy, type GalaxyData } from '../procgen/galaxy';
import { createStarfield } from './starfield';
import { glowTexture, ringTexture } from './textures';

const VERTEX = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  uniform float uScale;
  uniform float uMaxSize;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(size * uScale / -mv.z, 1.0, uMaxSize);
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
    float a = (exp(-d * 6.0) + 0.2 * exp(-d * 1.5)) * (1.0 - smoothstep(0.5, 1.0, d));
    gl_FragColor = vec4(vColor, a * uOpacity);
  }
`;

function pointsMaterial(opacity: number, maxSize: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uScale: { value: 300 }, uOpacity: { value: opacity }, uMaxSize: { value: maxSize } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}

function pointCloud(positions: Float32Array, colors: Float32Array, sizes: Float32Array, material: THREE.ShaderMaterial): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const pts = new THREE.Points(geo, material);
  pts.frustumCulled = false;
  return pts;
}

/** Procedurally generated spiral galaxy where every bright point is a selectable star system. */
export class GalaxyView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  data!: GalaxyData;
  selectedIndex = -1;
  private pointScale = 300;

  private stars?: THREE.Points;
  private glow?: THREE.Points;
  private readonly core: THREE.Sprite;
  private readonly marker: THREE.Sprite;
  private readonly starfield = createStarfield(3000, 23);
  private anim?: { fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromPos: THREE.Vector3; toPos: THREE.Vector3; t: number };

  constructor(domElement: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1e5);
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 1.3;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 600;

    this.scene.add(this.starfield);
    this.core = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd9a0, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    this.core.scale.setScalar(70);
    this.scene.add(this.core);

    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), sizeAttenuation: false, depthTest: false, transparent: true }));
    this.marker.scale.setScalar(0.05);
    this.marker.visible = false;
    this.marker.renderOrder = 10;
    this.scene.add(this.marker);
  }

  build(seed: number): GalaxyData {
    if (this.stars) {
      this.scene.remove(this.stars);
      this.stars.geometry.dispose();
      (this.stars.material as THREE.Material).dispose();
    }
    if (this.glow) {
      this.scene.remove(this.glow);
      this.glow.geometry.dispose();
      (this.glow.material as THREE.Material).dispose();
    }
    this.data = generateGalaxy(seed);
    const { stars, glow } = this.data;
    this.glow = pointCloud(glow.positions, glow.colors, glow.sizes, pointsMaterial(0.06, 36));
    this.stars = pointCloud(stars.positions, stars.colors, stars.sizes, pointsMaterial(0.75, 18));
    this.scene.add(this.glow, this.stars);
    this.applyPointScale();
    this.select(-1);
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 120, 150);
    this.controls.update();
    return this.data;
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.pointScale = 0.45 * height * pixelRatio;
    this.applyPointScale();
  }

  private applyPointScale(): void {
    for (const pts of [this.stars, this.glow]) {
      if (pts) (pts.material as THREE.ShaderMaterial).uniforms.uScale.value = this.pointScale;
    }
  }

  starPosition(index: number): THREE.Vector3 {
    const p = this.data.stars.positions;
    return new THREE.Vector3(p[index * 3], p[index * 3 + 1], p[index * 3 + 2]);
  }

  select(index: number): void {
    this.selectedIndex = index;
    this.marker.visible = index >= 0;
    if (index >= 0) this.marker.position.copy(this.starPosition(index));
  }

  /** Animate the camera to close in on a star. */
  flyTo(index: number, distance = 10): void {
    const target = this.starPosition(index);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.anim = {
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      fromPos: this.camera.position.clone(),
      toPos: target.clone().add(dir.multiplyScalar(distance)),
      t: 0,
    };
  }

  /** Index of the star nearest the cursor within a few pixels, preferring closer stars. */
  pick(ndcX: number, ndcY: number, width: number, height: number): number {
    const p = this.data.stars.positions;
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const e = m.elements;
    let best = -1;
    let bestScore = Infinity;
    const maxPx = 9;
    for (let i = 0; i < this.data.stars.count; i++) {
      const x = p[i * 3];
      const y = p[i * 3 + 1];
      const z = p[i * 3 + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 0) continue;
      const sx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      const sy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      const dx = ((sx - ndcX) * width) / 2;
      const dy = ((sy - ndcY) * height) / 2;
      const d = Math.hypot(dx, dy);
      if (d > maxPx) continue;
      // Favour stars that are both near the cursor and near the camera.
      const score = d + w * 0.02;
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
      a.t = Math.min(1, a.t + dt * 0.9);
      const e = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
      this.controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
      this.camera.position.lerpVectors(a.fromPos, a.toPos, e);
      if (a.t >= 1) this.anim = undefined;
    }
    this.controls.update();
    // Fade the bright core when the camera is close to it.
    const dCore = this.camera.position.length();
    this.core.material.opacity = THREE.MathUtils.clamp(dCore / 300, 0.08, 0.35);
    this.starfield.position.copy(this.camera.position);
    this.starfield.scale.setScalar(this.camera.far * 0.5);
  }
}
