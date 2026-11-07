import * as THREE from 'three';
import { aimSun, atmosphereFor, insideAware, scatteringMaterial, shellScale } from './atmosphere';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Body, BodyKind } from '../sim/body';
import type { Climate } from '../sim/climate';
import { EARTH_MASS } from '../sim/units';
import { makePlanetTextures, seedFromName } from './planetTextures';
import { mulberry32 } from '../procgen/rng';
import { accretionTexture, glowTexture } from './textures';
import { getSolarData, poleScene, REAL_COLORS } from '../sim/solarSystemData';

const SPHERE = new THREE.SphereGeometry(1, 64, 32);
const SPHERE_LOW = new THREE.SphereGeometry(1, 24, 12);
const DISK = new THREE.RingGeometry(1.6, 5, 96, 1);
const RINGS = new THREE.RingGeometry(1.35, 2.5, 128, 1);
const PROBE = new THREE.OctahedronGeometry(1, 0);
const BEAM = new THREE.ConeGeometry(0.05, 1, 24, 1, true).translate(0, 0.5, 0);

/** Minimum on-screen radius (px) so tiny bodies stay visible when zoomed out. */
const MIN_PIXEL_RADIUS = 2.2;
/** On-screen radius (px) above which a planet gets full procedural textures. */
export const DETAIL_PIXEL_RADIUS = 7;

const ATMOSPHERE_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;
const ATMOSPHERE_FRAGMENT = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    #include <logdepthbuf_fragment>
    float rim = 1.0 - max(dot(vNormal, vView), 0.0);
    gl_FragColor = vec4(uColor, pow(rim, 2.5) * uIntensity);
  }
`;

export function atmosphereMaterial(color: number, intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: ATMOSPHERE_FRAGMENT,
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Real NASA surface maps (public/textures, built by scripts/build-planet-textures.mjs). */
const REAL_MAPS: Record<string, { map: string; clouds?: string; grey?: boolean }> = {
  Mercury: { map: 'mercury.jpg' },
  Earth: { map: 'earth.jpg', clouds: 'earth-clouds.jpg' },
  Moon: { map: 'moon.jpg' },
  Mars: { map: 'mars.jpg' },
  Phobos: { map: 'phobos.jpg', grey: true },
  Jupiter: { map: 'jupiter.jpg' },
  Europa: { map: 'europa.jpg', grey: true },
  Ganymede: { map: 'ganymede.jpg', grey: true },
  Rhea: { map: 'rhea.jpg', grey: true },
  Iapetus: { map: 'iapetus.jpg', grey: true },
  Vesta: { map: 'vesta.jpg', grey: true },
};

/** A body's real colour scaled so its brightest channel is 1: tints greyscale maps without darkening them. */
function lightTint(hex: number | undefined): THREE.Color {
  const c = new THREE.Color(hex ?? 0xffffff);
  const m = Math.max(c.r, c.g, c.b) || 1;
  return new THREE.Color(c.r / m, c.g / m, c.b / m);
}
const realTextureCache = new Map<string, THREE.Texture>();

/** Load (once) and share a real map. Shared textures are never disposed with a body. */
function realTexture(file: string): THREE.Texture {
  let tex = realTextureCache.get(file);
  if (!tex) {
    tex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/${file}`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    realTextureCache.set(file, tex);
  }
  return tex;
}

/** Everything drawn for one simulated body: sphere, glow, clouds, rings, trail and label. */
/** Points in each comet tail. */
const COMET_TAIL_POINTS = 260;

export class BodyVisual {
  readonly id: number;
  kind: BodyKind;
  color: number;
  climate: Climate = 'temperate';
  readonly group = new THREE.Group();
  readonly trail: THREE.Line;
  readonly label: CSS2DObject;
  /** Key of the detailed textures currently applied ('' if none). */
  detailKey = '';
  private mesh!: THREE.Mesh;
  private spin = new THREE.Group();
  /** −1 for bodies that rotate clockwise about their north pole (Venus, Uranus). */
  private spinSign = 1;
  private glow?: THREE.Sprite;
  private disk?: THREE.Mesh;
  private clouds?: THREE.Mesh;
  private atmosphere?: THREE.Mesh;
  private rings?: THREE.Mesh;
  private beams?: THREE.Group;
  private readonly trailPos: Float32Array;
  private trailFilled = false;
  private trailRef: number | undefined;
  private lastTrail = new THREE.Vector3();
  private trailFrames = 0;
  private textures: THREE.Texture[] = [];
  private readonly name: string;
  private readonly trailLength: number;

