import { $ } from '../ui/dom';
import { mountWordmark } from '../ui/wordmark';
import { prefs } from '../ui/galaxyStore';
import type { App } from '../app';
import type { ViewName } from './shared';

/**
 * The interface frame around the 3D view:
 * - **Icon rail (left):** one button per pane of the current view's side panel (sections marked
 *   `data-pane`, with `data-icon` and `data-title`). One pane shows at a time; clicking the open
 *   one folds the panel away. Each view remembers its last pane.
 * - **More menu (top right):** the less frequent tools (lessons, challenges, graph, multiplayer,
 *   gallery, console, sound, tutorial).
 * - **Dock (bottom, Sandbox):** time, speed, tools and quick view toggles. The toggles mirror the
 *   Display checkboxes.
 * - **Inspector (right):** the selected body's panel, with a close button.
 *
 * On phones the rail becomes a bottom tab bar and panes open as sheets above it.
 */
export class LayoutUI {
  private view: ViewName = 'system';
  private collapsed = false;

  constructor(private readonly app: App) {}

  /**
   * The Beyond The Sky animated wordmark: in the top bar, and large on a short splash while
   * the app opens (skipped in embeds). The splash never blocks input and goes on any click or key.
   */
  private mountBrand(): void {
    mountWordmark($('wordmark'), 40);
    const splash = $('splash');
    if (new URLSearchParams(location.hash.slice(1)).has('embed')) {
      splash.remove();
      return;
    }
    const stop = mountWordmark(splash.querySelector<HTMLElement>('.splash-mark')!);
    let gone = false;
    const dismiss = () => {
      if (gone) return;
      gone = true;
      splash.classList.add('out');
      setTimeout(() => {
        stop();
        splash.remove();
      }, 800);
    };
    setTimeout(dismiss, 2500);
    window.addEventListener('pointerdown', dismiss, { once: true });
    window.addEventListener('keydown', dismiss, { once: true });
  }

  /** Wire the frame (call once, after the DOM is ready). */
  bind(): void {
    this.mountBrand();
    this.collapsed = window.innerWidth < 760;
    document.body.classList.toggle('rail-collapsed', this.collapsed);
    // More menu.
    const more = $('btn-more');
    const menu = $('more-menu');
    const setMenu = (open: boolean) => {
      menu.classList.toggle('hidden', !open);
      more.setAttribute('aria-expanded', String(open));
      more.classList.toggle('active', open);
    };
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      setMenu(menu.classList.contains('hidden'));
    });
    menu.addEventListener('click', () => setMenu(false));
    // Narrow screens move some top-bar buttons into the menu: those items press the originals.
    menu.querySelectorAll<HTMLElement>('[data-proxy]').forEach((item) => item.addEventListener('click', () => $(item.dataset.proxy!).click()));
    document.addEventListener('click', (e) => {
      if (!menu.classList.contains('hidden') && !(e.target as HTMLElement).closest('#more-menu')) setMenu(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setMenu(false);
    });
    // Dock toggles mirror their checkboxes.
    document.querySelectorAll<HTMLButtonElement>('#dock [data-toggle]').forEach((btn) => {
      const box = $<HTMLInputElement>(btn.dataset.toggle!);
      const sync = () => {
        btn.classList.toggle('active', box.checked);
        btn.setAttribute('aria-pressed', String(box.checked));
      };
      btn.addEventListener('click', () => {
        box.checked = !box.checked;
        box.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
      });
      box.addEventListener('change', sync);
      sync();
    });
    $('body-close').addEventListener('click', () => this.app.selectBody(undefined));
    // Travel controls (Galaxy Map, Universe): folded into a small 🚀 button until wanted.
    const travel = $('travel-bar');
    const setTravel = (open: boolean) => {
      travel.classList.toggle('open', open);
      $('travel-toggle').setAttribute('aria-expanded', String(open));
      prefs.set('travelOpen', open);
    };
    setTravel(prefs.get('travelOpen', false));
    $('travel-toggle').addEventListener('click', () => setTravel(true));
    $('travel-close').addEventListener('click', () => setTravel(false));
    // The old phone "panels" button (and its hidden-panels state) is replaced by the rail.
    $('btn-menu').classList.add('hidden');
    document.body.classList.remove('panels-hidden');
    window.addEventListener('resize', () => this.applyPanes());
  }

  /** The current view's side panel. */
  private panel(): HTMLElement | null {
    return document.querySelector<HTMLElement>(`.panel.left[data-view="${this.view}"]`);
  }

  private panes(): HTMLElement[] {
    const panel = this.panel();
    return panel ? [...panel.querySelectorAll<HTMLElement>('section[data-pane]')] : [];
  }

  private activePane(): string {
    const panes = this.panes();
    const saved = prefs.get<string>(`pane.${this.view}`, '');
    return panes.some((p) => p.dataset.pane === saved) ? saved : (panes[0]?.dataset.pane ?? '');
  }

  /** Rebuild the rail for a view (called by App.setView). */
  onView(view: ViewName): void {
    this.view = view;
    // (Not data-view: App.setView hides every [data-view] element that isn't the current view.)
    document.body.dataset.screen = view;
    const rail = $('rail');
    const panes = this.panes();
    rail.innerHTML = panes
      .map(
        (p) =>
          `<button class="rail-btn" data-pane="${p.dataset.pane}" title="${p.dataset.title}" aria-label="${p.dataset.title}"><span class="rail-icon">${p.dataset.icon}</span><span class="rail-label">${p.dataset.title}</span></button>`,
      )
      .join('');
    rail.querySelectorAll<HTMLButtonElement>('.rail-btn').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.pane!;
        if (id === this.activePane() && !this.collapsed) this.setCollapsed(true);
        else this.openPane(id);
      }),
    );
    rail.classList.toggle('hidden', panes.length === 0);
    this.applyPanes();
  }

  /** Show one pane of the current view's panel (and unfold the panel). */
  openPane(id: string): void {
    if (!this.panes().some((p) => p.dataset.pane === id)) return;
    prefs.set(`pane.${this.view}`, id);
    this.setCollapsed(false);
  }

  setCollapsed(on: boolean): void {
    this.collapsed = on;
    document.body.classList.toggle('rail-collapsed', on);
    this.applyPanes();
  }

  /** Open whichever pane holds the element matching `selector` (for the tutorial). */
  reveal(selector: string): void {
    const el = document.querySelector<HTMLElement>(selector);
    const pane = el?.closest<HTMLElement>('section[data-pane]');
    if (pane && pane.closest('.panel.left')?.getAttribute('data-view') === this.view) this.openPane(pane.dataset.pane!);
  }

  private applyPanes(): void {
    const active = this.activePane();
    for (const p of this.panes()) p.classList.toggle('pane-off', p.dataset.pane !== active);
    document.querySelectorAll<HTMLElement>('#rail .rail-btn').forEach((b) => b.classList.toggle('active', !this.collapsed && b.dataset.pane === active));
    const panel = this.panel();
    if (panel) panel.scrollTop = 0;
  }
}
