import * as THREE from 'three';
import { mulberry32 } from '../procgen/rng';
import { Noise3D } from './noise';

/**
 * Standing on a planet's surface.
 *
 * The camera rides on the planet's own rotating frame at eye height, so its sky turns: the Sun
 * rises and sets as the planet spins at its real rate. Around the landing site a patch of terrain
 * is built on the sphere:
 * - It is a polar grid, fine near the eye and coarser towards the horizon.
 * - It has procedural relief: rolling hills where wind and water wear the land down, sharp ridges
 *   and craters on airless worlds.
 * - It is coloured by the planet's own map, so the ground matches the view from orbit.
 * - It blends into the planet's sphere at its edge.
 * The sky is the atmosphere's own scattering seen from inside (atmosphere.ts): blue on Earth,
 * butterscotch on Mars, black with stars on the Moon.
 *
 * Drag to look around, WASD or the arrow keys to walk, and the wheel to zoom. The terrain is a
 * model; only the colours come from the real map.
 */
export interface SurfaceKind {
  /** Seed for the terrain (from the body's name). */
  seed: number;
  /** Has air: smoother, weathered relief. Airless: craters and sharper ridges. */
  air: boolean;
}

/** Angular radius of the terrain patch (radians of the planet). */
export const PATCH_RADIUS = 0.06;
const RINGS = 140;
const SEGMENTS = 256;
/** Eye height above the ground, in planet radii. */
export const EYE_HEIGHT = 3e-5;
/** Relief amplitude, in planet radii. */
const RELIEF = 0.0025;

/** Terrain height (planet radii) at a point on the unit sphere, before the edge fade. */
export function terrainHeight(noise: Noise3D, craters: Crater[], kind: SurfaceKind, d: THREE.Vector3): number {
  const f = 60;
  let h: number;
  if (kind.air) {
    // Rolling hills with a few ridges, worn smooth.
    h = 0.6 * noise.fbm(d.x * f, d.y * f, d.z * f, 6) + 0.4 * noise.ridged(d.x * f * 0.5, d.y * f * 0.5, d.z * f * 0.5, 4) - 0.2;
  } else {
    h = 0.8 * noise.fbm(d.x * f, d.y * f, d.z * f, 7) + 0.3 * noise.ridged(d.x * f * 2, d.y * f * 2, d.z * f * 2, 3) - 0.15;
  }
  h *= RELIEF;
  for (const c of craters) {
    const a = Math.acos(Math.min(1, d.dot(c.centre))) / c.radius;
    if (a > 1.6) continue;
    // A bowl with a raised rim (depth ~ 1/5 of the diameter scaled down; ejecta beyond the rim).
    const bowl = a < 1 ? (a * a - 1) * c.depth : 0;
    const rim = Math.exp(-((a - 1) ** 2) / 0.02) * c.depth * 0.35;
    const ejecta = a > 1 ? Math.exp(-(a - 1) * 4) * c.depth * 0.1 : 0;
    h += bowl + rim + ejecta;
  }
  return h;
}

export interface Crater {
  centre: THREE.Vector3;
  radius: number; // radians
  depth: number; // planet radii
}

/** Craters scattered around a site: many small ones, a few large ones (a power law). */
export function cratersAround(site: THREE.Vector3, seed: number, count: number): Crater[] {
  const rng = mulberry32(seed ^ 0x5eed);
  const [e1, e2] = tangentBasis(site);
  const out: Crater[] = [];
  for (let i = 0; i < count; i++) {
    const r = PATCH_RADIUS * Math.sqrt(rng());
    const t = rng() * Math.PI * 2;
    const centre = site.clone().addScaledVector(e1, r * Math.cos(t)).addScaledVector(e2, r * Math.sin(t)).normalize();
    const radius = 0.0008 * Math.pow(1 - rng() * 0.98, -0.9);
    out.push({ centre, radius: Math.min(radius, PATCH_RADIUS * 0.4), depth: Math.min(radius, PATCH_RADIUS * 0.4) * 0.12 });
  }
  return out;
}

