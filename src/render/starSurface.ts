import * as THREE from 'three';
import { kelvinToRgb } from '../sim/color';

/**
 * Star surfaces as telescopes see them.
 *
 * - **Granulation.** Stars with convective surfaces (cooler than ~7,000 K) are tiled with bright
 *   rising cells and dark sinking lanes between them; the Sun's are ~1,000 km across and live a
 *   few minutes. Over them lies the larger supergranulation. Red supergiants like Betelgeuse
 *   have only a handful of giant cells (Schwarzschild 1975; Chiavassa et al. 2010). Hotter stars
 *   and white dwarfs have radiative surfaces and look smooth.
 * - **Limb darkening.** Towards the edge we see higher, cooler gas, so the disc darkens and
 *   reddens there: about 40% of the centre's brightness at the Sun's limb in green light, more
 *   in blue, less in red (Neckel & Labs 1994). Weaker for hot stars, stronger for giants.
 * - **Sunspots and faculae** on Sun-like stars: dark umbrae with grey filamentary penumbrae, in
 *   belts 5–35° from the equator, and bright faculae around them, most visible near the limb.
 * - **Corona:** faint streamers around the disc (corona.ts-like billboard below).
 *
 * The surface is drawn bright but not saturated, so its texture shows through the tone mapping;
 * the glow sprite around it gives the dazzle.
 */

export type StarType = 'sunlike' | 'cool' | 'hot' | 'giant' | 'whitedwarf';

export interface StarLook {
  type: StarType;
  temperature: number;
  /** Granules across the visible disc at full detail. */
  cells: number;
  /** Granulation contrast (0 = smooth). */
  contrast: number;
  /** Linear limb-darkening coefficients for red, green, blue. */
  limb: [number, number, number];
  /** Number of sunspots. */
  spots: number;
}

/** What a star's surface looks like, from its kind, mass-derived temperature and name. */
export function starLook(kind: 'star' | 'giant' | 'whitedwarf', temperature: number, name = ''): StarLook {
  if (kind === 'whitedwarf') return { type: 'whitedwarf', temperature, cells: 0, contrast: 0, limb: [0.35, 0.4, 0.45], spots: 0 };
  if (kind === 'giant') return { type: 'giant', temperature, cells: 7, contrast: 0.55, limb: [0.62, 0.75, 0.85], spots: 0 };
  if (temperature > 7500) return { type: 'hot', temperature, cells: 0, contrast: 0, limb: [0.28, 0.32, 0.36], spots: 0 };
  if (temperature < 4000) return { type: 'cool', temperature, cells: 90, contrast: 0.22, limb: [0.55, 0.68, 0.8], spots: 2 };
  const sun = name === 'Sun';
  return { type: 'sunlike', temperature, cells: 140, contrast: 0.2, limb: [0.47, 0.6, 0.76], spots: sun ? 7 : 4 };
}

