import { $, escapeHtml, toast } from '../ui/dom';
import { prefs } from '../ui/galaxyStore';
import type { App } from '../app';

/** The scripting console and plugins. */
export class ScriptingUI {
  constructor(private readonly app: App) {}

  consoleLog(text: string, kind: 'out' | 'error' = 'out'): void {
    const log = $('console-log');
    const line = document.createElement('div');
    if (kind === 'error') line.className = 'error';
    line.textContent = text;
    log.appendChild(line);
    while (log.childElementCount > 200) log.firstElementChild!.remove();
    log.scrollTop = log.scrollHeight;
    if (kind === 'error' && $('console-panel').classList.contains('hidden')) toast(`Script error: ${text}`);
  }

  plugins(): { name: string; code: string; autorun: boolean }[] {
    return prefs.get('plugins', [] as { name: string; code: string; autorun: boolean }[]);
  }

  renderPlugins(): void {
    $('plugin-list').innerHTML = this.plugins()
      .map(
        (p, i) =>
          `<li><span>🧩 ${escapeHtml(p.name)}</span><span><label class="muted small"><input type="checkbox" data-autorun="${i}" ${p.autorun ? 'checked' : ''}/> autorun</label> <button data-run="${i}">Run</button> <button data-edit="${i}">Edit</button> <button data-del="${i}" class="danger">✕</button></span></li>`,
      )
      .join('');
  }

  runAutorunPlugins(): void {
    for (const p of this.plugins()) if (p.autorun) this.app.scripts.run(p.code);
  }
}
