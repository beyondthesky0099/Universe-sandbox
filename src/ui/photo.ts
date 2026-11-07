import * as THREE from 'three';

/**
 * Photo mode: hide the interface, frame the shot (field of view, labels on or off), grade it
 * (exposure, contrast, saturation) and save it as a PNG at up to 4× the screen's resolution.
 *
 * The grade is a CSS filter on the canvas while composing, and the same filter is applied when
 * the capture is copied out, so the file looks like the preview.
 */
export interface PhotoHooks {
  renderer: THREE.WebGLRenderer;
  /** The view on screen now: its scene, camera and name (for the file name). */
  current(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; name: string };
  /** Re-apply sizes after a pixel-ratio change (views, post-processing, line widths). */
  resize(): void;
  /** Render one frame of the current view now, without advancing time. */
  renderNow(): void;
}

export interface Grade {
  exposure: number;
  contrast: number;
  saturation: number;
}

/** The CSS / canvas filter for a grade. */
export function gradeFilter(g: Grade): string {
  const parts: string[] = [];
  if (g.exposure !== 1) parts.push(`brightness(${g.exposure.toFixed(2)})`);
  if (g.contrast !== 1) parts.push(`contrast(${g.contrast.toFixed(2)})`);
  if (g.saturation !== 1) parts.push(`saturate(${g.saturation.toFixed(2)})`);
  return parts.join(' ') || 'none';
}

/**
 * Pixel ratio for a capture `scale` times the screen's, kept within the GPU's limits and a
 * memory budget (`maxPixels`; post-processing holds several full-size half-float buffers).
 */
export function captureRatio(cssWidth: number, cssHeight: number, screenRatio: number, scale: number, maxSide: number, maxPixels: number): number {
  let ratio = screenRatio * scale;
  ratio = Math.min(ratio, maxSide / Math.max(cssWidth, cssHeight, 1));
  const pixels = cssWidth * cssHeight * ratio * ratio;
  if (pixels > maxPixels) ratio *= Math.sqrt(maxPixels / pixels);
  return Math.max(0.25, ratio);
}

/** File name: astrarium-<view>-<yyyy-mm-dd-hhmmss>.png. */
export function photoFileName(view: string, date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  const slug = view.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'view';
  return `astrarium-${slug}-${stamp}.png`;
}

export class PhotoMode {
  active = false;
  labels = true;
  grade: Grade = { exposure: 1, contrast: 1, saturation: 1 };
  /** Field of view while in photo mode (degrees); undefined = leave the view's own. */
  fov?: number;
  private savedFov = new Map<THREE.PerspectiveCamera, number>();
  /** Text labels drawn in the 3D scene that photo mode hid, to show again later. */
  private hidden = new Set<THREE.Object3D>();

  constructor(private readonly hooks: PhotoHooks) {}

  enter(): void {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('photo-mode');
    const { camera } = this.hooks.current();
    this.fov = camera.fov;
    this.applyGrade();
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove('photo-mode', 'photo-nolabels');
    this.hooks.renderer.domElement.style.filter = '';
    for (const [cam, fov] of this.savedFov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.savedFov.clear();
    this.showLabels();
    this.labels = true;
    this.fov = undefined;
  }

  setLabels(on: boolean): void {
    this.labels = on;
    document.body.classList.toggle('photo-nolabels', !on);
    if (on) this.showLabels();
  }

  setGrade(g: Partial<Grade>): void {
    Object.assign(this.grade, g);
    this.applyGrade();
  }

  setFov(fov: number): void {
    this.fov = fov;
  }

  /** Called just before each render: applies the field of view and hides scene labels. */
  beforeRender(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (!this.active) return;
    if (this.fov !== undefined && camera.fov !== this.fov) {
      if (!this.savedFov.has(camera)) this.savedFov.set(camera, camera.fov);
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
    if (!this.labels) {
      scene.traverse((o) => {
        if (o.visible && o.userData.labelText !== undefined) {
          o.visible = false;
          this.hidden.add(o);
        }
      });
    }
  }

  /** Renders the current view at `scale` × the screen's resolution and downloads it as a PNG. */
  async capture(scale: number): Promise<{ width: number; height: number }> {
    const { renderer } = this.hooks;
    const canvas = renderer.domElement;
    const screenRatio = renderer.getPixelRatio();
    const size = renderer.getSize(new THREE.Vector2());
    const gl = renderer.getContext();
    const maxSide = Math.min(8192, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, renderer.capabilities.maxTextureSize);
    const ratio = captureRatio(size.x, size.y, screenRatio, scale, maxSide, 16e6);
    const out = document.createElement('canvas');
    try {
      renderer.setPixelRatio(ratio);
      this.hooks.resize();
      this.hooks.renderNow();
      // Copy straight away, in the same task as the render, before the browser clears the buffer.
      out.width = canvas.width;
      out.height = canvas.height;
      const ctx = out.getContext('2d')!;
      ctx.filter = gradeFilter(this.grade);
      ctx.drawImage(canvas, 0, 0);
    } finally {
      renderer.setPixelRatio(screenRatio);
      this.hooks.resize();
    }
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The browser could not encode the picture.');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = photoFileName(this.hooks.current().name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { width: out.width, height: out.height };
  }

  private applyGrade(): void {
    const f = gradeFilter(this.grade);
    this.hooks.renderer.domElement.style.filter = f === 'none' ? '' : f;
  }

  private showLabels(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden.clear();
  }
}
