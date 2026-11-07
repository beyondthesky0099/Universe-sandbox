import * as THREE from 'three';

/**
 * Auroras: curtains of light around a planet's magnetic poles, where charged particles from the
 * stellar wind (or, for Jupiter, from Io's plasma) rain down the magnetic field and make the
 * upper atmosphere glow.
 *
 * Each aurora is a ring (one per hemisphere) around the magnetic axis, which is tilted from the
 * spin axis and turns with the planet. The ring sits at the auroral oval's colatitude and spans
 * the altitudes where the light is emitted; rays and folds drift along it. For solar-wind-driven
 * auroras (Earth, Saturn) the oval is pushed towards the night side, as observed. The light is
 * drawn faint on the day side, where sunlight swamps it.
 *
 * Data:
 * - **Earth:** dipole tilt 9.4° (IGRF-14, 2025). The oval runs at ~67° magnetic latitude at night
 *   and ~77° by day. Its light comes from oxygen (green 557.7 nm at 100–150 km, red 630.0 nm
 *   above ~200 km) and from N₂⁺ (violet-blue 427.8 nm at the lower edge in strong storms).
 * - **Jupiter:** tilt 10.3° (Juno JRM09). The main oval is at ~16° from the magnetic pole,
 *   fixed by corotation and not by the solar wind. It glows 250–700 km above the clouds.
 * - **Saturn:** tilt under 0.01° (Cassini). The oval is at ~15° from the pole, about 1,100 km up.
 * - **Uranus:** tilt 59°. **Neptune:** tilt 47° (Voyager 2).
 * The giants' auroras shine mainly in ultraviolet (H₂) and infrared (H₃⁺). They are drawn in
 * false colour (violet, pink), as the Hubble and JWST pictures show them.
 *
 * Brightness follows how hard the stellar wind blows: it scales with (d₀ / d)², where d₀ is the
 * planet's starting distance from its star. Move a planet inwards and its auroras brighten and
 * the oval widens towards the equator, as in a geomagnetic storm.
 */
export interface Aurora {
  /** Angle between the magnetic and spin axes (degrees). */
  tilt: number;
  /** Mean colatitude of the oval from the magnetic pole (degrees). */
  colatitude: number;
  /** How far the oval shifts to the night side (degrees; 0 for corotation-driven ovals). */
  nightShift: number;
  /** Width of the oval (degrees of colatitude) across which the curtains are spread. */
  width: number;
  /** Bottom and top of the emitting layer, as fractions of the planet's radius. */
  bottom: number;
  top: number;
  /** Up to three emission layers: colour, height in the band (0 bottom … 1 top), width, relative brightness. */
  layers: { color: number; at: number; width: number; weight: number }[];
  /** Overall brightness. */
  brightness: number;
  /** Drawn in false colour (seen in ultraviolet or infrared). */
  falseColour?: boolean;
}

const KM = (km: number, radiusKm: number) => km / radiusKm;

