import * as THREE from 'three';
import { equatorialToGalactic } from '../procgen/galaxy';
import { mulberry32 } from '../procgen/rng';
import { comovingDistance } from '../sim/cosmology';
import { galacticToCosmos } from '../sim/galaxies';
import { dotTexture } from './textures';

/**
 * The Bullet Cluster (1E 0657−56, RA 104.66°, Dec −55.95°, z = 0.296): two galaxy clusters that
 * passed through each other ~150 million years ago. Their hot gas (most of the ordinary matter,
 * seen in X-rays by Chandra; Markevitch et al. 2004) collided and lagged in the middle, while the
 * mass, mapped by gravitational lensing, went straight through with the galaxies (Clowe et al.
 * 2006, ApJ 648, L109): so most of the mass is not the gas. It is the classic direct evidence for
 * dark matter.
 *
 * The layout follows their map, west to the right in the sky: the two mass peaks ~720 kpc apart,
 * the main cluster's gas west of its mass, the "bullet" subcluster's gas behind its mass with a
 * bow shock ahead of it. Sizes and offsets are approximate; the colours follow the famous composite
 * (mass blue, gas pink).
 */
const RA = 104.66, DEC = -55.95, Z = 0.296;

function blob(color: number, size: number, opacity: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  s.userData.peak = opacity;
  return s;
}

export class BulletCluster {
  readonly group = new THREE.Group();
  readonly centre: THREE.Vector3;
  private readonly fading: THREE.Sprite[] = [];
  private readonly galaxies: THREE.Points;

  constructor() {
    const [l, b] = equatorialToGalactic(RA, DEC);
    this.centre = new THREE.Vector3(...galacticToCosmos(l, b, comovingDistance(Z)));
    this.group.position.copy(this.centre);
    // West and north on the sky at the cluster.
    const at = (ra: number, dec: number) => new THREE.Vector3(...galacticToCosmos(...equatorialToGalactic(ra, dec), 1));
    const c = at(RA, DEC);
    const east = at(RA + 0.01, DEC).sub(c).normalize();
    const north = at(RA, DEC + 0.01).sub(c).normalize();
    const west = east.clone().negate();
    const put = (s: THREE.Sprite, x: number, y = 0) => {
      s.position.copy(west).multiplyScalar(x).addScaledVector(north, y);
      this.group.add(s);
      this.fading.push(s);
    };
    // Mass (lensing): the main cluster east, the bullet west, ~0.72 Mpc apart.
    put(blob(0x3d7dff, 0.75, 0.55), -0.36);
    put(blob(0x3d7dff, 0.5, 0.55), 0.36);
    // Gas (X-rays): lagging towards the middle; the bullet's gas with its bow shock ahead.
    put(blob(0xff4fa3, 0.55, 0.6), -0.12, 0.02);
    put(blob(0xff4fa3, 0.26, 0.75), 0.17);
    put(blob(0xff8ac4, 0.16, 0.6), 0.25);

    // Galaxies, with the mass.
    const rand = mulberry32(657);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    const pos: number[] = [];
    for (let i = 0; i < 160; i++) {
      const main = i < 110;
      const x = (main ? -0.36 : 0.36) + gauss() * (main ? 0.13 : 0.08);
      const y = gauss() * (main ? 0.13 : 0.08);
      const z = gauss() * 0.1;
      const p = west.clone().multiplyScalar(x).addScaledVector(north, y).addScaledVector(c, z);
      pos.push(p.x, p.y, p.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.galaxies = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff1d6, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
    this.group.add(this.galaxies);
  }

  /** Shows only up close (within ~20 Mpc). */
  update(camera: THREE.Camera): void {
    const d = camera.position.distanceTo(this.centre);
    const k = 1 - THREE.MathUtils.smoothstep(d, 8, 25);
    for (const s of this.fading) s.material.opacity = (s.userData.peak as number) * k;
    (this.galaxies.material as THREE.PointsMaterial).opacity = k;
    this.group.visible = k > 0.01;
  }
}
