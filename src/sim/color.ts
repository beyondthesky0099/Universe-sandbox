/** Approximate main-sequence surface temperature (K) for a star of the given mass (M☉). */
export function starTemperature(mass: number): number {
  return Math.min(40000, Math.max(2600, 5778 * Math.pow(mass, 0.5)));
}

/** Convert a blackbody temperature (K) to an RGB triple in [0, 1]. Tanner Helland's approximation. */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return [c(r), c(g), c(b)];
}

export function rgbToHex([r, g, b]: [number, number, number]): number {
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

export function starColor(mass: number): number {
  return rgbToHex(kelvinToRgb(starTemperature(mass)));
}

export const ROCKY_PALETTE = [0x8a8f99, 0xa0785a, 0xc1440e, 0x6b7f5e, 0x4f6d8f, 0xb8a58c, 0x7d6e63];
export const GAS_PALETTE = [0xd8b48a, 0xc99e6b, 0xe3d2a8, 0x6fa8c9, 0x4b70dd, 0xb07c5a, 0x9fc5b8];
