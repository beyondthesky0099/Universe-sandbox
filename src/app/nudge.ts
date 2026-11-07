import * as THREE from 'three';
import { type Body } from '../sim/body';
import { predictPath } from '../sim/predict';
import { G } from '../sim/units';
import { $, toast } from '../ui/dom';
import { applyNudge, KMS } from '../game/challenges';
import type { App } from '../app';

/** The nudge tool: dragging a body to change its velocity. */
export class NudgeUI {
  constructor(private readonly app: App) {}

  canNudge(body: Body): boolean {
    if (!this.app.challenge) return true;
    return body.tag === 'pushable' || body.tag === 'probe';
  }

  nudgeVector(drag: NonNullable<App['nudgeDrag']>, body: Body): THREE.Vector3 {
    const parent = this.app.sim.parentOf(body);
    let perUnit = 1;
    if (parent) {
      const r = Math.max(1e-3, Math.hypot(body.x - parent.x, body.y - parent.y, body.z - parent.z));
      perUnit = Math.sqrt((G * Math.max(this.app.sim.gravityScale, 0.05) * parent.mass) / (r * r * r)) * 0.5;
    }
    const dv = drag.current.clone().sub(drag.start).multiplyScalar(perUnit);
    const max = this.app.challenge?.def.rules.maxDvKms;
    let limit = max !== undefined && body.tag !== 'probe' ? max * KMS : Infinity;
    if (body.fuel !== undefined) limit = Math.min(limit, body.fuel);
    if (dv.length() > limit) dv.setLength(limit);
    return dv;
  }

  updateNudgePreview(now: number): void {
    const drag = this.app.nudgeDrag;
    const body = drag && this.app.sim.getBody(drag.bodyId);
    if (!drag || !body) return this.cancelNudge();
    drag.start.set(body.x, body.y, body.z);
    const dv = this.nudgeVector(drag, body);
    if (now - drag.lastPredict > 60) {
      drag.lastPredict = now;
      drag.path = predictPath(this.app.sim, { mass: body.mass, kind: body.kind, radius: body.radius, x: body.x, y: body.y, z: body.z, vx: body.vx + dv.x, vy: body.vy + dv.y, vz: body.vz + dv.z }, 500, 8, body.id);
    }
    const parent = this.app.sim.parentOf(body);
    const perUnit = parent ? Math.sqrt((G * parent.mass) / Math.max(1e-9, Math.hypot(body.x - parent.x, body.z - parent.z) ** 3)) * 0.5 : 1;
    this.app.system.showSpawnPreview(drag.start, 0, dv, 1 / perUnit, drag.path);
    $('hint').textContent = `Push ${body.name}: ${(dv.length() / KMS).toFixed(2)} km/s · release to apply`;
  }

  cancelNudge(): void {
    if (!this.app.nudgeDrag) return;
    this.app.nudgeDrag = undefined;
    this.app.system.hideSpawnPreview();
    this.app.updateHint();
  }

  commitNudge(): void {
    const drag = this.app.nudgeDrag;
    const body = drag && this.app.sim.getBody(drag.bodyId);
    this.cancelNudge();
    if (!drag || !body) return;
    const dv = this.nudgeVector(drag, body);
    if (dv.length() < 1e-9) return;
    let used = 0;
    this.app.mutateGame(`nudging ${body.name}`, () => {
      used = applyNudge(body, [dv.x, dv.y, dv.z]);
    });
    if (this.app.challenge) {
      if (body.tag !== 'probe') this.app.challenge.st.pushes++;
      this.app.challenge.st.dvUsed += used;
    }
    toast(`Pushed ${body.name} by ${(used / KMS).toFixed(2)} km/s`);
  }
}
