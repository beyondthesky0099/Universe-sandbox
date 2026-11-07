import * as THREE from 'three';
import { getSolarData, poleScene } from '../sim/solarSystemData';
import { PRESETS } from '../sim/presets';
import { $, escapeHtml, toast } from '../ui/dom';
import { BUILT_IN_PLACES, encodePlace, newId, placeSummary, type Place, type Vec3 } from '../ui/places';
import type { App } from '../app';

/** Places: saving viewpoints in every view, going back to them and sharing them as links (ui/places.ts). */
export class PlacesUI {
  constructor(private readonly app: App) {}

  openPlaces(): void {
    $('places-overlay').classList.remove('hidden');
    const input = $<HTMLInputElement>('place-name');
    input.value = '';
    input.placeholder = `Name this view (${this.suggestPlaceName()})`;
    this.renderPlaces();
  }

  closePlaces(): void {
    $('places-overlay').classList.add('hidden');
    $<HTMLInputElement>('place-name').blur();
  }

  /** A default name: the followed body, the selected star or galaxy, or the view. */
  suggestPlaceName(): string {
    if (this.app.view === 'system') {
      const b = this.app.system.followId !== undefined ? this.app.sim.getBody(this.app.system.followId) : undefined;
      return b ? `Near ${b.name}` : this.app.scenario.name;
    }
    if (this.app.view === 'sky') return `Sky from ${$<HTMLInputElement>('sky-lat').value}°, ${$<HTMLInputElement>('sky-lon').value}°`;
    if (this.app.view === 'galaxy') {
      const t = this.app.galaxy.selected;
      if (typeof t === 'number' && t >= 0) return this.app.galaxy.data.names[t];
      return this.app.galaxyOrigin;
    }
    const i = this.app.cosmos.selected;
    return i >= 0 ? `Near ${this.app.cosmos.local[i]?.name ?? 'a galaxy'}` : 'The Universe';
  }

  /** The current viewpoint as a place. */
  capturePlace(name: string): Place {
    const v3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
    const base = { id: newId(), name, created: Date.now() };
    if (this.app.view === 'sky') {
      const look = this.app.sky.look;
      return { ...base, fov: look.fov, view: { kind: 'sky', date: this.app.skyDate.toISOString(), lat: Number($<HTMLInputElement>('sky-lat').value), lon: Number($<HTMLInputElement>('sky-lon').value), alt: look.alt, az: look.az } };
    }
    if (this.app.view === 'galaxy') return { ...base, view: { kind: 'galaxy', seed: this.app.galaxySeed, origin: this.app.galaxyOrigin, camera: v3(this.app.galaxy.camera.position), target: v3(this.app.galaxy.controls.target) } };
    if (this.app.view === 'cosmos') return { ...base, view: { kind: 'cosmos', camera: v3(this.app.cosmos.camera.position), target: v3(this.app.cosmos.controls.target) } };
    const cam = this.app.system.camera.position;
    const target = this.app.system.controls.target;
    const followed = this.app.system.followId !== undefined ? this.app.sim.getBody(this.app.system.followId) : undefined;
    if (followed) {
      // Relative to the body, in its radii: still right after it has moved on its orbit.
      const c = new THREE.Vector3(followed.x, followed.y, followed.z);
      const rel = (v: THREE.Vector3) => v3(v.clone().sub(c).divideScalar(followed.radius));
      return { ...base, view: { kind: 'system', scenario: this.app.scenario.name, presetId: this.app.scenario.presetId, follow: followed.name, camera: rel(cam), target: rel(target) } };
    }
    return { ...base, view: { kind: 'system', scenario: this.app.scenario.name, presetId: this.app.scenario.presetId, camera: v3(cam), target: v3(target) } };
  }

