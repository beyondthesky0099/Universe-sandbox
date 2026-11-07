import * as THREE from 'three';

/**
 * What a fast-moving observer sees (special relativity), for travel near light speed:
 *
 * - Aberration: a star at angle θ from the direction of motion (in the galaxy's frame) appears
 *   at θ′ with cos θ′ = (cos θ + β) / (1 + β cos θ), so the sky crowds towards the front.
 * - Doppler shift: light from that star arrives with frequency × D, D = γ (1 + β cos θ):
 *   blue ahead, red behind. A blackbody's spectrum shifts as a whole, so its colour is that of
 *   a blackbody D times hotter.
 * - Beaming: the light ahead brightens and behind dims (by up to D⁴ in total flux); shown
 *   softened, as D^1.5 capped at 3×, so the colour shift stays visible on a screen.
 *
 * Every star and cloud material includes the GLSL below and reads `uBeta` (the observer's
 * velocity / c, in view space) from one shared uniform, set each frame by the travelling view
 * and zero otherwise.
 */
export const relativity = { uBeta: { value: new THREE.Vector3() } };

/** Lorentz factor. */
export function gamma(beta: number): number {
  return 1 / Math.sqrt(1 - beta * beta);
}

/** Apparent angle (cosine) of a direction at cos θ from the motion, for an observer at speed β. */
export function aberrate(cosTheta: number, beta: number): number {
  return (cosTheta + beta) / (1 + beta * cosTheta);
}

/** Doppler factor (observed / emitted frequency) for light from cos θ (galaxy frame). */
export function doppler(cosTheta: number, beta: number): number {
  return gamma(beta) * (1 + beta * cosTheta);
}

/** GLSL: the uniform and functions. Include before main(). */
export const RELATIVITY_PARS = /* glsl */ `
  uniform vec3 uBeta;
  // Approximate colour of a blackbody (Tanner Helland's fit), RGB 0–1.
  vec3 relBlackbody(float kelvin) {
    float t = clamp(kelvin, 1000.0, 40000.0) / 100.0;
    float r = t <= 66.0 ? 1.0 : clamp(1.29293618 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
    float g = t <= 66.0 ? clamp(0.39008157876 * log(t) - 0.63184144378, 0.0, 1.0) : clamp(1.12989086 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
    float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.54320678911 * log(t - 10.0) - 1.19625408914, 0.0, 1.0));
    return vec3(r, g, b);
  }
  // Moves a view-space position to where a moving observer sees it; returns the Doppler factor.
  float relAberrate(inout vec4 mv) {
    float b = length(uBeta);
    if (b < 1e-4) return 1.0;
    vec3 n = uBeta / b;
    float dist = length(mv.xyz);
    if (dist <= 0.0) return 1.0;
    vec3 dir = mv.xyz / dist;
    float c0 = dot(dir, n);
    float c1 = (c0 + b) / (1.0 + b * c0);
    vec3 perp = dir - c0 * n;
    float pl = length(perp);
    vec3 p = pl > 1e-6 ? perp / pl : vec3(0.0);
    mv.xyz = (c1 * n + sqrt(max(0.0, 1.0 - c1 * c1)) * p) * dist;
    return inversesqrt(1.0 - b * b) * (1.0 + b * c0);
  }
  // Shifts a star's colour as if its temperature were D times higher, and beams its brightness.
  vec3 relShift(vec3 col, float D) {
    if (abs(D - 1.0) < 1e-4) return col;
    float lum = dot(col, vec3(0.3, 0.5, 0.2));
    // Temperature from the colour: blue/red ratio of a blackbody.
    float t = clamp(6500.0 * pow(max(col.b, 1e-3) / max(col.r, 1e-3), 1.2), 1500.0, 40000.0);
    vec3 shifted = relBlackbody(t * D);
    float sl = max(dot(shifted, vec3(0.3, 0.5, 0.2)), 1e-3);
    // Beamed brighter ahead and fainter behind; softened (D^1.5, at most 3×) so the colour shift
    // stays visible instead of everything ahead burning out to white.
    return shifted / sl * lum * clamp(pow(D, 1.5), 0.03, 3.0);
  }
`;

/** Point materials built from three's PointsMaterial: add aberration and Doppler shift. */
export function relativisticPoints(material: THREE.PointsMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBeta = relativity.uBeta;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${RELATIVITY_PARS}\nvoid main() {`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          float relD = relAberrate(mvPosition);
          gl_Position = projectionMatrix * mvPosition;
          #ifdef USE_COLOR
            vColor.rgb = relShift(vColor.rgb, relD);
          #endif
        }`,
      );
  };
}

/** Sprites (text labels, markers): move their centre as aberration moves the stars, so names stay on them. */
export function relativisticSprite(material: THREE.SpriteMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBeta = relativity.uBeta;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${RELATIVITY_PARS}\nvoid main() {`)
      .replace('vec4 mvPosition = modelViewMatrix[ 3 ];', 'vec4 mvPosition = modelViewMatrix[ 3 ];\n\trelAberrate( mvPosition );');
  };
}

/** Sets the shared velocity from a world-space velocity direction and speed (β), for this camera. */
export function setObserverVelocity(camera: THREE.Camera, dirWorld: THREE.Vector3 | undefined, beta: number): void {
  if (!dirWorld || beta <= 0) {
    relativity.uBeta.value.set(0, 0, 0);
    return;
  }
  camera.updateMatrixWorld();
  relativity.uBeta.value.copy(dirWorld).normalize().transformDirection(camera.matrixWorldInverse).multiplyScalar(Math.min(beta, 0.9995));
}