export const AURORAS: Record<string, Aurora> = {
  Earth: {
    tilt: 9.4,
    colatitude: 18,
    nightShift: 5,
    width: 4,
    bottom: KM(95, 6371),
    top: KM(320, 6371),
    layers: [
      { color: 0x5cff8a, at: 0.12, width: 0.14, weight: 1.6 }, // O 557.7 nm, the brightest
      { color: 0xff3c50, at: 0.6, width: 0.3, weight: 0.3 }, // O 630.0 nm, faint and high
      { color: 0x7a5cff, at: 0.0, width: 0.03, weight: 0.6 }, // N₂⁺ 427.8 nm
    ],
    brightness: 1,
  },
  Jupiter: {
    tilt: 10.3,
    colatitude: 16,
    nightShift: 0,
    width: 1.5,
    bottom: KM(250, 69911),
    top: KM(1400, 69911),
    layers: [
      { color: 0xb070ff, at: 0.15, width: 0.25, weight: 1 },
      { color: 0xff70c8, at: 0.6, width: 0.4, weight: 1 },
    ],
    brightness: 1.2,
    falseColour: true,
  },
  Saturn: {
    tilt: 0.01,
    colatitude: 15,
    nightShift: 2,
    width: 2.5,
    bottom: KM(800, 58232),
    top: KM(1800, 58232),
    layers: [
      { color: 0xa070ff, at: 0.25, width: 0.3, weight: 1 },
      { color: 0xff6aa0, at: 0.7, width: 0.35, weight: 1 },
    ],
    brightness: 0.9,
    falseColour: true,
  },
  Uranus: {
    tilt: 59,
    colatitude: 20,
    nightShift: 0,
    width: 4,
    bottom: KM(300, 25362),
    top: KM(1100, 25362),
    layers: [{ color: 0xb48cff, at: 0.3, width: 0.4, weight: 1 }],
    brightness: 0.6,
    falseColour: true,
  },
  Neptune: {
    tilt: 47,
    colatitude: 20,
    nightShift: 0,
    width: 4,
    bottom: KM(300, 24622),
    top: KM(1100, 24622),
    layers: [{ color: 0xb48cff, at: 0.3, width: 0.4, weight: 1 }],
    brightness: 0.5,
    falseColour: true,
  },
};

/**
 * The aurora for a body:
 * - Named bodies use the table. Real bodies missing from it get none: Venus, Mars and the
 *   Moon have no global magnetic field, and Mercury has almost no air.
 * - Procedural gas giants get a Jupiter-like aurora.
 * - Procedural rocky worlds with air of 0.3 Earth masses or more get an Earth-like one, since
 *   they are big enough to keep a molten, convecting core. This is a model.
 * `seed` tilts the magnetic axis of procedural worlds.
 */
export function auroraFor(name: string, isReal: boolean, kind: string, hasAir: boolean, earthMasses: number, seed: number): Aurora | undefined {
  if (AURORAS[name]) return AURORAS[name];
  if (isReal) return undefined;
  const tilt = 4 + (seed % 1000) / 1000 * 20;
  if (kind === 'gas') return { ...AURORAS.Jupiter, tilt };
  if (kind === 'rocky' && hasAir && earthMasses >= 0.3) return { ...AURORAS.Earth, tilt };
  return undefined;
}

/**
 * Stellar-wind driving: (d₀/d)², capped between 0.05 and 6. Then a slow "substorm" flicker:
 * Earth's substorms recur every 2–4 hours and these come round every few seconds on screen.
 */
export function auroraActivity(d0: number, d: number, seconds: number): number {
  const wind = Math.min(6, Math.max(0.05, (d0 / Math.max(d, 1e-9)) ** 2));
  const substorm = 0.75 + 0.25 * Math.sin(seconds * 0.21) * Math.sin(seconds * 0.067 + 1.3) + 0.2 * Math.max(0, Math.sin(seconds * 0.13));
  return wind * substorm;
}

/** Colatitude of the oval (degrees) at a given activity: wider (further from the pole) in storms. */
export function ovalColatitude(a: Aurora, activity: number): number {
  return Math.min(45, a.colatitude * (1 + 0.18 * Math.log(Math.max(activity, 0.05))));
}

const SEGMENTS = 360;
/** Curtains side by side across the oval's width, per hemisphere. */
const CURTAINS = 7;

/**
 * Open bands (curtains) round both poles plus a flat ribbon of diffuse glow under them, with
 * attributes phi (0…2π), v (0 bottom … 1 top), w (across the oval, −1…1 for the curtains),
 * hemi (±1) and ribbon (1 for the flat glow).
 */
