import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { AudioEngine } from './audio';
import { seedFromString } from './procgen/rng';
import { generateStarSystem } from './procgen/starSystem';
import { GalaxyView, type GalaxyTarget } from './render/galaxyView';
import { CosmosView } from './render/cosmosView';
import { SkyView } from './render/skyView';
import { eclipsePath, greatestEclipse, type Eclipse } from './sim/eclipse';
import { CLUSTER_COLORS, loadClusters } from './sim/clusters';
import { galacticToEcliptic, loadNebulae, NEBULA_COLORS } from './sim/nebulae';
import { loadNebulaImages, tileRect } from './sim/nebulaImages';
import { QUALITY_PRESETS, SystemView } from './render/systemView';
import { createRealSky } from './render/starfield';
import { type Body } from './sim/body';
import { GAS_PALETTE, ROCKY_PALETTE } from './sim/color';
import { type Forecast } from './sim/forecast';
import { SimHost } from './sim/host';
import { galacticCore, hulseTaylor, loadPulsarSystem, loadSolarSystemOnDate, loadStarSystem, PRESETS, pulsarPlanets } from './sim/presets';
import { describePulsar, pulsarName, type PulsarRecord } from './sim/pulsars';
import { hulseTaylorChart } from './ui/hulseTaylorChart';
import { PARTICLE_CULL_DISTANCE, type SimEvent } from './sim/simulation';
import { captureState, restoreState } from './sim/state';
import { type ExoCatalog, type ExoHost } from './sim/exoplanets';
import { loadBrightStars } from './sim/stars';
import { KPC_MYR_GRAVITY_SCALE, setDisplayUnits } from './sim/units';
import { $, escapeHtml, toast } from './ui/dom';
import { GalaxyStore, prefs } from './ui/galaxyStore';
import { History } from './ui/history';
import { decodeScene, downloadJson, encodeScene, type SceneFile } from './ui/share';
import { Tutorial } from './ui/tutorial';
import { PostFX, type LensInfo } from './render/postfx';
import { blackHoleView } from './render/accretionDisk';
import { MegaSim } from './gpu/megaSim';
import { defaultServerUrl, ServerClient } from './net/server';
import { Multiplayer } from './net/multiplayer';
import { ReplayPlayer, ReplayRecorder, VideoRecorder } from './ui/replay';
import { ScriptRunner } from './ui/console';
import type { SimState } from './sim/state';
import { type Challenge, type ChallengeResult, type ChallengeState } from './game/challenges';
import { type Lesson } from './game/lessons';
import { SearchIndex, type SearchEntry } from './ui/search';
import { PhotoMode } from './ui/photo';
import { VrRig } from './render/vr';
import { decodePlace, PlaceStore } from './ui/places';
import { Trip } from './sim/travel';
import { LineChart, type MetricId, type Series } from './ui/graph';
import { ViewName, Tool, QualityName, LOW_POWER, DESKTOP, SPAWN_TYPES, SpawnDrag, Scenario, AUTO_EXIT_DISTANCE, AUTO_ENTER_DISTANCE, GALAXY_EXIT_DISTANCE, sleep, kindLabel, formatFactor, formatEvolution, formatRate, describeSystem } from './app/shared';
import { LandingUI } from './app/landing';
import { PlacesUI } from './app/places';
import { PhotoUI } from './app/photo';
import { VrUI } from './app/vr';
import { MegaSimUI } from './app/megaSim';
import { SkyUI } from './app/sky';
import { OnlineUI } from './app/online';
import { ReplaysUI } from './app/replays';
import { ScriptingUI } from './app/scripting';
import { CosmosUI } from './app/cosmos';
import { GalaxyMapUI } from './app/galaxyMap';
import { ShipUI } from './app/ship';
import { BodyPanelUI } from './app/bodyPanel';
import { NudgeUI } from './app/nudge';
import { GraphUI } from './app/graph';
import { LearningUI } from './app/learning';
import { TravelUI } from './app/travel';
import { SearchUI } from './app/search';
import { RealDataUI } from './app/realData';
import { SpawnUI } from './app/spawn';
import { InputUI } from './app/input';
import { LayoutUI } from './app/layout';
import { TutorialUI } from './app/tutorial';

/**
 * The orchestrator: owns the simulation, the four views and the frame loop, and the state the
 * feature controllers in src/app/ share. Each controller holds one area's behaviour and reaches
 * back here through `this.app`.
 */
