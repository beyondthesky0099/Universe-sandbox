import * as THREE from 'three';
import { kelvinToRgb } from '../sim/color';
import { altAzToScene, skyAt, skyMatrix, type Observer, type SkySnapshot } from '../sim/sky';
import { temperatureFromBV, type BrightStar } from '../sim/stars';
import { textSprite } from './galaxyView';
import { dotTexture } from './textures';

const DEG = Math.PI / 180;
const R_SKY = 5;
const R_STARS = 4;
const R_BODIES = 3.6;
const R_GROUND = 3;

const PLANET_COLORS: Record<string, string> = {
  Mercury: '#c9bfb5', Venus: '#fff4d6', Mars: '#ff9a6b', Jupiter: '#ffe7c2', Saturn: '#f2dca5', Uranus: '#bfeaf0', Neptune: '#9db7ff',
};
/** Rough on-screen dot sizes (px): bright planets bigger, as they look. */
const PLANET_PX: Record<string, number> = { Venus: 9, Jupiter: 8, Mars: 6, Saturn: 6, Mercury: 5, Uranus: 3.5, Neptune: 3 };

/**
 * The planetarium: the real sky from a place on Earth, looking out from the centre of a dome.
 * Drag to look around, scroll to zoom. Everything is placed by src/sim/sky.ts.
 */
