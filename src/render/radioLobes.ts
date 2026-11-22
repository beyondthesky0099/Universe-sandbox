import * as THREE from 'three';
import { lobeBasis, lobeTileRect, type RadioLobeAtlas } from '../sim/radioLobes';

/**
 * Radio lobes in the Universe view: each galaxy's radio-survey picture (sim/radioLobes.ts) as a
 * square in the plane of the sky at the galaxy, facing the Milky Way, at its true size, so from
 * here it lies over the galaxy exactly as the radio sky shows it. The false colours are added to
 * the image (black is nothing), and each fades in once it is a few dozen pixels across.
 */
const VERTEX = /* glsl */ `
  attribute vec2 atlasUv;
  attribute vec3 centre;
  attribute float size;
  uniform float uPxPerUnit;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vUv = atlasUv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 c = modelViewMatrix * vec4(centre, 1.0);
    float px = size * uPxPerUnit / max(-c.z, 1e-6);
    vFade = smoothstep(24.0, 80.0, px);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vec3 c = texture2D(uAtlas, vUv).rgb;
    gl_FragColor = vec4(c * vFade * uOpacity, 1.0);
  }
`;

export interface LobePlacement {
  /** Index into atlas.lobes. */
  index: number;
  /** Centre in the Universe map (Mpc) and the picture's side (Mpc). */
  centre: [number, number, number];
  side: number;
}

export class RadioLobeLayer {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(atlas: RadioLobeAtlas, texture: THREE.Texture, placements: LobePlacement[]) {
    const n = placements.length;
    const pos = new Float32Array(n * 4 * 3);
    const uv = new Float32Array(n * 4 * 2);
    const centre = new Float32Array(n * 4 * 3);
    const size = new Float32Array(n * 4);
    const index: number[] = [];
    placements.forEach((p, k) => {
      const lobe = atlas.lobes[p.index];
      const { up, right } = lobeBasis(lobe.l, lobe.b);
      const [u0, v0, du, dv] = lobeTileRect(atlas, lobe.tile);
      const h = p.side / 2;
      const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      corners.forEach(([sx, sy], c) => {
        const i = k * 4 + c;
        for (let a = 0; a < 3; a++) pos[i * 3 + a] = p.centre[a] + h * (sx * right[a] + sy * up[a]);
        uv[i * 2] = u0 + ((sx + 1) / 2) * du;
        uv[i * 2 + 1] = v0 + ((sy + 1) / 2) * dv;
        centre.set(p.centre, i * 3);
        size[i] = p.side;
      });
      index.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('atlasUv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('centre', new THREE.BufferAttribute(centre, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geo.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uAtlas: { value: texture }, uOpacity: { value: 0.9 }, uPxPerUnit: { value: 1000 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  setPxPerUnit(v: number): void {
    this.material.uniforms.uPxPerUnit.value = v;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