export class App {
  readonly landingUI = new LandingUI(this);
  readonly placesUI = new PlacesUI(this);
  readonly photoUI = new PhotoUI(this);
  readonly vrUI = new VrUI(this);
  readonly megaSimUI = new MegaSimUI(this);
  readonly skyUI = new SkyUI(this);
  readonly onlineUI = new OnlineUI(this);
  readonly replaysUI = new ReplaysUI(this);
  readonly scriptingUI = new ScriptingUI(this);
  readonly cosmosUI = new CosmosUI(this);
  readonly galaxyMapUI = new GalaxyMapUI(this);
  readonly shipUI = new ShipUI(this);
  readonly bodyPanelUI = new BodyPanelUI(this);
  readonly nudgeUI = new NudgeUI(this);
  readonly graphUI = new GraphUI(this);
  readonly learningUI = new LearningUI(this);
  readonly travelUI = new TravelUI(this);
  readonly searchUI = new SearchUI(this);
  readonly realDataUI = new RealDataUI(this);
  readonly spawnUI = new SpawnUI(this);
  readonly inputUI = new InputUI(this);
  readonly layoutUI = new LayoutUI(this);
  readonly tutorialUI = new TutorialUI(this);

  readonly canvas = $<HTMLCanvasElement>('scene');

  readonly renderer: THREE.WebGLRenderer;

  readonly labelRenderer = new CSS2DRenderer({ element: $('labels') });

  readonly host: SimHost;

  readonly system: SystemView;

  readonly galaxy: GalaxyView;

  readonly audio = new AudioEngine();

  readonly history = new History();

  readonly store = new GalaxyStore();

  readonly tutorial: Tutorial;

  view: ViewName = 'system';

  readonly cosmos: CosmosView;

  readonly sky: SkyView;

  skyDate = new Date();

  skySpeed = 1;

  skyPicked?: string;

  eclipse?: { e: Eclipse; path: ReturnType<typeof eclipsePath>; greatest: ReturnType<typeof greatestEclipse> };

  earthMap?: HTMLImageElement;

  cosmosLoaded = false;

  /** The real galaxy (catalogue name) the galaxy map currently shows, for returning to the Universe map. */
  galaxyOrigin = 'Milky Way';

  tool: Tool = 'select';

  spawnType = SPAWN_TYPES[1];

  spawnMassFactor = 1;

  autoOrbit = true;

  running = true;

  timeScale = 0.4;

  galaxyBuilt = false;

  galaxySeed = 1;

  scenario: Scenario = { name: PRESETS[0].name, load: () => PRESETS[0].load(this.sim), presetId: PRESETS[0].id };

  spawnDrag?: SpawnDrag;

  pointerDown?: { x: number; y: number; button: number; time: number };

  lastTap?: { x: number; y: number; time: number };

  spawnCounter = 0;

  width = 1;

  height = 1;

  frames = 0;

  fpsTime = 0;

  fps = 0;

  lastMergeToast = 0;

  transitioning = false;

  snapshotTimer = 0;

  forecastTimer = 0;

  forecastResult?: Forecast;

  rewindTimer?: number;

  wasRunningBeforeRewind = false;

  features?: Uint8Array;

  scanToken = 0;

  quality: QualityName = prefs.get<QualityName>('quality', DESKTOP ? (LOW_POWER ? 'medium' : 'high') : LOW_POWER ? 'low' : 'medium');

  catalog?: ExoCatalog;

  challenge?: { def: Challenge; st: ChallengeState; result?: ChallengeResult };

  graphOpen = false;

  graphMetric: MetricId = 'distance';

  graphSeries: [number, number][] = [];

  graphRef?: Series;

  graphStart = 0;

  graphBodyId?: number;

  graphLastTime = NaN;

  graphTimer = 0;

  chart?: LineChart;

  server?: ServerClient;

  readonly mp: Multiplayer;

  mpTimer = 0;

  readonly recorder = new ReplayRecorder();

  player?: ReplayPlayer;

  preReplay?: SimState;

  readonly video = new VideoRecorder();

  readonly scripts: ScriptRunner;

  embed = false;

  postfx!: PostFX;

  postfxOn = prefs.get('postfx', DESKTOP || !LOW_POWER);

  mega?: MegaSim;

  lesson?: { def: Lesson; step: number; events: SimEvent[]; done: Set<number> };

