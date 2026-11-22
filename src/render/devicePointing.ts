/**
 * Point the phone at the sky: turn a device's orientation (the W3C DeviceOrientation angles alpha,
 * beta, gamma, plus the screen's rotation) into the Sky view camera's orientation.
 *
 * Frames. The device's Earth frame has x east, y north, z up, and alpha = 0 when the top of the
 * phone (lying flat) points north, increasing anticlockwise seen from above. The Sky view's scene
 * has x east, y up, z south (north is −z), and a camera looks along its −z and has +y up. The
 * conversion is the standard one (Euler YXZ from beta, alpha, −gamma, then −90° about x so the
 * camera looks out of the back of the phone, then the screen's rotation about the view axis).
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;
const X_MINUS_90 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const qScreen = new THREE.Quaternion();

/** Camera orientation for the device angles (degrees) and screen rotation (degrees, 0/90/180/270). */
export function deviceQuaternion(alpha: number, beta: number, gamma: number, screenAngle = 0, out = new THREE.Quaternion()): THREE.Quaternion {
  euler.set(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ');
  out.setFromEuler(euler);
  out.multiply(X_MINUS_90);
  out.multiply(qScreen.setFromAxisAngle(Z_AXIS, -screenAngle * DEG));
  return out;
}

/** Where a camera with this orientation looks: altitude and azimuth (degrees, from north through east). */
export function lookOf(q: THREE.Quaternion): { alt: number; az: number } {
  const d = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const alt = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / DEG;
  // East is +x, north is −z.
  const az = ((Math.atan2(d.x, -d.z) / DEG) % 360 + 360) % 360;
  return { alt, az };
}

/**
 * The true-north alpha from a reading: an absolute event's alpha as it is; on iOS, the compass
 * heading (clockwise from north) as an anticlockwise angle. Undefined when the device gives only a
 * relative alpha.
 */
export function trueAlpha(e: { alpha: number | null; absolute?: boolean; webkitCompassHeading?: number }, absoluteEvent: boolean): number | undefined {
  if (e.alpha === null) return undefined;
  if (absoluteEvent || e.absolute) return e.alpha;
  if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) return (360 - e.webkitCompassHeading) % 360;
  return undefined;
}

/** Smallest signed difference a − b between two angles (degrees). */
export function angleDiff(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}
