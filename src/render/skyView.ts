import * as THREE from 'three';
import { kelvinToRgb } from '../sim/color';
import { dateToJdTT, discOverlap, span, topocentric, type Eclipse } from '../sim/eclipse';
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
  private nebulaPoints?: THREE.Points;
  private readonly nebulaLabels: { sprite: THREE.Sprite; v: THREE.Vector3 }[] = [];
  private readonly bodies = new Map<string, { dot: THREE.Sprite; label: THREE.Sprite }>();
  private readonly moonCanvas = document.createElement('canvas');
  private readonly moonTexture: THREE.CanvasTexture;
  private readonly dome: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private lastPhase = -1;
  private lastDark = -1;
  private height = 760;
  private eclipse?: Eclipse;
  /** While an eclipse is on: how much of the Sun is covered (0–1). */
  obscuration = 0;
  private readonly sunGlow: THREE.Sprite;
  private readonly corona: THREE.Sprite;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.camera.rotation.order = 'YXZ';
    // Sky dome coloured by the Sun's altitude, with a glow around the Sun.
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(R_SKY, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { sunDir: { value: new THREE.Vector3(0, -1, 0) }, light: { value: 1 } },
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          uniform vec3 sunDir; uniform float light; varying vec3 vDir;
          void main() {
            float s = sunDir.y;                       // sine of the Sun's altitude
            float day = smoothstep(-0.105, 0.1, s) * light; // civil→nautical twilight to day; dimmed in an eclipse
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
      const s = this.label(name, name.length === 1 ? '#ffd27a' : '#b9a77d', name.length === 1 ? 1.3 : 0.9);
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
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: 0xfff1c8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: coronaTexture(), color: 0xe8f0ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    this.sunGlow.renderOrder = 1;
    this.corona.renderOrder = 2;
    this.bodies.get('Sun')!.dot.renderOrder = 3;
    this.bodies.get('Moon')!.dot.renderOrder = 4;
    this.scene.add(this.sunGlow, this.corona);
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
      const sprite = this.label(s[5]!, '#9fb4d8', 0.75);
      sprite.center.set(-0.08, 0.5);
      this.starLabels.push({ sprite, v: new THREE.Vector3(s[0], s[1], s[2]) });
      this.scene.add(sprite);
    }
    if (this.snapshot) this.place();
  }

  /**
   * Catalogued nebulae as outlines at their true angular size (never smaller than a few pixels),
   * rotating with the stars; the named ones get labels.
   */
  setNebulae(items: { v: [number, number, number]; radiusDeg: number; color: [number, number, number]; label?: string }[]): void {
    const pos = new Float32Array(items.length * 3);
    const col = new Float32Array(items.length * 3);
    const rad = new Float32Array(items.length);
    items.forEach((it, i) => {
      pos.set(it.v.map((c) => c * R_STARS * 0.995), i * 3);
      col.set(it.color, i * 3);
      rad[i] = it.radiusDeg * DEG;
      if (it.label) {
        const sprite = this.label(it.label, '#ffb3c8', 0.7);
        sprite.center.set(0.5, 1.4);
        this.nebulaLabels.push({ sprite, v: new THREE.Vector3(...it.v) });
        this.scene.add(sprite);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aRadius', new THREE.BufferAttribute(rad, 1));
    this.nebulaPoints = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uPxPerRad: { value: 600 }, uOpacity: { value: 1 } },
        vertexShader: `
          attribute float aRadius; uniform float uPxPerRad; varying vec3 vColor; varying float vPx;
          void main() {
            vColor = color;
            vPx = clamp(2.0 * aRadius * uPxPerRad, 6.0, 400.0);
            gl_PointSize = vPx + 2.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform float uOpacity; varying vec3 vColor; varying float vPx;
          void main() {
            float r = length(gl_PointCoord - 0.5) * (vPx + 2.0);
            float edge = 1.0 - smoothstep(0.0, 1.5, abs(r - vPx * 0.5 + 0.75));
            // Small objects get a faint fill; big ones (several degrees across) only their outline.
            float fill = 0.12 * (1.0 - smoothstep(30.0, 90.0, vPx)) * (1.0 - smoothstep(vPx * 0.5 - 1.0, vPx * 0.5, r));
            float a = max(edge * 0.8, fill) * uOpacity;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vColor, a);
          }`,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.nebulaPoints.frustumCulled = false;
    this.stars.add(this.nebulaPoints);
    if (this.snapshot) this.place();
  }

  setNebulaeVisible(on: boolean): void {
    if (this.nebulaPoints) this.nebulaPoints.visible = on;
    for (const l of this.nebulaLabels) l.sprite.visible = on;
  }

  private addBodies(): void {
    const add = (name: string, color: string, map: THREE.Texture) => {
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, depthWrite: false, blending: name === 'Moon' ? THREE.NormalBlending : THREE.AdditiveBlending }));
      const label = this.label(name, color, 0.85);
      label.center.set(0.5, -0.9);
      this.scene.add(dot, label);
      this.bodies.set(name, { dot, label });
    };
    add('Sun', '#fff3c4', sunDiscTexture());
    add('Moon', '#ffffff', this.moonTexture);
    for (const p of Object.keys(PLANET_COLORS)) add(p, PLANET_COLORS[p], dotTexture());
  }

  /** Use an eclipse's precise Sun and Moon positions (JPL Horizons) while its time span is on. */
  setEclipse(e: Eclipse | undefined): void {
    this.eclipse = e;
  }

  /** Recompute the sky for a moment and observer. */
  setTime(date: Date, observer = this.observer): SkySnapshot {
    this.observer = observer;
    const snap = skyAt(date, observer);
    this.obscuration = 0;
    const e = this.eclipse;
    if (e) {
      const jd = dateToJdTT(e, date);
      const [t0, t1] = span(e);
      if (jd >= t0 && jd <= t1) {
        const t = topocentric(e, jd, observer.lat, observer.lon);
        for (const [name, v] of [['Sun', t.sun], ['Moon', t.moon]] as const) {
          const o = snap.objects.find((x) => x.name === name)!;
          Object.assign(o, { alt: v.alt, az: v.az, km: v.km, diameter: 2 * v.radius });
        }
        const sep = Math.hypot(t.sun.alt - t.moon.alt, ((((t.sun.az - t.moon.az + 540) % 360) - 180) * Math.cos(t.sun.alt * DEG)));
        this.obscuration = discOverlap(t.sun.radius, t.moon.radius, sep);
      }
    }
    this.snapshot = snap;
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
    for (const l of this.nebulaLabels) l.sprite.position.copy(l.v).applyMatrix4(m4).multiplyScalar(R_STARS * 0.99);
    const sun = snap.objects.find((o) => o.name === 'Sun')!;
    const sunDir = new THREE.Vector3(...altAzToScene(sun.alt, sun.az));
    // An eclipse dims the daylight (it stays bright until the Sun is nearly covered).
    const light = Math.pow(Math.max(0, 1 - this.obscuration), 0.6);
    const dome = (this.dome.material as THREE.ShaderMaterial).uniforms;
    dome.sunDir.value.copy(sunDir);
    dome.light.value = light;
    // Stars fade out in twilight; only the brightest planets and the Moon survive daylight.
    const dark = Math.max(1 - THREE.MathUtils.smoothstep(sun.alt, -16, -2), (1 - light) * 0.9);
    this.starMaterials.forEach((mat, i) => (mat.opacity = i === 0 ? Math.max(dark, 0.05) : dark));
    for (const l of this.starLabels) (l.sprite.material as THREE.SpriteMaterial).opacity = dark * 0.85;
    // Nebulae are faint: they show only in a dark sky.
    for (const l of this.nebulaLabels) (l.sprite.material as THREE.SpriteMaterial).opacity = dark * 0.8;
    if (this.nebulaPoints) (this.nebulaPoints.material as THREE.ShaderMaterial).uniforms.uOpacity.value = dark;
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
    // The Moon's night side shows against a dark sky (earthshine) or as a black disc on the Sun.
    const moonDark = this.obscuration > 0 ? 1 : dark * 0.8;
    if (Math.abs(snap.moonIllumination - this.lastPhase) > 0.002 || Math.abs(moonDark - this.lastDark) > 0.02) this.drawMoon(snap.moonIllumination, moonDark);
    const sunBody = this.bodies.get('Sun')!;
    this.sunGlow.position.copy(sunBody.dot.position);
    this.corona.position.copy(sunBody.dot.position);
    (this.sunGlow.material as THREE.SpriteMaterial).opacity = light * (sun.alt > -1 ? 1 : 0);
    // The corona appears only in the last moments before totality and during it.
    (this.corona.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.smoothstep(this.obscuration, 0.995, 1);
    this.sizeBodies();
  }

  /** Lit disc with the bright limb toward +x; the sprite is rotated to face the Sun. */
  private drawMoon(k: number, darkAlpha: number): void {
    this.lastPhase = k;
    this.lastDark = darkAlpha;
    const ctx = this.moonCanvas.getContext('2d')!;
    const c = 64, r = 63;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = this.obscuration > 0 ? '#050506' : `rgba(38, 40, 44, ${darkAlpha})`;
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

  /** Every text label, with its scale at the default field of view. */
  private readonly labels: { sprite: THREE.Sprite; base: THREE.Vector3 }[] = [];

  private label(text: string, color: string, scale: number): THREE.Sprite {
    const sprite = textSprite(text, color, scale);
    this.labels.push({ sprite, base: sprite.scale.clone() });
    return sprite;
  }

  /** Real angular sizes, but never smaller than a few pixels. */
  private sizeBodies(): void {
    // Labels keep the same size on screen whatever the zoom.
    const k = Math.tan((this.camera.fov * DEG) / 2) / Math.tan((70 * DEG) / 2);
    for (const l of this.labels) l.sprite.scale.copy(l.base).multiplyScalar(k);
    if (!this.snapshot) return;
    const pxPerRad = this.height / (2 * Math.tan((this.camera.fov * DEG) / 2));
    if (this.nebulaPoints) (this.nebulaPoints.material as THREE.ShaderMaterial).uniforms.uPxPerRad.value = pxPerRad * this.pixelRatio;
    for (const o of this.snapshot.objects) {
      const b = this.bodies.get(o.name);
      if (!b) continue;
      const realPx = o.diameter * DEG * pxPerRad;
      // During an eclipse the Sun and Moon are drawn at their true sizes, so the overlap is right.
      const minPx = this.eclipse && o.kind !== 'planet' ? 0 : o.kind === 'moon' ? 18 : o.kind === 'sun' ? 14 : PLANET_PX[o.name] ?? 4;
      const glow = o.kind === 'planet' ? 2.2 : 1;
      const px = Math.max(realPx, minPx) * glow;
      const world = (px / pxPerRad) * R_BODIES;
      b.dot.scale.set(world, world, 1);
      if (o.kind === 'sun') {
        this.sunGlow.scale.set(Math.max(world * 6, (60 / pxPerRad) * R_BODIES), Math.max(world * 6, (60 / pxPerRad) * R_BODIES), 1);
        this.corona.scale.set(world * 4.5, world * 4.5, 1);
      }
    }
  }

  /** Device pixels per CSS pixel, for point sizes in shaders. */
  pixelRatio = 1;

  setViewport(width: number, height: number, pixelRatio = 1): void {
    this.height = height;
    this.pixelRatio = pixelRatio;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.sizeBodies();
  }

  setFov(fov: number): void {
    this.camera.fov = THREE.MathUtils.clamp(fov, 2, 100);
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
    // One pointer drags the view; two (a pinch on touch screens) zoom.
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) pinch = spread();
    });
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = 0;
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p || !this.enabled) return;
      if (pointers.size === 1) {
        const k = (this.camera.fov * DEG) / this.height;
        this.yaw += (e.clientX - p.x) * k;
        this.pitch += (e.clientY - p.y) * k;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 2 && pinch > 0) {
        const now = spread();
        if (now > 0) this.setFov(this.camera.fov * (pinch / now));
        pinch = now;
      }
    });
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.setFov(this.camera.fov * Math.exp(e.deltaY * 0.001));
      },
      { passive: false },
    );
  }
}

