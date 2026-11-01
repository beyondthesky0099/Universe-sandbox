import { $ } from './dom';

export interface TutorialStep {
  title: string;
  body: string;
  /** CSS selector of the element to highlight. */
  target?: string;
  /** Called when the step is shown (e.g. to switch views). */
  enter?: () => void;
}

/** A small step-by-step overlay that highlights parts of the UI. */
export class Tutorial {
  private index = 0;
  private readonly root = $('tutorial');
  private onDone?: () => void;

  constructor(private readonly steps: TutorialStep[]) {
    $('tutorial-next').addEventListener('click', () => this.go(this.index + 1));
    $('tutorial-back').addEventListener('click', () => this.go(this.index - 1));
    $('tutorial-skip').addEventListener('click', () => this.close());
    window.addEventListener('resize', () => this.isOpen && this.position());
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') this.go(this.index + 1);
      else if (e.key === 'ArrowLeft') this.go(this.index - 1);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(onDone?: () => void): void {
    this.onDone = onDone;
    this.root.classList.remove('hidden');
    this.go(0);
  }

  close(): void {
    this.root.classList.add('hidden');
    this.onDone?.();
  }

  private go(i: number): void {
    if (i >= this.steps.length) return this.close();
    this.index = Math.max(0, i);
    const step = this.steps[this.index];
    step.enter?.();
    $('tutorial-step').textContent = `Step ${this.index + 1} of ${this.steps.length}`;
    $('tutorial-title').textContent = step.title;
    $('tutorial-body').textContent = step.body;
    $<HTMLButtonElement>('tutorial-back').disabled = this.index === 0;
    $('tutorial-next').textContent = this.index === this.steps.length - 1 ? 'Start exploring' : 'Next';
    // Let layout settle (views may have switched) before measuring.
    requestAnimationFrame(() => this.position());
  }

  private position(): void {
    const hl = $('tutorial-highlight');
    const step = this.steps[this.index];
    const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    if (!el || el.offsetParent === null) {
      hl.style.cssText = 'left:50%;top:40%;width:0;height:0;opacity:0';
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 6;
    hl.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;opacity:1`;
    // Keep the card away from the highlighted element.
    const card = this.root.querySelector<HTMLElement>('.tutorial-card')!;
    const nearBottom = r.bottom > window.innerHeight - 260;
    card.style.bottom = nearBottom ? '' : '70px';
    card.style.top = nearBottom ? '70px' : '';
  }
}
