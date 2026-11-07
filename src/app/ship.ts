import { setTrueScale } from '../sim/trueScale';
import { type Body } from '../sim/body';
import { addOrbiting } from '../sim/presets';
import { ENGINES, KMS_TO_AU_YR, MS2_TO_AU_YR2, orbitAround, type Engine } from '../sim/spaceship';
import { SPACECRAFT_COLOR } from '../sim/spacecraft';
import { physicalRadius } from '../sim/body';
import { formatTime } from '../sim/units';
import { $, escapeHtml, toast } from '../ui/dom';
import type { App } from '../app';

/** Flying a spacecraft in the Sandbox: engines, thrust, autopilot and its panel (sim/spaceship.ts). */
export class ShipUI {
  constructor(private readonly app: App) {}

  selectedShip(): Body | undefined {
    const b = this.app.selectedBody();
    return b?.tag === 'ship' ? b : undefined;
  }

  shipEngine(): Engine {
    return ENGINES.find((e) => e.id === $<HTMLSelectElement>('ship-engine').value) ?? ENGINES[0];
  }

  /** The engine's acceleration at the current throttle (AU/yr²). */
  shipAccel(): number {
    return this.shipEngine().accel * MS2_TO_AU_YR2 * 10 ** Number($<HTMLInputElement>('ship-throttle').value);
  }

  /** A comfortable orbit around a body: three times its real radius (ships hit the real surface). */
  orbitRadiusAround(target: Body): number {
    return 3 * physicalRadius(target.kind, target.mass);
  }

  spawnShip(): void {
    if (this.app.sim.units !== 'au-yr') return void toast('Spaceships fly in planetary systems: load one first.');
    const sel = this.app.selectedBody();
    const parent =
      sel && sel.tag !== 'ship' && sel.tag !== 'probe' ? sel : (this.app.sim.bodies.find((b) => b.name === 'Earth') ?? [...this.app.sim.bodies].filter((b) => b.tag !== 'ship').sort((a, b) => b.mass - a.mass)[0]);
    if (!parent) return void toast('Add a planet or a star first.');
    const engine = this.shipEngine();
    const n = this.app.sim.bodies.filter((b) => b.tag === 'ship').length;
    const r = this.orbitRadiusAround(parent);
    let ship: Body | undefined;
    // Real sizes, so the ship's orbit is visible outside the planet (an enlarged Earth would be
    // wider than the whole region where Earth holds satellites).
    if (!this.app.sim.trueScale) {
      $<HTMLInputElement>('opt-truescale').checked = true;
      this.app.mutate('switching to real sizes', () => setTrueScale(this.app.sim, true));
    }
    this.app.mutate('launching a spaceship', () => {
      ship = addOrbiting(
        this.app.sim,
        parent,
        { name: n ? `Ship ${n + 1}` : 'Ship', mass: 1e-20, kind: 'rocky', color: SPACECRAFT_COLOR, tag: 'ship', ...(Number.isFinite(engine.deltaV) ? { fuel: engine.deltaV * KMS_TO_AU_YR } : {}) },
        { a: r, nu: Math.random() * Math.PI * 2 },
      );
    });
    if (!ship) return;
    this.app.selectBody(ship);
    this.app.system.follow(ship.id, r * 4);
    // Slow enough to see an orbit go round.
    const period = 2 * Math.PI * Math.sqrt(r ** 3 / (this.app.sim.effectiveG * parent.mass));
    this.app.setTimeScale(Math.min(this.app.timeScale, period / 20));
    this.app.setRunning(true);
    toast(`${ship.name} is in orbit around ${parent.name}. Hold the thrust buttons (or W/S, A/D, Q/E) to fly, or pick a target for the autopilot.`);
  }

  /** Thrust direction (unit vector, scene axes) relative to the body the ship orbits. */
  thrustVector(ship: Body, dir: string): [number, number, number] | undefined {
    const ref = this.app.sim.parentOf(ship);
    const rx = ship.x - (ref?.x ?? 0), ry = ship.y - (ref?.y ?? 0), rz = ship.z - (ref?.z ?? 0);
    const vx = ship.vx - (ref?.vx ?? 0), vy = ship.vy - (ref?.vy ?? 0), vz = ship.vz - (ref?.vz ?? 0);
    const unit = (x: number, y: number, z: number): [number, number, number] | undefined => {
      const l = Math.hypot(x, y, z);
      return l > 0 ? [x / l, y / l, z / l] : undefined;
    };
    switch (dir) {
      case 'prograde': return unit(vx, vy, vz);
      case 'retrograde': return unit(-vx, -vy, -vz);
      case 'out': return unit(rx, ry, rz);
      case 'in': return unit(-rx, -ry, -rz);
      case 'normal': return unit(ry * vz - rz * vy, rz * vx - rx * vz, rx * vy - ry * vx);
      case 'anti': return unit(-(ry * vz - rz * vy), -(rz * vx - rx * vz), -(rx * vy - ry * vx));
    }
    return undefined;
  }

  startShipThrust(dir: string): void {
    const ship = this.selectedShip();
    if (!ship) return;
    if (ship.fuel !== undefined && ship.fuel <= 0) return void toast('Out of fuel. Pick another engine to refuel.');
    if (this.app.sim.autopilot.has(ship.id)) this.app.host.setAutopilot(ship.id, undefined);
    this.app.shipThrustDir = dir;
    document.querySelectorAll<HTMLElement>('[data-thrust]').forEach((b) => b.classList.toggle('active', b.dataset.thrust === dir));
    if (!this.app.running) this.app.setRunning(true);
    this.tickShip();
  }

