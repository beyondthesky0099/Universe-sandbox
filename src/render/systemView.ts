import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { luminosity, type Body } from '../sim/body';
import type { SceneSetup } from '../sim/presets';
import type { SimEvent, Simulation } from '../sim/simulation';
import { BodyVisual } from './bodyVisual';
import { createStarfield } from './starfield';
import { dotTexture, glowTexture, ringTexture } from './textures';

const MAX_LIGHTS = 4;

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
  selectedId: number | undefined;
  followId: number | undefined;

  private readonly visuals = new Map<number, BodyVisual>();
  private readonly starfield = createStarfield();
  private readonly lights: THREE.PointLight[] = [];
  private readonly particlePoints: THREE.Points;
  private readonly particlePos: Float32Array;
  private readonly particleCol: Float32Array;
  private readonly marker: THREE.Sprite;
  private readonly flashes: Flash[] = [];
  private readonly ghost: THREE.Mesh;
  private readonly arrow: THREE.ArrowHelper;
  private readonly predictLine: THREE.Line;
  private readonly trailGroup = new THREE.Group();
  private followBlend = 1;
  private followDistance = 0;
  private cameraAnim?: { from: THREE.Vector3; to: THREE.Vector3; t: number };

  constructor(
    private readonly sim: Simulation,
    domElement: HTMLElement,
  ) {
    this.camera = new THREE.PerspectiveCamera(55, 1, 1e-4, 1e7);
    this.camera.position.set(0, 5, 8);
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 1.4;
    this.controls.minDistance = 0.002;
    this.controls.maxDistance = 5e4;

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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.particlePos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.particleCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.particlePoints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 2.5,
        sizeAttenuation: false,
        vertexColors: true,
        map: dotTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.particlePoints.frustumCulled = false;
    this.scene.add(this.particlePoints);

    this.marker = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), sizeAttenuation: false, depthTest: false, transparent: true }),
    );
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
    this.predictLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0x7fdcff, dashSize: 1, gapSize: 0.6, transparent: true, opacity: 0.8 }),
    );
    this.predictLine.frustumCulled = false;
    this.predictLine.visible = false;
    this.scene.add(this.predictLine);
  }

  setViewport(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Remove all visuals (e.g. before loading a new scene) and frame the camera. */
  reset(setup: SceneSetup): void {
    for (const v of this.visuals.values()) this.disposeVisual(v);
    this.visuals.clear();
    for (const f of this.flashes) this.scene.remove(f.sprite);
    this.flashes.length = 0;
    this.selectedId = undefined;
    this.followId = undefined;
    const el = setup.elevation ?? 0.8;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, Math.sin(el) * setup.cameraDistance, Math.cos(el) * setup.cameraDistance);
    this.cameraAnim = undefined;
    this.controls.update();
    this.sync();
  }

  clearTrails(): void {
    for (const v of this.visuals.values()) v.clearTrail();
  }

  /** Create/remove visuals to match the simulation's body list. */
  private sync(): void {
    const alive = new Set<number>();
    for (const b of this.sim.bodies) {
      alive.add(b.id);
      let v = this.visuals.get(b.id);
      if (!v) {
        v = new BodyVisual(b);
        this.visuals.set(b.id, v);
        this.scene.add(v.group);
        this.trailGroup.add(v.trail);
      } else {
        v.refresh(b);
      }
    }
    for (const [id, v] of this.visuals) {
      if (!alive.has(id)) {
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
      const current = this.camera.position.distanceTo(this.controls.target);
      this.followDistance = THREE.MathUtils.clamp(current, body.radius * 8, Math.max(body.radius * 60, 0.5));
    }
  }

  /** Smoothly move the camera to look at the origin from a given distance. */
  frame(distance: number): void {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.cameraAnim = { from: this.camera.position.clone(), to: dir.multiplyScalar(distance), t: 0 };
    this.controls.target.set(0, 0, 0);
  }

  update(dt: number, viewportHeight: number, simRunning: boolean, events: SimEvent[]): void {
    this.sync();
    const camDist = this.camera.position.distanceTo(this.controls.target);

    // Follow camera: move target and camera together.
    const followed = this.followId !== undefined ? this.sim.getBody(this.followId) : undefined;
    if (followed) {
      this.followBlend = Math.min(1, this.followBlend + dt * 2.5);
      const ease = this.followBlend < 1 ? 1 - Math.pow(1 - this.followBlend, 3) : 1;
      const desired = new THREE.Vector3(followed.x, followed.y, followed.z);
      const delta = desired.sub(this.controls.target).multiplyScalar(ease);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
      if (this.followBlend < 1) {
        const offset = this.camera.position.clone().sub(this.controls.target);
        offset.setLength(THREE.MathUtils.lerp(offset.length(), this.followDistance, ease * 0.15));
        this.camera.position.copy(this.controls.target).add(offset);
      }
    }
    if (this.cameraAnim) {
      const a = this.cameraAnim;
      a.t = Math.min(1, a.t + dt * 1.5);
      const e = 1 - Math.pow(1 - a.t, 3);
      this.camera.position.lerpVectors(a.from, a.to, e);
      if (a.t >= 1) this.cameraAnim = undefined;
    }
    this.controls.update();

    // Bodies.
    const tmp = new THREE.Vector3();
    const spacing = camDist * 0.004;
    for (const b of this.sim.bodies) {
      const v = this.visuals.get(b.id)!;
      tmp.set(b.x, b.y, b.z);
      v.update(b, this.worldPerPixel(tmp, viewportHeight), dt);
      if (simRunning && this.trailsEnabled) v.pushTrail(b, spacing);
      v.trail.visible = this.trailsEnabled;
      v.label.visible = this.labelsEnabled && this.shouldLabel(b);
    }

    this.updateLights();
    this.updateParticles();

    // Selection marker.
    const sel = this.selectedId !== undefined ? this.sim.getBody(this.selectedId) : undefined;
    this.marker.visible = !!sel;
    if (sel) this.marker.position.set(sel.x, sel.y, sel.z);

    for (const e of events) this.addFlash(e);
    this.updateFlashes(dt);

    this.starfield.position.copy(this.camera.position);
    this.starfield.scale.setScalar(this.camera.far * 0.5);
  }

  private shouldLabel(b: Body): boolean {
    if (b.id === this.selectedId || b.id === this.followId) return true;
    const n = this.sim.bodies.length;
    if (n <= 30) return true;
    return b.kind === 'star' || b.kind === 'blackhole';
  }

  private updateLights(): void {
    const stars = this.sim.bodies
      .filter((b) => b.kind === 'star')
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

  private updateParticles(): void {
    const p = this.sim.particles;
    const n3 = p.count * 3;
    for (let k = 0; k < n3; k++) {
      this.particlePos[k] = p.pos[k];
      this.particleCol[k] = p.color[k];
    }
    const geo = this.particlePoints.geometry;
    geo.setDrawRange(0, p.count);
    const pa = geo.attributes.position as THREE.BufferAttribute;
    const ca = geo.attributes.color as THREE.BufferAttribute;
    pa.clearUpdateRanges();
    pa.addUpdateRange(0, n3);
    pa.needsUpdate = true;
    ca.clearUpdateRanges();
    ca.addUpdateRange(0, n3);
    ca.needsUpdate = true;
  }

  private addFlash(e: SimEvent): void {
    const color = e.type === 'collapse' ? 0xb07cff : e.type === 'ignite' ? 0xfff2c0 : 0xffa860;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    sprite.position.set(e.x, e.y, e.z);
    this.scene.add(sprite);
    this.flashes.push({ sprite, age: 0, life: e.type === 'merge' ? 0.9 : 2.2, size: Math.max(e.size * 10, 0.05) });
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
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out);
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
      const camDist = this.camera.position.distanceTo(this.controls.target);
      const mat = this.predictLine.material as THREE.LineDashedMaterial;
      mat.dashSize = camDist * 0.012;
      mat.gapSize = camDist * 0.008;
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
