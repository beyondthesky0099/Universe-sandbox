import * as THREE from 'three';
import { FEATURE, systemFeatures, type FeatureName } from '../procgen/galaxy';
import { generateStarSystem, starSummary } from '../procgen/starSystem';
import { type GalaxyTarget, type VolumeItem } from '../render/galaxyView';
import { equatorialToGalactic, galacticToMap, MILKY_WAY_SEED, MW_CLUSTERS, pictureAxes, UNITS_PER_KPC, type GalaxyOptions } from '../procgen/galaxy';
import { CLUSTER_COLORS, loadClusters } from '../sim/clusters';
import { clusterSwarms } from '../procgen/clusterStars';
import { diameterPc, loadNebulae, NEBULA_COLORS } from '../sim/nebulae';
import { loadNebulaImages, NEBULA_IMAGE_CREDIT, nebulaAtlasUrl, nebulaKey, tileRect, type NebulaImageAtlas } from '../sim/nebulaImages';
import type { Cloud } from '../render/nebulaClouds';
import { gaiaPoints, loadGaiaBright } from '../sim/gaiaBright';
import { isMillisecond, loadPulsars, pulsarName } from '../sim/pulsars';
import { characteristicAge, dipoleField, formatYears, sci } from '../sim/neutronStar';
import { fmt } from '../sim/units';
import { $, escapeHtml, setFacts, toast } from '../ui/dom';
import { LOW_POWER, sleep } from './shared';
import type { App } from '../app';

/** The Galaxy Map: building galaxies, real-data layers (nebulae, clusters, Gaia stars, exoplanet hosts), bookmarks, star search and filters. */
export class GalaxyMapUI {
  constructor(private readonly app: App) {}

  /** Real black holes and pulsars (positions from SIMBAD, distances from the discovery papers). */
  async showCompactObjectsOnMap(seed: number): Promise<void> {
    const res = await fetch(`${import.meta.env.BASE_URL}data/compact-objects.json`).catch(() => undefined);
    if (!res?.ok || this.app.galaxySeed !== seed) return;
    const { objects } = (await res.json()) as { objects: { name: string; kind: 'blackhole' | 'pulsar'; raDeg: number; decDeg: number; distanceKpc: number; mass?: number }[] };
    this.app.galaxy.addCompactObjects(
      objects.map((o) => {
        const [l, b] = equatorialToGalactic(o.raDeg, o.decDeg);
        const ly = Math.round((o.distanceKpc * 3261.6) / 10) * 10;
        const what = o.kind === 'blackhole' ? `black hole${o.mass ? ` · ${o.mass} M☉` : ''}` : 'pulsar';
        return { label: `${o.name} · ${what} · ${ly.toLocaleString('en-US')} ly`, pos: galacticToMap(l, b, o.distanceKpc), kind: o.kind };
      }),
    );
  }

