import * as THREE from 'three';
import { pulsarName } from '../sim/pulsars';
import { type GalaxyTarget } from '../render/galaxyView';
import { displayName } from '../sim/galaxies';
import { UNITS_PER_KPC } from '../procgen/galaxy';
import { $, escapeHtml, toast } from '../ui/dom';
import { autoWarp, formatDuration, formatSpeed as formatTravelSpeed, lorentz, SPEEDS, Trip, tripTimes } from '../sim/travel';
import { setObserverVelocity } from '../render/relativity';
import { AUTO_ENTER_DISTANCE, formatLy } from './shared';
import type { App } from '../app';

/** Travel at any speed through the Galaxy Map and the Universe (sim/travel.ts). */
export class TravelUI {
  constructor(private readonly app: App) {}

  travelling(): boolean {
    return $<HTMLInputElement>('travel-on').checked;
  }

  /** Camera, controls and scale (map units per light-year) of the Galaxy Map or the Universe tab. */
  navOf(view: 'galaxy' | 'cosmos') {
    return view === 'galaxy'
      ? { camera: this.app.galaxy.camera, controls: this.app.galaxy.controls, unitsPerLy: UNITS_PER_KPC / 3261.56, cancel: () => this.app.galaxy.cancelFlight() }
      : { camera: this.app.cosmos.camera, controls: this.app.cosmos.controls, unitsPerLy: 1 / 3.26156e6, cancel: () => this.app.cosmos.cancelFlight() };
  }

  targetName(t: GalaxyTarget): string {
    if (t === 'core') return 'the Galactic Centre';
    if (t === 'sol') return 'the Sun';
    if (typeof t === 'object' && 'bh' in t) return this.app.blackHoleList[t.bh]?.name ?? 'the black hole';
    if (typeof t === 'object' && 'obj' in t) return this.app.galacticObjectList[t.obj]?.name ?? 'the star';
    if (typeof t === 'object') return 'psr' in t ? (this.app.pulsarMapList[t.psr] ? pulsarName(this.app.pulsarMapList[t.psr]) : 'the pulsar') : (this.app.exoMapHosts[t.exo]?.name ?? 'the star');
    return this.app.galaxy.data.names[t];
  }

  /** To a point on the Galaxy Map: a quick flight, or a trip at the chosen speed. */
  goGalaxyPoint(pos: THREE.Vector3, distance: number, name: string): void {
    if (this.travelling()) this.startTrip('galaxy', pos, distance, name);
    else {
      this.app.galaxy.flyToPoint(pos, distance);
      toast(`Flying to ${name}`);
    }
  }

  goGalaxyTarget(t: GalaxyTarget): void {
    // Stop just outside the distance that enters a star's system, so arriving doesn't jump in.
    if (this.travelling()) this.startTrip('galaxy', this.app.galaxy.targetPosition(t), AUTO_ENTER_DISTANCE * 1.6, this.targetName(t));
    else this.app.galaxy.flyTo(t);
  }

  goCosmosPoint(pos: THREE.Vector3, distance: number, name: string): void {
    if (this.travelling()) this.startTrip('cosmos', pos, distance, name);
    else {
      this.app.cosmos.flyToPoint(pos, distance);
      toast(`Flying to ${name}`);
    }
  }

  goCosmosGalaxy(index: number): void {
    // Arriving at a quarter of the viewing distance would enter the galaxy; stop at the viewing distance.
    if (this.travelling()) this.startTrip('cosmos', this.app.cosmos.position(index), this.app.cosmos.viewDistance(index), displayName(this.app.cosmos.local[index]));
    else this.app.cosmos.flyTo(index);
  }

