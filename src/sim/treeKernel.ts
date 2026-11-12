/**
 * Barnes–Hut forces on a packed copy of the octree, so helper threads can walk it from shared
 * memory (src/sim/parallel.ts). The walk visits nodes and bodies in exactly the order
 * Octree.accel does and does the same arithmetic, so threaded results are identical to the
 * single-threaded ones (tests/parallel.test.ts).
 */

/** Doubles per node: mass, centre of mass (3), half size, leaf flag, first body, 8 children. */
export const NODE_FIELDS = 15;
/** Doubles per body: x, y, z, mass, radius, next body in the same leaf (−1 ends the list). */
export const TREE_BODY_FIELDS = 6;

export interface TreeParams {
  g: number;
  eps2: number;
  theta2: number;
  cull2: number;
  /** Particles that end up inside a body are swallowed. */
  absorb: boolean;
}

/**
 * Acceleration at a point from the packed tree, into out[0..2]. Skips body `self`. With
 * `absorb`, out[0] is NaN when the point is inside a body. Returns the stack (grown if needed).
 */
export function packedTreeAccel(
  nodes: Float64Array,
  tb: Float64Array,
  px: number,
  py: number,
  pz: number,
  self: number,
  p: TreeParams,
  stack: Int32Array,
  out: Float64Array,
  absorb: boolean,
): Int32Array {
  let ax = 0, ay = 0, az = 0;
  const { g, eps2, theta2 } = p;
  let sp = 0;
  stack[sp++] = 0;
  while (sp > 0) {
    const n = stack[--sp];
    const o = n * NODE_FIELDS;
    const m = nodes[o];
    if (m === 0) continue;
    if (nodes[o + 5]) {
      for (let j = nodes[o + 6]; j >= 0; j = tb[j * TREE_BODY_FIELDS + 5]) {
        if (j === self) continue;
        const k = j * TREE_BODY_FIELDS;
        const dx = tb[k] - px, dy = tb[k + 1] - py, dz = tb[k + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (absorb && d2 < tb[k + 4] * tb[k + 4]) {
          out[0] = NaN;
          return stack;
        }
        const r2 = d2 + eps2;
        const f = (g * tb[k + 3]) / (r2 * Math.sqrt(r2));
        ax += dx * f;
        ay += dy * f;
        az += dz * f;
      }
      continue;
    }
    const dx = nodes[o + 1] - px, dy = nodes[o + 2] - py, dz = nodes[o + 3] - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    const size = nodes[o + 4] * 2;
    if (size * size < theta2 * d2) {
      const r2 = d2 + eps2;
      const f = (g * m) / (r2 * Math.sqrt(r2));
      ax += dx * f;
      ay += dy * f;
      az += dz * f;
    } else {
      if (sp + 8 > stack.length) {
        const bigger = new Int32Array(stack.length * 2);
        bigger.set(stack);
        stack = bigger;
      }
      for (let c = 0; c < 8; c++) {
        const ch = nodes[o + 7 + c];
        if (ch >= 0) stack[sp++] = ch;
      }
    }
  }
  out[0] = ax;
  out[1] = ay;
  out[2] = az;
  return stack;
}

/**
 * Work items [start, end) of a tree force pass: items below `nBodies` are bodies (their
 * accelerations go to `bodyAcc`), the rest are particles (to `acc`, with `dead` set for
 * particles beyond the cull distance or swallowed by a body).
 */
export function treeSlice(
  nodes: Float64Array,
  tb: Float64Array,
  nBodies: number,
  bodyAcc: Float64Array,
  pos: Float64Array,
  acc: Float64Array,
  dead: Uint8Array,
  p: TreeParams,
  start: number,
  end: number,
  stack: Int32Array,
): Int32Array {
  const out = new Float64Array(3);
  for (let w = start; w < end; w++) {
    if (w < nBodies) {
      const k = w * TREE_BODY_FIELDS;
      stack = packedTreeAccel(nodes, tb, tb[k], tb[k + 1], tb[k + 2], w, p, stack, out, false);
      bodyAcc[w * 3] = out[0];
      bodyAcc[w * 3 + 1] = out[1];
      bodyAcc[w * 3 + 2] = out[2];
      continue;
    }
    const i = w - nBodies;
    const k = i * 3;
    const px = pos[k], py = pos[k + 1], pz = pos[k + 2];
    if (px * px + py * py + pz * pz > p.cull2) {
      dead[i] = 1;
      continue;
    }
    stack = packedTreeAccel(nodes, tb, px, py, pz, -1, p, stack, out, p.absorb);
    if (Number.isNaN(out[0])) {
      dead[i] = 1;
      acc[k] = acc[k + 1] = acc[k + 2] = 0;
      continue;
    }
    dead[i] = 0;
    acc[k] = out[0];
    acc[k + 1] = out[1];
    acc[k + 2] = out[2];
  }
  return stack;
}