  /**
   * Every Milky Way pulsar in the ATNF catalogue at its distance: young pulsars pale blue,
   * millisecond pulsars white, magnetars magenta. The famous ones are named.
   */
  async showPulsarsOnMap(seed: number): Promise<void> {
    const all = await loadPulsars().catch(() => undefined);
    if (!all || this.app.galaxySeed !== seed) return;
    // Already labelled as famous compact objects (compact-objects.json).
    const labelled = new Set(['J0835-4510', 'J0437-4715']);
    this.app.pulsarMapList = all;
    this.app.galaxy.pulsarPositions = all.map((p) => {
      const [l, b] = equatorialToGalactic(p.raDeg, p.decDeg);
      return galacticToMap(l, b, p.distanceKpc);
    });
    this.app.galaxy.setRealLayer(
      'pulsars',
      all.map((p, index) => {
        const [l, b] = equatorialToGalactic(p.raDeg, p.decDeg);
        const named = !labelled.has(p.jname) && (p.magnetar || !!p.snr || ['B0531+21', 'B1257+12', 'B1913+16', 'B1937+21'].includes(p.bname ?? ''));
        const ly = Math.round((p.distanceKpc * 3261.6) / 10) * 10;
        const what = p.magnetar ? 'magnetar' : isMillisecond(p) ? 'millisecond pulsar' : 'pulsar';
        const per = p.period < 1 ? `${(p.period * 1000).toPrecision(3)} ms` : `${p.period.toPrecision(3)} s`;
        return {
          pos: galacticToMap(l, b, p.distanceKpc),
          color: (p.magnetar ? [1, 0.45, 0.9] : isMillisecond(p) ? [0.9, 0.95, 1] : [0.55, 0.85, 1]) as [number, number, number],
          // A point source: a few pixels across from a few kiloparsecs away.
          size: 0.08,
          label: named ? `${pulsarName(p)}${p.snr ? ` (${p.snr})` : ''} · ${what} · ${per} · ${ly.toLocaleString('en-US')} ly` : undefined,
          labelColor: p.magnetar ? '#ff9de3' : '#b8f4ff',
          distance: 0.02,
          target: { psr: index },
        };
      }),
    );
    this.app.galaxy.setRealLayerVisible('pulsars', $<HTMLInputElement>('opt-real-pulsars').checked);
    const magnetars = all.filter((p) => p.magnetar).length;
    const msp = all.filter((p) => isMillisecond(p)).length;
    $('galaxy-info').textContent += ` ${all.length.toLocaleString('en-US')} real pulsars from the ATNF Pulsar Catalogue (blue; ${msp.toLocaleString('en-US')} millisecond pulsars in white, ${magnetars} magnetars in magenta) at their estimated distances, most from how much their radio pulses are smeared by free electrons on the way.`;
  }

  /** Real stars from Gaia DR3 around the Sun, at their measured distances (Milky Way only). */
  async showGaiaOnMap(seed: number): Promise<void> {
    const stars = await loadGaiaBright().catch(() => undefined);
    if (!stars || this.app.galaxySeed !== seed) return;
    this.app.galaxy.setGaiaStars(gaiaPoints(stars, galacticToMap, 0.012));
    this.app.galaxy.setGaiaVisible($<HTMLInputElement>('opt-gaia-stars').checked);
    $('galaxy-info').textContent += ` Around the Sun, ${stars.count.toLocaleString('en-US')} real stars from Gaia DR3 (every star brighter than magnitude 8 with a good parallax) sit at their measured distances.`;
  }

  /** Real open and globular star clusters at their measured distances (Milky Way only). */
  async showClustersOnMap(seed: number): Promise<void> {
    const all = await loadClusters().catch(() => undefined);
    if (!all || this.app.galaxySeed !== seed) return;
    // The hand-placed showpiece clusters already carry labels; don't name them twice.
    const shown = MW_CLUSTERS.map((c) => c.name.split(' (')[0].toLowerCase());
    this.app.galaxy.setRealLayer(
      'clusters',
      all.filter((c) => c.distancePc).map((c) => {
        const pc = 2 * (c.radiusPc ?? 2);
        const size = Math.max(c.kind === 'globular' ? 0.3 : 0.1, (pc / 1000) * UNITS_PER_KPC * 6);
        const named = c.name && !shown.some((s) => c.name!.toLowerCase().startsWith(s));
        const ly = Math.round((c.distancePc! * 3.2616) / 10) * 10;
        return {
          pos: galacticToMap(c.l, c.b, c.distancePc! / 1000),
          color: CLUSTER_COLORS[c.kind],
          size,
          label: named ? `${c.name} · ${ly.toLocaleString('en-US')} ly` : undefined,
          labelColor: '#ffe3a3',
          // Close enough for the cluster's stars to fill a good part of the view.
          distance: Math.max(0.22, ((c.radiusPc ?? 3) / 1000) * UNITS_PER_KPC * 15),
        };
      }),
    );
    this.app.galaxy.setRealLayerVisible('clusters', $<HTMLInputElement>('opt-real-clusters').checked);
    // The globulars and the larger open clusters as balls of stars at their real sizes (always shown).
    this.app.galaxy.setClusterSwarms(clusterSwarms(all, LOW_POWER ? 0.5 : 1));
    const count = (k: string) => all.filter((c) => c.kind === k).length.toLocaleString('en-US');
    $('galaxy-info').textContent += ` ${count('open')} open clusters and ${count('group')} moving groups from Gaia (gold), and ${count('globular')} globular clusters (orange), at their measured distances.`;
  }