export class SkyView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 20);
  enabled = false;
  observer: Observer = { lat: 51.48, lon: 0 };
  snapshot?: SkySnapshot;
  private yaw = 180 * DEG; // looking south
  private pitch = 20 * DEG;
  private readonly stars = new THREE.Group();
  private readonly starMaterials: THREE.PointsMaterial[] = [];
  private readonly starLabels: { sprite: THREE.Sprite; v: THREE.Vector3 }[] = [];
  private readonly bodies = new Map<string, { dot: THREE.Sprite; label: THREE.Sprite }>();
  private readonly moonCanvas = document.createElement('canvas');
  private readonly moonTexture: THREE.CanvasTexture;
  private readonly dome: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private lastPhase = -1;
  private height = 760;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.camera.rotation.order = 'YXZ';
    // Sky dome coloured by the Sun's altitude, with a glow around the Sun.
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(R_SKY, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { sunDir: { value: new THREE.Vector3(0, -1, 0) } },
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          uniform vec3 sunDir; varying vec3 vDir;
          void main() {
            float s = sunDir.y;                       // sine of the Sun's altitude
            float day = smoothstep(-0.105, 0.1, s);   // civil→nautical twilight to day
            float dusk = smoothstep(-0.31, -0.1, s) * (1.0 - smoothstep(0.05, 0.3, s));
            float up = clamp(vDir.y, 0.0, 1.0);
            vec3 night = vec3(0.008, 0.012, 0.03);
            vec3 dayZenith = vec3(0.16, 0.38, 0.78), dayHorizon = vec3(0.62, 0.76, 0.92);
            vec3 col = mix(night, mix(dayHorizon, dayZenith, pow(up, 0.6)), day);
            float toward = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
            col += dusk * vec3(0.9, 0.42, 0.18) * pow(1.0 - up, 4.0) * (0.35 + 0.65 * toward);
            col += day * vec3(1.0, 0.95, 0.85) * pow(toward, 64.0) * 0.6;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.dome.renderOrder = -20;
    this.scene.add(this.dome);
    // The ground hides everything below the horizon.
    this.ground = new THREE.Mesh(
      new THREE.SphereGeometry(R_GROUND, 48, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x0b0f0b, side: THREE.BackSide }),
    );
    this.ground.renderOrder = 5;
    this.scene.add(this.ground);
    const horizon = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, i) => new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2) * R_GROUND * 0.999, 0.001, Math.sin((i / 128) * Math.PI * 2) * R_GROUND * 0.999))),
      new THREE.LineBasicMaterial({ color: 0x3d5a46 }),
    );
    this.scene.add(horizon);
    for (const [name, az] of [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]] as [string, number][]) {
      const s = textSprite(name, name.length === 1 ? '#ffd27a' : '#b9a77d', name.length === 1 ? 1.3 : 0.9);
      s.position.set(...altAzToScene(1.5, az)).multiplyScalar(R_GROUND * 0.98);
      s.center.set(0.5, 0);
      this.scene.add(s);
    }
    this.stars.matrixAutoUpdate = false;
    this.scene.add(this.stars);
    this.moonCanvas.width = this.moonCanvas.height = 128;
    this.moonTexture = new THREE.CanvasTexture(this.moonCanvas);
    this.moonTexture.colorSpace = THREE.SRGBColorSpace;
    this.addBodies();
    this.attachInput();
  }

  setStars(stars: BrightStar[]): void {
    const layers: [number, number, number][] = [[-Infinity, 1.5, 5.5], [1.5, 3.5, 3.4], [3.5, Infinity, 2.1]];
    for (const [lo, hi, size] of layers) {
      const list = stars.filter((s) => s[3] >= lo && s[3] < hi);
      const pos = new Float32Array(list.length * 3);
      const col = new Float32Array(list.length * 3);
      list.forEach(([x, y, z, mag, bv], i) => {
        pos.set([x * R_STARS, y * R_STARS, z * R_STARS], i * 3);
        const [r, g, b] = kelvinToRgb(temperatureFromBV(bv));
        const k = Math.min(1, 0.25 + 0.75 * Math.pow(10, -0.4 * (mag - 1.5)) ** 0.35);
        col.set([r * k, g * k, b * k], i * 3);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      this.starMaterials.push(mat);
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      this.stars.add(pts);
    }
    // Name the brightest stars.
    for (const s of stars.filter((x) => x[5] && x[3] < 1.6)) {
      const sprite = textSprite(s[5]!, '#9fb4d8', 0.75);
      sprite.center.set(-0.08, 0.5);
      this.starLabels.push({ sprite, v: new THREE.Vector3(s[0], s[1], s[2]) });
      this.scene.add(sprite);
    }
    if (this.snapshot) this.place();
  }

  private addBodies(): void {
    const add = (name: string, color: string, map: THREE.Texture) => {
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, depthWrite: false, blending: name === 'Moon' ? THREE.NormalBlending : THREE.AdditiveBlending }));
      const label = textSprite(name, color, 0.85);
      label.center.set(0.5, -0.9);
      this.scene.add(dot, label);
      this.bodies.set(name, { dot, label });
    };
    add('Sun', '#fff3c4', dotTexture());
    add('Moon', '#ffffff', this.moonTexture);
    for (const p of Object.keys(PLANET_COLORS)) add(p, PLANET_COLORS[p], dotTexture());
  }

  /** Recompute the sky for a moment and observer. */
  setTime(date: Date, observer = this.observer): SkySnapshot {
    this.observer = observer;
    this.snapshot = skyAt(date, observer);
    this.place();
    return this.snapshot;
  }

  private place(): void {
    const snap = this.snapshot!;
    const m = skyMatrix(snap, this.observer);
    const m4 = new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
    this.stars.matrix.copy(m4);
    this.stars.matrixWorldNeedsUpdate = true;
    for (const l of this.starLabels) l.sprite.position.copy(l.v).applyMatrix4(m4).multiplyScalar(R_STARS * 0.99);
    const sun = snap.objects.find((o) => o.name === 'Sun')!;
    const sunDir = new THREE.Vector3(...altAzToScene(sun.alt, sun.az));
    (this.dome.material as THREE.ShaderMaterial).uniforms.sunDir.value.copy(sunDir);
    // Stars fade out in twilight; only the brightest planets and the Moon survive daylight.
    const dark = 1 - THREE.MathUtils.smoothstep(sun.alt, -16, -2);
    this.starMaterials.forEach((mat, i) => (mat.opacity = i === 0 ? Math.max(dark, 0.05) : dark));
    for (const l of this.starLabels) (l.sprite.material as THREE.SpriteMaterial).opacity = dark * 0.85;
    for (const o of snap.objects) {
      const b = this.bodies.get(o.name);
      if (!b) continue;
      const dir = new THREE.Vector3(...altAzToScene(o.alt, o.az));
      b.dot.position.copy(dir).multiplyScalar(R_BODIES);
      b.label.position.copy(b.dot.position);
      const daylightFaint = o.kind === 'planet' && o.name !== 'Venus' && o.name !== 'Jupiter' ? dark : 1;
      (b.dot.material as THREE.SpriteMaterial).opacity = daylightFaint;
      (b.label.material as THREE.SpriteMaterial).opacity = Math.max(daylightFaint, 0.5);
    }
    if (Math.abs(snap.moonIllumination - this.lastPhase) > 0.002) this.drawMoon(snap.moonIllumination);
    this.sizeBodies();
  }

  /** Lit disc with the bright limb toward +x; the sprite is rotated to face the Sun. */
  private drawMoon(k: number): void {
    this.lastPhase = k;
    const ctx = this.moonCanvas.getContext('2d')!;
    const c = 64, r = 60;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#26282c';
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#efeadd';
    ctx.beginPath();
    ctx.arc(c, c, r, -Math.PI / 2, Math.PI / 2); // right half
    const w = Math.abs(1 - 2 * k) * r;
    // Terminator: an ellipse, bulging into the dark half when gibbous.
    ctx.ellipse(c, c, w, r, 0, Math.PI / 2, -Math.PI / 2, k < 0.5);
    ctx.fill();
    this.moonTexture.needsUpdate = true;
  }

  /** Real angular sizes, but never smaller than a few pixels. */
  private sizeBodies(): void {
    if (!this.snapshot) return;
    const pxPerRad = this.height / (2 * Math.tan((this.camera.fov * DEG) / 2));
    for (const o of this.snapshot.objects) {
      const b = this.bodies.get(o.name);
      if (!b) continue;
      const realPx = o.diameter * DEG * pxPerRad;
      const minPx = o.kind === 'moon' ? 18 : o.kind === 'sun' ? 26 : PLANET_PX[o.name] ?? 4;
      const glow = o.kind === 'sun' ? 3 : o.kind === 'planet' ? 2.2 : 1;
      const px = Math.max(realPx, minPx) * glow;
      const world = (px / pxPerRad) * R_BODIES;
      b.dot.scale.set(world, world, 1);
    }
  }

  setViewport(width: number, height: number): void {
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.sizeBodies();
  }

  /** Point the camera at an altitude/azimuth (degrees). */
  lookAt(alt: number, az: number): void {
    this.yaw = -az * DEG;
    this.pitch = alt * DEG;
  }

  update(): void {
    this.pitch = THREE.MathUtils.clamp(this.pitch, -10 * DEG, 89.9 * DEG);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    // Keep the Moon's bright limb pointing at the Sun.
    const snap = this.snapshot;
    const moon = this.bodies.get('Moon')!;
    if (snap) {
      const s = snap.objects.find((o) => o.name === 'Sun')!;
      const sunDir = new THREE.Vector3(...altAzToScene(s.alt, s.az));
      const m = moon.dot.position.clone().normalize();
      const t = sunDir.sub(m.clone().multiplyScalar(m.dot(sunDir)));
      if (t.lengthSq() > 1e-12) {
        this.camera.updateMatrixWorld();
        const a = m.clone().multiplyScalar(R_BODIES).project(this.camera);
        const b = m.clone().add(t.normalize().multiplyScalar(0.01)).multiplyScalar(R_BODIES).project(this.camera);
        (moon.dot.material as THREE.SpriteMaterial).rotation = Math.atan2((b.y - a.y) / this.camera.aspect, b.x - a.x) * 1 + 0;
      }
    }
  }

  /** The named object nearest a screen point (normalised device coordinates), within ~3°. */
  pick(x: number, y: number): string | undefined {
    if (!this.snapshot) return undefined;
    const ray = new THREE.Vector3(x, y, 0.5).unproject(this.camera).normalize();
    let best: string | undefined;
    let bestAngle = Math.max(3, this.camera.fov / 25) * DEG;
    for (const [name, b] of this.bodies) {
      const a = ray.angleTo(b.dot.position.clone().normalize());
      if (a < bestAngle && b.dot.position.y > -0.05) {
        bestAngle = a;
        best = name;
      }
    }
    return best;
  }

  private attachInput(): void {
    let drag: { x: number; y: number } | undefined;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.enabled) drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => (drag = undefined));
    window.addEventListener('pointermove', (e) => {
      if (!drag || !this.enabled) return;
      const k = (this.camera.fov * DEG) / this.height;
      this.yaw += (e.clientX - drag.x) * k;
      this.pitch += (e.clientY - drag.y) * k;
      drag = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.camera.fov = THREE.MathUtils.clamp(this.camera.fov * Math.exp(e.deltaY * 0.001), 2, 100);
        this.camera.updateProjectionMatrix();
        this.sizeBodies();
      },
      { passive: false },
    );
  }
}
