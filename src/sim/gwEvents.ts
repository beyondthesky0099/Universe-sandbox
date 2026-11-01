import type { BodyKind } from './body';
import type { SceneSetup } from './presets';
import type { Simulation } from './simulation';
import { C_AU_PER_YEAR, G } from './units';

/** Gravitational-wave detections (scripts/build-gw-events.mjs; values from the discovery papers). */
export interface GwEvent {
  name: string;
  date: string;
  kind: 'BBH' | 'BNS' | 'NSBH';
  m1: number;
  m2: number;
  final?: number;
  distanceMpc?: number;
  arxiv: string;
  about: string;
  massNote?: string;
}

/** The speed of light is scaled down so a merger plays out in seconds (as in the inspiral preset). */
const LIGHT_SPEED_SCALE = 0.0016;
/** Target Peters inspiral time (yr); the 1PN terms make the real run a little shorter. */
const TARGET_INSPIRAL_YEARS = 26;

let eventsPromise: Promise<GwEvent[]> | undefined;
export function loadGwEvents(baseUrl = import.meta.env.BASE_URL): Promise<GwEvent[]> {
  eventsPromise ??= fetch(`${baseUrl}data/gw-events.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load gravitational-wave events (${r.status})`);
      return r.json() as Promise<{ events: GwEvent[] }>;
    })
    .then((d) => d.events);
  return eventsPromise;
}

function kindFor(mass: number): BodyKind {
  return mass < 2.5 ? 'neutron' : 'blackhole';
}

/**
 * Separation (AU) whose Peters gravitational-wave inspiral time is `years` at light speed `c`:
 * T = 5 c⁵ a⁴ / (256 G³ m₁ m₂ M).
 */
export function separationForInspiral(m1: number, m2: number, c: number, years: number): number {
  const M = m1 + m2;
  return Math.pow((years * 256 * G ** 3 * m1 * m2 * M) / (5 * c ** 5), 0.25);
}

/** Replay a real merger: the real masses on a circular orbit that spirals in through gravitational waves. */
export function loadGwEvent(sim: Simulation, ev: GwEvent): SceneSetup {
  sim.relativity = true;
  sim.lightSpeedScale = LIGHT_SPEED_SCALE;
  sim.tidal = false;
  const c = C_AU_PER_YEAR * LIGHT_SPEED_SCALE;
  const M = ev.m1 + ev.m2;
  const r = separationForInspiral(ev.m1, ev.m2, c, TARGET_INSPIRAL_YEARS);
  // Circular orbit including the 1PN correction: v² = GM/r / (1 + 3GM/(r c²)).
  const gm = G * M;
  const v = Math.sqrt(gm / r / (1 + (3 * gm) / (r * c * c)));
  const x1 = (-r * ev.m2) / M, x2 = (r * ev.m1) / M;
  const names = { BBH: ['Black hole', 'Black hole'], BNS: ['Neutron star', 'Neutron star'], NSBH: ['Black hole', 'Neutron star'] }[ev.kind];
  // Contact radii sum to the innermost stable circular orbit, 6GM/c²: real binaries plunge and
  // merge there, at about 0.4c. Closer in, the post-Newtonian approximation breaks down.
  const isco = (m: number) => (6 * G * m) / (c * c);
  sim.addBody({ name: `${ev.name} ${names[0]} (${ev.m1} M☉)`, kind: kindFor(ev.m1), mass: ev.m1, radius: isco(ev.m1), x: x1, vz: (v * ev.m2) / M });
  sim.addBody({ name: `${ev.name} ${names[1]} (${ev.m2} M☉)`, kind: kindFor(ev.m2), mass: ev.m2, radius: isco(ev.m2), x: x2, vz: (-v * ev.m1) / M });
  const radiated = ev.final ? ` In reality the remnant was ${ev.final} M☉: ${(M - ev.final).toFixed(1)} M☉ turned into gravitational-wave energy.` : '';
  const distance = ev.distanceMpc ? ` It happened ${ev.distanceMpc >= 1000 ? `${(ev.distanceMpc * 3.2616 / 1000).toFixed(1)} billion` : `${Math.round(ev.distanceMpc * 3.2616)} million`} light-years away.` : '';
  return {
    cameraDistance: r * 4.5,
    timeScale: 1.2,
    elevation: 1.0,
    tip: `${ev.name} (${ev.date}): ${ev.about} Real masses ${ev.m1} + ${ev.m2} M☉ (arXiv:${ev.arxiv}).${distance}${radiated} The speed of light and the orbit are scaled so the last moments play out in seconds. Turn on sound to hear the chirp.`,
  };
}