  /**
   * Real nebulae with measured distances (Milky Way only), as clouds at their true size. Those the
   * survey plates capture show their real photographs (the named ones, and about 200 more on
   * desktops); the rest glow in their emission-line colours; dark nebulae dim the light
   * behind them.
   */
  async showNebulaeOnMap(seed: number): Promise<void> {
    const [all, images] = await Promise.all([loadNebulae().catch(() => undefined), loadNebulaImages().catch(() => undefined)]);
    if (!all || this.app.galaxySeed !== seed) return;
    // Phones load only the named nebulae's page (1 MB); desktops all of them.
    const pageCount = images ? (LOW_POWER ? 1 : images.pages.length) : 0;
    const atlases = await Promise.all(Array.from({ length: pageCount }, (_, p) => this.nebulaAtlas(images!, p).catch(() => undefined)));
    if (this.app.galaxySeed !== seed) return;
    const placed = all.filter((n) => n.distanceKpc);
    const imageOf = new Map((images?.images ?? []).filter((im) => atlases[im.page]).map((im) => [nebulaKey(im), im]));
    const perPage: Cloud[][] = atlases.map(() => []);
    const glow: Cloud[] = [];
    const dust: Cloud[] = [];
    const labels: { pos: [number, number, number]; label: string; color: string; size: number }[] = [];
    // Each nebula also becomes a ray-marched volume up close; the sets are [dust, glow, ...pages].
    const volumes: VolumeItem[] = [];
    let k = 0;
    for (const n of placed) {
      const pc = diameterPc(n) ?? (n.kind === 'pn' ? 0.5 : n.kind === 'snr' ? 20 : n.kind === 'refl' ? 1 : 5);
      const size = (pc / 1000) * UNITS_PER_KPC;
      const pos = galacticToMap(n.l, n.b, n.distanceKpc!);
      const color = NEBULA_COLORS[n.kind];
      const image = n.kind === 'dark' ? undefined : imageOf.get(nebulaKey(n));
      k++;
      if (image) {
        // The image spans 2.6 catalogue radii, but never less than 3 arcminutes: a small nebula
        // fills only the middle of its picture, so the picture is drawn at its true field.
        // A soft glow in the nebula's colour gives it depth.
        const named = image.page === 0;
        const page = images!.pages[image.page];
        const rect = tileRect(page, image.tile);
        const fieldSize = ((n.distanceKpc! * 1000 * Math.tan((image.fieldDeg * Math.PI) / 180)) / 1000) * UNITS_PER_KPC;
        const photoSize = Math.max(size * 1.3, fieldSize);
        // Up close it becomes a volume that looks like the photograph from Earth's direction.
        // A nebula only a few dozen survey pixels across (most planetary nebulae) is a burnt-out
        // blob on the plate; up close it becomes its modelled shape instead.
        const tiny = fieldSize > size * 1.3 * 1.5;
        volumes.push({
          center: pos,
          radius: tiny ? size * 0.6 : photoSize / 2,
          shape: tiny ? n.kind : 'photo',
          seed: k,
          photo: tiny ? undefined : { set: 2 + image.page, rect },
          axes: pictureAxes(n.l, n.b, n.distanceKpc!),
          fade: [[2 + image.page, perPage[image.page].length], [1, glow.length]],
        });
        perPage[image.page].push({ pos, size: photoSize, color, tile: rect, minPx: named ? 40 : 14, brightness: 1.1, rotation: 0, puff: 0 });
        glow.push({ pos, size: size * 1.6, color, minPx: named ? 50 : 18, brightness: 0.3, rotation: k, puff: k });
      } else {
        // A few overlapping puffs spread through the nebula's volume.
        const puffs = n.kind === 'pn' ? 1 : 3;
        const set = n.kind === 'dark' ? 0 : 1;
        const first = (n.kind === 'dark' ? dust : glow).length;
        volumes.push({ center: pos, radius: size * 0.6, shape: n.kind, seed: k, fade: Array.from({ length: puffs }, (_, p): [number, number] => [set, first + p]) });
        for (let p = 0; p < puffs; p++) {
          const h = Math.sin(k * 12.9898 + p * 78.233) * 43758.5453;
          const r = (h - Math.floor(h)) * 0.3 * size;
          const a = k * 2.399 + p * 2.1, e = (p - 1) * 0.7;
          const off: [number, number, number] = puffs > 1 ? [r * Math.cos(a) * Math.cos(e), r * Math.sin(e), r * Math.sin(a) * Math.cos(e)] : [0, 0, 0];
          (n.kind === 'dark' ? dust : glow).push({
            pos: [pos[0] + off[0], pos[1] + off[1], pos[2] + off[2]],
            size: size * (puffs > 1 ? 0.75 : 1),
            color,
            minPx: n.kind === 'pn' ? 3 : 4,
            // Lynds opacity class 6 is the darkest.
            brightness: n.kind === 'dark' ? 0.35 + 0.1 * (n.opacity ?? 3) : n.kind === 'hii' ? 0.8 : 0.9,
            rotation: k * 1.7 + p,
            puff: k + p,
          });
        }
      }
      if (n.name) {
        const ly = Math.round((n.distanceKpc! * 3261.6) / 10) * 10;
        labels.push({ pos, label: `${n.name} · ${ly.toLocaleString('en-US')} ly`, color: n.kind === 'dark' ? '#d9b99a' : '#ffb3c8', size });
      }
    }
    this.app.galaxy.setCloudLayer(
      'nebulae',
      [{ clouds: dust, absorb: true }, { clouds: glow }, ...perPage.map((clouds, p) => ({ clouds, atlas: atlases[p] }))],
      labels,
      volumes,
    );
    this.app.galaxy.setRealLayerVisible('nebulae', $<HTMLInputElement>('opt-real-nebulae').checked);
    const count = (kind: string) => placed.filter((n) => n.kind === kind).length.toLocaleString('en-US');
    const imaged = perPage.reduce((sum, list) => sum + list.length, 0);
    $('galaxy-info').textContent += ` ${count('hii')} real HII regions (pink: hydrogen-alpha), ${count('pn')} planetary nebulae (teal: oxygen III), ${count('snr')} supernova remnants, ${count('refl')} reflection nebulae (blue: scattered starlight) and ${count('dark')} dark dust clouds (at Gaia distances of their molecular clouds) sit at their measured distances and true sizes; ${imaged.toLocaleString('en-US')} of them show their real Digitized Sky Survey photographs. Star-forming regions trace the spiral arms. ${imaged ? NEBULA_IMAGE_CREDIT : ''}`;
  }

