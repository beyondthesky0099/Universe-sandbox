import { addSaturnRings, planetAppearance, type SceneSetup } from './presets';
import type { Simulation } from './simulation';
import { REAL_COLORS, toScene, type SolarData, type V3 } from './solarSystemData';
import { SPACECRAFT_COLOR } from './spacecraft';
import { setTrueScale } from './trueScale';

/**
 * The Voyager planetary flybys (scripts/build-voyager.mjs): JPL Horizons planetocentric states
 * of the spacecraft, the planet's major moons and the Sun two days before each closest approach.
 */
export interface VoyagerEncounter {
  craft: string;
  planet: string;
  about: string;
  closestJd: number;
  closestUtc: string;
  /** Closest distance from the planet's centre (km) and speed there (km/s), from Horizons. */
  closestKm: number;
  speedKms: number;
  startJd: number;
  states: { craft: number[]; sun: number[]; moons: { name: string; state: number[] }[] };
}

let promise: Promise<VoyagerEncounter[]> | undefined;
export function loadVoyagerEncounters(baseUrl = import.meta.env.BASE_URL): Promise<VoyagerEncounter[]> {
  promise ??= fetch(`${baseUrl}data/voyager-encounters.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the Voyager data (${r.status})`);
      return r.json() as Promise<{ encounters: VoyagerEncounter[] }>;
    })
    .then((d) => d.encounters);
  return promise;
}

/** [x, y, z (AU), vx, vy, vz (AU/day)] → scene position and velocity (AU, AU/yr). */
function sceneState(s: number[]): { pos: V3; vel: V3 } {
  return { pos: toScene([s[0], s[1], s[2]]), vel: toScene([s[3] * 365.25, s[4] * 365.25, s[5] * 365.25]) };
}

/**
 * The planet at the centre with its major moons and the Sun, and Voyager two days out on its
 * real path, at true scale. Returns the scene; the camera follows the spacecraft.
 */
export function loadVoyagerEncounter(sim: Simulation, e: VoyagerEncounter, data: SolarData | undefined): SceneSetup {
  const planetData = data?.byName.get(e.planet);
  const look = planetAppearance(e.planet);
  sim.tidal = false;
  const planet = sim.addBody({ name: e.planet, kind: look.kind, mass: planetData?.mass ?? 1e-3, color: look.color });
  for (const m of e.states.moons) {
    const s = sceneState(m.state);
    sim.addBody({
      name: m.name, kind: 'rocky', mass: data?.byName.get(m.name)?.mass ?? 1e-12, color: REAL_COLORS[m.name],
      x: s.pos[0], y: s.pos[1], z: s.pos[2], vx: s.vel[0], vy: s.vel[1], vz: s.vel[2],
    });
  }
  const sun = sceneState(e.states.sun);
  sim.addBody({ name: 'Sun', kind: 'star', mass: 1, age: 4.6e9, x: sun.pos[0], y: sun.pos[1], z: sun.pos[2], vx: sun.vel[0], vy: sun.vel[1], vz: sun.vel[2] });
  const c = sceneState(e.states.craft);
  sim.addBody({
    name: e.craft, kind: 'rocky', mass: 1e-20, color: SPACECRAFT_COLOR, tag: 'probe',
    x: c.pos[0], y: c.pos[1], z: c.pos[2], vx: c.vel[0], vy: c.vel[1], vz: c.vel[2],
  });
  if (e.planet === 'Saturn' && data) addSaturnRings(sim, planet, data, 4000);
  setTrueScale(sim, true, data);
  const start = Math.hypot(...c.pos);
  return {
    // Ride just behind the spacecraft, looking ahead at the planet as it grows.
    cameraDistance: start * 0.12,
    viewFrom: [c.pos[0] / start, c.pos[1] / start + 0.35, c.pos[2] / start],
    timeScale: 2 / 24 / 365.25, // two hours per second: closest approach after about 24 seconds
    maxTimeScale: 0.1,
    elevation: 0.5,
    focus: e.craft,
    tip: `${e.craft} at ${e.planet}: closest approach ${e.closestKm.toLocaleString('en-US')} km from ${e.planet}'s centre on ${e.closestUtc} UT, at ${e.speedKms} km/s (JPL Horizons). ${e.about} It starts here two days before, on its real path, with the real moons and Sun, all at true scale.`,
  };
}