  nudgeDrag?: { bodyId: number; start: THREE.Vector3; current: THREE.Vector3; lastPredict: number; path?: Float32Array };

  /** Typical camera distance of the loaded scene; zooming far beyond it returns to the galaxy. */
  sceneScale = 10;

  exoOpen = false;

  photo!: PhotoMode;

  timeBeforeLanding?: number;

  vrRig?: VrRig;

  vrBase?: XRReferenceSpace;

  readonly places = new PlaceStore();

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
    // Phones: one 3D nebula at a time, with fewer particles.
    if (LOW_POWER) this.galaxy.volumeBudget = { max: 1, steps: 32 };
    this.cosmos = new CosmosView(this.canvas);
    this.sky = new SkyView(this.canvas);
    this.tutorial = new Tutorial(this.tutorialUI.tutorialSteps(), (target) => this.layoutUI.reveal(target));
    this.photo = new PhotoMode({
      renderer: this.renderer,
      current: () => {
        const v = this.view;
        if (v === 'galaxy') return { scene: this.galaxy.scene, camera: this.galaxy.camera, name: 'galaxy' };
        if (v === 'cosmos') return { scene: this.cosmos.scene, camera: this.cosmos.camera, name: 'universe' };
        if (v === 'sky') return { scene: this.sky.scene, camera: this.sky.camera, name: 'sky' };
        return { scene: this.system.scene, camera: this.system.camera, name: this.scenario.name };
      },
      resize: () => this.resize(),
      renderNow: () => this.frame(0),
    });

    const hashSeed = params.get('galaxy');
    this.galaxySeed = hashSeed ? seedFromString(hashSeed) : 1;

