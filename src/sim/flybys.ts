import type { SceneSetup } from './presets';
import type { Simulation } from './simulation';
import { toScene, type V3 } from './solarSystemData';
import { setTrueScale } from './trueScale';
import { EARTH_MASS } from './units';

/**
 * Upcoming asteroid close approaches to Earth (scripts/build-flybys.mjs): JPL Close-Approach
 * Data plus Horizons geocentric states of the asteroid, Moon and Sun four days beforehand.
 */
export interface Flyby {
  des: string;
  name: string;
  date: string;
  jd: number;
  /** Nominal closest distance (AU, from Earth's centre) and speed relative to Earth (km/s). */
  distAu: number;
  vRelKms: number;
  /** Absolute magnitude (sets the size estimate). */
  h: number;
  startJd: number;
  states: { asteroid: number[]; moon: number[]; sun: number[] };
}

const KM_PER_AU = 149597870.7;

let flybysPromise: Promise<Flyby[]> | undefined;
export function loadFlybys(baseUrl = import.meta.env.BASE_URL): Promise<Flyby[]> {
  flybysPromise ??= fetch(`${baseUrl}data/flybys.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load flyby data (${r.status})`);
      return r.json() as Promise<{ flybys: Flyby[] }>;
    })
    .then((d) => d.flybys);
  return flybysPromise;
}

/** Diameter (km) from absolute magnitude, assuming a typical albedo of 0.14. */
export function diameterFromH(h: number, albedo = 0.14): number {
  return (1329 / Math.sqrt(albedo)) * Math.pow(10, -h / 5);
}

/** State [x, y, z (AU), vx, vy, vz (AU/day)] → scene position and velocity (AU, AU/yr). */
function sceneState(s: number[]): { pos: V3; vel: V3 } {
  return { pos: toScene([s[0], s[1], s[2]]), vel: toScene([s[3] * 365.25, s[4] * 365.25, s[5] * 365.25]) };
}

/** Earth at the centre with the real Moon and Sun, and the asteroid four days out on its real path. */
export function loadFlyby(sim: Simulation, f: Flyby): SceneSetup {
  sim.tidal = false;
  sim.addBody({ name: 'Earth', kind: 'rocky', mass: EARTH_MASS, color: 0x3f78c8 });
  const moon = sceneState(f.states.moon);
  sim.addBody({ name: 'Moon', kind: 'rocky', mass: 0.0123 * EARTH_MASS, color: 0xa8a39b, x: moon.pos[0], y: moon.pos[1], z: moon.pos[2], vx: moon.vel[0], vy: moon.vel[1], vz: moon.vel[2] });
  const sun = sceneState(f.states.sun);
  sim.addBody({ name: 'Sun', kind: 'star', mass: 1, x: sun.pos[0], y: sun.pos[1], z: sun.pos[2], vx: sun.vel[0], vy: sun.vel[1], vz: sun.vel[2] });
  const a = sceneState(f.states.asteroid);
  const rock = sim.addBody({ name: f.name, kind: 'rocky', mass: 1e-20, color: 0xc9b18f, tag: 'pushable', x: a.pos[0], y: a.pos[1], z: a.pos[2], vx: a.vel[0], vy: a.vel[1], vz: a.vel[2] });
  setTrueScale(sim, true);
  const diameterKm = diameterFromH(f.h);
  rock.radius = diameterKm / 2 / KM_PER_AU;
  const km = f.distAu * KM_PER_AU;
  const dist = km < 1e6 ? `${Math.round(km).toLocaleString('en-US')} km from Earth's centre` : `${(km / 1e6).toFixed(2)} million km`;
  const geo = f.des === '99942' ? ' That is closer than geostationary satellites (42,164 km).' : '';
  return {
    cameraDistance: Math.max(0.0035, f.distAu * 3),
    timeScale: 1 / 365.25, // one day per second
    elevation: 0.6,
    focus: 'Earth',
    tip: `${f.name} passes ${dist} on ${f.date} UTC at ${f.vRelKms.toFixed(1)} km/s (JPL close-approach data).${geo} It starts here 4 days before, on its real path from JPL Horizons, with the real Moon and Sun. Its size, about ${diameterKm < 1 ? `${Math.round(diameterKm * 1000)} m` : `${diameterKm.toFixed(1)} km`}, is estimated from its brightness.`,
  };
}
