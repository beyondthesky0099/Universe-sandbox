import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { deadZone, flyStep, offsetTransform, readSticks, scaleStep, SnapTurn } from '../src/render/vr';

describe('VR controls', () => {
  it('ignores small stick drift', () => {
    expect(deadZone(0.1)).toBe(0);
    expect(deadZone(1)).toBe(1);
    expect(deadZone(-1)).toBe(-1);
    expect(deadZone(0.575)).toBeCloseTo(0.5, 6);
  });

  it('flies forward when the stick is pushed up (negative y in WebXR)', () => {
    const fwd = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(1, 0, 0);
    const step = flyStep(0, -1, fwd, right, 10, 0.5);
    expect(step.z).toBeCloseTo(-5, 9);
    expect(flyStep(1, 0, fwd, right, 10, 1).x).toBeCloseTo(10, 9);
    expect(flyStep(0.05, 0.05, fwd, right, 10, 1).length()).toBe(0);
  });

  it('changes scale smoothly and snap-turns once per push', () => {
    expect(scaleStep(-1, 1)).toBeCloseTo(2, 9);
    expect(scaleStep(1, 1)).toBeCloseTo(0.5, 9);
    const t = new SnapTurn();
    expect(t.update(0.9)).toBeCloseTo(-Math.PI / 6, 9);
    expect(t.update(0.95)).toBe(0); // still held: no repeat
    expect(t.update(0)).toBe(0); // released: re-armed
    expect(t.update(-0.9)).toBeCloseTo(Math.PI / 6, 9);
  });

  it('places the viewer where the rig says: the offset space maps the headset origin to the rig position', () => {
    const position = new THREE.Vector3(5, -2, 3);
    const yaw = 0.7;
    const t = offsetTransform(position, yaw);
    // A pose reported in the offset space is offset⁻¹ applied to the base pose: here, the base origin.
    const offset = new THREE.Matrix4().compose(t.position, t.orientation, new THREE.Vector3(1, 1, 1));
    const world = new THREE.Vector3(0, 0, 0).applyMatrix4(offset.clone().invert());
    expect(world.distanceTo(position)).toBeLessThan(1e-9);
    // And "forward" in the headset (−z) turns by the yaw.
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(t.orientation.clone().invert());
    expect(Math.atan2(-fwd.x, -fwd.z)).toBeCloseTo(yaw, 9);
  });

  it('reads both hands from the input sources', () => {
    const session = {
      inputSources: [
        { handedness: 'left', gamepad: { axes: [0, 0, 0.2, -0.8] } },
        { handedness: 'right', gamepad: { axes: [0, 0, 0.9, 0.1] } },
      ],
    } as unknown as XRSession;
    expect(readSticks(session)).toEqual({ left: [0.2, -0.8], right: [0.9, 0.1] });
    expect(readSticks(undefined)).toEqual({ left: [0, 0], right: [0, 0] });
  });
});
