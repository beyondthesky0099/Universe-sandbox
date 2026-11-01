/**
 * Massless "test particles": they feel the gravity of massive bodies but exert none
 * themselves. That keeps cost at O(particles × bodies) so thousands of them (asteroid
 * belts, galaxy disks, collision debris) stay cheap.
 *
 * Stored as flat typed arrays; removal is swap-with-last so order is not preserved.
 */
export class ParticleSet {
  readonly capacity: number;
  count = 0;
  readonly pos: Float64Array;
  readonly vel: Float64Array;
  readonly acc: Float64Array;
  /** RGB in [0, 1]. */
  readonly color: Float32Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.pos = new Float64Array(capacity * 3);
    this.vel = new Float64Array(capacity * 3);
    this.acc = new Float64Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
  }

  /** Returns the new particle's index, or -1 if full. */
  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, rgb: [number, number, number]): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    const k = i * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    this.acc[k] = this.acc[k + 1] = this.acc[k + 2] = 0;
    this.color[k] = rgb[0];
    this.color[k + 1] = rgb[1];
    this.color[k + 2] = rgb[2];
    return i;
  }

  remove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    const a = i * 3;
    const b = last * 3;
    for (let c = 0; c < 3; c++) {
      this.pos[a + c] = this.pos[b + c];
      this.vel[a + c] = this.vel[b + c];
      this.acc[a + c] = this.acc[b + c];
      this.color[a + c] = this.color[b + c];
    }
  }

  clear(): void {
    this.count = 0;
  }
}