let sunDisc: THREE.Texture | undefined;
/** The Sun's disc with limb darkening, filling the sprite. */
function sunDiscTexture(): THREE.Texture {
  if (sunDisc) return sunDisc;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 63);
  g.addColorStop(0, 'rgba(255,253,244,1)');
  g.addColorStop(0.7, 'rgba(255,244,214,1)');
  g.addColorStop(0.97, 'rgba(250,206,140,1)');
  g.addColorStop(1, 'rgba(250,200,130,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(64, 64, 63.5, 0, Math.PI * 2);
  ctx.fill();
  sunDisc = new THREE.CanvasTexture(c);
  sunDisc.colorSpace = THREE.SRGBColorSpace;
  return sunDisc;
}

let coronaTex: THREE.Texture | undefined;
/** A soft, streaky glow for the corona, seen only during totality. */
function coronaTexture(): THREE.Texture {
  if (coronaTex) return coronaTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 26, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.15, 'rgba(235,240,255,0.55)');
  g.addColorStop(0.45, 'rgba(200,215,255,0.12)');
  g.addColorStop(1, 'rgba(200,215,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  // Streamers (decorative: the real corona's shape changes with the solar cycle).
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + Math.sin(i * 7.3) * 0.2;
    const len = 60 + 50 * Math.abs(Math.sin(i * 2.1));
    const grad = ctx.createLinearGradient(128, 128, 128 + Math.cos(a) * len * 1.6, 128 + Math.sin(a) * len * 1.6);
    grad.addColorStop(0.2, 'rgba(220,230,255,0.10)');
    grad.addColorStop(1, 'rgba(220,230,255,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(128, 128);
    ctx.lineTo(128 + Math.cos(a) * len * 1.6, 128 + Math.sin(a) * len * 1.6);
    ctx.stroke();
  }
  coronaTex = new THREE.CanvasTexture(c);
  coronaTex.colorSpace = THREE.SRGBColorSpace;
  return coronaTex;
}
