import * as THREE from 'three';
import { mulberry32 } from '../procgen/rng';
import { galacticToCosmos } from '../sim/galaxies';

/**
 * Around the Milky Way in the Universe view (Mpc, the Sun at the origin):
 *
 * - Its dark-matter halo: invisible matter outweighing the stars about twenty to one. Drawn as
 *   the projected density of an NFW halo (Navarro, Frenk & White 1997) with M200 = 1.08 × 10¹²
 *   M☉ (Cautun et al. 2020, MNRAS 494, 4291) and concentration 10, so r200 = 217 kpc (with the map's
 *   H0) and a scale radius of 22 kpc; it glows faint violet only to show where it is.
 * - The Magellanic Stream: a trail of hydrogen pulled out of the Large and Small Magellanic
 *   Clouds, along the great circle of the Magellanic coordinate system (pole at l = 188.5°,
 *   b = −7.5°, longitude 0 at the LMC; Nidever, Majewski & Butler Burton 2008, ApJ 679, 432). It
 *   trails 140° across the sky (Nidever et al. 2010, ApJ 723, 1618) and its Leading Arm runs 60°
 *   ahead, across the Galactic plane. Its distance along the sky is not measured: here it runs
 *   from the LMC's 50 kpc to 100 kpc at its tip, as models of the Clouds' first passage give
 *   (Besla et al. 2012, MNRAS 421, 2109); the Leading Arm stays near 50 kpc. Its gas thins along it.
 * - The Sagittarius Stream: stars torn from the Sagittarius Dwarf, wrapped around the Galaxy along
 *   the great circle of the Sagittarius coordinate system (pole at l = 273.75°, b = −13.46°,
 *   longitude 0 at the dwarf; Majewski et al. 2003, ApJ 599, 1082). The leading arm runs north
 *   over the Galactic pole, out to its apocentre at 48 kpc; the trailing arm runs south and out to
 *   102 kpc (Belokurov et al. 2014, MNRAS 437, 116). The distances between are interpolated
 *   through those, so the run is a sketch, not a map.
 * - Gaia–Enceladus: the debris of a galaxy that merged with ours 8–11 billion years ago (Helmi et
 *   al. 2018, Nature 563, 85; Belokurov et al. 2018, MNRAS 478, 611), a cloud of stars filling the
 *   inner halo to about 30 kpc, flattened (axis ratio 0.7). Its stars' places are illustrative.
 */
const DEG = Math.PI / 180;

function galUnit(l: number, b: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG));
}

/** Magellanic longitude/latitude (degrees) → galactic (l, b). */
export function magellanicToGalactic(L: number, B: number): [number, number] {
  const pole = galUnit(188.5, -7.5);
  const lmc = galUnit(280.47, -32.75);
  const o = lmc.clone().addScaledVector(pole, -lmc.dot(pole)).normalize();
  const q = new THREE.Vector3().crossVectors(pole, o);
  const d = o
    .multiplyScalar(Math.cos(B * DEG) * Math.cos(L * DEG))
    .addScaledVector(q, Math.cos(B * DEG) * Math.sin(L * DEG))
    .addScaledVector(pole, Math.sin(B * DEG));
  return [((Math.atan2(d.y, d.x) / DEG) % 360 + 360) % 360, Math.asin(THREE.MathUtils.clamp(d.z, -1, 1)) / DEG];
}

/** Sagittarius longitude (degrees, positive along the leading arm) and latitude → galactic (l, b). */
export function sagittariusToGalactic(L: number, B: number): [number, number] {
  const pole = galUnit(273.75, -13.46);
  const core = galUnit(5.57, -14.17);
  const o = core.clone().addScaledVector(pole, -core.dot(pole)).normalize();
  const q = new THREE.Vector3().crossVectors(pole, o);
  const d = o
    .multiplyScalar(Math.cos(B * DEG) * Math.cos(L * DEG))
    .addScaledVector(q, Math.cos(B * DEG) * Math.sin(L * DEG))
    .addScaledVector(pole, Math.sin(B * DEG));
  return [((Math.atan2(d.y, d.x) / DEG) % 360 + 360) % 360, Math.asin(THREE.MathUtils.clamp(d.z, -1, 1)) / DEG];
}

