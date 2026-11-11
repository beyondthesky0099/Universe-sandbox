import { describeFate, stellarFate } from '../sim/stellarFate';
import { getSolarData } from '../sim/solarSystemData';
import { esiLabel, exoplanetArchiveUrl, planetFacts, wikipediaUrl } from '../sim/planetFacts';
import { horizonRadius, iscoRadius, radiativeEfficiency } from '../sim/kerr';
import { neutronFacts } from '../sim/neutronStar';
import { stellarFlux } from '../sim/climate';
import { isCompact, mainSequenceLifetime, type Body } from '../sim/body';
import { isTidallyLocked, nearResonance, orbitalPeriod } from '../sim/analysis';
import { bodyTemperature, climateFor, formatTemperature, isHabitable } from '../sim/climate';
import { starTemperature } from '../sim/color';
import { forecast, type Forecast } from '../sim/forecast';
import { EARTH_MASS, fmt, formatDistance, formatKm, formatMass, formatSpeed, formatTime, setDisplayUnits } from '../sim/units';
import { $, escapeHtml, setFacts, toast } from '../ui/dom';
import { applyNudge, KMS } from '../game/challenges';
import { burnDirections, planHohmann } from '../game/transfer';
import { kindLabel, formatAge, capitalize } from './shared';
import type { App } from '../app';

/** The selected body's panel: facts, alerts, the "More about" section, forecasts and probe burns. */
export class BodyPanelUI {
  constructor(private readonly app: App) {}

  updateForecast(): void {
    const body = this.app.selectedBody();
    if (!body) return;
    const parent = this.app.sim.parentOf(body);
    let horizon = 10;
    if (parent) {
      const mu = this.app.sim.effectiveG * (parent.mass + body.mass);
      const r = Math.hypot(body.x - parent.x, body.y - parent.y, body.z - parent.z);
      const v2 = (body.vx - parent.vx) ** 2 + (body.vy - parent.vy) ** 2 + (body.vz - parent.vz) ** 2;
      const energy = v2 / 2 - mu / r;
      if (energy < 0 && mu > 0) {
        const a = -mu / (2 * energy);
        horizon = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
      }
    }
    horizon = Math.min(Math.max(horizon, 0.05), 200);
    this.app.forecastResult = forecast(this.app.sim, body.id, horizon, 25, 6000);
    this.app.system.showApproach(this.app.forecastResult.impact ?? this.closeApproach(this.app.forecastResult));
  }

  /** Closest approach worth highlighting (close relative to the bodies' sizes). */
  closeApproach(f: Forecast) {
    const a = f.closest;
    if (!a) return undefined;
    const body = this.app.selectedBody();
    const other = this.app.sim.getBody(a.otherId);
    if (!body || !other) return undefined;
    return a.distance < 25 * (body.radius + other.radius) ? a : undefined;
  }

  updateSystemHud(): void {
    setDisplayUnits(this.app.sim.units);
    $('sim-time').textContent = formatTime(this.app.sim.time);
    const status = this.app.host.getStatus();
    $('lag').classList.toggle('hidden', !status.lagging);
    const n = this.app.sim.bodies.length;
    $('stats').textContent = `${Math.round(this.app.fps)} fps · ${n.toLocaleString()} bodies · ${this.app.sim.particles.count.toLocaleString()} particles`;
    $('engine-info').textContent = `Physics: ${status.threaded ? 'Web Worker' : 'main thread'}${status.cores > 1 ? ` · ${status.cores} CPU cores for particles` : ''} · Gravity: ${status.usingTree ? 'Barnes–Hut tree' : 'direct N²'}`;
    // The selected body may have merged, shattered or been torn apart since last frame.
    if (this.app.selectedBody()) this.updateBodyPanel();
    else if (!$('body-panel').classList.contains('hidden')) this.app.hideBodyPanel();
    const followed = this.app.system.followId !== undefined && this.app.system.followId === this.app.system.selectedId;
    $('btn-follow').textContent = followed ? 'Unfollow' : 'Follow';
  }

