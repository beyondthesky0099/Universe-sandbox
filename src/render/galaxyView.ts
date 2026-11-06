import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateGalaxy, type GalaxyData, type GalaxyOptions } from '../procgen/galaxy';
import { mulberry32 } from '../procgen/rng';
import { Noise3D } from './noise';
import { createStarfield } from './starfield';
import { accretionTexture, glowTexture, ringTexture } from './textures';

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

/** Dust: soft dark blobs drawn with normal blending so they obscure what's behind. */
const DUST_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float a = (1.0 - smoothstep(0.0, 1.0, d)) * uOpacity;
    gl_FragColor = vec4(0.02, 0.015, 0.012, a);
  }
`;

function pointsMaterial(opacity: number, maxSize: number, fragment = FRAGMENT, additive = true): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: fragment,
    uniforms: { uScale: { value: 300 }, uOpacity: { value: opacity }, uMaxSize: { value: maxSize } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

function pointCloud(positions: Float32Array, colors: Float32Array | undefined, sizes: Float32Array, material: THREE.ShaderMaterial): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors ?? new Float32Array(positions.length), 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const pts = new THREE.Points(geo, material);
  pts.frustumCulled = false;
  return pts;
}

/** Wispy procedural cloud texture for nebulae (white; tinted by sprite colour). */
function nebulaTexture(seed: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const n = new Noise3D(seed);
  const rng = mulberry32(seed);
  const ox = rng() * 100;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = i / size - 0.5, y = j / size - 0.5;
      const r = Math.hypot(x, y) * 2;
      const v = n.fbm(x * 3 + ox, y * 3, ox, 5) * 0.5 + 0.5;
      const a = Math.max(0, 1 - r) ** 1.5 * Math.max(0, v * 1.6 - 0.45);
      const k = (j * size + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Selection target in the galaxy: a star index, the central black hole, or the Sun. */
export type GalaxyTarget = number | 'core' | 'sol' | { exo: number };

/** A real exoplanet host drawn on the Milky Way map. */
export interface ExoMarker {
  name: string;
  pos: [number, number, number];
  temperate: boolean;
}

export function textSprite(text: string, color: string, scale = 1): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const font = '600 26px Inter, system-ui, sans-serif';
  const measure = canvas.getContext('2d')!;
  measure.font = font;
  canvas.width = Math.max(256, Math.ceil(measure.measureText(text).width + 24));
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 6;
  ctx.fillText(text, canvas.width / 2, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true }));
  sprite.scale.set(0.16 * (canvas.width / 256) * scale, 0.04 * scale, 1);
  sprite.center.set(0.5, -0.6);
  sprite.renderOrder = 11;
  return sprite;
}

/** Procedurally generated spiral galaxy where every bright point is a selectable star system. */
export class GalaxyView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  data!: GalaxyData;
  selected: GalaxyTarget | -1 = -1;

  private pointScale = 300;
  private stars?: THREE.Points;
  private glow?: THREE.Points;
  private dust?: THREE.Points;
  private readonly nebulaGroup = new THREE.Group();
  /** Real exoplanet hosts (Milky Way only). */
  exoHosts: ExoMarker[] = [];
  private exoPoints?: THREE.Points;
  /** Layers of real catalogued objects (Milky Way only: nebulae, star clusters), with labels. */
  private readonly realLayers = new Map<string, { points: THREE.Points; labels: THREE.Group }>();
  /** Names of real objects (Milky Way clusters and nebulae). */
  private readonly labelGroup = new THREE.Group();
  private readonly nebulaTextures: THREE.Texture[] = [];
  private originalColors?: Float32Array;
  private readonly core: THREE.Sprite;
  private readonly hole: THREE.Group;
  private readonly marker: THREE.Sprite;
  private readonly solMarker = new THREE.Group();
  private showSol = true;
  private readonly bookmarkPoints: THREE.Points;
  private readonly visitedPoints: THREE.Points;
  private readonly starfield = createStarfield(3000, 23);
  private anim?: { fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromPos: THREE.Vector3; toPos: THREE.Vector3; t: number; speed: number };

  constructor(domElement: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.001, 1e5);
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 1.3;
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 600;

    this.scene.add(this.starfield);
    this.core = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd9a0, transparent: true, opacity: 0.35, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    this.core.scale.setScalar(70);
    this.scene.add(this.core);
    this.scene.add(this.nebulaGroup);
    this.scene.add(this.labelGroup);

    // Supermassive black hole: shadow, accretion disk and photon ring. Only visible up close.
    this.hole = new THREE.Group();
    const shadow = new THREE.Mesh(new THREE.SphereGeometry(0.25, 32, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    const disk = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 1.25, 96, 1),
      new THREE.MeshBasicMaterial({ map: accretionTexture(), side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    disk.rotation.x = -Math.PI / 2 + 0.3;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb070, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(2.4);
    this.hole.add(halo, disk, shadow);
    this.hole.renderOrder = 5;
    this.scene.add(this.hole);

    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), sizeAttenuation: false, depthTest: false, transparent: true }));
    this.marker.scale.setScalar(0.05);
    this.marker.visible = false;
    this.marker.renderOrder = 10;
    this.scene.add(this.marker);

    const markerPoints = (color: number, size: number) => {
      const pts = new THREE.Points(
        new THREE.BufferGeometry(),
        new THREE.PointsMaterial({ map: ringTexture(), color, size, sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false }),
      );
      pts.frustumCulled = false;
      pts.renderOrder = 9;
      this.scene.add(pts);
      return pts;
    };
    // "You are here".
    const solRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: 0xffd36b, sizeAttenuation: false, depthTest: false, transparent: true }));
    solRing.scale.setScalar(0.03);
    solRing.renderOrder = 11;
    this.solMarker.add(solRing, textSprite('You are here', '#ffd36b'));
    this.scene.add(this.solMarker);

    this.bookmarkPoints = markerPoints(0xffd36b, 16);
    this.visitedPoints = markerPoints(0x6f8fb0, 9);
  }

  build(seed: number, opts: GalaxyOptions = {}): GalaxyData {
    for (const pts of [this.stars, this.glow, this.dust]) {
      if (!pts) continue;
      this.scene.remove(pts);
      pts.geometry.dispose();
      (pts.material as THREE.Material).dispose();
    }
    for (const child of [...this.nebulaGroup.children]) {
      this.nebulaGroup.remove(child);
      ((child as THREE.Sprite).material as THREE.Material).dispose();
    }
    for (const t of this.nebulaTextures) t.dispose();
    this.nebulaTextures.length = 0;
    for (const key of [...this.realLayers.keys()]) this.setRealLayer(key, []);

    this.data = generateGalaxy(seed, 30000, 60000, 9000, opts);
    // "You are here" only belongs in our own galaxy, not in stand-ins for other real galaxies.
    this.showSol = !opts.name;
    this.solMarker.visible = this.showSol;
    this.setExoHosts([]); // the app adds real hosts for the Milky Way
    const { stars, glow, dust, nebulae } = this.data;
    this.glow = pointCloud(glow.positions, glow.colors, glow.sizes, pointsMaterial(0.06, 36));
    this.dust = pointCloud(dust.positions, undefined, dust.sizes, pointsMaterial(0.22, 60, DUST_FRAGMENT, false));
    this.stars = pointCloud(stars.positions, stars.colors, stars.sizes, pointsMaterial(0.75, 18));
    this.originalColors = stars.colors.slice();
    this.glow.renderOrder = 1;
    this.dust.renderOrder = 2;
    this.nebulaGroup.renderOrder = 3;
    this.stars.renderOrder = 4;
    this.scene.add(this.glow, this.dust, this.stars);

    // A handful of shared textures keeps nebula generation quick.
    for (let i = 0; i < 6; i++) this.nebulaTextures.push(nebulaTexture(seed * 31 + i));
    for (const n of nebulae) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.nebulaTextures[n.seed % this.nebulaTextures.length],
          color: new THREE.Color(...n.color),
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
          rotation: (n.seed % 628) / 100,
        }),
      );
      sprite.position.set(n.x, n.y, n.z);
      sprite.scale.setScalar(n.size * 1.4);
      this.nebulaGroup.add(sprite);
    }

    for (const child of [...this.labelGroup.children]) {
      this.labelGroup.remove(child);
      const sprite = child as THREE.Sprite;
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    if (this.data.name === 'Milky Way') {
      const named: { name: string; x: number; y: number; z: number; color: string }[] = [
        ...this.data.nebulae.filter((n) => n.name).map((n) => ({ name: n.name!, x: n.x, y: n.y, z: n.z, color: '#f0a8c0' })),
        ...this.data.clusters.map((c) => ({ name: c.name, x: c.x, y: c.y, z: c.z, color: c.kind === 'globular' ? '#ffe2a0' : '#a8d4ff' })),
        { name: 'Sagittarius A*', x: 0, y: 0, z: 0, color: '#ff9b6b' },
      ];
      for (const n of named) {
        const label = textSprite(n.name, n.color, 0.7);
        label.position.set(n.x, n.y, n.z);
        label.material.opacity = 0.8;
        this.labelGroup.add(label);
      }
    }
    this.solMarker.position.set(...this.data.sol);
    this.applyPointScale();
    this.select(-1);
    this.setMarkers([], []);
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
    for (const pts of [this.stars, this.glow, this.dust, ...[...this.realLayers.values()].map((l) => l.points)]) {
      if (pts) (pts.material as THREE.ShaderMaterial).uniforms.uScale.value = this.pointScale;
    }
  }

  get cameraDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  targetPosition(target: GalaxyTarget): THREE.Vector3 {
    if (typeof target === 'object') return new THREE.Vector3(...this.exoHosts[target.exo].pos);
    if (target === 'core') return new THREE.Vector3();
    if (target === 'sol') return new THREE.Vector3(...this.data.sol);
    const p = this.data.stars.positions;
    return new THREE.Vector3(p[target * 3], p[target * 3 + 1], p[target * 3 + 2]);
  }

  select(target: GalaxyTarget | -1): void {
    this.selected = target;
    this.marker.visible = target !== -1;
    if (target !== -1) this.marker.position.copy(this.targetPosition(target));
  }

  /** Animate the camera to close in on a star or the core. */
  flyTo(target: GalaxyTarget, distance = 10, speed = 0.9): void {
    const to = this.targetPosition(target);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.anim = {
      fromTarget: this.controls.target.clone(),
      toTarget: to,
      fromPos: this.camera.position.clone(),
      toPos: to.clone().add(dir.multiplyScalar(distance)),
      t: 0,
      speed,
    };
  }

  /** Place the camera close to a target, then pull back (arriving from a star system). */
  arriveFrom(target: GalaxyTarget, near = 0.3, far = 12): void {
    const to = this.targetPosition(target);
    const dir = new THREE.Vector3(0, 0.6, 1).normalize();
    this.controls.target.copy(to);
    this.camera.position.copy(to).add(dir.clone().multiplyScalar(near));
    this.anim = { fromTarget: to.clone(), toTarget: to.clone(), fromPos: this.camera.position.clone(), toPos: to.clone().add(dir.multiplyScalar(far)), t: 0, speed: 0.6 };
  }

  get animating(): boolean {
    return !!this.anim;
  }

  /** Dim stars that don't match a filter (null clears it). */
  setFilter(match: ((index: number) => boolean) | null): void {
    if (!this.stars || !this.originalColors) return;
    const attr = this.stars.geometry.attributes.color as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const orig = this.originalColors;
    for (let i = 0; i < this.data.stars.count; i++) {
      const k = i * 3;
      const f = !match ? 1 : match(i) ? 1.6 : 0.07;
      arr[k] = orig[k] * f;
      arr[k + 1] = orig[k + 1] * f;
      arr[k + 2] = orig[k + 2] * f;
    }
    attr.needsUpdate = true;
    for (const pts of [this.glow, this.dust]) if (pts) pts.visible = !match;
    this.nebulaGroup.visible = !match;
  }

  /** Show real exoplanet hosts: cyan rings, green for systems with a temperate planet. */
  setExoHosts(hosts: ExoMarker[]): void {
    this.exoHosts = hosts;
    if (!this.exoPoints) {
      this.exoPoints = new THREE.Points(
        new THREE.BufferGeometry(),
        new THREE.PointsMaterial({ map: ringTexture(), size: 7, vertexColors: true, sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false, opacity: 0.85 }),
      );
      this.exoPoints.frustumCulled = false;
      this.exoPoints.renderOrder = 9;
      this.scene.add(this.exoPoints);
    }
    const pos = new Float32Array(hosts.length * 3);
    const col = new Float32Array(hosts.length * 3);
    hosts.forEach((h, i) => {
      pos.set(h.pos, i * 3);
      col.set(h.temperate ? [0.45, 1, 0.55] : [0.35, 0.85, 1], i * 3);
    });
    this.exoPoints.geometry.dispose();
    this.exoPoints.geometry = new THREE.BufferGeometry();
    this.exoPoints.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.exoPoints.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  /**
   * A layer of real objects with measured distances (nebulae, star clusters), as glowing points
   * sized by their physical size but never smaller than a few pixels, with labels for the named
   * ones. An empty list removes the layer. Cleared on rebuild.
   */
  setRealLayer(key: string, items: { pos: [number, number, number]; color: [number, number, number]; size: number; label?: string; labelColor?: string }[]): void {
    const old = this.realLayers.get(key);
    if (old) {
      this.scene.remove(old.points, old.labels);
      old.points.geometry.dispose();
      (old.points.material as THREE.Material).dispose();
      for (const child of old.labels.children) {
        const sprite = child as THREE.Sprite;
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
      this.realLayers.delete(key);
    }
    if (!items.length) return;
    const pos = new Float32Array(items.length * 3);
    const col = new Float32Array(items.length * 3);
    const size = new Float32Array(items.length);
    const labels = new THREE.Group();
    items.forEach((it, i) => {
      pos.set(it.pos, i * 3);
      col.set(it.color, i * 3);
      size[i] = it.size;
      if (it.label) {
        const text = textSprite(it.label, it.labelColor ?? '#ffb3c8', 0.55);
        text.position.set(...it.pos);
        labels.add(text);
      }
    });
    const points = pointCloud(pos, col, size, pointsMaterial(0.95, 26));
    (points.material as THREE.ShaderMaterial).uniforms.uScale.value = this.pointScale;
    points.renderOrder = 5;
    this.scene.add(points, labels);
    this.realLayers.set(key, { points, labels });
  }

  setRealLayerVisible(key: string, on: boolean): void {
    const layer = this.realLayers.get(key);
    if (layer) layer.points.visible = layer.labels.visible = on;
  }

  /** Labelled markers for real black holes and pulsars (Milky Way only). Cleared on rebuild. */
  addCompactObjects(items: { label: string; pos: [number, number, number]; kind: 'blackhole' | 'pulsar' }[]): void {
    for (const it of items) {
      const color = it.kind === 'blackhole' ? 0xff7ad9 : 0x9ff0ff;
      const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color, sizeAttenuation: false, depthTest: false, transparent: true }));
      ring.scale.setScalar(0.022);
      ring.position.set(...it.pos);
      ring.renderOrder = 11;
      const text = textSprite(it.label, it.kind === 'blackhole' ? '#ff9de3' : '#b8f4ff', 0.6);
      text.position.set(...it.pos);
      this.labelGroup.add(ring, text);
    }
  }

  setMarkers(bookmarks: number[], visited: number[]): void {
    const fill = (pts: THREE.Points, idx: number[]) => {
      const pos = new Float32Array(idx.length * 3);
      idx.forEach((i, n) => pos.set(this.targetPosition(i).toArray(), n * 3));
      pts.geometry.dispose();
      pts.geometry = new THREE.BufferGeometry();
      pts.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    };
    fill(this.bookmarkPoints, bookmarks);
    fill(this.visitedPoints, visited.filter((v) => !bookmarks.includes(v)));
  }

  /** Index of the star nearest the cursor within a few pixels (or 'core'), preferring closer stars. */
  pick(ndcX: number, ndcY: number, width: number, height: number): GalaxyTarget | -1 {
    const p = this.data.stars.positions;
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const e = m.elements;
    let best: GalaxyTarget | -1 = -1;
    let bestScore = Infinity;
    const maxPx = 9;
    const test = (x: number, y: number, z: number, reach: number): number => {
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 0) return Infinity;
      const sx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      const sy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      const d = Math.hypot(((sx - ndcX) * width) / 2, ((sy - ndcY) * height) / 2);
      return d > reach ? Infinity : d + w * 0.02;
    };
    for (let i = 0; i < this.data.stars.count; i++) {
      const score = test(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], maxPx);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    // Real exoplanet hosts win ties with the procedural stars around them.
    for (let i = 0; i < this.exoHosts.length; i++) {
      const [x, y, z] = this.exoHosts[i].pos;
      const score = test(x, y, z, maxPx) - 2;
      if (score < bestScore) {
        bestScore = score;
        best = { exo: i };
      }
    }
    // The core and the Sun win when the click is right on them.
    const coreScore = test(0, 0, 0, 14);
    if (coreScore < Infinity && coreScore - 4 < bestScore) {
      best = 'core';
      bestScore = coreScore - 4;
    }
    const [sx, sy, sz] = this.data.sol;
    const solScore = test(sx, sy, sz, 14);
    if (this.showSol && solScore < Infinity && solScore - 4 < bestScore) best = 'sol';
    return best;
  }

  update(dt: number): void {
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt * a.speed);
      const e = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
      this.controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
      this.camera.position.lerpVectors(a.fromPos, a.toPos, e);
      if (a.t >= 1) this.anim = undefined;
    }
    this.controls.update();
    // Fade the bright core glow when the camera is close to it.
    const dCore = this.camera.position.length();
    this.core.material.opacity = THREE.MathUtils.clamp(dCore / 300, 0.04, 0.35);
    this.hole.visible = dCore < 40;
    this.hole.children[1].rotation.z += dt * 0.4;
    this.starfield.position.copy(this.camera.position);
    this.starfield.scale.setScalar(this.camera.far * 0.5);
  }
}
