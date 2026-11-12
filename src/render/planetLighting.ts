import * as THREE from 'three';

/**
 * Lighting details that make planets look photographed, added to three.js's standard material:
 *
 * - **Ring shadows.** A ringed planet's globe shades the rings behind it, and the rings cast a
 *   banded shadow across the globe (Cassini's pictures of Saturn are full of both). For each
 *   point the shader follows the ray towards the star: on the rings, does it hit the planet; on
 *   the planet, where does it cross the ring plane, and how opaque is the ring there.
 * - **Night lights.** City lights (NASA Black Marble) shine only on the night side, fading through
 *   twilight.
 * - **Ocean glint.** Water is smooth and land is rough, so the Sun's reflection shows as a bright
 *   glint on the oceans only. The water mask is read from the day map itself (sea pixels are the
 *   blue ones).
 *
 * Shadows touch only the star's direct light, not the faint ambient fill.
 */

export interface ShadowUniforms {
  uStar: { value: THREE.Vector3 };
  uCenter: { value: THREE.Vector3 };
  uRadius: { value: number };
  uRingNormal: { value: THREE.Vector3 };
  uRingInner: { value: number };
  uRingOuter: { value: number };
  uRingTex: { value: THREE.Texture | null };
  uNight: { value: number };
}

export function shadowUniforms(): ShadowUniforms {
  return {
    uStar: { value: new THREE.Vector3() },
    uCenter: { value: new THREE.Vector3() },
    uRadius: { value: 1 },
    uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
    uRingInner: { value: 1.2 },
    uRingOuter: { value: 2.3 },
    uRingTex: { value: null },
    uNight: { value: 0 },
  };
}

const VERTEX_DECL = /* glsl */ `
varying vec3 vWorldPl;
`;
const VERTEX_BODY = /* glsl */ `
vWorldPl = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

/**
 * On the planet: the rings' shadow (if `rings`) and city lights on the night side (if the
 * material has an emissive map).
 */
export function hookPlanet(material: THREE.MeshStandardMaterial, u: ShadowUniforms, opts: { rings: boolean; nightLights: boolean }): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_DECL}`).replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
    let frag = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying vec3 vWorldPl;
      uniform vec3 uStar, uCenter, uRingNormal;
      uniform float uRadius, uRingInner, uRingOuter, uNight;
      uniform sampler2D uRingTex;`,
    );
    const toStar = 'normalize(uStar - vWorldPl)';
    if (opts.rings) {
      frag = frag.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 L = ${toStar};
          float den = dot(L, uRingNormal);
          float ringShadow = 1.0;
          if (abs(den) > 1e-4) {
            float t = dot(uCenter - vWorldPl, uRingNormal) / den;
            if (t > 0.0) {
              float r = length(vWorldPl + L * t - uCenter) / uRadius;
              if (r > uRingInner && r < uRingOuter) {
                // The ring texture is radial: read its opacity along the x axis.
                float a = texture2D(uRingTex, vec2(0.5 + 0.5 * r / uRingOuter, 0.5)).a;
                ringShadow = 1.0 - 0.9 * a;
              }
            }
          }
          reflectedLight.directDiffuse *= ringShadow;
          reflectedLight.directSpecular *= ringShadow;
        }`,
      );
    }
    if (opts.nightLights) {
      frag = frag.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 Nw = normalize(vWorldPl - uCenter);
          float sunUp = dot(Nw, ${toStar});
          // Black Marble also shows moonlit land in blue: keep only the warm city lights.
          #ifdef USE_EMISSIVEMAP
            vec3 nl = emissiveColor.rgb;
            float city = max(0.0, nl.r - nl.b * 0.85);
            totalEmissiveRadiance = emissive * vec3(1.0, 0.8, 0.5) * min(1.0, city * 7.0);
          #endif
          totalEmissiveRadiance *= (1.0 - smoothstep(-0.12, 0.08, sunUp)) * uNight;
        }`,
      );
    }
    shader.fragmentShader = frag;
  };
  material.customProgramCacheKey = () => `planet-${opts.rings}-${opts.nightLights}`;
  material.needsUpdate = true;
}

/** On the rings: the planet's shadow. */
export function hookRings(material: THREE.MeshStandardMaterial, u: ShadowUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_DECL}`).replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldPl;
        uniform vec3 uStar, uCenter;
        uniform float uRadius;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          // Does the ray to the star pass through the planet? A soft edge for the penumbra.
          vec3 L = normalize(uStar - vWorldPl);
          vec3 oc = uCenter - vWorldPl;
          float along = dot(oc, L);
          float miss = length(oc - L * along) / uRadius;
          float shadow = along > 0.0 ? smoothstep(0.97, 1.03, miss) : 1.0;
          reflectedLight.directDiffuse *= shadow;
          reflectedLight.directSpecular *= shadow;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'rings-shadowed';
  material.needsUpdate = true;
}

/**
 * Roughness for an Earth-like day map: smooth where the map is sea-blue, rough elsewhere, so the
 * star's reflection glints off the oceans. Built once the image has loaded.
 */
export function oceanRoughness(day: THREE.Texture, onReady: (tex: THREE.Texture) => void): void {
  const build = () => {
    const img = day.image as HTMLImageElement | undefined;
    if (!img?.width) return false;
    const w = 1024, h = 512;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      // Sea: blue clearly above red, and not bright (ice and cloud are bright and grey).
      const sea = b > r + 18 && b > g - 6 && r + g + b < 420;
      const v = sea ? 70 : 235;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    onReady(tex);
    return true;
  };
  if (!build()) {
    const timer = setInterval(() => {
      if (build()) clearInterval(timer);
    }, 300);
    setTimeout(() => clearInterval(timer), 20000);
  }
}