  /** Start a trip to `dest` (stopping `stop` map units short), or cruise straight ahead with no destination. */
  startTrip(view: 'galaxy' | 'cosmos', dest: THREE.Vector3 | undefined, stop: number, name: string): void {
    const nav = this.navOf(view);
    nav.cancel();
    let dir: THREE.Vector3;
    let remainingLy = Infinity;
    if (dest) {
      nav.controls.target.copy(dest);
      dir = dest.clone().sub(nav.camera.position);
      remainingLy = Math.max(0, dir.length() - stop) / nav.unitsPerLy;
      dir.normalize();
      if (remainingLy <= 0) {
        toast(`Already at ${name}`);
        return;
      }
    } else {
      dir = nav.controls.target.clone().sub(nav.camera.position).normalize();
    }
    const speed = SPEEDS[Number($<HTMLSelectElement>('travel-speed').value)] ?? SPEEDS[0];
    const warpChoice = $<HTMLSelectElement>('travel-warp').value;
    // Auto: arrive in about 25 s; cruising, cover 300 light-years (galaxy) or 3 million (universe) per second.
    const warp = warpChoice !== 'auto' ? Number(warpChoice) : Number.isFinite(remainingLy) ? autoWarp(remainingLy, speed.c) : autoWarp(view === 'galaxy' ? 300 : 3e6, speed.c, 1);
    this.app.trip = { trip: new Trip(speed.c, warp, remainingLy), view, dir, dest: dest?.clone(), stop, name, hudTimer: 0 };
    $('travel-hud').classList.remove('hidden');
    $('travel-cruise').textContent = 'Stop ■';
    this.renderTripHud();
  }

  stopTrip(message?: string): void {
    const t = this.app.trip;
    this.app.trip = undefined;
    setObserverVelocity(this.app.galaxy.camera, undefined, 0);
    $('travel-hud').classList.add('hidden');
    $('travel-cruise').textContent = 'Cruise ▶';
    if (t && message) toast(message);
  }

  /** Each frame of a trip: move the camera, update the relativistic view and the clocks. */
  tickTrip(dt: number): void {
    const t = this.app.trip;
    if (!t) return;
    if (this.app.view !== t.view) {
      this.stopTrip();
      return;
    }
    const nav = this.navOf(t.view);
    if (t.dest) {
      // Head for the destination even if the view was turned on the way.
      t.dir.copy(t.dest).sub(nav.camera.position);
      t.trip.remainingLy = Math.max(0, t.dir.length() - t.stop) / nav.unitsPerLy;
      t.dir.normalize();
    }
    const { ly, arrived } = t.trip.step(Math.min(dt, 0.5));
    const delta = t.dir.clone().multiplyScalar(ly * nav.unitsPerLy);
    nav.camera.position.add(delta);
    if (!t.dest) nav.controls.target.add(delta);
    setObserverVelocity(nav.camera, t.dir, t.trip.speed <= 1 ? t.trip.speed : 0);
    t.hudTimer -= dt;
    if (t.hudTimer <= 0) {
      t.hudTimer = 0.2;
      this.renderTripHud();
    }
    if (arrived) {
      const ship = t.trip.speed <= 1 ? `, ${formatDuration(t.trip.shipYears)} on board` : '';
      this.stopTrip(`Arrived at ${t.name}: ${formatLy(t.trip.coveredLy)} in ${formatDuration(t.trip.earthYears)} of Earth time${ship}.`);
    }
  }

  renderTripHud(): void {
    const t = this.app.trip;
    if (!t) return;
    const c = t.trip.speed;
    const g = lorentz(c);
    const speed = `<b>${formatTravelSpeed(c)}</b>${g !== undefined && Number.isFinite(g) && g > 1.0001 ? ` · γ = ${g < 10 ? g.toFixed(3) : g.toFixed(1)}` : ''}`;
    const fiction = c > 1 ? ' · <span class="fiction">faster than light is not possible: shown as a camera speed</span>' : c === 1 ? ' · <span class="fiction">only light moves this fast</span>' : '';
    const left = Number.isFinite(t.trip.remainingLy)
      ? `To ${escapeHtml(t.name)}: ${formatLy(t.trip.remainingLy)} left, ${formatDuration(t.trip.remainingLy / c)} more${c <= 1 ? ` (${formatDuration(tripTimes(t.trip.remainingLy, c).shipYears ?? 0)} on board)` : ''}`
      : `Cruising · ${formatLy(t.trip.coveredLy)} so far`;
    const clocks = `Earth time ${formatDuration(t.trip.earthYears)}${c <= 1 ? ` · your time ${formatDuration(t.trip.shipYears)}` : ''} · time warp ×${t.trip.warp.toLocaleString('en-US', { maximumSignificantDigits: 3 })}`;
    $('travel-hud').innerHTML = `${speed}${fiction}<br>${left}<br>${clocks}`;
  }
}
