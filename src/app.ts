import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { AudioEngine } from './audio';
import { FEATURE, systemFeatures, type FeatureName } from './procgen/galaxy';
import { mulberry32, pick, seedFromString } from './procgen/rng';
import { generateStarSystem, starSummary, type StarSystemSpec } from './procgen/starSystem';
import { GalaxyView, type GalaxyTarget } from './render/galaxyView';
import { QUALITY_PRESETS, SystemView } from './render/systemView';
import { isCompact, kindForMass, mainSequenceLifetime, mergedKind, NEUTRON_MAX_MASS, radiusFor, type Body, type BodyKind } from './sim/body';
import { isTidallyLocked, nearResonance, orbitalPeriod } from './sim/analysis';
import { bodyTemperature, climateFor, formatTemperature, isHabitable } from './sim/climate';
import { GAS_PALETTE, ROCKY_PALETTE, starTemperature } from './sim/color';
import { forecast, type Forecast } from './sim/forecast';
import { SimHost } from './sim/host';
import { circularOrbitVelocity } from './sim/orbits';
import { predictPath } from './sim/predict';
import { galacticCore, loadStarSystem, PRESETS, type SceneSetup } from './sim/presets';
import { type SimEvent } from './sim/simulation';
import { captureState, restoreState } from './sim/state';
import { EARTH_MASS, fmt, formatDistance, formatMass, formatSpeed, formatTime, G, JUPITER_MASS } from './sim/units';
import { $, escapeHtml, isTyping, setFacts, toast } from './ui/dom';
import { GalaxyStore, prefs } from './ui/galaxyStore';
import { History } from './ui/history';
import { decodeScene, downloadJson, encodeScene, readSceneFile, type SceneFile } from './ui/share';
import { Tutorial } from './ui/tutorial';

type ViewName = 'galaxy' | 'system';
type Tool = 'select' | 'spawn';
type QualityName = keyof typeof QUALITY_PRESETS;

interface SpawnType {
  id: string;
  label: string;
  kind?: BodyKind;
  mass: number;
  swatch: string;
  palette?: number[];
  /** Spawns a cloud of particles instead of a body. */
  particles?: number;
}

const SPAWN_TYPES: SpawnType[] = [
  { id: 'asteroid', label: 'Asteroid', kind: 'rocky', mass: 0.01 * EARTH_MASS, swatch: '#8a8f99', palette: ROCKY_PALETTE },
  { id: 'rocky', label: 'Rocky planet', kind: 'rocky', mass: EARTH_MASS, swatch: '#4f8fd0', palette: ROCKY_PALETTE },
  { id: 'gas', label: 'Gas giant', kind: 'gas', mass: JUPITER_MASS, swatch: '#d8b48a', palette: GAS_PALETTE },
  { id: 'reddwarf', label: 'Red dwarf', kind: 'star', mass: 0.2, swatch: '#ffb36b' },
  { id: 'sun', label: 'Yellow star', kind: 'star', mass: 1, swatch: '#fff1d8' },
  { id: 'bluegiant', label: 'Blue giant', kind: 'star', mass: 15, swatch: '#a9c4ff' },
  { id: 'giant', label: 'Red giant', kind: 'giant', mass: 1.2, swatch: '#ff8a4a' },
  { id: 'whitedwarf', label: 'White dwarf', kind: 'whitedwarf', mass: 0.6, swatch: '#eaf2ff' },
  { id: 'neutron', label: 'Neutron star', kind: 'neutron', mass: 1.4, swatch: '#cfe6ff' },
  { id: 'blackhole', label: 'Black hole', kind: 'blackhole', mass: 10, swatch: '#b07cff' },
  { id: 'cloud', label: 'Dust cloud', mass: 0, swatch: '#c8a27a', particles: 500 },
];

interface SpawnDrag {
  start: THREE.Vector3;
  current: THREE.Vector3;
  planeY: number;
  lastPredict: number;
  path?: Float32Array;
}

/** Where the current sandbox scene came from. */
type Origin = { kind: 'star'; index: number; spec: StarSystemSpec } | { kind: 'core' };

interface Scenario {
  name: string;
  load: () => SceneSetup;
  presetId?: string;
  origin?: Origin;
}