function ringGeometry(): THREE.BufferGeometry {
  const phi: number[] = [];
  const v: number[] = [];
  const w: number[] = [];
  const hemi: number[] = [];
  const ribbon: number[] = [];
  const index: number[] = [];
  let base = 0;
  for (let h = 0; h < 2; h++) {
    // The curtains, then one flat ribbon of diffuse glow beneath them (c = CURTAINS).
    for (let c = 0; c <= CURTAINS; c++) {
      const flat = c === CURTAINS;
      for (let i = 0; i <= SEGMENTS; i++) {
        for (let k = 0; k < 2; k++) {
          phi.push((i / SEGMENTS) * Math.PI * 2);
          v.push(flat ? 0.15 : k);
          w.push(flat ? (k * 2 - 1) * 1.8 : (c / (CURTAINS - 1)) * 2 - 1);
          hemi.push(h === 0 ? 1 : -1);
          ribbon.push(flat ? 1 : 0);
        }
        if (i < SEGMENTS) {
          const a = base + i * 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      base += (SEGMENTS + 1) * 2;
    }
  }
  const geo = new THREE.BufferGeometry();
  // Positions are made in the shader; this attribute only sizes the draw.
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(phi.length * 3), 3));
  geo.setAttribute('phi', new THREE.Float32BufferAttribute(phi, 1));
  geo.setAttribute('v', new THREE.Float32BufferAttribute(v, 1));
  geo.setAttribute('w', new THREE.Float32BufferAttribute(w, 1));
  geo.setAttribute('hemi', new THREE.Float32BufferAttribute(hemi, 1));
  geo.setAttribute('ribbon', new THREE.Float32BufferAttribute(ribbon, 1));
  geo.setIndex(index);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
  return geo;
}

const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float phi;
  attribute float v;
  attribute float w;
  attribute float hemi;
  attribute float ribbon;
  uniform vec3 uAxis;       // magnetic north, planet frame
  uniform vec3 uSun;        // direction to the star, planet frame
  uniform float uColat;     // radians
  uniform float uShift;     // radians, towards the night side
  uniform float uWidth;     // radians across the oval
  uniform float uBottom;
  uniform float uTop;
  uniform float uTime;
  varying float vV;
  varying float vPhi;
  varying float vNight;
  varying float vW;
  varying float vPath;
  varying float vRibbon;
  float vhash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
  float vnoise(float x) {
    float i = floor(x), f = fract(x);
    return mix(vhash(i), vhash(i + 1.0), f * f * (3.0 - 2.0 * f));
  }
  void main() {
    vec3 n = normalize(uAxis) * hemi;
    vec3 e1 = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(n, e1);
    vec3 around = cos(phi) * e1 + sin(phi) * e2;
    // Away from the star in the magnetic "horizontal" plane: the oval bulges that way.
    vec3 anti = -(uSun - dot(uSun, n) * n);
    float al = length(anti);
    float night = al > 1e-4 ? dot(around, anti / al) : 0.0;
    // Folds that wander slowly along the oval.
    float fold = 0.022 * sin(3.0 * phi + uTime * 0.11) * sin(7.0 * phi - uTime * 0.07 + hemi);
    // Each arc wanders on its own, so they merge, split and cross.
    float wander = ribbon > 0.5 ? 0.0 : (vnoise(phi * 8.0 + w * 13.0 + uTime * 0.03) - 0.5) * 0.7;
    float colat = uColat + uShift * night + fold + 0.5 * uWidth * (w + wander);
    vec3 dir = cos(colat) * n + sin(colat) * around;
    float r = 1.0 + mix(uBottom, uTop, v);
    // The curtains are optically thin: seen edge-on (from above) the light adds up along their
    // height, so they look brighter. Path length ∝ 1 / |cos| of the angle to the curtain's normal.
    // (For the flat glow, the normal is straight up.)
    vec3 normal = ribbon > 0.5 ? dir : -sin(colat) * n + cos(colat) * around;
    vec3 camLocal = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    vec3 view = normalize(camLocal - dir * r);
    vPath = min(6.0, 1.0 / max(abs(dot(view, normal)), 0.03));
    vW = w;
    vV = v;
    vRibbon = ribbon;
    vPhi = phi;
    vNight = dot(dir, uSun);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(dir * r, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColors[3];
  uniform vec3 uLayers[3];  // (height in band, width, weight)
  uniform float uBrightness;
  uniform float uDayFloor;  // how much shows on the day side
  uniform float uTime;
  varying float vV;
  varying float vPhi;
  varying float vNight;
  varying float vW;
  varying float vPath;
  varying float vRibbon;
  float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
  float noise(float x) {
    float i = floor(x), f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), u);
  }
  void main() {
    #include <logdepthbuf_fragment>
    // Rays: fine streaks along the oval that drift and flicker, over broader patches.
    float x = vPhi * 60.0;
    float lane = vW * 17.0;
    float rays = 0.35 + 0.65 * pow(noise(x * 3.0 + lane + uTime * 0.4), 2.0);
    float patches = smoothstep(0.25, 0.75, noise(vPhi * 9.0 + lane * 0.3 - uTime * 0.05));
    // The middle of the oval is brightest.
    float across = 1.0 - 0.6 * vW * vW;
    float glow = rays * (0.25 + 0.75 * patches) * across * vPath;
    // A sharp lower edge and a soft top.
    float shape = smoothstep(0.0, 0.06, vV) * (1.0 - smoothstep(0.55, 1.0, vV));
    if (vRibbon > 0.5) {
      // Diffuse glow: smooth across the oval, patchy along it.
      glow = (0.3 + 0.7 * patches) * exp(-vW * vW * 1.2) * 0.35 * vPath;
      shape = 1.0;
    }
    vec3 col = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float d = (vV - uLayers[i].x) / max(uLayers[i].y, 1e-3);
      col += uColors[i] * uLayers[i].z * exp(-d * d);
    }
    // Sunlight swamps visible aurora on the day side.
    float dark = mix(uDayFloor, 1.0, 1.0 - smoothstep(-0.2, 0.15, vNight));
    gl_FragColor = vec4(col * glow * shape * dark * uBrightness, 1.0);
  }
