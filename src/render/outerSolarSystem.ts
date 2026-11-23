/**
 * The edge of the Solar System, drawn around the Sun in the real Solar System scenes (render only,
 * not simulated: these take millions of years to move).
 *
 * - The heliopause: where the solar wind meets the interstellar medium. Voyager 1 crossed it at
 *   121.6 AU (August 2012) and Voyager 2 at 119.0 AU (November 2018). The heliosphere is blunt
 *   towards the interstellar wind, which comes from ecliptic longitude 255.4°, latitude 5.2°
 *   (IBEX, McComas et al. 2015), and trails a long tail the other way; the shape here is a
 *   simple stretched shell with its nose at 120 AU, not a model.
 * - The Oort cloud: a spherical swarm of perhaps 10¹¹–10¹² icy bodies, inferred from long-period
 *   comets (Oort 1950) and never observed directly. The inner (Hills) cloud, about 2,000–20,000
 *   AU, is thicker towards the ecliptic; the outer cloud, about 20,000–100,000 AU, is close to
 *   spherical. Each point is a placeholder for billions of comets; the positions are random.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mulberry32 } from '../procgen/rng';

const DEG = Math.PI / 180;
export const HELIOPAUSE_NOSE_AU = 120;
export const OORT_INNER_AU = 2000;
export const OORT_HILLS_EDGE_AU = 20000;
export const OORT_OUTER_AU = 100000;

/** Scene direction (x, y = ecliptic north, z) of an ecliptic longitude and latitude (degrees). */
function eclipticDir(lon: number, lat: number): THREE.Vector3 {
  // Ecliptic (x, y, z) → scene (x, z, −y), as in solarSystemData.toScene.
  const x = Math.cos(lat * DEG) * Math.cos(lon * DEG);
  const y = Math.cos(lat * DEG) * Math.sin(lon * DEG);
  const z = Math.sin(lat * DEG);
  return new THREE.Vector3(x, z, -y);
}

function label(text: string, cls = ''): CSS2DObject {
  const el = document.createElement('div');
  el.className = `body-label edge-label ${cls}`;
  el.textContent = text;
  return new CSS2DObject(el);
}

/** A radius from a power law n(r) ∝ r^−k between a and b (k ≠ 1). */
function powerLawRadius(u: number, a: number, b: number, k: number): number {
  const p = 1 - k;
  return Math.pow(Math.pow(a, p) + u * (Math.pow(b, p) - Math.pow(a, p)), 1 / p);
}

export class OuterSolarSystem {
  readonly group = new THREE.Group();
  private readonly helio: THREE.Mesh;
  private readonly oort: THREE.Points;
  private readonly labels: { obj: CSS2DObject; show: (d: number) => boolean }[] = [];

  constructor() {
    this.group.visible = false;
    // The heliosphere: a soft rim-lit shell, nose towards the interstellar wind.
    const nose = eclipticDir(255.4, 5.2);
    const shell = new THREE.SphereGeometry(1, 64, 32);
    this.helio = new THREE.Mesh(
      shell,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 vN; varying vec3 vView;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal); vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <logdepthbuf_pars_fragment>
          uniform float uOpacity;
          varying vec3 vN; varying vec3 vView;
          void main() {
            #include <logdepthbuf_fragment>
            float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 3.0);
            gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * rim * uOpacity, 1.0);
          }`,
      }),
    );
    // Nose at 120 AU, sides at ~150 AU, a tail ~3× longer downwind: an ellipsoid shifted downwind.
    const along = 3 * HELIOPAUSE_NOSE_AU;
    this.helio.scale.set(150, 150, along / 2 + HELIOPAUSE_NOSE_AU / 2);
    this.helio.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nose.clone().negate());
    this.helio.position.copy(nose).multiplyScalar(-(along - HELIOPAUSE_NOSE_AU) / 2);
    this.helio.renderOrder = -2;
    this.group.add(this.helio);
    const helioLabel = label('Heliopause: edge of the Sun’s wind (Voyager 1 crossed it at 121.6 AU in 2012)');
    helioLabel.position.copy(nose).multiplyScalar(HELIOPAUSE_NOSE_AU);
    this.group.add(helioLabel);
    this.labels.push({ obj: helioLabel, show: (d) => d > 60 && d < 4000 });

    // The Oort cloud.
    const rand = mulberry32(1950);
    const inner = 9000, outer = 9000;
    const pos = new Float32Array((inner + outer) * 3);
    const col = new Float32Array((inner + outer) * 3);
    for (let i = 0; i < inner + outer; i++) {
      const hills = i < inner;
      const r = hills ? powerLawRadius(rand(), OORT_INNER_AU, OORT_HILLS_EDGE_AU, 2.5) : powerLawRadius(rand(), OORT_HILLS_EDGE_AU, OORT_OUTER_AU, 3.5);
      // Uniform on the sphere, then squashed towards the ecliptic for the inner cloud.
      const u = 2 * rand() - 1, phi = 2 * Math.PI * rand();
      const s = Math.sqrt(1 - u * u);
      const flat = hills ? 0.45 + 0.55 * ((r - OORT_INNER_AU) / (OORT_HILLS_EDGE_AU - OORT_INNER_AU)) : 1;
      pos.set([r * s * Math.cos(phi), r * u * flat, r * s * Math.sin(phi)], i * 3);
      const k = 0.55 + 0.45 * rand();
      col.set([0.62 * k, 0.78 * k, 0.95 * k], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.oort = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.oort.frustumCulled = false;
    this.group.add(this.oort);
    const hillsLabel = label('Inner Oort cloud (Hills cloud): 2,000–20,000 AU', 'oort-label');
    hillsLabel.position.set(OORT_HILLS_EDGE_AU * 0.55, 0, 0);
    this.group.add(hillsLabel);
    this.labels.push({ obj: hillsLabel, show: (d) => d > 6000 && d < 80000 });
    const oortLabel = label('Oort cloud: trillions of icy comets, out to ~100,000 AU (never seen directly)', 'oort-label');
    oortLabel.position.set(0, OORT_OUTER_AU * 0.7, 0);
    this.group.add(oortLabel);
    this.labels.push({ obj: oortLabel, show: (d) => d > 30000 });
  }

  /** Show around the Sun (or hide), fading each part in with the camera's distance from the Sun (AU). */
  update(sun: { x: number; y: number; z: number } | undefined, cameraDistance: number): void {
    const on = !!sun;
    this.group.visible = on;
    for (const l of this.labels) l.obj.visible = on && l.show(cameraDistance);
    if (!sun) return;
    this.group.position.set(sun.x, sun.y, sun.z);
    const d = cameraDistance;
    (this.helio.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.35 * THREE.MathUtils.smoothstep(d, 40, 200) * (1 - THREE.MathUtils.smoothstep(d, 20000, 80000));
    (this.oort.material as THREE.PointsMaterial).opacity = THREE.MathUtils.smoothstep(d, 400, 4000);
  }
}