  /** A page of the nebula-image atlas as a texture (loaded once, shared by the galaxy map and the Sky tab). */
  nebulaAtlas(images: NebulaImageAtlas, page: number): Promise<THREE.Texture> {
    let p = this.app.atlasPromises.get(page);
    if (!p) {
      p = new THREE.TextureLoader().loadAsync(nebulaAtlasUrl(images.pages[page])).then((tex) => {
        tex.anisotropy = 4;
        return tex;
      });
      this.app.atlasPromises.set(page, p);
    }
    return p;
  }

  async showExoHostsOnMap(seed: number): Promise<void> {
    const catalog = await this.app.realDataUI.getCatalog().catch(() => undefined);
    if (!catalog || this.app.galaxySeed !== seed) return;
    const hosts = catalog.hosts.filter((h) => Number.isFinite(h.distancePc) && h.distancePc > 0);
    this.app.exoMapHosts = hosts;
    this.app.galaxy.setExoHosts(
      hosts.map((h) => {
        const [l, b] = equatorialToGalactic(h.raDeg, h.decDeg);
        return { name: h.name, pos: galacticToMap(l, b, h.distancePc / 1000), temperate: h.planets.some((p) => p.habitable) };
      }),
    );
    $('galaxy-info').textContent += ` Rings near the Sun mark ${hosts.length.toLocaleString('en-US')} real stars with known exoplanets (green: has a temperate planet); click one to visit it.`;
  }

