import * as THREE from 'three';
import { playSamples } from '../audio';
import { pulsarSamples, soundsLike } from '../sim/pulsarSound';
import { pulsarParams } from '../sim/neutronStar';
import { pulsarName } from '../sim/pulsars';
import { seedFromString } from '../procgen/rng';
import { setTrueScale } from '../sim/trueScale';
import { loadGwEvent, loadGwEvents } from '../sim/gwEvents';
import { loadFlyby, loadFlybys } from '../sim/flybys';
import { loadVoyagerEncounter, loadVoyagerEncounters } from '../sim/voyager';
import { synthesizeChirp } from '../sim/gwChirp';
import { loadHalley2061, loadHalleyReturn } from '../sim/halley';
import { getSolarData, loadSolarData } from '../sim/solarSystemData';
import { loadSolarSystemOnDate, PRESETS } from '../sim/presets';
import { ENGINES, KMS_TO_AU_YR } from '../sim/spaceship';
import { fmt, KPC_MYR_GRAVITY_SCALE } from '../sim/units';
import { $, escapeHtml, isTyping, toast } from '../ui/dom';
import { prefs } from '../ui/galaxyStore';
import { readSceneFile } from '../ui/share';
import { parseReplay, ReplayPlayer, serializeReplay, VideoRecorder } from '../ui/replay';
import { EXAMPLES, SCRIPT_HELP } from '../ui/console';
import { KMS, shareText } from '../game/challenges';
import { LESSONS } from '../game/lessons';
import { autoWarp, SPEEDS } from '../sim/travel';
import { METRICS, type MetricId } from '../ui/graph';
import { QualityName, SPAWN_TYPES, formatFactor, formatEvolution } from './shared';
import type { App } from '../app';

/** Wiring the page: canvas clicks, keyboard shortcuts and every button and control. */
export class InputUI {
  constructor(private readonly app: App) {}

