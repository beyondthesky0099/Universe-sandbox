import * as THREE from 'three';
import { loadEclipses } from '../sim/eclipse';
import { galacticToCosmos, loadLocalGalaxies, loadNamedGalaxies } from '../sim/galaxies';
import { galacticToMap, MILKY_WAY_SEED, UNITS_PER_KPC } from '../procgen/galaxy';
import { loadClusters } from '../sim/clusters';
import { loadPulsars } from '../sim/pulsars';
import { loadGalacticObjects } from '../sim/galacticObjects';
import { loadNebulae } from '../sim/nebulae';
import { loadGwEvents } from '../sim/gwEvents';
import { loadFlybys } from '../sim/flybys';
import { loadVoyagerEncounters } from '../sim/voyager';
import { PRESETS } from '../sim/presets';
import { loadBrightStars, loadNearStars } from '../sim/stars';
import { $, escapeHtml, toast } from '../ui/dom';
import { CHALLENGES } from '../game/challenges';
import { LESSONS } from '../game/lessons';
import { SearchIndex, type SearchEntry } from '../ui/search';
import { activityEntries, clusterEntries, compactEntries, galacticObjectEntries, pulsarEntries, exoplanetEntries, galaxyEntries, nebulaEntries, skyBodyEntries, starEntries, structureEntries } from '../ui/searchSources';
import { kindLabel } from './shared';
import type { App } from '../app';

/** Search everything: the index, the overlay and going to a result. */
export class SearchUI {
  constructor(private readonly app: App) {}

  /** Every catalogue the app has, as one search index (built once, on first use). */
  buildSearchIndex(): Promise<SearchIndex> {
    this.app.searchIndex ??= (async () => {
      const safe = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
      const [nebulae, clusters, catalog, bright, near, local, named, compact, gw, flybys, voyager, eclipses, pulsars, objects] = await Promise.all([
        safe(loadNebulae(), []),
        safe(loadClusters(), []),
        safe(this.app.realDataUI.getCatalog(), undefined),
        safe(loadBrightStars(), []),
        safe(loadNearStars(), []),
        safe(loadLocalGalaxies(), []),
        safe(loadNamedGalaxies(), []),
        safe(
          fetch(`${import.meta.env.BASE_URL}data/compact-objects.json`).then((r) => r.json() as Promise<{ objects: Parameters<typeof compactEntries>[0] }>).then((d) => d.objects),
          [],
        ),
        safe(loadGwEvents(), []),
        safe(loadFlybys(), []),
        safe(loadVoyagerEncounters(), []),
        safe(loadEclipses(), []),
        safe(loadPulsars(), []),
        safe(loadGalacticObjects(), []),
      ]);
      const index = new SearchIndex();
      index.add(skyBodyEntries());
      index.add(starEntries(bright, near));
      index.add(nebulaEntries(nebulae));
      index.add(clusterEntries(clusters));
      index.add(compactEntries(compact));
      index.add(pulsarEntries(pulsars));
      index.add(galacticObjectEntries(objects));
      if (catalog) index.add(exoplanetEntries(catalog));
      index.add(galaxyEntries([...local, ...named]));
      index.add(structureEntries());
      index.add(activityEntries({ presets: PRESETS, lessons: LESSONS, challenges: CHALLENGES, gw, flybys, voyager, eclipses }));
      return index;
    })();
    return this.app.searchIndex;
  }

  openSearch(): void {
    $('search-overlay').classList.remove('hidden');
    const input = $<HTMLInputElement>('global-search');
    input.focus();
    input.select();
    $('global-search-status').textContent = 'Loading the catalogues…';
    void this.buildSearchIndex().then((index) => {
      $('global-search-status').textContent = `${index.size.toLocaleString('en-US')} things to find: stars, nebulae, clusters, black holes, exoplanets, galaxies, scenarios, lessons and more. ↑↓ to choose, Enter to go.`;
      this.renderSearch();
    });
  }

  closeSearch(): void {
    $('search-overlay').classList.add('hidden');
    $<HTMLInputElement>('global-search').blur();
  }

  async renderSearch(): Promise<void> {
    const q = $<HTMLInputElement>('global-search').value;
    const index = await this.buildSearchIndex();
    // The bodies in the current scene are searchable too.
    const scene: SearchEntry[] = this.app.sim.bodies
      .filter((b) => !/^Body \d+$/.test(b.name))
      .map((b) => ({ name: b.name, kind: 'In this scene', detail: kindLabel(b), rank: 100, action: { type: 'body', id: b.id } }));
    this.app.searchResults = q.trim() ? index.search(q, 40, scene) : [];
    this.app.searchActive = 0;
    $('global-results').innerHTML = this.app.searchResults.length
      ? this.app.searchResults
          .map((r, i) => `<li data-i="${i}" class="${i === 0 ? 'active' : ''}"><span class="kind">${escapeHtml(r.kind)}</span><span class="name">${escapeHtml(r.name)}</span><span class="detail">${escapeHtml(r.detail ?? '')}</span></li>`)
          .join('')
      : q.trim()
        ? '<li class="muted">Nothing found</li>'
        : '';
  }