  buildGalaxy(seed: number, opts: GalaxyOptions & { origin?: string } = {}): void {
    this.app.galaxySeed = seed;
    this.app.galaxyOrigin = seed === MILKY_WAY_SEED ? 'Milky Way' : (opts.origin ?? '');
    const data = this.app.galaxy.build(seed, opts);
    this.app.galaxyBuilt = true;
    this.app.features = undefined;
    this.app.scanToken++;
    this.app.store.load(seed);
    $('galaxy-name').textContent = data.name;
    $('galaxy-info').textContent =
      data.name === 'Milky Way'
        ? `Our galaxy: real structure (4 spiral arms, the Local Spur, the central bar, Sgr A*) and the real clusters and nebulae listed below at their true positions. The ${data.stars.count.toLocaleString()} explorable systems are procedural stand-ins for the ~100 billion real stars.`
        : opts.origin
          ? `A procedural stand-in for the real ${data.form} galaxy ${data.name}: its overall shape follows the real galaxy's type, but its ${data.stars.count.toLocaleString()} stars are invented. Zoom out to return to the Universe map.`
          : `${data.arms}-armed spiral · ${data.stars.count.toLocaleString()} explorable systems · ${data.clusters.length} star clusters (a procedural galaxy)`;
    this.app.exoMapHosts = [];
    if (data.name === 'Milky Way') {
      void this.showExoHostsOnMap(seed);
      void this.showCompactObjectsOnMap(seed);
      void this.showNebulaeOnMap(seed);
      void this.showClustersOnMap(seed);
      void this.showPulsarsOnMap(seed);
      void this.showGaiaOnMap(seed);
    }
    $<HTMLInputElement>('galaxy-seed').value = String(seed);
    $('star-panel').classList.add('hidden');
    $<HTMLSelectElement>('star-filter').value = '';
    $('filter-status').textContent = '';
    $('search-results').innerHTML = '';
    $<HTMLInputElement>('star-search').value = '';
    this.refreshMarkers();
    history.replaceState(null, '', `#galaxy=${seed}`);
  }

  refreshMarkers(): void {
    if (!this.app.galaxyBuilt) return;
    this.app.galaxy.setMarkers(this.app.store.bookmarkList, this.app.store.visitedList);
    this.renderBookmarks();
  }

  renderBookmarks(): void {
    const items = this.app.store.bookmarkList;
    $('bookmark-list').innerHTML = items
      .map((i) => `<li tabindex="0" data-index="${i}"><span>★ ${escapeHtml(this.app.galaxy.data.names[i])}</span><span class="muted">${starSummary(this.app.galaxy.data.stars.seeds[i]).spectralClass}-type</span></li>`)
      .join('');
  }