  ndc(e: { clientX: number; clientY: number }): [number, number] {
    const rect = this.app.canvas.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1];
  }

  handleClick(e: { clientX: number; clientY: number }): void {
    const [x, y] = this.ndc(e);
    if (this.app.view === 'system' && this.app.tool === 'select') {
      // A click on a name label goes there: select the body and follow it.
      const labelled = this.app.system.pickLabel(e.clientX, e.clientY);
      if (labelled && 'lagrange' in labelled) {
        // A Lagrange point: glide to it and keep it centred as it moves.
        this.app.system.followLagrange(labelled.lagrange);
        toast(`Following ${labelled.name}`);
        return;
      }
      const body = labelled && 'body' in labelled ? this.app.sim.getBody(labelled.body) : undefined;
      if (body) {
        this.app.selectBody(body);
        this.app.system.follow(body.id);
        return;
      }
      this.app.selectBody(this.app.system.pick(x, y, this.app.width, this.app.height));
    } else if (this.app.view === 'galaxy') {
      const label = this.app.galaxy.pickLabel(x, y);
      if (label) {
        if (label.target !== undefined) this.app.galaxyMapUI.selectTarget(label.target);
        this.app.travelUI.goGalaxyPoint(label.pos, label.distance, label.name);
        return;
      }
      this.app.galaxyMapUI.selectTarget(this.app.galaxy.pick(x, y, this.app.width, this.app.height));
    } else if (this.app.view === 'cosmos') {
      const label = this.app.cosmos.pickLabel(x, y);
      if (label) {
        if (label.index !== undefined) {
          this.app.cosmosUI.selectCosmos(label.index);
          this.app.travelUI.goCosmosGalaxy(label.index);
        } else {
          this.app.travelUI.goCosmosPoint(label.pos, label.distance, label.name);
        }
        return;
      }
      this.app.cosmosUI.selectCosmos(this.app.cosmos.pick(x, y, this.app.width, this.app.height));
    } else if (this.app.view === 'sky') {
      const label = this.app.sky.pickLabel(x, y);
      if (label) this.app.sky.goToLabel(label);
      this.app.skyPicked = label?.userData.body ?? this.app.sky.pick(x, y);
      this.app.skyUI.renderSkyList();
    }
  }

  handleDoubleClick(e: { clientX: number; clientY: number }): void {
    const [x, y] = this.ndc(e);
    if (this.app.view === 'cosmos') {
      const index = this.app.cosmos.pick(x, y, this.app.width, this.app.height);
      if (index !== -1) {
        this.app.cosmosUI.selectCosmos(index);
        this.app.travelUI.goCosmosGalaxy(index);
      }
      return;
    }
    if (this.app.view === 'galaxy') {
      const target = this.app.galaxy.pick(x, y, this.app.width, this.app.height);
      if (target !== -1) {
        this.app.galaxyMapUI.selectTarget(target);
        this.app.travelUI.goGalaxyTarget(target);
      }
    } else if (this.app.tool === 'select') {
      const body = this.app.system.pick(x, y, this.app.width, this.app.height);
      if (body) {
        this.app.selectBody(body);
        this.app.system.follow(body.id);
      }
    }
  }

  bindInput(): void {
    const c = this.app.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      this.app.pointerDown = { x: e.clientX, y: e.clientY, button: e.button, time: performance.now() };
      if (this.app.view === 'system' && this.app.tool === 'nudge' && e.button === 0 && e.isPrimary) {
        const [x, y] = this.ndc(e);
        const body = this.app.system.pick(x, y, this.app.width, this.app.height);
        if (body && !this.app.nudgeUI.canNudge(body)) {
          toast(`${body.name} can't be pushed in this challenge`);
        } else if (body && this.app.challenge && body.tag !== 'probe' && this.app.challenge.st.pushes >= (this.app.challenge.def.rules.pushes ?? 0)) {
          toast('No pushes left');
        } else if (body) {
          const start = new THREE.Vector3(body.x, body.y, body.z);
          const point = this.app.system.planePoint(x, y, body.y) ?? start.clone();
          this.app.nudgeDrag = { bodyId: body.id, start, current: point, lastPredict: 0 };
          this.app.selectBody(body);
          c.setPointerCapture(e.pointerId);
        }
      }
      if (this.app.view === 'system' && this.app.tool === 'spawn' && e.button === 0 && e.isPrimary) {
        const followed = this.app.system.followId !== undefined ? this.app.sim.getBody(this.app.system.followId) : undefined;
        const planeY = followed?.y ?? 0;
        const [x, y] = this.ndc(e);
        const point = this.app.system.planePoint(x, y, planeY);
        if (point) {
          this.app.spawnDrag = { start: point, current: point.clone(), planeY, lastPredict: 0 };
          c.setPointerCapture(e.pointerId);
        }
      }
    });

    c.addEventListener('pointermove', (e) => {
      // A pointing hand over name labels, which can be clicked to go there (checked ~10 times a second).
      if (e.pointerType === 'mouse' && e.buttons === 0 && performance.now() - this.app.lastHover > 100) {
        this.app.lastHover = performance.now();
        const [x, y] = this.ndc(e);
        const onLabel =
          this.app.view === 'galaxy' ? !!this.app.galaxy.pickLabel(x, y)
          : this.app.view === 'sky' ? !!this.app.sky.pickLabel(x, y)
          : this.app.view === 'cosmos' ? !!this.app.cosmos.pickLabel(x, y)
          : this.app.view === 'system' && this.app.tool === 'select' ? this.app.system.pickLabel(e.clientX, e.clientY) !== undefined
          : false;
        c.style.cursor = onLabel ? 'pointer' : '';
      }
      if (this.app.nudgeDrag && e.isPrimary) {
        const [x, y] = this.ndc(e);
        const p = this.app.system.planePoint(x, y, this.app.nudgeDrag.start.y);
        if (p) this.app.nudgeDrag.current.copy(p);
        return;
      }
      if (!this.app.spawnDrag || !e.isPrimary) return;
      const [x, y] = this.ndc(e);
      const point = this.app.system.planePoint(x, y, this.app.spawnDrag.planeY);
      if (point) this.app.spawnDrag.current.copy(point);
    });

    c.addEventListener('pointerup', (e) => {
      const down = this.app.pointerDown;
      this.app.pointerDown = undefined;
      if (this.app.spawnDrag) {
        this.app.spawnUI.commitSpawn();
        return;
      }
      if (this.app.nudgeDrag) {
        this.app.nudgeUI.commitNudge();
        return;
      }
      if (!down || down.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved > 6) return;
      this.handleClick(e);
      // Touch has no reliable dblclick: detect double taps ourselves.
      if (e.pointerType === 'touch') {
        const now = performance.now();
        const t = this.app.lastTap;
        if (t && now - t.time < 320 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 24) {
          this.handleDoubleClick(e);
          this.app.lastTap = undefined;
        } else {
          this.app.lastTap = { x: e.clientX, y: e.clientY, time: now };
        }
      }
    });

    c.addEventListener('dblclick', (e) => this.handleDoubleClick(e));

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.app.searchUI.openSearch();
        return;
      }
      if (isTyping(e) || this.app.tutorial.isOpen) return;
      // Walking on a planet's surface.
      if (this.app.view === 'system' && this.app.system.lander.active && !e.ctrlKey && !e.metaKey) {
        if (this.app.system.lander.key(e.code, true)) {
          e.preventDefault();
          return;
        }
        if (e.key === 'Escape') {
          this.app.landingUI.takeOff();
          return;
        }
      }
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === '/') {
        e.preventDefault();
        this.app.searchUI.openSearch();
        return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.app.redo();
        else this.app.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        this.app.redo();
        return;
      }
      if (mod) return;
      if (key === 'p') {
        this.app.photoUI.togglePhoto();
        return;
      }
      if (key === 'l') {
        if ($('places-overlay').classList.contains('hidden')) this.app.placesUI.openPlaces();
        else this.app.placesUI.closePlaces();
        return;
      }
      if (key === 'escape' && !$('places-overlay').classList.contains('hidden')) {
        this.app.placesUI.closePlaces();
        return;
      }
      if (this.app.photo.active && key === 'escape') {
        this.app.photoUI.togglePhoto();
        return;
      }
      if (key === 'm') {
        if (this.app.view !== 'system') void this.app.switchToSandbox();
        else void this.app.exitToGalaxy();
      }
      if (key === '?') this.app.tutorialUI.openTutorial();
      if (key === '`') {
        e.preventDefault();
        $('btn-console').click();
        return;
      }
      if (this.app.view === 'cosmos') {
        if (key === 'enter' && this.app.cosmos.selected !== -1) void this.app.cosmosUI.visitCosmosGalaxy(this.app.cosmos.selected);
        if (key === 'escape') this.app.cosmosUI.selectCosmos(-1);
        return;
      }
      if (this.app.view === 'galaxy') {
        if (key === 'enter' && this.app.galaxy.selected !== -1) void this.app.enterTarget(this.app.galaxy.selected);
        if (key === 'escape') this.app.galaxyMapUI.selectTarget(-1);
        if (key === 'b') this.app.galaxyMapUI.toggleBookmark();
        return;
      }
      switch (key) {
        case ' ':
          e.preventDefault();
          this.app.setRunning(!this.app.running);
          break;
        case 'r':
          if (!e.repeat) this.app.startRewind();
          break;
        case '.':
          if (!e.repeat) this.app.forwardDown();
          break;
        case 'w':
        case 's':
        case 'a':
        case 'd':
        case 'q':
        case 'e':
          if (!e.repeat && this.app.shipUI.selectedShip()) this.app.shipUI.startShipThrust({ w: 'prograde', s: 'retrograde', a: 'out', d: 'in', q: 'normal', e: 'anti' }[key]!);
          break;
        case 'v':
          this.app.setTool('select');
          break;
        case 'b':
          this.app.setTool('spawn');
          break;
        case 'n':
          this.app.setTool('nudge');
          break;
        case 'g':
          if (this.app.graphOpen) this.app.graphUI.closeGraph();
          else this.app.graphUI.openGraph();
          break;
        case 'f':
          this.app.toggleFollow();
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
          this.app.deleteSelected();
          break;
        case '[':
          this.app.setTimeScale(Math.pow(10, Math.max(-3, Math.log10(this.app.timeScale) - 0.1)));
          break;
        case ']':
          this.app.setTimeScale(Math.pow(10, Math.log10(this.app.timeScale) + 0.1));
          break;
        case 'escape':
          if (this.app.spawnDrag) this.app.spawnUI.cancelSpawn();
          else if (this.app.nudgeDrag) this.app.nudgeUI.cancelNudge();
          else if (this.app.system.followId !== undefined) this.app.system.follow(undefined);
          else this.app.selectBody(undefined);
          break;
      }
    });
    window.addEventListener('keyup', (e) => {
      this.app.system.lander.key(e.code, false);
      if (e.key.toLowerCase() === 'r') this.app.stopRewind();
      if (e.key === '.') this.app.forwardUp();
      if (this.app.shipThrustDir && 'wsadqe'.includes(e.key.toLowerCase())) this.app.shipUI.stopShipThrust();
    });
  }

  toggleCheckbox(id: string): void {
    const box = $<HTMLInputElement>(id);
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change'));
  }

  bindUi(): void {
    $('tab-galaxy').addEventListener('click', () => {
      if (this.app.view === 'system') void this.app.exitToGalaxy();
      else if (this.app.view === 'sky') void this.app.switchView('galaxy');
      else if (this.app.view === 'cosmos') void this.app.cosmosUI.visitCosmosGalaxy(this.app.cosmos.indexOf(this.app.galaxyOrigin || 'Milky Way'));
    });
    $('tab-cosmos').addEventListener('click', () => this.app.view !== 'cosmos' && void this.app.cosmosUI.openCosmos(this.app.view === 'galaxy'));
    $('btn-cosmos-fly').addEventListener('click', () => this.app.cosmos.selected !== -1 && this.app.travelUI.goCosmosGalaxy(this.app.cosmos.selected));
    $('btn-cosmos-visit').addEventListener('click', () => this.app.cosmos.selected !== -1 && void this.app.cosmosUI.visitCosmosGalaxy(this.app.cosmos.selected));
    $('btn-cosmos-home').addEventListener('click', () => {
      const mw = this.app.cosmos.indexOf('Milky Way');
      this.app.cosmosUI.selectCosmos(mw);
      this.app.cosmos.resetCamera();
    });
    $<HTMLInputElement>('opt-cosmic-web').addEventListener('change', (e) => this.app.cosmos.setWebVisible((e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-cosmos-clusters').addEventListener('change', (e) => this.app.cosmos.setKindVisible('cluster', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-cosmos-quasars').addEventListener('change', (e) => this.app.cosmos.setKindVisible('quasar', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-real-nebulae').addEventListener('change', (e) => this.app.galaxy.setRealLayerVisible('nebulae', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-real-clusters').addEventListener('change', (e) => this.app.galaxy.setRealLayerVisible('clusters', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-real-pulsars').addEventListener('change', (e) => this.app.galaxy.setRealLayerVisible('pulsars', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-real-xray').addEventListener('change', (e) => this.app.galaxy.setRealLayerVisible('xray', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-real-wr').addEventListener('change', (e) => this.app.galaxy.setRealLayerVisible('wr', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-real-novae').addEventListener('change', (e) => this.app.galaxy.setRealLayerVisible('novae', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-real-cepheids').addEventListener('change', (e) => this.app.galaxy.setRealLayerVisible('cepheids', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-real-masers').addEventListener('change', (e) => this.app.galaxy.setRealLayerVisible('masers', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-gaia-stars').addEventListener('change', (e) => this.app.galaxy.setGaiaVisible((e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-cmb').addEventListener('change', (e) => this.app.cosmos.setCmbVisible((e.target as HTMLInputElement).checked));
    $('cosmos-search').addEventListener('input', () => this.app.cosmosUI.renderCosmosSearch());
    $('cosmos-results').addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('[data-galaxy]');
      if (!li) return;
      const index = Number(li.dataset.galaxy);
      this.app.cosmosUI.selectCosmos(index);
      this.app.travelUI.goCosmosGalaxy(index);
    });
    $('tab-system').addEventListener('click', () => void this.app.switchToSandbox());
    $('tab-sky').addEventListener('click', () => void this.app.skyUI.openSky());
    this.app.skyUI.wireSkyPanel();
    $('btn-play').addEventListener('click', () => this.app.setRunning(!this.app.running));
    $('btn-undo').addEventListener('click', () => this.app.undo());
    $('btn-redo').addEventListener('click', () => this.app.redo());
    const rewind = $('btn-rewind');
    rewind.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      rewind.setPointerCapture(e.pointerId);
      this.app.startRewind();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) rewind.addEventListener(ev, () => this.app.stopRewind());
    const forward = $('btn-forward');
    forward.addEventListener('pointerdown', (e) => {
      forward.setPointerCapture(e.pointerId);
      this.app.forwardDown();
    });
    forward.addEventListener('pointerup', () => this.app.forwardUp());
    forward.addEventListener('pointercancel', () => this.app.forwardHold?.holding && this.app.forwardUp());
    forward.addEventListener('contextmenu', (e) => e.preventDefault());
    $('btn-sound').addEventListener('click', () => this.app.setSound(!this.app.audio.isEnabled));
    const postfxBox = $<HTMLInputElement>('opt-postfx');
    postfxBox.checked = this.app.postfxOn;
    postfxBox.addEventListener('change', () => {
      this.app.postfxOn = postfxBox.checked;
      prefs.set('postfx', this.app.postfxOn);
    });
    $('btn-vr').addEventListener('click', () => void this.app.vrUI.enterVR().catch((err) => toast(`Couldn't start VR: ${(err as Error).message}`)));
    $('btn-gpu').addEventListener('click', () => void this.app.megaSimUI.openMegaSim());
    $('gpu-restart').addEventListener('click', () => this.app.megaSimUI.restartMegaSim());
    $('gpu-exit').addEventListener('click', () => this.app.megaSimUI.closeMegaSim());
    $('gpu-steps').addEventListener('change', () => this.app.mega && (this.app.mega.stepsPerFrame = Number($<HTMLSelectElement>('gpu-steps').value)));
    $('gpu-pause').addEventListener('click', () => {
      if (!this.app.mega) return;
      this.app.mega.paused = !this.app.mega.paused;
      $('gpu-pause').textContent = this.app.mega.paused ? 'Resume' : 'Pause';
    });
    $('btn-help').addEventListener('click', () => this.app.tutorialUI.openTutorial());
    $('btn-menu').addEventListener('click', () => document.body.classList.toggle('panels-hidden'));
    $<HTMLSelectElement>('quality').addEventListener('change', (e) => {
      prefs.set('qualityChosen', true);
      this.app.applyQuality((e.target as HTMLSelectElement).value as QualityName);
    });
    const autores = $<HTMLInputElement>('opt-autores');
    autores.checked = this.app.autoResolution;
    autores.addEventListener('change', () => {
      this.app.autoResolution = autores.checked;
      prefs.set('autoResolution', autores.checked);
      // Back to full resolution when turned off.
      if (!autores.checked) this.app.applyQuality(this.app.quality);
    });
    // Which graphics chip is drawing (to check a laptop uses its dedicated GPU).
    const gl = this.app.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    if (gpu) $('gpu-info').textContent = `Graphics: ${gpu.replace(/^ANGLE \((.*)\)$/, '$1')}`;

    // Galaxy
    const goSeed = () => this.app.galaxyMapUI.buildGalaxy(seedFromString($<HTMLInputElement>('galaxy-seed').value || '1'));
    $('btn-galaxy-go').addEventListener('click', goSeed);
    $<HTMLInputElement>('galaxy-seed').addEventListener('keydown', (e) => e.key === 'Enter' && goSeed());
    $('btn-galaxy-random').addEventListener('click', () => this.app.galaxyMapUI.buildGalaxy(Math.floor(Math.random() * 1e9)));
    $('btn-star-fly').addEventListener('click', () => this.app.galaxy.selected !== -1 && this.app.travelUI.goGalaxyTarget(this.app.galaxy.selected));
    $('btn-star-enter').addEventListener('click', () => this.app.galaxy.selected !== -1 && void this.app.enterTarget(this.app.galaxy.selected));
    $('btn-star-bookmark').addEventListener('click', () => this.app.galaxyMapUI.toggleBookmark());
    $('btn-back').addEventListener('click', () => void this.app.exitToGalaxy());
    $<HTMLInputElement>('star-search').addEventListener('input', (e) => this.app.galaxyMapUI.search((e.target as HTMLInputElement).value));
    $<HTMLSelectElement>('star-filter').addEventListener('change', () => void this.app.galaxyMapUI.applyFilter());
    const pickFromList = (e: Event) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-index]');
      if (!li) return;
      const i = Number(li.dataset.index);
      this.app.galaxyMapUI.selectTarget(i);
      this.app.travelUI.goGalaxyTarget(i);
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
      if (preset) this.app.loadScenario({ name: preset.name, load: () => preset.load(this.app.sim), presetId: preset.id });
    });
    $('btn-reset').addEventListener('click', () => this.app.loadScenario(this.app.scenario));
    $('btn-save').addEventListener('click', () => this.app.saveFile());
    $('btn-open').addEventListener('click', () => $<HTMLInputElement>('file-input').click());
    $<HTMLInputElement>('file-input').addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        // The Open button accepts both scene files and replay files.
        const text = await file.text();
        if (text.includes('"astrarium-replay"')) this.app.replaysUI.startReplay(new ReplayPlayer(parseReplay(text)));
        else this.app.applyScene(await readSceneFile(file));
      } catch (err) {
        toast((err as Error).message);
      }
    });
    $('btn-share').addEventListener('click', () => void this.app.shareLink());

    // Real data
    const dateInput = $<HTMLInputElement>('solar-date');
    dateInput.value = new Date().toISOString().slice(0, 10);
    $('btn-solar-date').addEventListener('click', () => {
      const date = dateInput.value ? new Date(`${dateInput.value}T00:00:00Z`) : new Date();
      if (Number.isNaN(date.getTime())) return toast('Pick a valid date');
      this.app.loadScenario({ name: `the Solar System on ${date.toISOString().slice(0, 10)}`, load: () => loadSolarSystemOnDate(this.app.sim, date), origin: { kind: 'sol' } });
    });
    $('btn-exoplanets').addEventListener('click', () => void this.app.realDataUI.openExoBrowser());
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
      if (f) this.app.loadScenario({ name: `${f.name} flyby`, description: `Real close approach of ${f.name} to Earth on ${f.date} UTC (JPL).`, load: () => loadFlyby(this.app.sim, f) });
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
      this.app.loadScenario({ name: `${e.craft} at ${e.planet}`, description: `${e.craft}'s real flyby of ${e.planet} on ${e.closestUtc.slice(0, 10)} (JPL Horizons).`, load: () => loadVoyagerEncounter(this.app.sim, e, data) });
      // The next press continues the tour with the same spacecraft.
      const next = list.findIndex((x, j) => j > i && x.craft === e.craft);
      if (next >= 0) select.value = String(next);
    });
    // Pulsars: their pulses as sound, at the real spin rate.
    const hearPulsar = (name: string, period: number, seed: number) => {
      const rate = 44100;
      playSamples(pulsarSamples(period, 5, rate, seed), rate);
      toast(`${name}: ${soundsLike(period)}. Its radio pulses played as sound at the real spin rate (synthesized).`);
    };
    $('btn-pulsar-hear').addEventListener('click', () => {
      const b = this.app.selectedBody();
      if (b?.kind === 'neutron') hearPulsar(b.name, pulsarParams(b.name, b.id).period, b.id);
    });
    $('btn-star-hear').addEventListener('click', () => {
      const t = this.app.galaxy.selected;
      const p = typeof t === 'object' && 'psr' in t ? this.app.pulsarMapList[t.psr] : undefined;
      if (p) hearPulsar(pulsarName(p), p.period, t !== -1 && typeof t === 'object' && 'psr' in t ? t.psr : 1);
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
      if (ev) this.app.loadScenario({ name: ev.name, description: `${ev.about}${ev.massNote ? ` ${ev.massNote}` : ''}`, load: () => loadGwEvent(this.app.sim, ev) });
    });
    $('exo-close').addEventListener('click', () => this.app.realDataUI.closeExoBrowser());
    $('exo-search').addEventListener('input', () => this.app.realDataUI.renderExoList());
    $('exo-filter').addEventListener('change', () => this.app.realDataUI.renderExoList());
    const pickHost = (e: Event) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-host]');
      const host = li && this.app.catalog?.hosts.find((h) => h.name === li.dataset.host);
      if (host) this.app.realDataUI.loadExoHost(host);
    };
    $('exo-list').addEventListener('click', pickHost);
    $('exo-list').addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && pickHost(e));
    $('btn-neighbourhood').addEventListener('click', () => void this.app.realDataUI.loadNeighbourhoodScene());
    $('btn-gaia100').addEventListener('click', () => void this.app.realDataUI.loadGaia100Scene());
    $('btn-halley').addEventListener('click', async () => {
      try {
        const [h] = await Promise.all([loadHalleyReturn(), loadSolarData()]);
        this.app.loadScenario({ name: "Halley's return (2061)", description: "Comet Halley's real 2061 return from JPL Horizons, with the planets on that date.", load: () => loadHalley2061(this.app.sim, h), origin: { kind: 'sol' } });
      } catch {
        toast("Couldn't load Halley's data.");
      }
    });
    $('btn-visit').addEventListener('click', () => void this.app.realDataUI.visitSelected());
    $('btn-star-neighbourhood').addEventListener('click', async () => {
      await this.app.fade(true);
      await this.app.realDataUI.loadNeighbourhoodScene();
      await this.app.fade(false);
    });

    // Tools
    $('tool-select').addEventListener('click', () => this.app.setTool('select'));
    $('tool-spawn').addEventListener('click', () => this.app.setTool('spawn'));
    $('tool-nudge').addEventListener('click', () => this.app.setTool('nudge'));

    // Probes
    document.querySelectorAll<HTMLButtonElement>('[data-burn]').forEach((b) =>
      b.addEventListener('click', () => this.app.bodyPanelUI.burn(b.dataset.burn as 'prograde' | 'retrograde' | 'out' | 'in')),
    );
    $('burn-size').addEventListener('input', () => ($('burn-size-out').textContent = `${(this.app.bodyPanelUI.burnSize() / KMS).toFixed(2)} km/s`));
    $('transfer-target').addEventListener('change', () => {
      const b = this.app.selectedBody();
      if (b) this.app.bodyPanelUI.updateProbePanel(b);
    });
    $('btn-transfer').addEventListener('click', () => {
      const dv = Number($('btn-transfer').dataset.dv);
      if (Number.isFinite(dv)) this.app.bodyPanelUI.burn(dv >= 0 ? 'prograde' : 'retrograde', Math.abs(dv));
    });

    // Companion server, gallery, multiplayer
    $('btn-server').addEventListener('click', () => {
      const url = $<HTMLInputElement>('server-url').value.trim();
      if (url) void this.app.onlineUI.connectServer(url);
    });
    $('btn-describe').addEventListener('click', () => void this.app.onlineUI.describeScene());
    $<HTMLTextAreaElement>('describe-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void this.app.onlineUI.describeScene();
    });
    $('btn-gallery').addEventListener('click', () => void this.app.onlineUI.openGallery());
    $('gallery-close').addEventListener('click', () => $('gallery-modal').classList.add('hidden'));
    $('gallery-sort').addEventListener('change', () => void this.app.onlineUI.openGallery());
    $('gallery-list').addEventListener('click', async (e) => {
      const el = e.target as HTMLElement;
      const load = el.closest<HTMLElement>('[data-load]')?.dataset.load;
      const vote = el.closest<HTMLElement>('[data-vote]');
      try {
        if (load && this.app.server) {
          this.app.applyScene(await this.app.server.getScene(load));
          $('gallery-modal').classList.add('hidden');
        } else if (vote && this.app.server) {
          vote.textContent = `▲ ${await this.app.server.vote(vote.dataset.vote!)}`;
        }
      } catch (err) {
        toast((err as Error).message);
      }
    });
    $('btn-publish').addEventListener('click', () => {
      if (!this.app.onlineUI.requireServer()) return;
      $<HTMLInputElement>('publish-name').value = this.app.scenario.name;
      $<HTMLInputElement>('publish-author').value = prefs.get('author', '');
      $('publish-modal').classList.remove('hidden');
    });
    $('publish-cancel').addEventListener('click', () => $('publish-modal').classList.add('hidden'));
    $('publish-go').addEventListener('click', () => void this.app.onlineUI.publishScene());
    $('btn-mp').addEventListener('click', () => (this.app.onlineUI.requireServer() ? this.app.onlineUI.openMultiplayer() : undefined));
    $('mp-close').addEventListener('click', () => $('mp-modal').classList.add('hidden'));
    $('mp-join').addEventListener('click', () => void this.app.onlineUI.joinRoom());
    $('mp-leave').addEventListener('click', () => {
      this.app.mp.disconnect();
      $('mp-status').textContent = 'Left the room.';
      $('mp-peers').innerHTML = '';
      $('btn-mp').classList.remove('active');
    });
    $('mp-invite').addEventListener('click', async () => {
      const room = $<HTMLInputElement>('mp-room').value.trim();
      const link = `${location.origin}${location.pathname}#room=${encodeURIComponent(room)}${this.app.server ? `&server=${encodeURIComponent(this.app.server.base)}` : ''}`;
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
        this.app.mp.chat(input.value.trim());
        input.value = '';
      }
    });

    // Embeds, video, replays
    $('btn-embed').addEventListener('click', () => void this.app.copyEmbed());
    $('btn-video').addEventListener('click', () => void this.app.replaysUI.toggleVideo());
    $('btn-record').addEventListener('click', () => this.app.replaysUI.toggleRecording());
    $('replay-play').addEventListener('click', () => {
      const p = this.app.player;
      if (!p) return;
      if (!p.playing && p.position >= p.replay.frames.length - 1) p.position = 0;
      p.playing = !p.playing;
    });
    $<HTMLInputElement>('replay-seek').addEventListener('input', (e) => this.app.player?.seek(Number((e.target as HTMLInputElement).value) / 1000));
    $<HTMLSelectElement>('replay-speed').addEventListener('change', (e) => this.app.player && (this.app.player.speed = Number((e.target as HTMLSelectElement).value)));
    $('replay-exit').addEventListener('click', () => this.app.replaysUI.exitReplay());
    $('replay-save').addEventListener('click', () => {
      if (!this.app.player) return;
      const blob = new Blob([serializeReplay(this.app.player.replay)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `astrarium-replay-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
    $('replay-video').addEventListener('click', () => {
      if (!this.app.player || !VideoRecorder.supported()) return void toast('Video recording is not supported in this browser.');
      this.app.player.position = 0;
      this.app.player.playing = true;
      this.app.video.start(this.app.canvas);
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
      this.app.scriptingUI.renderPlugins();
      if (!$('console-panel').classList.contains('hidden')) $('console-code').focus();
    };
    $('btn-console').addEventListener('click', toggleConsole);
    $('console-close').addEventListener('click', toggleConsole);
    const runConsole = () => {
      const code = $<HTMLTextAreaElement>('console-code').value;
      if (code.trim()) this.app.scripts.run(code);
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
      this.app.scripts.stop();
      this.app.host.setSettings({ customForces: [] });
      this.app.scriptingUI.consoleLog('Stopped scripts and removed custom forces.');
    });
    $('console-help').addEventListener('click', () => this.app.scriptingUI.consoleLog(SCRIPT_HELP));
    $('console-save').addEventListener('click', () => {
      const code = $<HTMLTextAreaElement>('console-code').value.trim();
      if (!code) return;
      const name = window.prompt('Plugin name:', 'My plugin');
      if (!name) return;
      prefs.set('plugins', [...this.app.scriptingUI.plugins().filter((p) => p.name !== name), { name, code, autorun: false }]);
      this.app.scriptingUI.renderPlugins();
    });
    $('plugin-list').addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const list = this.app.scriptingUI.plugins();
      const idx = (attr: string) => Number(el.closest<HTMLElement>(`[${attr}]`)?.getAttribute(attr));
      if (el.closest('[data-run]')) this.app.scripts.run(list[idx('data-run')].code);
      else if (el.closest('[data-edit]')) $<HTMLTextAreaElement>('console-code').value = list[idx('data-edit')].code;
      else if (el.closest('[data-del]')) {
        list.splice(idx('data-del'), 1);
        prefs.set('plugins', list);
        this.app.scriptingUI.renderPlugins();
      } else if (el.closest('[data-autorun]')) {
        list[idx('data-autorun')].autorun = (el as HTMLInputElement).checked;
        prefs.set('plugins', list);
      }
    });

    // Graph & lessons
    const metricSelect = $<HTMLSelectElement>('graph-metric');
    metricSelect.innerHTML = METRICS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
    metricSelect.addEventListener('change', () => {
      this.app.graphMetric = metricSelect.value as MetricId;
      this.app.graphRef = undefined;
      this.app.graphUI.resetGraph();
    });
    $('btn-graph').addEventListener('click', () => (this.app.graphOpen ? this.app.graphUI.closeGraph() : this.app.graphUI.openGraph()));
    $('graph-close').addEventListener('click', () => this.app.graphUI.closeGraph());
    $('graph-clear').addEventListener('click', () => {
      this.app.graphRef = undefined;
      this.app.graphUI.resetGraph();
    });
    $('graph-pin').addEventListener('click', () => {
      if (this.app.graphSeries.length < 2) return void toast('Run the simulation for a moment first');
      this.app.graphRef = { label: 'Pinned run', color: '#ffb24a', points: this.app.graphSeries.slice(), dashed: true };
      this.app.graphUI.resetGraph();
      toast('Pinned. Change something (or press Reset) and compare the new run.');
    });
    $('btn-learn').addEventListener('click', () => this.app.learningUI.openLessonMenu());
    $('btn-search').addEventListener('click', () => this.app.searchUI.openSearch());
    this.app.photoUI.bindPhoto();
    this.app.placesUI.bindPlaces();
    $('body-wiki').addEventListener('toggle', () => this.app.bodyPanelUI.updateBodyPanel());
    $('btn-ship').addEventListener('click', () => this.app.shipUI.spawnShip());
    $('ship-engine').innerHTML = ENGINES.map((e) => `<option value="${e.id}">${escapeHtml(e.label)}</option>`).join('');
    $('ship-engine').addEventListener('change', () => {
      const ship = this.app.shipUI.selectedShip();
      if (!ship) return;
      // A new engine comes with a full tank.
      const engine = this.app.shipUI.shipEngine();
      this.app.mutate(`fitting ${ship.name} with a new engine`, () => (ship.fuel = Number.isFinite(engine.deltaV) ? engine.deltaV * KMS_TO_AU_YR : undefined));
      const ap = this.app.sim.autopilot.get(ship.id);
      if (ap) this.app.host.setAutopilot(ship.id, { ...ap, maxAccel: this.app.shipUI.shipAccel() });
      this.app.shipUI.updateShipPanel();
    });
    $('ship-throttle').addEventListener('input', () => {
      const ship = this.app.shipUI.selectedShip();
      const ap = ship && this.app.sim.autopilot.get(ship.id);
      if (ship && ap) this.app.host.setAutopilot(ship.id, { ...ap, maxAccel: this.app.shipUI.shipAccel() });
      this.app.shipUI.updateShipPanel();
    });
    $('ship-autopilot').addEventListener('click', () => this.app.shipUI.toggleAutopilot());
    document.querySelectorAll<HTMLElement>('[data-thrust]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId);
        this.app.shipUI.startShipThrust(b.dataset.thrust!);
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => this.app.shipUI.stopShipThrust());
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    $('travel-speed').innerHTML = SPEEDS.map((s, i) => `<option value="${i}"${s.about ? ` title="${escapeHtml(s.about)}"` : ''}>${escapeHtml(s.label)}</option>`).join('');
    $<HTMLSelectElement>('travel-speed').value = String(SPEEDS.findIndex((s) => s.c === 0.99));
    $('travel-cruise').addEventListener('click', () => {
      if (this.app.trip) this.app.travelUI.stopTrip();
      else if (this.app.view === 'galaxy' || this.app.view === 'cosmos') this.app.travelUI.startTrip(this.app.view, undefined, 0, 'ahead');
    });
    // A new speed or warp applies to the trip in progress.
    for (const id of ['travel-speed', 'travel-warp']) {
      $(id).addEventListener('change', () => {
        const t = this.app.trip;
        if (!t) return;
        const speed = SPEEDS[Number($<HTMLSelectElement>('travel-speed').value)];
        const choice = $<HTMLSelectElement>('travel-warp').value;
        t.trip.speed = speed.c;
        t.trip.warp = choice !== 'auto' ? Number(choice) : Number.isFinite(t.trip.remainingLy) ? autoWarp(t.trip.remainingLy, speed.c) : autoWarp(t.view === 'galaxy' ? 300 : 3e6, speed.c, 1);
        this.app.travelUI.renderTripHud();
      });
    }
    $('global-search').addEventListener('input', () => void this.app.searchUI.renderSearch());
    $('global-search').addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        this.app.searchUI.moveSearch(k === 'ArrowDown' ? 1 : -1);
      } else if (k === 'Enter') {
        // Not also the views' own Enter ("visit this star / galaxy").
        e.stopPropagation();
        const r = this.app.searchResults[this.app.searchActive];
        if (r) void this.app.searchUI.goToSearchResult(r);
      } else if (k === 'Escape') {
        this.app.searchUI.closeSearch();
      }
    });
    $('global-results').addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-i]');
      const r = li ? this.app.searchResults[Number(li.dataset.i)] : undefined;
      if (r) void this.app.searchUI.goToSearchResult(r);
    });
    // Clicking outside the box closes it.
    $('search-overlay').addEventListener('pointerdown', (e) => e.target === $('search-overlay') && this.app.searchUI.closeSearch());
    $('lesson-menu-close').addEventListener('click', () => $('lesson-menu').classList.add('hidden'));
    $('lesson-list').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-lesson]')?.dataset.lesson;
      const def = LESSONS.find((l) => l.id === id);
      if (def) this.app.learningUI.startLesson(def);
    });
    $('lesson-next').addEventListener('click', () => this.app.lesson && this.app.learningUI.showLessonStep(this.app.lesson.step + 1));
    $('lesson-back').addEventListener('click', () => this.app.lesson && this.app.learningUI.showLessonStep(this.app.lesson.step - 1));
    $('lesson-exit').addEventListener('click', () => this.app.learningUI.exitLesson());

    // Challenges
    $('btn-challenges').addEventListener('click', () => this.app.learningUI.openChallengeMenu());
    $('challenge-menu-close').addEventListener('click', () => $('challenge-menu').classList.add('hidden'));
    $('challenge-list').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-challenge]')?.dataset.challenge;
      const def = id && this.app.learningUI.findChallenge(id);
      if (def) this.app.learningUI.startChallenge(def);
    });
    $('hud-hint').addEventListener('click', () => this.app.challenge && toast(this.app.challenge.def.hint));
    $('hud-restart').addEventListener('click', () => this.app.challenge && this.app.learningUI.startChallenge(this.app.challenge.def));
    $('hud-quit').addEventListener('click', () => this.app.learningUI.quitChallenge());
    $('result-retry').addEventListener('click', () => this.app.challenge && this.app.learningUI.startChallenge(this.app.challenge.def));
    $('result-menu').addEventListener('click', () => {
      this.app.learningUI.quitChallenge();
      this.app.learningUI.openChallengeMenu();
    });
    $('result-share').addEventListener('click', async () => {
      const c = this.app.challenge;
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
        this.app.spawnType = t;
        palette.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      });
      palette.appendChild(b);
    }
    palette.querySelector(`[data-type="${this.app.spawnType.id}"]`)?.classList.add('active');
    const massInput = $<HTMLInputElement>('spawn-mass');
    massInput.addEventListener('input', () => {
      this.app.spawnMassFactor = Math.pow(10, Number(massInput.value));
      $('spawn-mass-out').textContent = `${fmt(this.app.spawnMassFactor)}×`;
    });
    $<HTMLInputElement>('spawn-orbit').addEventListener('change', (e) => (this.app.autoOrbit = (e.target as HTMLInputElement).checked));

    // Simulation settings (sent to the worker without resending state)
    const ts = $<HTMLInputElement>('time-scale');
    ts.addEventListener('input', () => this.app.setTimeScale(Math.pow(10, Number(ts.value))));
    const grav = $<HTMLInputElement>('gravity');
    grav.addEventListener('input', () => {
      const gBase = this.app.sim.units === 'kpc-myr' ? KPC_MYR_GRAVITY_SCALE : 1;
      this.app.host.setSettings({ gravityScale: Number(grav.value) * gBase });
      $('gravity-out').textContent = Number(grav.value).toFixed(2);
    });
    const bindSetting = (id: string, key: 'collisions' | 'debris' | 'shatter' | 'tidal') =>
      $<HTMLInputElement>(id).addEventListener('change', (e) => this.app.host.setSettings({ [key]: (e.target as HTMLInputElement).checked }));
    bindSetting('opt-collisions', 'collisions');
    bindSetting('opt-debris', 'debris');
    bindSetting('opt-shatter', 'shatter');
    bindSetting('opt-tidal', 'tidal');
    $<HTMLInputElement>('opt-relativity').addEventListener('change', (e) => this.app.host.setSettings({ relativity: (e.target as HTMLInputElement).checked }));
    $<HTMLInputElement>('opt-truescale').addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.app.mutate(on ? 'switching to real sizes' : 'switching to visible sizes', () => setTrueScale(this.app.sim, on));
      toast(on ? 'Real sizes: planets become tiny dots. Collisions only happen at true contact.' : 'Visible sizes: bodies are enlarged so you can see them.');
    });
    const light = $<HTMLInputElement>('light-speed');
    light.addEventListener('input', () => {
      this.app.host.setSettings({ lightSpeedScale: Math.pow(10, Number(light.value)) });
      $('light-speed-out').textContent = formatFactor(this.app.sim.lightSpeedScale);
    });
    const evo = $<HTMLInputElement>('evolution');
    evo.addEventListener('input', () => {
      this.app.host.setSettings({ evolutionRate: Math.pow(10, Number(evo.value)) });
      $('evolution-out').textContent = formatEvolution(this.app.sim.evolutionRate);
    });
    $('btn-age').addEventListener('click', () => this.app.mutate('aging stars by 1 Gyr', () => this.app.sim.ageBy(1e9)));
    $<HTMLInputElement>('opt-lagrange').addEventListener('change', (e) => (this.app.system.lagrangeEnabled = (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-trails').addEventListener('change', (e) => {
      this.app.system.trailsEnabled = (e.target as HTMLInputElement).checked;
      if (this.app.system.trailsEnabled) this.app.system.clearTrails();
    });
    $<HTMLInputElement>('opt-rel-trails').addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.app.system.trailFrame = on ? 'follow' : 'absolute';
      if (on && this.app.system.followId === undefined) toast('Relative trails are drawn around the body you follow (double-click one).');
    });
    $<HTMLInputElement>('opt-labels').addEventListener('change', (e) => (this.app.system.labelsEnabled = (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-orbits').addEventListener('change', (e) => (this.app.system.orbitsEnabled = (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-hz').addEventListener('change', (e) => (this.app.system.habitableZones = (e.target as HTMLInputElement).checked));
    $('btn-clear-trails').addEventListener('click', () => this.app.system.clearTrails());
    $('btn-recenter').addEventListener('click', () => {
      this.app.mutate('recentering', () => this.app.sim.recenter());
      this.app.system.clearTrails();
    });

    // Body panel
    $('btn-follow').addEventListener('click', () => this.app.toggleFollow());
    $('btn-delete').addEventListener('click', () => this.app.deleteSelected());
    $('btn-mass-up').addEventListener('click', () => this.app.scaleSelectedMass(2));
    // Metallicity slider: log10(Z/Z☉) from −2 (1% of the Sun's metals) to +0.5.
    $<HTMLInputElement>('metallicity').addEventListener('change', (e) => {
      const body = this.app.selectedBody();
      if (!body) return;
      const z = Number((10 ** Number((e.target as HTMLInputElement).value)).toPrecision(2));
      this.app.mutate(`changing ${body.name}'s metallicity`, () => (body.metallicity = z === 1 ? undefined : z));
      this.app.bodyPanelUI.updateBodyPanel();
    });
    $<HTMLInputElement>('metallicity').addEventListener('input', (e) => {
      $('metallicity-out').textContent = (10 ** Number((e.target as HTMLInputElement).value)).toFixed(2);
    });
    $<HTMLInputElement>('bh-spin').addEventListener('change', (e) => {
      const body = this.app.selectedBody();
      if (!body) return;
      const a = Number((e.target as HTMLInputElement).value);
      this.app.mutate(`spinning ${body.name} to a* = ${a.toFixed(2)}`, () => (body.spin = a || undefined));
      this.app.bodyPanelUI.updateBodyPanel();
    });
    $<HTMLInputElement>('bh-spin').addEventListener('input', (e) => {
      $('bh-spin-out').textContent = Number((e.target as HTMLInputElement).value).toFixed(2);
    });
    $('btn-mass-down').addEventListener('click', () => this.app.scaleSelectedMass(0.5));
    $('btn-land').addEventListener('click', () => this.app.landingUI.landOnSelected());
    $('btn-takeoff').addEventListener('click', () => this.app.landingUI.takeOff());
    $('btn-supernova').addEventListener('click', () => this.app.detonateSelected());

    // Gentle UI ticks.
    document.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.app.audio.click();
    });
  }
}
