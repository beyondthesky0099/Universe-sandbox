/**
 * Resolution that follows the GPU: the render resolution drops when the frame rate falls below
 * the target and climbs back when there is headroom, so a strong graphics card renders above
 * screen resolution (sharper) and a weak one stays smooth. Fed the measured frame rate twice a
 * second; it falls after two slow samples in a row and rises after four fast ones, so it does not
 * flicker between steps.
 */
export class AdaptiveResolution {
  /** Fraction of the quality preset's full resolution (1 = full). */
  scale = 1;
  private slow = 0;
  private fast = 0;

  constructor(
    readonly min = 0.5,
    readonly max = 1,
    /** Frames per second to hold. */
    readonly target = 55,
  ) {}

  /** Returns the new scale when it changes, else undefined. */
  update(fps: number): number | undefined {
    if (fps < this.target - 7) {
      this.fast = 0;
      if (++this.slow >= 2 && this.scale > this.min) {
        this.slow = 0;
        this.scale = Math.max(this.min, Math.round(this.scale * 0.85 * 100) / 100);
        return this.scale;
      }
    } else if (fps > this.target + 2) {
      this.slow = 0;
      if (++this.fast >= 4 && this.scale < this.max) {
        this.fast = 0;
        this.scale = Math.min(this.max, Math.round(this.scale * 1.1 * 100) / 100);
        return this.scale;
      }
    } else {
      this.slow = this.fast = 0;
    }
    return undefined;
  }

  reset(): void {
    this.scale = this.max;
    this.slow = this.fast = 0;
  }
}

/**
 * Full-resolution pixel ratio for a quality preset: the screen's, times the preset's
 * supersampling (rendering above screen resolution smooths edges and fine detail), capped.
 */
export function presetPixelRatio(devicePixelRatio: number, preset: { pixelRatio: number; supersample?: number }): number {
  return Math.min(devicePixelRatio * (preset.supersample ?? 1), preset.pixelRatio);
}
