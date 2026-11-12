import * as THREE from 'three';
import type { BodyKind } from '../sim/body';
import type { Climate } from '../sim/climate';
import { mulberry32 } from '../procgen/rng';
import { Noise3D } from './noise';

export interface PlanetLook {
  kind: BodyKind;
  color: number;
  seed: number;
  climate: Climate;
  /** Earth masses. */
  earthMasses: number;
  /** Always give a gas giant rings (e.g. Saturn). */
  rings?: boolean;
}

export interface PlanetTextures {
  map: THREE.Texture;
  /** Glowing lava for molten worlds. */
  emissive?: THREE.Texture;
  clouds?: THREE.Texture;
  /** Atmosphere rim colour, if the world has a visible atmosphere. */
  atmosphere?: number;
  /** Ring texture (for gas giants that have rings). */
  rings?: THREE.Texture;
}

type RGB = [number, number, number];

function hexToRgb(hex: number): RGB {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function shade(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Paint an equirectangular texture by sampling a function on the unit sphere, so there
 * are no seams or pole pinching artefacts in the noise.
 */
function paint(width: number, sample: (x: number, y: number, z: number, lat: number) => RGB, alpha = false, alphaFn?: (x: number, y: number, z: number, lat: number) => number): THREE.CanvasTexture {
  const height = width / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  const d = img.data;
  for (let j = 0; j < height; j++) {
    const lat = (0.5 - (j + 0.5) / height) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < width; i++) {
      const lon = ((i + 0.5) / width) * Math.PI * 2;
      const x = cl * Math.cos(lon), y = sl, z = cl * Math.sin(lon);
      const c = sample(x, y, z, lat);
      const k = (j * width + i) * 4;
      d[k] = Math.min(255, c[0] * 255);
      d[k + 1] = Math.min(255, c[1] * 255);
      d[k + 2] = Math.min(255, c[2] * 255);
      d[k + 3] = alpha && alphaFn ? Math.min(255, Math.max(0, alphaFn(x, y, z, lat) * 255)) : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function rockyTextures(look: PlanetLook, width: number): PlanetTextures {
  const n = new Noise3D(look.seed);
  const n2 = new Noise3D(look.seed + 17);
  const rng = mulberry32(look.seed);
  const base = hexToRgb(look.color);
  const out: Partial<PlanetTextures> = {};

  // Small bodies can't hold an atmosphere or oceans, whatever their temperature.
  const climate = look.climate === 'temperate' && look.earthMasses < 0.1 ? 'barren' : look.climate;
  switch (climate) {
    case 'barren': {
      out.map = paint(width, (x, y, z) => {
        const h = n.fbm(x * 2.2, y * 2.2, z * 2.2, 5);
        return mix(shade(base, 0.6), shade(base, 1.1), h * 0.5 + 0.5);
      });
      break;
    }
    case 'temperate': {
      const seaLevel = -0.05 + rng() * 0.15;
      const deep: RGB = [0.04, 0.14, 0.36];
      const shallow: RGB = [0.1, 0.36, 0.6];
      const lowland: RGB = mix([0.18, 0.4, 0.16], base, 0.25);
      const highland: RGB = [0.42, 0.36, 0.26];
      const desert: RGB = [0.72, 0.62, 0.42];
      const ice: RGB = [0.92, 0.95, 1];
      out.map = paint(width, (x, y, z, lat) => {
        const h = n.fbm(x * 1.6, y * 1.6, z * 1.6, 6);
        const polar = Math.abs(lat) / (Math.PI / 2);
        if (polar + n2.noise(x * 4, y * 4, z * 4) * 0.08 > 0.84) return ice;
        if (h < seaLevel) return mix(deep, shallow, smoothstep(seaLevel - 0.25, seaLevel, h));
        const dry = smoothstep(0.1, 0.35, 0.35 - Math.abs(polar - 0.3) + n2.fbm(x * 3, y * 3, z * 3, 3) * 0.3);
        let c = mix(lowland, desert, dry);
        c = mix(c, highland, smoothstep(seaLevel + 0.12, seaLevel + 0.35, h));
        return mix(c, ice, smoothstep(0.42, 0.6, h));
      });
      out.clouds = makeClouds(look.seed + 3, width, 0.55);
      out.atmosphere = 0x6fb6ff;
      break;
    }
    case 'frozen':
    case 'cold': {
      const frozen = look.climate === 'frozen';
      const iceA: RGB = frozen ? [0.86, 0.9, 0.96] : mix(base, [0.85, 0.88, 0.92], 0.3);
      const iceB: RGB = frozen ? [0.62, 0.72, 0.84] : shade(base, 0.7);
      out.map = paint(width, (x, y, z, lat) => {
        const h = n.fbm(x * 2, y * 2, z * 2, 5);
        const cracks = n2.ridged(x * 3, y * 3, z * 3);
        let c = mix(iceB, iceA, h * 0.5 + 0.5);
        if (frozen) c = mix(c, [0.45, 0.55, 0.7], smoothstep(0.75, 0.95, cracks) * 0.6);
        const cap = smoothstep(0.65, 0.8, Math.abs(lat) / (Math.PI / 2));
        return mix(c, [0.95, 0.97, 1], cap);
      });
      if (look.earthMasses > 0.4) out.atmosphere = frozen ? 0xa8c8ff : 0x9fb0c8;
      break;
    }
    case 'hot': {
      const thick = look.earthMasses > 0.5 && rng() < 0.6;
      const sand: RGB = mix(base, [0.78, 0.55, 0.3], 0.5);
      out.map = paint(width, (x, y, z) => {
        const h = n.fbm(x * 2.2, y * 2.2, z * 2.2, 5);
        const crater = n2.ridged(x * 5, y * 5, z * 5);
        return shade(mix(shade(sand, 0.55), sand, h * 0.5 + 0.5), 0.85 + crater * 0.25);
      });
      if (thick) {
        out.clouds = makeClouds(look.seed + 5, width, 0.85, [0.95, 0.85, 0.6]);
        out.atmosphere = 0xffc070;
      }
      break;
    }
    case 'molten': {
      const crust: RGB = [0.12, 0.08, 0.07];
      out.map = paint(width, (x, y, z) => {
        const h = n.fbm(x * 2.5, y * 2.5, z * 2.5, 5);
        return mix(crust, [0.3, 0.18, 0.12], h * 0.5 + 0.5);
      });
      out.emissive = paint(width, (x, y, z) => {
        const r = n2.ridged(x * 2.5, y * 2.5, z * 2.5, 4);
        const glow = smoothstep(0.55, 0.85, r);
        return [glow * 1.0, glow * 0.38, glow * 0.06];
      });
      out.atmosphere = 0xff7a3a;
      break;
    }
  }

  // Airless small worlds: craters on top.
  if (!out.atmosphere && look.climate !== 'molten') {
    const cr = new Noise3D(look.seed + 99);
    const old = out.map as THREE.CanvasTexture;
    const ctx = (old.image as HTMLCanvasElement).getContext('2d')!;
    const w = old.image.width, h = old.image.height;
    const img = ctx.getImageData(0, 0, w, h);
    for (let j = 0; j < h; j++) {
      const lat = (0.5 - (j + 0.5) / h) * Math.PI;
      for (let i = 0; i < w; i++) {
        const lon = ((i + 0.5) / w) * Math.PI * 2;
        const x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon);
        const c = cr.ridged(x * 6, y * 6, z * 6, 3);
        const f = 0.8 + smoothstep(0.6, 0.9, c) * 0.35 - smoothstep(0.85, 1, c) * 0.3;
        const k = (j * w + i) * 4;
        img.data[k] *= f;
        img.data[k + 1] *= f;
        img.data[k + 2] *= f;
      }
    }
    ctx.putImageData(img, 0, 0);
    old.needsUpdate = true;
  }
  return out as PlanetTextures;
}

function makeClouds(seed: number, width: number, cover: number, tint: RGB = [1, 1, 1]): THREE.CanvasTexture {
  const n = new Noise3D(seed);
  return paint(
    width,
    () => tint,
    true,
    (x, y, z, lat) => {
      // Stretch noise along longitude for banded weather.
      const v = n.fbm(x * 2.5, y * 5, z * 2.5, 5) * 0.5 + 0.5;
      const band = 1 - Math.abs(Math.sin(lat * 3)) * 0.15;
      return smoothstep(1 - cover, 1 - cover + 0.25, v * band) * 0.9;
    },
  );
}

function gasTextures(look: PlanetLook, width: number): PlanetTextures {
  const n = new Noise3D(look.seed);
  const rng = mulberry32(look.seed);
  const base = hexToRgb(look.color);
  const iceGiant = base[2] > base[0];
  const bandCount = iceGiant ? 4 + rng() * 4 : 12 + rng() * 12;
  const contrast = iceGiant ? 0.14 : 0.45;
  const palette: RGB[] = Array.from({ length: 5 }, () => {
    const f = 1 + (rng() - 0.5) * contrast * 2;
    const hueShift = (rng() - 0.5) * 0.12;
    return [base[0] * f + hueShift, base[1] * f, base[2] * f - hueShift] as RGB;
  });
  // A few storms.
  const storms = Array.from({ length: Math.floor(rng() * 3) }, () => ({
    lat: (rng() - 0.5) * 1.4,
    lon: rng() * Math.PI * 2,
    size: 0.035 + rng() * 0.05,
    color: rng() < 0.5 ? ([0.85, 0.45, 0.3] as RGB) : ([0.95, 0.93, 0.88] as RGB),
  }));
  const out: PlanetTextures = {
    map: paint(width, (x, y, z, lat) => {
      const warp = n.fbm(x * 4, y * 4, z * 4, 4) * 0.12;
      const t = (lat / Math.PI + 0.5) * bandCount + warp * 2;
      const idx = Math.floor(t);
      const f = t - idx;
      const a = palette[((idx % 5) + 5) % 5];
      const b = palette[(((idx + 1) % 5) + 5) % 5];
      let c = mix(a, b, smoothstep(0.35, 0.65, f));
      // Fine stripes and turbulence within each band.
      c = shade(c, 0.9 + 0.06 * Math.sin(t * Math.PI * 3.3) + n.noise(x * 12, y * 30, z * 12) * 0.08);
      const lon = Math.atan2(z, x);
      for (const s of storms) {
        const dl = Math.atan2(Math.sin(lon - s.lon), Math.cos(lon - s.lon));
        const d = Math.hypot(dl * 0.6, lat - s.lat) / s.size;
        if (d < 1) c = mix(c, s.color, (1 - d * d) * 0.85);
      }
      return c;
    }),
    atmosphere: iceGiant ? 0x8fd0ff : 0xffe2b0,
  };
  if (rng() < 0.4 || look.rings) out.rings = ringTexture(look.seed, base);
  return out;
}

/**
 * Saturn's real rings on a square texture for a RingGeometry from `inner` to `outer` km: each
 * radius as dense as its ring's optical depth (opacity 1 − e^(−τ/cos), seen at a slant) and as
 * bright as its albedo, the named gaps clear (IAU/USGS). A faint fine ripple stands in for the
 * thousands of ringlets too narrow to list.
 */
export function realRingTexture(rings: { inner: number; outer: number; tau?: number; albedo?: number; name: string }[], gaps: { inner: number; outer: number }[], inner: number, outer: number): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const rng = mulberry32(1257);
  // Tints: the C ring and Cassini Division greyer, the B ring creamy, the A ring a little cooler.
  const tint: Record<string, [number, number, number]> = {
    'C ring': [0.78, 0.74, 0.68],
    'B ring': [1.0, 0.92, 0.78],
    'Cassini Division': [0.7, 0.68, 0.64],
    'A ring': [0.94, 0.9, 0.82],
    'F ring': [0.95, 0.93, 0.9],
  };
  for (let px = c * (inner / outer); px < c; px += 0.5) {
    const km = (px / c) * outer;
    const ring = rings.find((g) => km >= g.inner && km <= g.outer);
    if (!ring || gaps.some((g) => km >= g.inner && km <= g.outer)) continue;
    const ripple = 0.8 + 0.4 * rng();
    const alpha = Math.min(0.95, (1 - Math.exp(-(ring.tau ?? 0.1) * 2.2)) * ripple);
    const [r, g, b] = tint[ring.name] ?? [0.9, 0.88, 0.84];
    const k = (0.55 + 0.9 * (ring.albedo ?? 0.4)) * 255;
    ctx.strokeStyle = `rgba(${Math.round(Math.min(255, r * k))},${Math.round(Math.min(255, g * k))},${Math.round(Math.min(255, b * k))},${alpha.toFixed(3)})`;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.arc(c, c, px, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Concentric ring bands drawn on a square texture (RingGeometry has planar UVs). */
function ringTexture(seed: number, base: RGB): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(seed + 7);
  const c = size / 2;
  const inner = c * (1.35 / 2.5);
  for (let r = inner; r < c; r += 1) {
    const t = (r - inner) / (c - inner);
    const gap = rng() < 0.06;
    const alpha = gap ? 0.05 : (0.25 + rng() * 0.55) * Math.sin(Math.PI * Math.min(1, t * 1.05));
    const tone = 0.75 + rng() * 0.35;
    ctx.strokeStyle = `rgba(${Math.round(Math.min(255, (base[0] * 0.5 + 0.5) * tone * 255))},${Math.round(
      Math.min(255, (base[1] * 0.5 + 0.45) * tone * 255),
    )},${Math.round(Math.min(255, (base[2] * 0.5 + 0.4) * tone * 255))},${alpha.toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makePlanetTextures(look: PlanetLook, width: number): PlanetTextures {
  return look.kind === 'gas' ? gasTextures(look, width) : rockyTextures(look, width);
}

/** Stable seed from a body's name so a planet always looks the same. */
export function seedFromName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}