  async goToPlace(p: Place): Promise<void> {
    this.closePlaces();
    const v = p.view;
    const set = (camera: THREE.PerspectiveCamera, controls: { target: THREE.Vector3; update(): void }, c: Vec3, t: Vec3) => {
      controls.target.set(...t);
      camera.position.set(...c);
      controls.update();
    };
    switch (v.kind) {
      case 'search': {
        const index = await this.app.searchUI.buildSearchIndex();
        const top = index.search(v.query, 1)[0];
        if (top) await this.app.searchUI.goToSearchResult(top);
        else toast(`Couldn't find ${v.query}.`);
        return;
      }
      case 'sky': {
        await this.app.skyUI.openSky();
        this.app.skyDate = new Date(v.date);
        this.app.skyUI.setSkyTimeInput();
        this.app.skyUI.setSkyPlace(v.lat, v.lon);
        this.app.sky.lookAt(v.alt, v.az);
        if (p.fov) this.app.sky.setFov(p.fov);
        this.app.sky.setTime(this.app.skyDate);
        break;
      }
      case 'galaxy': {
        if (!this.app.galaxyBuilt || this.app.galaxySeed !== v.seed) this.app.galaxyMapUI.buildGalaxy(v.seed);
        if (this.app.view !== 'galaxy') await this.app.switchView('galaxy');
        this.app.galaxy.cancelFlight();
        set(this.app.galaxy.camera, this.app.galaxy.controls, v.camera, v.target);
        break;
      }
      case 'cosmos': {
        if (this.app.view !== 'cosmos') await this.app.cosmosUI.openCosmos(this.app.view === 'galaxy');
        this.app.cosmos.cancelFlight();
        set(this.app.cosmos.camera, this.app.cosmos.controls, v.camera, v.target);
        break;
      }
      case 'system': {
        if (this.app.view !== 'system') await this.app.switchToSandbox();
        const preset = v.presetId ? PRESETS.find((q) => q.id === v.presetId) : undefined;
        if (preset && this.app.scenario.presetId !== preset.id) this.app.loadScenario({ name: preset.name, load: () => preset.load(this.app.sim), presetId: preset.id });
        else if (!preset && this.app.scenario.name !== v.scenario) toast(`This place was saved in “${v.scenario}”, which isn't loaded: showing the same viewpoint here.`);
        this.app.system.stopCameraAnimation();
        const body = v.follow ? this.app.sim.bodies.find((b) => b.name === v.follow) : undefined;
        if (v.follow && !body) {
          toast(`${v.follow} isn't in this scene any more.`);
          break;
        }
        if (body) {
          const c = new THREE.Vector3(body.x, body.y, body.z);
          const offset = new THREE.Vector3(...v.camera);
          const solar = getSolarData()?.byName.get(body.name);
          const pole = v.poleFrame && solar ? poleScene(solar) : undefined;
          if (pole) offset.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...pole)));
          let camera = offset.multiplyScalar(body.radius).add(c);
          const other = v.lookAt ? this.app.sim.bodies.find((b) => b.name === v.lookAt) : undefined;
          if (other) {
            // Behind the body, looking past it at the other one, raised so the other one shows
            // just above its limb.
            const dir = c.clone().sub(new THREE.Vector3(other.x, other.y, other.z)).normalize();
            const up = new THREE.Vector3(0, 1, 0).projectOnPlane(dir).normalize();
            const distance = v.distance ?? 6;
            const tilt = Math.asin(1 / distance) * 1.6;
            camera = c.clone().addScaledVector(dir.multiplyScalar(Math.cos(tilt)).addScaledVector(up, Math.sin(tilt)), body.radius * distance);
          }
          const target = new THREE.Vector3(...v.target).multiplyScalar(body.radius).add(c);
          this.app.system.controls.target.copy(target);
          this.app.system.camera.position.copy(camera);
          this.app.system.controls.update();
          // Hold still: the view lines up with the other body only for a moment.
          if (other && this.app.running) {
            this.app.setRunning(false);
            toast('Paused to hold the view: press Space to carry on.');
          }
          this.app.selectBody(body);
          this.app.system.follow(body.id, camera.distanceTo(target));
        } else {
          this.app.system.follow(undefined);
          set(this.app.system.camera, this.app.system.controls, v.camera, v.target);
        }
        break;
      }
    }
    if (p.fov && this.app.photo.active && v.kind !== 'sky') {
      this.app.photo.setFov(p.fov);
      $<HTMLInputElement>('photo-fov').value = String(Math.round(p.fov));
      $('photo-fov-val').textContent = `${Math.round(p.fov)}°`;
    }
    toast(`📍 ${p.name}`);
  }

  renderPlaces(): void {
    const item = (p: Place, own: boolean) =>
      `<li tabindex="0" data-id="${escapeHtml(p.id)}"><span class="place-name">${escapeHtml(p.name)}</span><span class="place-detail">${escapeHtml(placeSummary(p))}</span>` +
      (own ? `<span class="place-actions"><button data-act="link" title="Copy a link to this place">🔗</button><button data-act="rename" title="Rename">✎</button><button data-act="delete" title="Delete">🗑</button></span>` : '') +
      '</li>';
    const mine = this.app.places.places;
    $('place-list').innerHTML = mine.map((p) => item(p, true)).join('');
    $('place-empty').classList.toggle('hidden', mine.length > 0);
    $('place-builtins').innerHTML = BUILT_IN_PLACES.map((p) => item(p, false)).join('');
  }

  async copyPlaceLink(p: Place): Promise<void> {
    const url = `${location.origin}${location.pathname}#tour=0&place=${encodePlace(p)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied: it opens this view.');
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  bindPlaces(): void {
    $('btn-places').addEventListener('click', () => this.openPlaces());
    $('places-close').addEventListener('click', () => this.closePlaces());
    $('places-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closePlaces();
    });
    $('place-save').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $<HTMLInputElement>('place-name');
      const place = this.capturePlace(input.value.trim() || this.suggestPlaceName());
      this.app.places.add(place);
      input.value = '';
      this.renderPlaces();
      toast(`Saved “${place.name}”.`);
    });
    const onList = (e: Event, own: boolean) => {
      const li = (e.target as HTMLElement).closest('li[data-id]') as HTMLElement | null;
      if (!li) return;
      const id = li.dataset.id!;
      const place = (own ? this.app.places.places : BUILT_IN_PLACES).find((p) => p.id === id);
      if (!place) return;
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      if (act === 'delete') {
        this.app.places.remove(id);
        this.renderPlaces();
      } else if (act === 'rename') {
        const name = window.prompt('New name:', place.name);
        if (name) {
          this.app.places.rename(id, name);
          this.renderPlaces();
        }
      } else if (act === 'link') {
        void this.copyPlaceLink(place);
      } else {
        void this.goToPlace(place);
      }
    };
    for (const [id, own] of [['place-list', true], ['place-builtins', false]] as const) {
      $(id).addEventListener('click', (e) => onList(e, own));
      $(id).addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' && (e.target as HTMLElement).tagName === 'LI') onList(e, own);
      });
    }
  }
}