`;

let sharedGeometry: THREE.BufferGeometry | undefined;

/** The aurora mesh for a planet (child of its unit-sphere mesh, so it spins with it). */
export function auroraMesh(a: Aurora): THREE.Mesh {
  sharedGeometry ??= ringGeometry();
  const colors = [0, 1, 2].map((i) => new THREE.Color(a.layers[i]?.color ?? 0));
  const layers = [0, 1, 2].map((i) => {
    const l = a.layers[i];
    return l ? new THREE.Vector3(l.at, l.width, l.weight) : new THREE.Vector3(0, 1, 0);
  });
  const t = THREE.MathUtils.degToRad(a.tilt);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uAxis: { value: new THREE.Vector3(Math.sin(t), Math.cos(t), 0) },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uColat: { value: THREE.MathUtils.degToRad(a.colatitude) },
      uShift: { value: THREE.MathUtils.degToRad(a.nightShift) },
      uWidth: { value: THREE.MathUtils.degToRad(a.width) },
      uBottom: { value: a.bottom },
      uTop: { value: Math.max(a.top, a.bottom + 0.008) },
      uTime: { value: 0 },
      uColors: { value: colors },
      uLayers: { value: layers },
      uBrightness: { value: a.brightness },
      // Ultraviolet and infrared auroras aren't drowned by reflected sunlight.
      uDayFloor: { value: a.falseColour ? 0.7 : 0.12 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(sharedGeometry, material);
  mesh.renderOrder = 2;
  mesh.userData.aurora = a;
  return mesh;
}

/** Per frame: the star's direction (planet frame), the activity and the time. */
export function updateAurora(mesh: THREE.Mesh, sunLocal: THREE.Vector3, activity: number, seconds: number): void {
  const a = mesh.userData.aurora as Aurora;
  const u = (mesh.material as THREE.ShaderMaterial).uniforms;
  u.uSun.value.copy(sunLocal);
  u.uTime.value = seconds;
  u.uColat.value = THREE.MathUtils.degToRad(ovalColatitude(a, activity));
  u.uBrightness.value = a.brightness * Math.min(2.5, Math.sqrt(activity));
}
