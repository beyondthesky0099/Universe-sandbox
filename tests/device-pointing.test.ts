import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { angleDiff, deviceQuaternion, lookOf, trueAlpha } from '../src/render/devicePointing';

const look = (a: number, b: number, g: number, s = 0) => lookOf(deviceQuaternion(a, b, g, s));
const up = (a: number, b: number, g: number, s = 0) => new THREE.Vector3(0, 1, 0).applyQuaternion(deviceQuaternion(a, b, g, s));

describe('pointing a phone at the sky', () => {
  it('looks out of the back of the phone, held upright', () => {
    // Upright (beta 90°), top towards the sky: alpha 0 faces north, 270 east, 90 west, 180 south.
    const n = look(0, 90, 0);
    expect(n.alt).toBeCloseTo(0, 6);
    expect(Math.min(n.az, 360 - n.az)).toBeCloseTo(0, 6);
    expect(look(270, 90, 0).az).toBeCloseTo(90, 6);
    expect(look(90, 90, 0).az).toBeCloseTo(270, 6);
    expect(look(180, 90, 0).az).toBeCloseTo(180, 6);
    // The screen's up is the sky's up.
    expect(up(0, 90, 0).y).toBeCloseTo(1, 6);
  });

  it('tilts up and down with beta', () => {
    expect(look(0, 135, 0).alt).toBeCloseTo(45, 6); // tipped back: looking 45° up
    expect(look(0, 60, 0).alt).toBeCloseTo(-30, 6); // tipped forward: below the horizon
    // Lying face down (beta 180°) looks straight up.
    expect(look(0, 180, 0).alt).toBeCloseTo(90, 6);
  });

  it('allows for the screen being turned to landscape', () => {
    // Turning the screen rolls the picture about the line of sight without moving it: the same
    // direction, with the picture's up turned a quarter turn so the sky stays up on screen.
    for (const [a, b, g] of [[0, 90, 0], [200, 120, 15], [35, 70, -40]]) {
      const p = look(a, b, g, 0), l = look(a, b, g, 90);
      expect(l.alt).toBeCloseTo(p.alt, 6);
      expect(Math.abs(((l.az - p.az + 540) % 360) - 180)).toBeLessThan(1e-6);
      const q0 = deviceQuaternion(a, b, g, 0), q1 = deviceQuaternion(a, b, g, 90);
      const u0 = new THREE.Vector3(0, 1, 0).applyQuaternion(q0), u1 = new THREE.Vector3(0, 1, 0).applyQuaternion(q1);
      expect(u0.dot(u1)).toBeCloseTo(0, 6);
    }
  });

  it('reads true north from an absolute event or the iPhone compass', () => {
    expect(trueAlpha({ alpha: 30 }, true)).toBe(30);
    expect(trueAlpha({ alpha: 30, absolute: true }, false)).toBe(30);
    // Compass heading 90° (east, clockwise) is alpha 270° (anticlockwise).
    expect(trueAlpha({ alpha: 12, webkitCompassHeading: 90 }, false)).toBe(270);
    expect(trueAlpha({ alpha: 12 }, false)).toBeUndefined();
    expect(trueAlpha({ alpha: null }, true)).toBeUndefined();
    expect(angleDiff(10, 350)).toBeCloseTo(20, 9);
    expect(angleDiff(350, 10)).toBeCloseTo(-20, 9);
  });
});