  constructor(body: Body, trailLength = 500) {
    this.id = body.id;
    this.kind = body.kind;
    this.color = body.color;
    this.name = body.name;
    this.trailLength = trailLength;
    this.group.add(this.spin);
    const real = getSolarData()?.byName.get(body.name);
    const pole = real && poleScene(real);
    if (pole) {
      // Real Solar System body: point the spin axis (and Saturn's rings) at its true pole.
      this.spin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...pole));
      this.spinSign = real.retrograde ? -1 : 1;
    } else {
      // Tilt the spin axis a little, deterministically per body.
      const seed = seedFromName(body.name);
      this.spin.rotation.z = ((seed % 1000) / 1000 - 0.5) * 0.6;
    }
    this.build(body);

    this.trailPos = new Float32Array(trailLength * 3);
    const colors = new Float32Array(trailLength * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.trail = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.trail.frustumCulled = false;
    this.paintTrail();

    const el = document.createElement('div');
    el.className = 'body-label';
    el.textContent = body.name;
    el.dataset.bodyId = String(body.id);
    this.label = new CSS2DObject(el);
    this.label.center.set(-0.15, 1.2);
    this.group.add(this.label);
    if (body.tag === 'comet') this.makeTails(real?.radiusKm ?? 5);
  }

  private isProbe = false;
  private tails?: THREE.Points;
  private tailJitter?: Float32Array;
  private tailScale = 1;

  /** Ion (blue, straight) and dust (yellow-white, curved) tails, as one point cloud. */
  private makeTails(nucleusKm: number): void {
    const n = COMET_TAIL_POINTS * 2;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const rand = mulberry32(seedFromName(this.name));
    this.tailJitter = new Float32Array(n * 3).map(() => (rand() * 2 - 1) * (0.5 + rand()));
    for (let i = 0; i < n; i++) {
      const ion = i < COMET_TAIL_POINTS;
      const s = (i % COMET_TAIL_POINTS) / COMET_TAIL_POINTS;
      const fade = Math.pow(1 - s, 1.6) * (0.6 + 0.4 * rand());
      const c = ion ? [0.45, 0.7, 1.0] : [1.0, 0.92, 0.75];
      col.set(c.map((v) => v * fade * (ion ? 0.8 : 0.65)), i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.tails = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.tails.frustumCulled = false;
    this.tails.visible = false;
    // Bigger nuclei have bigger comae and tails (Hale–Bopp's 30 km nucleus vs Halley's 5.5 km).
    this.tailScale = Math.sqrt(nucleusKm / 5.5);
    this.group.add(this.tails);
  }

  /**
   * Point the tails away from the Sun. Length grows as the comet nears the Sun (illustrative:
   * ~0.2 AU at 1 AU for a Halley-sized nucleus, ∝ 1/r², inactive beyond ~4 AU; Halley's 1986
   * ion tail reached about 0.2 AU).
   */
  private updateTails(body: Body, sun: Body): void {
    const t = this.tails!;
    const dx = body.x - sun.x, dy = body.y - sun.y, dz = body.z - sun.z;
    const r = Math.hypot(dx, dy, dz);
    const activity = r > 0 ? THREE.MathUtils.clamp(1 - (r - 3) / 1.5, 0, 1) : 0;
    t.visible = activity > 0;
    if (!t.visible) return;
    const L = Math.min(0.6, (0.2 * this.tailScale) / (r * r)) * activity;
    const ux = dx / r, uy = dy / r, uz = dz / r;
    // Dust lags behind along the orbit: bend it against the comet's motion relative to the Sun.
    let vx = body.vx - sun.vx, vy = body.vy - sun.vy, vz = body.vz - sun.vz;
    const vu = vx * ux + vy * uy + vz * uz;
    vx -= vu * ux; vy -= vu * uy; vz -= vu * uz;
    const vl = Math.hypot(vx, vy, vz) || 1;
    vx /= vl; vy /= vl; vz /= vl;
    const pos = t.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = pos.array as Float32Array;
    const j = this.tailJitter!;
    for (let i = 0; i < COMET_TAIL_POINTS * 2; i++) {
      const ion = i < COMET_TAIL_POINTS;
      const s = (i % COMET_TAIL_POINTS) / COMET_TAIL_POINTS;
      const len = (ion ? 1 : 0.7) * L * s;
      const bend = ion ? 0 : 0.45 * L * s * s;
      const spread = L * (ion ? 0.012 + 0.03 * s : 0.02 + 0.08 * s);
      p[i * 3] = ux * len - vx * bend + j[i * 3] * spread;
      p[i * 3 + 1] = uy * len - vy * bend + j[i * 3 + 1] * spread;
      p[i * 3 + 2] = uz * len - vz * bend + j[i * 3 + 2] * spread;
    }
    pos.needsUpdate = true;
  }

  get isPlanet(): boolean {
    return (this.kind === 'rocky' || this.kind === 'gas') && !this.isProbe;
  }

  private build(body: Body): void {
    this.disposeParts();
    let material: THREE.Material;
    switch (body.kind) {
      case 'star':
        material = new THREE.MeshBasicMaterial({ color: new THREE.Color(body.color).multiplyScalar(1.15) });
        this.glow = this.makeGlow(body.color, 1);
        break;
      case 'giant':
        // Swollen, dimmer surface with a broad orange halo.
        material = new THREE.MeshBasicMaterial({ color: new THREE.Color(body.color).multiplyScalar(0.95) });
        this.glow = this.makeGlow(0xff8040, 0.7);
        break;
      case 'whitedwarf':
        material = new THREE.MeshBasicMaterial({ color: 0xf4f8ff });
        this.glow = this.makeGlow(0xcfe0ff, 0.8);
        break;
      case 'neutron': {
        material = new THREE.MeshBasicMaterial({ color: 0xe8f4ff });
        this.glow = this.makeGlow(0x9fd0ff, 0.9);
        // Pulsar beams sweeping around the spin axis.
        this.beams = new THREE.Group();
        const beamMat = new THREE.MeshBasicMaterial({
          color: 0x9fd8ff,
          transparent: true,
          opacity: 0.22,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const up = new THREE.Mesh(BEAM, beamMat);
        const down = new THREE.Mesh(BEAM, beamMat);
        down.rotation.x = Math.PI;
        this.beams.add(up, down);
        this.beams.rotation.z = 0.5;
        break;
      }
      case 'blackhole':
        material = new THREE.MeshBasicMaterial({ color: 0x000000 });
        this.disk = new THREE.Mesh(
          DISK,
          new THREE.MeshBasicMaterial({ map: accretionTexture(), side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
        );
        this.disk.rotation.x = -Math.PI / 2 + 0.25;
        this.glow = this.makeGlow(0xff9a4a, 0.5);
        break;
      case 'gas':
      case 'rocky':
        material = new THREE.MeshStandardMaterial({ color: body.color, roughness: body.kind === 'gas' ? 0.85 : 0.95, metalness: 0 });
        break;
    }
    if (body.tag === 'probe') {
      // Spacecraft: a small bright diamond with a cyan glint.
      (material as THREE.Material).dispose();
      material = new THREE.MeshBasicMaterial({ color: 0x7fdcff });
      this.glow = this.makeGlow(0x7fdcff, 0.8);
      this.isProbe = true;
    }
    this.mesh = new THREE.Mesh(this.isProbe ? PROBE : this.isPlanet ? SPHERE : SPHERE_LOW, material);
    this.spin.add(this.mesh);
    if (this.disk) this.group.add(this.disk);
    if (this.glow) this.group.add(this.glow);
    if (this.beams) this.group.add(this.beams);
    this.detailKey = '';
    this.applyClimateTint();
  }

  private makeGlow(color: number, opacity: number): THREE.Sprite {
    return new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
  }

  /** Re-create the visual if the body changed kind or colour (e.g. after a merge). */
  refresh(body: Body): void {
    if (body.kind !== this.kind || body.color !== this.color) {
      this.kind = body.kind;
      this.color = body.color;
      this.build(body);
      this.paintTrail();
    }
    const el = this.label.element;
    if (el.textContent !== body.name) el.textContent = body.name;
  }

  setClimate(climate: Climate): void {
    if (climate === this.climate) return;
    this.climate = climate;
    if (!this.detailKey) this.applyClimateTint();
  }

  /** Key describing the look detailed textures should have right now. */
  wantedDetailKey(body: Body): string {
    return `${body.kind}:${body.color}:${this.climate}`;
  }

  /** Build and apply procedural textures. Expensive (tens of ms); callers rate-limit it. */
  applyDetail(body: Body, textureWidth: number): void {
    if (!this.isPlanet) return;
    const key = this.wantedDetailKey(body);
    const look = { kind: body.kind, color: body.color, seed: seedFromName(this.name), climate: this.climate, earthMasses: body.mass / EARTH_MASS, rings: this.name === 'Saturn' };
    const tex = makePlanetTextures(look, textureWidth);
    this.disposeDetail();
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    mat.map = tex.map;
    mat.color.set(0xffffff);
    if (tex.emissive) {
      mat.emissiveMap = tex.emissive;
      mat.emissive.set(0xffffff);
      mat.emissiveIntensity = 1.4;
    } else {
      mat.emissiveMap = null;
      mat.emissive.set(0x000000);
    }
    mat.needsUpdate = true;
    this.textures.push(tex.map);
    if (tex.emissive) this.textures.push(tex.emissive);
    if (tex.clouds) {
      this.textures.push(tex.clouds);
      this.clouds = new THREE.Mesh(SPHERE, new THREE.MeshStandardMaterial({ map: tex.clouds, transparent: true, depthWrite: false, roughness: 1 }));
      this.clouds.scale.setScalar(1.015);
      this.mesh.add(this.clouds);
    }
    // Real scattering for worlds with air (atmosphere.ts); the named ones get their own.
    const air = atmosphereFor(this.name, tex.atmosphere, body.kind);
    if (air) {
      this.atmosphere = new THREE.Mesh(SPHERE, scatteringMaterial(air));
      this.atmosphere.scale.setScalar(shellScale(air));
      this.atmosphere.renderOrder = 1;
      insideAware(this.atmosphere);
      this.mesh.add(this.atmosphere);
    }
    if (tex.rings) {
      this.textures.push(tex.rings);
      this.rings = new THREE.Mesh(
        RINGS,
        new THREE.MeshStandardMaterial({ map: tex.rings, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 1 }),
      );
      this.rings.rotation.x = -Math.PI / 2;
      this.mesh.add(this.rings);
    }
    this.applyRealMaps(mat);
    this.detailKey = key;
  }

  /**
   * Swap in a real NASA map for bodies that have one, unless the body has been heated until
   * molten (then the procedural lava look shows what happened to it).
   */
  private applyRealMaps(mat: THREE.MeshStandardMaterial): void {
    const real = REAL_MAPS[this.name];
    if (!real || this.climate === 'molten') return;
    mat.map = realTexture(real.map);
    // Greyscale mosaics take a light tint of the body's real colour; colour maps stay as they are.
    mat.color.copy(real.grey ? lightTint(REAL_COLORS[this.name]) : new THREE.Color(0xffffff));
    mat.emissiveMap = null;
    mat.emissive.set(0x000000);
    mat.needsUpdate = true;
    if (real.clouds) {
      const clouds = realTexture(real.clouds);
      const cloudMat = new THREE.MeshStandardMaterial({ map: clouds, alphaMap: clouds, transparent: true, depthWrite: false, roughness: 1 });
      if (this.clouds) {
        (this.clouds.material as THREE.Material).dispose();
        this.clouds.material = cloudMat;
      } else {
        this.clouds = new THREE.Mesh(SPHERE, cloudMat);
        this.clouds.scale.setScalar(1.015);
        this.mesh.add(this.clouds);
      }
    }
  }

  private applyClimateTint(): void {
    if (!this.isPlanet || this.detailKey) return;
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    const c = new THREE.Color(this.color);
    if (this.climate === 'frozen') c.lerp(new THREE.Color(0xdde8ff), 0.55);
    mat.color.copy(c);
    mat.emissive.set(this.climate === 'molten' ? 0x7a2a08 : 0x000000);
  }

  /** Update transform. `worldPerPixel` is the world size of one screen pixel at the body's depth. */
  update(body: Body, worldPerPixel: number, dt: number, lockTo?: Body, sun?: Body): void {
    this.group.position.set(body.x, body.y, body.z);
    if (this.tails) {
      if (sun) this.updateTails(body, sun);
      else this.tails.visible = false;
    }
    // A whole galaxy (galaxy-scale scenes) is drawn as a small bright nucleus: its stars are the particles.
    const isGalaxy = body.tag === 'galaxy';
    const r = this.isProbe ? worldPerPixel * 4 : isGalaxy ? Math.max(body.radius * 0.05, worldPerPixel * 2) : Math.max(body.radius, worldPerPixel * MIN_PIXEL_RADIUS);
    this.mesh.scale.setScalar(r);
    if (lockTo) {
      // Tidally locked: always show the same face to the parent.
      this.mesh.rotation.y = Math.atan2(lockTo.x - body.x, lockTo.z - body.z) - Math.PI / 2;
    } else {
      this.mesh.rotation.y += dt * 0.3 * this.spinSign;
    }
    if (this.clouds) this.clouds.rotation.y += dt * 0.05;
    if (this.atmosphere && sun) aimSun(this.atmosphere.material as THREE.ShaderMaterial, this.mesh, new THREE.Vector3(sun.x, sun.y, sun.z));
    if (this.glow) {
      const big = this.isProbe
        ? worldPerPixel * 14
        : this.kind === 'star'
          ? Math.max(body.radius * 9, worldPerPixel * 28)
          : this.kind === 'giant'
            ? Math.max(body.radius * 4, worldPerPixel * 40)
            : this.kind === 'neutron' || this.kind === 'whitedwarf'
              ? Math.max(body.radius * 12, worldPerPixel * 22)
              : body.radius * 14;
      this.glow.scale.setScalar(isGalaxy ? body.radius * 1.6 : big);
    }
    if (this.disk) {
      this.disk.scale.setScalar(r);
      this.disk.rotation.z += dt * 0.8;
    }
    if (this.beams) {
      this.beams.scale.setScalar(Math.max(body.radius * 40, worldPerPixel * 90));
      this.beams.rotation.y += dt * 6;
    }
  }

  /** On-screen radius in pixels for a given world-per-pixel. */
  pixelRadius(body: Body, worldPerPixel: number): number {
    return body.radius / worldPerPixel;
  }

  /**
   * Append the body's position to its trail if it has moved far enough. With `ref`, the trail
   * is stored relative to that body and drawn around its current position.
   */
  pushTrail(body: Body, spacing: number, ref?: Body): void {
    const refId = ref?.id;
    if (refId !== this.trailRef) {
      this.trailRef = refId;
      this.trailFilled = false;
    }
    const ox = ref?.x ?? 0, oy = ref?.y ?? 0, oz = ref?.z ?? 0;
    const x = body.x - ox, y = body.y - oy, z = body.z - oz;
    const p = this.trailPos;
    const n = this.trailLength;
    if (!this.trailFilled) {
      for (let i = 0; i < n; i++) {
        p[i * 3] = x;
        p[i * 3 + 1] = y;
        p[i * 3 + 2] = z;
      }
      this.trailFilled = true;
      this.lastTrail.set(x, y, z);
    }
    this.trailFrames++;
    const d2 = (x - this.lastTrail.x) ** 2 + (y - this.lastTrail.y) ** 2 + (z - this.lastTrail.z) ** 2;
    const last = (n - 1) * 3;
    if (!(d2 < spacing * spacing && this.trailFrames < 120)) {
      p.copyWithin(0, 3);
      this.lastTrail.set(x, y, z);
      this.trailFrames = 0;
    }
    p[last] = x;
    p[last + 1] = y;
    p[last + 2] = z;
    this.trail.position.set(ox, oy, oz);
    (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Keep a relative trail attached to its reference body even while paused. */
  placeTrail(ref?: Body): void {
    if (ref && ref.id === this.trailRef) this.trail.position.set(ref.x, ref.y, ref.z);
  }

  clearTrail(): void {
    this.trailFilled = false;
  }

  private paintTrail(): void {
    const c = new THREE.Color(this.kind === 'blackhole' ? 0xb07cff : this.kind === 'neutron' ? 0x9fd8ff : this.color);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.max(0.45, hsl.l));
    const attr = this.trail.geometry.attributes.color as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const n = this.trailLength;
    for (let i = 0; i < n; i++) {
      const t = Math.pow(i / (n - 1), 1.6) * 0.75;
      arr[i * 3] = c.r * t;
      arr[i * 3 + 1] = c.g * t;
      arr[i * 3 + 2] = c.b * t;
    }
    attr.needsUpdate = true;
  }

  private disposeDetail(): void {
    for (const t of this.textures) t.dispose();
    this.textures = [];
    for (const m of [this.clouds, this.atmosphere, this.rings]) {
      if (!m) continue;
      m.parent?.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.clouds = this.atmosphere = this.rings = undefined;
  }

  private disposeParts(): void {
    this.disposeDetail();
    if (this.mesh) {
      this.spin.remove(this.mesh);
      (this.mesh.material as THREE.Material).dispose();
    }
    for (const part of [this.glow, this.disk, this.beams]) if (part) this.group.remove(part);
    this.glow?.material.dispose();
    if (this.disk) (this.disk.material as THREE.Material).dispose();
    this.beams?.children.forEach((c) => ((c as THREE.Mesh).material as THREE.Material).dispose());
    this.glow = undefined;
    this.disk = undefined;
    this.beams = undefined;
  }

  dispose(): void {
    this.disposeParts();
    if (this.tails) {
      this.group.remove(this.tails);
      this.tails.geometry.dispose();
      (this.tails.material as THREE.Material).dispose();
    }
    this.label.element.remove();
    this.group.remove(this.label);
    this.trail.geometry.dispose();
    (this.trail.material as THREE.Material).dispose();
  }
}
