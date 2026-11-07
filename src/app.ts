import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { AudioEngine, playSamples } from './audio';
import { FEATURE, systemFeatures, type FeatureName } from './procgen/galaxy';
import { mulberry32, pick, seedFromString } from './procgen/rng';
import { generateStarSystem, starSummary, type StarSystemSpec } from './procgen/starSystem';
import { GalaxyView, type GalaxyTarget } from './render/galaxyView';
import { CosmosView } from './render/cosmosView';
import { SkyView } from './render/skyView';
import { moonPhaseName, skyAt } from './sim/sky';
import { dateToJdTT, eclipsePath, greatestEclipse, jdTTToDate, loadEclipses, localCircumstances, shadowAt, topocentric, type Eclipse } from './sim/eclipse';
import { displayName, GALAXY_CREDIT, galaxyForm, loadLocalGalaxies, loadNamedGalaxies, loadWebGalaxies, LY_PER_MPC, type LocalGalaxy } from './sim/galaxies';
import { equatorialToGalactic, galacticToMap, MILKY_WAY_SEED, MW_CLUSTERS, UNITS_PER_KPC, type GalaxyOptions } from './procgen/galaxy';
import { CLUSTER_COLORS, loadClusters } from './sim/clusters';
import { clusterSwarms } from './procgen/clusterStars';
import { diameterPc, galacticToEcliptic, loadNebulae, NEBULA_COLORS } from './sim/nebulae';
import { loadNebulaImages, NEBULA_IMAGE_CREDIT, nebulaAtlasUrl, nebulaKey, tileRect, type NebulaImageAtlas } from './sim/nebulaImages';
import type { Cloud } from './render/nebulaClouds';
import { QUALITY_PRESETS, SystemView } from './render/systemView';
import { createRealSky } from './render/starfield';
import { setTrueScale } from './sim/trueScale';
import { loadGwEvent, loadGwEvents } from './sim/gwEvents';
import { loadFlyby, loadFlybys } from './sim/flybys';
import { loadVoyagerEncounter, loadVoyagerEncounters } from './sim/voyager';
import { synthesizeChirp } from './sim/gwChirp';
import { loadHalley2061, loadHalleyReturn } from './sim/halley';
import { loadNeighbourhood100, loadStars100 } from './sim/gaia100';
import { getSolarData, loadSolarData } from './sim/solarSystemData';
import { isCompact, kindForMass, mainSequenceLifetime, mergedKind, NEUTRON_MAX_MASS, type Body, type BodyKind } from './sim/body';
import { isTidallyLocked, nearResonance, orbitalPeriod } from './sim/analysis';
import { bodyTemperature, climateFor, formatTemperature, isHabitable } from './sim/climate';
import { GAS_PALETTE, ROCKY_PALETTE, starTemperature } from './sim/color';
import { forecast, type Forecast } from './sim/forecast';
import { SimHost } from './sim/host';
import { circularOrbitVelocity } from './sim/orbits';
import { predictPath } from './sim/predict';
import { galacticCore, loadSolarSystemOnDate, loadStarSystem, PRESETS, type SceneSetup } from './sim/presets';
import { PARTICLE_CULL_DISTANCE, type SimEvent } from './sim/simulation';
import { captureState, restoreState } from './sim/state';
import { EXOPLANET_ACKNOWLEDGEMENT, loadCatalog, loadExoSystem, type ExoCatalog, type ExoHost } from './sim/exoplanets';
import { loadBrightStars, loadNearStars, loadStarNeighbourhood } from './sim/stars';
import { EARTH_MASS, fmt, formatDistance, formatKm, formatMass, formatSpeed, formatTime, G, JUPITER_MASS, getDisplayUnits, KPC_MYR_GRAVITY_SCALE, setDisplayUnits } from './sim/units';
import { $, escapeHtml, isTyping, setFacts, toast } from './ui/dom';
import { GalaxyStore, prefs } from './ui/galaxyStore';
import { History } from './ui/history';
import { decodeScene, downloadJson, encodeScene, readSceneFile, type SceneFile } from './ui/share';
import { Tutorial } from './ui/tutorial';
import { PostFX } from './render/postfx';
import { MegaSim, webgpuAvailable, type MegaScenario } from './gpu/megaSim';
import { buildFromSpec } from './game/sceneSpec';
import { defaultServerUrl, ServerClient } from './net/server';
import { Multiplayer, type Peer } from './net/multiplayer';
import { parseReplay, ReplayPlayer, ReplayRecorder, serializeReplay, VideoRecorder } from './ui/replay';
import { EXAMPLES, SCRIPT_HELP, ScriptRunner } from './ui/console';
import type { SimState } from './sim/state';
import { applyNudge, CHALLENGES, dailyChallenge, KMS, newChallengeState, shareText, type Challenge, type ChallengeResult, type ChallengeState } from './game/challenges';
import { burnDirections, planHohmann } from './game/transfer';
import { LESSONS, type Lesson } from './game/lessons';
import { LineChart, measure, METRICS, type MetricId, type Series } from './ui/graph';

type ViewName = 'cosmos' | 'galaxy' | 'system' | 'sky';
type Tool = 'select' | 'spawn' | 'nudge';
type QualityName = keyof typeof QUALITY_PRESETS;

/**
 * Phones, tablets and small laptops: start with lighter graphics (low quality, no bloom or
 * lensing) unless the user has chosen otherwise. In a phone emulation (4× slower CPU) this took
 * the default Solar System from about 2.5 to 17 frames per second.
 */
