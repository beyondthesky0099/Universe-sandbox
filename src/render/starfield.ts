import * as THREE from 'three';
import { kelvinToRgb } from '../sim/color';
import { mulberry32 } from '../procgen/rng';
import { dotTexture } from './textures';
import { skyPoints, type BrightStar } from '../sim/stars';

/**
 * Distant background stars on a unit sphere. Kept centred on the camera every frame
 * so they behave as if infinitely far away.
 */
export function createStarfield(count = 6000, seed = 11): THREE.Points {
  const rng = mulberry32(seed);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = rng() * 2 - 1;
    const th = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = s * Math.cos(th);
    pos[i * 3 + 1] = u;
    pos[i * 3 + 2] = s * Math.sin(th);
    const [r, g, b] = kelvinToRgb(3000 + rng() * 9000);
    const brightness = Math.pow(rng(), 3) * 0.8 + 0.12;
    col[i * 3] = r * brightness;
    col[i * 3 + 1] = g * brightness;
    col[i * 3 + 2] = b * brightness;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 2,
    sizeAttenuation: false,
    vertexColors: true,
    map: dotTexture(),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = -10;
  points.frustumCulled = false;
  return points;
}

/**
 * The real night sky: catalogue stars (HYG, brighter than magnitude 6.5) on the unit sphere in
 * their true directions, so the constellations appear as seen from the Solar System. Drawn as
 * three magnitude layers so bright stars are larger.
 */
export function createRealSky(stars: BrightStar[]): THREE.Group {
  const group = new THREE.Group();
  const { pos, col } = skyPoints(stars);
  const layers: [number, number, number][] = [
    [-Infinity, 1.5, 5],
    [1.5, 3.5, 3.2],
    [3.5, Infinity, 2],
  ];
  for (const [lo, hi, size] of layers) {
    const idx = stars.map((s, i) => (s[3] >= lo && s[3] < hi ? i : -1)).filter((i) => i >= 0);
    const p = new Float32Array(idx.length * 3);
    const c = new Float32Array(idx.length * 3);
    idx.forEach((i, k) => {
      p.set(pos.subarray(i * 3, i * 3 + 3), k * 3);
      c.set(col.subarray(i * 3, i * 3 + 3), k * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const mat = new THREE.PointsMaterial({
      size,
      sizeAttenuation: false,
      vertexColors: true,
      map: dotTexture(),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = -10;
    points.frustumCulled = false;
    group.add(points);
  }
  return group;
}
