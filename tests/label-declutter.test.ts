import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LabelDeclutter, labelPriority } from '../src/render/labelDeclutter';

function label(text: string, x: number, y: number, z: number, scale = 0.04): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
  s.userData.labelText = text;
  s.userData.textFrac = 0.8;
  s.scale.set(0.16, scale, 1);
  s.center.set(0.5, -0.6);
  s.position.set(x, y, z);
  return s;
}

describe('label declutter', () => {
  it('ranks explicit priority, then size, then well-known names over catalogue numbers', () => {
    const you = label('You are here', 0, 0, 0);
    you.userData.priority = 1000;
    expect(labelPriority(you)).toBe(1000);
    expect(labelPriority(label('Orion Nebula (M42) · 1,344 ly', 0, 0, 0, 0.022))).toBeGreaterThan(labelPriority(label('NGC 2023 · 1,300 ly', 0, 0, 0, 0.022)));
    expect(labelPriority(label('M13', 0, 0, 0, 0.022))).toBeGreaterThan(labelPriority(label('Sh2-155', 0, 0, 0, 0.022)));
  });

  it('fades overlapping labels and keeps separate ones', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const famous = label('Orion Nebula', 0, 0, 0, 0.03);
    const minor = label('NGC 1977', 0.05, 0.02, 0, 0.03); // right on top of it
    const apart = label('Pleiades', 3, 2, 0, 0.03);
    scene.add(famous, minor, apart);
    const d = new LabelDeclutter();
    for (let i = 0; i < 40; i++) d.update(scene, camera, 0.05);
    expect(famous.material.opacity).toBeGreaterThan(0.9);
    expect(apart.material.opacity).toBeGreaterThan(0.9);
    expect(minor.material.opacity).toBeLessThan(0.1);
    // Move the camera in: now there's room for both.
    camera.position.set(0, 0, 0.6);
    camera.updateMatrixWorld();
    for (let i = 0; i < 40; i++) d.update(scene, camera, 0.05);
    expect(minor.material.opacity).toBeGreaterThan(0.9);
  });
});
