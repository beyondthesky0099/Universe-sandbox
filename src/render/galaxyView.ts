import * as THREE from 'three';
import { LabelDeclutter } from './labelDeclutter';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateGalaxy, type GalaxyData, type GalaxyOptions } from '../procgen/galaxy';
import { mulberry32 } from '../procgen/rng';
import { Noise3D } from './noise';
import { NebulaClouds, type Cloud } from './nebulaClouds';
import { NebulaRaymarch, type NebulaShape, type NebulaVolumeSpec } from './nebulaRaymarch';
import { createStarfield } from './starfield';
import { relativisticSprite, relativity, RELATIVITY_PARS } from './relativity';
import { accretionTexture, glowTexture, ringTexture } from './textures';

const VERTEX = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  uniform float uScale;
  uniform float uMaxSize;
  varying vec3 vColor;
  ${RELATIVITY_PARS}
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Near light speed: aberration, Doppler colour and beaming (relativity.ts).
    float relD = relAberrate(mv);
    vColor = relShift(color, relD);
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
    uniforms: { uScale: { value: 300 }, uOpacity: { value: opacity }, uMaxSize: { value: maxSize }, uBeta: relativity.uBeta },
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
export type GalaxyTarget = number | 'core' | 'sol' | { exo: number } | { psr: number } | { bh: number } | { obj: number };

/** A real exoplanet host drawn on the Milky Way map. */
export interface ExoMarker {
  name: string;
  pos: [number, number, number];
  temperate: boolean;
}

/** A nebula that becomes a ray-marched volume up close (see setCloudLayer). */
export interface VolumeItem {
  center: [number, number, number];
  radius: number;
  shape: NebulaShape;
  seed: number;
  /** Photographed: the index of the cloud set whose atlas holds the picture, and its rectangle. */
  photo?: { set: number; rect: [number, number, number, number] };
  axes?: { right: [number, number, number]; up: [number, number, number]; forward: [number, number, number] };
  /** The flat clouds standing for it from afar ([set index, cloud index]), faded out as the volume fades in. */
  fade: [number, number][];
}

export function textSprite(text: string, color: string, scale = 1): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const font = '600 26px Inter, system-ui, sans-serif';
  const measure = canvas.getContext('2d')!;
  measure.font = font;
  const textWidth = measure.measureText(text).width + 24;
  canvas.width = Math.max(256, Math.ceil(textWidth));
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
  relativisticSprite(sprite.material);
  sprite.scale.set(0.16 * (canvas.width / 256) * scale, 0.04 * scale, 1);
  sprite.center.set(0.5, -0.6);
  sprite.renderOrder = 11;
  // For clicking on the label: its text, and the share of the canvas width the text covers.
  sprite.userData.labelText = text;
  sprite.userData.textFrac = Math.min(1, textWidth / canvas.width);
  return sprite;
}

/**
 * Whether a screen point (normalised device coordinates) falls on a text label's lettering, and
 * if so how far away the label is (its clip-space w; smaller is nearer), else Infinity. Works for
 * labels made by textSprite (constant screen size: `sizeAttenuation: false`).
 */
export function labelHitDepth(sprite: THREE.Sprite, camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number): number {
  const p = sprite.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse);
  if (p.z >= 0) return Infinity;
  const P = camera.projectionMatrix.elements;
  const w = -p.z;
  const ax = (P[0] * p.x + P[8] * p.z) / w;
  const ay = (P[5] * p.y + P[9] * p.z) / w;
  // The sprite's quad spans [-0.5, 0.5] around its centre point, scaled; without size attenuation
  // the scale is in units of the projection's focal length (see three's sprite vertex shader).
  const f = sprite.userData.textFrac ?? 1;
  const cx = sprite.center.x - 0.5, cy = sprite.center.y - 0.5;
  const sx = sprite.scale.x * P[0], sy = sprite.scale.y * P[5];
  const x0 = ax + (-f / 2 - cx) * sx, x1 = ax + (f / 2 - cx) * sx;
  // The letters fill the middle of the canvas's height; allow its full height for fat fingers.
  const y0 = ay + (-0.5 - cy) * sy, y1 = ay + (0.5 - cy) * sy;
  return ndcX >= x0 && ndcX <= x1 && ndcY >= y0 && ndcY <= y1 ? w : Infinity;
}

