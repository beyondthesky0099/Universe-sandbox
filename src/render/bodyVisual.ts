import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Body, BodyKind } from '../sim/body';
import { accretionTexture, gasGiantTexture, glowTexture, rockyTexture } from './textures';

const SPHERE = new THREE.SphereGeometry(1, 48, 24);
const DISK = new THREE.RingGeometry(1.6, 5, 96, 1);
export const TRAIL_LENGTH = 500;

/** Minimum on-screen radius (px) so tiny bodies stay visible when zoomed out. */
const MIN_PIXEL_RADIUS = 2.2;

/** Everything drawn for one simulated body: sphere, glow, accretion disk, trail and label. */
export class BodyVisual {
  readonly id: number;
  kind: BodyKind;
  color: number;
  readonly group = new THREE.Group();
  readonly trail: THREE.Line;
  readonly label: CSS2DObject;
  private mesh!: THREE.Mesh;
  private glow?: THREE.Sprite;
  private disk?: THREE.Mesh;
  private readonly trailPos: Float32Array;
  private trailFilled = false;
  private lastTrail = new THREE.Vector3();
  private trailFrames = 0;
  private texture?: THREE.Texture;

  constructor(body: Body) {
    this.id = body.id;
    this.kind = body.kind;
    this.color = body.color;
    this.build(body);

    this.trailPos = new Float32Array(TRAIL_LENGTH * 3);
    const colors = new Float32Array(TRAIL_LENGTH * 3);
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

  private build(body: Body): void {
    this.disposeParts();
    const seed = body.id * 7919;
    let material: THREE.Material;
    switch (body.kind) {
      case 'star':
      case 'neutron':
        material = new THREE.MeshBasicMaterial({ color: new THREE.Color(body.color).multiplyScalar(1.15) });
        this.glow = this.makeGlow(body.color, 1);
        break;
      case 'blackhole':
        material = new THREE.MeshBasicMaterial({ color: 0x000000 });
        this.disk = new THREE.Mesh(
          DISK,
          new THREE.MeshBasicMaterial({
            map: accretionTexture(),
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        this.disk.rotation.x = -Math.PI / 2 + 0.25;
        this.glow = this.makeGlow(0xff9a4a, 0.5);
        break;
      case 'gas':
        this.texture = gasGiantTexture(body.color, seed);
        material = new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.85, metalness: 0 });
        break;
      case 'rocky':
        this.texture = rockyTexture(body.color, seed);
        material = new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.95, metalness: 0 });
        break;
    }
    this.mesh = new THREE.Mesh(SPHERE, material);
    this.mesh.rotation.z = 0.2;
    this.group.add(this.mesh);
    if (this.disk) this.group.add(this.disk);
    if (this.glow) this.group.add(this.glow);
  }

  private makeGlow(color: number, opacity: number): THREE.Sprite {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    return sprite;
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

  /** Update transform. `worldPerPixel` is the world size of one screen pixel at the body's depth. */
  update(body: Body, worldPerPixel: number, dt: number): void {
    this.group.position.set(body.x, body.y, body.z);
    const r = Math.max(body.radius, worldPerPixel * MIN_PIXEL_RADIUS);
    this.mesh.scale.setScalar(r);
    this.mesh.rotation.y += dt * 0.3;
    if (this.glow) {
      const glowSize = this.kind === 'star' ? Math.max(body.radius * 9, worldPerPixel * 28) : body.radius * 14;
      this.glow.scale.setScalar(glowSize);
    }
    if (this.disk) {
      this.disk.scale.setScalar(r);
      this.disk.rotation.z += dt * 0.8;
    }
  }

  /** Append the body's position to its trail if it has moved far enough. */
  pushTrail(body: Body, spacing: number): void {
    const p = this.trailPos;
    if (!this.trailFilled) {
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        p[i * 3] = body.x;
        p[i * 3 + 1] = body.y;
        p[i * 3 + 2] = body.z;
      }
      this.trailFilled = true;
      this.lastTrail.set(body.x, body.y, body.z);
    }
    this.trailFrames++;
    const d2 = (body.x - this.lastTrail.x) ** 2 + (body.y - this.lastTrail.y) ** 2 + (body.z - this.lastTrail.z) ** 2;
    const last = (TRAIL_LENGTH - 1) * 3;
    if (d2 < spacing * spacing && this.trailFrames < 120) {
      // Keep the head of the trail glued to the body.
      p[last] = body.x;
      p[last + 1] = body.y;
      p[last + 2] = body.z;
    } else {
      p.copyWithin(0, 3);
      p[last] = body.x;
      p[last + 1] = body.y;
      p[last + 2] = body.z;
      this.lastTrail.set(body.x, body.y, body.z);
      this.trailFrames = 0;
    }
    (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  clearTrail(): void {
    this.trailFilled = false;
  }

  private paintTrail(): void {
    const c = new THREE.Color(this.kind === 'blackhole' ? 0xb07cff : this.color);
    // Make dark bodies' trails visible.
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.max(0.45, hsl.l));
    const attr = this.trail.geometry.attributes.color as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const t = Math.pow(i / (TRAIL_LENGTH - 1), 1.6) * 0.75;
      arr[i * 3] = c.r * t;
      arr[i * 3 + 1] = c.g * t;
      arr[i * 3 + 2] = c.b * t;
    }
    attr.needsUpdate = true;
  }

  private disposeParts(): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      (this.mesh.material as THREE.Material).dispose();
    }
    if (this.glow) {
      this.group.remove(this.glow);
      this.glow.material.dispose();
      this.glow = undefined;
    }
    if (this.disk) {
      this.group.remove(this.disk);
      (this.disk.material as THREE.Material).dispose();
      this.disk = undefined;
    }
    this.texture?.dispose();
    this.texture = undefined;
  }

  dispose(): void {
    this.disposeParts();
    this.label.element.remove();
    this.group.remove(this.label);
    this.trail.geometry.dispose();
    (this.trail.material as THREE.Material).dispose();
  }
}
