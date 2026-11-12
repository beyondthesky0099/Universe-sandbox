import type { Body } from './body';
import { NODE_FIELDS, TREE_BODY_FIELDS } from './treeKernel';

const MAX_DEPTH = 32;

/**
 * Barnes–Hut octree over the massive bodies, stored in flat typed arrays so it can be
 * rebuilt every step without allocating. Far-away groups of bodies are approximated
 * by their centre of mass when (node size / distance) < θ, giving O(N log N) gravity.
 *
 * Leaves hold a linked list of bodies (normally one; several only when the depth cap
 * is hit by nearly coincident bodies).
 */
export class Octree {
  theta = 0.7;
  private cap = 0;
  private count = 0;
  private cx = new Float64Array(0);
  private cy = new Float64Array(0);
  private cz = new Float64Array(0);
  private half = new Float64Array(0);
  private mass = new Float64Array(0);
  private mx = new Float64Array(0);
  private my = new Float64Array(0);
  private mz = new Float64Array(0);
  private child = new Int32Array(0);
  private first = new Int32Array(0);
  private leaf = new Uint8Array(0);
  private next = new Int32Array(0);
  private stack = new Int32Array(256);
  private bodies: readonly Body[] = [];

  get nodeCount(): number {
    return this.count;
  }

  build(bodies: readonly Body[]): void {
    this.bodies = bodies;
    const n = bodies.length;
    if (this.next.length < n) this.next = new Int32Array(Math.max(n, 16) * 2);
    this.ensure(Math.max(64, n * 4));
    this.count = 0;
    if (n === 0) return;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const b of bodies) {
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.z < minZ) minZ = b.z;
      if (b.x > maxX) maxX = b.x;
      if (b.y > maxY) maxY = b.y;
      if (b.z > maxZ) maxZ = b.z;
    }
    const half = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9) * 0.5 * 1.0001;
    this.newNode((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2, half);
    for (let i = 0; i < n; i++) this.insert(0, i, 0);
    this.summarize(0);
  }

  private ensure(capacity: number): void {
    if (capacity <= this.cap) return;
    const grow = <T extends Float64Array | Int32Array | Uint8Array>(old: T, size: number, ctor: new (n: number) => T): T => {
      const a = new ctor(size);
      a.set(old.subarray(0, Math.min(old.length, size)) as never);
      return a;
    };
    this.cx = grow(this.cx, capacity, Float64Array);
    this.cy = grow(this.cy, capacity, Float64Array);
    this.cz = grow(this.cz, capacity, Float64Array);
    this.half = grow(this.half, capacity, Float64Array);
    this.mass = grow(this.mass, capacity, Float64Array);
    this.mx = grow(this.mx, capacity, Float64Array);
    this.my = grow(this.my, capacity, Float64Array);
    this.mz = grow(this.mz, capacity, Float64Array);
    this.child = grow(this.child, capacity * 8, Int32Array);
    this.first = grow(this.first, capacity, Int32Array);
    this.leaf = grow(this.leaf, capacity, Uint8Array);
    this.cap = capacity;
  }

  private newNode(x: number, y: number, z: number, half: number): number {
    if (this.count >= this.cap) this.ensure(this.cap * 2);
    const i = this.count++;
    this.cx[i] = x;
    this.cy[i] = y;
    this.cz[i] = z;
    this.half[i] = half;
    this.mass[i] = 0;
    this.first[i] = -1;
    this.leaf[i] = 1;
    this.child.fill(-1, i * 8, i * 8 + 8);
    return i;
  }

  private octant(node: number, b: Body): number {
    return (b.x >= this.cx[node] ? 1 : 0) | (b.y >= this.cy[node] ? 2 : 0) | (b.z >= this.cz[node] ? 4 : 0);
  }

  private childFor(node: number, oct: number): number {
    const slot = node * 8 + oct;
    let c = this.child[slot];
    if (c < 0) {
      const h = this.half[node] / 2;
      c = this.newNode(
        this.cx[node] + (oct & 1 ? h : -h),
        this.cy[node] + (oct & 2 ? h : -h),
        this.cz[node] + (oct & 4 ? h : -h),
        h,
      );
      this.child[slot] = c;
    }
    return c;
  }

  private insert(node: number, i: number, depth: number): void {
    const bodies = this.bodies;
    for (;;) {
      if (this.leaf[node]) {
        if (this.first[node] < 0) {
          this.first[node] = i;
          this.next[i] = -1;
          return;
        }
        if (depth >= MAX_DEPTH) {
          this.next[i] = this.first[node];
          this.first[node] = i;
          return;
        }
        // Split: push existing occupants down one level.
        let j = this.first[node];
        this.first[node] = -1;
        this.leaf[node] = 0;
        while (j >= 0) {
          const nj = this.next[j];
          this.insert(this.childFor(node, this.octant(node, bodies[j])), j, depth + 1);
          j = nj;
        }
      }
      node = this.childFor(node, this.octant(node, bodies[i]));
      depth++;
    }
  }

  private summarize(node: number): void {
    let m = 0, x = 0, y = 0, z = 0;
    if (this.leaf[node]) {
      for (let j = this.first[node]; j >= 0; j = this.next[j]) {
        const b = this.bodies[j];
        m += b.mass;
        x += b.mass * b.x;
        y += b.mass * b.y;
        z += b.mass * b.z;
      }
    } else {
      for (let o = 0; o < 8; o++) {
        const c = this.child[node * 8 + o];
        if (c < 0) continue;
        this.summarize(c);
        const cm = this.mass[c];
        m += cm;
        x += cm * this.mx[c];
        y += cm * this.my[c];
        z += cm * this.mz[c];
      }
    }
    this.mass[node] = m;
    if (m > 0) {
      this.mx[node] = x / m;
      this.my[node] = y / m;
      this.mz[node] = z / m;
    } else {
      this.mx[node] = this.cx[node];
      this.my[node] = this.cy[node];
      this.mz[node] = this.cz[node];
    }
  }

  /**
   * Copy the tree into flat arrays for helper threads (treeKernel.ts): `nodes` (NODE_FIELDS per
   * node) and `tb` (TREE_BODY_FIELDS per body). Returns false if they are too small.
   */
  pack(nodes: Float64Array, tb: Float64Array): boolean {
    const n = this.bodies.length;
    if (this.count * NODE_FIELDS > nodes.length || n * TREE_BODY_FIELDS > tb.length) return false;
    for (let i = 0; i < this.count; i++) {
      const o = i * NODE_FIELDS;
      nodes[o] = this.mass[i];
      nodes[o + 1] = this.mx[i];
      nodes[o + 2] = this.my[i];
      nodes[o + 3] = this.mz[i];
      nodes[o + 4] = this.half[i];
      nodes[o + 5] = this.leaf[i];
      nodes[o + 6] = this.first[i];
      for (let c = 0; c < 8; c++) nodes[o + 7 + c] = this.child[i * 8 + c];
    }
    for (let j = 0; j < n; j++) {
      const b = this.bodies[j];
      const k = j * TREE_BODY_FIELDS;
      tb[k] = b.x;
      tb[k + 1] = b.y;
      tb[k + 2] = b.z;
      tb[k + 3] = b.mass;
      tb[k + 4] = b.radius;
      tb[k + 5] = this.next[j];
    }
    return true;
  }

  /**
   * Gravitational acceleration at a point (G already applied via `g`). Skips body index
   * `self`. If `absorbRadius` is true, returns NaN in out[0] when the point lies inside
   * any body's radius (used to absorb particles).
   */
  accel(px: number, py: number, pz: number, self: number, g: number, eps2: number, out: Float64Array, absorb = false): void {
    let ax = 0, ay = 0, az = 0;
    if (this.count === 0) {
      out[0] = out[1] = out[2] = 0;
      return;
    }
    const theta2 = this.theta * this.theta;
    const mass = this.mass, mx = this.mx, my = this.my, mz = this.mz, half = this.half;
    const leaf = this.leaf, first = this.first, next = this.next, child = this.child;
    const bodies = this.bodies;
    let stack = this.stack;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const n = stack[--sp];
      const m = mass[n];
      if (m === 0) continue;
      if (leaf[n]) {
        for (let j = first[n]; j >= 0; j = next[j]) {
          if (j === self) continue;
          const b = bodies[j];
          const dx = b.x - px, dy = b.y - py, dz = b.z - pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (absorb && d2 < b.radius * b.radius) {
            out[0] = NaN;
            return;
          }
          const r2 = d2 + eps2;
          const f = (g * b.mass) / (r2 * Math.sqrt(r2));
          ax += dx * f;
          ay += dy * f;
          az += dz * f;
        }
        continue;
      }
      const dx = mx[n] - px, dy = my[n] - py, dz = mz[n] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const size = half[n] * 2;
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
          this.stack = stack = bigger;
        }
        const base = n * 8;
        for (let o = 0; o < 8; o++) {
          const c = child[base + o];
          if (c >= 0) stack[sp++] = c;
        }
      }
    }
    out[0] = ax;
    out[1] = ay;
    out[2] = az;
  }
}
