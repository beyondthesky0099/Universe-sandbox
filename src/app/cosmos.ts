import * as THREE from 'three';
import { seedFromString } from '../procgen/rng';
import { displayName, GALAXY_CREDIT, galaxyForm, loadLocalGalaxies, loadNamedGalaxies, loadWebGalaxies } from '../sim/galaxies';
import { MILKY_WAY_SEED } from '../procgen/galaxy';
import { fmt } from '../sim/units';
import { $, escapeHtml, setFacts, toast } from '../ui/dom';
import { sleep, cosmosFacts } from './shared';
import type { App } from '../app';

/** The Universe map: real galaxies beyond the Milky Way. */
export class CosmosUI {
  constructor(private readonly app: App) {}

  /** Open the Universe map, arriving at the galaxy we were just in when coming from a galaxy map. */
  async openCosmos(fromGalaxy: boolean): Promise<void> {
    if (this.app.transitioning) return;
    this.app.transitioning = true;
    try {
      if (fromGalaxy) {
        this.app.galaxy.controls.enabled = false;
        await sleep(150);
      }
      await this.app.fade(true);
      if (!this.app.cosmosLoaded) {
        try {
          const [local, named] = await Promise.all([loadLocalGalaxies(), loadNamedGalaxies()]);
          this.app.cosmos.setLocal([...local, ...named]);
          this.app.cosmosLoaded = true;
          $('cosmos-credit').textContent = GALAXY_CREDIT;
          this.updateCosmosInfo();
          new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/cmb.jpg`, (tex) => {
            this.app.cosmos.setCmb(tex);
            this.app.cosmos.setCmbVisible($<HTMLInputElement>('opt-cmb').checked);
          });
          void loadWebGalaxies()
            .then((web) => {
              this.app.cosmos.setWeb(web);
              this.app.cosmos.setWebVisible($<HTMLInputElement>('opt-cosmic-web').checked);
              this.updateCosmosInfo();
            })
            .catch((err: unknown) => toast((err as Error).message));
        } catch (err) {
          toast((err as Error).message);
          this.app.galaxy.controls.enabled = this.app.view === 'galaxy';
          await this.app.fade(false);
          return;
        }
      }
      this.app.setView('cosmos');
      const origin = this.app.cosmos.indexOf(this.app.galaxyOrigin || 'Milky Way');
      if (fromGalaxy && origin !== -1) {
        this.selectCosmos(origin);
        this.app.cosmos.arriveFrom(origin);
      }
      await sleep(60);
      await this.app.fade(false);
    } finally {
      this.app.transitioning = false;
    }
  }

  updateCosmosInfo(): void {
    const named = this.app.cosmos.local.filter((g) => g.zd).length;
    const n = this.app.cosmos.local.length - named;
    const web = this.app.cosmos.webCount;
    $('cosmos-info').textContent =
      `${n.toLocaleString('en-US')} real galaxies of the Local Volume (out to 85 million light-years) at their measured distances and true sizes, plus ${named} bright named galaxies beyond it (M87, the Sombrero, Fornax A…) placed by redshift` +
      (web ? `, and ${web.toLocaleString('en-US')} more tracing the cosmic web out to about 700 million light-years, placed by their redshift.` : '. Loading the cosmic web…') +
      ' Up close, each galaxy is drawn at its measured tilt and position angle (HyperLEDA) with a bulge, disc, arms and dust to suit its type; the arm pattern and which edge is nearer are illustrative.';
  }

  selectCosmos(index: number): void {
    this.app.cosmos.select(index);
    const panel = $('cosmos-galaxy-panel');
    if (index === -1) {
      panel.classList.add('hidden');
      return;
    }
    const g = this.app.cosmos.local[index];
    $('cosmos-galaxy-name').textContent = displayName(g);
    setFacts($('cosmos-galaxy-facts'), cosmosFacts(g));
    $('btn-cosmos-visit').textContent = g.name === 'Milky Way' ? 'Back to the Milky Way →' : 'Visit galaxy →';
    panel.classList.remove('hidden');
  }

  /** Go into a galaxy: the real Milky Way map, or a procedural stand-in shaped like the real galaxy. */
  async visitCosmosGalaxy(index: number): Promise<void> {
    const g = this.app.cosmos.local[index];
    if (!g || this.app.transitioning) return;
    this.app.transitioning = true;
    try {
      this.app.cosmos.flyTo(index, this.app.cosmos.viewDistance(index) * 0.08, 1.6);
      await sleep(420);
      await this.app.fade(true);
      if (g.name === 'Milky Way') {
        if (!this.app.galaxyBuilt || this.app.galaxySeed !== MILKY_WAY_SEED || this.app.galaxyOrigin !== 'Milky Way') this.app.galaxyMapUI.buildGalaxy(MILKY_WAY_SEED);
      } else {
        this.app.galaxyMapUI.buildGalaxy(seedFromString(`real:${g.name}`), { name: displayName(g), form: galaxyForm(g), origin: g.name });
      }
      this.app.setView('galaxy');
      await sleep(60);
      await this.app.fade(false);
      toast(g.name === 'Milky Way' ? 'Back home in the Milky Way' : `Arrived at ${displayName(g)}`);
    } finally {
      this.app.transitioning = false;
    }
  }

  renderCosmosSearch(): void {
    const q = $<HTMLInputElement>('cosmos-search').value.trim().toLowerCase().replace(/\s+/g, '');
    const list = $('cosmos-results');
    if (!q) {
      list.innerHTML = '';
      return;
    }
    const matches = this.app.cosmos.local
      .map((g, i) => ({ g, i, label: displayName(g) }))
      .filter(({ g, label }) => label.toLowerCase().replace(/\s+/g, '').includes(q) || g.name.toLowerCase().replace(/\s+/g, '').includes(q))
      .sort((a, b) => (b.g.lk ?? 0) - (a.g.lk ?? 0))
      .slice(0, 12);
    list.innerHTML = matches.length
      ? matches
          .map(({ g, i, label }) => `<li tabindex="0" data-galaxy="${i}"><span>${escapeHtml(label)}</span><span class="muted">${g.name === 'Milky Way' ? 'home' : `${fmt(g.d * 3.2616)} Mly`}</span></li>`)
          .join('')
      : '<li class="muted">No matching galaxies</li>';
  }
}