const AUTO_EXIT_DISTANCE = 40000; // AU: zooming out this far returns to the galaxy map
const AUTO_ENTER_DISTANCE = 0.6; // galaxy units: zooming this close to a selected star enters it

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class App {
  private readonly canvas = $<HTMLCanvasElement>('scene');
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer = new CSS2DRenderer({ element: $('labels') });
  private readonly host: SimHost;
  private readonly system: SystemView;
  private readonly galaxy: GalaxyView;
  private readonly audio = new AudioEngine();
  private readonly history = new History();
  private readonly store = new GalaxyStore();
  private readonly tutorial: Tutorial;
  private view: ViewName = 'system';
  private tool: Tool = 'select';
  private spawnType = SPAWN_TYPES[1];
  private spawnMassFactor = 1;
  private autoOrbit = true;
  private running = true;
  private timeScale = 0.4;
  private galaxyBuilt = false;
  private galaxySeed = 1;
  private scenario: Scenario = { name: PRESETS[0].name, load: () => PRESETS[0].load(this.sim), presetId: PRESETS[0].id };
  private spawnDrag?: SpawnDrag;
  private pointerDown?: { x: number; y: number; button: number; time: number };
  private lastTap?: { x: number; y: number; time: number };
  private spawnCounter = 0;
  private width = 1;
  private height = 1;
  private frames = 0;
  private fpsTime = 0;
  private fps = 0;
  private lastMergeToast = 0;
  private transitioning = false;
  private snapshotTimer = 0;
  private forecastTimer = 0;
  private forecastResult?: Forecast;
  private rewindTimer?: number;
  private wasRunningBeforeRewind = false;
  private features?: Uint8Array;
  private scanToken = 0;
  private quality: QualityName = prefs.get<QualityName>('quality', 'medium');

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setClearColor(0x02030a);
    const params = new URLSearchParams(location.hash.slice(1));
    this.host = new SimHost(params.get('worker') !== '0');
    this.system = new SystemView(this.sim, this.canvas, QUALITY_PRESETS[this.quality]);
    this.galaxy = new GalaxyView(this.canvas);
    this.tutorial = new Tutorial(this.tutorialSteps());

    const hashSeed = params.get('galaxy');
    this.galaxySeed = hashSeed ? seedFromString(hashSeed) : 1;

    if (window.innerWidth < 760) document.body.classList.add('panels-hidden');
    this.bindUi();
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.applyQuality(this.quality);

    this.loadScenario(this.scenario, { undoable: false });
    this.setView('system');
    this.setTool('select');
    if (prefs.get('sound', false)) this.armSoundOnGesture();

    const scene = params.get('scene');
    if (scene) {
      decodeScene(scene)
        .then((s) => this.applyScene(s, false))
        .catch((err) => toast(`Couldn't open shared scene: ${(err as Error).message}`));
    }
    if (!prefs.get('tutorialDone', false) && params.get('tour') !== '0') setTimeout(() => this.openTutorial(), 1200);

    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private get sim() {
    return this.host.sim;
  }

  // ---------------------------------------------------------------------------
  // Frame loop

  private frame(dt: number): void {
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.frames / this.fpsTime;
      this.frames = 0;
      this.fpsTime = 0;
    }

    if (this.view === 'system') {
      const active = this.running && this.rewindTimer === undefined;
      const events = this.host.advance(active ? this.timeScale * dt : 0, 12);
      this.handleEvents(events);
      if (this.spawnDrag) this.updateSpawnPreview(performance.now());
      this.system.update(dt, this.height, active, events);
      this.renderer.render(this.system.scene, this.system.camera);
      this.labelRenderer.render(this.system.scene, this.system.camera);

      if (active) {
        this.snapshotTimer -= dt;
        if (this.snapshotTimer <= 0) {
          this.snapshotTimer = 0.5;
          this.history.record(captureState(this.sim));
        }
      }
      this.forecastTimer -= dt;
      if (this.forecastTimer <= 0) {
        this.forecastTimer = 1;
        this.updateForecast();
      }
      if (this.frames % 6 === 0) this.updateSystemHud();
      if (!this.transitioning && this.system.cameraDistance > AUTO_EXIT_DISTANCE) void this.exitToGalaxy();
    } else {
      this.galaxy.update(dt);
      this.renderer.render(this.galaxy.scene, this.galaxy.camera);
      if (this.frames % 15 === 0) $('stats').textContent = `${Math.round(this.fps)} fps`;
      const sel = this.galaxy.selected;
      if (
        !this.transitioning &&
        sel !== -1 &&
        !this.galaxy.animating &&
        this.galaxy.cameraDistance < AUTO_ENTER_DISTANCE &&
        this.galaxy.controls.target.distanceTo(this.galaxy.targetPosition(sel)) < 1
      ) {
        void this.enterTarget(sel);
      }
    }
  }

  private handleEvents(events: SimEvent[]): void {
    const now = performance.now();
    for (const e of events) {
      this.audio.play(e.type, e.size);
      if (e.type === 'merge') {
        if (now - this.lastMergeToast > 1500 && this.sim.bodies.length <= 40) {
          toast(e.message);
          this.lastMergeToast = now;
        }
      } else if (e.type === 'shatter') {
        if (now - this.lastMergeToast > 800) {
          toast(e.message);
          this.lastMergeToast = now;
        }
      } else {
        toast(e.message, e.type === 'collapse' || e.type === 'supernova' ? 'collapse' : e.type === 'ignite' ? 'ignite' : '');
      }
    }
  }

  private resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.labelRenderer.setSize(this.width, this.height);
    this.system.setViewport(this.width, this.height);
    this.galaxy.setViewport(this.width, this.height, this.renderer.getPixelRatio());
  }

  private applyQuality(q: QualityName): void {
    this.quality = q;
    prefs.set('quality', q);
    const preset = QUALITY_PRESETS[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
    this.system.setQuality(preset);
    $<HTMLSelectElement>('quality').value = q;
    this.resize();
  }

  // ---------------------------------------------------------------------------
  // Views, transitions and scenarios

  private setView(view: ViewName): void {
    if (view === 'galaxy' && !this.galaxyBuilt) this.buildGalaxy(this.galaxySeed);
    this.view = view;
    this.system.controls.enabled = view === 'system';
    this.galaxy.controls.enabled = view === 'galaxy';
    if (view === 'galaxy') this.cancelSpawn();
    $('tab-galaxy').classList.toggle('active', view === 'galaxy');
    $('tab-system').classList.toggle('active', view === 'system');
    $('labels').classList.toggle('hidden', view !== 'system');
    document.querySelectorAll<HTMLElement>('[data-view]').forEach((el) => {
      const match = el.dataset.view === view;
      if (el.id === 'star-panel') el.classList.toggle('hidden', !match || this.galaxy.selected === -1);
      else if (el.id === 'body-panel') el.classList.toggle('hidden', !match || this.system.selectedId === undefined);
      else el.classList.toggle('hidden', !match);
    });
    this.updateHint();
  }

  private async fade(on: boolean): Promise<void> {
    $('fade').classList.toggle('on', on);
    await sleep(420);
  }

  /** Warp from the galaxy map into a star system (or the galactic core). */
  private async enterTarget(target: GalaxyTarget): Promise<void> {
    if (this.transitioning) return;
    this.transitioning = true;
    try {
      this.galaxy.flyTo(target, 0.35, 1.5);
      await sleep(450);
      await this.fade(true);
      let scenario: Scenario;
      if (target === 'core') {
        scenario = { name: galacticCore.name, load: () => galacticCore.load(this.sim), presetId: galacticCore.id, origin: { kind: 'core' } };
      } else {
        const spec = generateStarSystem(this.galaxy.data.stars.seeds[target]);
        scenario = { name: spec.star.name, load: () => loadStarSystem(this.sim, spec), origin: { kind: 'star', index: target, spec } };
        this.store.markVisited(target);
        this.refreshMarkers();
      }
      this.loadScenario(scenario, { zoomFrom: 30 });
      this.setView('system');
      await sleep(60);
      await this.fade(false);
      toast(`Arrived at ${scenario.name}`);
    } finally {
      this.transitioning = false;
    }
  }

  /** Pull back from the sandbox to the galaxy map, arriving at the origin star if any. */
  private async exitToGalaxy(): Promise<void> {
    if (this.transitioning) return;
    this.transitioning = true;
    try {
      const camPos = this.system.camera.position.clone();
      const camTarget = this.system.controls.target.clone();
      if (this.view === 'system') {
        this.system.zoomOut(30, 1.6);
        await sleep(250);
      }
      await this.fade(true);
      // Restore the sandbox camera so returning later doesn't immediately warp out again.
      const offset = camPos.clone().sub(camTarget);
      if (offset.length() > AUTO_EXIT_DISTANCE * 0.5) offset.setLength(AUTO_EXIT_DISTANCE * 0.1);
      this.system.camera.position.copy(camTarget).add(offset);
      this.system.controls.target.copy(camTarget);
      this.system.stopCameraAnimation();
      this.setView('galaxy');
      const origin = this.scenario.origin;
      const target: GalaxyTarget | undefined = origin?.kind === 'core' ? 'core' : origin?.kind === 'star' ? origin.index : undefined;
      if (target !== undefined) {
        this.selectTarget(target);
        this.galaxy.arriveFrom(target, 0.3, 12);
      }
      await sleep(60);
      await this.fade(false);
    } finally {
      this.transitioning = false;
    }
  }

  private async switchToSandbox(): Promise<void> {
    if (this.transitioning || this.view === 'system') return;
    this.transitioning = true;
    try {
      await this.fade(true);
      this.setView('system');
      await this.fade(false);
    } finally {
      this.transitioning = false;
    }
  }

  private resetPhysicsDefaults(): void {
    Object.assign(this.sim, {
      dtMax: 0.01,
      softening: 1e-4,
      gravityScale: 1,
      collisions: true,
      debris: true,
      tidal: true,
      shatter: true,
      gravityMode: 'auto',
      relativity: false,
      lightSpeedScale: 1,
      evolutionRate: 1,
    });
  }

  private loadScenario(sc: Scenario, opts: { zoomFrom?: number; undoable?: boolean } = {}): void {
    const { zoomFrom = 1, undoable = true } = opts;
    if (undoable && this.sim.bodies.length) this.history.push(captureState(this.sim), `loading ${sc.name}`);
    this.cancelSpawn();
    this.sim.clear();
    this.resetPhysicsDefaults();
    this.scenario = sc;
    const setup = sc.load();
    this.host.commit();
    this.history.clearTimeline();
    this.system.reset(setup, zoomFrom);
    this.setTimeScale(setup.timeScale);
    this.syncSettingsUi();
    this.hideBodyPanel();
    this.forecastResult = undefined;

    const select = $<HTMLSelectElement>('preset-select');
    select.value = sc.presetId ?? '';
    if (sc.presetId) $('preset-desc').textContent = PRESETS.find((p) => p.id === sc.presetId)?.description ?? '';
    $('origin').classList.toggle('hidden', !sc.origin);
    if (sc.origin?.kind === 'star') {
      $('origin-name').textContent = sc.origin.spec.star.name;
      $('preset-desc').textContent = describeSystem(sc.origin.spec);
    } else if (sc.origin?.kind === 'core') {
      $('origin-name').textContent = 'the galactic core';
    }
    if (setup.focus) {
      const body = this.sim.bodies.find((b) => b.name === setup.focus);
      if (body) {
        this.selectBody(body);
        this.system.follow(body.id);
      }
    }
    if (setup.tip) setTimeout(() => toast(setup.tip!), 600);
    this.updateUndoButtons();
  }

  private buildGalaxy(seed: number): void {
    this.galaxySeed = seed;
    const data = this.galaxy.build(seed);
    this.galaxyBuilt = true;
    this.features = undefined;
    this.scanToken++;
    this.store.load(seed);
    $('galaxy-name').textContent = data.name;
    $('galaxy-info').textContent = `${data.arms}-armed spiral · ${data.stars.count.toLocaleString()} explorable systems · ${data.clusters.length} star clusters`;
    $<HTMLInputElement>('galaxy-seed').value = String(seed);
    $('star-panel').classList.add('hidden');
    $<HTMLSelectElement>('star-filter').value = '';
    $('filter-status').textContent = '';
    $('search-results').innerHTML = '';
    $<HTMLInputElement>('star-search').value = '';
    this.refreshMarkers();
    history.replaceState(null, '', `#galaxy=${seed}`);
  }

  private refreshMarkers(): void {
    if (!this.galaxyBuilt) return;
    this.galaxy.setMarkers(this.store.bookmarkList, this.store.visitedList);
    this.renderBookmarks();
  }

  private renderBookmarks(): void {
    const items = this.store.bookmarkList;
    $('bookmark-list').innerHTML = items
      .map((i) => `<li tabindex="0" data-index="${i}"><span>★ ${escapeHtml(this.galaxy.data.names[i])}</span><span class="muted">${starSummary(this.galaxy.data.stars.seeds[i]).spectralClass}-type</span></li>`)
      .join('');
  }

  private selectTarget(target: GalaxyTarget | -1): void {
    this.galaxy.select(target);
    const panel = $('star-panel');
    if (target === -1) {
      panel.classList.add('hidden');
      return;
    }
    const bookmarkBtn = $('btn-star-bookmark');
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
      const spec = generateStarSystem(this.galaxy.data.stars.seeds[target]);
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
        ['Visited', this.store.isVisited(target) ? 'Yes' : 'Not yet'],
      ]);
      bookmarkBtn.classList.remove('hidden');
      bookmarkBtn.textContent = this.store.isBookmarked(target) ? '★ Bookmarked' : '☆ Bookmark';
    }
    panel.classList.remove('hidden');
  }

  private toggleBookmark(): void {
    const t = this.galaxy.selected;
    if (t === -1 || t === 'core') return;
    const on = this.store.toggleBookmark(t);
    toast(on ? `Bookmarked ${this.galaxy.data.names[t]}` : 'Bookmark removed');
    this.refreshMarkers();
    this.selectTarget(t);
    if ($<HTMLSelectElement>('star-filter').value === 'bookmarked') void this.applyFilter();
  }

  private search(query: string): void {
    const list = $('search-results');
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !this.galaxyBuilt) {
      list.innerHTML = '';
      return;
    }
    const names = this.galaxy.data.names;
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
          .map((i) => `<li tabindex="0" data-index="${i}"><span>${escapeHtml(names[i])}</span><span class="muted">${starSummary(this.galaxy.data.stars.seeds[i]).spectralClass}-type</span></li>`)
          .join('')
      : '<li class="muted">No matches</li>';
  }

  /** Compute feature flags for every star, in chunks so the UI stays responsive. */
  private async ensureFeatures(): Promise<Uint8Array | undefined> {
    if (this.features) return this.features;
    const token = ++this.scanToken;
    const seeds = this.galaxy.data.stars.seeds;
    const out = new Uint8Array(seeds.length);
    const status = $('filter-status');
    for (let start = 0; start < seeds.length; start += 1500) {
      if (token !== this.scanToken) return undefined;
      const end = Math.min(seeds.length, start + 1500);
      for (let i = start; i < end; i++) out[i] = systemFeatures(seeds[i]);
      status.textContent = `Surveying systems… ${Math.round((end / seeds.length) * 100)}%`;
      await sleep(0);
    }
    this.features = out;
    return out;
  }

  private async applyFilter(): Promise<void> {
    const value = $<HTMLSelectElement>('star-filter').value;
    const status = $('filter-status');
    if (!value) {
      this.galaxy.setFilter(null);
      status.textContent = '';
      return;
    }
    let match: (i: number) => boolean;
    if (value === 'bookmarked') match = (i) => this.store.isBookmarked(i);
    else if (value === 'visited') match = (i) => this.store.isVisited(i);
    else {
      const features = await this.ensureFeatures();
      if (!features || $<HTMLSelectElement>('star-filter').value !== value) return;
      const flag = FEATURE[value as FeatureName];
      match = (i) => (features[i] & flag) !== 0;
    }
    let count = 0;
    for (let i = 0; i < this.galaxy.data.stars.count; i++) if (match(i)) count++;
    this.galaxy.setFilter(match);
    status.textContent = `${count.toLocaleString()} matching systems highlighted.`;
  }

  private setTimeScale(yearsPerSecond: number): void {
    this.timeScale = yearsPerSecond;
    $<HTMLInputElement>('time-scale').value = String(Math.log10(yearsPerSecond));
    $('time-scale-out').textContent = formatRate(yearsPerSecond);
  }

  private setRunning(running: boolean): void {
    this.running = running;
    $('btn-play').textContent = running ? '⏸' : '▶';
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.cancelSpawn();
    $('tool-select').classList.toggle('active', tool === 'select');
    $('tool-spawn').classList.toggle('active', tool === 'spawn');
    $('spawn-options').classList.toggle('hidden', tool !== 'spawn');
    const mb = this.system.controls.mouseButtons;
    const touches = this.system.controls.touches;
    if (tool === 'spawn') {
      mb.LEFT = null;
      mb.RIGHT = THREE.MOUSE.ROTATE;
      touches.ONE = null;
    } else {
      mb.LEFT = THREE.MOUSE.ROTATE;
      mb.RIGHT = THREE.MOUSE.PAN;
      touches.ONE = THREE.TOUCH.ROTATE;
    }
    this.updateHint();
  }

  private updateHint(): void {
    let text: string;
    if (this.view === 'galaxy') text = 'Click a star to inspect · Double-click to fly there · Zoom right in (or Enter) to visit · B bookmark';
    else if (this.tool === 'spawn') text = 'Click to place · Drag to set velocity · Right-drag to orbit camera · Esc to cancel';
    else text = 'Click to select · Double-click to follow · Space pause · Hold R rewind · Ctrl+Z undo · B spawn · M galaxy map';
    $('hint').textContent = text;
  }

  private syncSettingsUi(): void {
    const s = this.sim;
    $<HTMLInputElement>('gravity').value = String(s.gravityScale);
    $('gravity-out').textContent = s.gravityScale.toFixed(2);
    $<HTMLInputElement>('opt-collisions').checked = s.collisions;
    $<HTMLInputElement>('opt-debris').checked = s.debris;
    $<HTMLInputElement>('opt-shatter').checked = s.shatter;
    $<HTMLInputElement>('opt-tidal').checked = s.tidal;
    $<HTMLInputElement>('opt-relativity').checked = s.relativity;
    $<HTMLInputElement>('light-speed').value = String(Math.log10(s.lightSpeedScale));
    $('light-speed-out').textContent = formatFactor(s.lightSpeedScale);
    $<HTMLInputElement>('evolution').value = String(Math.log10(Math.max(1, s.evolutionRate)));
    $('evolution-out').textContent = formatEvolution(s.evolutionRate);
  }

  // ---------------------------------------------------------------------------
  // Mutations, history, saving

  /** Run a main-thread change to the simulation, recording undo state and syncing the worker. */
  private mutate(label: string, fn: () => void): void {
    this.history.push(captureState(this.sim), label);
    fn();
    this.host.commit();
    this.updateUndoButtons();
  }

  private restore(state: ReturnType<typeof captureState>): void {
    // The rewind buffer belongs to the timeline we're leaving.
    this.history.clearTimeline();
    restoreState(this.sim, state);
    this.host.commit();
    this.system.clearTrails();
    if (this.system.selectedId !== undefined && !this.sim.getBody(this.system.selectedId)) this.hideBodyPanel();
    this.syncSettingsUi();
  }

  private undo(): void {
    const entry = this.history.undo(captureState(this.sim));
    if (!entry) return;
    this.restore(entry.state);
    toast(`Undid ${entry.label}`);
    this.updateUndoButtons();
  }

  private redo(): void {
    const entry = this.history.redo(captureState(this.sim));
    if (!entry) return;
    this.restore(entry.state);
    toast(`Redid ${entry.label}`);
    this.updateUndoButtons();
  }

  private updateUndoButtons(): void {
    $<HTMLButtonElement>('btn-undo').disabled = !this.history.canUndo;
    $<HTMLButtonElement>('btn-redo').disabled = !this.history.canRedo;
  }

  private startRewind(): void {
    if (this.rewindTimer !== undefined || this.view !== 'system') return;
    this.wasRunningBeforeRewind = this.running;
    const step = () => {
      const s = this.history.rewind(this.sim.time);
      if (!s) {
        toast('Reached the start of the rewind buffer');
        this.stopRewind();
        return;
      }
      restoreState(this.sim, s);
      this.host.commit();
      this.system.clearTrails();
    };
    this.rewindTimer = window.setInterval(step, 90);
    $('btn-rewind').classList.add('active');
    step();
  }

  private stopRewind(): void {
    if (this.rewindTimer === undefined) return;
    clearInterval(this.rewindTimer);
    this.rewindTimer = undefined;
    $('btn-rewind').classList.remove('active');
    this.setRunning(this.wasRunningBeforeRewind);
  }

  private makeSceneFile(includeParticles: boolean): SceneFile {
    return {
      app: 'astrarium',
      version: 1,
      savedAt: new Date().toISOString(),
      name: this.scenario.name,
      timeScale: this.timeScale,
      camera: {
        position: this.system.camera.position.toArray() as [number, number, number],
        target: this.system.controls.target.toArray() as [number, number, number],
      },
      state: captureState(this.sim, { json: true, particles: includeParticles }),
    };
  }

  private applyScene(scene: SceneFile, undoable = true): void {
    const dist = scene.camera ? new THREE.Vector3(...scene.camera.position).distanceTo(new THREE.Vector3(...scene.camera.target)) : 10;
    this.loadScenario(
      {
        name: scene.name ?? 'Saved scene',
        load: () => {
          restoreState(this.sim, scene.state);
          return { cameraDistance: dist, timeScale: scene.timeScale };
        },
      },
      { undoable },
    );
    if (scene.camera) {
      this.system.camera.position.set(...scene.camera.position);
      this.system.controls.target.set(...scene.camera.target);
    }
    $('preset-desc').textContent = `Loaded "${scene.name ?? 'scene'}"${scene.savedAt ? ` (saved ${new Date(scene.savedAt).toLocaleString()})` : ''}.`;
    this.setView('system');
    toast(`Loaded ${scene.name ?? 'scene'}`);
  }

  private saveFile(): void {
    const scene = this.makeSceneFile(true);
    const slug = (scene.name ?? 'scene').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadJson(`astrarium-${slug}.json`, scene);
    toast('Scene saved');
  }

  private async shareLink(): Promise<void> {
    const scene = this.makeSceneFile(false);
    const code = await encodeScene(scene);
    const url = `${location.origin}${location.pathname}#scene=${code}`;
    const note = this.sim.particles.count ? ' (particles are left out of links; use Save to keep them)' : '';
    try {
      await navigator.clipboard.writeText(url);
      toast(`Link copied to clipboard${note}`);
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  // ---------------------------------------------------------------------------
  // Selection and the body panel

  private selectBody(body: Body | undefined): void {
    this.system.selectedId = body?.id;
    this.forecastResult = undefined;
    this.system.showApproach(undefined);
    if (!body) {
      this.hideBodyPanel();
      return;
    }
    $('body-panel').classList.remove('hidden');
    this.forecastTimer = 0;
    this.updateBodyPanel();
  }

  private hideBodyPanel(): void {
    this.system.selectedId = undefined;
    this.system.showApproach(undefined);
    $('body-panel').classList.add('hidden');
  }

  private updateForecast(): void {
    const body = this.selectedBody();
    if (!body) return;
    const parent = this.sim.parentOf(body);
    let horizon = 10;
    if (parent) {
      const mu = this.sim.effectiveG * (parent.mass + body.mass);
      const r = Math.hypot(body.x - parent.x, body.y - parent.y, body.z - parent.z);
      const v2 = (body.vx - parent.vx) ** 2 + (body.vy - parent.vy) ** 2 + (body.vz - parent.vz) ** 2;
      const energy = v2 / 2 - mu / r;
      if (energy < 0 && mu > 0) {
        const a = -mu / (2 * energy);
        horizon = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
      }
    }
    horizon = Math.min(Math.max(horizon, 0.05), 200);
    this.forecastResult = forecast(this.sim, body.id, horizon, 25, 6000);
    this.system.showApproach(this.forecastResult.impact ?? this.closeApproach(this.forecastResult));
  }

  /** Closest approach worth highlighting (close relative to the bodies' sizes). */
  private closeApproach(f: Forecast) {
    const a = f.closest;
    if (!a) return undefined;
    const body = this.selectedBody();
    const other = this.sim.getBody(a.otherId);
    if (!body || !other) return undefined;
    return a.distance < 25 * (body.radius + other.radius) ? a : undefined;
  }

  private selectedBody(): Body | undefined {
    return this.system.selectedId !== undefined ? this.sim.getBody(this.system.selectedId) : undefined;
  }

  private updateSystemHud(): void {
    $('sim-time').textContent = formatTime(this.sim.time);
    const status = this.host.getStatus();
    $('lag').classList.toggle('hidden', !status.lagging);
    const n = this.sim.bodies.length;
    $('stats').textContent = `${Math.round(this.fps)} fps · ${n.toLocaleString()} bodies · ${this.sim.particles.count.toLocaleString()} particles`;
    $('engine-info').textContent = `Physics: ${status.threaded ? 'Web Worker' : 'main thread'} · Gravity: ${status.usingTree ? 'Barnes–Hut tree' : 'direct N²'}`;
    // The selected body may have merged, shattered or been torn apart since last frame.
    if (this.selectedBody()) this.updateBodyPanel();
    else if (!$('body-panel').classList.contains('hidden')) this.hideBodyPanel();
    const followed = this.system.followId !== undefined && this.system.followId === this.system.selectedId;
    $('btn-follow').textContent = followed ? 'Unfollow' : 'Follow';
  }

  private updateBodyPanel(): void {
    const body = this.selectedBody();
    if (!body) return;
    $('body-name').textContent = body.name;
    const facts: [string, string][] = [
      ['Type', kindLabel(body)],
      ['Mass', formatMass(body.mass)],
      ['Radius (game)', formatDistance(body.radius)],
    ];
    const alerts: string[] = [];
    if (body.kind === 'rocky' || body.kind === 'gas') {
      const t = bodyTemperature(this.sim.bodies, body);
      facts.push(['Temperature', formatTemperature(t)], ['Climate', capitalize(climateFor(body.kind, t))]);
      if (isHabitable(body.kind, body.mass, t)) alerts.push(`<div class="alert good">🌍 Habitable: liquid water could exist on the surface.</div>`);
    } else if (body.kind === 'star') {
      facts.push(['Surface temp.', `${Math.round(starTemperature(body.mass)).toLocaleString()} K`]);
    }
    if (body.kind === 'star' || body.kind === 'giant' || body.kind === 'whitedwarf') {
      facts.push(['Age', formatAge(body.age)]);
      if (body.kind === 'star') {
        const left = mainSequenceLifetime(body.mass) - body.age;
        facts.push(['Main sequence left', left > 0 ? formatAge(left) : 'ending']);
      }
    }
    const parent = this.sim.parentOf(body);
    if (parent) {
      const dx = body.x - parent.x, dy = body.y - parent.y, dz = body.z - parent.z;
      const dvx = body.vx - parent.vx, dvy = body.vy - parent.vy, dvz = body.vz - parent.vz;
      const r = Math.hypot(dx, dy, dz);
      const v2 = dvx * dvx + dvy * dvy + dvz * dvz;
      const mu = this.sim.effectiveG * (parent.mass + body.mass);
      const energy = v2 / 2 - mu / r;
      facts.push(['Orbiting', parent.name], ['Distance', formatDistance(r)], ['Relative speed', formatSpeed(Math.sqrt(v2))]);
      if (energy < 0 && mu > 0) {
        const a = -mu / (2 * energy);
        const hx = dy * dvz - dz * dvy, hy = dz * dvx - dx * dvz, hz = dx * dvy - dy * dvx;
        const h2 = hx * hx + hy * hy + hz * hz;
        const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h2) / (mu * mu)));
        facts.push(['Orbit', `a = ${fmt(a)} AU, e = ${e.toFixed(2)}`], ['Period', formatTime(2 * Math.PI * Math.sqrt((a * a * a) / mu))]);
      } else {
        facts.push(['Orbit', 'Unbound (escaping)']);
      }
      if (isTidallyLocked(body, parent, r)) facts.push(['Rotation', 'Tidally locked']);
      const myPeriod = orbitalPeriod(body, parent, this.sim.gravityScale);
      if (myPeriod) {
        for (const other of this.sim.bodies) {
          if (other === body || other === parent || other.mass < body.mass * 1e-3) continue;
          if (this.sim.parentOf(other) !== parent) continue;
          const p = orbitalPeriod(other, parent, this.sim.gravityScale);
          const res = p ? nearResonance(myPeriod, p) : undefined;
          if (res) {
            alerts.push(`<div class="alert good">🎵 In ${res[0]}:${res[1]} orbital resonance with ${escapeHtml(other.name)}.</div>`);
            break;
          }
        }
      }
      const roche = this.sim.rocheLimit(parent, body);
      if (r < roche * 1.5 && parent.mass > body.mass * 5 && !isCompact(body.kind)) {
        alerts.push(`<div class="alert warn">Close to ${escapeHtml(parent.name)}'s Roche limit (${fmt(roche)} AU): tides may tear it apart.</div>`);
      }
    } else {
      facts.push(['Speed', formatSpeed(Math.hypot(body.vx, body.vy, body.vz))]);
    }
    const fuse = this.sim.fuses.get(body.id);
    if (fuse !== undefined) alerts.push(`<div class="alert danger">💥 Goes supernova in ${formatTime(Math.max(0, fuse - this.sim.time))}.</div>`);
    const f = this.forecastResult;
    if (f?.impact) {
      alerts.push(`<div class="alert danger">⚠ Collision course with <b>${escapeHtml(f.impact.otherName)}</b> in ${formatTime(f.impact.time)}.</div>`);
    } else if (f?.closest) {
      const close = this.closeApproach(f);
      alerts.push(
        `<div class="${close ? 'alert warn' : 'muted small'}">Closest approach (next ${formatTime(f.horizon)}): ${escapeHtml(f.closest.otherName)}, ${fmt(f.closest.distance)} AU in ${formatTime(f.closest.time)}.</div>`,
      );
    }
    setFacts($('body-facts'), facts);
    const html = alerts.join('');
    const alertsEl = $('body-alerts');
    if (alertsEl.innerHTML !== html) alertsEl.innerHTML = html;
    $('btn-supernova').classList.toggle('hidden', !this.sim.canSupernova(body));
  }

  private deleteSelected(): void {
    const id = this.system.selectedId;
    if (id === undefined) return;
    const name = this.sim.getBody(id)?.name ?? 'body';
    if (this.system.followId === id) this.system.follow(undefined);
    this.mutate(`deleting ${name}`, () => this.sim.removeBody(id));
    this.hideBodyPanel();
  }

  private scaleSelectedMass(factor: number): void {
    const body = this.selectedBody();
    if (!body) return;
    const before = body.kind;
    this.mutate(`changing ${body.name}'s mass`, () => {
      this.sim.setBodyMass(body, body.mass * factor);
      if (body.kind !== before && body.kind === 'gas') body.color = GAS_PALETTE[0];
      else if (body.kind !== before && body.kind === 'rocky') body.color = ROCKY_PALETTE[0];
    });
    if (body.kind !== before && (body.kind === 'rocky' || body.kind === 'gas')) toast(`${body.name} is now a ${kindLabel(body).toLowerCase()}`);
    this.updateBodyPanel();
  }

  private detonateSelected(): void {
    const body = this.selectedBody();
    if (!body || !this.sim.canSupernova(body)) return;
    this.mutate(`${body.name}'s supernova`, () => this.sim.supernova(body));
  }

  private toggleFollow(): void {
    const id = this.system.selectedId;
    if (id === undefined) return;
    this.system.follow(this.system.followId === id ? undefined : id);
  }

  // ---------------------------------------------------------------------------
  // Spawning

  private spawnVelocity(drag: SpawnDrag): { velocity: THREE.Vector3; perUnit: number } {
    const p = drag.start;
    const followed = this.system.followId !== undefined ? this.sim.getBody(this.system.followId) : undefined;
    const dominant = this.sim.dominantBodyAt(p.x, p.y, p.z);
    const base = new THREE.Vector3();
    if (this.autoOrbit && dominant) {
      const v = circularOrbitVelocity(dominant, p.x, p.y, p.z, this.sim.gravityScale, this.spawnType.particles ? 0 : this.spawnMass());
      base.set(v.x, v.y, v.z);
    } else if (followed) {
      base.set(followed.vx, followed.vy, followed.vz);
    } else if (dominant) {
      base.set(dominant.vx, dominant.vy, dominant.vz);
    }
    // Dragging a distance equal to the distance from the dominant body adds about the local circular speed.
    let perUnit = 1;
    if (dominant) {
      const r = Math.max(1e-3, Math.hypot(p.x - dominant.x, p.y - dominant.y, p.z - dominant.z));
      perUnit = Math.sqrt((G * Math.max(this.sim.gravityScale, 0.05) * dominant.mass) / (r * r * r));
    }
    const dragV = drag.current.clone().sub(drag.start).multiplyScalar(perUnit);
    return { velocity: base.add(dragV), perUnit };
  }

  private spawnMass(): number {
    return this.spawnType.mass * this.spawnMassFactor;
  }

  private spawnKind(): BodyKind {
    const t = this.spawnType;
    const mass = this.spawnMass();
    if (t.kind === 'blackhole') return 'blackhole';
    if (t.kind === 'neutron') return mass >= NEUTRON_MAX_MASS ? 'blackhole' : 'neutron';
    if (t.kind === 'whitedwarf') return 'whitedwarf';
    if (t.kind === 'giant') return mass >= 50 ? 'blackhole' : 'giant';
    const natural = kindForMass(mass);
    // Respect the chosen type unless the mass multiplier pushes it across a physical threshold.
    if (t.kind === 'rocky' && natural === 'gas') return 'rocky';
    return mergedKind(natural, natural, mass);
  }

  private updateSpawnPreview(now: number): void {
    const drag = this.spawnDrag;
    if (!drag) return;
    const { velocity, perUnit } = this.spawnVelocity(drag);
    const kind = this.spawnKind();
    const radius = this.spawnType.particles ? 0 : radiusFor(kind, this.spawnMass());
    if (now - drag.lastPredict > 50) {
      drag.lastPredict = now;
      drag.path = predictPath(this.sim, {
        mass: Math.max(this.spawnMass(), 1e-12),
        kind,
        radius,
        x: drag.start.x,
        y: drag.start.y,
        z: drag.start.z,
        vx: velocity.x,
        vy: velocity.y,
        vz: velocity.z,
      });
    }
    const rel = velocity.clone();
    const dominant = this.sim.dominantBodyAt(drag.start.x, drag.start.y, drag.start.z);
    if (dominant) rel.sub(new THREE.Vector3(dominant.vx, dominant.vy, dominant.vz));
    this.system.showSpawnPreview(drag.start, radius, rel, 0.25 / perUnit, drag.path);
  }

  private cancelSpawn(): void {
    this.spawnDrag = undefined;
    this.system.hideSpawnPreview();
  }

  private commitSpawn(): void {
    const drag = this.spawnDrag;
    this.cancelSpawn();
    if (!drag) return;
    const { velocity } = this.spawnVelocity(drag);
    const t = this.spawnType;
    const p = drag.start;
    if (t.particles) {
      const count = t.particles;
      this.mutate('adding a dust cloud', () => {
        const dominant = this.sim.dominantBodyAt(p.x, p.y, p.z);
        const r = dominant ? Math.hypot(p.x - dominant.x, p.y - dominant.y, p.z - dominant.z) : 1;
        const size = Math.max(0.02, r * 0.06);
        const dispersion = velocity.clone().sub(dominant ? new THREE.Vector3(dominant.vx, dominant.vy, dominant.vz) : new THREE.Vector3()).length() * 0.04;
        for (let i = 0; i < count; i++) {
          const u = new THREE.Vector3().randomDirection().multiplyScalar(size * Math.cbrt(Math.random()));
          const shade = 0.7 + Math.random() * 0.4;
          this.sim.particles.add(
            p.x + u.x, p.y + u.y * 0.4, p.z + u.z,
            velocity.x + (Math.random() - 0.5) * dispersion,
            velocity.y + (Math.random() - 0.5) * dispersion * 0.3,
            velocity.z + (Math.random() - 0.5) * dispersion,
            [0.78 * shade, 0.64 * shade, 0.48 * shade],
          );
        }
      });
      return;
    }
    const rng = mulberry32((Date.now() ^ (this.spawnCounter * 2654435761)) >>> 0);
    const kind = this.spawnKind();
    this.spawnCounter++;
    let body: Body | undefined;
    this.mutate(`spawning a ${t.label.toLowerCase()}`, () => {
      body = this.sim.addBody({
        name: `${t.label} ${this.spawnCounter}`,
        kind,
        mass: this.spawnMass(),
        color: kind === 'rocky' || kind === 'gas' ? pick(rng, kind === 'gas' ? GAS_PALETTE : t.palette ?? ROCKY_PALETTE) : undefined,
        x: p.x,
        y: p.y,
        z: p.z,
        vx: velocity.x,
        vy: velocity.y,
        vz: velocity.z,
      });
    });
    this.selectBody(body);
  }

  // ---------------------------------------------------------------------------
  // Input

  private ndc(e: { clientX: number; clientY: number }): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1];
  }

  private armSoundOnGesture(): void {
    const enable = () => {
      this.setSound(true);
      window.removeEventListener('pointerdown', enable);
      window.removeEventListener('keydown', enable);
    };
    window.addEventListener('pointerdown', enable);
    window.addEventListener('keydown', enable);
  }

  private setSound(on: boolean): void {
    this.audio.setEnabled(on);
    prefs.set('sound', on);
    $('btn-sound').textContent = on ? '🔊' : '🔇';
  }

  private handleClick(e: { clientX: number; clientY: number }): void {
    const [x, y] = this.ndc(e);
    if (this.view === 'system' && this.tool === 'select') {
      this.selectBody(this.system.pick(x, y, this.width, this.height));
    } else if (this.view === 'galaxy') {
      this.selectTarget(this.galaxy.pick(x, y, this.width, this.height));
    }
  }

  private handleDoubleClick(e: { clientX: number; clientY: number }): void {
    const [x, y] = this.ndc(e);
    if (this.view === 'galaxy') {
      const target = this.galaxy.pick(x, y, this.width, this.height);
      if (target !== -1) {
        this.selectTarget(target);
        this.galaxy.flyTo(target);
      }
    } else if (this.tool === 'select') {
      const body = this.system.pick(x, y, this.width, this.height);
      if (body) {
        this.selectBody(body);
        this.system.follow(body.id);
      }
    }
  }

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY, button: e.button, time: performance.now() };
      if (this.view === 'system' && this.tool === 'spawn' && e.button === 0 && e.isPrimary) {
        const followed = this.system.followId !== undefined ? this.sim.getBody(this.system.followId) : undefined;
        const planeY = followed?.y ?? 0;
        const [x, y] = this.ndc(e);
        const point = this.system.planePoint(x, y, planeY);
        if (point) {
          this.spawnDrag = { start: point, current: point.clone(), planeY, lastPredict: 0 };
          c.setPointerCapture(e.pointerId);
        }
      }
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.spawnDrag || !e.isPrimary) return;
      const [x, y] = this.ndc(e);
      const point = this.system.planePoint(x, y, this.spawnDrag.planeY);
      if (point) this.spawnDrag.current.copy(point);
    });

    c.addEventListener('pointerup', (e) => {
      const down = this.pointerDown;
      this.pointerDown = undefined;
      if (this.spawnDrag) {
        this.commitSpawn();
        return;
      }
      if (!down || down.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved > 6) return;
      this.handleClick(e);
      // Touch has no reliable dblclick: detect double taps ourselves.
      if (e.pointerType === 'touch') {
        const now = performance.now();
        const t = this.lastTap;
        if (t && now - t.time < 320 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 24) {
          this.handleDoubleClick(e);
          this.lastTap = undefined;
        } else {
          this.lastTap = { x: e.clientX, y: e.clientY, time: now };
        }
      }
    });

    c.addEventListener('dblclick', (e) => this.handleDoubleClick(e));

    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || this.tutorial.isOpen) return;
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }
      if (mod) return;
      if (key === 'm') {
        if (this.view === 'galaxy') void this.switchToSandbox();
        else void this.exitToGalaxy();
      }
      if (key === '?') this.openTutorial();
      if (this.view === 'galaxy') {
        if (key === 'enter' && this.galaxy.selected !== -1) void this.enterTarget(this.galaxy.selected);
        if (key === 'escape') this.selectTarget(-1);
        if (key === 'b') this.toggleBookmark();
        return;
      }
      switch (key) {
        case ' ':
          e.preventDefault();
          this.setRunning(!this.running);
          break;
        case 'r':
          if (!e.repeat) this.startRewind();
          break;
        case 'v':
          this.setTool('select');
          break;
        case 'b':
          this.setTool('spawn');
          break;
        case 'f':
          this.toggleFollow();
          break;
        case 'h':
          this.toggleCheckbox('opt-hz');
          break;
        case 'o':
          this.toggleCheckbox('opt-orbits');
          break;
        case 't':
          this.toggleCheckbox('opt-trails');
          break;
        case 'delete':
        case 'backspace':
          this.deleteSelected();
          break;
        case '[':
          this.setTimeScale(Math.pow(10, Math.max(-3, Math.log10(this.timeScale) - 0.1)));
          break;
        case ']':
          this.setTimeScale(Math.pow(10, Math.min(2, Math.log10(this.timeScale) + 0.1)));
          break;
        case 'escape':
          if (this.spawnDrag) this.cancelSpawn();
          else if (this.system.followId !== undefined) this.system.follow(undefined);
          else this.selectBody(undefined);
          break;
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key.toLowerCase() === 'r') this.stopRewind();
    });
  }

  private toggleCheckbox(id: string): void {
    const box = $<HTMLInputElement>(id);
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change'));
  }

  private bindUi(): void {
    $('tab-galaxy').addEventListener('click', () => this.view === 'system' && void this.exitToGalaxy());
    $('tab-system').addEventListener('click', () => void this.switchToSandbox());
    $('btn-play').addEventListener('click', () => this.setRunning(!this.running));
    $('btn-undo').addEventListener('click', () => this.undo());
    $('btn-redo').addEventListener('click', () => this.redo());
    const rewind = $('btn-rewind');
    rewind.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      rewind.setPointerCapture(e.pointerId);
      this.startRewind();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) rewind.addEventListener(ev, () => this.stopRewind());
    $('btn-sound').addEventListener('click', () => this.setSound(!this.audio.isEnabled));
    $('btn-help').addEventListener('click', () => this.openTutorial());
    $('btn-menu').addEventListener('click', () => document.body.classList.toggle('panels-hidden'));
    $<HTMLSelectElement>('quality').addEventListener('change', (e) => this.applyQuality((e.target as HTMLSelectElement).value as QualityName));

    // Galaxy
    const goSeed = () => this.buildGalaxy(seedFromString($<HTMLInputElement>('galaxy-seed').value || '1'));
    $('btn-galaxy-go').addEventListener('click', goSeed);
    $<HTMLInputElement>('galaxy-seed').addEventListener('keydown', (e) => e.key === 'Enter' && goSeed());
    $('btn-galaxy-random').addEventListener('click', () => this.buildGalaxy(Math.floor(Math.random() * 1e9)));
    $('btn-star-fly').addEventListener('click', () => this.galaxy.selected !== -1 && this.galaxy.flyTo(this.galaxy.selected));
    $('btn-star-enter').addEventListener('click', () => this.galaxy.selected !== -1 && void this.enterTarget(this.galaxy.selected));
    $('btn-star-bookmark').addEventListener('click', () => this.toggleBookmark());
    $('btn-back').addEventListener('click', () => void this.exitToGalaxy());
    $<HTMLInputElement>('star-search').addEventListener('input', (e) => this.search((e.target as HTMLInputElement).value));
    $<HTMLSelectElement>('star-filter').addEventListener('change', () => void this.applyFilter());
    const pickFromList = (e: Event) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-index]');
      if (!li) return;
      const i = Number(li.dataset.index);
      this.selectTarget(i);
      this.galaxy.flyTo(i);
    };
    for (const id of ['search-results', 'bookmark-list']) {
      $(id).addEventListener('click', pickFromList);
      $(id).addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && pickFromList(e));
    }

    // Presets & files
    const select = $<HTMLSelectElement>('preset-select');
    select.innerHTML =
      `<option value="" disabled>Custom / generated</option>` + PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
    select.addEventListener('change', () => {
      $('preset-desc').textContent = PRESETS.find((p) => p.id === select.value)?.description ?? '';
    });
    $('btn-preset-load').addEventListener('click', () => {
      const preset = PRESETS.find((p) => p.id === select.value);
      if (preset) this.loadScenario({ name: preset.name, load: () => preset.load(this.sim), presetId: preset.id });
    });
    $('btn-reset').addEventListener('click', () => this.loadScenario(this.scenario));
    $('btn-save').addEventListener('click', () => this.saveFile());
    $('btn-open').addEventListener('click', () => $<HTMLInputElement>('file-input').click());
    $<HTMLInputElement>('file-input').addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        this.applyScene(await readSceneFile(file));
      } catch (err) {
        toast((err as Error).message);
      }
    });
    $('btn-share').addEventListener('click', () => void this.shareLink());

    // Tools
    $('tool-select').addEventListener('click', () => this.setTool('select'));
    $('tool-spawn').addEventListener('click', () => this.setTool('spawn'));
    const palette = $('spawn-palette');
    for (const t of SPAWN_TYPES) {
      const b = document.createElement('button');
      b.innerHTML = `<span class="swatch" style="background:${t.swatch};color:${t.swatch}"></span>${t.label}`;
      b.dataset.type = t.id;
      b.addEventListener('click', () => {
        this.spawnType = t;
        palette.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      });
      palette.appendChild(b);
    }
    palette.querySelector(`[data-type="${this.spawnType.id}"]`)?.classList.add('active');
    const massInput = $<HTMLInputElement>('spawn-mass');
    massInput.addEventListener('input', () => {
      this.spawnMassFactor = Math.pow(10, Number(massInput.value));
      $('spawn-mass-out').textContent = `${fmt(this.spawnMassFactor)}×`;
    });
    $<HTMLInputElement>('spawn-orbit').addEventListener('change', (e) => (this.autoOrbit = (e.target as HTMLInputElement).checked));

    // Simulation settings (sent to the worker without resending state)
    const ts = $<HTMLInputElement>('time-scale');
    ts.addEventListener('input', () => this.setTimeScale(Math.pow(10, Number(ts.value))));
    const grav = $<HTMLInputElement>('gravity');
    grav.addEventListener('input', () => {
      this.host.setSettings({ gravityScale: Number(grav.value) });
      $('gravity-out').textContent = this.sim.gravityScale.toFixed(2);
    });
    const bindSetting = (id: string, key: 'collisions' | 'debris' | 'shatter' | 'tidal') =>
      $<HTMLInputElement>(id).addEventListener('change', (e) => this.host.setSettings({ [key]: (e.target as HTMLInputElement).checked }));
    bindSetting('opt-collisions', 'collisions');
    bindSetting('opt-debris', 'debris');
    bindSetting('opt-shatter', 'shatter');
    bindSetting('opt-tidal', 'tidal');
    $<HTMLInputElement>('opt-relativity').addEventListener('change', (e) => this.host.setSettings({ relativity: (e.target as HTMLInputElement).checked }));
    const light = $<HTMLInputElement>('light-speed');
    light.addEventListener('input', () => {
      this.host.setSettings({ lightSpeedScale: Math.pow(10, Number(light.value)) });
      $('light-speed-out').textContent = formatFactor(this.sim.lightSpeedScale);
    });
    const evo = $<HTMLInputElement>('evolution');
    evo.addEventListener('input', () => {
      this.host.setSettings({ evolutionRate: Math.pow(10, Number(evo.value)) });
      $('evolution-out').textContent = formatEvolution(this.sim.evolutionRate);
    });
    $('btn-age').addEventListener('click', () => this.mutate('aging stars by 1 Gyr', () => this.sim.ageBy(1e9)));
    $<HTMLInputElement>('opt-lagrange').addEventListener('change', (e) => (this.system.lagrangeEnabled = (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-trails').addEventListener('change', (e) => {
      this.system.trailsEnabled = (e.target as HTMLInputElement).checked;
      if (this.system.trailsEnabled) this.system.clearTrails();
    });
    $<HTMLInputElement>('opt-rel-trails').addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.system.trailFrame = on ? 'follow' : 'absolute';
      if (on && this.system.followId === undefined) toast('Relative trails are drawn around the body you follow (double-click one).');
    });
    $<HTMLInputElement>('opt-labels').addEventListener('change', (e) => (this.system.labelsEnabled = (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-orbits').addEventListener('change', (e) => (this.system.orbitsEnabled = (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-hz').addEventListener('change', (e) => (this.system.habitableZones = (e.target as HTMLInputElement).checked));
    $('btn-clear-trails').addEventListener('click', () => this.system.clearTrails());
    $('btn-recenter').addEventListener('click', () => {
      this.mutate('recentering', () => this.sim.recenter());
      this.system.clearTrails();
    });

    // Body panel
    $('btn-follow').addEventListener('click', () => this.toggleFollow());
    $('btn-delete').addEventListener('click', () => this.deleteSelected());
    $('btn-mass-up').addEventListener('click', () => this.scaleSelectedMass(2));
    $('btn-mass-down').addEventListener('click', () => this.scaleSelectedMass(0.5));
    $('btn-supernova').addEventListener('click', () => this.detonateSelected());

    // Gentle UI ticks.
    document.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.audio.click();
    });
  }

  // ---------------------------------------------------------------------------
  // Tutorial

  private openTutorial(): void {
    this.tutorial.open(() => prefs.set('tutorialDone', true));
  }

  private tutorialSteps() {
    const toSystem = () => {
      if (this.view !== 'system') this.setView('system');
    };
    return [
      {
        title: 'Welcome to Astrarium',
        body: 'A universe sandbox: explore a procedurally generated galaxy, then drop into any star system and play with real N-body gravity. This quick tour shows you around. Press ? at any time to see it again.',
      },
      {
        title: 'The galaxy map',
        body: 'Thirty thousand explorable star systems. Search by name, filter for habitable worlds, bookmark favourites, and zoom right into a star to warp into its system.',
        target: '#tab-galaxy',
      },
      {
        title: 'Scenarios',
        body: 'Pick a ready-made scenario such as a giant impact, a ring-forming moon, a supernova or a 2,000-star cluster. Save scenes to a file or copy a share link.',
        target: '#section-scenario',
        enter: toSystem,
      },
      {
        title: 'Spawn things',
        body: 'Choose the Spawn tool, pick an object, then click to place it and drag to set its velocity. Auto-orbit gives it a circular orbit, and the dashed line previews its path.',
        target: '#section-tools',
        enter: toSystem,
      },
      {
        title: 'Control time',
        body: 'Pause, hold ⏪ (or R) to rewind, and undo or redo any change with Ctrl+Z / Ctrl+Shift+Z.',
        target: '#topbar .clock',
        enter: toSystem,
      },
      {
        title: 'Physics',
        body: 'Change simulation speed and gravity, and toggle collisions, shattering impacts and tidal breakup. Large scenes switch to a Barnes–Hut tree automatically.',
        target: '#section-sim',
        enter: toSystem,
      },
      {
        title: 'Inspect anything',
        body: 'Click a body to see its temperature, habitability and orbit, plus warnings about upcoming close approaches and collisions. Double-click to follow it. Massive stars get a supernova button.',
      },
      {
        title: 'Display',
        body: 'Show habitable zones, orbit paths and trails (relative to the followed body if you like). Graphics quality is under Settings, and 🔇 turns on sound.',
        target: '#section-display',
        enter: toSystem,
      },
    ];
  }
}

