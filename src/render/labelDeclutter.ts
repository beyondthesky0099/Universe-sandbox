import * as THREE from 'three';

/**
 * Keeps map labels readable: where text labels would overlap on screen, the most important
 * ones stay and the others fade out until there is room again (zoom in and they come back).
 *
 * Importance, highest first:
 * - an explicit `userData.priority`;
 * - then bigger labels;
 * - then well-known names (Messier objects and proper names like "Orion Nebula") before bare
 *   catalogue numbers (NGC, IC, Sh2-, LBN, LDN, vdB, RCW, Gum, Barnard, UGC, ESO…);
 * - then nearer objects before farther ones.
 *
 * Works on any label made by textSprite (`userData.labelText`, constant screen size). Placement
 * is recomputed every few frames; opacities fade every frame.
 */
const CATALOGUE = /^(NGC|IC|Sh ?2|LBN|LDN|vdB|RCW|Gum|Barnard|B\d|UGC|ESO|PGC|Collinder|Cr |Melotte|Trumpler|Ruprecht|Stock|King|Berkeley|Czernik|Haffner|Alessi|UBC|CWNU|HSC|OC |Theia|Gaia|Pal |Terzan|2MASS|PN |Abell|DWB|G\d)/i;

/** How much a label matters (larger first). */
export function labelPriority(sprite: THREE.Sprite): number {
  if (typeof sprite.userData.priority === 'number') return sprite.userData.priority;
  const text = String(sprite.userData.labelText ?? '');
  const name = text.split(' · ')[0];
  const famous = /^M\s?\d/.test(name) || !CATALOGUE.test(name) ? 1 : 0;
  return sprite.scale.y * 100 + famous;
}

/** A label's lettering on screen (NDC), and its depth; undefined if behind the camera. */
export function labelRect(sprite: THREE.Sprite, camera: THREE.PerspectiveCamera, pos = new THREE.Vector3()): { x0: number; x1: number; y0: number; y1: number; depth: number } | undefined {
  const p = sprite.getWorldPosition(pos).applyMatrix4(camera.matrixWorldInverse);
  if (p.z >= 0) return undefined;
  const P = camera.projectionMatrix.elements;
  const w = -p.z;
  const ax = (P[0] * p.x + P[8] * p.z) / w;
  const ay = (P[5] * p.y + P[9] * p.z) / w;
  const f = sprite.userData.textFrac ?? 1;
  const cx = sprite.center.x - 0.5, cy = sprite.center.y - 0.5;
  const sx = sprite.scale.x * P[0], sy = sprite.scale.y * P[5];
  // The lettering fills about the middle half of the canvas's height.
  return { x0: ax + (-f / 2 - cx) * sx, x1: ax + (f / 2 - cx) * sx, y0: ay + (-0.28 - cy) * sy, y1: ay + (0.28 - cy) * sy, depth: w };
}

export class LabelDeclutter {
  private frame = 0;
  private readonly pos = new THREE.Vector3();

  /** Call once a frame with the view's scene and camera. */
  update(root: THREE.Object3D, camera: THREE.PerspectiveCamera, dt: number): void {
    const sprites: THREE.Sprite[] = [];
    root.traverseVisible((o) => {
      if (o instanceof THREE.Sprite && o.userData.labelText !== undefined) sprites.push(o);
    });
    if (this.frame++ % 3 === 0) this.place(sprites, camera);
    const k = Math.min(1, dt * 8);
    for (const s of sprites) {
      const base = (s.userData.baseOpacity ??= s.material.opacity) as number;
      const target = (s.userData.declutterShow === false ? 0 : 1) * base;
      s.material.opacity += (target - s.material.opacity) * k;
    }
  }

  /** Decide which labels show: most important first, skipping any that would overlap one already placed. */
  private place(sprites: THREE.Sprite[], camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld();
    const items: { s: THREE.Sprite; r: NonNullable<ReturnType<typeof labelRect>>; pri: number }[] = [];
    for (const s of sprites) {
      const r = labelRect(s, camera, this.pos);
      if (!r || r.x1 < -1.1 || r.x0 > 1.1 || r.y1 < -1.1 || r.y0 > 1.1) {
        s.userData.declutterShow = true; // off screen: not drawn anyway; let it fade in when it arrives
        continue;
      }
      items.push({ s, r, pri: labelPriority(s) });
    }
    items.sort((a, b) => b.pri - a.pri || a.r.depth - b.r.depth);
    // Placed rectangles, bucketed on a coarse grid for quick overlap tests.
    const cell = 0.1;
    const grid = new Map<number, { x0: number; x1: number; y0: number; y1: number }[]>();
    const key = (i: number, j: number) => i * 4096 + j;
    const pad = 0.004;
    for (const { s, r } of items) {
      const i0 = Math.floor(r.x0 / cell), i1 = Math.floor(r.x1 / cell), j0 = Math.floor(r.y0 / cell), j1 = Math.floor(r.y1 / cell);
      let free = true;
      for (let i = i0; i <= i1 && free; i++) {
        for (let j = j0; j <= j1 && free; j++) {
          for (const q of grid.get(key(i, j)) ?? []) {
            if (r.x0 < q.x1 + pad && r.x1 > q.x0 - pad && r.y0 < q.y1 + pad && r.y1 > q.y0 - pad) {
              free = false;
              break;
            }
          }
        }
      }
      s.userData.declutterShow = free;
      if (!free) continue;
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const list = grid.get(key(i, j));
          if (list) list.push(r);
          else grid.set(key(i, j), [r]);
        }
      }
    }
  }
}