  selectTarget(target: GalaxyTarget | -1): void {
    this.app.galaxy.select(target);
    const panel = $('star-panel');
    $('btn-star-hear').classList.toggle('hidden', !(typeof target === 'object' && 'psr' in target));
    if (target === -1) {
      panel.classList.add('hidden');
      return;
    }
    const bookmarkBtn = $('btn-star-bookmark');
    $('btn-star-neighbourhood').classList.toggle('hidden', target !== 'sol');
    if (target === 'sol') {
      $('star-name').textContent = 'The Sun · you are here';
      setFacts($('star-facts'), [
        ['Class', 'G-type star'],
        ['Mass', '1 M☉'],
        ['Age', '4.6 Gyr'],
        ['Planets', '8 (real positions today)'],
        ['Neighbours', 'Thousands of known exoplanet systems'],
      ]);
      bookmarkBtn.classList.add('hidden');
      panel.classList.remove('hidden');
      return;
    }
    if (typeof target === 'object' && 'psr' in target) {
      const p = this.app.pulsarMapList[target.psr];
      const companion = p.pbDays && p.companionMass >= 1e-3
        ? `${p.companionMass >= 1.2 ? 'neutron star' : p.companionMass >= 0.08 ? 'white dwarf' : 'evaporating star'} (~${fmt(p.companionMass)} M☉), orbit ${p.pbDays < 2 ? `${fmt(p.pbDays * 24)} hours` : `${fmt(p.pbDays)} days`}`
        : p.pbDays ? 'planets' : 'none';
      $('star-name').textContent = `${pulsarName(p)}${p.snr ? ` (${p.snr})` : ''}`;
      setFacts($('star-facts'), [
        ['Type', p.magnetar ? 'Magnetar' : isMillisecond(p) ? 'Millisecond pulsar' : 'Pulsar'],
        ['Spin period', p.period < 1 ? `${fmt(p.period * 1000)} ms` : `${fmt(p.period)} s`],
        ...(p.pdot > 0 ? ([['Magnetic field', sci(dipoleField(p.period, p.pdot), 'G')], ['Characteristic age', formatYears(characteristicAge(p.period, p.pdot))]] as [string, string][]) : []),
        ['Companion', companion],
        ['Distance', `${fmt(p.distanceKpc * 3261.6)} light-years`],
        ['Source', 'ATNF Pulsar Catalogue'],
      ]);
      bookmarkBtn.classList.add('hidden');
      panel.classList.remove('hidden');
      return;
    }
    if (typeof target === 'object') {
      const host = this.app.exoMapHosts[target.exo];
      const temperate = host.planets.filter((p) => p.habitable).length;
      $('star-name').textContent = host.name;
      setFacts($('star-facts'), [
        ['Type', 'Real star with known exoplanets'],
        ['Distance', `${fmt(host.distancePc * 3.2616)} light-years`],
        ['Star mass', Number.isFinite(host.massSun) ? `${fmt(host.massSun)} M☉` : 'unknown'],
        ['Temperature', host.teffK ? `${Math.round(host.teffK).toLocaleString()} K` : 'unknown'],
        ['Confirmed planets', String(host.planets.length)],
        ['Temperate planets', String(temperate)],
        ['Source', 'NASA Exoplanet Archive'],
      ]);
      bookmarkBtn.classList.add('hidden');
      panel.classList.remove('hidden');
      return;
    }
    if (target === 'core') {
      $('star-name').textContent = 'Heart of the Galaxy';
      setFacts($('star-facts'), [
        ['Type', 'Supermassive black hole'],
        ['Mass', '400,000 M☉'],
        ['Event horizon (game)', '~6 AU'],
        ['Orbiting stars', '29'],
        ['Also', 'An infalling gas cloud, and one star on a disruption course'],
      ]);
      bookmarkBtn.classList.add('hidden');
    } else {
      const spec = generateStarSystem(this.app.galaxy.data.stars.seeds[target]);
      $('star-name').textContent = spec.star.name;
      const moons = spec.planets.reduce((n, p) => n + p.moons.length, 0);
      setFacts($('star-facts'), [
        ['Class', `${spec.star.spectralClass}-type star`],
        ['Mass', `${fmt(spec.star.mass)} M☉`],
        ['Temperature', `${Math.round(spec.star.temperature).toLocaleString()} K`],
        ['Planets', String(spec.planets.length)],
        ['Gas giants', String(spec.planets.filter((p) => p.kind === 'gas').length)],
        ['Habitable worlds', String(spec.habitableCount)],
        ['Moons', String(moons)],
        ['Asteroid belt', spec.belt ? 'Yes' : 'No'],
        ['Companion', spec.companion ? `${spec.companion.spectralClass}-type at ${fmt(spec.companion.a)} AU` : 'None'],
        ['Visited', this.app.store.isVisited(target) ? 'Yes' : 'Not yet'],
      ]);
      bookmarkBtn.classList.remove('hidden');
      bookmarkBtn.textContent = this.app.store.isBookmarked(target) ? '★ Bookmarked' : '☆ Bookmark';
    }
    panel.classList.remove('hidden');
  }

