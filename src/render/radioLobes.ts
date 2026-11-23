import * as THREE from 'three';
import { lobeBasis, lobeTileRect, type RadioLobeAtlas } from '../sim/radioLobes';

/**
 * Radio lobes in the Universe view: each galaxy's radio-survey picture (sim/radioLobes.ts) as a
 * square in the plane of the sky at the galaxy, facing the Milky Way, at its true size, so from
 * here it lies over the galaxy exactly as the radio sky shows it. The false colours are added to
 * the image (black is nothing), and each fades in once it is a few dozen pixels across.
 *
 * Seen from anywhere else, a flat picture would turn edge-on into a thin streak (Centaurus A from
 * the side). Only this one projection of the lobes is known, so the picture turns to face the
 * camera by the smallest rotation from its true orientation: from the Milky Way's direction it is
 * exactly the radio sky, and from elsewhere it stays a whole picture, its axis kept as near as
 * possible to where it was.
 */
const VERTEX = /* glsl */ `
  attribute vec2 atlasUv;
  attribute vec3 centre;
  attribute float size;
  attribute vec2 corner;
  attribute vec3 right;
  attribute vec3 up;
  uniform float uPxPerUnit;
  varying vec2 vUv;
  varying float vFade;
  // Rotate v by the smallest rotation taking unit vector a to unit vector b (Rodrigues).
  vec3 turn(vec3 v, vec3 a, vec3 b) {
    vec3 k = cross(a, b);
    float s = length(k);
    float c = dot(a, b);
    if (s < 1e-5) return c > 0.0 ? v : -v + 2.0 * dot(v, up) * up; // opposite: half a turn about the picture's up
    k /= s;
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
  }
  void main() {
    vUv = atlasUv;
    vec3 world = (modelMatrix * vec4(centre, 1.0)).xyz;
    vec3 n0 = normalize(-centre);                  // the picture faces the Milky Way (the origin)
    vec3 n1 = normalize(cameraPosition - world);   // ... turned to face the camera
    float h = size * 0.5;
    vec3 p = centre + h * (corner.x * turn(right, n0, n1) + corner.y * turn(up, n0, n1));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
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
    const cornerA = new Float32Array(n * 4 * 2);
    const rightA = new Float32Array(n * 4 * 3);
    const upA = new Float32Array(n * 4 * 3);
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
        cornerA.set([sx, sy], i * 2);
        rightA.set(right, i * 3);
        upA.set(up, i * 3);
      });
      index.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('atlasUv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('centre', new THREE.BufferAttribute(centre, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('corner', new THREE.BufferAttribute(cornerA, 2));
    geo.setAttribute('right', new THREE.BufferAttribute(rightA, 3));
    geo.setAttribute('up', new THREE.BufferAttribute(upA, 3));
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
