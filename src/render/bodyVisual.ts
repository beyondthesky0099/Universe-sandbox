import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Body, BodyKind } from '../sim/body';
import type { Climate } from '../sim/climate';
import { EARTH_MASS } from '../sim/units';
import { makePlanetTextures, seedFromName } from './planetTextures';
import { accretionTexture, glowTexture } from './textures';

const SPHERE = new THREE.SphereGeometry(1, 64, 32);
const SPHERE_LOW = new THREE.SphereGeometry(1, 24, 12);
const DISK = new THREE.RingGeometry(1.6, 5, 96, 1);
const RINGS = new THREE.RingGeometry(1.35, 2.5, 128, 1);
const BEAM = new THREE.ConeGeometry(0.12, 1, 24, 1, true).translate(0, 0.5, 0);

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

function atmosphereMaterial(color: number, intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: ATMOSPHERE_FRAGMENT,
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Everything drawn for one simulated body: sphere, glow, clouds, rings, trail and label. */
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
    // Tilt the spin axis a little, deterministically per body.
    const seed = seedFromName(body.name);
    this.spin.rotation.z = ((seed % 1000) / 1000 - 0.5) * 0.6;
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
    this.label = new CSS2DObject(el);
    this.label.center.set(-0.15, 1.2);
    this.group.add(this.label);
  }

  get isPlanet(): boolean {
    return this.kind === 'rocky' || this.kind === 'gas';
  }

  private build(body: Body): void {
    this.disposeParts();
    let material: THREE.Material;
    switch (body.kind) {
      case 'star':
        material = new THREE.MeshBasicMaterial({ color: new THREE.Color(body.color).multiplyScalar(1.15) });
        this.glow = this.makeGlow(body.color, 1);
        break;
      case 'neutron': {
        material = new THREE.MeshBasicMaterial({ color: 0xe8f4ff });
        this.glow = this.makeGlow(0x9fd0ff, 0.9);
        // Pulsar beams sweeping around the spin axis.
        this.beams = new THREE.Group();
        const beamMat = new THREE.MeshBasicMaterial({
          color: 0x9fd8ff,
          transparent: true,
          opacity: 0.35,
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
    this.mesh = new THREE.Mesh(this.isPlanet ? SPHERE : SPHERE_LOW, material);
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
    const look = { kind: body.kind, color: body.color, seed: seedFromName(this.name), climate: this.climate, earthMasses: body.mass / EARTH_MASS };
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
    if (tex.atmosphere !== undefined) {
      this.atmosphere = new THREE.Mesh(SPHERE_LOW, atmosphereMaterial(tex.atmosphere, body.kind === 'gas' ? 0.6 : 0.9));
      this.atmosphere.scale.setScalar(1.04);
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
    this.detailKey = key;
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
  update(body: Body, worldPerPixel: number, dt: number): void {
    this.group.position.set(body.x, body.y, body.z);
    const r = Math.max(body.radius, worldPerPixel * MIN_PIXEL_RADIUS);
    this.mesh.scale.setScalar(r);
    this.mesh.rotation.y += dt * 0.3;
    if (this.clouds) this.clouds.rotation.y += dt * 0.05;
    if (this.glow) {
      const big = this.kind === 'star' ? Math.max(body.radius * 9, worldPerPixel * 28) : this.kind === 'neutron' ? Math.max(body.radius * 12, worldPerPixel * 22) : body.radius * 14;
      this.glow.scale.setScalar(big);
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
    this.label.element.remove();
    this.group.remove(this.label);
    this.trail.geometry.dispose();
    (this.trail.material as THREE.Material).dispose();
  }
}
