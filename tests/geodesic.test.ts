import { describe, expect, it } from 'vitest';
import { CRITICAL_IMPACT, impactParameter, traceDisc, tracePhoton } from '../src/sim/geodesic';

describe('light around a Schwarzschild black hole', () => {
  it('bends weak-field rays by 4M/b and captures those inside √27 M', () => {
    // b = 100 M: the Einstein deflection 4/b plus the next term 15π/4b² gives 0.0412 rad.
    const far = tracePhoton(100);
    expect(far.captured).toBe(false);
    expect(far.deflection).toBeGreaterThan(0.0412 * 0.97);
    expect(far.deflection).toBeLessThan(0.0412 * 1.03);
    expect(far.rMin).toBeGreaterThan(97);
    // b = 20 M: 0.2 + 0.0295 = 0.23 rad.
    const mid = tracePhoton(20);
    expect(mid.deflection).toBeCloseTo(0.23, 1);
    // Just outside the critical impact parameter the photon loops round; inside, it falls in.
    expect(tracePhoton(CRITICAL_IMPACT + 0.05).captured).toBe(false);
    expect(tracePhoton(CRITICAL_IMPACT + 0.05).deflection).toBeGreaterThan(Math.PI / 2);
    expect(tracePhoton(CRITICAL_IMPACT - 0.1).captured).toBe(true);
    expect(tracePhoton(3).captured).toBe(true);
    // A static observer at 10 M looking 30° from the hole: b = 10 sin30° / √0.8.
    expect(impactParameter(10, Math.PI / 6)).toBeCloseTo(5.59, 2);
  });

  it('shows the far side of an edge-on disc bent over the shadow', () => {
    // Camera 60 M out, 80° from the disc's axis (nearly edge-on), looking at the hole.
    const incl = (80 * Math.PI) / 180;
    const n = { x: 0, y: 1, z: 0 }; // the disc lies in the xz-plane
    const m1 = { x: 1, y: 0, z: 0 };
    const cam = { x: 0, y: 60 * Math.cos(incl), z: 60 * Math.sin(incl) };
    const hole = { x: -cam.x, y: -cam.y, z: -cam.z }; // relative to the camera at the origin
    const toHole = { x: hole.x / 60, y: hole.y / 60, z: hole.z / 60 };
    // Screen "up" is the projected disc axis.
    const up = { x: 0, y: 1, z: 0 };
    const upPerp = (() => { const d = up.x * toHole.x + up.y * toHole.y + up.z * toHole.z; const v = { x: up.x - d * toHole.x, y: up.y - d * toHole.y, z: up.z - d * toHole.z }; const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; })();
    const aim = (upM: number) => ({ x: toHole.x * 60 + upPerp.x * upM, y: toHole.y * 60 + upPerp.y * upM, z: toHole.z * 60 + upPerp.z * upM });
    // Straight at the hole: captured.
    expect(traceDisc(hole, toHole, n, m1, 6, 36)).toBe('captured');
    // Aimed 7 M above the hole's centre on the sky. In flat space this ray would clear the edge-on
    // disc (it crosses the plane far behind the hole, at r ≈ 7 / cos 80° ≈ 40 M > 36 M). The
    // curvature bends it down onto the disc's far side.
    const bent = traceDisc(hole, aim(7), n, m1, 6, 36);
    expect(bent).not.toBe('captured');
    expect(bent).toBeDefined();
    if (!bent || bent === 'captured') return;
    expect(bent.r).toBeGreaterThan(6);
    expect(bent.r).toBeLessThan(36);
    // The point seen is on the far side of the hole (beyond it, away from the camera), seen over the top.
    expect(bent.point.x * toHole.x + bent.point.y * toHole.y + bent.point.z * toHole.z).toBeGreaterThan(0);
    // In flat space the same ray crosses the plane at about 40 M, outside the disc: the hole has pulled the image in.
    expect(bent.r).toBeLessThan(12);
    // Aimed 50 M above: misses the disc altogether.
    expect(traceDisc(hole, aim(50), n, m1, 6, 36)).toBeUndefined();
    // Aimed 20 M to the side in the disc plane: hits the disc's near side, with Doppler shifts of
    // opposite sign on the two sides (the approaching side brighter: g > 1).
    const side = (sideM: number) => {
      const right = { x: upPerp.y * toHole.z - upPerp.z * toHole.y, y: upPerp.z * toHole.x - upPerp.x * toHole.z, z: upPerp.x * toHole.y - upPerp.y * toHole.x };
      return { x: toHole.x * 60 + right.x * sideM, y: toHole.y * 60 + right.y * sideM, z: toHole.z * 60 + right.z * sideM };
    };
    const left = traceDisc(hole, side(-20), n, m1, 6, 36);
    const rightHit = traceDisc(hole, side(20), n, m1, 6, 36);
    expect(left && left !== 'captured' && rightHit && rightHit !== 'captured').toBe(true);
    if (!left || left === 'captured' || !rightHit || rightHit === 'captured') return;
    expect((left.g - 1) * (rightHit.g - 1)).toBeLessThan(0);
    expect(Math.max(left.g, rightHit.g)).toBeGreaterThan(1.1);
  });
});