// -----------------------------------------------------------------------------

function kindLabel(b: Body): string {
  switch (b.kind) {
    case 'rocky':
      return b.mass < 0.05 * EARTH_MASS ? 'Asteroid' : 'Rocky planet';
    case 'gas':
      return 'Gas giant';
    case 'star':
      return 'Star';
    case 'giant':
      return 'Red giant';
    case 'whitedwarf':
      return 'White dwarf';
    case 'neutron':
      return 'Neutron star';
    case 'blackhole':
      return 'Black hole';
  }
}

function formatAge(years: number): string {
  if (years >= 1e9) return `${(years / 1e9).toFixed(2)} Gyr`;
  if (years >= 1e6) return `${(years / 1e6).toFixed(1)} Myr`;
  if (years >= 1e3) return `${(years / 1e3).toFixed(1)} kyr`;
  return formatTime(years);
}

function formatFactor(f: number): string {
  return f >= 0.999 ? 'real' : `${fmt(f)}×`;
}

function formatEvolution(rate: number): string {
  return rate <= 1.01 ? 'real time' : `${formatAge(rate)}/yr`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatRate(yearsPerSecond: number): string {
  if (yearsPerSecond < 1 / 12) return `${fmt(yearsPerSecond * 365.25)} d/s`;
  return `${fmt(yearsPerSecond)} yr/s`;
}

function describeSystem(spec: StarSystemSpec): string {
  const parts = [`${spec.star.spectralClass}-type star with ${spec.planets.length} planet${spec.planets.length === 1 ? '' : 's'}`];
  if (spec.habitableCount) parts.push(`${spec.habitableCount} potentially habitable`);
  if (spec.belt) parts.push('an asteroid belt');
  if (spec.companion) parts.push(`a distant ${spec.companion.spectralClass}-type companion`);
  return `${parts.join(', ')}.`;
}
