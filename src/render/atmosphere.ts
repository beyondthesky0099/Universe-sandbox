import * as THREE from 'three';

/**
 * Planetary atmospheres by single scattering, computed per pixel: sunlight enters the air, is
 * scattered towards the camera by molecules (Rayleigh, ∝ λ⁻⁴, so blue) and by haze or dust
 * (Mie, mostly forward), and is dimmed on the way in and out (e^(−optical depth)). This gives a
 * blue limb and sky on Earth, red-orange light along the day–night line (sunsets), a pale
 * butterscotch haze on Mars, a thick yellow-white veil on Venus and an orange smog on Titan.
 *
 * Coefficients are in m⁻¹ at sea level (red, green, blue ≈ 680, 550, 440 nm) with exponential
 * density scale heights:
 * - Earth: Rayleigh (5.8, 13.5, 33.1) × 10⁻⁶ m⁻¹, H = 8 km; aerosols 2 × 10⁻⁵ m⁻¹, H = 1.2 km,
 *   g = 0.76 (Bruneton & Neyret 2008, after Riley et al. 2004).
 * - Mars: ~0.6% of Earth's surface pressure of CO₂, whose molecules scatter ~2.4× more than
 *   air's, so ~1.6% of Earth's Rayleigh; the colour comes from suspended dust that absorbs blue
 *   (H ≈ 11 km, optical depth ~0.5; Smith & Lemmon 1999). Single dust grains scatter forwards
 *   (g ≈ 0.7, Tomasko et al. 1999); a lower g of 0.6 stands in for the multiple scattering
 *   that fills the whole Martian sky with butterscotch light.
 * - Venus: 92 bar of CO₂ under a sulphuric-acid cloud deck at 48–70 km: drawn as dense, bright,
 *   slightly yellow haze (H ≈ 15 km above the deck).
 * - Titan: 1.5 bar of N₂ (H ≈ 40 km, reaching ~600 km in a 2,575 km world) with orange tholin
 *   haze, and a bluish detached haze layer high up.
 * Real thicknesses are thin (Earth's air is 1.6% of its radius); it is drawn to the same
 * proportion, never thinner than 2% of the radius so it stays visible.
 */
export interface Atmosphere {
  /** Height of the drawn top of the atmosphere, and scale heights, in metres; planet radius in metres. */
  top: number;
  radius: number;
  rayleigh: [number, number, number];
  rayleighH: number;
  mie: [number, number, number];
  mieH: number;
  /** Mie phase asymmetry (0 isotropic, → 1 forward). */
  g: number;
  /** Absorption by haze/dust (extinction beyond scattering), per channel, × Mie density. */
  absorb: [number, number, number];
  /** Brightness of the sunlight for this world (relative; the shader tone-maps). */
  sun: number;
  /**
   * Exposure from the ground, inside the air (default 1). The eye adapts: the dusty Martian sky
   * gives far less single-scattered light than Earth's, yet looks bright to someone standing there.
   */
  groundExposure?: number;
}

const EARTH: Atmosphere = {
  top: 100e3, radius: 6371e3,
  rayleigh: [5.8e-6, 13.5e-6, 33.1e-6], rayleighH: 8e3,
  mie: [2e-5, 2e-5, 2e-5], mieH: 1.2e3, g: 0.76,
  absorb: [2e-6, 2e-6, 2e-6], sun: 15,
};

