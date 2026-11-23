import * as THREE from 'three';
import { equatorialToGalactic } from '../procgen/galaxy';
import { galacticToCosmos } from '../sim/galaxies';
import { comovingDistance } from '../sim/cosmology';
import { textSprite } from './galaxyView';

/**
 * Shapes in the Universe view that labels alone can't show:
 *
 * - The Zone of Avoidance: within about 10° of the Milky Way's plane its dust and stars hide the
 *   galaxies behind (Kraan-Korteweg & Lahav 2000), so every galaxy survey has a gap there. Drawn as
 *   the wedge |b| < 10°, out to 600 Mpc.
 * - The Quipu superstructure (Böhringer et al. 2025, A&A 695, A59): 68 galaxy clusters at z ≈ 0.043
 *   along a 428 Mpc chain. Its northern 20 clusters have a mean right ascension of 45.5°, its
 *   southern 48 of 89.3°, from Dec +51.7° to −69.8°; the line follows those means, so it is a
 *   sketch of its run, not each cluster.
 * - The Big Ring (Lopez et al. 2024, JCAP 07, 055): a ring of Mg II absorbers ~400 Mpc across at
 *   z ≈ 0.80, near Boötes, about RA 208°, Dec 51° (read off the paper's figures).
 * - The Giant Arc (Lopez, Clowes & Williger 2022, MNRAS 516, 1557): an arc ~1 Gpc long at z ≈ 0.80,
 *   12° from the Big Ring, about RA 212.5°, Dec 39°, running west–east. Drawn as a gentle arc.
 * Both arcs are debated: they are traced by absorbers in quasar spectra, and some argue they are
 * chance alignments. The labels say "claimed".
 */
function eq(raDeg: number, decDeg: number, dMpc: number): THREE.Vector3 {
  const [l, b] = equatorialToGalactic(raDeg, decDeg);
  return new THREE.Vector3(...galacticToCosmos(l, b, dMpc));
}

/** Unit vectors east and north on the sky at (RA, Dec), in the Universe frame. */
function skyBasis(raDeg: number, decDeg: number): { east: THREE.Vector3; north: THREE.Vector3 } {
  const c = eq(raDeg, decDeg, 1);
  const e = eq(raDeg + 0.01, decDeg, 1).sub(c).normalize();
  const n = eq(raDeg, decDeg + 0.01, 1).sub(c).normalize();
  return { east: e, north: n };
}

function glowLine(points: THREE.Vector3[], color: number): THREE.Line {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  line.frustumCulled = false;
  return line;
}

/** A smooth curve through a few points (centripetal Catmull–Rom). */
function smooth(points: THREE.Vector3[], n = 160): THREE.Vector3[] {
  return new THREE.CatmullRomCurve3(points, false, 'centripetal').getPoints(n);
}

interface Shape {
  obj: THREE.Object3D;
  /** Camera distances (Mpc, from the shape's centre) over which it shows. */
  near: number;
  far: number;
  centre: THREE.Vector3;
  strength: number;
}

export class CosmicShapes {
  readonly group = new THREE.Group();
  private readonly shapes: Shape[] = [];
  private readonly zoa: THREE.Mesh;
  private readonly zoaLabel: THREE.Sprite;

  constructor() {
    // The Zone of Avoidance: two cones at b = ±10°, faint, fading outwards.
    const R = 600;
    const segs = 128;
    const pos: number[] = [];
    const fade: number[] = [];
    const index: number[] = [];
    for (const b of [10, -10]) {
      const base = pos.length / 3;
      for (let k = 0; k <= segs; k++) {
        const l = (k / segs) * 360;
        pos.push(0, 0, 0, ...galacticToCosmos(l, b, R));
        fade.push(1, 0);
      }
      for (let k = 0; k < segs; k++) {
        const a = base + 2 * k;
        index.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('fade', new THREE.Float32BufferAttribute(fade, 1));
    geo.setIndex(index);
    this.zoa = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          attribute float fade;
          varying float vFade;
          void main() {
            vFade = fade;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <logdepthbuf_pars_fragment>
          uniform float uOpacity;
          varying float vFade;
          void main() {
            #include <logdepthbuf_fragment>
            gl_FragColor = vec4(vec3(0.55, 0.12, 0.1) * pow(vFade, 1.5) * uOpacity, 1.0);
          }`,
      }),
    );
    this.zoa.frustumCulled = false;
    this.zoa.renderOrder = -2;
    this.group.add(this.zoa);
    this.zoaLabel = textSprite('Zone of Avoidance: the Milky Way’s dust hides the galaxies here', '#ff9a8a', 0.8);
    this.zoaLabel.position.set(...galacticToCosmos(300, 0, 140));
    this.zoaLabel.userData.priority = 50;
    this.group.add(this.zoaLabel);

    // Quipu: its run through the means of its northern and southern clusters.
    const dq = comovingDistance(0.043);
    const quipu = smooth([eq(45.5, 51.7, dq), eq(45.5, 26, dq), eq(52, 2, dq), eq(80, -16, dq), eq(89.3, -40, dq), eq(89.3, -69.8, dq)]);
    this.add(glowLine(quipu, 0xffb36b), 120, 3000, 0.75);

    // The Big Ring, in the plane of the sky.
    const z8 = comovingDistance(0.802);
    const ring: THREE.Vector3[] = [];
    {
      const c = eq(208, 51, z8);
      const { east, north } = skyBasis(208, 51);
      for (let k = 0; k <= 128; k++) {
        const a = (k / 128) * 2 * Math.PI;
        ring.push(c.clone().addScaledVector(east, 200 * Math.cos(a)).addScaledVector(north, 200 * Math.sin(a)));
      }
    }
    this.add(glowLine(ring, 0x9fc2ff), 500, 20000, 0.8);

    // The Giant Arc: ~1 Gpc west–east, bowed by a sixth of its length.
    {
      const c = eq(212.5, 39, z8);
      const { east, north } = skyBasis(212.5, 39);
      const arc: THREE.Vector3[] = [];
      for (let k = 0; k <= 64; k++) {
        const t = k / 64 - 0.5;
        arc.push(c.clone().addScaledVector(east, 1000 * t).addScaledVector(north, -170 * (1 - 4 * t * t)));
      }
      this.add(glowLine(arc, 0x9fc2ff), 500, 20000, 0.8);
    }
  }

  private add(obj: THREE.Object3D, near: number, far: number, strength: number): void {
    const box = new THREE.Box3().setFromObject(obj);
    this.shapes.push({ obj, near, far, centre: box.getCenter(new THREE.Vector3()), strength });
    this.group.add(obj);
  }

  setZoneVisible(on: boolean): void {
    this.zoa.visible = this.zoaLabel.visible = on;
  }

  update(camera: THREE.Camera): void {
    const d0 = camera.position.length();
    (this.zoa.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.35 * THREE.MathUtils.smoothstep(d0, 15, 60) * (1 - THREE.MathUtils.smoothstep(d0, 2500, 6000));
    this.zoaLabel.visible = this.zoa.visible && d0 > 40 && d0 < 2500;
    for (const s of this.shapes) {
      const d = camera.position.distanceTo(s.centre);
      const k = THREE.MathUtils.smoothstep(d, s.near * 0.5, s.near) * (1 - THREE.MathUtils.smoothstep(d, s.far, s.far * 2));
      ((s.obj as THREE.Line).material as THREE.LineBasicMaterial).opacity = s.strength * k;
    }
  }
}