    this.mp = new Multiplayer({
      onState: (state) => this.onlineUI.applyRemoteState(state),
      onEdit: (state) => this.onlineUI.applyRemoteState(state),
      onPeers: (peers) => this.onlineUI.renderPeers(peers),
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
        this.onlineUI.shareEdit();
      },
      setRunning: (on) => this.setRunning(on),
      setTimeScale: (v) => this.setTimeScale(v),
      select: (b) => this.selectBody(b),
      follow: (b) => this.system.follow(b?.id),
      setForces: (forces) => this.host.setSettings({ customForces: forces }),
      getForces: () => this.sim.customForces,
      log: (text, kind) => this.scriptingUI.consoleLog(text, kind),
    });
    this.inputUI.bindUi();
    this.layoutUI.bind();
    this.inputUI.bindInput();
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
      void this.onlineUI.connectServer(serverUrl, false).then(() => {
        if (room && this.server) {
          $<HTMLInputElement>('mp-room').value = room;
          this.onlineUI.openMultiplayer();
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
                void this.galaxyMapUI.nebulaAtlas(images, p).then((atlas) => {
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
    this.scriptingUI.runAutorunPlugins();
    const scene = params.get('scene');
    if (scene) {
      decodeScene(scene)
        .then((s) => this.applyScene(s, false))
        .catch((err) => toast(`Couldn't open shared scene: ${(err as Error).message}`));
    }
    const placeCode = params.get('place');
    if (placeCode) {
      const place = decodePlace(placeCode);
      if (place) setTimeout(() => void this.placesUI.goToPlace(place), 600);
      else toast("Couldn't read the shared place.");
    }
    if (!prefs.get('tutorialDone', false) && params.get('tour') !== '0' && !this.embed && !placeCode) setTimeout(() => this.tutorialUI.openTutorial(), 1200);

    // setAnimationLoop (rather than requestAnimationFrame) also drives WebXR sessions.
    let last = performance.now();
    this.renderer.setAnimationLoop((now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (this.mega) return; // the GPU mega-sim owns the screen
      if (this.renderer.xr.isPresenting) this.vrUI.tickVR(dt);
      this.frame(dt);
    });
    void this.vrUI.detectVR();
  }

  get sim() {
    return this.host.sim;
  }

  // ---------------------------------------------------------------------------
  // Frame loop

  frame(dt: number): void {
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
      if (this.frames % 4 === 0) this.replaysUI.updateReplayBar();
      return;
    }
    if (this.view === 'system') {
      const active = this.running && this.rewindTimer === undefined;
      if (active) this.scripts.frame(dt);
      if (this.recorder.recording && !this.recorder.tick(this.sim, dt)) {
        toast('Replay memory limit reached; recording stopped.');
        this.replaysUI.stopRecording();
      }
      if (this.mp.connected && this.mp.host && this.mp.peers.length > 1) {
        this.mpTimer -= dt;
        if (this.mpTimer <= 0) {
          this.mpTimer = 0.25;
          this.mp.sendState(this.onlineUI.syncState());
        }
      }
      const events = this.host.advance(active ? this.timeScale * this.fastForward * dt : 0, 12);
      this.handleEvents(events);
      if (this.spawnDrag) this.spawnUI.updateSpawnPreview(performance.now());
      if (this.nudgeDrag) this.nudgeUI.updateNudgePreview(performance.now());
      if (this.lesson) this.lesson.events.push(...events);
      if (this.graphOpen) this.graphUI.sampleGraph(dt);
      if (this.lesson && this.frames % 10 === 0) this.learningUI.checkLesson();
      if (this.frames % 10 === 0 && this.system.lander.active) this.landingUI.updateLandHud();
      if (this.challenge && !this.challenge.result) {
        this.challenge.st.events.push(...events);
        if (this.frames % 3 === 0) this.learningUI.evaluateChallenge();
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
        this.bodyPanelUI.updateForecast();
      }
      if (this.frames % 6 === 0) this.bodyPanelUI.updateSystemHud();
      if (this.shipThrustDir) this.shipUI.tickShip();
      if (this.frames % 6 === 0 && this.system.selectedId !== undefined) this.shipUI.updateShipPanel();
      if (!this.transitioning && this.system.cameraDistance > this.exitDistance) void this.exitToGalaxy();
    } else if (this.view === 'sky') {
      this.skyUI.tickSky(dt);
    } else if (this.view === 'cosmos') {
      this.travelUI.tickTrip(dt);
      this.cosmos.update(dt);
      this.renderView(this.cosmos.scene, this.cosmos.camera, []);
      if (this.frames % 15 === 0) $('stats').textContent = `${Math.round(this.fps)} fps`;
      const sel = this.cosmos.selected;
      if (
        !this.transitioning &&
        !this.trip &&
        sel !== -1 &&
        !this.cosmos.animating &&
        this.cosmos.cameraDistance < this.cosmos.viewDistance(sel) * 0.12 &&
        this.cosmos.controls.target.distanceTo(this.cosmos.position(sel)) < this.cosmos.viewDistance(sel) * 0.5
      ) {
        void this.cosmosUI.visitCosmosGalaxy(sel);
      }
    } else {
      this.travelUI.tickTrip(dt);
      this.galaxy.update(dt);
      this.renderView(this.galaxy.scene, this.galaxy.camera, []);
      if (!this.transitioning && !this.trip && !this.galaxy.animating && this.galaxy.cameraDistance > GALAXY_EXIT_DISTANCE) void this.cosmosUI.openCosmos(true);
      if (this.frames % 15 === 0) $('stats').textContent = `${Math.round(this.fps)} fps`;
      const sel = this.galaxy.selected;
      if (
        !this.transitioning &&
        !this.trip &&
        sel !== -1 &&
        !this.galaxy.animating &&
        this.galaxy.cameraDistance < AUTO_ENTER_DISTANCE &&
        this.galaxy.controls.target.distanceTo(this.galaxy.targetPosition(sel)) < 1
      ) {
        void this.enterTarget(sel);
      }
    }
  }

  handleEvents(events: SimEvent[]): void {
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
        if (e.type === 'ship') {
          // The worker switched an engine or autopilot off: do the same in this copy.
          for (const b of this.sim.bodies) {
            if (b.tag !== 'ship' || !e.message.startsWith(b.name)) continue;
            this.sim.setAutopilot(b.id, undefined);
            // Arrived: slow down to watch the new orbit go round.
            const parent = /in orbit around/.test(e.message) ? this.sim.parentOf(b) : undefined;
            if (parent) {
              const r = Math.hypot(b.x - parent.x, b.y - parent.y, b.z - parent.z);
              this.setTimeScale(Math.min(this.timeScale, (2 * Math.PI * Math.sqrt(r ** 3 / (this.sim.effectiveG * parent.mass))) / 20));
              if (this.shipUI.selectedShip() === b) this.system.follow(b.id, r * 4);
            }
            if (/out of fuel/.test(e.message)) {
              this.sim.setThrust(b.id, undefined);
              if (this.shipUI.selectedShip() === b) this.shipUI.stopShipThrust();
            }
          }
        }
        toast(e.message, e.type === 'collapse' || e.type === 'supernova' ? 'collapse' : e.type === 'ignite' ? 'ignite' : '', e.title);
      }
    }
  }

  enterEmbedMode(): void {
    document.body.classList.add('embed');
    const link = $<HTMLAnchorElement>('embed-open');
    const params = new URLSearchParams(location.hash.slice(1));
    params.delete('embed');
    link.href = `${location.origin}${location.pathname}#${params.toString()}`;
    link.classList.remove('hidden');
  }

  async copyEmbed(): Promise<void> {
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

  renderView(scene: THREE.Scene, camera: THREE.Camera, lenses: LensInfo[]): void {
    if (camera instanceof THREE.PerspectiveCamera) this.photo.beforeRender(scene, camera);
    // Post-processing isn't supported inside WebXR sessions; low quality skips it too.
    // The galaxy map is already a sea of additive glow; bloom there only adds haze.
    const fx = this.postfxOn && this.quality !== 'low' && !this.renderer.xr.isPresenting && this.view === 'system';
    // With lensing on, black holes show their spin-shaped shadow and the sphere is only the horizon.
    blackHoleView.lensed = fx;
    if (fx) {
      this.postfx.setLenses(lenses);
      this.postfx.setBloom(this.quality === 'high' ? 0.55 : 0.4);
      this.postfx.render(scene, camera);
    } else {
      this.renderer.render(scene, camera);
    }
  }

  resize(): void {
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

  applyQuality(q: QualityName): void {
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

  setView(view: ViewName): void {
    if (view === 'galaxy' && !this.galaxyBuilt) this.galaxyMapUI.buildGalaxy(this.galaxySeed);
    this.view = view;
    this.system.controls.enabled = view === 'system';
    this.galaxy.controls.enabled = view === 'galaxy';
    this.cosmos.controls.enabled = view === 'cosmos';
    this.sky.enabled = view === 'sky';
    if (view !== 'system') this.spawnUI.cancelSpawn();
    $('tab-cosmos').classList.toggle('active', view === 'cosmos');
    $('tab-galaxy').classList.toggle('active', view === 'galaxy');
    $('tab-system').classList.toggle('active', view === 'system');
    $('tab-sky').classList.toggle('active', view === 'sky');
    $('labels').classList.toggle('hidden', view !== 'system');
    $('travel-bar').classList.toggle('hidden', view !== 'galaxy' && view !== 'cosmos');
    if (view !== 'system') {
      $('ship-panel').classList.add('hidden');
      document.body.classList.remove('ship-flying');
      this.shipUI.stopShipThrust();
    }
    if (this.trip && this.trip.view !== view) this.travelUI.stopTrip();
    document.querySelectorAll<HTMLElement>('[data-view]').forEach((el) => {
      const match = el.dataset.view === view;
      if (el.id === 'star-panel') el.classList.toggle('hidden', !match || this.galaxy.selected === -1);
      else if (el.id === 'cosmos-galaxy-panel') el.classList.toggle('hidden', !match || this.cosmos.selected === -1);
      else if (el.id === 'exo-panel') el.classList.toggle('hidden', !match || !this.exoOpen);
      else if (el.id === 'graph-panel') el.classList.toggle('hidden', !match || !this.graphOpen);
      else if (el.id === 'body-panel') el.classList.toggle('hidden', !match || this.system.selectedId === undefined);
      else el.classList.toggle('hidden', !match);
    });
    this.layoutUI.onView(view);
    this.updateHint();
  }

  async fade(on: boolean): Promise<void> {
    $('fade').classList.toggle('on', on);
    await sleep(420);
  }

  /** Warp from the galaxy map into a star system (or the galactic core). */
  async enterTarget(target: GalaxyTarget): Promise<void> {
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
      } else if (typeof target === 'object' && 'psr' in target) {
        const record = this.pulsarMapList[target.psr];
        // Two have their own scenes: the pulsar planets and the Hulse–Taylor binary.
        const own = record.bname === 'B1257+12' ? pulsarPlanets : record.bname === 'B1913+16' ? hulseTaylor : undefined;
        scenario = own
          ? { name: own.name, load: () => own.load(this.sim), presetId: own.id, origin: { kind: 'pulsar', index: target.psr, record } }
          : { name: pulsarName(record), description: describePulsar(record), load: () => loadPulsarSystem(this.sim, record), origin: { kind: 'pulsar', index: target.psr, record } };
      } else if (typeof target === 'object') {
        scenario = this.realDataUI.exoScenario(this.exoMapHosts[target.exo]);
      } else {
        const spec = generateStarSystem(this.galaxy.data.stars.seeds[target]);
        scenario = { name: spec.star.name, load: () => loadStarSystem(this.sim, spec), origin: { kind: 'star', index: target, spec } };
        this.store.markVisited(target);
        this.galaxyMapUI.refreshMarkers();
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
  async exitToGalaxy(): Promise<void> {
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
        origin?.kind === 'core'
          ? 'core'
          : origin?.kind === 'star'
            ? origin.index
            : origin?.kind === 'pulsar'
              ? { psr: origin.index }
              : exoIndex >= 0
                ? { exo: exoIndex }
                : origin
                  ? 'sol'
                  : undefined;
      if (target !== undefined) {
        this.galaxyMapUI.selectTarget(target);
        this.galaxy.arriveFrom(target, 0.3, 12);
      }
      await sleep(60);
      await this.fade(false);
    } finally {
      this.transitioning = false;
    }
  }

  /** Fade to another view without any camera transition. */
  async switchView(view: ViewName): Promise<void> {
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

  async switchToSandbox(): Promise<void> {
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

  get exitDistance(): number {
    return Math.max(AUTO_EXIT_DISTANCE, this.sceneScale * 12);
  }

  resetPhysicsDefaults(): void {
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

  loadScenario(sc: Scenario, opts: { zoomFrom?: number; undoable?: boolean; challenge?: boolean; lesson?: boolean } = {}): void {
    const { zoomFrom = 1, undoable = true } = opts;
    if (this.system.lander.active) this.landingUI.takeOff();
    if (!opts.challenge && this.challenge) this.learningUI.quitChallenge();
    if (!opts.lesson && this.lesson) this.learningUI.exitLesson();
    // A pinned comparison run survives Reset of the same scenario, not a switch to another one.
    if (sc.name !== this.scenario.name) this.graphRef = undefined;
    this.graphUI.resetGraph();
    if (undoable && this.sim.bodies.length) this.history.push(captureState(this.sim), `loading ${sc.name}`);
    this.spawnUI.cancelSpawn();
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
    $('preset-extra').innerHTML = sc.presetId === 'hulse-taylor' ? hulseTaylorChart() : '';
    $('origin').classList.toggle('hidden', !sc.origin);
    if (sc.origin?.kind === 'star') {
      $('origin-name').textContent = sc.origin.spec.star.name;
      $('preset-desc').textContent = describeSystem(sc.origin.spec);
    } else if (sc.origin?.kind === 'core') {
      $('origin-name').textContent = 'the galactic core';
    } else if (sc.origin) {
      $('origin-name').textContent =
        sc.origin.kind === 'exo' ? sc.origin.host.name : sc.origin.kind === 'pulsar' ? pulsarName(sc.origin.record) : sc.origin.kind === 'sol' ? 'home' : 'the solar neighbourhood';
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
    this.onlineUI.shareEdit();
  }

  /** Real exoplanet hosts on the Milky Way map, placed by their galactic coordinates. */
  exoMapHosts: ExoHost[] = [];
  /** Real pulsars on the Galaxy Map (ATNF catalogue), in the order of GalaxyView.pulsarPositions. */
  pulsarMapList: PulsarRecord[] = [];

  readonly atlasPromises = new Map<number, Promise<THREE.Texture>>();

  setTimeScale(yearsPerSecond: number): void {
    yearsPerSecond = Math.min(yearsPerSecond, this.maxTimeScale);
    this.timeScale = yearsPerSecond;
    $<HTMLInputElement>('time-scale').value = String(Math.log10(yearsPerSecond));
    $('time-scale-out').textContent = formatRate(yearsPerSecond);
  }

  /** Scenes can raise the speed limit (moving stars need thousands of years per second). */
  maxTimeScale = 100;

  setMaxTimeScale(max: number): void {
    this.maxTimeScale = max;
    $<HTMLInputElement>('time-scale').max = String(Math.log10(max));
  }

  setRunning(running: boolean): void {
    this.running = running;
    $('btn-play').textContent = running ? '⏸' : '▶';
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.spawnUI.cancelSpawn();
    $('tool-select').classList.toggle('active', tool === 'select');
    $('tool-spawn').classList.toggle('active', tool === 'spawn');
    $('tool-nudge').classList.toggle('active', tool === 'nudge');
    this.nudgeUI.cancelNudge();
    $('spawn-options').classList.toggle('hidden', tool !== 'spawn');
    // The spawn palette lives in the Create pane: show it.
    if (tool === 'spawn') this.layoutUI.openPane('create');
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

  updateHint(): void {
    let text: string;
    if (this.view === 'sky') text = 'Drag to look around · Scroll to zoom · Click a name to turn to it · Click the Moon or a planet for details';
    else if (this.view === 'cosmos') text = 'Click a name to fly there · Click a galaxy to inspect · Double-click to fly there · Zoom right in (or Enter) to visit · Scroll out for the cosmic web';
    else if (this.view === 'galaxy') text = 'Click a name to fly there · Click a star to inspect · Double-click to fly there · Zoom right in (or Enter) to visit · Zoom far out for other galaxies';
    else if (this.tool === 'spawn') text = 'Click to place · Drag to set velocity · Right-drag to orbit camera · Esc to cancel';
    else if (this.tool === 'nudge') text = 'Press on a body and drag to push it · Dashed line previews the new path · Right-drag to orbit camera';
    else text = 'Click to select · Click a name or double-click to follow · Space pause · Hold R rewind · Hold . fast-forward · Ctrl+Z undo · B spawn · M galaxy map';
    $('hint').textContent = text;
  }

  syncSettingsUi(): void {
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
  mutate(label: string, fn: () => void): void {
    this.history.push(captureState(this.sim), label);
    fn();
    this.host.commit();
    this.updateUndoButtons();
    this.onlineUI.shareEdit();
  }

  restore(state: ReturnType<typeof captureState>): void {
    // The rewind buffer belongs to the timeline we're leaving.
    this.history.clearTimeline();
    restoreState(this.sim, state);
    this.host.commit();
    this.system.clearTrails();
    if (this.system.selectedId !== undefined && !this.sim.getBody(this.system.selectedId)) this.hideBodyPanel();
    this.syncSettingsUi();
  }

  undo(): void {
    if (this.learningUI.blockedInChallenge('Undo')) return;
    const entry = this.history.undo(captureState(this.sim));
    if (!entry) return;
    this.restore(entry.state);
    toast(`Undid ${entry.label}`);
    this.updateUndoButtons();
  }

  redo(): void {
    if (this.learningUI.blockedInChallenge('Redo')) return;
    const entry = this.history.redo(captureState(this.sim));
    if (!entry) return;
    this.restore(entry.state);
    toast(`Redid ${entry.label}`);
    this.updateUndoButtons();
  }

  updateUndoButtons(): void {
    $<HTMLButtonElement>('btn-undo').disabled = !this.history.canUndo;
    $<HTMLButtonElement>('btn-redo').disabled = !this.history.canRedo;
  }

  startRewind(): void {
    if (this.rewindTimer !== undefined || this.view !== 'system' || this.learningUI.blockedInChallenge('Rewind')) return;
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

  /** Holding ⏩ (or the . key) runs time 10× faster; a tap doubles the speed instead. */
  fastForward = 1;

  forwardHold?: { timer: number; wasRunning: boolean; holding: boolean };

  forwardDown(): void {
    if (this.forwardHold || this.view !== 'system') return;
    const hold = { timer: 0, wasRunning: this.running, holding: false };
    hold.timer = window.setTimeout(() => {
      hold.holding = true;
      this.fastForward = 10;
      this.setRunning(true);
      $('btn-forward').classList.add('active');
      $('btn-forward').textContent = '×10';
    }, 220);
    this.forwardHold = hold;
  }

  forwardUp(): void {
    const hold = this.forwardHold;
    if (!hold) return;
    this.forwardHold = undefined;
    clearTimeout(hold.timer);
    if (hold.holding) {
      this.fastForward = 1;
      this.setRunning(hold.wasRunning);
      $('btn-forward').classList.remove('active');
      $('btn-forward').textContent = '⏩';
    } else {
      // A tap: twice as fast (up to the scene's limit), and make sure time is running.
      const before = this.timeScale;
      this.setTimeScale(this.timeScale * 2);
      this.setRunning(true);
      toast(this.timeScale > before ? `Time: ${formatRate(this.timeScale)}` : `Already at this scene's top speed (${formatRate(this.timeScale)})`);
    }
  }

  stopRewind(): void {
    if (this.rewindTimer === undefined) return;
    clearInterval(this.rewindTimer);
    this.rewindTimer = undefined;
    $('btn-rewind').classList.remove('active');
    this.setRunning(this.wasRunningBeforeRewind);
  }

  makeSceneFile(includeParticles: boolean): SceneFile {
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

  applyScene(scene: SceneFile, undoable = true): void {
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

  saveFile(): void {
    const scene = this.makeSceneFile(true);
    const slug = (scene.name ?? 'scene').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadJson(`astrarium-${slug}.json`, scene);
    toast('Scene saved');
  }

  async shareLink(): Promise<void> {
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

  selectBody(body: Body | undefined): void {
    this.system.selectedId = body?.id;
    this.forecastResult = undefined;
    this.system.showApproach(undefined);
    if (!body) {
      this.hideBodyPanel();
      return;
    }
    this.realDataUI.closeExoBrowser();
    $('body-panel').classList.remove('hidden');
    this.forecastTimer = 0;
    this.bodyPanelUI.updateBodyPanel();
  }

  hideBodyPanel(): void {
    this.system.selectedId = undefined;
    this.system.showApproach(undefined);
    $('body-panel').classList.add('hidden');
    this.shipUI.stopShipThrust();
    $('ship-panel').classList.add('hidden');
    document.body.classList.remove('ship-flying');
  }

  // --- Spaceship ---------------------------------------------------------------------------------

  shipThrustDir?: string;

  selectedBody(): Body | undefined {
    return this.system.selectedId !== undefined ? this.sim.getBody(this.system.selectedId) : undefined;
  }

  /** Like mutate(), but challenges don't record undo history. */
  mutateGame(label: string, fn: () => void): void {
    if (this.challenge) {
      fn();
      this.host.commit();
      this.onlineUI.shareEdit();
    } else {
      this.mutate(label, fn);
    }
  }

  // ---------------------------------------------------------------------------
  // Real data: exoplanets, the solar neighbourhood, dated Solar System

  // --- Travel at any speed ---------------------------------------------------------------------

  /** A trip in progress on the Galaxy Map or in the Universe tab (src/sim/travel.ts). */
  trip?: { trip: Trip; view: 'galaxy' | 'cosmos'; dir: THREE.Vector3; dest?: THREE.Vector3; stop: number; name: string; hudTimer: number };

  // --- Search everything ---------------------------------------------------------------------

  searchIndex?: Promise<SearchIndex>;

  searchResults: SearchEntry[] = [];

  searchActive = 0;

  deleteSelected(): void {
    const id = this.system.selectedId;
    if (id === undefined) return;
    const name = this.sim.getBody(id)?.name ?? 'body';
    if (this.system.followId === id) this.system.follow(undefined);
    this.mutate(`deleting ${name}`, () => this.sim.removeBody(id));
    this.hideBodyPanel();
  }

  scaleSelectedMass(factor: number): void {
    const body = this.selectedBody();
    if (!body) return;
    const before = body.kind;
    this.mutate(`changing ${body.name}'s mass`, () => {
      this.sim.setBodyMass(body, body.mass * factor);
      if (body.kind !== before && body.kind === 'gas') body.color = GAS_PALETTE[0];
      else if (body.kind !== before && body.kind === 'rocky') body.color = ROCKY_PALETTE[0];
    });
    if (body.kind !== before && (body.kind === 'rocky' || body.kind === 'gas')) toast(`${body.name} is now a ${kindLabel(body).toLowerCase()}`);
    this.bodyPanelUI.updateBodyPanel();
  }

  detonateSelected(): void {
    const body = this.selectedBody();
    if (!body || !this.sim.canSupernova(body)) return;
    this.mutate(`${body.name}'s supernova`, () => this.sim.supernova(body));
  }

  toggleFollow(): void {
    const id = this.system.selectedId;
    if (id === undefined) return;
    this.system.follow(this.system.followId === id ? undefined : id);
  }

  armSoundOnGesture(): void {
    const enable = () => {
      this.setSound(true);
      window.removeEventListener('pointerdown', enable);
      window.removeEventListener('keydown', enable);
    };
    window.addEventListener('pointerdown', enable);
    window.addEventListener('keydown', enable);
  }

  setSound(on: boolean): void {
    this.audio.setEnabled(on);
    prefs.set('sound', on);
    $('btn-sound').textContent = on ? '🔊' : '🔇';
  }

  lastHover = 0;
}
