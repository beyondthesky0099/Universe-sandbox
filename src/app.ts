import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { generateStarSystem, type StarSystemSpec } from './procgen/starSystem';
import { mulberry32, pick, seedFromString } from './procgen/rng';
import { GalaxyView } from './render/galaxyView';
import { SystemView } from './render/systemView';
import { defaultColor, kindForMass, radiusFor, type Body, type BodyKind } from './sim/body';
import { GAS_PALETTE, ROCKY_PALETTE } from './sim/color';
import { circularOrbitVelocity } from './sim/orbits';
import { predictPath } from './sim/predict';
import { loadStarSystem, PRESETS, type SceneSetup } from './sim/presets';
import { Simulation, type SimEvent } from './sim/simulation';
import { EARTH_MASS, formatDistance, formatMass, formatSpeed, formatTime, G, JUPITER_MASS, fmt } from './sim/units';
import { $, isTyping, setFacts, toast } from './ui/dom';

type ViewName = 'galaxy' | 'system';
type Tool = 'select' | 'spawn';

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

export class App {
  private readonly canvas = $<HTMLCanvasElement>('scene');
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer = new CSS2DRenderer({ element: $('labels') });
  private readonly sim = new Simulation(20000);
  private readonly system: SystemView;
  private readonly galaxy: GalaxyView;
  private view: ViewName = 'system';
  private tool: Tool = 'select';
  private spawnType = SPAWN_TYPES[1];
  private spawnMassFactor = 1;
  private autoOrbit = true;
  private running = true;
  private timeScale = 0.4;
  private galaxyBuilt = false;
  private galaxySeed = 1;
  private scenario: () => SceneSetup = () => PRESETS[0].load(this.sim);
  private spawnDrag?: SpawnDrag;
  private pointerDown?: { x: number; y: number; button: number };
  private spawnCounter = 0;
  private width = 1;
  private height = 1;
  private frames = 0;
  private fpsTime = 0;
  private fps = 0;
  private lastMergeToast = 0;
  private lagging = false;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x02030a);
    this.system = new SystemView(this.sim, this.canvas);
    this.galaxy = new GalaxyView(this.canvas);

    const hashSeed = new URLSearchParams(location.hash.slice(1)).get('galaxy');
    this.galaxySeed = hashSeed ? seedFromString(hashSeed) : 1;

    this.bindUi();
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.loadScenario(() => PRESETS[0].load(this.sim), PRESETS[0].id);
    this.setView('system');
    this.setTool('select');

    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
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
      if (this.running) {
        const result = this.sim.advance(this.timeScale * dt);
        this.lagging = result.lagging;
      } else {
        this.lagging = false;
      }
      if (this.spawnDrag) this.updateSpawnPreview(performance.now());
      const events = this.sim.events.splice(0);
      this.handleEvents(events);
      this.system.update(dt, this.height, this.running, events);
      this.renderer.render(this.system.scene, this.system.camera);
      this.labelRenderer.render(this.system.scene, this.system.camera);
      if (this.frames % 6 === 0) this.updateSystemHud();
    } else {
      this.galaxy.update(dt);
      this.renderer.render(this.galaxy.scene, this.galaxy.camera);
      if (this.frames % 15 === 0) $('stats').textContent = `${Math.round(this.fps)} fps`;
    }
  }

  private handleEvents(events: SimEvent[]): void {
    const now = performance.now();
    for (const e of events) {
      if (e.type === 'ignite') toast(e.message, 'ignite');
      else if (e.type === 'collapse') toast(e.message, 'collapse');
      else if (now - this.lastMergeToast > 1500 && this.sim.bodies.length <= 40) {
        toast(e.message);
        this.lastMergeToast = now;
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

  // ---------------------------------------------------------------------------
  // Views & scenarios

  private setView(view: ViewName): void {
    if (view === 'galaxy' && !this.galaxyBuilt) this.buildGalaxy(this.galaxySeed);
    this.view = view;
    this.system.controls.enabled = view === 'system';
    this.galaxy.controls.enabled = view === 'galaxy';
    $('tab-galaxy').classList.toggle('active', view === 'galaxy');
    $('tab-system').classList.toggle('active', view === 'system');
    $('labels').classList.toggle('hidden', view !== 'system');
    document.querySelectorAll<HTMLElement>('[data-view]').forEach((el) => {
      const match = el.dataset.view === view;
      if (el.id === 'star-panel') el.classList.toggle('hidden', !match || this.galaxy.selectedIndex < 0);
      else if (el.id === 'body-panel') el.classList.toggle('hidden', !match || this.system.selectedId === undefined);
      else el.classList.toggle('hidden', !match);
    });
    this.updateHint();
  }

  private loadScenario(load: () => SceneSetup, presetId?: string, origin?: StarSystemSpec): void {
    this.sim.clear();
    this.sim.dtMax = 0.01;
    this.scenario = load;
    const setup = load();
    this.system.reset(setup);
    this.setTimeScale(setup.timeScale);
    this.hideBodyPanel();
    const select = $<HTMLSelectElement>('preset-select');
    if (presetId) {
      select.value = presetId;
      $('preset-desc').textContent = PRESETS.find((p) => p.id === presetId)?.description ?? '';
    } else {
      select.value = '';
    }
    $('origin').classList.toggle('hidden', !origin);
    if (origin) {
      $('origin-name').textContent = origin.star.name;
      $('preset-desc').textContent = describeSystem(origin);
    }
  }

  private buildGalaxy(seed: number): void {
    this.galaxySeed = seed;
    const data = this.galaxy.build(seed);
    this.galaxyBuilt = true;
    $('galaxy-name').textContent = data.name;
    $('galaxy-info').textContent = `${data.arms}-armed spiral · ${data.stars.count.toLocaleString()} explorable star systems`;
    $<HTMLInputElement>('galaxy-seed').value = String(seed);
    $('star-panel').classList.add('hidden');
    history.replaceState(null, '', `#galaxy=${seed}`);
  }

  private selectStar(index: number): void {
    this.galaxy.select(index);
    const panel = $('star-panel');
    if (index < 0) {
      panel.classList.add('hidden');
      return;
    }
    const spec = generateStarSystem(this.galaxy.data.stars.seeds[index]);
    $('star-name').textContent = spec.star.name;
    const moons = spec.planets.reduce((n, p) => n + p.moons.length, 0);
    setFacts($('star-facts'), [
      ['Class', `${spec.star.spectralClass}-type star`],
      ['Mass', `${fmt(spec.star.mass)} M☉`],
      ['Temperature', `${Math.round(spec.star.temperature).toLocaleString()} K`],
      ['Planets', String(spec.planets.length)],
      ['Gas giants', String(spec.planets.filter((p) => p.kind === 'gas').length)],
      ['Moons', String(moons)],
      ['Asteroid belt', spec.belt ? 'Yes' : 'No'],
      ['Companion', spec.companion ? `${spec.companion.spectralClass}-type at ${fmt(spec.companion.a)} AU` : 'None'],
    ]);
    panel.classList.remove('hidden');
  }

  private enterSelectedStar(): void {
    const index = this.galaxy.selectedIndex;
    if (index < 0) return;
    const spec = generateStarSystem(this.galaxy.data.stars.seeds[index]);
    this.loadScenario(() => loadStarSystem(this.sim, spec), undefined, spec);
    this.setView('system');
    toast(`Arrived at ${spec.star.name}`);
  }

  private setTimeScale(yearsPerSecond: number): void {
    this.timeScale = yearsPerSecond;
    const input = $<HTMLInputElement>('time-scale');
    input.value = String(Math.log10(yearsPerSecond));
    $('time-scale-out').textContent = formatRate(yearsPerSecond);
  }

  private setRunning(running: boolean): void {
    this.running = running;
    $('btn-play').textContent = running ? '⏸' : '▶';
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.spawnDrag = undefined;
    this.system.hideSpawnPreview();
    $('tool-select').classList.toggle('active', tool === 'select');
    $('tool-spawn').classList.toggle('active', tool === 'spawn');
    $('spawn-options').classList.toggle('hidden', tool !== 'spawn');
    const mb = this.system.controls.mouseButtons;
    if (tool === 'spawn') {
      mb.LEFT = null;
      mb.RIGHT = THREE.MOUSE.ROTATE;
    } else {
      mb.LEFT = THREE.MOUSE.ROTATE;
      mb.RIGHT = THREE.MOUSE.PAN;
    }
    this.updateHint();
  }

  private updateHint(): void {
    let text: string;
    if (this.view === 'galaxy') text = 'Click a star to inspect · Double-click to fly there · Enter to visit the selected system';
    else if (this.tool === 'spawn')
      text = 'Click to place · Drag to set velocity · Right-drag to orbit camera · Esc to cancel';
    else text = 'Click a body to select · Drag to orbit · Right-drag to pan · Space pause · B spawn · F follow · M galaxy map';
    $('hint').textContent = text;
  }

  // ---------------------------------------------------------------------------
  // Selection

  private selectBody(body: Body | undefined): void {
    this.system.selectedId = body?.id;
    if (!body) {
      this.hideBodyPanel();
      return;
    }
    $('body-panel').classList.remove('hidden');
    this.updateBodyPanel();
  }

  private hideBodyPanel(): void {
    this.system.selectedId = undefined;
    $('body-panel').classList.add('hidden');
  }

  private updateSystemHud(): void {
    $('sim-time').textContent = formatTime(this.sim.time);
    $('lag').classList.toggle('hidden', !this.lagging);
    $('stats').textContent = `${Math.round(this.fps)} fps · ${this.sim.bodies.length} bodies · ${this.sim.particles.count.toLocaleString()} particles`;
    if (this.system.selectedId !== undefined) {
      if (!this.sim.getBody(this.system.selectedId)) this.hideBodyPanel();
      else this.updateBodyPanel();
    }
    $('btn-follow').textContent = this.system.followId === this.system.selectedId && this.system.followId !== undefined ? 'Unfollow' : 'Follow';
  }

  private updateBodyPanel(): void {
    const body = this.system.selectedId !== undefined ? this.sim.getBody(this.system.selectedId) : undefined;
    if (!body) return;
    $('body-name').textContent = body.name;
    const facts: [string, string][] = [
      ['Type', kindLabel(body)],
      ['Mass', formatMass(body.mass)],
      ['Radius (game)', formatDistance(body.radius)],
    ];
    const parent = this.sim.dominantBodyAt(body.x, body.y, body.z, body);
    if (parent) {
      const dx = body.x - parent.x, dy = body.y - parent.y, dz = body.z - parent.z;
      const dvx = body.vx - parent.vx, dvy = body.vy - parent.vy, dvz = body.vz - parent.vz;
      const r = Math.hypot(dx, dy, dz);
      const v2 = dvx * dvx + dvy * dvy + dvz * dvz;
      const mu = this.sim.effectiveG * (parent.mass + body.mass);
      const energy = v2 / 2 - mu / r;
      facts.push(['Dominant body', parent.name], ['Distance', formatDistance(r)], ['Relative speed', formatSpeed(Math.sqrt(v2))]);
      if (energy < 0 && mu > 0) {
        const a = -mu / (2 * energy);
        // Eccentricity from the specific angular momentum.
        const hx = dy * dvz - dz * dvy, hy = dz * dvx - dx * dvz, hz = dx * dvy - dy * dvx;
        const h2 = hx * hx + hy * hy + hz * hz;
        const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h2) / (mu * mu)));
        facts.push(['Orbit', `a = ${fmt(a)} AU, e = ${e.toFixed(2)}`], ['Period', formatTime(2 * Math.PI * Math.sqrt((a * a * a) / mu))]);
      } else {
        facts.push(['Orbit', 'Unbound (escaping)']);
      }
    } else {
      facts.push(['Speed', formatSpeed(Math.hypot(body.vx, body.vy, body.vz))]);
    }
    setFacts($('body-facts'), facts);
  }

  private deleteSelected(): void {
    const id = this.system.selectedId;
    if (id === undefined) return;
    if (this.system.followId === id) this.system.follow(undefined);
    this.sim.removeBody(id);
    this.hideBodyPanel();
  }

  private scaleSelectedMass(factor: number): void {
    const body = this.system.selectedId !== undefined ? this.sim.getBody(this.system.selectedId) : undefined;
    if (!body) return;
    const before = body.kind;
    body.mass *= factor;
    const natural = kindForMass(body.mass);
    // Let mass changes promote/demote between planet, star and black hole (black holes stay black holes).
    if (body.kind !== 'blackhole') body.kind = natural;
    body.radius = radiusFor(body.kind, body.mass);
    if (body.kind !== before) {
      body.color = body.kind === 'gas' ? GAS_PALETTE[0] : body.kind === 'rocky' ? ROCKY_PALETTE[0] : defaultColor(body.kind, body.mass);
      toast(`${body.name} is now a ${kindLabel(body).toLowerCase()}`, body.kind === 'blackhole' ? 'collapse' : body.kind === 'star' ? 'ignite' : '');
    } else if (body.kind === 'star') {
      body.color = defaultColor('star', body.mass);
    }
    this.sim.invalidate();
    this.updateBodyPanel();
  }

  // ---------------------------------------------------------------------------
  // Spawning

  private spawnVelocity(drag: SpawnDrag): { velocity: THREE.Vector3; perUnit: number } {
    const p = drag.start;
    const followed = this.system.followId !== undefined ? this.sim.getBody(this.system.followId) : undefined;
    const dominant = this.sim.dominantBodyAt(p.x, p.y, p.z);
    let base = new THREE.Vector3();
    if (this.autoOrbit && dominant) {
      const v = circularOrbitVelocity(dominant, p.x, p.y, p.z, this.sim.gravityScale);
      base.set(v.x, v.y, v.z);
    } else if (followed) {
      base.set(followed.vx, followed.vy, followed.vz);
    } else if (dominant) {
      base.set(dominant.vx, dominant.vy, dominant.vz);
    }
    // Drag sensitivity: dragging a distance equal to the distance from the dominant body adds
    // roughly the local circular speed (i.e. scale by the local orbital frequency).
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
    if (t.kind === 'blackhole') return 'blackhole';
    const mass = this.spawnMass();
    // Respect the chosen type unless the mass multiplier pushes it across a physical threshold.
    const natural = kindForMass(mass);
    if (t.kind === 'rocky' && natural === 'gas') return 'rocky';
    return natural;
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

  private commitSpawn(): void {
    const drag = this.spawnDrag;
    this.spawnDrag = undefined;
    this.system.hideSpawnPreview();
    if (!drag) return;
    const { velocity } = this.spawnVelocity(drag);
    const t = this.spawnType;
    const p = drag.start;
    if (t.particles) {
      const dominant = this.sim.dominantBodyAt(p.x, p.y, p.z);
      const r = dominant ? Math.hypot(p.x - dominant.x, p.y - dominant.y, p.z - dominant.z) : 1;
      const size = Math.max(0.02, r * 0.06);
      const dispersion = velocity.clone().sub(dominant ? new THREE.Vector3(dominant.vx, dominant.vy, dominant.vz) : new THREE.Vector3()).length() * 0.04;
      for (let i = 0; i < t.particles; i++) {
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
      return;
    }
    const rng = mulberry32((Date.now() ^ (this.spawnCounter * 2654435761)) >>> 0);
    const kind = this.spawnKind();
    this.spawnCounter++;
    const body = this.sim.addBody({
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
    this.selectBody(body);
  }

  // ---------------------------------------------------------------------------
  // Input

  private ndc(e: PointerEvent | MouseEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1];
  }

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY, button: e.button };
      if (this.view === 'system' && this.tool === 'spawn' && e.button === 0) {
        const followed = this.system.followId !== undefined ? this.sim.getBody(this.system.followId) : undefined;
        const planeY = followed?.y ?? 0;
        const [x, y] = this.ndc(e);
        const point = this.system.planePoint(x, y, planeY);
        if (point) {
          this.spawnDrag = { start: point, current: point.clone(), planeY, lastPredict: 0 };
          c.setPointerCapture(e.pointerId);
          this.updateSpawnPreview(performance.now());
        }
      }
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.spawnDrag) return;
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
      if (moved > 5) return;
      const [x, y] = this.ndc(e);
      if (this.view === 'system' && this.tool === 'select') {
        this.selectBody(this.system.pick(x, y, this.width, this.height));
      } else if (this.view === 'galaxy') {
        this.selectStar(this.galaxy.pick(x, y, this.width, this.height));
      }
    });

    c.addEventListener('dblclick', (e) => {
      const [x, y] = this.ndc(e);
      if (this.view === 'galaxy') {
        const index = this.galaxy.pick(x, y, this.width, this.height);
        if (index >= 0) {
          this.selectStar(index);
          this.galaxy.flyTo(index);
        }
      } else if (this.tool === 'select') {
        const body = this.system.pick(x, y, this.width, this.height);
        if (body) {
          this.selectBody(body);
          this.system.follow(body.id);
        }
      }
    });

    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const key = e.key.toLowerCase();
      if (key === 'm') this.setView(this.view === 'galaxy' ? 'system' : 'galaxy');
      if (this.view === 'galaxy') {
        if (key === 'enter') this.enterSelectedStar();
        if (key === 'escape') this.selectStar(-1);
        return;
      }
      switch (key) {
        case ' ':
          e.preventDefault();
          this.setRunning(!this.running);
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
          if (this.spawnDrag) {
            this.spawnDrag = undefined;
            this.system.hideSpawnPreview();
          } else if (this.system.followId !== undefined) {
            this.system.follow(undefined);
          } else {
            this.selectBody(undefined);
          }
          break;
      }
    });
  }

  private toggleFollow(): void {
    const id = this.system.selectedId;
    if (id === undefined) return;
    this.system.follow(this.system.followId === id ? undefined : id);
  }

  private bindUi(): void {
    $('tab-galaxy').addEventListener('click', () => this.setView('galaxy'));
    $('tab-system').addEventListener('click', () => this.setView('system'));
    $('btn-play').addEventListener('click', () => this.setRunning(!this.running));

    // Galaxy
    $('btn-galaxy-go').addEventListener('click', () => this.buildGalaxy(seedFromString($<HTMLInputElement>('galaxy-seed').value || '1')));
    $<HTMLInputElement>('galaxy-seed').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.buildGalaxy(seedFromString((e.target as HTMLInputElement).value || '1'));
    });
    $('btn-galaxy-random').addEventListener('click', () => this.buildGalaxy(Math.floor(Math.random() * 1e9)));
    $('btn-star-fly').addEventListener('click', () => {
      if (this.galaxy.selectedIndex >= 0) this.galaxy.flyTo(this.galaxy.selectedIndex);
    });
    $('btn-star-enter').addEventListener('click', () => this.enterSelectedStar());
    $('btn-back').addEventListener('click', () => this.setView('galaxy'));

    // Presets
    const select = $<HTMLSelectElement>('preset-select');
    select.innerHTML =
      `<option value="" disabled>Generated system</option>` + PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
    select.addEventListener('change', () => {
      $('preset-desc').textContent = PRESETS.find((p) => p.id === select.value)?.description ?? '';
    });
    $('btn-preset-load').addEventListener('click', () => {
      const preset = PRESETS.find((p) => p.id === select.value);
      if (preset) this.loadScenario(() => preset.load(this.sim), preset.id);
    });
    $('btn-reset').addEventListener('click', () => {
      const presetId = select.value || undefined;
      const origin = this.galaxyBuilt && !presetId && this.galaxy.selectedIndex >= 0
        ? generateStarSystem(this.galaxy.data.stars.seeds[this.galaxy.selectedIndex])
        : undefined;
      this.loadScenario(this.scenario, presetId, origin);
    });

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

    // Simulation
    const ts = $<HTMLInputElement>('time-scale');
    ts.addEventListener('input', () => this.setTimeScale(Math.pow(10, Number(ts.value))));
    const grav = $<HTMLInputElement>('gravity');
    grav.addEventListener('input', () => {
      this.sim.gravityScale = Number(grav.value);
      this.sim.invalidate();
      $('gravity-out').textContent = this.sim.gravityScale.toFixed(2);
    });
    $<HTMLInputElement>('opt-collisions').addEventListener('change', (e) => (this.sim.collisions = (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-debris').addEventListener('change', (e) => (this.sim.debris = (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('opt-trails').addEventListener('change', (e) => {
      this.system.trailsEnabled = (e.target as HTMLInputElement).checked;
      if (this.system.trailsEnabled) this.system.clearTrails();
    });
    $<HTMLInputElement>('opt-labels').addEventListener('change', (e) => (this.system.labelsEnabled = (e.target as HTMLInputElement).checked));
    $('btn-clear-trails').addEventListener('click', () => this.system.clearTrails());
    $('btn-recenter').addEventListener('click', () => {
      this.sim.recenter();
      this.system.clearTrails();
    });

    // Body panel
    $('btn-follow').addEventListener('click', () => this.toggleFollow());
    $('btn-delete').addEventListener('click', () => this.deleteSelected());
    $('btn-mass-up').addEventListener('click', () => this.scaleSelectedMass(2));
    $('btn-mass-down').addEventListener('click', () => this.scaleSelectedMass(0.5));
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
    case 'blackhole':
      return 'Black hole';
  }
}

function formatRate(yearsPerSecond: number): string {
  if (yearsPerSecond < 1 / 12) return `${fmt(yearsPerSecond * 365.25)} d/s`;
  return `${fmt(yearsPerSecond)} yr/s`;
}

function describeSystem(spec: StarSystemSpec): string {
  const parts = [`${spec.star.spectralClass}-type star with ${spec.planets.length} planet${spec.planets.length === 1 ? '' : 's'}`];
  if (spec.belt) parts.push('an asteroid belt');
  if (spec.companion) parts.push(`a distant ${spec.companion.spectralClass}-type companion`);
  return `${parts.join(', ')}.`;
}