const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform vec3 uLimb;
  uniform float uCells;
  uniform float uContrast;
  uniform float uTime;
  uniform float uSeed;
  uniform float uPixels;     // the disc's radius on screen (pixels)
  uniform vec4 uSpots[8];    // direction (xyz, unit, star frame) and angular radius (w, radians)
  uniform int uSpotCount;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
  }
  // Voronoi: distance to the nearest and second-nearest moving feature point, and a random
  // number for the nearest cell (in z).
  vec3 voronoi(vec3 x, float t) {
    vec3 n = floor(x), f = fract(x);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int k = -1; k <= 1; k++)
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec3 g = vec3(float(i), float(j), float(k));
      vec3 o = hash3(n + g + uSeed);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      vec3 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = o.z + hash3(n + g).y; } else if (d < d2) { d2 = d; }
    }
    return vec3(sqrt(d1), sqrt(d2), fract(id));
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = hash3(i).x, b = hash3(i + vec3(1, 0, 0)).x, c = hash3(i + vec3(0, 1, 0)).x, d = hash3(i + vec3(1, 1, 0)).x;
    float e = hash3(i + vec3(0, 0, 1)).x, g = hash3(i + vec3(1, 0, 1)).x, h = hash3(i + vec3(0, 1, 1)).x, k = hash3(i + vec3(1, 1, 1)).x;
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vLocal);
    float mu = clamp(dot(normalize(vNormalW), normalize(cameraPosition - vPosW)), 0.0, 1.0);
    float brightness = 1.0;
    // Granulation, faded out where the cells would be smaller than a few pixels.
    if (uCells > 0.0) {
      float cellPx = uPixels * 2.0 / uCells;
      float detail = smoothstep(1.5, 5.0, cellPx);
      // Warp the lookup so the cells are irregular, not a honeycomb.
      vec3 q = n * uCells * 0.5;
      q += (vec3(vnoise(q * 0.35), vnoise(q * 0.35 + 7.1), vnoise(q * 0.35 + 3.7)) - 0.5) * 1.1;
      vec3 v = voronoi(q, uTime * 0.25);
      float lane = smoothstep(0.02, 0.14, v.y - v.x);            // narrow dark intergranular lanes
      float body = 1.0 - 0.45 * v.x * v.x;                       // hot gas rising in the middle
      float own = 0.82 + 0.3 * v.z;                              // each granule its own brightness
      float gran = mix(0.62, 1.0, lane) * body * own;
      // Supergranulation and larger patterns.
      float sup = vnoise(n * uCells * 0.08 + uSeed) * 0.5 + vnoise(n * uCells * 0.025 - uSeed) * 0.5;
      float g = mix(1.0, gran * (0.9 + 0.2 * sup), uContrast / 0.22 * detail);
      // Where the granules are too small, keep a hint of the larger pattern.
      brightness *= mix(1.0 - uContrast * 0.25 * (1.0 - sup), g, detail);
    }
    // Sunspots: umbra, filamentary penumbra; faculae around them, strongest near the limb.
    float facula = 0.0;
    for (int s = 0; s < 8; s++) {
      if (s >= uSpotCount) break;
      vec4 sp = uSpots[s];
      float ang = acos(clamp(dot(n, sp.xyz), -1.0, 1.0));
      float r = ang / sp.w;
      if (r < 6.0) {
        vec3 tang = normalize(n - sp.xyz * dot(n, sp.xyz) + 1e-5);
        float around = atan(dot(cross(sp.xyz, tang), n), dot(tang, normalize(cross(sp.xyz, vec3(0.0, 1.0, 0.0)) + 1e-5)));
        float fil = 0.75 + 0.25 * sin(around * 40.0 + vnoise(n * 300.0) * 6.0);
        float umbra = 1.0 - smoothstep(0.85, 1.05, r);
        float pen = 1.0 - smoothstep(1.9, 2.3, r);
        brightness *= mix(1.0, mix(0.72 * fil, 0.22, umbra), pen);
        facula = max(facula, (1.0 - smoothstep(2.3, 6.0, r)) * smoothstep(2.0, 2.6, r) * (0.6 + 0.4 * vnoise(n * 60.0 + float(s))));
      }
    }
    brightness *= 1.0 + facula * 0.35 * (1.0 - mu);
    // Limb darkening, separately per colour: the edge is darker and redder.
    vec3 limb = vec3(1.0) - uLimb * (1.0 - mu);
    // A little richer than the pale blackbody colour, as photographs show the Sun's disc.
    vec3 base = pow(uColor, vec3(2.6));
    vec3 col = base * brightness * limb * 1.08;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** A star's surface material; call `update` each frame. */
export class StarSurface {
  readonly material: THREE.ShaderMaterial;
  readonly look: StarLook;

  constructor(look: StarLook, seed: number) {
    this.look = look;
    const [r, g, b] = kelvinToRgb(look.temperature);
    const spots: THREE.Vector4[] = [];
    let s = (seed >>> 0) || 1;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 8; i++) {
      if (i < look.spots) {
        // Belts 5–35° north or south; spots come in groups.
        const lat = ((5 + rand() * 30) * Math.PI) / 180 * (rand() < 0.5 ? -1 : 1);
        const lon = rand() * Math.PI * 2;
        const size = (0.6 + rand() * 1.4) * (Math.PI / 180);
        spots.push(new THREE.Vector4(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon), size));
      } else spots.push(new THREE.Vector4(0, 1, 0, 0.0001));
    }
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uColor: { value: new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace) },
        uLimb: { value: new THREE.Vector3(...look.limb) },
        uCells: { value: look.cells },
        uContrast: { value: look.contrast },
        uTime: { value: 0 },
        uSeed: { value: (seed % 1000) * 0.137 },
        uPixels: { value: 10 },
        uSpots: { value: spots },
        uSpotCount: { value: look.spots },
      },
    });
  }

  /** Per frame: advance the granulation and tell the shader how big the disc is on screen. */
  update(dt: number, pixelRadius: number): void {
    this.material.uniforms.uTime.value += dt;
    this.material.uniforms.uPixels.value = pixelRadius;
  }

  dispose(): void {
    this.material.dispose();
  }
}

const CORONA_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uSeed;
  uniform float uOpacity;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i + uSeed), hash(i + 1.0 + uSeed), f); }
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p) * 4.0;            // in star radii (the quad spans ±4 radii)
    if (r < 0.98) discard;
    float a = atan(p.y, p.x);
    // Streamers: brighter, longer rays at a few angles; fine radial texture.
    float streams = 0.55 + 0.6 * pow(noise1(a * 3.0), 2.0) + 0.25 * noise1(a * 23.0);
    float k = pow(max(r - 0.95, 0.02), -2.2) * 0.06 * streams;
    k *= 1.0 - smoothstep(2.5, 4.0, r);
    gl_FragColor = vec4(uColor * k * uOpacity, 1.0);
  }
`;

/**
 * The corona: a camera-facing quad 8 star radii across with faint streamers, brightest at the
 * limb and falling off as r^−2.2 (roughly the K corona's brightness profile).
 */
export function coronaMesh(color: THREE.ColorRepresentation, seed: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: CORONA_FRAGMENT,
    uniforms: { uColor: { value: new THREE.Color(color) }, uSeed: { value: (seed % 997) * 0.31 }, uOpacity: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), mat);
  mesh.frustumCulled = false;
  return mesh;
}
