import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { isLuminous, luminosity, type Body } from '../sim/body';
import { isTidallyLocked, lagrangePoints } from '../sim/analysis';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { bodyTemperature, climateFor, habitableZone } from '../sim/climate';
import type { Approach } from '../sim/forecast';
import { orbitPath } from '../sim/orbits';
import type { SceneSetup } from '../sim/presets';
import type { SimEvent, Simulation } from '../sim/simulation';
import { atmosphereMaterial, BodyVisual, DETAIL_PIXEL_RADIUS } from './bodyVisual';
import { createStarfield } from './starfield';
import { dotTexture, glowTexture, ringTexture } from './textures';

const MAX_LIGHTS = 4;
const MAX_HZ = 4;

export interface RenderQuality {
  /** Width of procedural planet textures (height is half). */
  textureWidth: number;
  /** Bodies drawn with full meshes/trails; the rest become points. */
  maxFullBodies: number;
  trailLength: number;
}

export const QUALITY_PRESETS: Record<'low' | 'medium' | 'high', RenderQuality & { pixelRatio: number }> = {
  low: { textureWidth: 128, maxFullBodies: 80, trailLength: 250, pixelRatio: 1 },
  medium: { textureWidth: 256, maxFullBodies: 160, trailLength: 500, pixelRatio: 1.5 },
  high: { textureWidth: 512, maxFullBodies: 300, trailLength: 700, pixelRatio: 2 },
};

export type TrailFrame = 'absolute' | 'follow';

interface Flash {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  size: number;
}