/** Whether an object and all its parents are visible. */
function shown(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Where a clicked label leads on the galaxy map. */
export interface LabelTarget {
  /** The object's name (the label without its distance and other details). */
  name: string;
  pos: THREE.Vector3;
  /** How far from it the camera should stop (map units). */
  distance: number;
  /** The map's own target for it, when it has one (the Sun). */
  target?: GalaxyTarget;
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
  /** Real pulsars' positions (Milky Way only; clickable while their layer shows). */
  pulsarPositions: [number, number, number][] = [];
  /** Real black holes' positions (Milky Way only). */
  blackHolePositions: [number, number, number][] = [];
  /** Real X-ray binaries and Wolf–Rayet stars (App.galacticObjectList), with the layer each belongs to. */
  objectPositions: [number, number, number][] = [];
  objectLayers: string[] = [];
  private exoPoints?: THREE.Points;
  /** Layers of real catalogued objects (Milky Way only: nebulae, star clusters), with labels. */
  private readonly realLayers = new Map<string, { points: THREE.Points; labels: THREE.Group }>();
  /** Real nebulae drawn as clouds at their true size (Milky Way only), with labels. */
  private readonly cloudLayers = new Map<string, { clouds: NebulaClouds[]; labels: THREE.Group; on: boolean }>();
  /** Nebulae that become ray-marched volumes up close (nebulaRaymarch.ts), and those built so far. */
  private volumeItems: { key: string; spec: NebulaVolumeSpec; fade: [NebulaClouds, number][] }[] = [];
  private readonly volumes = new Map<string, NebulaRaymarch>();
  private volumeTimer = 0;
  /** How many volumes at once, and ray-march steps per pixel. */
  volumeBudget = { max: 2, steps: 72 };
  private highlighting = false;
  /** Labels of the hand-placed showpiece nebulae, hidden once the real clouds replace them. */
  private readonly showpieceLabels: THREE.Sprite[] = [];
  private viewHeight = 800;
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
    // Close enough for the smallest real objects on the map: a planetary nebula like the Ghost of
    // Jupiter is under a light-year across (0.002 units). 0.0004 units is about 0.2 light-years.
    // The near plane follows the camera in (update), so close objects aren't clipped.
    this.controls.minDistance = 0.0004;
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
    const solLabel = textSprite('You are here', '#ffd36b');
    solLabel.userData.goto = { distance: 10, target: 'sol' };
    solLabel.userData.priority = 1000;
    this.solMarker.add(solRing, solLabel);
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
    this.setClusterSwarms(undefined);
    this.setGaiaStars(undefined);
    for (const key of [...this.cloudLayers.keys()]) this.setCloudLayer(key, [], []);
    this.showpieceLabels.length = 0;

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
      const nebulaNames = new Set(this.data.nebulae.map((n) => n.name));
      for (const n of named) {
        const label = textSprite(n.name, n.color, 0.7);
        label.position.set(n.x, n.y, n.z);
        // Clusters close up (their stars fill the view, see clusterStars.ts); nebulae a little further out.
        label.userData.goto = { distance: n.name === 'Sagittarius A*' ? 4 : nebulaNames.has(n.name) ? 1.2 : 0.3 };
        label.material.opacity = 0.8;
        this.labelGroup.add(label);
        if (nebulaNames.has(n.name)) this.showpieceLabels.push(label);
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
    this.viewHeight = height * pixelRatio;
    for (const layer of this.cloudLayers.values()) for (const c of layer.clouds) c.setViewHeight(this.viewHeight);
    this.applyPointScale();
  }

  private applyPointScale(): void {
    for (const pts of [this.stars, this.glow, this.dust, this.swarms, this.gaia, ...[...this.realLayers.values()].map((l) => l.points)]) {
      if (pts) (pts.material as THREE.ShaderMaterial).uniforms.uScale.value = this.pointScale;
    }
  }

  get cameraDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  targetPosition(target: GalaxyTarget): THREE.Vector3 {
    if (typeof target === 'object') return new THREE.Vector3(...('exo' in target ? this.exoHosts[target.exo].pos : 'psr' in target ? this.pulsarPositions[target.psr] : 'obj' in target ? this.objectPositions[target.obj] : this.blackHolePositions[target.bh]));
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
    this.flyToPoint(this.targetPosition(target), distance, speed);
  }

  /** Animate the camera to a point, stopping `distance` from it on the side it's looking from. */
  flyToPoint(to: THREE.Vector3, distance: number, speed = 0.9): void {
    distance = Math.max(distance, this.controls.minDistance * 1.05);
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

  /** Stop a flight in progress (a trip at speed takes over the camera). */
  cancelFlight(): void {
    this.anim = undefined;
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
    this.nebulaGroup.visible = !match && !this.cloudLayers.size;
    this.highlighting = !!match;
    for (const layer of this.cloudLayers.values()) for (const c of layer.clouds) c.mesh.visible = layer.on && !match;
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
  setRealLayer(key: string, items: { pos: [number, number, number]; color: [number, number, number]; size: number; label?: string; labelColor?: string; distance?: number; target?: GalaxyTarget }[]): void {
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
        text.userData.goto = { distance: it.distance ?? Math.max(0.003, it.size * 3), target: it.target };
        labels.add(text);
      }
    });
    const points = pointCloud(pos, col, size, pointsMaterial(0.95, 26));
    (points.material as THREE.ShaderMaterial).uniforms.uScale.value = this.pointScale;
    points.renderOrder = 5;
    this.scene.add(points, labels);
    this.realLayers.set(key, { points, labels });
  }

  private swarms?: THREE.Points;
  private readonly declutter = new LabelDeclutter();
  private gaia?: THREE.Points;

  /** Real stars from Gaia (sim/gaiaBright.ts) around the Sun. Cleared on rebuild. */
  setGaiaStars(stars: { positions: Float32Array; colors: Float32Array; sizes: Float32Array; count: number } | undefined): void {
    if (this.gaia) {
      this.scene.remove(this.gaia);
      this.gaia.geometry.dispose();
      (this.gaia.material as THREE.Material).dispose();
      this.gaia = undefined;
    }
    if (!stars?.count) return;
    this.gaia = pointCloud(stars.positions, stars.colors, stars.sizes, pointsMaterial(0.7, 7));
    (this.gaia.material as THREE.ShaderMaterial).uniforms.uScale.value = this.pointScale;
    this.gaia.renderOrder = 4;
    this.scene.add(this.gaia);
  }

  setGaiaVisible(on: boolean): void {
    if (this.gaia) this.gaia.visible = on;
  }

  /** Star clusters as balls of stars at their real sizes (see procgen/clusterStars.ts). Cleared on rebuild. */
  setClusterSwarms(swarms: { positions: Float32Array; colors: Float32Array; count: number } | undefined): void {
    if (this.swarms) {
      this.scene.remove(this.swarms);
      this.swarms.geometry.dispose();
      (this.swarms.material as THREE.Material).dispose();
      this.swarms = undefined;
    }
    if (!swarms?.count) return;
    // Each star a couple of pixels across from a cluster's doorstep; from afar they merge into a glow.
    this.swarms = pointCloud(swarms.positions, swarms.colors, new Float32Array(swarms.count).fill(0.0016), pointsMaterial(1, 6));
    (this.swarms.material as THREE.ShaderMaterial).uniforms.uScale.value = this.pointScale;
    this.swarms.renderOrder = 4;
    this.scene.add(this.swarms);
  }

  setRealLayerVisible(key: string, on: boolean): void {
    const layer = this.realLayers.get(key);
    if (layer) layer.points.visible = layer.labels.visible = on;
    const clouds = this.cloudLayers.get(key);
    if (clouds) {
      clouds.on = on;
      for (const c of clouds.clouds) c.mesh.visible = on && !this.highlighting;
      clouds.labels.visible = on;
    }
  }

  /**
   * Real nebulae as clouds at their true size (see nebulaClouds.ts). They replace the hand-placed
   * showpiece nebulae of the procedural Milky Way. An empty list removes the layer.
   */
  setCloudLayer(
    key: string,
    sets: { clouds: Cloud[]; atlas?: THREE.Texture; absorb?: boolean }[],
    labels: { pos: [number, number, number]; label: string; color: string; size?: number }[],
    volumes: VolumeItem[] = [],
  ): void {
    const old = this.cloudLayers.get(key);
    if (old) {
      this.volumeItems = this.volumeItems.filter((c) => !c.key.startsWith(`${key}:`));
      for (const v of this.volumes.values()) {
        this.scene.remove(v.mesh);
        v.dispose();
      }
      this.volumes.clear();
      this.scene.remove(old.labels);
      for (const c of old.clouds) {
        this.scene.remove(c.mesh);
        c.dispose();
      }
      for (const child of old.labels.children) {
        const sprite = child as THREE.Sprite;
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
      this.cloudLayers.delete(key);
    }
    const replaced = sets.some((set) => set.clouds.length > 0);
    this.nebulaGroup.visible = !replaced;
    for (const l of this.showpieceLabels) l.visible = !replaced;
    if (!replaced) return;
    // Dark dust first, so glowing gas in front of it still shows; stars draw over both.
    const layers = sets
      .filter((set) => set.clouds.length)
      .map((set) => {
        const layer = new NebulaClouds(set.clouds, set.atlas, set.absorb);
        layer.setViewHeight(this.viewHeight);
        layer.mesh.renderOrder = set.absorb ? 2.5 : 3;
        return layer;
      });
    const group = new THREE.Group();
    for (const l of labels) {
      const text = textSprite(l.label, l.color, 0.55);
      text.position.set(...l.pos);
      // Close enough that the nebula fills about a third of the view, however small it is.
      text.userData.goto = { distance: Math.max(0.003, (l.size ?? 0.1) * 3) };
      group.add(text);
    }
    this.scene.add(...layers.map((l) => l.mesh), group);
    this.cloudLayers.set(key, { clouds: layers, labels: group, on: true });
    // Which layer each set became (empty sets have none).
    const layerOf: (NebulaClouds | undefined)[] = [];
    let k = 0;
    for (const set of sets) layerOf.push(set.clouds.length ? layers[k++] : undefined);
    volumes.forEach((v, i) => {
      const atlas = v.photo ? sets[v.photo.set]?.atlas : undefined;
      this.volumeItems.push({
        key: `${key}:${i}`,
        spec: { center: v.center, radius: v.radius, shape: v.shape, seed: v.seed, axes: v.axes, photo: v.photo && atlas ? { atlas, rect: v.photo.rect } : undefined },
        fade: v.fade.flatMap(([si, ci]): [NebulaClouds, number][] => (layerOf[si] ? [[layerOf[si]!, ci]] : [])),
      });
    });
  }

  /** Labelled markers for real black holes and pulsars (Milky Way only). Cleared on rebuild. */
  addCompactObjects(items: { label: string; pos: [number, number, number]; kind: 'blackhole' | 'pulsar'; target?: GalaxyTarget }[]): void {
    for (const it of items) {
      const color = it.kind === 'blackhole' ? 0xff7ad9 : 0x9ff0ff;
      const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color, sizeAttenuation: false, depthTest: false, transparent: true }));
      ring.scale.setScalar(0.022);
      ring.position.set(...it.pos);
      ring.renderOrder = 11;
      const text = textSprite(it.label, it.kind === 'blackhole' ? '#ff9de3' : '#b8f4ff', 0.6);
      text.position.set(...it.pos);
      // Stop a little way off; zooming in from there (or Enter) opens it in the Sandbox.
      text.userData.goto = { distance: 1, target: it.target };
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

  /** The label under a screen point (normalised device coordinates), nearest first, if any. */
  pickLabel(ndcX: number, ndcY: number): LabelTarget | undefined {
    this.camera.updateMatrixWorld();
    let best: LabelTarget | undefined;
    let bestDepth = Infinity;
    this.scene.traverseVisible((o) => {
      const goto = o.userData.goto as { distance: number; target?: GalaxyTarget } | undefined;
      // (Faded-out labels, hidden by the declutter, can't be clicked.)
      if (!goto || !(o instanceof THREE.Sprite) || o.material.opacity < 0.3 || !shown(o)) return;
      const depth = labelHitDepth(o, this.camera, ndcX, ndcY);
      if (depth < bestDepth) {
        bestDepth = depth;
        best = { name: String(o.userData.labelText).split(' · ')[0], pos: o.getWorldPosition(new THREE.Vector3()), distance: goto.distance, target: goto.target };
      }
    });
    return best;
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
    // Real black holes win ties too.
    for (let i = 0; i < this.blackHolePositions.length; i++) {
      const [x, y, z] = this.blackHolePositions[i];
      const score = test(x, y, z, maxPx) - 3;
      if (score < bestScore) {
        bestScore = score;
        best = { bh: i };
      }
    }
    // So do real pulsars, while their layer shows.
    if (this.realLayers.get('pulsars')?.points.visible) {
      for (let i = 0; i < this.pulsarPositions.length; i++) {
        const [x, y, z] = this.pulsarPositions[i];
        const score = test(x, y, z, maxPx) - 1;
        if (score < bestScore) {
          bestScore = score;
          best = { psr: i };
        }
      }
    }
    // X-ray binaries and Wolf–Rayet stars, while their layers show.
    for (let i = 0; i < this.objectPositions.length; i++) {
      if (!this.realLayers.get(this.objectLayers[i])?.points.visible) continue;
      const [x, y, z] = this.objectPositions[i];
      const score = test(x, y, z, maxPx) - 1;
      if (score < bestScore) {
        bestScore = score;
        best = { obj: i };
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

  /**
   * Nebulae near the camera become ray-marched volumes (nebulaRaymarch.ts): the flat picture or
   * puffs fade out and the volume fades in between 10 and 5 radii away; only the few nearest
   * where the camera is looking.
   */
  private updateVolumes(dt: number): void {
    this.volumeTimer -= dt;
    if (this.volumeTimer > 0) return;
    this.volumeTimer = 0.06;
    const cam = this.camera.position;
    const on = this.cloudLayers.get('nebulae')?.on !== false && !this.highlighting;
    // Of the nebulae close enough, the ones nearest the point the camera looks at (what you
    // flew to), in units of their own size.
    const aim = this.controls.target;
    const near = on
      ? this.volumeItems
          .map((c) => ({
            c,
            d: Math.hypot(cam.x - c.spec.center[0], cam.y - c.spec.center[1], cam.z - c.spec.center[2]) / c.spec.radius,
            focus: Math.hypot(aim.x - c.spec.center[0], aim.y - c.spec.center[1], aim.z - c.spec.center[2]) / c.spec.radius,
          }))
          .filter((x) => x.d < 10)
          .sort((a, b) => a.focus - b.focus)
          .slice(0, this.volumeBudget.max)
      : [];
    const active = new Set(near.map((x) => x.c.key));
    for (const c of this.volumeItems) {
      if (active.has(c.key)) continue;
      const v = this.volumes.get(c.key);
      if (v) v.opacity = 0;
      for (const [layer, i] of c.fade) layer.setFade(i, 1);
    }
    for (const { c, d } of near) {
      let v = this.volumes.get(c.key);
      if (!v) {
        v = new NebulaRaymarch(c.spec, this.volumeBudget.steps);
        this.volumes.set(c.key, v);
        this.scene.add(v.mesh);
        // Keep a few built volumes for flying back and forth; drop the oldest beyond that.
        if (this.volumes.size > this.volumeBudget.max + 4) {
          const [oldKey, oldest] = this.volumes.entries().next().value!;
          if (!active.has(oldKey)) {
            this.scene.remove(oldest.mesh);
            oldest.dispose();
            this.volumes.delete(oldKey);
          }
        }
      }
      const fade = THREE.MathUtils.smoothstep(10 - d, 0, 5);
      v.opacity = fade;
      for (const [layer, i] of c.fade) layer.setFade(i, 1 - fade);
    }
  }

  update(dt: number): void {
    this.updateVolumes(dt);
    // Overlapping names: keep the important ones, fade the rest until there's room.
    this.declutter.update(this.scene, this.camera, dt);
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt * a.speed);
      const e = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
      this.controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
      this.camera.position.lerpVectors(a.fromPos, a.toPos, e);
      if (a.t >= 1) this.anim = undefined;
    }
    this.controls.update();
    // The near plane follows the camera in, so a nebula a light-year across isn't clipped
    // (the logarithmic depth buffer keeps the far side sharp).
    const near = THREE.MathUtils.clamp(this.cameraDistance * 0.02, 1e-6, 0.001);
    if (Math.abs(near - this.camera.near) > near * 0.1) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    // Fade the bright core glow when the camera is close to it.
    const dCore = this.camera.position.length();
    this.core.material.opacity = THREE.MathUtils.clamp(dCore / 300, 0.04, 0.35);
    this.hole.visible = dCore < 40;
    this.hole.children[1].rotation.z += dt * 0.4;
    this.starfield.position.copy(this.camera.position);
    this.starfield.scale.setScalar(this.camera.far * 0.5);
  }
}