/** Heliocentric distance (kpc) along the Sagittarius Stream: through the measured apocentres. */
export function sagittariusDistance(L: number): number {
  // [longitude, kpc]: the dwarf at 28 kpc, the leading apocentre 48 kpc at 71°, the trailing 102 kpc at −170°.
  const track: [number, number][] = [[-220, 70], [-170, 102], [-140, 72], [-100, 42], [-50, 27], [0, 28], [40, 38], [71, 48], [110, 40], [150, 26], [200, 15]];
  if (L <= track[0][0]) return track[0][1];
  for (let i = 1; i < track.length; i++)
    if (L <= track[i][0]) {
      const [[a, da], [b, db]] = [track[i - 1], track[i]];
      const t = (L - a) / (b - a);
      return da + (db - da) * (t * t * (3 - 2 * t));
    }
  return track[track.length - 1][1];
}

export const HALO_R200_MPC = 0.217;
const HALO_RS_MPC = HALO_R200_MPC / 10;

export class LocalStructures {
  readonly group = new THREE.Group();
  private readonly halo: THREE.Mesh;
  private readonly stream: THREE.Points;
  private readonly sagittarius: THREE.Points;
  private readonly enceladus: THREE.Points;

  constructor() {
    // The halo: a camera-facing disc whose shader draws the NFW projected density out to r200.
    // It sits at the Galactic Centre (8.2 kpc from the Sun).
    const centre = new THREE.Vector3(...galacticToCosmos(0, 0, 0.0082));
    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * HALO_R200_MPC, 2 * HALO_R200_MPC),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uOpacity: { value: 0 }, uX200: { value: HALO_R200_MPC / HALO_RS_MPC } },
        vertexShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec2 vUv;
          void main() {
            vUv = uv;
            // Billboard: keep the quad facing the camera.
            vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            mv.xy += position.xy;
            gl_Position = projectionMatrix * mv;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <logdepthbuf_pars_fragment>
          uniform float uOpacity;
          uniform float uX200;
          varying vec2 vUv;
          // Projected NFW density (Bartelmann 1996), in units of the scale radius.
          float nfwSigma(float x) {
            if (abs(x - 1.0) < 1e-3) return 1.0 / 3.0;
            float y = 1.0 / x;
            float f = x < 1.0 ? log(y + sqrt(y * y - 1.0)) / sqrt(1.0 - x * x) : acos(y) / sqrt(x * x - 1.0);
            return (1.0 - f) / (x * x - 1.0);
          }
          void main() {
            #include <logdepthbuf_fragment>
            float R = length(vUv - 0.5) * 2.0;     // 1 at r200
            if (R > 1.0) discard;
            float x = max(R * uX200, 0.05);
            float s = nfwSigma(x) / nfwSigma(0.05);
            float k = pow(s, 0.35) * (1.0 - smoothstep(0.85, 1.0, R));
            gl_FragColor = vec4(vec3(0.42, 0.28, 0.75) * k * uOpacity, 1.0);
          }`,
      }),
    );
    this.halo.position.copy(centre);
    this.halo.frustumCulled = false;
    this.halo.renderOrder = -3;
    this.group.add(this.halo);

    // The Magellanic Stream and Leading Arm as clouds of gas points.
    const rand = mulberry32(2008);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    const n = 7000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const lead = i < n * 0.18;
      const L = lead ? rand() * 60 : -(rand() ** 1.6) * 140; // denser near the Clouds
      // Two intertwined filaments a few degrees apart (Nidever et al. 2008).
      const strand = rand() < 0.5 ? 1 : -1;
      const B = strand * 2.2 * Math.sin((L / 140) * 6) + gauss() * (lead ? 4 : 2.6);
      const [l, b] = magellanicToGalactic(L, B);
      const dKpc = lead ? 50 : 50 + 50 * (-L / 140);
      pos.set(galacticToCosmos(l, b, (dKpc + gauss() * 3) / 1000), i * 3);
      // Neutral hydrogen thins along the tail.
      const k = 0.3 * (lead ? 0.45 : 1) * Math.exp(-Math.abs(L) / 90) * (0.6 + 0.4 * rand());
      col.set([0.35 * k, 0.75 * k, 1.0 * k], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stream = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.stream.frustumCulled = false;
    this.group.add(this.stream);

    // The Sagittarius Stream: old stars, warm white, densest near the dwarf.
    const sgr = (count: number, make: (i: number) => [number, number, number, number]) => {
      const p = new Float32Array(count * 3);
      const c = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const [x, y, z, k] = make(i);
        p.set([x, y, z], i * 3);
        c.set([1.0 * k, 0.86 * k, 0.62 * k], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      pts.frustumCulled = false;
      this.group.add(pts);
      return pts;
    };
    this.sagittarius = sgr(9000, () => {
      const lead = rand() < 0.5;
      const L = (lead ? 1 : -1) * 220 * rand() ** 1.3;
      const [l, b] = sagittariusToGalactic(L, gauss() * 3);
      const d = sagittariusDistance(L) * (1 + gauss() * 0.06);
      const k = 0.35 * Math.exp(-Math.abs(L) / 160) * (0.6 + 0.4 * rand());
      return [...galacticToCosmos(l, b, d / 1000), k] as [number, number, number, number];
    });

    // Gaia–Enceladus: a flattened cloud about the Galactic Centre, density falling as r⁻³ from 3 to 30 kpc.
    const gc = new THREE.Vector3(...galacticToCosmos(0, 0, 0.0082));
    const ex = new THREE.Vector3(...galacticToCosmos(0, 0, 1));
    const ey = new THREE.Vector3(...galacticToCosmos(90, 0, 1));
    const ez = new THREE.Vector3(...galacticToCosmos(0, 90, 1));
    this.enceladus = sgr(5000, () => {
      const r = (3 * (30 / 3) ** rand()) / 1000;
      const u = 2 * rand() - 1, phi = 2 * Math.PI * rand(), sn = Math.sqrt(1 - u * u);
      const v = gc.clone().addScaledVector(ex, r * sn * Math.cos(phi)).addScaledVector(ey, r * sn * Math.sin(phi)).addScaledVector(ez, 0.7 * r * u);
      return [v.x, v.y, v.z, 0.22 * (0.6 + 0.4 * rand())];
    });
    (this.enceladus.material as THREE.PointsMaterial).color.setRGB(1, 0.7, 0.5);
  }

  setHaloVisible(on: boolean): void {
    this.halo.visible = on;
  }

  /** Both show near the Milky Way (camera within a few Mpc) and fade further out. */
  update(camera: THREE.Camera): void {
    const d = camera.position.length();
    const near = 1 - THREE.MathUtils.smoothstep(d, 1.2, 4);
    (this.halo.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.55 * near * THREE.MathUtils.smoothstep(d, 0.05, 0.25);
    (this.stream.material as THREE.PointsMaterial).opacity = 0.9 * near * THREE.MathUtils.smoothstep(d, 0.02, 0.08);
    (this.sagittarius.material as THREE.PointsMaterial).opacity = 0.9 * near * THREE.MathUtils.smoothstep(d, 0.015, 0.06);
    // Gaia–Enceladus is inner-halo sized: it shows closer in, and fades sooner.
    (this.enceladus.material as THREE.PointsMaterial).opacity = 0.9 * (1 - THREE.MathUtils.smoothstep(d, 0.15, 0.5)) * THREE.MathUtils.smoothstep(d, 0.006, 0.03);
  }
}