export const ATMOSPHERES: Record<string, Atmosphere> = {
  Earth: EARTH,
  Mars: {
    top: 80e3, radius: 3390e3,
    rayleigh: [0.09e-6, 0.21e-6, 0.53e-6], rayleighH: 11e3,
    mie: [2.4e-5, 1.8e-5, 1.25e-5], mieH: 11e3, g: 0.6,
    absorb: [0.2e-5, 0.6e-5, 1.25e-5], sun: 8, groundExposure: 4,
  },
  Venus: {
    top: 120e3, radius: 6052e3,
    rayleigh: [2.5e-5, 5.8e-5, 14e-5], rayleighH: 15e3,
    mie: [3e-4, 2.8e-4, 2.3e-4], mieH: 15e3, g: 0.7,
    absorb: [0, 0.1e-4, 0.6e-4], sun: 24,
  },
  Titan: {
    top: 600e3, radius: 2575e3,
    rayleigh: [0.6e-6, 1.4e-6, 3.4e-6], rayleighH: 40e3,
    mie: [9e-6, 5.5e-6, 2.5e-6], mieH: 40e3, g: 0.65,
    absorb: [0.2e-6, 1.5e-6, 4e-6], sun: 10,
  },
  // Gas and ice giants: thin limbs, coloured by methane absorbing red (Uranus, Neptune).
  // Jupiter's and Saturn's upper hazes absorb blue and ultraviolet (the "chromophores" that
  // tint them cream and gold), so their limbs warm rather than turning blue.
  Jupiter: { top: 1500e3, radius: 69911e3, rayleigh: [0.1e-6, 0.22e-6, 0.5e-6], rayleighH: 27e3, mie: [1.6e-6, 1.4e-6, 1.1e-6], mieH: 60e3, g: 0.6, absorb: [0, 0.08e-6, 0.5e-6], sun: 12 },
  Saturn: { top: 1500e3, radius: 58232e3, rayleigh: [0.1e-6, 0.22e-6, 0.5e-6], rayleighH: 59e3, mie: [1.5e-6, 1.3e-6, 0.9e-6], mieH: 80e3, g: 0.6, absorb: [0, 0.12e-6, 0.7e-6], sun: 12 },
  Uranus: { top: 1500e3, radius: 25362e3, rayleigh: [1.2e-6, 3e-6, 6e-6], rayleighH: 28e3, mie: [0.6e-6, 0.8e-6, 0.9e-6], mieH: 40e3, g: 0.5, absorb: [3e-6, 0.5e-6, 0], sun: 12 },
  Neptune: { top: 1500e3, radius: 24622e3, rayleigh: [1.2e-6, 3e-6, 7e-6], rayleighH: 20e3, mie: [0.6e-6, 0.8e-6, 1e-6], mieH: 40e3, g: 0.5, absorb: [3.5e-6, 0.5e-6, 0], sun: 12 },
};

/**
 * An atmosphere for a world without a named one, from its look (the rim colour the procedural
 * textures pick): Earth-like, thin and cold, Venus-like, molten, or a gas giant.
 */
export function atmosphereFor(name: string, rimColor: number | undefined, kind: string): Atmosphere | undefined {
  if (ATMOSPHERES[name]) return ATMOSPHERES[name];
  if (rimColor === undefined) return undefined;
  if (kind === 'gas') return rimColor === 0x8fd0ff ? ATMOSPHERES.Neptune : ATMOSPHERES.Jupiter;
  if (rimColor === 0x6fb6ff) return EARTH;
  if (rimColor === 0xffc070 || rimColor === 0xff7a3a) return ATMOSPHERES.Venus;
  // Thin and cold: a quarter of Earth's air.
  return { ...EARTH, rayleigh: EARTH.rayleigh.map((v) => v * 0.25) as [number, number, number], mie: [5e-6, 5e-6, 5e-6] };
}

/** Radius of the drawn top relative to the planet's: the real proportion, at least 2%. */
export function shellScale(a: Atmosphere): number {
  return 1 + Math.max(0.02, a.top / a.radius);
}