  moveSearch(step: number): void {
    const items = $('global-results').querySelectorAll('li[data-i]');
    if (!items.length) return;
    items[this.app.searchActive]?.classList.remove('active');
    this.app.searchActive = (this.app.searchActive + step + items.length) % items.length;
    items[this.app.searchActive].classList.add('active');
    items[this.app.searchActive].scrollIntoView({ block: 'nearest' });
  }

  /** Go to a search result: switch to the right view and fly, turn or load. */
  async goToSearchResult(r: SearchEntry): Promise<void> {
    this.closeSearch();
    const a = r.action;
    switch (a.type) {
      case 'map': {
        if (!this.app.galaxyBuilt || this.app.galaxySeed !== MILKY_WAY_SEED || this.app.galaxyOrigin !== 'Milky Way') this.app.galaxyMapUI.buildGalaxy(MILKY_WAY_SEED);
        if (this.app.view !== 'galaxy') await this.app.switchView('galaxy');
        const size = ((a.sizePc ?? 0) / 1000) * UNITS_PER_KPC;
        // Pulsars and black holes: stop a little way off; zooming in (or Enter) opens them.
        this.app.travelUI.goGalaxyPoint(new THREE.Vector3(...galacticToMap(a.l, a.b, a.dKpc)), a.pulsar || a.blackHole || a.object ? 1 : Math.max(0.05, size * 4), r.name);
        // A pulsar: open its panel, with the button to visit it.
        const psr = a.pulsar ? this.app.pulsarMapList.findIndex((p) => p.jname === a.pulsar) : -1;
        if (psr >= 0) this.app.galaxyMapUI.selectTarget({ psr });
        const bh = a.blackHole ? this.app.blackHoleList.findIndex((o) => o.name === a.blackHole) : -1;
        if (bh >= 0) this.app.galaxyMapUI.selectTarget({ bh });
        const obj = a.object ? this.app.galacticObjectList.findIndex((o) => o.name === a.object) : -1;
        if (obj >= 0) this.app.galaxyMapUI.selectTarget({ obj });
        break;
      }
      case 'sky': {
        await this.app.skyUI.openSky();
        const alt = a.body ? this.app.sky.goToBody(a.body) : this.app.sky.goToSky(a.v, a.radiusDeg);
        if (a.body) this.app.skyPicked = a.body;
        this.app.skyUI.renderSkyList();
        toast(alt !== undefined && alt < 0 ? `${r.name} is below the horizon from here right now (change the place or time in the panel).` : `Turning to ${r.name}`);
        break;
      }
      case 'galaxy':
      case 'cosmos': {
        if (this.app.view !== 'cosmos') await this.app.cosmosUI.openCosmos(this.app.view === 'galaxy');
        if (a.type === 'galaxy') {
          const i = this.app.cosmos.indexOf(a.name);
          if (i >= 0) {
            this.app.cosmosUI.selectCosmos(i);
            this.app.travelUI.goCosmosGalaxy(i);
          }
        } else {
          this.app.travelUI.goCosmosPoint(new THREE.Vector3(...galacticToCosmos(a.l, a.b, a.dMpc)), a.dMpc < 1 ? 3 : 8, r.name);
        }
        break;
      }
      case 'body': {
        if (this.app.view !== 'system') await this.app.switchToSandbox();
        const body = this.app.sim.getBody(a.id);
        if (body) {
          this.app.selectBody(body);
          this.app.system.follow(body.id);
        }
        break;
      }
      case 'exo': {
        const host = (await this.app.realDataUI.getCatalog().catch(() => undefined))?.hosts.find((h) => h.name === a.host);
        if (!host) break;
        if (this.app.view !== 'system') await this.app.switchToSandbox();
        this.app.realDataUI.loadExoHost(host);
        break;
      }
      case 'preset': {
        const preset = PRESETS.find((p) => p.id === a.id);
        if (!preset) break;
        if (this.app.view !== 'system') await this.app.switchToSandbox();
        this.app.loadScenario({ name: preset.name, load: () => preset.load(this.app.sim), presetId: preset.id });
        break;
      }
      case 'lesson': {
        const def = LESSONS.find((l) => l.id === a.id);
        if (def) this.app.learningUI.startLesson(def);
        break;
      }
      case 'challenge': {
        const def = CHALLENGES.find((c) => c.id === a.id);
        if (!def) break;
        if (this.app.view !== 'system') await this.app.switchToSandbox();
        this.app.learningUI.startChallenge(def);
        break;
      }
      case 'gw':
      case 'flyby':
      case 'voyager': {
        // The same as choosing it in the Sandbox panel.
        if (this.app.view !== 'system') await this.app.switchToSandbox();
        const [select, button] = a.type === 'gw' ? ['gw-select', 'btn-gw-load'] : a.type === 'flyby' ? ['flyby-select', 'btn-flyby-load'] : ['voyager-select', 'btn-voyager-load'];
        $<HTMLSelectElement>(select).value = String(a.index);
        $(button).click();
        break;
      }
      case 'eclipse': {
        await this.app.skyUI.openSky();
        $<HTMLSelectElement>('eclipse-select').value = String(a.index);
        $('btn-eclipse').click();
        break;
      }
    }
  }
}
