import * as THREE from 'three';
import { mulberry32, pick } from '../procgen/rng';
import { kindForMass, mergedKind, NEUTRON_MAX_MASS, type Body, type BodyKind } from '../sim/body';
import { GAS_PALETTE, ROCKY_PALETTE } from '../sim/color';
import { circularOrbitVelocity } from '../sim/orbits';
import { predictPath } from '../sim/predict';
import { G } from '../sim/units';
import { toast } from '../ui/dom';
import { KMS } from '../game/challenges';
import { SpawnDrag } from './shared';
import type { App } from '../app';

/** The spawn tool: dragging out new bodies with a velocity. */
export class SpawnUI {
  constructor(private readonly app: App) {}

  spawnVelocity(drag: SpawnDrag): { velocity: THREE.Vector3; perUnit: number } {
    const p = drag.start;
    const followed = this.app.system.followId !== undefined ? this.app.sim.getBody(this.app.system.followId) : undefined;
    const dominant = this.app.sim.dominantBodyAt(p.x, p.y, p.z);
    const base = new THREE.Vector3();
    if (this.app.autoOrbit && dominant) {
      const v = circularOrbitVelocity(dominant, p.x, p.y, p.z, this.app.sim.gravityScale, this.app.spawnType.particles ? 0 : this.spawnMass());
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
      perUnit = Math.sqrt((G * Math.max(this.app.sim.gravityScale, 0.05) * dominant.mass) / (r * r * r));
    }
    const dragV = drag.current.clone().sub(drag.start).multiplyScalar(perUnit);
    return { velocity: base.add(dragV), perUnit };
  }

  spawnMass(): number {
    return this.app.spawnType.mass * this.app.spawnMassFactor;
  }

  spawnKind(): BodyKind {
    const t = this.app.spawnType;
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

  updateSpawnPreview(now: number): void {
    const drag = this.app.spawnDrag;
    if (!drag) return;
    const { velocity, perUnit } = this.spawnVelocity(drag);
    const kind = this.spawnKind();
    const radius = this.app.spawnType.particles ? 0 : this.app.sim.bodyRadius(kind, this.spawnMass());
    if (now - drag.lastPredict > 50) {
      drag.lastPredict = now;
      drag.path = predictPath(this.app.sim, {
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
    const dominant = this.app.sim.dominantBodyAt(drag.start.x, drag.start.y, drag.start.z);
    if (dominant) rel.sub(new THREE.Vector3(dominant.vx, dominant.vy, dominant.vz));
    this.app.system.showSpawnPreview(drag.start, radius, rel, 0.25 / perUnit, drag.path);
  }

  cancelSpawn(): void {
    this.app.spawnDrag = undefined;
    this.app.system.hideSpawnPreview();
  }

  commitSpawn(): void {
    const drag = this.app.spawnDrag;
    this.cancelSpawn();
    if (!drag) return;
    const { velocity } = this.spawnVelocity(drag);
    const t = this.app.spawnType;
    const p = drag.start;
    if (t.particles) {
      const count = t.particles;
      this.app.mutate('adding a dust cloud', () => {
        const dominant = this.app.sim.dominantBodyAt(p.x, p.y, p.z);
        const r = dominant ? Math.hypot(p.x - dominant.x, p.y - dominant.y, p.z - dominant.z) : 1;
        const size = Math.max(0.02, r * 0.06);
        const dispersion = velocity.clone().sub(dominant ? new THREE.Vector3(dominant.vx, dominant.vy, dominant.vz) : new THREE.Vector3()).length() * 0.04;
        for (let i = 0; i < count; i++) {
          const u = new THREE.Vector3().randomDirection().multiplyScalar(size * Math.cbrt(Math.random()));
          const shade = 0.7 + Math.random() * 0.4;
          this.app.sim.particles.add(
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
    if (this.app.challenge) {
      const max = this.app.challenge.def.rules.spawns ?? 0;
      if (this.app.challenge.st.spawns >= max) return void toast('No spawns left in this challenge');
      this.app.challenge.st.spawns++;
    }
    const rng = mulberry32((Date.now() ^ (this.app.spawnCounter * 2654435761)) >>> 0);
    const kind = this.spawnKind();
    this.app.spawnCounter++;
    let body: Body | undefined;
    const add = () => {
      body = this.app.sim.addBody({
        name: `${t.label} ${this.app.spawnCounter}`,
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
    if (this.app.challenge) {
      add();
      this.app.host.commit();
    } else {
      this.app.mutate(`spawning a ${t.label.toLowerCase()}`, add);
    }
    this.app.selectBody(body);
  }
}
