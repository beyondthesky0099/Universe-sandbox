import { loadNeighbourhood100, loadStars100 } from '../sim/gaia100';
import { loadSolarSystemOnDate } from '../sim/presets';
import { EXOPLANET_ACKNOWLEDGEMENT, loadCatalog, loadExoSystem, type ExoCatalog, type ExoHost } from '../sim/exoplanets';
import { loadNearStars, loadStarNeighbourhood } from '../sim/stars';
import { $, escapeHtml, toast } from '../ui/dom';
import { Scenario } from './shared';
import type { App } from '../app';

/** Real-data scenes: exoplanet systems, the solar neighbourhood and Gaia stars. */
export class RealDataUI {
  constructor(private readonly app: App) {}

  async getCatalog(): Promise<ExoCatalog> {
    if (this.app.catalog) return this.app.catalog;
    $('exo-status').textContent = 'Loading the NASA Exoplanet Archive catalogue…';
    this.app.catalog = await loadCatalog();
    return this.app.catalog;
  }

  async openExoBrowser(): Promise<void> {
    this.app.exoOpen = true;
    this.app.hideBodyPanel();
    $('exo-panel').classList.remove('hidden');
    $('exo-credit').textContent = EXOPLANET_ACKNOWLEDGEMENT;
    try {
      const c = await this.getCatalog();
      const planets = c.hosts.reduce((n, h) => n + h.planets.length, 0);
      $('exo-status').textContent = `${c.hosts.length.toLocaleString()} systems, ${planets.toLocaleString()} confirmed planets (retrieved ${c.retrieved}).`;
      this.renderExoList();
    } catch (err) {
      $('exo-status').textContent = (err as Error).message;
    }
  }

  closeExoBrowser(): void {
    this.app.exoOpen = false;
    $('exo-panel').classList.add('hidden');
  }

  renderExoList(): void {
    const c = this.app.catalog;
    if (!c) return;
    const q = $<HTMLInputElement>('exo-search').value.trim().toLowerCase();
    const filter = $<HTMLSelectElement>('exo-filter').value;
    let hosts = c.hosts.filter((h) => !q || h.name.toLowerCase().includes(q) || h.planets.some((p) => p.name.toLowerCase().includes(q)));
    if (filter === 'habitable') hosts = hosts.filter((h) => h.planets.some((p) => p.habitable));
    else if (filter === 'multi') hosts = hosts.filter((h) => h.planets.length >= 3);
    else if (filter === 'recent') hosts = [...hosts].sort((a, b) => Math.max(...b.planets.map((p) => p.year ?? 0)) - Math.max(...a.planets.map((p) => p.year ?? 0)));
    const shown = hosts.slice(0, 150);
    $('exo-list').innerHTML = shown.length
      ? shown
          .map((h) => {
            const ly = Number.isFinite(h.distancePc) ? `${(h.distancePc * 3.2616).toFixed(h.distancePc < 30 ? 1 : 0)} ly` : '? ly';
            const hab = h.planets.some((p) => p.habitable) ? '<span class="badge">temperate</span>' : '';
            return `<li tabindex="0" data-host="${escapeHtml(h.name)}"><span>${escapeHtml(h.name)}${hab}</span><span class="muted">${h.planets.length} pl · ${ly}</span></li>`;
          })
          .join('')
      : '<li class="muted">No matching systems</li>';
  }

  exoScenario(host: ExoHost): Scenario {
    const temperate = host.planets.filter((p) => p.habitable).length;
    const desc = `${host.name}: ${host.planets.length} confirmed planet${host.planets.length === 1 ? '' : 's'}${temperate ? `, ${temperate} temperate` : ''}, ${
      Number.isFinite(host.distancePc) ? `${(host.distancePc * 3.2616).toFixed(1)} light-years away` : 'distance unknown'
    }. Data: NASA Exoplanet Archive; masses marked as estimated come from radii. Body sizes are scaled to fit the orbits.`;
    return { name: host.name, description: desc, load: () => loadExoSystem(this.app.sim, host), origin: { kind: 'exo', host } };
  }

  loadExoHost(host: ExoHost): void {
    this.closeExoBrowser();
    this.app.loadScenario(this.exoScenario(host));
  }

  async loadNeighbourhoodScene(): Promise<void> {
    try {
      const [stars, c] = await Promise.all([loadNearStars(), this.getCatalog().catch(() => undefined)]);
      this.app.loadScenario({ name: 'the solar neighbourhood', load: () => loadStarNeighbourhood(this.app.sim, stars, c, 10), origin: { kind: 'neighbourhood' } });
      this.app.setView('system');
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async loadGaia100Scene(): Promise<void> {
    try {
      toast('Loading 44,500 Gaia stars…');
      const [data, near] = await Promise.all([loadStars100(), loadNearStars().catch(() => [])]);
      this.app.loadScenario({ name: 'stars within 326 light-years (Gaia)', load: () => loadNeighbourhood100(this.app.sim, data, near), origin: { kind: 'neighbourhood' } });
      this.app.setView('system');
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async visitSelected(): Promise<void> {
    const body = this.app.selectedBody();
    if (!body?.tag) return;
    if (body.tag === 'home') {
      this.app.loadScenario({ name: 'the Solar System', load: () => loadSolarSystemOnDate(this.app.sim, new Date()), origin: { kind: 'sol' } });
      return;
    }
    const name = body.tag.slice('exohost:'.length);
    const host = (await this.getCatalog()).hosts.find((h) => h.name === name);
    if (host) this.loadExoHost(host);
  }
}