const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uShell;
  varying vec3 vPos;
  varying vec3 vCam;
  void main() {
    // Work in the planet's own frame, radius 1.
    vPos = position * uShell;
    vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz * uShell;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // The sandbox's depth buffer is logarithmic: depth must be written the same way.
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform float uShell;
  uniform vec3 uSun;       // direction to the sun, planet frame
  uniform vec3 uRayleigh;  // per planet radius
  uniform vec3 uMie;
  uniform vec3 uAbsorb;
  uniform float uHR;       // scale heights, planet radii
  uniform float uHM;
  uniform float uG;
  uniform float uSunPower;
  uniform float uExposure;
  uniform float uExaggerate; // scale heights stretched to fill the drawn shell when it is thicker than real
  varying vec3 vPos;
  varying vec3 vCam;

  const int VIEW = 14;
  const int LIGHT = 5;
  const float PI = 3.14159265;

  vec2 sphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float d = b * b - c;
    if (d < 0.0) return vec2(1e9, -1e9);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }

  vec2 density(vec3 p) {
    float h = max(length(p) - 1.0, 0.0);
    return vec2(exp(-h / uHR), exp(-h / uHM));
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 ro = vCam;
    vec3 rd = normalize(vPos - vCam);
    vec2 atm = sphere(ro, rd, uShell);
    // The ground just below the planet's radius, so a viewer standing in a hollow of the terrain (lander.ts)
    // is still above it.
    vec2 ground = sphere(ro, rd, 0.996);
    float t0 = max(atm.x, 0.0);
    float t1 = atm.y;
    if (ground.x > 0.0) t1 = min(t1, ground.x);
    if (t1 <= t0) discard;
    float ds = (t1 - t0) / float(VIEW);
    vec3 sumR = vec3(0.0), sumM = vec3(0.0);
    vec2 depthView = vec2(0.0);
    for (int i = 0; i < VIEW; i++) {
      vec3 p = ro + rd * (t0 + (float(i) + 0.5) * ds);
      vec2 d = density(p) * ds;
      depthView += d;
      // Optical depth towards the sun (skipped if the planet is in the way).
      vec2 toSun = sphere(p, uSun, uShell);
      vec2 blocked = sphere(p, uSun, 0.996);
      if (blocked.x > 0.0) continue;
      float ls = toSun.y / float(LIGHT);
      vec2 depthSun = vec2(0.0);
      for (int j = 0; j < LIGHT; j++) depthSun += density(p + uSun * (float(j) + 0.5) * ls) * ls;
      vec3 tau = uRayleigh * (depthView.x + depthSun.x) + (uMie * 1.1 + uAbsorb) * (depthView.y + depthSun.y);
      vec3 att = exp(-tau);
      sumR += d.x * att;
      sumM += d.y * att;
    }
    float mu = dot(rd, uSun);
    float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float g2 = uG * uG;
    float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * uG * mu, 1.5));
    vec3 light = uSunPower * (sumR * uRayleigh * phaseR + sumM * uMie * phaseM);
    // Tone map (soft exposure) so bright limbs don't clip.
    vec3 col = 1.0 - exp(-light * uExposure);
    // How much the air in front dims what lies behind (the planet's day side, the stars).
    vec3 trans = exp(-(uRayleigh * depthView.x + (uMie * 1.1 + uAbsorb) * depthView.y));
    float alpha = 1.0 - dot(trans, vec3(0.333));
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
  }
`;

/** The atmosphere's shader material for a planet (attach to a unit sphere scaled by shellScale). */
export function scatteringMaterial(a: Atmosphere): THREE.ShaderMaterial {
  const shell = shellScale(a);
  const R = a.radius;
  // When the drawn shell is thicker than the real air, stretch the scale heights to match.
  const stretch = (shell - 1) / (a.top / R);
  const per = (v: [number, number, number]) => new THREE.Vector3(v[0] * R, v[1] * R, v[2] * R).divideScalar(stretch);
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uShell: { value: shell },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uRayleigh: { value: per(a.rayleigh) },
      uMie: { value: per(a.mie) },
      uAbsorb: { value: per(a.absorb) },
      uHR: { value: (a.rayleighH / R) * stretch },
      uHM: { value: (a.mieH / R) * stretch },
      uG: { value: a.g },
      uSunPower: { value: a.sun },
      uExposure: { value: 1 },
      uExaggerate: { value: stretch },
    },
    transparent: true,
    depthWrite: false,
    // The near side from outside (so the planet doesn't hide it); the far side from inside the air.
    side: THREE.FrontSide,
    // Premultiplied-style: scattered light adds, the air dims what is behind it.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
  });
}

/** Draw the shell's near side from outside and its far side from within the air. */
export function insideAware(mesh: THREE.Mesh): void {
  const centre = new THREE.Vector3();
  const scale = new THREE.Vector3();
  mesh.onBeforeRender = (_r, _s, camera) => {
    centre.setFromMatrixPosition(mesh.matrixWorld);
    scale.setFromMatrixScale(mesh.matrixWorld);
    const inside = camera.position.distanceTo(centre) < scale.x;
    const m = mesh.material as THREE.ShaderMaterial;
    const side = inside ? THREE.BackSide : THREE.FrontSide;
    if (m.side !== side) m.side = side;
    m.uniforms.uExposure.value = inside ? (mesh.userData.groundExposure ?? 1) : 1;
  };
}

/** Points the atmosphere's sun at `sunWorld`, in the frame of `planet` (its mesh, which spins). */
export function aimSun(material: THREE.ShaderMaterial, planet: THREE.Object3D, sunWorld: THREE.Vector3): void {
  planet.updateMatrixWorld();
  const local = planet.worldToLocal(sunWorld.clone());
  material.uniforms.uSun.value.copy(local.normalize());
}
