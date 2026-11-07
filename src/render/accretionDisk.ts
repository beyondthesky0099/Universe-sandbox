import * as THREE from 'three';
import { iscoRadius, SHADOW_RADIUS_SCHWARZSCHILD } from '../sim/kerr';

/**
 * A black hole's accretion disc, shaded per pixel:
 *
 * - **Inner edge** at the innermost stable circular orbit, which depends on the spin (kerr.ts):
 *   6M without spin, 1.24M at a* = 0.998. Spin lets the gas go deeper and get hotter.
 * - **Temperature** of a thin disc (Shakura & Sunyaev 1973; Page & Thorne 1974, simplified):
 *   T ∝ R^(−3/4) (1 − √(R_in/R))^(1/4), shown as blackbody colours.
 * - **Doppler beaming:** the gas orbits at v/c = 1/√R (in M), 40% of light speed at 6M. The side
 *   coming towards you is boosted bluer and much brighter (∝ D³), the receding side reddened and
 *   dimmed. Gravitational redshift (√(1 − 3M/R) for orbiting gas) dims the inner edge.
 * - Streaks wind up because inner gas orbits faster (Ω ∝ R^(−3/2)).
 *
 * The mesh's unit is the non-spinning shadow radius (√27 M), so a disc and its shadow scale
 * together. Discs are drawn on their own layer, after the lensing pass, so the near side of the
 * disc passes in front of the black shadow. Disc light from directly behind the hole is hidden.
 */
export const DISK_LAYER = 2;

/** Set each frame: whether the lensing pass is drawing shadows (then the black sphere shrinks to the horizon). */
export const blackHoleView = { lensed: false };

const M = 1 / SHADOW_RADIUS_SCHWARZSCHILD; // one M in mesh units

const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  varying vec3 vCam;
  void main() {
    vLocal = position;
    vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform float uInner;   // ISCO, in M
  uniform float uOuter;   // outer edge, in M
  uniform float uM;       // one M in mesh units
  uniform float uTime;
  uniform float uBrightness;
  varying vec3 vLocal;
  varying vec3 vCam;

  vec3 blackbody(float kelvin) {
    float t = clamp(kelvin, 1000.0, 40000.0) / 100.0;
    float r = t <= 66.0 ? 1.0 : clamp(1.29293618 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
    float g = t <= 66.0 ? clamp(0.39008157876 * log(t) - 0.63184144378, 0.0, 1.0) : clamp(1.12989086 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
    float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.54320678911 * log(t - 10.0) - 1.19625408914, 0.0, 1.0));
    return vec3(r, g, b);
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // Thin-disc temperature profile (unnormalised).
  float profile(float R, float Rin) {
    return pow(R, -0.75) * pow(max(0.0, 1.0 - sqrt(Rin / R)), 0.25);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = vLocal.xy;
    float rho = length(p);
    float R = rho / uM;
    if (R < uInner || R > uOuter) discard;
    vec3 toCam = vCam - vLocal;
    // Light from the far side directly behind the hole is bent away: hide it.
    vec3 c = normalize(vCam);
    vec3 q = vLocal - dot(vLocal, c) * c;
    if (dot(vLocal, c) < 0.0 && length(q) < 1.0) discard;

    // Temperature: the peak of a non-spinning disc shows as 6,500 K.
    float peak0 = profile(6.0 * 49.0 / 36.0, 6.0);
    float T = 6500.0 * profile(R, uInner) / peak0;
    // Doppler and gravitational shift.
    float beta = min(0.95, inversesqrt(R));
    vec3 vdir = normalize(vec3(-p.y, p.x, 0.0));
    float cosT = dot(vdir, normalize(toCam));
    float gammaInv = sqrt(1.0 - beta * beta);
    float D = gammaInv / (1.0 - beta * cosT);
    float g = D * sqrt(max(0.05, 1.0 - 3.0 / R));
    vec3 col = blackbody(T * g);
    float I = pow(T / 6500.0, 2.0) * clamp(g * g * g, 0.02, 4.0);

    // Winding streaks: the pattern turns at the local orbital rate.
    float phi = atan(p.y, p.x);
    float omega = pow(R, -1.5) * 6.0;
    float swirl = phi - omega * uTime;
    float streaks = 0.55 + 0.45 * noise(vec2(R * 2.2, swirl * 5.0)) * (0.6 + 0.4 * noise(vec2(R * 9.0, swirl * 17.0)));
    // Soft outer edge, crisp inner edge.
    float edge = smoothstep(uInner, uInner * 1.06, R) * (1.0 - smoothstep(uOuter * 0.55, uOuter, R));
    gl_FragColor = vec4(col * I * streaks * edge * uBrightness, 1.0);
  }
`;

/** The disc mesh (unit = the non-spinning shadow radius); tilt it as the spin axis. */
export function accretionDiskMesh(): THREE.Mesh {
  const geometry = new THREE.RingGeometry(0.15, 36 * M, 192, 24);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uInner: { value: 6 },
      uOuter: { value: 36 },
      uM: { value: M },
      uTime: { value: 0 },
      uBrightness: { value: 0.6 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.layers.set(DISK_LAYER);
  mesh.renderOrder = 3;
  return mesh;
}

/** Per frame: spin (sets the inner edge) and time. */
export function updateAccretionDisk(mesh: THREE.Mesh, spin: number, seconds: number): void {
  const u = (mesh.material as THREE.ShaderMaterial).uniforms;
  u.uInner.value = iscoRadius(Math.abs(spin), spin >= 0);
  u.uTime.value = seconds;
}

/** The disc's normal in world space: the hole's spin axis. */
export function diskAxis(mesh: THREE.Mesh, out = new THREE.Vector3()): THREE.Vector3 {
  mesh.updateMatrixWorld();
  return out.set(0, 0, 1).transformDirection(mesh.matrixWorld);
}