  /**
   * The "More about" section: physical facts worked out from mass, size and orbit (measured
   * values for real bodies), the Earth Similarity Index and links to read more.
   */
  updateBodyWiki(body: Body, craft: boolean, parent: Body | undefined): void {
    const box = $('body-wiki');
    const planetLike = !craft && (body.kind === 'rocky' || body.kind === 'gas') && body.tag !== 'galaxy';
    box.classList.toggle('hidden', !planetLike);
    $('body-wiki-name').textContent = body.name;
    // Only worked out while the section is open.
    if (!planetLike || !(box as HTMLDetailsElement).open) return;
    // Measured data, if this is the real body (and its mass hasn't been changed).
    const solar = getSolarData()?.byName.get(body.name);
    const real = solar?.mass && Math.abs(body.mass / solar.mass - 1) < 0.01 ? solar : undefined;
    const origin = this.app.scenario.origin;
    const exo = origin?.kind === 'exo' ? origin.host.planets.find((p) => p.name === body.name) : undefined;
    const exoReal = exo && Math.abs(body.mass / (exo.massEarth * EARTH_MASS) - 1) < 0.01 ? exo : undefined;
    const radiusKm = real?.radiusKm ?? (exoReal?.radiusEarth ? exoReal.radiusEarth * 6371 : undefined);
    const distance = parent ? Math.hypot(body.x - parent.x, body.y - parent.y, body.z - parent.z) : undefined;
    const f = planetFacts({
      kind: body.kind,
      mass: body.mass,
      radiusKm,
      albedo: real?.albedo,
      flux: stellarFlux(this.app.sim.bodies, body.x, body.y, body.z, body),
      surfaceK: bodyTemperature(this.app.sim.bodies, body),
      parentMass: parent?.mass,
      distance,
    });
    const me = body.mass / EARTH_MASS;
    const rows: [string, string][] = [
      [f.radiusEstimated ? 'Radius (from mass)' : 'Radius', `${f.radiusEstimated ? '≈ ' : ''}${Math.round(f.radiusKm).toLocaleString('en-US')} km (${fmt(f.radiusKm / 6371)} R⊕)`],
      ['Surface gravity', `${f.gravity.toFixed(f.gravity < 1 ? 2 : 1)} m/s² (${fmt(f.gravity / 9.80665)} g)`],
      ['Escape velocity', `${f.escapeKms.toFixed(f.escapeKms < 1 ? 2 : 1)} km/s`],
      ['Mean density', `${f.density.toFixed(2)} g/cm³`],
    ];
    if (exoReal?.massEstimated) rows.push(['Mass', `${fmt(me)} Earth masses (estimated from its radius)`]);
    if (real?.rotationHours) {
      const h = real.rotationHours;
      rows.push(['Day (rotation)', `${h < 48 ? `${h.toFixed(1)} hours` : `${fmt(h / 24)} days`}${real.retrograde ? ', backwards' : ''}`]);
    } else if (real?.synchronous) {
      rows.push(['Day (rotation)', 'Same as its orbit (tidally locked)']);
    }
    if (real?.obliquityDeg !== undefined) rows.push(['Axial tilt', `${real.obliquityDeg.toFixed(1)}°`]);
    if (f.insolation > 1e-6) rows.push(['Starlight', `${fmt(f.insolation)}× Earth's`], ['Equilibrium temp.', `${Math.round(f.equilibriumK)} K${real?.albedo !== undefined ? ` (albedo ${real.albedo})` : ''}`]);
    if (exoReal?.eqTempK) rows.push(['Measured eq. temp.', `${Math.round(exoReal.eqTempK)} K`]);
    if (exoReal?.year) rows.push(['Discovered', String(exoReal.year)]);
    if (f.hillAU && parent) rows.push([`Hill sphere`, `${formatDistance(f.hillAU)} (moons can orbit within ~⅓ of it)`]);
    setFacts($('body-wiki-facts'), rows);
    const p = f.esiParts;
    const esiHtml = `<div class="esi" title="Earth Similarity Index (Schulze-Makuch et al. 2011): 1 is Earth. It compares size, density, escape velocity and temperature, not habitability."><div>Earth Similarity Index <b>${f.esi.toFixed(2)}</b> · ${esiLabel(f.esi)}</div><div class="esi-bar"><span style="width:${(f.esi * 100).toFixed(1)}%"></span></div><div class="esi-parts">size ${p.radius.toFixed(2)} · density ${p.density.toFixed(2)} · escape ${p.escape.toFixed(2)} · temperature ${p.temperature.toFixed(2)}</div></div>`;
    const esiEl = $('body-wiki-esi');
    if (esiEl.innerHTML !== esiHtml) esiEl.innerHTML = esiHtml;
    const links: string[] = [];
    if (real) links.push(`<a href="${wikipediaUrl(body.name, real.kind === 'moon')}" target="_blank" rel="noopener">Wikipedia ↗</a>`);
    if (origin?.kind === 'exo' && exo) links.push(`<a href="${exoplanetArchiveUrl(origin.host.name)}" target="_blank" rel="noopener">NASA Exoplanet Archive ↗</a>`);
    if (!real && !exoReal) links.push('<span class="muted">Modelled values: size from mass, temperature from starlight.</span>');
    const linkHtml = links.join(' · ');
    const linkEl = $('body-wiki-links');
    if (linkEl.innerHTML !== linkHtml) linkEl.innerHTML = linkHtml;
  }