  stopShipThrust(): void {
    if (!this.app.shipThrustDir) return;
    this.app.shipThrustDir = undefined;
    document.querySelectorAll<HTMLElement>('[data-thrust]').forEach((b) => b.classList.remove('active'));
    for (const id of [...this.app.sim.thrust.keys()]) this.app.host.setThrust(id, undefined);
  }

  /** Each frame: keep the engine pointed (prograde turns as the ship moves) and update the readout. */
  tickShip(): void {
    const ship = this.selectedShip();
    if (this.app.shipThrustDir) {
      const d = ship && this.thrustVector(ship, this.app.shipThrustDir);
      if (!ship || !d) return this.stopShipThrust();
      const a = this.shipAccel();
      this.app.host.setThrust(ship.id, [d[0] * a, d[1] * a, d[2] * a]);
    }
  }

  updateShipPanel(): void {
    const ship = this.selectedShip();
    const flying = !!ship && this.app.view === 'system';
    $('ship-panel').classList.toggle('hidden', !flying);
    document.body.classList.toggle('ship-flying', flying);
    if (!ship) return;
    // Autopilot targets: everything else in the scene, the body it orbits first.
    const parent = this.app.sim.parentOf(ship);
    const options = this.app.sim.bodies.filter((b) => b !== ship && b.tag !== 'ship').sort((a, b) => (a === parent ? -1 : b === parent ? 1 : b.mass - a.mass));
    const select = $<HTMLSelectElement>('ship-target');
    const sig = options.map((o) => o.id).join(',');
    if (select.dataset.sig !== sig) {
      const prev = select.value;
      select.innerHTML = options.map((o) => `<option value="${o.id}">Orbit ${escapeHtml(o.name)}</option>`).join('');
      select.value = options.some((o) => String(o.id) === prev) ? prev : String(options[0]?.id ?? '');
      select.dataset.sig = sig;
    }
    const engine = this.shipEngine();
    $('ship-throttle-out').textContent = `${Math.round(10 ** Number($<HTMLInputElement>('ship-throttle').value) * 100)}%`;
    const on = this.app.sim.autopilot.get(ship.id);
    $('ship-autopilot').textContent = on ? 'Stop autopilot' : 'Autopilot: orbit';
    const km = (au: number) => (au < 0.01 ? `${Math.round(au * 1.495978707e8).toLocaleString('en-US')} km` : `${au.toFixed(au < 1 ? 3 : 2)} AU`);
    const lines: string[] = [];
    if (parent) {
      const o = orbitAround(ship, parent, this.app.sim.effectiveG);
      const R = physicalRadius(parent.kind, parent.mass);
      lines.push(`Around <b>${escapeHtml(parent.name)}</b>: ${km(Math.max(0, o.distance - R))} up · ${(o.speed / KMS_TO_AU_YR).toFixed(2)} km/s`);
      lines.push(
        o.apoapsis === Infinity
          ? `Escaping ${escapeHtml(parent.name)} (closest ${km(Math.max(0, o.periapsis - R))} up)`
          : o.periapsis < R
            ? `⚠ On a path into ${escapeHtml(parent.name)}: lowest point below the surface`
            : `Orbit ${km(o.periapsis - R)} × ${km(o.apoapsis - R)} up · one orbit takes ${formatTime(o.period ?? 0)}`,
      );
    }
    const fuel = ship.fuel === undefined ? 'unlimited Δv (hypothetical engine)' : `${(ship.fuel / KMS_TO_AU_YR).toFixed(2)} km/s of Δv left`;
    const thrust = this.app.sim.appliedThrust.get(ship.id) ?? this.app.sim.thrust.get(ship.id);
    const g = thrust ? Math.hypot(...thrust) / MS2_TO_AU_YR2 / 9.80665 : 0;
    const engineState = on ? `autopilot steering (up to ${(on.maxAccel / MS2_TO_AU_YR2 / 9.80665).toPrecision(2)} g)` : thrust ? `engine on: ${g >= 0.01 ? `${g.toFixed(2)} g` : `${(g * 9.80665 * 1000).toPrecision(2)} mm/s²`}` : 'engine off';
    lines.push(`${fuel} · ${engineState}${engine.hypothetical ? ' · <span class="fiction">hypothetical engine</span>' : ''}`);
    if (on) {
      const target = this.app.sim.getBody(on.target);
      if (target) lines.push(`Autopilot: into orbit around ${escapeHtml(target.name)}, ${km(Math.max(0, Math.hypot(ship.x - target.x, ship.y - target.y, ship.z - target.z) - physicalRadius(target.kind, target.mass)))} away`);
    }
    $('ship-readout').innerHTML = lines.join('<br>');
  }

  toggleAutopilot(): void {
    const ship = this.selectedShip();
    if (!ship) return;
    if (this.app.sim.autopilot.has(ship.id)) {
      this.app.host.setAutopilot(ship.id, undefined);
      toast('Autopilot off');
    } else {
      const target = this.app.sim.getBody(Number($<HTMLSelectElement>('ship-target').value));
      if (!target) return;
      if (ship.fuel !== undefined && ship.fuel <= 0) return void toast('Out of fuel. Pick another engine to refuel.');
      this.stopShipThrust();
      const maxAccel = this.shipAccel();
      this.app.host.setAutopilot(ship.id, { target: target.id, radius: this.orbitRadiusAround(target), maxAccel });
      if (!this.app.running) this.app.setRunning(true);
      // Speed time up so the flight (accelerate half way, brake the other half: 2√(d/a)) plays in ~25 s.
      const d = Math.hypot(ship.x - target.x, ship.y - target.y, ship.z - target.z);
      this.app.setTimeScale(Math.max(this.app.timeScale, (2 * Math.sqrt(d / maxAccel)) / 25));
      toast(`Autopilot: flying ${ship.name} into orbit around ${target.name}`);
    }
    this.updateShipPanel();
  }
}