  toggleBookmark(): void {
    const t = this.app.galaxy.selected;
    if (typeof t !== 'number' || t === -1) return;
    const on = this.app.store.toggleBookmark(t);
    toast(on ? `Bookmarked ${this.app.galaxy.data.names[t]}` : 'Bookmark removed');
    this.refreshMarkers();
    this.selectTarget(t);
    if ($<HTMLSelectElement>('star-filter').value === 'bookmarked') void this.applyFilter();
  }

  search(query: string): void {
    const list = $('search-results');
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !this.app.galaxyBuilt) {
      list.innerHTML = '';
      return;
    }
    const names = this.app.galaxy.data.names;
    const starts: number[] = [];
    const contains: number[] = [];
    for (let i = 0; i < names.length && starts.length < 8; i++) {
      const n = names[i].toLowerCase();
      if (n.startsWith(q)) starts.push(i);
      else if (contains.length < 8 && n.includes(q)) contains.push(i);
    }
    const hits = [...starts, ...contains].slice(0, 8);
    list.innerHTML = hits.length
      ? hits
          .map((i) => `<li tabindex="0" data-index="${i}"><span>${escapeHtml(names[i])}</span><span class="muted">${starSummary(this.app.galaxy.data.stars.seeds[i]).spectralClass}-type</span></li>`)
          .join('')
      : '<li class="muted">No matches</li>';
  }

  /** Compute feature flags for every star, in chunks so the UI stays responsive. */
  async ensureFeatures(): Promise<Uint8Array | undefined> {
    if (this.app.features) return this.app.features;
    const token = ++this.app.scanToken;
    const seeds = this.app.galaxy.data.stars.seeds;
    const out = new Uint8Array(seeds.length);
    const status = $('filter-status');
    for (let start = 0; start < seeds.length; start += 1500) {
      if (token !== this.app.scanToken) return undefined;
      const end = Math.min(seeds.length, start + 1500);
      for (let i = start; i < end; i++) out[i] = systemFeatures(seeds[i]);
      status.textContent = `Surveying systems… ${Math.round((end / seeds.length) * 100)}%`;
      await sleep(0);
    }
    this.app.features = out;
    return out;
  }

  async applyFilter(): Promise<void> {
    const value = $<HTMLSelectElement>('star-filter').value;
    const status = $('filter-status');
    if (!value) {
      this.app.galaxy.setFilter(null);
      status.textContent = '';
      return;
    }
    let match: (i: number) => boolean;
    if (value === 'bookmarked') match = (i) => this.app.store.isBookmarked(i);
    else if (value === 'visited') match = (i) => this.app.store.isVisited(i);
    else {
      const features = await this.ensureFeatures();
      if (!features || $<HTMLSelectElement>('star-filter').value !== value) return;
      const flag = FEATURE[value as FeatureName];
      match = (i) => (features[i] & flag) !== 0;
    }
    let count = 0;
    for (let i = 0; i < this.app.galaxy.data.stars.count; i++) if (match(i)) count++;
    this.app.galaxy.setFilter(match);
    status.textContent = `${count.toLocaleString()} matching systems highlighted.`;
  }
}
