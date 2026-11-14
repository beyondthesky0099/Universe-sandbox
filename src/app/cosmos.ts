import * as THREE from 'three';
import { seedFromString } from '../procgen/rng';
import { displayName, GALAXY_CREDIT, galaxyForm, loadLocalGalaxies, loadNamedGalaxies, loadUniverseObjects, loadUniverseRaw, loadWebGalaxies, markActiveHosts } from '../sim/galaxies';
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
          const [local, named, deep, raw] = await Promise.all([loadLocalGalaxies(), loadNamedGalaxies(), loadUniverseObjects(), loadUniverseRaw()]);
          // Named galaxies that are Seyferts, LINERs or blazars carry their nucleus (and black hole).
          markActiveHosts([...local, ...named], raw);
          this.app.cosmos.setLocal([...local, ...named, ...deep]);
          this.app.cosmos.setKindVisible('cluster', $<HTMLInputElement>('opt-cosmos-clusters').checked);
          this.app.cosmos.setKindVisible('quasar', $<HTMLInputElement>('opt-cosmos-quasars').checked);
          this.app.cosmos.setKindVisible('seyfert', $<HTMLInputElement>('opt-cosmos-seyferts').checked);
          this.app.cosmos.setKindVisible('blazar', $<HTMLInputElement>('opt-cosmos-blazars').checked);
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
    const all = this.app.cosmos.local;
    const clusters = all.filter((g) => g.kind === 'cluster').length;
    const quasars = all.filter((g) => g.kind === 'quasar').length;
    const seyferts = all.filter((g) => g.kind === 'seyfert').length;
    const blazars = all.filter((g) => g.kind === 'blazar').length;
    const hosts = all.filter((g) => g.agn).length;
    const named = all.filter((g) => g.zd && (g.kind ?? 'galaxy') === 'galaxy').length;
    const n = all.length - named - clusters - quasars - seyferts - blazars;
    const web = this.app.cosmos.webCount;
    $('cosmos-info').textContent =
      `${n.toLocaleString('en-US')} real galaxies of the Local Volume (out to 85 million light-years) at their measured distances and true sizes, plus ${named.toLocaleString('en-US')} named galaxies beyond it (every NGC, IC, UGC, ESO and Markarian galaxy in the 2MASS survey) placed by redshift` +
      (web ? `, and ${web.toLocaleString('en-US')} more tracing the cosmic web out to about 700 million light-years, placed by their redshift.` : '. Loading the cosmic web…') +
      ` Beyond that: ${clusters} rich galaxy clusters (Abell) and the active galactic nuclei of the Véron-Cetty & Véron catalogue: ${quasars.toLocaleString('en-US')} quasars and record holders (violet), out to the most distant galaxy known, ${seyferts.toLocaleString('en-US')} Seyfert galaxies and LINERs (magenta) and ${blazars} blazars (mint), each at the comoving distance for its redshift; ${hosts} of the named galaxies carry such a nucleus themselves, M87, M77 and Centaurus A among them, with the measured mass of the black hole where a paper has one.` +
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
    $('btn-cosmos-visit').textContent = g.name === 'Milky Way' ? 'Back to the Milky Way →' : g.kind === 'quasar' || g.kind === 'seyfert' || g.kind === 'blazar' ? 'Visit host galaxy →' : 'Visit galaxy →';
    // A cluster is a place to fly to, not a galaxy to enter.
    $('btn-cosmos-visit').classList.toggle('hidden', g.kind === 'cluster');
    panel.classList.remove('hidden');
  }

  /** Go into a galaxy: the real Milky Way map, or a procedural stand-in shaped like the real galaxy. */
  async visitCosmosGalaxy(index: number): Promise<void> {
    const g = this.app.cosmos.local[index];
    if (!g || this.app.transitioning || g.kind === 'cluster') return;
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