/** 3D view of the N-body simulation. */
export class SystemView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  trailsEnabled = true;
  labelsEnabled = true;
  habitableZones = false;
  orbitsEnabled = true;
  lagrangeEnabled = false;
  trailFrame: TrailFrame = 'absolute';
  selectedId: number | undefined;
  followId: number | undefined;
  quality: RenderQuality;

  private readonly visuals = new Map<number, BodyVisual>();
  private readonly starfield = createStarfield();
  private readonly lights: THREE.PointLight[] = [];
  private readonly particlePoints: THREE.Points;
  private readonly particlePos: Float32Array;
  private readonly particleCol: Float32Array;
  private readonly bodyPoints: THREE.Points;
  private bodyPointPos = new Float32Array(0);
  private bodyPointCol = new Float32Array(0);
  private readonly marker: THREE.Sprite;
  private readonly flashes: Flash[] = [];
  private readonly ghost: THREE.Mesh;
  private readonly arrow: THREE.ArrowHelper;
  private readonly predictLine: THREE.Line;
  private readonly orbitLine: THREE.Line;
  private readonly approachGroup = new THREE.Group();
  private readonly approachLine: THREE.Line;
  private readonly approachMarkers: THREE.Sprite[];
  private readonly hzRings: THREE.Mesh[] = [];
  private readonly shockShells: THREE.Mesh[] = [];
  private readonly trailGroup = new THREE.Group();
  private fullIds = new Set<number>();
  private frame = 0;
  private climateTimer = 0;
  private followBlend = 1;
  private followDistance = 0;
  private followStartDistance = 0;
  private cameraAnim?: { from: THREE.Vector3; to: THREE.Vector3; target: THREE.Vector3; t: number; speed: number };
  private lastTrailRef: number | undefined;
  /** Body id → parent id for tidally locked bodies (refreshed with climate). */
  private locks = new Map<number, number>();
  private readonly lagrangeMarkers: THREE.Sprite[] = [];
  private readonly ripples: { mesh: THREE.Mesh; age: number; life: number; size: number }[] = [];

  constructor(
    private readonly sim: Simulation,
    domElement: HTMLElement,
    quality: RenderQuality = QUALITY_PRESETS.medium,
  ) {
    this.quality = quality;
    this.camera = new THREE.PerspectiveCamera(55, 1, 1e-4, 1e9);
    this.camera.position.set(0, 5, 8);
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 1.4;
    this.controls.minDistance = 0.002;
    this.controls.maxDistance = 2e5;

    // A colour-managed background renders identically with and without post-processing
    // (the renderer's clear colour is not converted when clearing linear render targets).
    this.scene.background = new THREE.Color(0x02030a);
    this.scene.add(this.starfield);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.12));
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 0, 0);
      this.lights.push(light);
      this.scene.add(light);
    }
    this.scene.add(this.trailGroup);

    // Particles share one buffer sized to the simulation's capacity.
    const cap = sim.particles.capacity;
    this.particlePos = new Float32Array(cap * 3);
    this.particleCol = new Float32Array(cap * 3);
    this.particlePoints = this.makePoints(this.particlePos, this.particleCol, 2.5);
    this.scene.add(this.particlePoints);

    // Bodies beyond the full-detail budget are drawn as bright points.
    this.bodyPoints = this.makePoints(this.bodyPointPos, this.bodyPointCol, 4);
    this.scene.add(this.bodyPoints);

    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), sizeAttenuation: false, depthTest: false, transparent: true }));
    this.marker.scale.setScalar(0.06);
    this.marker.visible = false;
    this.marker.renderOrder = 10;
    this.scene.add(this.marker);

    // Spawn preview: ghost body, velocity arrow and predicted path.
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 12),
      new THREE.MeshBasicMaterial({ color: 0x7fdcff, wireframe: true, transparent: true, opacity: 0.6 }),
    );
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x7fdcff);
    this.arrow.visible = false;
    this.scene.add(this.arrow);
    this.predictLine = this.makeDashedLine(0x7fdcff);
    this.scene.add(this.predictLine);

    // Selected body's osculating orbit.
    this.orbitLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.45 }));
    this.orbitLine.frustumCulled = false;
    this.orbitLine.visible = false;
    this.scene.add(this.orbitLine);

    // Closest-approach / impact markers.
    this.approachLine = this.makeDashedLine(0xffb24a);
    this.approachMarkers = [0, 1].map(() => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: 0xffb24a, sizeAttenuation: false, depthTest: false, transparent: true }));
      s.scale.setScalar(0.035);
      s.renderOrder = 10;
      return s;
    });
    this.approachGroup.add(this.approachLine, ...this.approachMarkers);
    this.approachGroup.visible = false;
    this.scene.add(this.approachGroup);

    // Lagrange point markers (L1–L5) for the selected body.
    for (const name of ['L1', 'L2', 'L3', 'L4', 'L5']) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: 0xc8a0ff, sizeAttenuation: false, depthTest: false, transparent: true }));
      s.scale.setScalar(0.025);
      s.renderOrder = 10;
      s.visible = false;
      const el = document.createElement('div');
      el.className = 'body-label lagrange-label';
      el.textContent = name;
      const label = new CSS2DObject(el);
      label.center.set(-0.3, 0.5);
      s.add(label);
      this.lagrangeMarkers.push(s);
      this.scene.add(s);
    }

    // Habitable-zone annuli.
    for (let i = 0; i < MAX_HZ; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1, 2, 128, 1),
        new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.hzRings.push(ring);
      this.scene.add(ring);
    }
  }

  private makePoints(pos: Float32Array, col: Float32Array, size: number): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    pts.frustumCulled = false;
    return pts;
  }

  private makeDashedLine(color: number): THREE.Line {
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color, dashSize: 1, gapSize: 0.6, transparent: true, opacity: 0.85 }));
    line.frustumCulled = false;
    line.visible = false;
    return line;
  }

  setViewport(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setQuality(q: RenderQuality): void {
    const trailChanged = q.trailLength !== this.quality.trailLength;
    this.quality = q;
    if (trailChanged) this.rebuildAll();
    else for (const v of this.visuals.values()) v.detailKey = v.detailKey ? 'stale' : '';
  }

  private rebuildAll(): void {
    for (const v of this.visuals.values()) this.disposeVisual(v);
    this.visuals.clear();
    this.fullIds.clear();
  }

  get cameraDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  /** Remove all visuals (e.g. before loading a new scene) and frame the camera. */
  reset(setup: SceneSetup, zoomFrom = 1): void {
    this.rebuildAll();
    for (const f of this.flashes) this.scene.remove(f.sprite);
    this.flashes.length = 0;
    this.selectedId = undefined;
    this.followId = undefined;
    this.approachGroup.visible = false;
    const el = setup.elevation ?? 0.8;
    const dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el));
    this.controls.maxDistance = Math.max(2e5, setup.cameraDistance * 20);
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir).multiplyScalar(setup.cameraDistance * zoomFrom);
    this.cameraAnim =
      zoomFrom !== 1
        ? { from: this.camera.position.clone(), to: dir.multiplyScalar(setup.cameraDistance), target: new THREE.Vector3(), t: 0, speed: 0.7 }
        : undefined;
    this.controls.update();
    this.sync();
  }

  /** Animate the camera outward (used when leaving for the galaxy map). */
  zoomOut(factor: number, speed = 1.2): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.cameraAnim = { from: this.camera.position.clone(), to: this.controls.target.clone().add(offset.multiplyScalar(factor)), target: this.controls.target.clone(), t: 0, speed };
  }

  /** Black holes on screen as lenses: uv position and shadow radius in screen-height units. */
  lensesOnScreen(viewportHeight: number): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    const holes = this.sim.bodies.filter((b) => b.kind === 'blackhole').sort((a, b) => b.mass - a.mass);
    const v = new THREE.Vector3();
    for (const b of holes) {
      v.set(b.x, b.y, b.z);
      const wpp = this.worldPerPixel(v, viewportHeight);
      v.project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.5 || Math.abs(v.y) > 1.5) continue;
      const rs = b.radius / wpp / viewportHeight;
      if (rs < 0.002) continue;
      out.push(new THREE.Vector3((v.x + 1) / 2, (v.y + 1) / 2, rs));
      if (out.length >= 4) break;
    }
    return out;
  }

  /** Rough radius (AU) containing the scene's bodies, for VR "tabletop" scaling. */
  sceneExtent(): number {
    let r = 0.1;
    for (const b of this.sim.bodies) r = Math.max(r, Math.hypot(b.x, b.y, b.z));
    return Math.min(r, this.cameraDistance * 2);
  }

  stopCameraAnimation(): void {
    this.cameraAnim = undefined;
  }

  clearTrails(): void {
    for (const v of this.visuals.values()) v.clearTrail();
  }

  /** Decide which bodies get full visuals: everything, or the most massive plus selection. */
  private chooseFullBodies(): void {
    const bodies = this.sim.bodies;
    const max = this.quality.maxFullBodies;
    if (bodies.length <= max) {
      this.fullIds = new Set(bodies.map((b) => b.id));
      return;
    }
    const ranked = [...bodies].sort((a, b) => b.mass - a.mass).slice(0, max);
    this.fullIds = new Set(ranked.map((b) => b.id));
    if (this.selectedId !== undefined) this.fullIds.add(this.selectedId);
    if (this.followId !== undefined) this.fullIds.add(this.followId);
  }

  /** Create/remove visuals to match the simulation's body list. */
  private sync(): void {
    const bodies = this.sim.bodies;
    if (this.frame % 30 === 0 || bodies.length <= this.quality.maxFullBodies || this.fullIds.size === 0) this.chooseFullBodies();
    if (this.selectedId !== undefined) this.fullIds.add(this.selectedId);
    if (this.followId !== undefined) this.fullIds.add(this.followId);
    const alive = new Set<number>();
    for (const b of bodies) {
      alive.add(b.id);
      if (!this.fullIds.has(b.id)) continue;
      let v = this.visuals.get(b.id);
      if (!v) {
        v = new BodyVisual(b, this.quality.trailLength);
        this.visuals.set(b.id, v);
        this.scene.add(v.group);
        this.trailGroup.add(v.trail);
      } else {
        v.refresh(b);
      }
    }
    for (const [id, v] of this.visuals) {
      if (!alive.has(id) || !this.fullIds.has(id)) {
        this.disposeVisual(v);
        this.visuals.delete(id);
      }
    }
    if (this.selectedId !== undefined && !alive.has(this.selectedId)) this.selectedId = undefined;
    if (this.followId !== undefined && !alive.has(this.followId)) this.followId = undefined;
  }

  private disposeVisual(v: BodyVisual): void {
    this.scene.remove(v.group);
    this.trailGroup.remove(v.trail);
    v.dispose();
  }

  /** World size of one screen pixel at the given point. */
  worldPerPixel(p: THREE.Vector3, viewportHeight: number): number {
    const dist = this.camera.position.distanceTo(p);
    return (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / viewportHeight;
  }

  follow(id: number | undefined): void {
    this.followId = id;
    this.followBlend = 0;
    const body = id !== undefined ? this.sim.getBody(id) : undefined;
    if (body) {
      const current = this.cameraDistance;
      this.followStartDistance = current;
      // Close enough to see the body properly, but keep the user's zoom if it's already reasonable.
      this.followDistance = THREE.MathUtils.clamp(current, body.radius * 4, body.radius * 14);
    }
  }

  update(dt: number, viewportHeight: number, simRunning: boolean, events: SimEvent[]): void {
    this.frame++;
    this.sync();
    const camDist = this.cameraDistance;

    // Follow camera: move target and camera together.
    const followed = this.followId !== undefined ? this.sim.getBody(this.followId) : undefined;
    if (followed) {
      const blending = this.followBlend < 1;
      this.followBlend = Math.min(1, this.followBlend + dt * 1.2);
      const ease = 1 - Math.pow(1 - this.followBlend, 3);
      const desired = new THREE.Vector3(followed.x, followed.y, followed.z);
      const delta = desired.sub(this.controls.target).multiplyScalar(blending ? ease : 1);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
      if (blending) {
        // Zoom smoothly in log space so huge distance changes still feel even.
        const offset = this.camera.position.clone().sub(this.controls.target);
        const d = Math.exp(THREE.MathUtils.lerp(Math.log(this.followStartDistance), Math.log(this.followDistance), ease));
        offset.setLength(d);
        this.camera.position.copy(this.controls.target).add(offset);
      }
    }
    if (this.cameraAnim) {
      const a = this.cameraAnim;
      a.t = Math.min(1, a.t + dt * a.speed);
      const e = 1 - Math.pow(1 - a.t, 3);
      this.camera.position.lerpVectors(a.from, a.to, e);
      if (!followed) this.controls.target.copy(a.target);
      if (a.t >= 1) this.cameraAnim = undefined;
    }
    this.controls.update();

    // Climate (temperature-dependent looks) a couple of times per second.
    this.climateTimer -= dt;
    const updateClimate = this.climateTimer <= 0;
    if (updateClimate) this.climateTimer = 0.5;

    // Trails relative to the followed body if requested.
    const ref = this.trailFrame === 'follow' ? followed : undefined;
    if ((ref?.id ?? undefined) !== this.lastTrailRef) {
      this.lastTrailRef = ref?.id;
      this.clearTrails();
    }

    const tmp = new THREE.Vector3();
    const spacing = camDist * 0.004;
    let detailCandidate: { v: BodyVisual; b: Body; px: number } | undefined;
    for (const b of this.sim.bodies) {
      const v = this.visuals.get(b.id);
      if (!v) continue;
      tmp.set(b.x, b.y, b.z);
      const wpp = this.worldPerPixel(tmp, viewportHeight);
      const lockId = this.locks.get(b.id);
      v.update(b, wpp, dt, lockId !== undefined ? this.sim.getBody(lockId) : undefined);
      if (updateClimate && v.isPlanet) {
        v.setClimate(climateFor(b.kind, bodyTemperature(this.sim.bodies, b)));
        const parent = this.sim.parentOf(b);
        const d = parent ? Math.hypot(b.x - parent.x, b.y - parent.y, b.z - parent.z) : 0;
        if (parent && isTidallyLocked(b, parent, d)) this.locks.set(b.id, parent.id);
        else this.locks.delete(b.id);
      }
      if (this.trailsEnabled) {
        if (simRunning) v.pushTrail(b, spacing, ref);
        else v.placeTrail(ref);
      }
      v.trail.visible = this.trailsEnabled;
      v.label.visible = this.labelsEnabled && this.shouldLabel(b);
      if (v.isPlanet) {
        const px = v.pixelRadius(b, wpp);
        if (px > DETAIL_PIXEL_RADIUS && v.detailKey !== v.wantedDetailKey(b) && (!detailCandidate || px > detailCandidate.px)) {
          detailCandidate = { v, b, px };
        }
      }
    }
    // At most one expensive texture build per frame, largest on-screen planet first.
    if (detailCandidate) detailCandidate.v.applyDetail(detailCandidate.b, this.quality.textureWidth);

    this.updateLights();
    this.updateParticles();
    this.updateBodyPoints();
    this.updateHabitableZones();
    this.updateOrbitLine();
    this.updateShockwaves();
    this.updateLagrange();
    this.updateRipples(dt);

    // Selection marker.
    const sel = this.selectedId !== undefined ? this.sim.getBody(this.selectedId) : undefined;
    this.marker.visible = !!sel;
    if (sel) this.marker.position.set(sel.x, sel.y, sel.z);

    for (const e of events) this.addFlash(e);
    this.updateFlashes(dt);

    this.starfield.position.copy(this.camera.position);
    this.starfield.scale.setScalar(this.camera.far * 0.5);
  }

  private updateLagrange(): void {
    const sel = this.selectedId !== undefined ? this.sim.getBody(this.selectedId) : undefined;
    const parent = this.lagrangeEnabled && sel ? this.sim.parentOf(sel) : undefined;
    const points = sel && parent ? lagrangePoints(parent, sel) : [];
    this.lagrangeMarkers.forEach((m, i) => {
      const p = points[i];
      m.visible = !!p;
      (m.children[0] as CSS2DObject).visible = !!p;
      if (p) m.position.set(p.x, p.y, p.z);
    });
  }

  /** Expanding gravitational-wave rings from compact-object mergers. */
  private updateRipples(dt: number): void {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        r.mesh.geometry.dispose();
        this.ripples.splice(i, 1);
        continue;
      }
      r.mesh.scale.setScalar(r.size * (0.1 + t * 3));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - t);
    }
  }

  private shouldLabel(b: Body): boolean {
    if (b.id === this.selectedId || b.id === this.followId) return true;
    const n = this.sim.bodies.length;
    if (n <= 30) return true;
    if (n > 300) return false;
    return b.kind !== 'rocky' && b.kind !== 'gas';
  }

  private updateLights(): void {
    const stars = this.sim.bodies
      .filter((b) => isLuminous(b.kind))
      .sort((a, b) => luminosity(b) - luminosity(a))
      .slice(0, MAX_LIGHTS);
    this.lights.forEach((light, i) => {
      const s = stars[i];
      if (!s) {
        light.intensity = 0;
        return;
      }
      light.position.set(s.x, s.y, s.z);
      light.color.setHex(s.color);
      light.intensity = THREE.MathUtils.clamp(1.2 + Math.log10(luminosity(s) + 1) * 0.6, 0.8, 3.5);
    });
  }

  private updateHabitableZones(): void {
    const stars = this.habitableZones
      ? this.sim.bodies
          .filter((b) => isLuminous(b.kind))
          .sort((a, b) => luminosity(b) - luminosity(a))
          .slice(0, MAX_HZ)
      : [];
    this.hzRings.forEach((ring, i) => {
      const s = stars[i];
      ring.visible = !!s;
      if (!s) return;
      const [inner, outer] = habitableZone(luminosity(s));
      const geo = ring.geometry as THREE.RingGeometry;
      if (geo.parameters.innerRadius !== inner || geo.parameters.outerRadius !== outer) {
        geo.dispose();
        ring.geometry = new THREE.RingGeometry(inner, outer, 128, 1);
      }
      ring.position.set(s.x, s.y, s.z);
    });
  }

  private updateOrbitLine(): void {
    const sel = this.selectedId !== undefined ? this.sim.getBody(this.selectedId) : undefined;
    if (!this.orbitsEnabled || !sel || this.frame % 3 !== 0) {
      if (!sel || !this.orbitsEnabled) this.orbitLine.visible = false;
      return;
    }
    const parent = this.sim.parentOf(sel);
    if (!parent) {
      this.orbitLine.visible = false;
      return;
    }
    const mu = this.sim.effectiveG * (parent.mass + sel.mass);
    const path = orbitPath(mu, sel.x - parent.x, sel.y - parent.y, sel.z - parent.z, sel.vx - parent.vx, sel.vy - parent.vy, sel.vz - parent.vz);
    if (!path) {
      this.orbitLine.visible = false;
      return;
    }
    const geo = this.orbitLine.geometry;
    const attr = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (attr && attr.array.length === path.length) {
      (attr.array as Float32Array).set(path);
      attr.needsUpdate = true;
    } else {
      geo.setAttribute('position', new THREE.BufferAttribute(path, 3));
    }
    this.orbitLine.position.set(parent.x, parent.y, parent.z);
    this.orbitLine.visible = true;
  }

  /** Show (or hide with undefined) the closest-approach / impact markers. */
  showApproach(a: Approach | undefined): void {
    if (!a) {
      this.approachGroup.visible = false;
      return;
    }
    const color = a.impact ? 0xff4a4a : 0xffb24a;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a.self), new THREE.Vector3(...a.other)]);
    this.approachLine.geometry.dispose();
    this.approachLine.geometry = geo;
    const mat = this.approachLine.material as THREE.LineDashedMaterial;
    mat.color.setHex(color);
    const len = Math.max(a.distance, 1e-6);
    mat.dashSize = len / 12;
    mat.gapSize = len / 18;
    this.approachLine.computeLineDistances();
    this.approachLine.visible = true;
    this.approachMarkers[0].position.set(...a.self);
    this.approachMarkers[1].position.set(...a.other);
    for (const m of this.approachMarkers) m.material.color.setHex(color);
    this.approachGroup.visible = true;
  }

  private updateParticles(): void {
    const p = this.sim.particles;
    const n3 = p.count * 3;
    this.particlePos.set(p.pos.subarray(0, n3));
    this.particleCol.set(p.color.subarray(0, n3));
    this.flushPoints(this.particlePoints, p.count);
  }

  private updateBodyPoints(): void {
    const bodies = this.sim.bodies;
    const rest = bodies.length - this.visuals.size;
    if (rest <= 0) {
      this.bodyPoints.visible = false;
      return;
    }
    if (this.bodyPointPos.length < bodies.length * 3) {
      this.bodyPointPos = new Float32Array(bodies.length * 6);
      this.bodyPointCol = new Float32Array(bodies.length * 6);
      const geo = this.bodyPoints.geometry;
      geo.setAttribute('position', new THREE.BufferAttribute(this.bodyPointPos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(this.bodyPointCol, 3).setUsage(THREE.DynamicDrawUsage));
    }
    let n = 0;
    const c = new THREE.Color();
    for (const b of bodies) {
      if (this.visuals.has(b.id)) continue;
      const k = n * 3;
      this.bodyPointPos[k] = b.x;
      this.bodyPointPos[k + 1] = b.y;
      this.bodyPointPos[k + 2] = b.z;
      c.setHex(b.kind === 'blackhole' ? 0xb07cff : b.color);
      this.bodyPointCol[k] = c.r;
      this.bodyPointCol[k + 1] = c.g;
      this.bodyPointCol[k + 2] = c.b;
      n++;
    }
    this.bodyPoints.visible = true;
    this.flushPoints(this.bodyPoints, n);
  }

  private flushPoints(points: THREE.Points, count: number): void {
    const geo = points.geometry;
    geo.setDrawRange(0, count);
    for (const name of ['position', 'color']) {
      const a = geo.attributes[name] as THREE.BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, count * 3);
      a.needsUpdate = true;
    }
  }

  private updateShockwaves(): void {
    const waves = this.sim.shockwaves;
    while (this.shockShells.length < waves.length) {
      // Rim-lit bubble: bright at the limb, transparent face-on.
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), atmosphereMaterial(0x9fd0ff, 0.8));
      this.shockShells.push(shell);
      this.scene.add(shell);
    }
    this.shockShells.forEach((shell, i) => {
      const w = waves[i];
      shell.visible = !!w;
      if (!w) return;
      shell.position.set(w.x, w.y, w.z);
      shell.scale.setScalar(w.radius);
      (shell.material as THREE.ShaderMaterial).uniforms.uIntensity.value = 0.9 * (1 - w.radius / w.maxRadius);
    });
  }

  private addFlash(e: SimEvent): void {
    const colors: Record<SimEvent['type'], number> = {
      merge: 0xffa860,
      shatter: 0xffc070,
      disrupt: 0xff8a50,
      ignite: 0xfff2c0,
      collapse: 0xb07cff,
      supernova: 0xd8ecff,
      gwmerger: 0xb8d4ff,
      redgiant: 0xff7040,
      nebula: 0x60f0d0,
      script: 0x000000,
    };
    if (e.type === 'script') return;
    if (e.type === 'gwmerger') {
      for (let k = 0; k < 3; k++) {
        const mesh = new THREE.Mesh(
          new THREE.RingGeometry(0.96, 1, 96, 1),
          new THREE.MeshBasicMaterial({ color: 0xb8d4ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(e.x, e.y, e.z);
        this.scene.add(mesh);
        this.ripples.push({ mesh, age: -k * 0.35, life: 2.5, size: Math.max(e.size, 0.5) });
      }
    }
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: colors[e.type], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    sprite.position.set(e.x, e.y, e.z);
    this.scene.add(sprite);
    const life = e.type === 'supernova' ? 4 : e.type === 'merge' || e.type === 'shatter' ? 0.9 : 2.2;
    this.flashes.push({ sprite, age: 0, life, size: Math.max(e.size * 10, 0.05) });
  }

  private updateFlashes(dt: number): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        this.scene.remove(f.sprite);
        f.sprite.material.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      f.sprite.scale.setScalar(f.size * (0.3 + t * 1.4));
      f.sprite.material.opacity = (1 - t) * (1 - t);
    }
  }

  /** Nearest body to a screen point, using projected positions (forgiving for tiny bodies). */
  pick(ndcX: number, ndcY: number, viewportWidth: number, viewportHeight: number): Body | undefined {
    const v = new THREE.Vector3();
    let best: Body | undefined;
    let bestScore = Infinity;
    for (const b of this.sim.bodies) {
      v.set(b.x, b.y, b.z).project(this.camera);
      if (v.z > 1) continue;
      const dx = ((v.x - ndcX) * viewportWidth) / 2;
      const dy = ((v.y - ndcY) * viewportHeight) / 2;
      const distPx = Math.hypot(dx, dy);
      const radiusPx = b.radius / this.worldPerPixel(new THREE.Vector3(b.x, b.y, b.z), viewportHeight);
      const reach = Math.max(12, radiusPx + 4);
      if (distPx <= reach && distPx - radiusPx < bestScore) {
        bestScore = distPx - radiusPx;
        best = b;
      }
    }
    return best;
  }

  /** Intersection of a screen ray with the horizontal plane through `planeY`. */
  planePoint(ndcX: number, ndcY: number, planeY: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }

  showSpawnPreview(pos: THREE.Vector3, radius: number, velocity: THREE.Vector3, arrowScale: number, path?: Float32Array): void {
    this.ghost.visible = true;
    this.ghost.position.copy(pos);
    this.ghost.scale.setScalar(Math.max(radius, this.worldPerPixel(pos, 800) * 3));
    const speed = velocity.length();
    this.arrow.visible = speed > 0;
    if (speed > 0) {
      this.arrow.position.copy(pos);
      this.arrow.setDirection(velocity.clone().normalize());
      const len = speed * arrowScale;
      this.arrow.setLength(len, Math.min(len * 0.3, arrowScale * 2), Math.min(len * 0.15, arrowScale));
    }
    if (path && path.length >= 6) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(path, 3));
      this.predictLine.geometry.dispose();
      this.predictLine.geometry = geo;
      const mat = this.predictLine.material as THREE.LineDashedMaterial;
      mat.dashSize = this.cameraDistance * 0.012;
      mat.gapSize = this.cameraDistance * 0.008;
      this.predictLine.computeLineDistances();
      this.predictLine.visible = true;
    }
  }

  hideSpawnPreview(): void {
    this.ghost.visible = false;
    this.arrow.visible = false;
    this.predictLine.visible = false;
  }
}
