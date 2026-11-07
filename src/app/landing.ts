import * as THREE from 'three';
import { type Body } from '../sim/body';
import { $, toast } from '../ui/dom';
import type { App } from '../app';

/** Standing on a planet's surface (render/lander.ts): landing, taking off and the on-surface HUD. */
export class LandingUI {
  constructor(private readonly app: App) {}

  landOnSelected(): void {
    const body = this.app.selectedBody();
    if (!body) return;
    let sun: Body | undefined;
    for (const b of this.app.sim.bodies) if (b.kind === 'star' && (!sun || b.mass > sun.mass)) sun = b;
    const why = this.app.system.land(body.id, sun);
    if (why) return void toast(why);
    document.body.classList.add('landed');
    $('land-hud').classList.remove('hidden');
    // Ten minutes a second: a day goes by in a few minutes.
    this.app.timeBeforeLanding ??= this.app.timeScale;
    this.app.setTimeScale(1 / (8766 * 6));
    toast(`Standing on ${body.name}. Drag to look around, WASD to walk.`);
    this.updateLandHud();
  }

  takeOff(): void {
    this.app.system.takeOff();
    if (this.app.timeBeforeLanding !== undefined) this.app.setTimeScale(this.app.timeBeforeLanding);
    this.app.timeBeforeLanding = undefined;
    document.body.classList.remove('landed');
    $('land-hud').classList.add('hidden');
  }

  updateLandHud(): void {
    const body = this.app.system.landedOn;
    if (!body) {
      if (document.body.classList.contains('landed')) this.takeOff();
      return;
    }
    const { lat, lon } = this.app.system.lander.position;
    let sun: Body | undefined;
    for (const b of this.app.sim.bodies) if (b.kind === 'star' && (!sun || b.mass > sun.mass)) sun = b;
    const mesh = this.app.system.planetMeshOf(body.id);
    let time = '';
    if (sun && mesh) {
      const local = mesh.worldToLocal(new THREE.Vector3(sun.x, sun.y, sun.z)).normalize();
      const h = this.app.system.lander.localTime(local);
      time = ` · local time ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    }
    const text = `🛬 ${body.name} · ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}${time}`;
    if ($('land-info').textContent !== text) $('land-info').textContent = text;
  }
}
