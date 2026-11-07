import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { latLon, localSolarTime, PATCH_RADIUS, rotationAngle, sphereUv, tangentBasis, terrainPatch } from '../src/render/lander';

describe('standing on a planet', () => {
  it('maps directions to the same texture coordinates as the planet sphere', () => {
    const sphere = new THREE.SphereGeometry(1, 32, 16);
    const pos = sphere.getAttribute('position');
    const uv = sphere.getAttribute('uv');
    for (const i of [40, 123, 250, 333, 400]) {
      const d = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const [u, v] = sphereUv(d);
      // (u wraps at the seam.)
      expect(Math.min(Math.abs(u - uv.getX(i)), 1 - Math.abs(u - uv.getX(i)))).toBeLessThan(1e-4);
      expect(v).toBeCloseTo(uv.getY(i), 4);
    }
    expect(latLon(new THREE.Vector3(0, 1, 0)).lat).toBeCloseTo(90, 6);
  });

  it('tells the local solar time: noon under the Sun, later as the planet turns', () => {
    const site = new THREE.Vector3(1, 0, 0);
    expect(localSolarTime(site, new THREE.Vector3(1, 0, 0))).toBeCloseTo(12, 6);
    // The planet turns by +δ about y, so in its frame the Sun turns by −δ.
    const later = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 4);
    expect(localSolarTime(site, later)).toBeCloseTo(15, 6);
    expect(localSolarTime(site, new THREE.Vector3(-1, 0, 0))).toBeCloseTo(0, 6);
  });

  it('turns at the real rate', () => {
    // One sidereal day of Earth (23.93 h) is one full turn.
    expect(rotationAngle(23.9345 / 8766, 23.9345)).toBeCloseTo(2 * Math.PI, 9);
    expect(rotationAngle(1 / 8766, -24)).toBeLessThan(0);
  });

  it('builds terrain that rises and falls around the site and meets the sphere at its edge', () => {
    const site = new THREE.Vector3(0.3, 0.5, -0.8).normalize();
    const [east, north] = tangentBasis(site);
    expect(east.dot(site)).toBeCloseTo(0, 9);
    expect(north.dot(site)).toBeCloseTo(0, 9);
    expect(north.y).toBeGreaterThan(0);
    for (const air of [true, false]) {
      const { geometry, height } = terrainPatch(site, { seed: 42, air });
      const pos = geometry.getAttribute('position');
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)) - 1;
        lo = Math.min(lo, r);
        hi = Math.max(hi, r);
      }
      // Relief of a few thousandths of the radius: mountains and valleys, not spikes.
      expect(hi - lo).toBeGreaterThan(0.0005);
      expect(hi - lo).toBeLessThan(0.02);
      const edge = site.clone().addScaledVector(east, Math.tan(PATCH_RADIUS)).normalize();
      expect(Math.abs(height(edge))).toBeLessThan(1e-9);
      geometry.dispose();
    }
  });
});