  updateBodyPanel(): void {
    const body = this.app.selectedBody();
    if (!body) return;
    this.app.shipUI.updateShipPanel();
    $('body-name').textContent = body.name;
    // Spacecraft (probes and ships) are test particles: no meaningful mass, size, climate or tides.
    const craft = body.tag === 'ship' || body.tag === 'probe';
    $('btn-mass-down').parentElement!.classList.toggle('hidden', craft);
    const facts: [string, string][] = craft
      ? [['Type', kindLabel(body)]]
      : [
          ['Type', kindLabel(body)],
          ['Mass', formatMass(body.mass)],
          [this.app.sim.trueScale ? 'Radius' : 'Radius (enlarged)', this.app.sim.trueScale ? formatKm(body.radius) : formatDistance(body.radius)],
        ];
    const alerts: string[] = [];
    if (craft) {
      // Nothing about its own physics to show: the orbit below says it all.
    } else if (body.kind === 'rocky' || body.kind === 'gas') {
      const t = bodyTemperature(this.app.sim.bodies, body);
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
    const parent = this.app.sim.parentOf(body);
    if (parent) {
      const dx = body.x - parent.x, dy = body.y - parent.y, dz = body.z - parent.z;
      const dvx = body.vx - parent.vx, dvy = body.vy - parent.vy, dvz = body.vz - parent.vz;
      const r = Math.hypot(dx, dy, dz);
      const v2 = dvx * dvx + dvy * dvy + dvz * dvz;
      const mu = this.app.sim.effectiveG * (parent.mass + body.mass);
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
      if (!craft && isTidallyLocked(body, parent, r)) facts.push(['Rotation', 'Tidally locked']);
      const myPeriod = orbitalPeriod(body, parent, this.app.sim.gravityScale);
      if (myPeriod) {
        for (const other of this.app.sim.bodies) {
          if (other === body || other === parent || other.mass < body.mass * 1e-3) continue;
          if (this.app.sim.parentOf(other) !== parent) continue;
          const p = orbitalPeriod(other, parent, this.app.sim.gravityScale);
          const res = p ? nearResonance(myPeriod, p) : undefined;
          if (res) {
            alerts.push(`<div class="alert good">🎵 In ${res[0]}:${res[1]} orbital resonance with ${escapeHtml(other.name)}.</div>`);
            break;
          }
        }
      }
      const roche = this.app.sim.rocheLimit(parent, body);
      if (!craft && r < roche * 1.5 && parent.mass > body.mass * 5 && !isCompact(body.kind)) {
        alerts.push(`<div class="alert warn">Close to ${escapeHtml(parent.name)}'s Roche limit (${fmt(roche)} AU): tides may tear it apart.</div>`);
      }
    } else {
      facts.push(['Speed', formatSpeed(Math.hypot(body.vx, body.vy, body.vz))]);
    }
    // How it will die: the supernova its mass and metallicity lead to (stellarFate.ts).
    const isStar = (body.kind === 'star' || body.kind === 'giant') && body.tag !== 'galaxy';
    const z = body.metallicity ?? 1;
    if (isStar || body.kind === 'whitedwarf') facts.push(['Metallicity', `${z === 1 ? 'solar' : `${z < 0.1 ? z.toFixed(3) : z.toFixed(2)}× solar`} ([Fe/H] ${Math.log10(Math.max(z, 1e-3)) >= 0 ? '+' : ''}${Math.log10(Math.max(z, 1e-3)).toFixed(2)})`]);
    $('metallicity-row').classList.toggle('hidden', !(isStar || body.kind === 'whitedwarf'));
    const slider = $<HTMLInputElement>('metallicity');
    if (document.activeElement !== slider) slider.value = String(Math.log10(Math.max(z, 0.01)));
    $('metallicity-out').textContent = z.toFixed(z < 0.1 ? 3 : 2);
    // Spinning black holes (kerr.ts).
    const hole = body.kind === 'blackhole' && body.tag !== 'galaxy';
    $('spin-row').classList.toggle('hidden', !hole);
    if (hole) {
      const a = body.spin ?? 0;
      const gm = body.mass * 1.4766; // GM/c² in km
      const km = (x: number) => (x * gm >= 1e7 ? `${fmt((x * gm) / 1.496e8)} AU` : `${Math.round(x * gm).toLocaleString('en-US')} km`);
      facts.push(
        ['Spin a*', a ? a.toFixed(3) : '0 (not spinning)'],
        ['Event horizon', km(horizonRadius(a))],
        ['Innermost stable orbit', km(iscoRadius(a))],
        ['Disc efficiency', `${(radiativeEfficiency(a) * 100).toFixed(1)}% of mass → light`],
      );
      const spinSlider = $<HTMLInputElement>('bh-spin');
      if (document.activeElement !== spinSlider) spinSlider.value = String(a);
      $('bh-spin-out').textContent = a.toFixed(2);
    }
    if (body.kind === 'neutron') facts.push(...neutronFacts(body));
    if (isStar && this.app.sim.canSupernova(body)) {
      alerts.push(`<div class="alert info">⭐ ${escapeHtml(describeFate(stellarFate(body.mass, z)))}</div>`);
    }
    const fuse = this.app.sim.fuses.get(body.id);
    if (fuse !== undefined) alerts.push(`<div class="alert danger">💥 Goes supernova in ${formatTime(Math.max(0, fuse - this.app.sim.time))}.</div>`);
    const f = this.app.forecastResult;
    if (f?.impact) {
      alerts.push(`<div class="alert danger">⚠ Collision course with <b>${escapeHtml(f.impact.otherName)}</b> in ${formatTime(f.impact.time)}.</div>`);
    } else if (f?.closest) {
      const close = this.closeApproach(f);
      alerts.push(
        `<div class="${close ? 'alert warn' : 'muted small'}">Closest approach (next ${formatTime(f.horizon)}): ${escapeHtml(f.closest.otherName)}, ${fmt(f.closest.distance)} AU in ${formatTime(f.closest.time)}.</div>`,
      );
    }
    setFacts($('body-facts'), facts);
    this.updateBodyWiki(body, craft, parent);
    const html = alerts.join('');
    const alertsEl = $('body-alerts');
    if (alertsEl.innerHTML !== html) alertsEl.innerHTML = html;
    $('btn-supernova').classList.toggle('hidden', !this.app.sim.canSupernova(body) || body.tag === 'galaxy');
    $('btn-visit').classList.toggle('hidden', !(body.tag?.startsWith('exohost:') || body.tag === 'home'));
    $('btn-land').classList.toggle('hidden', craft || body.kind !== 'rocky' || this.app.system.landedOn === body);
    const inChallenge = !!this.app.challenge;
    for (const id of ['btn-mass-up', 'btn-mass-down', 'btn-delete']) $(id).classList.toggle('hidden', inChallenge);
    if (inChallenge) $('btn-supernova').classList.add('hidden');
    this.updateProbePanel(body);
  }

  // ---------------------------------------------------------------------------
  // Probes: burns and transfer planning

  burnSize(): number {
    return Math.pow(10, Number($<HTMLInputElement>('burn-size').value)) * KMS;
  }

  updateProbePanel(body: Body): void {
    const isProbe = body.tag === 'probe';
    $('probe-controls').classList.toggle('hidden', !isProbe);
    if (!isProbe) return;
    $('probe-fuel').textContent = body.fuel !== undefined ? `fuel ${(body.fuel / KMS).toFixed(2)} km/s` : 'unlimited fuel';
    $('burn-size-out').textContent = `${(this.burnSize() / KMS).toFixed(2)} km/s`;
    const parent = this.app.sim.parentOf(body);
    const select = $<HTMLSelectElement>('transfer-target');
    const options = parent ? this.app.sim.bodies.filter((b) => b !== body && b !== parent && b.tag !== 'probe' && this.app.sim.parentOf(b) === parent) : [];
    const sig = options.map((o) => o.id).join(',');
    if (select.dataset.sig !== sig) {
      const prev = select.value;
      select.innerHTML = `<option value="">Choose a target…</option>` + options.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('');
      select.value = options.some((o) => String(o.id) === prev) ? prev : '';
      select.dataset.sig = sig;
    }
    const target = select.value ? this.app.sim.getBody(Number(select.value)) : undefined;
    const btn = $('btn-transfer');
    if (!target || !parent) {
      $('transfer-plan').textContent = options.length ? 'Pick a target for a Hohmann transfer plan.' : '';
      btn.classList.add('hidden');
      return;
    }
    const plan = planHohmann(body, target, parent, this.app.sim.gravityScale);
    const deg = (r: number) => `${Math.round((r * 180) / Math.PI)}°`;
    const timing = plan.wait < 0.01 ? 'Burn now!' : `Wait ${formatTime(plan.wait)} for the alignment.`;
    $('transfer-plan').textContent = `Departure burn ${(Math.abs(plan.dv1) / KMS).toFixed(2)} km/s ${plan.dv1 >= 0 ? 'prograde' : 'retrograde'}, arrival burn ${(Math.abs(plan.dv2) / KMS).toFixed(2)} km/s, flight time ${formatTime(plan.timeOfFlight)}. ${target.name} should lead by ${deg(plan.phaseNeeded)} (now ${deg(plan.phaseNow)}). ${timing}`;
    btn.classList.remove('hidden');
    btn.textContent = `Burn ${(Math.abs(plan.dv1) / KMS).toFixed(2)} km/s ${plan.dv1 >= 0 ? 'prograde' : 'retrograde'}`;
    btn.dataset.dv = String(plan.dv1);
  }

  burn(direction: 'prograde' | 'retrograde' | 'out' | 'in', size = this.burnSize()): void {
    const body = this.app.selectedBody();
    const parent = body && this.app.sim.parentOf(body);
    if (!body || !parent) return;
    if (body.fuel !== undefined && body.fuel <= 1e-9) return void toast('Out of fuel');
    const { prograde, radial } = burnDirections(body, parent);
    const dir = direction === 'prograde' ? prograde : direction === 'retrograde' ? prograde.map((v) => -v) : direction === 'out' ? radial : radial.map((v) => -v);
    let used = 0;
    this.app.mutateGame(`burn on ${body.name}`, () => {
      used = applyNudge(body, [dir[0] * size, dir[1] * size, dir[2] * size]);
    });
    if (this.app.challenge) this.app.challenge.st.dvUsed += used;
    this.updateBodyPanel();
  }
}
