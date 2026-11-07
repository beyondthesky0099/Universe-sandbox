import { $, toast } from '../ui/dom';
import type { App } from '../app';

/** Photo mode: hiding the interface, grading and saving pictures (ui/photo.ts). */
export class PhotoUI {
  constructor(private readonly app: App) {}

  togglePhoto(): void {
    if (this.app.photo.active) {
      this.app.photo.exit();
      return;
    }
    this.app.photo.enter();
    const fov = Math.round(this.app.photo.fov ?? 50);
    $<HTMLInputElement>('photo-fov').value = String(fov);
    $('photo-fov-val').textContent = `${fov}°`;
    $<HTMLInputElement>('photo-labels').checked = true;
    toast(this.app.view === 'system' ? 'Photo mode: O and T hide orbits and trails; P or Esc to leave.' : 'Photo mode: P or Esc to leave.');
  }

  bindPhoto(): void {
    $('btn-photo').addEventListener('click', () => this.togglePhoto());
    $('photo-exit').addEventListener('click', () => this.togglePhoto());
    const slider = (id: string, apply: (v: number) => void) => $<HTMLInputElement>(id).addEventListener('input', (e) => apply(Number((e.target as HTMLInputElement).value)));
    slider('photo-exposure', (v) => this.app.photo.setGrade({ exposure: v }));
    slider('photo-contrast', (v) => this.app.photo.setGrade({ contrast: v }));
    slider('photo-saturation', (v) => this.app.photo.setGrade({ saturation: v }));
    slider('photo-fov', (v) => {
      this.app.photo.setFov(v);
      $('photo-fov-val').textContent = `${v}°`;
    });
    $<HTMLInputElement>('photo-labels').addEventListener('change', (e) => this.app.photo.setLabels((e.target as HTMLInputElement).checked));
    $('photo-reset').addEventListener('click', () => {
      for (const id of ['photo-exposure', 'photo-contrast', 'photo-saturation']) $<HTMLInputElement>(id).value = '1';
      this.app.photo.setGrade({ exposure: 1, contrast: 1, saturation: 1 });
    });
    $('photo-capture').addEventListener('click', async () => {
      const scale = Number($<HTMLSelectElement>('photo-scale').value);
      try {
        const { width, height } = await this.app.photo.capture(scale);
        toast(`Saved a ${width} × ${height} picture.`);
      } catch (err) {
        toast(`Couldn't save the picture: ${(err as Error).message}`);
      }
    });
  }
}
