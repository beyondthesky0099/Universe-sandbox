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
 * together. Without the lensing pass, the flat disc is drawn on its own layer over the scene.
 * With it, the lens pass hides this mesh and draws the disc by tracing light around the hole
 * (sim/geodesic.ts): the far side appears bent over and under the shadow.
 */
export const DISK_LAYER = 2;

/** Set each frame: whether the lensing pass is drawing shadows (then the black sphere shrinks to the horizon). */
/** Shared view state: whether the lensing pass draws the shadow, and whether bodies are at real sizes (kerr.ts drawnShadowRadius). */
export const blackHoleView = { lensed: false, trueScale: false };

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

/**
 * The disc's shading, shared with the lens pass (postfx.ts), which draws the disc by tracing
 * light around the hole: blackbody colour from the thin-disc temperature, Doppler/gravitational
 * factor g applied as colour (T g) and brightness (g³), wound streaks, and soft edges.
 * `discShade(R, Rin, Rout, g, phi, time, brightness)` returns premultiplied colour and alpha.
 */
export const DISC_GLSL = /* glsl */ `
  vec3 blackbody(float kelvin) {
    float t = clamp(kelvin, 1000.0, 40000.0) / 100.0;
    float r = t <= 66.0 ? 1.0 : clamp(1.29293618 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
    float g = t <= 66.0 ? clamp(0.39008157876 * log(t) - 0.63184144378, 0.0, 1.0) : clamp(1.12989086 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
    float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.54320678911 * log(t - 10.0) - 1.19625408914, 0.0, 1.0));
    return vec3(r, g, b);
  }
  float discHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float discNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(discHash(i), discHash(i + vec2(1.0, 0.0)), u.x), mix(discHash(i + vec2(0.0, 1.0)), discHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float discProfile(float R, float Rin) {
    return pow(R, -0.75) * pow(max(0.0, 1.0 - sqrt(Rin / R)), 0.25);
  }
  vec4 discShade(float R, float Rin, float Rout, float g, float phi, float time, float brightness) {
    float peak0 = discProfile(6.0 * 49.0 / 36.0, 6.0);
    float T = 6500.0 * discProfile(R, Rin) / peak0;
    vec3 col = blackbody(T * g);
    // Observed intensity goes as g³ (no floor: gas deep in the hole's well, strongly redshifted,
    // must fade to black rather than glow grey across the shadow).
    float I = pow(T / 6500.0, 2.0) * clamp(g * g * g, 0.0, 4.0);
    float omega = pow(R, -1.5) * 6.0;
    float swirl = phi - omega * time;
    float streaks = 0.55 + 0.45 * discNoise(vec2(R * 2.2, swirl * 5.0)) * (0.6 + 0.4 * discNoise(vec2(R * 9.0, swirl * 17.0)));
    // Soft outer edge, crisp inner edge.
    float edge = smoothstep(Rin, Rin * 1.06, R) * (1.0 - smoothstep(Rout * 0.55, Rout, R));
    vec3 shade = col * I * streaks * edge * brightness;
    // Bright where thick, fading at the edges: the dark parts show what is behind.
    return vec4(shade, clamp(length(shade) * 1.5, 0.0, 1.0));
  }
`;

const FRAGMENT = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform float uInner;   // ISCO, in M
  uniform float uOuter;   // outer edge, in M
  uniform float uM;       // one M in mesh units
  uniform float uTime;
  uniform float uBrightness;
  uniform float uBeaming;  // 1 for a black hole's relativistic disc, 0 for a white dwarf's
  varying vec3 vLocal;
  varying vec3 vCam;
  ${DISC_GLSL}

  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = vLocal.xy;
    float rho = length(p);
    float R = rho / uM;
    if (R < uInner || R > uOuter) discard;
    vec3 toCam = vCam - vLocal;
    vec3 c = normalize(vCam);
    vec3 q = vLocal - dot(vLocal, c) * c;
    if (dot(vLocal, c) < 0.0 && length(q) < 1.0) discard;

    // Gas on a circular orbit at β = 1/√R, Doppler-shifted towards the camera, and gravitationally redshifted.
    float beta = min(0.95, inversesqrt(R)) * uBeaming;
    vec3 vdir = normalize(vec3(-p.y, p.x, 0.0));
    float cosT = dot(vdir, normalize(toCam));
    float gammaInv = sqrt(1.0 - beta * beta);
    float D = gammaInv / (1.0 - beta * cosT);
    float g = D * mix(1.0, sqrt(max(0.05, 1.0 - 3.0 / R)), uBeaming);
    float phi = atan(p.y, p.x);
    gl_FragColor = discShade(R, uInner, uOuter, g, phi, uTime, uBrightness);
  }
`;

/**
 * The disc mesh (unit = the non-spinning shadow radius); tilt it as the spin axis. A white
 * dwarf's disc (cataclysmic variables) is in units of the dwarf's radius instead: from 1.6 to 30
 * radii, no relativistic beaming, and about 17,000 K at its hottest.
 */
export function accretionDiskMesh(opts: { whiteDwarf?: boolean } = {}): THREE.Mesh {
  const wd = !!opts.whiteDwarf;
  const geometry = wd ? new THREE.RingGeometry(1.2, 30, 192, 24) : new THREE.RingGeometry(0.15, 36 * M, 192, 24);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uInner: { value: wd ? 1.6 : 6 },
      uOuter: { value: wd ? 30 : 36 },
      uM: { value: wd ? 1 : M },
      uTime: { value: 0 },
      uBrightness: { value: wd ? 0.8 : 0.6 },
      uBeaming: { value: wd ? 0 : 1 },
    },
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
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
  // A white dwarf's disc has a fixed inner edge; a black hole's is the ISCO of its spin.
  if (u.uBeaming.value > 0) u.uInner.value = iscoRadius(Math.abs(spin), spin >= 0);
  u.uTime.value = seconds;
}

/** The disc's normal in world space: the hole's spin axis. */
export function diskAxis(mesh: THREE.Mesh, out = new THREE.Vector3()): THREE.Vector3 {
  mesh.updateMatrixWorld();
  return out.set(0, 0, 1).transformDirection(mesh.matrixWorld);
}