/** Two unit vectors tangent to the sphere at `n`: east and north (the pole is +y). */
export function tangentBasis(n: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const pole = Math.abs(n.y) > 0.999 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const east = new THREE.Vector3().crossVectors(pole, n).normalize();
  const north = new THREE.Vector3().crossVectors(n, east).normalize();
  return [east, north];
}

/** Equirectangular texture coordinates matching three's SphereGeometry for a unit direction. */
export function sphereUv(d: THREE.Vector3): [number, number] {
  let phi = Math.atan2(d.z, -d.x);
  if (phi < 0) phi += Math.PI * 2;
  return [phi / (Math.PI * 2), 1 - Math.acos(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI];
}

/** Latitude and longitude (degrees) of a direction in the planet's frame. */
export function latLon(d: THREE.Vector3): { lat: number; lon: number } {
  const [u] = sphereUv(d);
  let lon = u * 360 - 180;
  if (lon > 180) lon -= 360;
  return { lat: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))), lon };
}

/** Builds the terrain patch geometry around `site` (unit vector, planet frame). */
export function terrainPatch(site: THREE.Vector3, kind: SurfaceKind): { geometry: THREE.BufferGeometry; height: (d: THREE.Vector3) => number } {
  const noise = new Noise3D(kind.seed);
  const craters = kind.air ? cratersAround(site, kind.seed, 6) : cratersAround(site, kind.seed, 90);
  const [e1, e2] = tangentBasis(site);
  const fade = (ang: number) => 1 - THREE.MathUtils.smoothstep(ang / PATCH_RADIUS, 0.65, 1);
  const height = (d: THREE.Vector3) => terrainHeight(noise, craters, kind, d) * fade(Math.acos(Math.min(1, d.dot(site))));
  const n = 1 + RINGS * SEGMENTS;
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 3);
  const [u0] = sphereUv(site);
  const d = new THREE.Vector3();
  const put = (i: number, dir: THREE.Vector3) => {
    const h = height(dir);
    pos[i * 3] = dir.x * (1 + h);
    pos[i * 3 + 1] = dir.y * (1 + h);
    pos[i * 3 + 2] = dir.z * (1 + h);
    let [u, v] = sphereUv(dir);
    // Unwrap across the map's seam so triangles don't smear the whole texture.
    if (u - u0 > 0.5) u -= 1;
    if (u - u0 < -0.5) u += 1;
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
    // Fine detail the map is too coarse to show: lighter on high ground, darker in hollows.
    const t = 0.82 + 0.25 * noise.fbm(dir.x * 900, dir.y * 900, dir.z * 900, 3) + (h / RELIEF) * 0.15;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = THREE.MathUtils.clamp(t, 0.4, 1.3);
  };
  put(0, site);
  for (let r = 1; r <= RINGS; r++) {
    // Rings bunch up near the eye: spacing grows with the square of the distance.
    const ang = PATCH_RADIUS * (r / RINGS) ** 2;
    for (let s = 0; s < SEGMENTS; s++) {
      const t = (s / SEGMENTS) * Math.PI * 2;
      d.copy(site).multiplyScalar(Math.cos(ang)).addScaledVector(e1, Math.sin(ang) * Math.cos(t)).addScaledVector(e2, Math.sin(ang) * Math.sin(t)).normalize();
      put(1 + (r - 1) * SEGMENTS + s, d);
    }
  }
  const index: number[] = [];
  for (let s = 0; s < SEGMENTS; s++) index.push(0, 1 + s, 1 + ((s + 1) % SEGMENTS));
  for (let r = 1; r < RINGS; r++) {
    const a = 1 + (r - 1) * SEGMENTS, b = 1 + r * SEGMENTS;
    for (let s = 0; s < SEGMENTS; s++) {
      const s1 = (s + 1) % SEGMENTS;
      index.push(a + s, b + s, b + s1, a + s, b + s1, a + s1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return { geometry, height };
}

/**
 * Local solar time (hours, 12 = noon) at `site` for the Sun in direction `sun`, both in the
 * planet's frame, which spins about +y: the hour angle is how far the planet has turned the site
 * past the Sun's meridian.
 */
export function localSolarTime(site: THREE.Vector3, sun: THREE.Vector3): number {
  const cross = site.z * sun.x - site.x * sun.z;
  const dot = site.x * sun.x + site.z * sun.z;
  if (Math.abs(cross) + Math.abs(dot) < 1e-12) return 12;
  const ha = Math.atan2(-cross, dot);
  return (((12 + (ha * 12) / Math.PI) % 24) + 24) % 24;
}

/** Real rotation of the planet frame: angle (radians) after `years` at `hours` per turn (negative = backwards). */
export function rotationAngle(years: number, hours: number): number {
  return (years * 8766 * 2 * Math.PI) / hours;
}

export class Lander {
  active = false;
  private frame?: THREE.Object3D;
  private patch?: THREE.Mesh;
  private site = new THREE.Vector3(0, 1, 0);
  private kind: SurfaceKind = { seed: 1, air: true };
  private map?: THREE.Texture | null;
  private height: (d: THREE.Vector3) => number = () => 0;
  /** Heading (radians from north, clockwise) and pitch (up from the horizon). */
  private yaw = 0;
  private pitch = 0.12;
  private savedNear = 0;
  private savedFov = 0;
  private savedUp = new THREE.Vector3(0, 1, 0);
  private walk = new Set<string>();
  private drag?: { x: number; y: number };
  /** The planet's rotation: angle at sim time t0, hours per turn. */
  private spin = { angle0: 0, t0: 0, hours: 24 };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    dom.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.active || !this.drag) return;
      const k = (this.camera.fov / 60) * 0.005;
      this.yaw += (e.clientX - this.drag.x) * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this.drag.y) * k, -1.4, 1.5);
      this.drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => (this.drag = undefined));
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        this.camera.fov = THREE.MathUtils.clamp(this.camera.fov * Math.exp(e.deltaY * 0.001), 5, 100);
        this.camera.updateProjectionMatrix();
      },
      { passive: false },
    );
  }

  /**
   * Land on the planet whose (spinning) mesh is `frame` at `site` (unit vector in that frame).
   * `hours` is its rotation period (negative for backwards), `simTime` the current time (years).
   */
  land(frame: THREE.Mesh, site: THREE.Vector3, kind: SurfaceKind, hours: number, simTime: number): void {
    this.takeOff();
    this.frame = frame;
    this.kind = kind;
    this.map = (frame.material as THREE.MeshStandardMaterial).map;
    if (this.map) {
      // The patch's texture coordinates run past 0…1 where they cross the map's seam.
      this.map.wrapS = THREE.RepeatWrapping;
      this.map.needsUpdate = true;
    }
    this.spin = { angle0: frame.rotation.y, t0: simTime, hours };
    this.savedNear = this.camera.near;
    this.savedFov = this.camera.fov;
    this.savedUp.copy(this.camera.up);
    this.camera.fov = 70;
    this.build(site);
    this.active = true;
    this.yaw = 0;
    this.pitch = 0.12;
  }

  /** Face a direction given in the planet frame (e.g. towards the Sun). */
  faceTowards(localDir: THREE.Vector3): void {
    const [east, north] = tangentBasis(this.site);
    this.yaw = Math.atan2(localDir.dot(east), localDir.dot(north));
  }

  private build(site: THREE.Vector3): void {
    if (this.patch) {
      this.patch.parent?.remove(this.patch);
      this.patch.geometry.dispose();
      (this.patch.material as THREE.Material).dispose();
    }
    this.site.copy(site).normalize();
    const { geometry, height } = terrainPatch(this.site, this.kind);
    this.height = height;
    const material = new THREE.MeshStandardMaterial({ map: this.map ?? null, vertexColors: true, roughness: 1, metalness: 0 });
    if (!this.map) material.color.copy((this.frame as THREE.Mesh).material instanceof THREE.MeshStandardMaterial ? ((this.frame as THREE.Mesh).material as THREE.MeshStandardMaterial).color : new THREE.Color(0x888888));
    this.patch = new THREE.Mesh(geometry, material);
    this.frame!.add(this.patch);
  }

  takeOff(): void {
    if (!this.active && !this.patch) return;
    if (this.patch) {
      this.patch.parent?.remove(this.patch);
      this.patch.geometry.dispose();
      (this.patch.material as THREE.Material).dispose();
      this.patch = undefined;
    }
    if (this.active) {
      this.camera.near = this.savedNear;
      this.camera.fov = this.savedFov;
      this.camera.up.copy(this.savedUp);
      this.camera.updateProjectionMatrix();
    }
    this.active = false;
    this.frame = undefined;
    this.walk.clear();
  }

  /** Walking keys (WASD / arrows). Returns true if the key was used. */
  key(code: string, down: boolean): boolean {
    if (!this.active) return false;
    const k = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' }[code];
    if (!k) return false;
    if (down) this.walk.add(k);
    else this.walk.delete(k);
    return true;
  }

  /** Where the camera stands (planet frame) and its latitude/longitude. */
  get position(): { lat: number; lon: number } {
    return latLon(this.site);
  }

  /** Whether the world has air (a sky that hides the stars by day). */
  get hasAir(): boolean {
    return this.kind.air;
  }

  /** The Sun's height above the horizon at the site (degrees), from its world position. */
  sunElevation(sunWorld: THREE.Vector3): number {
    if (!this.frame) return -90;
    const centre = new THREE.Vector3().setFromMatrixPosition(this.frame.matrixWorld);
    const up = this.site.clone().transformDirection(this.frame.matrixWorld);
    const toSun = sunWorld.clone().sub(centre).normalize();
    return THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(up.dot(toSun), -1, 1)));
  }

  /** Local solar time (hours) at the site, given the Sun's direction in the planet frame. */
  localTime(sunLocal: THREE.Vector3): number {
    return localSolarTime(this.site, sunLocal);
  }

  /** Per frame, after the planet has moved: spin it at its real rate, walk, and place the camera. */
  update(dt: number, simTime: number): void {
    if (!this.active || !this.frame) return;
    const mesh = this.frame;
    mesh.rotation.y = this.spin.angle0 + rotationAngle(simTime - this.spin.t0, this.spin.hours);
    mesh.updateMatrixWorld(true);
    if (this.walk.size) {
      // Walk across the surface (a planet radius takes about 15 seconds... of brisk flying).
      const [east, north] = tangentBasis(this.site);
      const fwd = north.clone().multiplyScalar(Math.cos(this.yaw)).addScaledVector(east, Math.sin(this.yaw));
      const right = new THREE.Vector3().crossVectors(fwd, this.site).negate();
      const step = new THREE.Vector3();
      if (this.walk.has('f')) step.add(fwd);
      if (this.walk.has('b')) step.sub(fwd);
      if (this.walk.has('r')) step.add(right);
      if (this.walk.has('l')) step.sub(right);
      if (step.lengthSq() > 0) {
        this.site.addScaledVector(step.normalize(), dt * 0.0006).normalize();
        // Far from the patch's centre: rebuild it around here.
        if (Math.acos(Math.min(1, this.site.dot(this.patchCentre))) > PATCH_RADIUS * 0.3) this.build(this.site.clone());
      }
    }
    const R = mesh.scale.x;
    const up = this.site.clone();
    const ground = this.height(this.site);
    const eyeLocal = up.clone().multiplyScalar(1 + ground + EYE_HEIGHT);
    const eye = mesh.localToWorld(eyeLocal.clone());
    const [east, north] = tangentBasis(this.site);
    const look = north.multiplyScalar(Math.cos(this.yaw) * Math.cos(this.pitch)).addScaledVector(east, Math.sin(this.yaw) * Math.cos(this.pitch)).addScaledVector(up, Math.sin(this.pitch));
    const target = mesh.localToWorld(eyeLocal.clone().add(look));
    const upWorld = up.clone().transformDirection(mesh.matrixWorld);
    this.camera.position.copy(eye);
    this.camera.up.copy(upWorld);
    this.camera.lookAt(target);
    this.camera.near = Math.max(1e-14, R * EYE_HEIGHT * 0.05);
    this.camera.updateProjectionMatrix();
  }

  private get patchCentre(): THREE.Vector3 {
    // The patch was built around the site at the time; its first vertex is that centre.
    const p = this.patch?.geometry.getAttribute('position');
    return p ? new THREE.Vector3(p.getX(0), p.getY(0), p.getZ(0)).normalize() : this.site;
  }
}
