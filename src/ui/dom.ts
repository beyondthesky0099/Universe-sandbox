export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export function setFacts(dl: HTMLElement, facts: [string, string][]): void {
  const html = facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');
  if (dl.innerHTML !== html) dl.innerHTML = html;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * A short notification. Long ones show a headline (`title`, or the first two lines) and the
 * full text on tap; an opened one stays until tapped again.
 */
export function toast(message: string, kind = '', title?: string): void {
  const container = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const long = !!title || message.length > 110;
  el.textContent = title ?? message;
  if (long) {
    el.classList.add('more');
    if (!title) el.classList.add('clamp');
    el.title = 'Tap for details';
  }
  container.appendChild(el);
  const max = window.innerWidth < 760 ? 2 : 4;
  while (container.children.length > max) container.firstElementChild!.remove();
  let open = false;
  let timer = 0;
  const fade = (ms: number) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    }, ms);
  };
  if (long) {
    el.addEventListener('click', () => {
      open = !open;
      el.textContent = open ? message : (title ?? message);
      el.classList.toggle('open', open);
      el.classList.toggle('clamp', !open && !title);
      if (open) clearTimeout(timer);
      else fade(1500);
    });
  }
  fade(long ? 4500 : 2800);
}

/** True if keyboard focus is in a text field, so global shortcuts should be ignored. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && ((t.tagName === 'INPUT' && ['text', 'search', 'number', 'email', 'url'].includes((t as HTMLInputElement).type)) || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