const LOW_POWER = (() => {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const touchPhone = window.matchMedia?.('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
  return touchPhone || (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
})();

/** Running in the desktop app (desktop/, Electron): start with higher quality. */
const DESKTOP = /\bElectron\//.test(navigator.userAgent);

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
  { id: 'probe', label: 'Probe', kind: 'rocky', mass: 1e-15, swatch: '#7fdcff' },
];

interface SpawnDrag {
  start: THREE.Vector3;
  current: THREE.Vector3;
  planeY: number;
  lastPredict: number;
  path?: Float32Array;
}

/** Where the current sandbox scene came from. */
type Origin =
  | { kind: 'star'; index: number; spec: StarSystemSpec }
  | { kind: 'core' }
  | { kind: 'sol' }
  | { kind: 'exo'; host: ExoHost }
  | { kind: 'neighbourhood' };

interface Scenario {
  name: string;
  description?: string;
  load: () => SceneSetup;
  presetId?: string;
  origin?: Origin;
}

const AUTO_EXIT_DISTANCE = 40000; // AU: zooming out this far returns to the galaxy map
const AUTO_ENTER_DISTANCE = 0.6; // galaxy units: zooming this close to a selected star enters it
const GALAXY_EXIT_DISTANCE = 560; // galaxy units: zooming out this far leaves for the Universe map

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
  private readonly cosmos: CosmosView;
  private readonly sky: SkyView;
  private skyDate = new Date();
  private skySpeed = 1;
  private skyPicked?: string;
  private eclipse?: { e: Eclipse; path: ReturnType<typeof eclipsePath>; greatest: ReturnType<typeof greatestEclipse> };
  private earthMap?: HTMLImageElement;
  private cosmosLoaded = false;
  /** The real galaxy (catalogue name) the galaxy map currently shows, for returning to the Universe map. */
  private galaxyOrigin = 'Milky Way';
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
  private quality: QualityName = prefs.get<QualityName>('quality', DESKTOP ? (LOW_POWER ? 'medium' : 'high') : LOW_POWER ? 'low' : 'medium');
  private catalog?: ExoCatalog;
  private challenge?: { def: Challenge; st: ChallengeState; result?: ChallengeResult };
  private graphOpen = false;
  private graphMetric: MetricId = 'distance';
  private graphSeries: [number, number][] = [];
  private graphRef?: Series;
  private graphStart = 0;
  private graphBodyId?: number;
  private graphLastTime = NaN;
  private graphTimer = 0;
  private chart?: LineChart;
  private server?: ServerClient;
  private readonly mp: Multiplayer;
  private mpTimer = 0;
  private readonly recorder = new ReplayRecorder();
  private player?: ReplayPlayer;
  private preReplay?: SimState;
  private readonly video = new VideoRecorder();
  private readonly scripts: ScriptRunner;
  private embed = false;
  private postfx!: PostFX;
  private postfxOn = prefs.get('postfx', DESKTOP || !LOW_POWER);
  private mega?: MegaSim;
  private lesson?: { def: Lesson; step: number; events: SimEvent[]; done: Set<number> };
  private nudgeDrag?: { bodyId: number; start: THREE.Vector3; current: THREE.Vector3; lastPredict: number; path?: Float32Array };
  /** Typical camera distance of the loaded scene; zooming far beyond it returns to the galaxy. */
  private sceneScale = 10;
  private exoOpen = false;

  constructor() {
    // Ask for the discrete GPU on laptops that have two.
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x02030a);
    this.renderer.xr.enabled = true;
    this.postfx = new PostFX(this.renderer);
    const params = new URLSearchParams(location.hash.slice(1));
    // #threads=0 turns multi-core particle forces off (they only run in the desktop app).
    this.host = new SimHost(params.get('worker') !== '0', params.has('threads') ? Number(params.get('threads')) : -1);
    this.system = new SystemView(this.sim, this.canvas, QUALITY_PRESETS[this.quality]);
    this.galaxy = new GalaxyView(this.canvas);
    this.cosmos = new CosmosView(this.canvas);
    this.sky = new SkyView(this.canvas);
    this.tutorial = new Tutorial(this.tutorialSteps());

    const hashSeed = params.get('galaxy');
    this.galaxySeed = hashSeed ? seedFromString(hashSeed) : 1;

    if (window.innerWidth < 760) document.body.classList.add('panels-hidden');
    this.mp = new Multiplayer({
      onState: (state) => this.applyRemoteState(state),
      onEdit: (state) => this.applyRemoteState(state),
      onPeers: (peers) => this.renderPeers(peers),
      onRole: (host) => {
        $('mp-status').textContent = `Connected to room ${this.mp.room} as ${host ? 'host' : 'guest'}.`;
        if (host && this.mp.peers.length > 1) toast('You are now hosting this room.');
      },
      onChat: (name, text) => toast(`${name}: ${text}`),
      onClose: (reason) => {
        $('mp-status').textContent = `Disconnected: ${reason}`;
        $('btn-mp').classList.remove('active');
      },
    });
    this.scripts = new ScriptRunner({
      sim: this.host.sim,
      commit: () => {
        this.host.commit();
        this.shareEdit();
      },
      setRunning: (on) => this.setRunning(on),
      setTimeScale: (v) => this.setTimeScale(v),
      select: (b) => this.selectBody(b),
      follow: (b) => this.system.follow(b?.id),
      setForces: (forces) => this.host.setSettings({ customForces: forces }),
      getForces: () => this.sim.customForces,
      log: (text, kind) => this.consoleLog(text, kind),
    });
    this.bindUi();
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.applyQuality(this.quality);

    this.loadScenario(this.scenario, { undoable: false });
    this.setView('system');
    this.setTool('select');
    if (prefs.get('sound', false)) this.armSoundOnGesture();

    this.embed = params.has('embed');
    if (this.embed) this.enterEmbedMode();
    const presetParam = params.get('preset');
    const presetFromHash = PRESETS.find((p) => p.id === presetParam);
    if (presetFromHash) this.loadScenario({ name: presetFromHash.name, load: () => presetFromHash.load(this.sim), presetId: presetFromHash.id }, { undoable: false });
    const room = params.get('room');
    const serverUrl = params.get('server') ?? defaultServerUrl(prefs.get<string | undefined>('serverUrl', undefined));
    if (serverUrl) {
      void this.connectServer(serverUrl, false).then(() => {
        if (room && this.server) {
          $<HTMLInputElement>('mp-room').value = room;
          this.openMultiplayer();
        }
      });
    }
    // The real night sky (HYG catalogue) replaces the procedural background once it loads.
    void loadBrightStars()
      .then((stars) => {
        this.sky.setStars(stars);
        void loadClusters().then((list) => {
          this.sky.setOutlines(
            'clusters',
            list.map((c) => ({ v: galacticToEcliptic(c.l, c.b), radiusDeg: c.radiusDeg, color: CLUSTER_COLORS[c.kind], label: c.name })),
            '#ffe3a3',
          );
          this.sky.setOutlinesVisible('clusters', $<HTMLInputElement>('opt-sky-clusters').checked);
          $('sky-cluster-count').textContent = `${list.length.toLocaleString('en-US')} star clusters (Gaia, Harris)`;
        });
        void loadNebulae().then((list) => {
          this.sky.setOutlines(
            'nebulae',
            list.map((n) => ({
              v: galacticToEcliptic(n.l, n.b),
              radiusDeg: n.radiusDeg,
              color: NEBULA_COLORS[n.kind],
              label: n.name,
            })),
          );
          this.sky.setOutlinesVisible('nebulae', $<HTMLInputElement>('opt-sky-nebulae').checked);
          $('sky-nebula-count').textContent = `${list.length.toLocaleString('en-US')} nebulae from real catalogues`;
          // The famous ones as their real survey images (galactic north up: the images were made
          // in galactic coordinates).
          void loadNebulaImages()
            .then((images) => {
              const pages = LOW_POWER ? 1 : images.pages.length;
              for (let p = 0; p < pages; p++) {
                void this.nebulaAtlas(images, p).then((atlas) => {
                  this.sky.setImages(
                    p,
                    images.images
                      .filter((im) => im.page === p)
                      .map((im) => ({ v: galacticToEcliptic(im.l, im.b), up: galacticToEcliptic(0, 90), fieldDeg: im.fieldDeg, rect: tileRect(images.pages[p], im.tile) })),
                    atlas,
                  );
                  this.sky.setOutlinesVisible('nebulae', $<HTMLInputElement>('opt-sky-nebulae').checked);
                });
              }
            })
            .catch(() => undefined);
        });
        return this.system.setSky(createRealSky(stars));
      })
      .catch(() => undefined);
    this.runAutorunPlugins();
    const scene = params.get('scene');
    if (scene) {
      decodeScene(scene)
        .then((s) => this.applyScene(s, false))
        .catch((err) => toast(`Couldn't open shared scene: ${(err as Error).message}`));
    }
    if (!prefs.get('tutorialDone', false) && params.get('tour') !== '0' && !this.embed) setTimeout(() => this.openTutorial(), 1200);

    // setAnimationLoop (rather than requestAnimationFrame) also drives WebXR sessions.
    let last = performance.now();
    this.renderer.setAnimationLoop((now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (this.mega) return; // the GPU mega-sim owns the screen
      this.frame(dt);
    });
    void this.detectVR();
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

    if (this.view === 'system' && this.player) {
      this.player.tick(dt);
      this.player.apply(this.sim);
      this.system.update(dt, this.height, false, []);
      this.renderView(this.system.scene, this.system.camera, this.system.lensesOnScreen(this.height));
      this.labelRenderer.render(this.system.scene, this.system.camera);
      if (this.frames % 4 === 0) this.updateReplayBar();
      return;
    }
    if (this.view === 'system') {
      const active = this.running && this.rewindTimer === undefined;
      if (active) this.scripts.frame(dt);
      if (this.recorder.recording && !this.recorder.tick(this.sim, dt)) {
        toast('Replay memory limit reached; recording stopped.');
        this.stopRecording();
      }
      if (this.mp.connected && this.mp.host && this.mp.peers.length > 1) {
        this.mpTimer -= dt;
        if (this.mpTimer <= 0) {
          this.mpTimer = 0.25;
          this.mp.sendState(this.syncState());
        }
      }
      const events = this.host.advance(active ? this.timeScale * dt : 0, 12);
      this.handleEvents(events);
      if (this.spawnDrag) this.updateSpawnPreview(performance.now());
      if (this.nudgeDrag) this.updateNudgePreview(performance.now());
      if (this.lesson) this.lesson.events.push(...events);
      if (this.graphOpen) this.sampleGraph(dt);
      if (this.lesson && this.frames % 10 === 0) this.checkLesson();
      if (this.challenge && !this.challenge.result) {
        this.challenge.st.events.push(...events);
        if (this.frames % 3 === 0) this.evaluateChallenge();
      }
      this.system.update(dt, this.height, active, events);
      this.renderView(this.system.scene, this.system.camera, this.system.lensesOnScreen(this.height));
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
        this.forecastTimer = LOW_POWER && !DESKTOP ? 2 : 1;
        this.updateForecast();
      }
      if (this.frames % 6 === 0) this.updateSystemHud();
      if (!this.transitioning && this.system.cameraDistance > this.exitDistance) void this.exitToGalaxy();
    } else if (this.view === 'sky') {
      this.tickSky(dt);
    } else if (this.view === 'cosmos') {
      this.cosmos.update(dt);
      this.renderView(this.cosmos.scene, this.cosmos.camera, []);
      if (this.frames % 15 === 0) $('stats').textContent = `${Math.round(this.fps)} fps`;
      const sel = this.cosmos.selected;
      if (
        !this.transitioning &&
        sel !== -1 &&
        !this.cosmos.animating &&
        this.cosmos.cameraDistance < this.cosmos.viewDistance(sel) * 0.12 &&
        this.cosmos.controls.target.distanceTo(this.cosmos.position(sel)) < this.cosmos.viewDistance(sel) * 0.5
      ) {
        void this.visitCosmosGalaxy(sel);
      }
    } else {
      this.galaxy.update(dt);
      this.renderView(this.galaxy.scene, this.galaxy.camera, []);
      if (!this.transitioning && !this.galaxy.animating && this.galaxy.cameraDistance > GALAXY_EXIT_DISTANCE) void this.openCosmos(true);
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

  private enterEmbedMode(): void {
    document.body.classList.add('embed');
    const link = $<HTMLAnchorElement>('embed-open');
    const params = new URLSearchParams(location.hash.slice(1));
    params.delete('embed');
    link.href = `${location.origin}${location.pathname}#${params.toString()}`;
    link.classList.remove('hidden');
  }

  private async copyEmbed(): Promise<void> {
    const code = await encodeScene(this.makeSceneFile(false));
    const src = `${location.origin}${location.pathname}#embed=1&tour=0&scene=${code}`;
    const html = `<iframe src="${src}" width="800" height="450" style="border:0;border-radius:12px" allow="fullscreen; xr-spatial-tracking" title="Astrarium: ${escapeHtml(this.scenario.name)}"></iframe>`;
    try {
      await navigator.clipboard.writeText(html);
      toast('Embed code copied: paste it into any web page.');
    } catch {
      window.prompt('Copy this embed code:', html);
    }
  }

  private renderView(scene: THREE.Scene, camera: THREE.Camera, lenses: THREE.Vector3[]): void {
    // Post-processing isn't supported inside WebXR sessions; low quality skips it too.
    // The galaxy map is already a sea of additive glow; bloom there only adds haze.
    if (this.postfxOn && this.quality !== 'low' && !this.renderer.xr.isPresenting && this.view === 'system') {
      this.postfx.setLenses(lenses);
      this.postfx.setBloom(this.quality === 'high' ? 0.55 : 0.4);
      this.postfx.render(scene, camera);
    } else {
      this.renderer.render(scene, camera);
    }
  }

  // ---------------------------------------------------------------------------
  // WebXR

  private async detectVR(): Promise<void> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return;
    try {
      if (await xr.isSessionSupported('immersive-vr')) $('btn-vr').classList.remove('hidden');
    } catch {
      // not supported
    }
  }

  private async enterVR(): Promise<void> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return;
    if (this.view !== 'system') this.setView('system');
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);
    // Tabletop scale: the whole scene fits in about a metre, at waist height in front of you.
    const scene = this.system.scene;
    scene.scale.setScalar(0.6 / this.system.sceneExtent());
    scene.position.set(0, 1.0, -1.0);
    const controllers = [0, 1].map((i) => this.renderer.xr.getController(i));
    const onSelect = () => this.setRunning(!this.running);
    for (const c of controllers) {
      c.addEventListener('select', onSelect);
      scene.add(c);
    }
    session.addEventListener('end', () => {
      scene.scale.setScalar(1);
      scene.position.set(0, 0, 0);
      for (const c of controllers) {
        c.removeEventListener('select', onSelect);
        scene.remove(c);
      }
    });
    toast('VR: pull the trigger to pause or resume.');
  }

  // ---------------------------------------------------------------------------
  // GPU mega-sim

  private async openMegaSim(): Promise<void> {
    if (!webgpuAvailable()) return void toast('WebGPU isn’t available in this browser. Try a recent Chrome, Edge or Safari.');
    $('gpu-view').classList.remove('hidden');
    try {
      this.mega = new MegaSim($<HTMLCanvasElement>('gpu-canvas'));
      this.mega.onLost = (reason) => {
        this.closeMegaSim();
        toast(`The GPU stopped responding (${reason}). Try fewer stars.`);
      };
      await this.mega.init();
      this.restartMegaSim();
      this.mega.start();
      const update = () => {
        if (!this.mega) return;
        const s = this.mega.stats;
        $('gpu-stats').textContent = `${s.n.toLocaleString()} stars · ${s.fps.toFixed(0)} fps · ${(s.interactionsPerSecond / 1e9).toFixed(2)} billion interactions/s`;
        setTimeout(update, 500);
      };
      update();
    } catch (err) {
      this.closeMegaSim();
      toast((err as Error).message);
    }
  }

  private restartMegaSim(): void {
    if (!this.mega) return;
    this.mega.stepsPerFrame = Number($<HTMLSelectElement>('gpu-steps').value);
    this.mega.reset(Number($<HTMLSelectElement>('gpu-n').value), $<HTMLSelectElement>('gpu-scenario').value as MegaScenario);
  }

  private closeMegaSim(): void {
    this.mega?.destroy();
    this.mega = undefined;
    $('gpu-view').classList.add('hidden');
  }

  private resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.labelRenderer.setSize(this.width, this.height);
    this.system.setViewport(this.width, this.height);
    this.galaxy.setViewport(this.width, this.height, this.renderer.getPixelRatio());
    this.cosmos.setViewport(this.width, this.height, this.renderer.getPixelRatio());
    this.sky.setViewport(this.width, this.height, this.renderer.getPixelRatio());
    this.postfx?.setSize(this.width, this.height);
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
    this.cosmos.controls.enabled = view === 'cosmos';
    this.sky.enabled = view === 'sky';
    if (view !== 'system') this.cancelSpawn();
    $('tab-cosmos').classList.toggle('active', view === 'cosmos');
    $('tab-galaxy').classList.toggle('active', view === 'galaxy');
    $('tab-system').classList.toggle('active', view === 'system');
    $('tab-sky').classList.toggle('active', view === 'sky');
    $('labels').classList.toggle('hidden', view !== 'system');
    document.querySelectorAll<HTMLElement>('[data-view]').forEach((el) => {
      const match = el.dataset.view === view;
      if (el.id === 'star-panel') el.classList.toggle('hidden', !match || this.galaxy.selected === -1);
      else if (el.id === 'cosmos-galaxy-panel') el.classList.toggle('hidden', !match || this.cosmos.selected === -1);
      else if (el.id === 'exo-panel') el.classList.toggle('hidden', !match || !this.exoOpen);
      else if (el.id === 'graph-panel') el.classList.toggle('hidden', !match || !this.graphOpen);
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
      } else if (target === 'sol') {
        scenario = { name: 'the Solar System', load: () => loadSolarSystemOnDate(this.sim, new Date()), origin: { kind: 'sol' } };
      } else if (typeof target === 'object') {
        scenario = this.exoScenario(this.exoMapHosts[target.exo]);
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
      if (offset.length() > this.exitDistance * 0.5) offset.setLength(this.sceneScale);
      this.system.camera.position.copy(camTarget).add(offset);
      this.system.controls.target.copy(camTarget);
      this.system.stopCameraAnimation();
      this.setView('galaxy');
      const origin = this.scenario.origin;
      const exoIndex = origin?.kind === 'exo' ? this.exoMapHosts.findIndex((h) => h.name === origin.host.name) : -1;
      const target: GalaxyTarget | undefined =
        origin?.kind === 'core' ? 'core' : origin?.kind === 'star' ? origin.index : exoIndex >= 0 ? { exo: exoIndex } : origin ? 'sol' : undefined;
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

  /** Fade to another view without any camera transition. */
  private async switchView(view: ViewName): Promise<void> {
    if (this.transitioning || this.view === view) return;
    this.transitioning = true;
    try {
      await this.fade(true);
      this.setView(view);
      await this.fade(false);
    } finally {
      this.transitioning = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Sky (planetarium)

  private static readonly SKY_PLACES: [string, number, number][] = [
    ['Greenwich, London', 51.4778, -0.0015], ['New York', 40.7128, -74.006], ['Los Angeles', 34.0522, -118.2437],
    ['Mexico City', 19.4326, -99.1332], ['São Paulo', -23.5505, -46.6333], ['Reykjavík', 64.1466, -21.9426],
    ['Cape Town', -33.9249, 18.4241], ['Cairo', 30.0444, 31.2357], ['Mumbai', 19.076, 72.8777],
    ['Delhi', 28.6139, 77.209], ['Beijing', 39.9042, 116.4074], ['Tokyo', 35.6762, 139.6503],
    ['Sydney', -33.8688, 151.2093], ['Mauna Kea observatories', 19.8207, -155.4681],
    ['Atacama Desert (ALMA)', -23.0229, -67.7552], ['North Pole', 90, 0], ['South Pole', -90, 0],
  ];

  private async openSky(): Promise<void> {
    if (this.view === 'sky') return;
    this.skyDate = new Date();
    this.setSkyTimeInput();
    this.sky.setTime(this.skyDate);
    this.renderSkyList();
    await this.switchView('sky');
  }

  private tickSky(dt: number): void {
    this.skyDate = new Date(this.skyDate.getTime() + dt * 1000 * this.skySpeed);
    this.sky.setTime(this.skyDate);
    this.sky.update();
    this.renderView(this.sky.scene, this.sky.camera, []);
    if (this.frames % 15 === 0) {
      $('stats').textContent = `${Math.round(this.fps)} fps`;
      this.renderSkyList();
      this.drawEclipseMap();
      if (document.activeElement !== $('sky-time')) this.setSkyTimeInput();
    }
  }

  private setSkyTimeInput(): void {
    const d = this.skyDate;
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $<HTMLInputElement>('sky-time').value = local;
    $('sky-utc').textContent = `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }

  private setSkyPlace(lat: number, lon: number, name?: string): void {
    lat = Math.max(-90, Math.min(90, lat));
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    $<HTMLInputElement>('sky-lat').value = lat.toFixed(2);
    $<HTMLInputElement>('sky-lon').value = lon.toFixed(2);
    const select = $<HTMLSelectElement>('sky-place');
    const i = App.SKY_PLACES.findIndex((p) => p[0] === name);
    select.value = i >= 0 ? String(i) : '';
    prefs.set('skyPlace', { lat, lon, name: name ?? '' });
    this.sky.setTime(this.skyDate, { lat, lon });
    this.renderSkyList();
    this.updateEclipseInfo();
  }

  private selectEclipse(e: Eclipse | undefined): void {
    this.eclipse = e ? { e, path: eclipsePath(e), greatest: greatestEclipse(e) } : undefined;
    this.sky.setEclipse(e);
    $('eclipse-map').classList.toggle('hidden', !e);
    if (e && !this.earthMap) {
      const img = new Image();
      img.onload = () => this.drawEclipseMap();
      img.src = `${import.meta.env.BASE_URL}textures/earth.jpg`;
      this.earthMap = img;
    }
    this.drawEclipseMap();
    this.updateEclipseInfo();
  }

  private watchEclipse(): void {
    const ec = this.eclipse;
    if (!ec) return;
    const place = ec.greatest.shadow.centre!;
    this.setSkyPlace(place.lat, place.lon);
    const local = localCircumstances(ec.e, place.lat, place.lon);
    this.skyDate = jdTTToDate(ec.e, local.maxJdTT - (local.centralSec / 2 + 75) / 86400);
    this.skySpeed = 10;
    $<HTMLSelectElement>('sky-speed').value = '10';
    this.setSkyTimeInput();
    const t = topocentric(ec.e, local.maxJdTT, place.lat, place.lon);
    this.sky.lookAt(t.sun.alt, t.sun.az);
    this.sky.setFov(3);
    this.sky.setTime(this.skyDate);
    this.updateEclipseInfo();
    if (this.view !== 'sky') void this.switchView('sky');
  }

  private updateEclipseInfo(): void {
    const ec = this.eclipse;
    if (!ec) {
      $('eclipse-info').textContent = '';
      return;
    }
    const { e } = ec;
    const { lat, lon } = this.sky.observer;
    const local = localCircumstances(e, lat, lon);
    const utc = (jd: number) => jdTTToDate(e, jd).toISOString().slice(11, 19);
    const sunAlt = topocentric(e, local.maxJdTT, lat, lon).sun.alt;
    const fmt = (sec: number) => `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`;
    let here: string;
    if (local.obscuration <= 0) here = 'Not visible from here.';
    else if (sunAlt < -0.5) here = 'From here it happens with the Sun below the horizon.';
    else if (local.central !== 'none')
      here = `From here: ${local.central === 'total' ? 'totality' : 'a ring of fire'} for ${fmt(local.centralSec)}, centred on ${utc(local.maxJdTT)} UTC, with the Sun ${Math.round(sunAlt)}° up.`;
    else here = `From here: partial, up to ${Math.round(local.obscuration * 100)}% of the Sun covered at ${utc(local.maxJdTT)} UTC, Sun ${Math.round(sunAlt)}° up.`;
    const ns = (v: number, p: string, n: string) => `${Math.abs(v)}°${v >= 0 ? p : n}`;
    $('eclipse-info').textContent = `${here} NASA: greatest eclipse at ${e.greatestTD.slice(11, 16)} TD, ${ns(e.lat, 'N', 'S')} ${ns(e.lon, 'E', 'W')}, ${e.type === 'annular' ? 'annularity' : 'totality'} ${fmt(e.durationSec)}${e.widthKm ? `, path ${e.widthKm} km wide` : ''}. Click the map to watch from anywhere.`;
  }

  private drawEclipseMap(): void {
    const ec = this.eclipse;
    const canvas = $<HTMLCanvasElement>('eclipse-map');
    if (!ec || canvas.classList.contains('hidden')) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const xy = (p: { lat: number; lon: number }): [number, number] => [((p.lon + 180) / 360) * W, ((90 - p.lat) / 180) * H];
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, W, H);
    if (this.earthMap?.complete && this.earthMap.naturalWidth) {
      ctx.globalAlpha = 0.75;
      ctx.drawImage(this.earthMap, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    const line = (pts: { lat: number; lon: number }[], color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let prev: [number, number] | undefined;
      for (const p of pts) {
        const q = xy(p);
        if (!prev || Math.abs(q[0] - prev[0]) > W / 2) ctx.moveTo(q[0], q[1]);
        else ctx.lineTo(q[0], q[1]);
        prev = q;
      }
      ctx.stroke();
    };
    const withLimits = ec.path.filter((p) => p.limits);
    line(withLimits.map((p) => p.limits![0]), 'rgba(255,200,90,0.9)', 1.5);
    line(withLimits.map((p) => p.limits![1]), 'rgba(255,200,90,0.9)', 1.5);
    line(ec.path.map((p) => p.centre), 'rgba(255,120,60,0.9)', 1);
    // The shadow now.
    const jd = dateToJdTT(ec.e, this.skyDate);
    const sh = shadowAt(ec.e, jd);
    if (sh.centre) {
      const [x, y] = xy(sh.centre);
      const kmPerPx = 40075 / W;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(x, y, sh.penumbraKm / kmPerPx / Math.max(0.2, Math.cos((sh.centre.lat * Math.PI) / 180)), sh.penumbraKm / kmPerPx, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, Math.abs(sh.umbraKm) / kmPerPx), 0, Math.PI * 2);
      ctx.fill();
    }
    const [ox, oy] = xy(this.sky.observer);
    ctx.strokeStyle = '#7fdcff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox - 6, oy);
    ctx.lineTo(ox + 6, oy);
    ctx.moveTo(ox, oy - 6);
    ctx.lineTo(ox, oy + 6);
    ctx.stroke();
  }

  private wireSkyPanel(): void {
    const select = $<HTMLSelectElement>('sky-place');
    select.innerHTML = `<option value="">Custom place</option>${App.SKY_PLACES.map((p, i) => `<option value="${i}">${p[0]}</option>`).join('')}`;
    const saved = prefs.get<{ lat: number; lon: number; name: string } | null>('skyPlace', null);
    if (saved) this.setSkyPlace(saved.lat, saved.lon, saved.name || undefined);
    else this.setSkyPlace(App.SKY_PLACES[0][1], App.SKY_PLACES[0][2], App.SKY_PLACES[0][0]);
    select.addEventListener('change', () => {
      const p = App.SKY_PLACES[Number(select.value)];
      if (select.value !== '' && p) this.setSkyPlace(p[1], p[2], p[0]);
    });
    const typed = () => {
      const lat = Number($<HTMLInputElement>('sky-lat').value), lon = Number($<HTMLInputElement>('sky-lon').value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) this.setSkyPlace(lat, lon);
    };
    $('sky-lat').addEventListener('change', typed);
    $('sky-lon').addEventListener('change', typed);
    $('btn-sky-here').addEventListener('click', () => {
      if (!navigator.geolocation) return toast('Location is not available in this browser.');
      navigator.geolocation.getCurrentPosition(
        (pos) => this.setSkyPlace(pos.coords.latitude, pos.coords.longitude),
        () => toast('Could not get your location.'),
        { timeout: 10000 },
      );
    });
    $('sky-time').addEventListener('change', () => {
      const d = new Date($<HTMLInputElement>('sky-time').value);
      if (!Number.isNaN(d.getTime())) {
        this.skyDate = d;
        this.setSkyTimeInput();
      }
    });
    $('btn-sky-now').addEventListener('click', () => {
      this.skyDate = new Date();
      this.skySpeed = 1;
      $<HTMLSelectElement>('sky-speed').value = '1';
      this.setSkyTimeInput();
    });
    void loadEclipses()
      .then((list) => {
        const select = $<HTMLSelectElement>('eclipse-select');
        select.innerHTML = `<option value="">Choose an eclipse…</option>${list.map((e, i) => `<option value="${i}">${e.date} · ${e.type}</option>`).join('')}`;
        const now = Date.now();
        const next = list.findIndex((e) => Date.parse(e.date) > now);
        select.value = String(next >= 0 ? next : 0);
      })
      .catch(() => ($('eclipse-select').innerHTML = '<option value="">Eclipses unavailable</option>'));
    $('eclipse-select').addEventListener('change', async () => {
      const list = await loadEclipses().catch(() => []);
      this.selectEclipse(list[Number($<HTMLSelectElement>('eclipse-select').value)]);
    });
    $('btn-eclipse').addEventListener('click', async () => {
      const list = await loadEclipses().catch(() => []);
      const e = list[Number($<HTMLSelectElement>('eclipse-select').value)];
      if (!e) return;
      if (this.eclipse?.e !== e) this.selectEclipse(e);
      this.watchEclipse();
    });
    $('eclipse-map').addEventListener('click', (ev) => {
      const c = $<HTMLCanvasElement>('eclipse-map');
      const r = c.getBoundingClientRect();
      const me = ev as MouseEvent;
      const lon = ((me.clientX - r.left) / r.width) * 360 - 180;
      const lat = 90 - ((me.clientY - r.top) / r.height) * 180;
      this.setSkyPlace(lat, lon);
      this.drawEclipseMap();
      const ec = this.eclipse;
      if (ec) {
        // Point at the Sun as it will be at maximum eclipse here.
        const local = localCircumstances(ec.e, lat, lon);
        const t = topocentric(ec.e, local.maxJdTT, lat, lon);
        if (t.sun.alt > -1) this.sky.lookAt(t.sun.alt, t.sun.az);
      }
    });
    $<HTMLInputElement>('opt-sky-nebulae').addEventListener('change', (e) => this.sky.setOutlinesVisible('nebulae', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-sky-clusters').addEventListener('change', (e) => this.sky.setOutlinesVisible('clusters', (e.target as HTMLInputElement).checked));
    $('sky-speed').addEventListener('change', () => (this.skySpeed = Number($<HTMLSelectElement>('sky-speed').value)));
    $('sky-list').addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-sky]');
      const o = li && this.sky.snapshot?.objects.find((x) => x.name === li.dataset.sky);
      if (!o) return;
      this.skyPicked = o.name;
      this.sky.lookAt(Math.max(o.alt, 5), o.az);
      this.renderSkyList();
    });
  }

  private renderSkyList(): void {
    const snap = this.sky.snapshot;
    if (!snap) return;
    const compass = (az: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(az / 22.5) % 16];
    const where = (o: { alt: number; az: number }) => (o.alt > 0 ? `${Math.round(o.alt)}° up, ${compass(o.az)}` : 'below the horizon');
    const sun = snap.objects.find((o) => o.name === 'Sun')!;
    const moon = snap.objects.find((o) => o.name === 'Moon')!;
    // Waxing while the lit fraction grows.
    const waxing = skyAt(new Date(this.skyDate.getTime() + 3600000), this.sky.observer).moonIllumination >= snap.moonIllumination;
    const phase = `${moonPhaseName(snap.moonIllumination, waxing)}, ${Math.round(snap.moonIllumination * 100)}% lit`;
    const sky = sun.alt > -0.833 ? 'Daytime' : sun.alt > -6 ? 'Civil twilight' : sun.alt > -12 ? 'Nautical twilight' : sun.alt > -18 ? 'Astronomical twilight' : 'Night';
    const rows = [
      { name: 'Sun', text: `${sky}: ${where(sun)}` },
      { name: 'Moon', text: `${phase}; ${where(moon)}` },
      ...snap.objects
        .filter((o) => o.kind === 'planet')
        .sort((a, b) => b.alt - a.alt)
        .map((o) => ({ name: o.name, text: where(o), up: o.alt > 0 })),
    ];
    $('sky-list').innerHTML = rows
      .map((r) => `<li data-sky="${r.name}" tabindex="0" class="${'up' in r && !r.up ? 'muted' : ''}${r.name === this.skyPicked ? ' active' : ''}"><b>${r.name}</b> <span class="small">${r.text}</span></li>`)
      .join('');
    const picked = this.skyPicked && snap.objects.find((o) => o.name === this.skyPicked);
    $('sky-info').textContent = picked
      ? `${picked.name}: altitude ${picked.alt.toFixed(1)}°, azimuth ${picked.az.toFixed(1)}°, ${picked.km > 1e7 ? `${(picked.km / 149597870.7).toFixed(2)} AU` : `${Math.round(picked.km).toLocaleString('en-US')} km`} away, ${(picked.diameter * 60).toFixed(picked.diameter * 60 < 1 ? 2 : 1)}′ across.`
      : 'Positions are geometric (no atmospheric refraction), accurate to about an arcminute.';
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

  private get exitDistance(): number {
    return Math.max(AUTO_EXIT_DISTANCE, this.sceneScale * 12);
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
      trueScale: false,
      units: 'au-yr',
      particleCullDistance: PARTICLE_CULL_DISTANCE,
      absorbParticles: true,
    });
  }

  private loadScenario(sc: Scenario, opts: { zoomFrom?: number; undoable?: boolean; challenge?: boolean; lesson?: boolean } = {}): void {
    const { zoomFrom = 1, undoable = true } = opts;
    if (!opts.challenge && this.challenge) this.quitChallenge();
    if (!opts.lesson && this.lesson) this.exitLesson();
    // A pinned comparison run survives Reset of the same scenario, not a switch to another one.
    if (sc.name !== this.scenario.name) this.graphRef = undefined;
    this.resetGraph();
    if (undoable && this.sim.bodies.length) this.history.push(captureState(this.sim), `loading ${sc.name}`);
    this.cancelSpawn();
    this.sim.clear();
    this.resetPhysicsDefaults();
    this.scenario = sc;
    const setup = sc.load();
    setDisplayUnits(this.sim.units);
    this.setMaxTimeScale(setup.maxTimeScale ?? 100);
    this.sceneScale = setup.cameraDistance;
    this.host.commit();
    this.history.clearTimeline();
    this.system.reset(setup, zoomFrom);
    this.setTimeScale(setup.timeScale);
    this.syncSettingsUi();
    this.hideBodyPanel();
    this.forecastResult = undefined;

    const select = $<HTMLSelectElement>('preset-select');
    select.value = sc.presetId ?? '';
    $('preset-desc').textContent = sc.presetId ? (PRESETS.find((p) => p.id === sc.presetId)?.description ?? '') : (sc.description ?? setup.tip ?? '');
    $('origin').classList.toggle('hidden', !sc.origin);
    if (sc.origin?.kind === 'star') {
      $('origin-name').textContent = sc.origin.spec.star.name;
      $('preset-desc').textContent = describeSystem(sc.origin.spec);
    } else if (sc.origin?.kind === 'core') {
      $('origin-name').textContent = 'the galactic core';
    } else if (sc.origin) {
      $('origin-name').textContent = sc.origin.kind === 'exo' ? sc.origin.host.name : sc.origin.kind === 'sol' ? 'home' : 'the solar neighbourhood';
    }
    if (setup.focus) {
      const body = this.sim.bodies.find((b) => b.name === setup.focus);
      if (body) {
        this.selectBody(body);
        this.system.follow(body.id, setup.cameraDistance);
      }
    }
    if (setup.tip) setTimeout(() => toast(setup.tip!), 600);
    this.updateUndoButtons();
    this.shareEdit();
  }

  // ---------------------------------------------------------------------------
  // Companion server: scene builder, gallery, multiplayer

  private async connectServer(url: string, announce = true): Promise<void> {
    const status = $('server-status');
    try {
      const client = new ServerClient(url);
      const features = await client.health();
      this.server = client;
      prefs.set('serverUrl', url);
      $<HTMLInputElement>('server-url').value = url;
      const on = Object.entries(features).filter(([, v]) => v).map(([k]) => k);
      status.textContent = `Connected: ${on.join(', ') || 'no features'}.`;
      $('describe-status').textContent = features.describe ? '' : 'This server has the scene builder turned off.';
      if (announce) toast('Connected to the Astrarium server');
    } catch (err) {
      this.server = undefined;
      status.textContent = (err as Error).message;
      if (announce) toast((err as Error).message);
    }
  }

  private requireServer(): ServerClient | undefined {
    if (this.server) return this.server;
    toast('Connect a companion server first (Settings → Server).');
    if (document.body.classList.contains('panels-hidden')) document.body.classList.remove('panels-hidden');
    $('server-url').focus();
    return undefined;
  }

  private async describeScene(): Promise<void> {
    const server = this.requireServer();
    const prompt = $<HTMLTextAreaElement>('describe-input').value.trim();
    if (!server) return;
    if (!prompt) return void toast('Describe the scene you want first.');
    const btn = $<HTMLButtonElement>('btn-describe');
    btn.disabled = true;
    $('describe-status').textContent = 'Claude is designing your scene…';
    try {
      const spec = await server.describe(prompt);
      this.loadScenario({ name: spec.title, description: spec.summary, load: () => buildFromSpec(this.sim, spec) });
      this.syncSettingsUi();
      $('describe-status').textContent = `Built “${spec.title}” with ${spec.bodies.length} bodies.`;
    } catch (err) {
      $('describe-status').textContent = (err as Error).message;
    } finally {
      btn.disabled = false;
    }
  }

  private async openGallery(): Promise<void> {
    const server = this.requireServer();
    if (!server) return;
    $('gallery-modal').classList.remove('hidden');
    $('gallery-status').textContent = 'Loading…';
    try {
      const sort = $<HTMLSelectElement>('gallery-sort').value as 'top' | 'new';
      const scenes = await server.listScenes(sort);
      $('gallery-status').textContent = scenes.length ? '' : 'No scenes yet: publish the first one!';
      $('gallery-list').innerHTML = scenes
        .map(
          (s) =>
            `<div class="card"><h3>${escapeHtml(s.title)}</h3><p>by ${escapeHtml(s.author)} · ${s.bodies} bodies · ${new Date(s.created).toLocaleDateString()}</p><div class="row"><button data-vote="${s.id}" title="Upvote">▲ ${s.votes}</button><span style="flex:1"></span><button class="primary" data-load="${s.id}">Load</button></div></div>`,
        )
        .join('');
    } catch (err) {
      $('gallery-status').textContent = (err as Error).message;
    }
  }

  private async publishScene(): Promise<void> {
    const server = this.requireServer();
    if (!server) return;
    const title = $<HTMLInputElement>('publish-name').value.trim() || this.scenario.name;
    const author = $<HTMLInputElement>('publish-author').value.trim();
    prefs.set('author', author);
    try {
      await server.publish(title, author, this.makeSceneFile(true));
      $('publish-modal').classList.add('hidden');
      toast('Published to the gallery!');
    } catch (err) {
      toast((err as Error).message);
    }
  }

  private openMultiplayer(): void {
    $('mp-modal').classList.remove('hidden');
    const room = $<HTMLInputElement>('mp-room');
    if (!room.value) room.value = Math.random().toString(36).slice(2, 8).toUpperCase();
    const name = $<HTMLInputElement>('mp-name');
    if (!name.value) name.value = prefs.get('author', '') || `Explorer ${Math.floor(Math.random() * 900 + 100)}`;
    if (this.mp.connected) $('mp-status').textContent = `Connected to room ${this.mp.room} as ${this.mp.host ? 'host' : 'guest'}.`;
  }

  private async joinRoom(): Promise<void> {
    const server = this.requireServer();
    if (!server) return;
    const room = $<HTMLInputElement>('mp-room').value.trim();
    const name = $<HTMLInputElement>('mp-name').value.trim();
    if (!/^[A-Za-z0-9-]{1,24}$/.test(room)) return void toast('Room codes use letters, digits and dashes.');
    prefs.set('author', name);
    $('mp-status').textContent = 'Connecting…';
    try {
      await this.mp.connect(server.wsUrl, room, name);
      $('btn-mp').classList.add('active');
      if (this.view !== 'system') this.setView('system');
    } catch (err) {
      $('mp-status').textContent = (err as Error).message;
    }
  }

  private renderPeers(peers: Peer[]): void {
    const before = new Set(($('mp-peers').dataset.ids ?? '').split(',').filter(Boolean));
    for (const p of peers) if (before.size && !before.has(p.id) && p.id !== this.mp.id) toast(`${p.name} joined`);
    $('mp-peers').dataset.ids = peers.map((p) => p.id).join(',');
    $('mp-peers').innerHTML = peers
      .map((p) => `<li><span>${escapeHtml(p.name)}${p.id === this.mp.id ? ' (you)' : ''}</span><span class="muted">${p.host ? 'host' : 'guest'}</span></li>`)
      .join('');
    // A newly joined guest should get the scene right away.
    if (this.mp.host && peers.length > before.size) this.mpTimer = 0;
  }

  /** State to broadcast: bodies and a capped set of particles, plus the host's clock settings. */
  private syncState(): SimState {
    const state = captureState(this.sim, { json: true, particles: this.sim.particles.count <= 2500 });
    (state as SimState & { view?: unknown }).view = { timeScale: this.timeScale, running: this.running };
    return state;
  }

  private applyRemoteState(state: SimState): void {
    const view = (state as SimState & { view?: { timeScale: number; running: boolean } }).view;
    const forces = this.sim.customForces;
    restoreState(this.sim, state);
    this.sim.customForces = forces;
    this.host.commit();
    if (view && !this.mp.host) {
      if (Math.abs(view.timeScale - this.timeScale) > 1e-9) this.setTimeScale(view.timeScale);
      if (view.running !== this.running) this.setRunning(view.running);
    }
    if (this.system.selectedId !== undefined && !this.sim.getBody(this.system.selectedId)) this.hideBodyPanel();
  }

  /** Share a local change with the room (guests' changes go to the host, which rebroadcasts). */
  private shareEdit(): void {
    if (this.mp.connected) this.mp.sendEdit(this.syncState());
  }

  // ---------------------------------------------------------------------------
  // Replays & video

  private toggleRecording(): void {
    if (this.recorder.recording) return this.stopRecording();
    if (this.player) return;
    this.recorder.start(this.scenario.name);
    $('btn-record').classList.add('recording');
    toast('Recording a replay… press ⏺ again to stop.');
  }

  private stopRecording(): void {
    const replay = this.recorder.stop();
    $('btn-record').classList.remove('recording');
    if (!replay) return void toast('Recording was too short.');
    this.startReplay(new ReplayPlayer(replay));
  }

  private startReplay(player: ReplayPlayer): void {
    this.preReplay = captureState(this.sim);
    this.wasRunningBeforeRewind = this.running;
    this.setRunning(false);
    this.player = player;
    this.system.clearTrails();
    $('replay-bar').classList.remove('hidden');
    $('replay-play').textContent = '⏸';
  }

  private exitReplay(): void {
    if (!this.player) return;
    this.player = undefined;
    $('replay-bar').classList.add('hidden');
    if (this.preReplay) {
      restoreState(this.sim, this.preReplay);
      this.host.commit();
    }
    this.system.clearTrails();
  }

  private updateReplayBar(): void {
    const p = this.player;
    if (!p) return;
    $<HTMLInputElement>('replay-seek').value = String(Math.round((p.position / Math.max(1, p.replay.frames.length - 1)) * 1000));
    $('replay-time').textContent = `${p.time.toFixed(1)} / ${p.duration.toFixed(1)} s · ${formatTime(this.sim.time)}`;
    $('replay-play').textContent = p.playing ? '⏸' : '▶';
    if (!p.playing && this.video.active) void this.finishVideo();
  }

  private async toggleVideo(): Promise<void> {
    if (!VideoRecorder.supported()) return void toast('Video recording is not supported in this browser.');
    if (this.video.active) return this.finishVideo();
    this.video.start(this.canvas);
    $('btn-video').textContent = '⏹ Stop video';
    toast('Recording video… press Stop video when done.');
  }

  private async finishVideo(): Promise<void> {
    if (!this.video.active) return;
    const blob = await this.video.stop();
    $('btn-video').textContent = '🎥 Video';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `astrarium-${this.scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Video saved');
  }

  // ---------------------------------------------------------------------------
  // Scripting console & plugins

  private consoleLog(text: string, kind: 'out' | 'error' = 'out'): void {
    const log = $('console-log');
    const line = document.createElement('div');
    if (kind === 'error') line.className = 'error';
    line.textContent = text;
    log.appendChild(line);
    while (log.childElementCount > 200) log.firstElementChild!.remove();
    log.scrollTop = log.scrollHeight;
    if (kind === 'error' && $('console-panel').classList.contains('hidden')) toast(`Script error: ${text}`);
  }

  private plugins(): { name: string; code: string; autorun: boolean }[] {
    return prefs.get('plugins', [] as { name: string; code: string; autorun: boolean }[]);
  }

  private renderPlugins(): void {
    $('plugin-list').innerHTML = this.plugins()
      .map(
        (p, i) =>
          `<li><span>🧩 ${escapeHtml(p.name)}</span><span><label class="muted small"><input type="checkbox" data-autorun="${i}" ${p.autorun ? 'checked' : ''}/> autorun</label> <button data-run="${i}">Run</button> <button data-edit="${i}">Edit</button> <button data-del="${i}" class="danger">✕</button></span></li>`,
      )
      .join('');
  }

  private runAutorunPlugins(): void {
    for (const p of this.plugins()) if (p.autorun) this.scripts.run(p.code);
  }

  // ---------------------------------------------------------------------------
  // The Universe map: real galaxies beyond the Milky Way

  /** Open the Universe map, arriving at the galaxy we were just in when coming from a galaxy map. */
  private async openCosmos(fromGalaxy: boolean): Promise<void> {
    if (this.transitioning) return;
    this.transitioning = true;
    try {
      if (fromGalaxy) {
        this.galaxy.controls.enabled = false;
        await sleep(150);
      }
      await this.fade(true);
      if (!this.cosmosLoaded) {
        try {
          const [local, named] = await Promise.all([loadLocalGalaxies(), loadNamedGalaxies()]);
          this.cosmos.setLocal([...local, ...named]);
          this.cosmosLoaded = true;
          $('cosmos-credit').textContent = GALAXY_CREDIT;
          this.updateCosmosInfo();
          new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/cmb.jpg`, (tex) => {
            this.cosmos.setCmb(tex);
            this.cosmos.setCmbVisible($<HTMLInputElement>('opt-cmb').checked);
          });
          void loadWebGalaxies()
            .then((web) => {
              this.cosmos.setWeb(web);
              this.cosmos.setWebVisible($<HTMLInputElement>('opt-cosmic-web').checked);
              this.updateCosmosInfo();
            })
            .catch((err: unknown) => toast((err as Error).message));
        } catch (err) {
          toast((err as Error).message);
          this.galaxy.controls.enabled = this.view === 'galaxy';
          await this.fade(false);
          return;
        }
      }
      this.setView('cosmos');
      const origin = this.cosmos.indexOf(this.galaxyOrigin || 'Milky Way');
      if (fromGalaxy && origin !== -1) {
        this.selectCosmos(origin);
        this.cosmos.arriveFrom(origin);
      }
      await sleep(60);
      await this.fade(false);
    } finally {
      this.transitioning = false;
    }
  }

  private updateCosmosInfo(): void {
    const named = this.cosmos.local.filter((g) => g.zd).length;
    const n = this.cosmos.local.length - named;
    const web = this.cosmos.webCount;
    $('cosmos-info').textContent =
      `${n.toLocaleString('en-US')} real galaxies of the Local Volume (out to 85 million light-years) at their measured distances and true sizes, plus ${named} bright named galaxies beyond it (M87, the Sombrero, Fornax A…) placed by redshift` +
      (web ? `, and ${web.toLocaleString('en-US')} more tracing the cosmic web out to about 700 million light-years, placed by their redshift.` : '. Loading the cosmic web…');
  }

  private selectCosmos(index: number): void {
    this.cosmos.select(index);
    const panel = $('cosmos-galaxy-panel');
    if (index === -1) {
      panel.classList.add('hidden');
      return;
    }
    const g = this.cosmos.local[index];
    $('cosmos-galaxy-name').textContent = displayName(g);
    setFacts($('cosmos-galaxy-facts'), cosmosFacts(g));
    $('btn-cosmos-visit').textContent = g.name === 'Milky Way' ? 'Back to the Milky Way →' : 'Visit galaxy →';
    panel.classList.remove('hidden');
  }

  /** Go into a galaxy: the real Milky Way map, or a procedural stand-in shaped like the real galaxy. */
  private async visitCosmosGalaxy(index: number): Promise<void> {
    const g = this.cosmos.local[index];
    if (!g || this.transitioning) return;
    this.transitioning = true;
    try {
      this.cosmos.flyTo(index, this.cosmos.viewDistance(index) * 0.08, 1.6);
      await sleep(420);
      await this.fade(true);
      if (g.name === 'Milky Way') {
        if (!this.galaxyBuilt || this.galaxySeed !== MILKY_WAY_SEED || this.galaxyOrigin !== 'Milky Way') this.buildGalaxy(MILKY_WAY_SEED);
      } else {
        this.buildGalaxy(seedFromString(`real:${g.name}`), { name: displayName(g), form: galaxyForm(g), origin: g.name });
      }
      this.setView('galaxy');
      await sleep(60);
      await this.fade(false);
      toast(g.name === 'Milky Way' ? 'Back home in the Milky Way' : `Arrived at ${displayName(g)}`);
    } finally {
      this.transitioning = false;
    }
  }

  private renderCosmosSearch(): void {
    const q = $<HTMLInputElement>('cosmos-search').value.trim().toLowerCase().replace(/\s+/g, '');
    const list = $('cosmos-results');
    if (!q) {
      list.innerHTML = '';
      return;
    }
    const matches = this.cosmos.local
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

  /** Real exoplanet hosts on the Milky Way map, placed by their galactic coordinates. */
  private exoMapHosts: ExoHost[] = [];

  /** Real black holes and pulsars (positions from SIMBAD, distances from the discovery papers). */
  private async showCompactObjectsOnMap(seed: number): Promise<void> {
    const res = await fetch(`${import.meta.env.BASE_URL}data/compact-objects.json`).catch(() => undefined);
    if (!res?.ok || this.galaxySeed !== seed) return;
    const { objects } = (await res.json()) as { objects: { name: string; kind: 'blackhole' | 'pulsar'; raDeg: number; decDeg: number; distanceKpc: number; mass?: number }[] };
    this.galaxy.addCompactObjects(
      objects.map((o) => {
        const [l, b] = equatorialToGalactic(o.raDeg, o.decDeg);
        const ly = Math.round((o.distanceKpc * 3261.6) / 10) * 10;
        const what = o.kind === 'blackhole' ? `black hole${o.mass ? ` · ${o.mass} M☉` : ''}` : 'pulsar';
        return { label: `${o.name} · ${what} · ${ly.toLocaleString('en-US')} ly`, pos: galacticToMap(l, b, o.distanceKpc), kind: o.kind };
      }),
    );
  }

  /** Real open and globular star clusters at their measured distances (Milky Way only). */
  private async showClustersOnMap(seed: number): Promise<void> {
    const all = await loadClusters().catch(() => undefined);
    if (!all || this.galaxySeed !== seed) return;
    // The hand-placed showpiece clusters already carry labels; don't name them twice.
    const shown = MW_CLUSTERS.map((c) => c.name.split(' (')[0].toLowerCase());
    this.galaxy.setRealLayer(
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
    this.galaxy.setRealLayerVisible('clusters', $<HTMLInputElement>('opt-real-clusters').checked);
    // The globulars and the larger open clusters as balls of stars at their real sizes (always shown).
    this.galaxy.setClusterSwarms(clusterSwarms(all, LOW_POWER ? 0.5 : 1));
    const count = (k: string) => all.filter((c) => c.kind === k).length.toLocaleString('en-US');
    $('galaxy-info').textContent += ` ${count('open')} open clusters and ${count('group')} moving groups from Gaia (gold), and ${count('globular')} globular clusters (orange), at their measured distances.`;
  }

  /**
   * Real nebulae with measured distances (Milky Way only), as clouds at their true size. Those the
   * survey plates capture show their real photographs (the named ones, and about 200 more on
   * desktops); the rest glow in their emission-line colours; dark nebulae dim the light
   * behind them.
   */
  private async showNebulaeOnMap(seed: number): Promise<void> {
    const [all, images] = await Promise.all([loadNebulae().catch(() => undefined), loadNebulaImages().catch(() => undefined)]);
    if (!all || this.galaxySeed !== seed) return;
    // Phones load only the named nebulae's page (1 MB); desktops all of them.
    const pageCount = images ? (LOW_POWER ? 1 : images.pages.length) : 0;
    const atlases = await Promise.all(Array.from({ length: pageCount }, (_, p) => this.nebulaAtlas(images!, p).catch(() => undefined)));
    if (this.galaxySeed !== seed) return;
    const placed = all.filter((n) => n.distanceKpc);
    const imageOf = new Map((images?.images ?? []).filter((im) => atlases[im.page]).map((im) => [nebulaKey(im), im]));
    const perPage: Cloud[][] = atlases.map(() => []);
    const glow: Cloud[] = [];
    const dust: Cloud[] = [];
    const labels: { pos: [number, number, number]; label: string; color: string; size: number }[] = [];
    let k = 0;
    for (const n of placed) {
      const pc = diameterPc(n) ?? (n.kind === 'pn' ? 0.5 : n.kind === 'snr' ? 20 : n.kind === 'refl' ? 1 : 5);
      const size = (pc / 1000) * UNITS_PER_KPC;
      const pos = galacticToMap(n.l, n.b, n.distanceKpc!);
      const color = NEBULA_COLORS[n.kind];
      const image = n.kind === 'dark' ? undefined : imageOf.get(nebulaKey(n));
      k++;
      if (image) {
        // The image spans 2.6 catalogue radii; a soft glow in the nebula's colour gives it depth.
        const named = image.page === 0;
        perPage[image.page].push({ pos, size: size * 1.3, color, tile: tileRect(images!.pages[image.page], image.tile), minPx: named ? 40 : 14, brightness: 1.1, rotation: 0, puff: 0 });
        glow.push({ pos, size: size * 1.6, color, minPx: named ? 50 : 18, brightness: 0.3, rotation: k, puff: k });
      } else {
        // A few overlapping puffs spread through the nebula's volume.
        const puffs = n.kind === 'pn' ? 1 : 3;
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
    this.galaxy.setCloudLayer(
      'nebulae',
      [{ clouds: dust, absorb: true }, { clouds: glow }, ...perPage.map((clouds, p) => ({ clouds, atlas: atlases[p] }))],
      labels,
    );
    this.galaxy.setRealLayerVisible('nebulae', $<HTMLInputElement>('opt-real-nebulae').checked);
    const count = (kind: string) => placed.filter((n) => n.kind === kind).length.toLocaleString('en-US');
    const imaged = perPage.reduce((sum, list) => sum + list.length, 0);
    $('galaxy-info').textContent += ` ${count('hii')} real HII regions (pink: hydrogen-alpha), ${count('pn')} planetary nebulae (teal: oxygen III), ${count('snr')} supernova remnants, ${count('refl')} reflection nebulae (blue: scattered starlight) and ${count('dark')} dark dust clouds (at Gaia distances of their molecular clouds) sit at their measured distances and true sizes; ${imaged.toLocaleString('en-US')} of them show their real Digitized Sky Survey photographs. Star-forming regions trace the spiral arms. ${imaged ? NEBULA_IMAGE_CREDIT : ''}`;
  }

  private readonly atlasPromises = new Map<number, Promise<THREE.Texture>>();
  /** A page of the nebula-image atlas as a texture (loaded once, shared by the galaxy map and the Sky tab). */
  private nebulaAtlas(images: NebulaImageAtlas, page: number): Promise<THREE.Texture> {
    let p = this.atlasPromises.get(page);
    if (!p) {
      p = new THREE.TextureLoader().loadAsync(nebulaAtlasUrl(images.pages[page])).then((tex) => {
        tex.anisotropy = 4;
        return tex;
      });
      this.atlasPromises.set(page, p);
    }
    return p;
  }

  private async showExoHostsOnMap(seed: number): Promise<void> {
    const catalog = await this.getCatalog().catch(() => undefined);
    if (!catalog || this.galaxySeed !== seed) return;
    const hosts = catalog.hosts.filter((h) => Number.isFinite(h.distancePc) && h.distancePc > 0);
    this.exoMapHosts = hosts;
    this.galaxy.setExoHosts(
      hosts.map((h) => {
        const [l, b] = equatorialToGalactic(h.raDeg, h.decDeg);
        return { name: h.name, pos: galacticToMap(l, b, h.distancePc / 1000), temperate: h.planets.some((p) => p.habitable) };
      }),
    );
    $('galaxy-info').textContent += ` Rings near the Sun mark ${hosts.length.toLocaleString('en-US')} real stars with known exoplanets (green: has a temperate planet); click one to visit it.`;
  }

  private buildGalaxy(seed: number, opts: GalaxyOptions & { origin?: string } = {}): void {
    this.galaxySeed = seed;
    this.galaxyOrigin = seed === MILKY_WAY_SEED ? 'Milky Way' : (opts.origin ?? '');
    const data = this.galaxy.build(seed, opts);
    this.galaxyBuilt = true;
    this.features = undefined;
    this.scanToken++;
    this.store.load(seed);
    $('galaxy-name').textContent = data.name;
    $('galaxy-info').textContent =
      data.name === 'Milky Way'
        ? `Our galaxy: real structure (4 spiral arms, the Local Spur, the central bar, Sgr A*) and the real clusters and nebulae listed below at their true positions. The ${data.stars.count.toLocaleString()} explorable systems are procedural stand-ins for the ~100 billion real stars.`
        : opts.origin
          ? `A procedural stand-in for the real ${data.form} galaxy ${data.name}: its overall shape follows the real galaxy's type, but its ${data.stars.count.toLocaleString()} stars are invented. Zoom out to return to the Universe map.`
          : `${data.arms}-armed spiral · ${data.stars.count.toLocaleString()} explorable systems · ${data.clusters.length} star clusters (a procedural galaxy)`;
    this.exoMapHosts = [];
    if (data.name === 'Milky Way') {
      void this.showExoHostsOnMap(seed);
      void this.showCompactObjectsOnMap(seed);
      void this.showNebulaeOnMap(seed);
      void this.showClustersOnMap(seed);
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
    if (typeof target === 'object') {
      const host = this.exoMapHosts[target.exo];
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
    if (typeof t !== 'number' || t === -1) return;
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
    yearsPerSecond = Math.min(yearsPerSecond, this.maxTimeScale);
    this.timeScale = yearsPerSecond;
    $<HTMLInputElement>('time-scale').value = String(Math.log10(yearsPerSecond));
    $('time-scale-out').textContent = formatRate(yearsPerSecond);
  }

  /** Scenes can raise the speed limit (moving stars need thousands of years per second). */
  private maxTimeScale = 100;
  private setMaxTimeScale(max: number): void {
    this.maxTimeScale = max;
    $<HTMLInputElement>('time-scale').max = String(Math.log10(max));
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
    $('tool-nudge').classList.toggle('active', tool === 'nudge');
    this.cancelNudge();
    $('spawn-options').classList.toggle('hidden', tool !== 'spawn');
    const mb = this.system.controls.mouseButtons;
    const touches = this.system.controls.touches;
    if (tool === 'spawn' || tool === 'nudge') {
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
    if (this.view === 'sky') text = 'Drag to look around · Scroll to zoom · Click a name to turn to it · Click the Moon or a planet for details';
    else if (this.view === 'cosmos') text = 'Click a name to fly there · Click a galaxy to inspect · Double-click to fly there · Zoom right in (or Enter) to visit · Scroll out for the cosmic web';
    else if (this.view === 'galaxy') text = 'Click a name to fly there · Click a star to inspect · Double-click to fly there · Zoom right in (or Enter) to visit · Zoom far out for other galaxies';
    else if (this.tool === 'spawn') text = 'Click to place · Drag to set velocity · Right-drag to orbit camera · Esc to cancel';
    else if (this.tool === 'nudge') text = 'Press on a body and drag to push it · Dashed line previews the new path · Right-drag to orbit camera';
    else text = 'Click to select · Click a name or double-click to follow · Space pause · Hold R rewind · Ctrl+Z undo · B spawn · M galaxy map';
    $('hint').textContent = text;
  }

  private syncSettingsUi(): void {
    const s = this.sim;
    // Galaxy-scale scenes keep G in kpc/Myr units; the slider shows the multiplier on top of that.
    const gBase = s.units === 'kpc-myr' ? KPC_MYR_GRAVITY_SCALE : 1;
    $<HTMLInputElement>('gravity').value = String(s.gravityScale / gBase);
    $('gravity-out').textContent = (s.gravityScale / gBase).toFixed(2);
    $<HTMLInputElement>('opt-collisions').checked = s.collisions;
    $<HTMLInputElement>('opt-debris').checked = s.debris;
    $<HTMLInputElement>('opt-shatter').checked = s.shatter;
    $<HTMLInputElement>('opt-tidal').checked = s.tidal;
    $<HTMLInputElement>('opt-relativity').checked = s.relativity;
    $<HTMLInputElement>('opt-truescale').checked = s.trueScale;
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
    this.shareEdit();
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
    if (this.blockedInChallenge('Undo')) return;
    const entry = this.history.undo(captureState(this.sim));
    if (!entry) return;
    this.restore(entry.state);
    toast(`Undid ${entry.label}`);
    this.updateUndoButtons();
  }

  private redo(): void {
    if (this.blockedInChallenge('Redo')) return;
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
    if (this.rewindTimer !== undefined || this.view !== 'system' || this.blockedInChallenge('Rewind')) return;
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
    this.closeExoBrowser();
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
    setDisplayUnits(this.sim.units);
    $('sim-time').textContent = formatTime(this.sim.time);
    const status = this.host.getStatus();
    $('lag').classList.toggle('hidden', !status.lagging);
    const n = this.sim.bodies.length;
    $('stats').textContent = `${Math.round(this.fps)} fps · ${n.toLocaleString()} bodies · ${this.sim.particles.count.toLocaleString()} particles`;
    $('engine-info').textContent = `Physics: ${status.threaded ? 'Web Worker' : 'main thread'}${status.cores > 1 ? ` · ${status.cores} CPU cores for particles` : ''} · Gravity: ${status.usingTree ? 'Barnes–Hut tree' : 'direct N²'}`;
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
      [this.sim.trueScale ? 'Radius' : 'Radius (enlarged)', this.sim.trueScale ? formatKm(body.radius) : formatDistance(body.radius)],
    ];
    const alerts: string[] = [];
    if (body.kind === 'rocky' || body.kind === 'gas') {
      const t = bodyTemperature(this.sim.bodies, body);
      facts.push(['Temperature', formatTemperature(t)], ['Climate', capitalize(climateFor(body.kind, t))]);
      if (isHabitable(body.kind, body.mass, t)) alerts.push(`<div class="alert good">🌍 Habitable: liquid water could exist on the surface.</div>`);
    } else if (body.kind === 'star' && body.tag !== 'galaxy') {
      facts.push(['Surface temp.', `${Math.round(starTemperature(body.mass)).toLocaleString()} K`]);
    }
    if ((body.kind === 'star' || body.kind === 'giant' || body.kind === 'whitedwarf') && body.tag !== 'galaxy') {
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
        facts.push(['Orbit', `a = ${formatDistance(a)}, e = ${e.toFixed(2)}`], ['Period', formatTime(2 * Math.PI * Math.sqrt((a * a * a) / mu))]);
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
    $('btn-supernova').classList.toggle('hidden', !this.sim.canSupernova(body) || body.tag === 'galaxy');
    $('btn-visit').classList.toggle('hidden', !(body.tag?.startsWith('exohost:') || body.tag === 'home'));
    const inChallenge = !!this.challenge;
    for (const id of ['btn-mass-up', 'btn-mass-down', 'btn-delete']) $(id).classList.toggle('hidden', inChallenge);
    if (inChallenge) $('btn-supernova').classList.add('hidden');
    this.updateProbePanel(body);
  }

  // ---------------------------------------------------------------------------
  // Probes: burns and transfer planning

  private burnSize(): number {
    return Math.pow(10, Number($<HTMLInputElement>('burn-size').value)) * KMS;
  }

  private updateProbePanel(body: Body): void {
    const isProbe = body.tag === 'probe';
    $('probe-controls').classList.toggle('hidden', !isProbe);
    if (!isProbe) return;
    $('probe-fuel').textContent = body.fuel !== undefined ? `fuel ${(body.fuel / KMS).toFixed(2)} km/s` : 'unlimited fuel';
    $('burn-size-out').textContent = `${(this.burnSize() / KMS).toFixed(2)} km/s`;
    const parent = this.sim.parentOf(body);
    const select = $<HTMLSelectElement>('transfer-target');
    const options = parent ? this.sim.bodies.filter((b) => b !== body && b !== parent && b.tag !== 'probe' && this.sim.parentOf(b) === parent) : [];
    const sig = options.map((o) => o.id).join(',');
    if (select.dataset.sig !== sig) {
      const prev = select.value;
      select.innerHTML = `<option value="">Choose a target…</option>` + options.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('');
      select.value = options.some((o) => String(o.id) === prev) ? prev : '';
      select.dataset.sig = sig;
    }
    const target = select.value ? this.sim.getBody(Number(select.value)) : undefined;
    const btn = $('btn-transfer');
    if (!target || !parent) {
      $('transfer-plan').textContent = options.length ? 'Pick a target for a Hohmann transfer plan.' : '';
      btn.classList.add('hidden');
      return;
    }
    const plan = planHohmann(body, target, parent, this.sim.gravityScale);
    const deg = (r: number) => `${Math.round((r * 180) / Math.PI)}°`;
    const timing = plan.wait < 0.01 ? 'Burn now!' : `Wait ${formatTime(plan.wait)} for the alignment.`;
    $('transfer-plan').textContent = `Departure burn ${(Math.abs(plan.dv1) / KMS).toFixed(2)} km/s ${plan.dv1 >= 0 ? 'prograde' : 'retrograde'}, arrival burn ${(Math.abs(plan.dv2) / KMS).toFixed(2)} km/s, flight time ${formatTime(plan.timeOfFlight)}. ${target.name} should lead by ${deg(plan.phaseNeeded)} (now ${deg(plan.phaseNow)}). ${timing}`;
    btn.classList.remove('hidden');
    btn.textContent = `Burn ${(Math.abs(plan.dv1) / KMS).toFixed(2)} km/s ${plan.dv1 >= 0 ? 'prograde' : 'retrograde'}`;
    btn.dataset.dv = String(plan.dv1);
  }

  private burn(direction: 'prograde' | 'retrograde' | 'out' | 'in', size = this.burnSize()): void {
    const body = this.selectedBody();
    const parent = body && this.sim.parentOf(body);
    if (!body || !parent) return;
    if (body.fuel !== undefined && body.fuel <= 1e-9) return void toast('Out of fuel');
    const { prograde, radial } = burnDirections(body, parent);
    const dir = direction === 'prograde' ? prograde : direction === 'retrograde' ? prograde.map((v) => -v) : direction === 'out' ? radial : radial.map((v) => -v);
    let used = 0;
    this.mutateGame(`burn on ${body.name}`, () => {
      used = applyNudge(body, [dir[0] * size, dir[1] * size, dir[2] * size]);
    });
    if (this.challenge) this.challenge.st.dvUsed += used;
    this.updateBodyPanel();
  }

  // ---------------------------------------------------------------------------
  // Nudge tool

  private canNudge(body: Body): boolean {
    if (!this.challenge) return true;
    return body.tag === 'pushable' || body.tag === 'probe';
  }

  private nudgeVector(drag: NonNullable<App['nudgeDrag']>, body: Body): THREE.Vector3 {
    const parent = this.sim.parentOf(body);
    let perUnit = 1;
    if (parent) {
      const r = Math.max(1e-3, Math.hypot(body.x - parent.x, body.y - parent.y, body.z - parent.z));
      perUnit = Math.sqrt((G * Math.max(this.sim.gravityScale, 0.05) * parent.mass) / (r * r * r)) * 0.5;
    }
    const dv = drag.current.clone().sub(drag.start).multiplyScalar(perUnit);
    const max = this.challenge?.def.rules.maxDvKms;
    let limit = max !== undefined && body.tag !== 'probe' ? max * KMS : Infinity;
    if (body.fuel !== undefined) limit = Math.min(limit, body.fuel);
    if (dv.length() > limit) dv.setLength(limit);
    return dv;
  }

  private updateNudgePreview(now: number): void {
    const drag = this.nudgeDrag;
    const body = drag && this.sim.getBody(drag.bodyId);
    if (!drag || !body) return this.cancelNudge();
    drag.start.set(body.x, body.y, body.z);
    const dv = this.nudgeVector(drag, body);
    if (now - drag.lastPredict > 60) {
      drag.lastPredict = now;
      drag.path = predictPath(this.sim, { mass: body.mass, kind: body.kind, radius: body.radius, x: body.x, y: body.y, z: body.z, vx: body.vx + dv.x, vy: body.vy + dv.y, vz: body.vz + dv.z }, 500, 8, body.id);
    }
    const parent = this.sim.parentOf(body);
    const perUnit = parent ? Math.sqrt((G * parent.mass) / Math.max(1e-9, Math.hypot(body.x - parent.x, body.z - parent.z) ** 3)) * 0.5 : 1;
    this.system.showSpawnPreview(drag.start, 0, dv, 1 / perUnit, drag.path);
    $('hint').textContent = `Push ${body.name}: ${(dv.length() / KMS).toFixed(2)} km/s · release to apply`;
  }

  private cancelNudge(): void {
    if (!this.nudgeDrag) return;
    this.nudgeDrag = undefined;
    this.system.hideSpawnPreview();
    this.updateHint();
  }

  private commitNudge(): void {
    const drag = this.nudgeDrag;
    const body = drag && this.sim.getBody(drag.bodyId);
    this.cancelNudge();
    if (!drag || !body) return;
    const dv = this.nudgeVector(drag, body);
    if (dv.length() < 1e-9) return;
    let used = 0;
    this.mutateGame(`nudging ${body.name}`, () => {
      used = applyNudge(body, [dv.x, dv.y, dv.z]);
    });
    if (this.challenge) {
      if (body.tag !== 'probe') this.challenge.st.pushes++;
      this.challenge.st.dvUsed += used;
    }
    toast(`Pushed ${body.name} by ${(used / KMS).toFixed(2)} km/s`);
  }

  /** Like mutate(), but challenges don't record undo history. */
  private mutateGame(label: string, fn: () => void): void {
    if (this.challenge) {
      fn();
      this.host.commit();
      this.shareEdit();
    } else {
      this.mutate(label, fn);
    }
  }

  // ---------------------------------------------------------------------------
  // Live graph

  private openGraph(metric?: MetricId): void {
    if (metric) this.graphMetric = metric;
    this.graphOpen = true;
    $<HTMLSelectElement>('graph-metric').value = this.graphMetric;
    if (this.view === 'system') $('graph-panel').classList.remove('hidden');
    this.chart ??= new LineChart($<HTMLCanvasElement>('graph-canvas'));
    this.resetGraph();
  }

  private closeGraph(): void {
    this.graphOpen = false;
    $('graph-panel').classList.add('hidden');
  }

  private resetGraph(): void {
    this.graphSeries = [];
    this.graphStart = this.sim.time;
    this.graphLastTime = NaN;
    this.graphBodyId = this.system.selectedId;
  }

  private sampleGraph(dt: number): void {
    const info = METRICS.find((m) => m.id === this.graphMetric)!;
    if (info.perBody && this.system.selectedId !== this.graphBodyId) this.resetGraph();
    this.graphTimer -= dt;
    if (this.graphTimer > 0) return;
    this.graphTimer = 0.1;
    const body = this.selectedBody();
    const note = info.perBody && !body ? 'Select a body to graph it.' : info.perBody ? `${body!.name} · x: years since the graph started` : 'Whole system · x: years';
    $('graph-note').textContent = note;
    if (this.sim.time !== this.graphLastTime) {
      this.graphLastTime = this.sim.time;
      let v = measure(this.sim, this.graphMetric, body);
      if (v !== undefined && Number.isFinite(v)) {
        const last = this.graphSeries[this.graphSeries.length - 1];
        // Keep angles continuous instead of wrapping at ±180°.
        if (this.graphMetric === 'periapsis' && last) while (v - last[1] > 180) v -= 360;
        if (this.graphMetric === 'periapsis' && last) while (v - last[1] < -180) v += 360;
        this.graphSeries.push([this.sim.time - this.graphStart, v]);
        if (this.graphSeries.length > 1200) this.graphSeries.splice(0, this.graphSeries.length - 1200);
      }
    }
    const series: Series[] = [{ label: 'This run', color: '#7fdcff', points: this.graphSeries }];
    if (this.graphRef) series.push(this.graphRef);
    this.chart!.draw(series, 'years', `${info.label}${info.unit ? ` (${info.unit})` : ''}`);
  }

  // ---------------------------------------------------------------------------
  // Lessons

  private openLessonMenu(): void {
    $('lesson-list').innerHTML = LESSONS.map((l) => {
      const done = prefs.get<boolean>(`lesson:${l.id}`, false);
      return `<div class="card"><h3>${done ? '✓ ' : ''}${escapeHtml(l.title)}</h3><p>${escapeHtml(l.summary)}</p><div class="row"><span class="muted small" style="flex:1">${l.steps.length} steps</span><button class="primary" data-lesson="${l.id}">Start</button></div></div>`;
    }).join('');
    $('lesson-menu').classList.remove('hidden');
  }

  private startLesson(def: Lesson): void {
    $('lesson-menu').classList.add('hidden');
    if (this.challenge) this.quitChallenge();
    if (this.view !== 'system') this.setView('system');
    this.lesson = { def, step: 0, events: [], done: new Set() };
    document.body.classList.add('lesson-active');
    $('lesson-card').classList.remove('hidden');
    this.showLessonStep(0);
  }

  private exitLesson(): void {
    this.lesson = undefined;
    document.body.classList.remove('lesson-active');
    $('lesson-card').classList.add('hidden');
  }

  private showLessonStep(i: number): void {
    const l = this.lesson;
    if (!l) return;
    if (i >= l.def.steps.length) {
      prefs.set(`lesson:${l.def.id}`, true);
      toast(`Lesson complete: ${l.def.title}`);
      this.exitLesson();
      return;
    }
    l.step = Math.max(0, i);
    const step = l.def.steps[l.step];
    if (step.setup) {
      const setup = step.setup;
      this.loadScenario({ name: l.def.title, description: l.def.summary, load: () => setup(this.sim) }, { undoable: false, lesson: true });
      this.setRunning(true);
      l.events = [];
    }
    if (step.select) {
      const b = this.sim.bodies.find((x) => x.name === step.select);
      if (b) {
        this.selectBody(b);
        this.system.follow(b.id);
      }
    }
    if (step.graph) this.openGraph(step.graph);
    $('lesson-step').textContent = `${l.def.title} · step ${l.step + 1} of ${l.def.steps.length}`;
    $('lesson-title').textContent = step.title;
    $('lesson-text').innerHTML = step.text
      .split('\n\n')
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join('');
    $<HTMLButtonElement>('lesson-back').disabled = l.step === 0;
    $('lesson-next').textContent = l.step === l.def.steps.length - 1 ? 'Finish' : 'Next';
    this.renderLessonTask();
  }

  private renderLessonTask(): void {
    const l = this.lesson;
    if (!l) return;
    const step = l.def.steps[l.step];
    const el = $('lesson-task');
    el.classList.toggle('hidden', !step.task);
    if (!step.task) return;
    const done = l.done.has(l.step);
    el.className = `alert ${done ? 'good' : 'warn'}`;
    el.textContent = `${done ? '✓' : '→'} ${step.task}`;
  }

  private checkLesson(): void {
    const l = this.lesson;
    if (!l) return;
    const step = l.def.steps[l.step];
    if (!step.check || l.done.has(l.step)) return;
    const ok = step.check({
      sim: this.sim,
      selected: this.selectedBody(),
      events: l.events,
      flags: { habitableZones: this.system.habitableZones, lagrange: this.system.lagrangeEnabled, relativity: this.sim.relativity, graphMetric: this.graphOpen ? this.graphMetric : undefined },
    });
    if (ok) {
      l.done.add(l.step);
      this.renderLessonTask();
      this.audio.play('ignite', 0.05);
      toast('✓ Nice! Press Next to continue.');
    }
  }

  // ---------------------------------------------------------------------------
  // Challenges

  private blockedInChallenge(what: string): boolean {
    if (!this.challenge || this.challenge.result) return false;
    toast(`${what} isn't available during a challenge`);
    return true;
  }

  private openChallengeMenu(): void {
    const daily = dailyChallenge();
    const cards = [daily, ...CHALLENGES].map((c) => {
      const best = prefs.get<number>(`stars:${c.id}`, 0);
      const stars = '★'.repeat(best) + '☆'.repeat(3 - best);
      return `<div class="card${c === daily ? ' daily' : ''}"><h3>${escapeHtml(c.title)}</h3><p>${escapeHtml(c.summary)}</p><div class="row"><span class="stars" style="flex:1">${stars}</span><button class="primary" data-challenge="${c.id}">Play</button></div></div>`;
    });
    $('challenge-list').innerHTML = cards.join('');
    $('challenge-menu').classList.remove('hidden');
  }

  private findChallenge(id: string): Challenge | undefined {
    const daily = dailyChallenge();
    return id === daily.id ? daily : CHALLENGES.find((c) => c.id === id);
  }

  private startChallenge(def: Challenge): void {
    $('challenge-menu').classList.add('hidden');
    $('challenge-result').classList.add('hidden');
    if (this.lesson) this.exitLesson();
    if (this.view !== 'system') this.setView('system');
    this.challenge = { def, st: newChallengeState(this.sim) };
    this.loadScenario({ name: def.title, description: def.goal, load: () => def.setup(this.sim) }, { undoable: false, challenge: true });
    this.challenge.st = newChallengeState(this.sim);
    // Start paused so the player can read the goal and plan.
    this.setRunning(false);
    setTimeout(() => toast('Paused: read the goal, plan your move, then press ▶ (Space).'), 400);
    this.setTool(def.rules.pushes ? 'nudge' : 'select');
    const allowed = def.rules.spawns ? def.rules.spawnTypes ?? [] : [];
    $('spawn-palette').querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('hidden', !allowed.includes(b.dataset.type!)));
    $<HTMLButtonElement>('tool-spawn').disabled = !allowed.length;
    if (allowed.length) {
      const t = SPAWN_TYPES.find((s) => s.id === allowed[0]);
      if (t) this.spawnType = t;
    }
    $('hud-title').textContent = def.title;
    $('hud-goal').textContent = def.goal;
    $('hud-progress').textContent = '';
    $('challenge-hud').classList.remove('hidden');
    this.updateUndoButtons();
  }

  private quitChallenge(): void {
    this.challenge = undefined;
    $('challenge-hud').classList.add('hidden');
    $('challenge-result').classList.add('hidden');
    $('spawn-palette').querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.remove('hidden'));
    $<HTMLButtonElement>('tool-spawn').disabled = false;
  }

  private evaluateChallenge(): void {
    const c = this.challenge;
    if (!c || c.result) return;
    const res = c.def.evaluate(this.sim, c.st);
    const rules = c.def.rules;
    const extras: string[] = [];
    if (rules.pushes) extras.push(`pushes ${c.st.pushes}/${rules.pushes}`);
    if (rules.spawns) extras.push(`spawns ${c.st.spawns}/${rules.spawns}`);
    $('hud-progress').textContent = [res.progress, ...extras].filter(Boolean).join(' · ');
    if (res.status === 'playing') return;
    c.result = res;
    this.setRunning(false);
    const best = prefs.get<number>(`stars:${c.def.id}`, 0);
    if (res.status === 'won' && (res.stars ?? 0) > best) prefs.set(`stars:${c.def.id}`, res.stars);
    $('result-stars').textContent = res.status === 'won' ? '★'.repeat(res.stars ?? 1) + '☆'.repeat(3 - (res.stars ?? 1)) : '';
    $('result-title').textContent = res.status === 'won' ? 'Challenge complete!' : 'Not this time';
    $('result-text').textContent = res.status === 'won' ? res.progress : (res.reason ?? '');
    $('result-share').classList.toggle('hidden', res.status !== 'won');
    $('challenge-result').classList.remove('hidden');
    this.audio.play(res.status === 'won' ? 'ignite' : 'collapse', 0.1);
  }

  // ---------------------------------------------------------------------------
  // Real data: exoplanets, the solar neighbourhood, dated Solar System

  private async getCatalog(): Promise<ExoCatalog> {
    if (this.catalog) return this.catalog;
    $('exo-status').textContent = 'Loading the NASA Exoplanet Archive catalogue…';
    this.catalog = await loadCatalog();
    return this.catalog;
  }

  private async openExoBrowser(): Promise<void> {
    this.exoOpen = true;
    this.hideBodyPanel();
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

  private closeExoBrowser(): void {
    this.exoOpen = false;
    $('exo-panel').classList.add('hidden');
  }

  private renderExoList(): void {
    const c = this.catalog;
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

  private exoScenario(host: ExoHost): Scenario {
    const temperate = host.planets.filter((p) => p.habitable).length;
    const desc = `${host.name}: ${host.planets.length} confirmed planet${host.planets.length === 1 ? '' : 's'}${temperate ? `, ${temperate} temperate` : ''}, ${
      Number.isFinite(host.distancePc) ? `${(host.distancePc * 3.2616).toFixed(1)} light-years away` : 'distance unknown'
    }. Data: NASA Exoplanet Archive; masses marked as estimated come from radii. Body sizes are scaled to fit the orbits.`;
    return { name: host.name, description: desc, load: () => loadExoSystem(this.sim, host), origin: { kind: 'exo', host } };
  }

  private loadExoHost(host: ExoHost): void {
    this.closeExoBrowser();
    this.loadScenario(this.exoScenario(host));
  }

  private async loadNeighbourhoodScene(): Promise<void> {
    try {
      const [stars, c] = await Promise.all([loadNearStars(), this.getCatalog().catch(() => undefined)]);
      this.loadScenario({ name: 'the solar neighbourhood', load: () => loadStarNeighbourhood(this.sim, stars, c, 10), origin: { kind: 'neighbourhood' } });
      this.setView('system');
    } catch (err) {
      toast((err as Error).message);
    }
  }

  private async loadGaia100Scene(): Promise<void> {
    try {
      toast('Loading 44,500 Gaia stars…');
      const [data, near] = await Promise.all([loadStars100(), loadNearStars().catch(() => [])]);
      this.loadScenario({ name: 'stars within 326 light-years (Gaia)', load: () => loadNeighbourhood100(this.sim, data, near), origin: { kind: 'neighbourhood' } });
      this.setView('system');
    } catch (err) {
      toast((err as Error).message);
    }
  }

  private async visitSelected(): Promise<void> {
    const body = this.selectedBody();
    if (!body?.tag) return;
    if (body.tag === 'home') {
      this.loadScenario({ name: 'the Solar System', load: () => loadSolarSystemOnDate(this.sim, new Date()), origin: { kind: 'sol' } });
      return;
    }
    const name = body.tag.slice('exohost:'.length);
    const host = (await this.getCatalog()).hosts.find((h) => h.name === name);
    if (host) this.loadExoHost(host);
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
    const radius = this.spawnType.particles ? 0 : this.sim.bodyRadius(kind, this.spawnMass());
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
    if (this.challenge) {
      const max = this.challenge.def.rules.spawns ?? 0;
      if (this.challenge.st.spawns >= max) return void toast('No spawns left in this challenge');
      this.challenge.st.spawns++;
    }
    const rng = mulberry32((Date.now() ^ (this.spawnCounter * 2654435761)) >>> 0);
    const kind = this.spawnKind();
    this.spawnCounter++;
    let body: Body | undefined;
    const add = () => {
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
        ...(t.id === 'probe' ? { tag: 'probe', fuel: 10 * KMS } : {}),
      });
    };
    if (this.challenge) {
      add();
      this.host.commit();
    } else {
      this.mutate(`spawning a ${t.label.toLowerCase()}`, add);
    }
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
      // A click on a name label goes there: select the body and follow it.
      const labelled = this.system.pickLabel(e.clientX, e.clientY);
      if (labelled && 'lagrange' in labelled) {
        // A Lagrange point: glide to it and keep it centred as it moves.
        this.system.followLagrange(labelled.lagrange);
        toast(`Following ${labelled.name}`);
        return;
      }
      const body = labelled && 'body' in labelled ? this.sim.getBody(labelled.body) : undefined;
      if (body) {
        this.selectBody(body);
        this.system.follow(body.id);
        return;
      }
      this.selectBody(this.system.pick(x, y, this.width, this.height));
    } else if (this.view === 'galaxy') {
      const label = this.galaxy.pickLabel(x, y);
      if (label) {
        if (label.target !== undefined) this.selectTarget(label.target);
        this.galaxy.flyToPoint(label.pos, label.distance);
        toast(`Flying to ${label.name}`);
        return;
      }
      this.selectTarget(this.galaxy.pick(x, y, this.width, this.height));
    } else if (this.view === 'cosmos') {
      const label = this.cosmos.pickLabel(x, y);
      if (label) {
        if (label.index !== undefined) {
          this.selectCosmos(label.index);
          this.cosmos.flyTo(label.index);
        } else {
          this.cosmos.flyToPoint(label.pos, label.distance);
        }
        toast(`Flying to ${label.name}`);
        return;
      }
      this.selectCosmos(this.cosmos.pick(x, y, this.width, this.height));
    } else if (this.view === 'sky') {
      const label = this.sky.pickLabel(x, y);
      if (label) this.sky.goToLabel(label);
      this.skyPicked = label?.userData.body ?? this.sky.pick(x, y);
      this.renderSkyList();
    }
  }

  private handleDoubleClick(e: { clientX: number; clientY: number }): void {
    const [x, y] = this.ndc(e);
    if (this.view === 'cosmos') {
      const index = this.cosmos.pick(x, y, this.width, this.height);
      if (index !== -1) {
        this.selectCosmos(index);
        this.cosmos.flyTo(index);
      }
      return;
    }
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

  private lastHover = 0;

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY, button: e.button, time: performance.now() };
      if (this.view === 'system' && this.tool === 'nudge' && e.button === 0 && e.isPrimary) {
        const [x, y] = this.ndc(e);
        const body = this.system.pick(x, y, this.width, this.height);
        if (body && !this.canNudge(body)) {
          toast(`${body.name} can't be pushed in this challenge`);
        } else if (body && this.challenge && body.tag !== 'probe' && this.challenge.st.pushes >= (this.challenge.def.rules.pushes ?? 0)) {
          toast('No pushes left');
        } else if (body) {
          const start = new THREE.Vector3(body.x, body.y, body.z);
          const point = this.system.planePoint(x, y, body.y) ?? start.clone();
          this.nudgeDrag = { bodyId: body.id, start, current: point, lastPredict: 0 };
          this.selectBody(body);
          c.setPointerCapture(e.pointerId);
        }
      }
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
      // A pointing hand over name labels, which can be clicked to go there (checked ~10 times a second).
      if (e.pointerType === 'mouse' && e.buttons === 0 && performance.now() - this.lastHover > 100) {
        this.lastHover = performance.now();
        const [x, y] = this.ndc(e);
        const onLabel =
          this.view === 'galaxy' ? !!this.galaxy.pickLabel(x, y)
          : this.view === 'sky' ? !!this.sky.pickLabel(x, y)
          : this.view === 'cosmos' ? !!this.cosmos.pickLabel(x, y)
          : this.view === 'system' && this.tool === 'select' ? this.system.pickLabel(e.clientX, e.clientY) !== undefined
          : false;
        c.style.cursor = onLabel ? 'pointer' : '';
      }
      if (this.nudgeDrag && e.isPrimary) {
        const [x, y] = this.ndc(e);
        const p = this.system.planePoint(x, y, this.nudgeDrag.start.y);
        if (p) this.nudgeDrag.current.copy(p);
        return;
      }
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
      if (this.nudgeDrag) {
        this.commitNudge();
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
        if (this.view !== 'system') void this.switchToSandbox();
        else void this.exitToGalaxy();
      }
      if (key === '?') this.openTutorial();
      if (key === '`') {
        e.preventDefault();
        $('btn-console').click();
        return;
      }
      if (this.view === 'cosmos') {
        if (key === 'enter' && this.cosmos.selected !== -1) void this.visitCosmosGalaxy(this.cosmos.selected);
        if (key === 'escape') this.selectCosmos(-1);
        return;
      }
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
        case 'n':
          this.setTool('nudge');
          break;
        case 'g':
          if (this.graphOpen) this.closeGraph();
          else this.openGraph();
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
          this.setTimeScale(Math.pow(10, Math.log10(this.timeScale) + 0.1));
          break;
        case 'escape':
          if (this.spawnDrag) this.cancelSpawn();
          else if (this.nudgeDrag) this.cancelNudge();
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
    $('tab-galaxy').addEventListener('click', () => {
      if (this.view === 'system') void this.exitToGalaxy();
      else if (this.view === 'sky') void this.switchView('galaxy');
      else if (this.view === 'cosmos') void this.visitCosmosGalaxy(this.cosmos.indexOf(this.galaxyOrigin || 'Milky Way'));
    });
    $('tab-cosmos').addEventListener('click', () => this.view !== 'cosmos' && void this.openCosmos(this.view === 'galaxy'));
    $('btn-cosmos-fly').addEventListener('click', () => this.cosmos.selected !== -1 && this.cosmos.flyTo(this.cosmos.selected));
    $('btn-cosmos-visit').addEventListener('click', () => this.cosmos.selected !== -1 && void this.visitCosmosGalaxy(this.cosmos.selected));
    $('btn-cosmos-home').addEventListener('click', () => {
      const mw = this.cosmos.indexOf('Milky Way');
      this.selectCosmos(mw);
      this.cosmos.resetCamera();
    });
    $<HTMLInputElement>('opt-cosmic-web').addEventListener('change', (e) => this.cosmos.setWebVisible((e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-real-nebulae').addEventListener('change', (e) => this.galaxy.setRealLayerVisible('nebulae', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-real-clusters').addEventListener('change', (e) => this.galaxy.setRealLayerVisible('clusters', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-cmb').addEventListener('change', (e) => this.cosmos.setCmbVisible((e.target as HTMLInputElement).checked));
    $('cosmos-search').addEventListener('input', () => this.renderCosmosSearch());
    $('cosmos-results').addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('[data-galaxy]');
      if (!li) return;
      const index = Number(li.dataset.galaxy);
      this.selectCosmos(index);
      this.cosmos.flyTo(index);
    });
    $('tab-system').addEventListener('click', () => void this.switchToSandbox());
    $('tab-sky').addEventListener('click', () => void this.openSky());
    this.wireSkyPanel();
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
    const postfxBox = $<HTMLInputElement>('opt-postfx');
    postfxBox.checked = this.postfxOn;
    postfxBox.addEventListener('change', () => {
      this.postfxOn = postfxBox.checked;
      prefs.set('postfx', this.postfxOn);
    });
    $('btn-vr').addEventListener('click', () => void this.enterVR().catch((err) => toast(`Couldn't start VR: ${(err as Error).message}`)));
    $('btn-gpu').addEventListener('click', () => void this.openMegaSim());
    $('gpu-restart').addEventListener('click', () => this.restartMegaSim());
    $('gpu-exit').addEventListener('click', () => this.closeMegaSim());
    $('gpu-steps').addEventListener('change', () => this.mega && (this.mega.stepsPerFrame = Number($<HTMLSelectElement>('gpu-steps').value)));
    $('gpu-pause').addEventListener('click', () => {
      if (!this.mega) return;
      this.mega.paused = !this.mega.paused;
      $('gpu-pause').textContent = this.mega.paused ? 'Resume' : 'Pause';
    });
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
        // The Open button accepts both scene files and replay files.
        const text = await file.text();
        if (text.includes('"astrarium-replay"')) this.startReplay(new ReplayPlayer(parseReplay(text)));
        else this.applyScene(await readSceneFile(file));
      } catch (err) {
        toast((err as Error).message);
      }
    });
    $('btn-share').addEventListener('click', () => void this.shareLink());

    // Real data
    const dateInput = $<HTMLInputElement>('solar-date');
    dateInput.value = new Date().toISOString().slice(0, 10);
    $('btn-solar-date').addEventListener('click', () => {
      const date = dateInput.value ? new Date(`${dateInput.value}T00:00:00Z`) : new Date();
      if (Number.isNaN(date.getTime())) return toast('Pick a valid date');
      this.loadScenario({ name: `the Solar System on ${date.toISOString().slice(0, 10)}`, load: () => loadSolarSystemOnDate(this.sim, date), origin: { kind: 'sol' } });
    });
    $('btn-exoplanets').addEventListener('click', () => void this.openExoBrowser());
    void loadGwEvents()
      .then((events) => {
        $('gw-select').innerHTML = events
          .map((e, i) => `<option value="${i}">${e.name} · ${e.kind === 'BNS' ? 'neutron stars' : e.kind === 'NSBH' ? 'neutron star + black hole' : 'black holes'} · ${e.m1} + ${e.m2} M☉</option>`)
          .join('');
      })
      .catch(() => ($('gw-select').innerHTML = '<option value="">GW events unavailable</option>'));
    void loadFlybys()
      .then((list) => {
        $('flyby-select').innerHTML = list
          .map((f, i) => `<option value="${i}">${f.name} · ${f.date.slice(0, 11)} · ${f.distAu * 149597870.7 < 1e6 ? `${Math.round(f.distAu * 149597870.7).toLocaleString('en-US')} km` : `${(f.distAu * 149597870.7 / 1e6).toFixed(2)} million km`}</option>`)
          .join('');
      })
      .catch(() => ($('flyby-select').innerHTML = '<option value="">Flybys unavailable</option>'));
    $('btn-flyby-load').addEventListener('click', async () => {
      const list = await loadFlybys().catch(() => []);
      const f = list[Number($<HTMLSelectElement>('flyby-select').value)];
      if (f) this.loadScenario({ name: `${f.name} flyby`, description: `Real close approach of ${f.name} to Earth on ${f.date} UTC (JPL).`, load: () => loadFlyby(this.sim, f) });
    });
    void loadVoyagerEncounters()
      .then((list) => {
        $('voyager-select').innerHTML = list
          .map((e, i) => `<option value="${i}">${e.craft} · ${e.planet} · ${e.closestUtc.slice(0, 4)}</option>`)
          .join('');
        $<HTMLSelectElement>('voyager-select').value = String(Math.max(0, list.findIndex((e) => e.craft === 'Voyager 2')));
      })
      .catch(() => ($('voyager-select').innerHTML = '<option value="">Voyager data unavailable</option>'));
    $('btn-voyager-load').addEventListener('click', async () => {
      const list = await loadVoyagerEncounters().catch(() => []);
      const select = $<HTMLSelectElement>('voyager-select');
      const i = Number(select.value);
      const e = list[i];
      if (!e) return;
      const data = await loadSolarData().catch(() => getSolarData());
      this.loadScenario({ name: `${e.craft} at ${e.planet}`, description: `${e.craft}'s real flyby of ${e.planet} on ${e.closestUtc.slice(0, 10)} (JPL Horizons).`, load: () => loadVoyagerEncounter(this.sim, e, data) });
      // The next press continues the tour with the same spacecraft.
      const next = list.findIndex((x, j) => j > i && x.craft === e.craft);
      if (next >= 0) select.value = String(next);
    });
    $('btn-gw-hear').addEventListener('click', async () => {
      const events = await loadGwEvents().catch(() => []);
      const ev = events[Number($<HTMLSelectElement>('gw-select').value)];
      if (!ev) return;
      const pitch = $<HTMLInputElement>('gw-pitch').checked ? 4 : 1;
      const c = synthesizeChirp(ev, { pitch });
      const seconds = playSamples(c.samples, c.sampleRate);
      const hz = (f: number) => `${Math.round(f * pitch).toLocaleString('en-US')} Hz`;
      toast(
        `${ev.name}: ${seconds < 1 ? `${seconds.toFixed(2)} s` : `${seconds.toFixed(1)} s`} rising from ${hz(c.fStart)}${
          c.fRing ? ` to the final black hole's ring at ${hz(c.fRing)}` : ` to ${hz(c.fIsco)}, where the neutron stars touch`
        }${pitch > 1 ? ' (4× real pitch)' : ''}. Synthesized from the real masses at redshift ${c.redshift.toFixed(2)}, not the detector recording.`,
      );
    });
    $('btn-gw-load').addEventListener('click', async () => {
      const events = await loadGwEvents().catch(() => []);
      const ev = events[Number($<HTMLSelectElement>('gw-select').value)];
      if (ev) this.loadScenario({ name: ev.name, description: `${ev.about}${ev.massNote ? ` ${ev.massNote}` : ''}`, load: () => loadGwEvent(this.sim, ev) });
    });
    $('exo-close').addEventListener('click', () => this.closeExoBrowser());
    $('exo-search').addEventListener('input', () => this.renderExoList());
    $('exo-filter').addEventListener('change', () => this.renderExoList());
    const pickHost = (e: Event) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-host]');
      const host = li && this.catalog?.hosts.find((h) => h.name === li.dataset.host);
      if (host) this.loadExoHost(host);
    };
    $('exo-list').addEventListener('click', pickHost);
    $('exo-list').addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && pickHost(e));
    $('btn-neighbourhood').addEventListener('click', () => void this.loadNeighbourhoodScene());
    $('btn-gaia100').addEventListener('click', () => void this.loadGaia100Scene());
    $('btn-halley').addEventListener('click', async () => {
      try {
        const [h] = await Promise.all([loadHalleyReturn(), loadSolarData()]);
        this.loadScenario({ name: "Halley's return (2061)", description: "Comet Halley's real 2061 return from JPL Horizons, with the planets on that date.", load: () => loadHalley2061(this.sim, h), origin: { kind: 'sol' } });
      } catch {
        toast("Couldn't load Halley's data.");
      }
    });
    $('btn-visit').addEventListener('click', () => void this.visitSelected());
    $('btn-star-neighbourhood').addEventListener('click', async () => {
      await this.fade(true);
      await this.loadNeighbourhoodScene();
      await this.fade(false);
    });

    // Tools
    $('tool-select').addEventListener('click', () => this.setTool('select'));
    $('tool-spawn').addEventListener('click', () => this.setTool('spawn'));
    $('tool-nudge').addEventListener('click', () => this.setTool('nudge'));

    // Probes
    document.querySelectorAll<HTMLButtonElement>('[data-burn]').forEach((b) =>
      b.addEventListener('click', () => this.burn(b.dataset.burn as 'prograde' | 'retrograde' | 'out' | 'in')),
    );
    $('burn-size').addEventListener('input', () => ($('burn-size-out').textContent = `${(this.burnSize() / KMS).toFixed(2)} km/s`));
    $('transfer-target').addEventListener('change', () => {
      const b = this.selectedBody();
      if (b) this.updateProbePanel(b);
    });
    $('btn-transfer').addEventListener('click', () => {
      const dv = Number($('btn-transfer').dataset.dv);
      if (Number.isFinite(dv)) this.burn(dv >= 0 ? 'prograde' : 'retrograde', Math.abs(dv));
    });

    // Companion server, gallery, multiplayer
    $('btn-server').addEventListener('click', () => {
      const url = $<HTMLInputElement>('server-url').value.trim();
      if (url) void this.connectServer(url);
    });
    $('btn-describe').addEventListener('click', () => void this.describeScene());
    $<HTMLTextAreaElement>('describe-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void this.describeScene();
    });
    $('btn-gallery').addEventListener('click', () => void this.openGallery());
    $('gallery-close').addEventListener('click', () => $('gallery-modal').classList.add('hidden'));
    $('gallery-sort').addEventListener('change', () => void this.openGallery());
    $('gallery-list').addEventListener('click', async (e) => {
      const el = e.target as HTMLElement;
      const load = el.closest<HTMLElement>('[data-load]')?.dataset.load;
      const vote = el.closest<HTMLElement>('[data-vote]');
      try {
        if (load && this.server) {
          this.applyScene(await this.server.getScene(load));
          $('gallery-modal').classList.add('hidden');
        } else if (vote && this.server) {
          vote.textContent = `▲ ${await this.server.vote(vote.dataset.vote!)}`;
        }
      } catch (err) {
        toast((err as Error).message);
      }
    });
    $('btn-publish').addEventListener('click', () => {
      if (!this.requireServer()) return;
      $<HTMLInputElement>('publish-name').value = this.scenario.name;
      $<HTMLInputElement>('publish-author').value = prefs.get('author', '');
      $('publish-modal').classList.remove('hidden');
    });
    $('publish-cancel').addEventListener('click', () => $('publish-modal').classList.add('hidden'));
    $('publish-go').addEventListener('click', () => void this.publishScene());
    $('btn-mp').addEventListener('click', () => (this.requireServer() ? this.openMultiplayer() : undefined));
    $('mp-close').addEventListener('click', () => $('mp-modal').classList.add('hidden'));
    $('mp-join').addEventListener('click', () => void this.joinRoom());
    $('mp-leave').addEventListener('click', () => {
      this.mp.disconnect();
      $('mp-status').textContent = 'Left the room.';
      $('mp-peers').innerHTML = '';
      $('btn-mp').classList.remove('active');
    });
    $('mp-invite').addEventListener('click', async () => {
      const room = $<HTMLInputElement>('mp-room').value.trim();
      const link = `${location.origin}${location.pathname}#room=${encodeURIComponent(room)}${this.server ? `&server=${encodeURIComponent(this.server.base)}` : ''}`;
      try {
        await navigator.clipboard.writeText(link);
        toast('Invite link copied');
      } catch {
        window.prompt('Copy this invite link:', link);
      }
    });
    $<HTMLInputElement>('mp-chat').addEventListener('keydown', (e) => {
      const input = e.target as HTMLInputElement;
      if (e.key === 'Enter' && input.value.trim()) {
        this.mp.chat(input.value.trim());
        input.value = '';
      }
    });

    // Embeds, video, replays
    $('btn-embed').addEventListener('click', () => void this.copyEmbed());
    $('btn-video').addEventListener('click', () => void this.toggleVideo());
    $('btn-record').addEventListener('click', () => this.toggleRecording());
    $('replay-play').addEventListener('click', () => {
      const p = this.player;
      if (!p) return;
      if (!p.playing && p.position >= p.replay.frames.length - 1) p.position = 0;
      p.playing = !p.playing;
    });
    $<HTMLInputElement>('replay-seek').addEventListener('input', (e) => this.player?.seek(Number((e.target as HTMLInputElement).value) / 1000));
    $<HTMLSelectElement>('replay-speed').addEventListener('change', (e) => this.player && (this.player.speed = Number((e.target as HTMLSelectElement).value)));
    $('replay-exit').addEventListener('click', () => this.exitReplay());
    $('replay-save').addEventListener('click', () => {
      if (!this.player) return;
      const blob = new Blob([serializeReplay(this.player.replay)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `astrarium-replay-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
    $('replay-video').addEventListener('click', () => {
      if (!this.player || !VideoRecorder.supported()) return void toast('Video recording is not supported in this browser.');
      this.player.position = 0;
      this.player.playing = true;
      this.video.start(this.canvas);
      toast('Exporting video: it saves automatically when the replay ends.');
    });
    // Console & plugins
    const examples = $<HTMLSelectElement>('console-examples');
    examples.innerHTML = `<option value="">Examples…</option>` + EXAMPLES.map((ex, i) => `<option value="${i}">${escapeHtml(ex.name)}</option>`).join('');
    examples.addEventListener('change', () => {
      const ex = EXAMPLES[Number(examples.value)];
      if (ex) $<HTMLTextAreaElement>('console-code').value = ex.code;
      examples.value = '';
    });
    const toggleConsole = () => {
      $('console-panel').classList.toggle('hidden');
      this.renderPlugins();
      if (!$('console-panel').classList.contains('hidden')) $('console-code').focus();
    };
    $('btn-console').addEventListener('click', toggleConsole);
    $('console-close').addEventListener('click', toggleConsole);
    const runConsole = () => {
      const code = $<HTMLTextAreaElement>('console-code').value;
      if (code.trim()) this.scripts.run(code);
    };
    $('console-run').addEventListener('click', runConsole);
    $<HTMLTextAreaElement>('console-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        runConsole();
      }
      e.stopPropagation(); // keep sandbox shortcuts out of the editor
    });
    $('console-stop').addEventListener('click', () => {
      this.scripts.stop();
      this.host.setSettings({ customForces: [] });
      this.consoleLog('Stopped scripts and removed custom forces.');
    });
    $('console-help').addEventListener('click', () => this.consoleLog(SCRIPT_HELP));
    $('console-save').addEventListener('click', () => {
      const code = $<HTMLTextAreaElement>('console-code').value.trim();
      if (!code) return;
      const name = window.prompt('Plugin name:', 'My plugin');
      if (!name) return;
      prefs.set('plugins', [...this.plugins().filter((p) => p.name !== name), { name, code, autorun: false }]);
      this.renderPlugins();
    });
    $('plugin-list').addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const list = this.plugins();
      const idx = (attr: string) => Number(el.closest<HTMLElement>(`[${attr}]`)?.getAttribute(attr));
      if (el.closest('[data-run]')) this.scripts.run(list[idx('data-run')].code);
      else if (el.closest('[data-edit]')) $<HTMLTextAreaElement>('console-code').value = list[idx('data-edit')].code;
      else if (el.closest('[data-del]')) {
        list.splice(idx('data-del'), 1);
        prefs.set('plugins', list);
        this.renderPlugins();
      } else if (el.closest('[data-autorun]')) {
        list[idx('data-autorun')].autorun = (el as HTMLInputElement).checked;
        prefs.set('plugins', list);
      }
    });

    // Graph & lessons
    const metricSelect = $<HTMLSelectElement>('graph-metric');
    metricSelect.innerHTML = METRICS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
    metricSelect.addEventListener('change', () => {
      this.graphMetric = metricSelect.value as MetricId;
      this.graphRef = undefined;
      this.resetGraph();
    });
    $('btn-graph').addEventListener('click', () => (this.graphOpen ? this.closeGraph() : this.openGraph()));
    $('graph-close').addEventListener('click', () => this.closeGraph());
    $('graph-clear').addEventListener('click', () => {
      this.graphRef = undefined;
      this.resetGraph();
    });
    $('graph-pin').addEventListener('click', () => {
      if (this.graphSeries.length < 2) return void toast('Run the simulation for a moment first');
      this.graphRef = { label: 'Pinned run', color: '#ffb24a', points: this.graphSeries.slice(), dashed: true };
      this.resetGraph();
      toast('Pinned. Change something (or press Reset) and compare the new run.');
    });
    $('btn-learn').addEventListener('click', () => this.openLessonMenu());
    $('lesson-menu-close').addEventListener('click', () => $('lesson-menu').classList.add('hidden'));
    $('lesson-list').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-lesson]')?.dataset.lesson;
      const def = LESSONS.find((l) => l.id === id);
      if (def) this.startLesson(def);
    });
    $('lesson-next').addEventListener('click', () => this.lesson && this.showLessonStep(this.lesson.step + 1));
    $('lesson-back').addEventListener('click', () => this.lesson && this.showLessonStep(this.lesson.step - 1));
    $('lesson-exit').addEventListener('click', () => this.exitLesson());

    // Challenges
    $('btn-challenges').addEventListener('click', () => this.openChallengeMenu());
    $('challenge-menu-close').addEventListener('click', () => $('challenge-menu').classList.add('hidden'));
    $('challenge-list').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-challenge]')?.dataset.challenge;
      const def = id && this.findChallenge(id);
      if (def) this.startChallenge(def);
    });
    $('hud-hint').addEventListener('click', () => this.challenge && toast(this.challenge.def.hint));
    $('hud-restart').addEventListener('click', () => this.challenge && this.startChallenge(this.challenge.def));
    $('hud-quit').addEventListener('click', () => this.quitChallenge());
    $('result-retry').addEventListener('click', () => this.challenge && this.startChallenge(this.challenge.def));
    $('result-menu').addEventListener('click', () => {
      this.quitChallenge();
      this.openChallengeMenu();
    });
    $('result-share').addEventListener('click', async () => {
      const c = this.challenge;
      if (!c?.result) return;
      const text = `${shareText(c.def, c.result)}\n${location.origin}${location.pathname}`;
      try {
        await navigator.clipboard.writeText(text);
        toast('Result copied to clipboard');
      } catch {
        window.prompt('Copy your result:', text);
      }
    });
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
      const gBase = this.sim.units === 'kpc-myr' ? KPC_MYR_GRAVITY_SCALE : 1;
      this.host.setSettings({ gravityScale: Number(grav.value) * gBase });
      $('gravity-out').textContent = Number(grav.value).toFixed(2);
    });
    const bindSetting = (id: string, key: 'collisions' | 'debris' | 'shatter' | 'tidal') =>
      $<HTMLInputElement>(id).addEventListener('change', (e) => this.host.setSettings({ [key]: (e.target as HTMLInputElement).checked }));
    bindSetting('opt-collisions', 'collisions');
    bindSetting('opt-debris', 'debris');
    bindSetting('opt-shatter', 'shatter');
    bindSetting('opt-tidal', 'tidal');
    $<HTMLInputElement>('opt-relativity').addEventListener('change', (e) => this.host.setSettings({ relativity: (e.target as HTMLInputElement).checked }));
    $<HTMLInputElement>('opt-truescale').addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.mutate(on ? 'switching to real sizes' : 'switching to visible sizes', () => setTrueScale(this.sim, on));
      toast(on ? 'Real sizes: planets become tiny dots. Collisions only happen at true contact.' : 'Visible sizes: bodies are enlarged so you can see them.');
    });
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
        title: 'Play, learn, create',
        body: 'The top-right buttons open challenges and a daily puzzle (🏆), interactive lessons (📚), a live graph (📈), multiplayer rooms (👥), the community gallery (🌐) and a scripting console (⌨). Type a scene into “Create with Claude” to have it built for you.',
        target: '#btn-console',
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
  if (b.tag === 'probe') return 'Spacecraft';
  if (b.tag === 'comet') return 'Comet';
  if (b.tag === 'galaxy') return 'Galaxy (all its mass as one point)';
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
  if (getDisplayUnits() === 'kpc-myr') return `${fmt(yearsPerSecond)} Myr/s`;
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

/** Superscript exponent for "3.2 × 10¹¹". */
function sciMass(log10: number): string {
  const e = Math.floor(log10);
  const m = Math.pow(10, log10 - e);
  const sup = String(e).replace(/[0-9-]/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹⁻'['0123456789-'.indexOf(c)]);
  return `${m.toFixed(1)} × 10${sup} M☉`;
}

function cosmosFacts(g: LocalGalaxy): [string, string][] {
  const form = galaxyForm(g);
  const facts: [string, string][] = [['Type', `${form[0].toUpperCase()}${form.slice(1)} galaxy`]];
  if (g.name === 'Milky Way') {
    facts.push(['Distance', 'You are here'], ['Diameter', 'about 100,000 light-years']);
  } else {
    const mly = (g.d * LY_PER_MPC) / 1e6;
    facts.push([g.zd ? 'Distance (from redshift)' : 'Distance', `${mly < 1 ? `${Math.round(mly * 1000).toLocaleString('en-US')} thousand` : fmt(mly)} ${mly < 1 ? '' : 'million '}light-years`.replace('  ', ' ')]);
    if (g.size && !g.zd) facts.push(['Diameter', `${Math.round(g.size * 3261.6).toLocaleString('en-US')} light-years`]);
    if (g.name === 'MESSIER087') facts.push(['Central black hole', '6.5 billion M☉: the first black hole ever imaged (Event Horizon Telescope, 2019)']);
  }
  if (g.mass !== undefined) facts.push(['Mass', sciMass(g.mass)]);
  if (g.hi !== undefined) facts.push(['Hydrogen gas', sciMass(g.hi)]);
  if (g.v !== undefined && g.name !== 'Milky Way') facts.push([g.zd ? 'Recession velocity' : 'Radial velocity', `${Math.abs(g.v)} km/s ${g.v < 0 ? 'toward us' : 'away from us'}`]);
  if (g.md && g.name !== 'Milky Way') facts.push(['Main neighbour', displayName({ name: g.md })]);
  facts.push(['Data', g.zd ? '2MASS Redshift Survey (Huchra et al. 2012)' : 'Karachentsev et al. 2013']);
  return facts;
}
