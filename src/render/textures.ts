import * as THREE from 'three';
import { mulberry32 } from '../procgen/rng';

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let glow: THREE.Texture | undefined;
/** Soft radial falloff, white. Tint via material colour. */
export function glowTexture(): THREE.Texture {
  return (glow ??= canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }));
}

let dot: THREE.Texture | undefined;
/** Small round point sprite for particles. */
export function dotTexture(): THREE.Texture {
  return (dot ??= canvasTexture(32, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }));
}

let ring: THREE.Texture | undefined;
/** Thin circle outline, used as a selection marker. */
export function ringTexture(): THREE.Texture {
  return (ring ??= canvasTexture(128, (ctx, s) => {
    ctx.strokeStyle = 'rgba(120,220,255,0.95)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2);
    ctx.stroke();
  }));
}

let disk: THREE.Texture | undefined;
/** Accretion disk: hot inner edge fading outward, with some streaks. */
export function accretionTexture(): THREE.Texture {
  return (disk ??= canvasTexture(256, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, c * 0.36, c, c, c);
    g.addColorStop(0, 'rgba(255,250,235,1)');
    g.addColorStop(0.15, 'rgba(255,190,90,0.95)');
    g.addColorStop(0.5, 'rgba(220,90,30,0.45)');
    g.addColorStop(1, 'rgba(120,30,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'destination-out';
    const rng = mulberry32(9);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.15 + rng() * 0.25})`;
      ctx.lineWidth = 1 + rng() * 3;
      const r = c * (0.4 + rng() * 0.55);
      const a0 = rng() * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(c, c, r, a0, a0 + 0.5 + rng() * 2);
      ctx.stroke();
    }
  }));
}
