import * as THREE from 'three';
import { kelvinToRgb } from '../sim/color';
import { mulberry32 } from '../procgen/rng';
import { dotTexture } from './textures';

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
