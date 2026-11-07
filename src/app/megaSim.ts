import { $, toast } from '../ui/dom';
import { MegaSim, webgpuAvailable, type MegaScenario } from '../gpu/megaSim';
import type { App } from '../app';

/** The GPU mega-sim (WebGPU): opening, restarting and closing it. */
export class MegaSimUI {
  constructor(private readonly app: App) {}

  async openMegaSim(): Promise<void> {
    if (!webgpuAvailable()) return void toast('WebGPU isn’t available in this browser. Try a recent Chrome, Edge or Safari.');
    $('gpu-view').classList.remove('hidden');
    try {
      this.app.mega = new MegaSim($<HTMLCanvasElement>('gpu-canvas'));
      this.app.mega.onLost = (reason) => {
        this.closeMegaSim();
        toast(`The GPU stopped responding (${reason}). Try fewer stars.`);
      };
      await this.app.mega.init();
      this.restartMegaSim();
      this.app.mega.start();
      const update = () => {
        if (!this.app.mega) return;
        const s = this.app.mega.stats;
        $('gpu-stats').textContent = `${s.n.toLocaleString()} stars · ${s.fps.toFixed(0)} fps · ${(s.interactionsPerSecond / 1e9).toFixed(2)} billion interactions/s`;
        setTimeout(update, 500);
      };
      update();
    } catch (err) {
      this.closeMegaSim();
      toast((err as Error).message);
    }
  }

  restartMegaSim(): void {
    if (!this.app.mega) return;
    this.app.mega.stepsPerFrame = Number($<HTMLSelectElement>('gpu-steps').value);
    this.app.mega.reset(Number($<HTMLSelectElement>('gpu-n').value), $<HTMLSelectElement>('gpu-scenario').value as MegaScenario);
  }

  closeMegaSim(): void {
    this.app.mega?.destroy();
    this.app.mega = undefined;
    $('gpu-view').classList.add('hidden');
  }
}
