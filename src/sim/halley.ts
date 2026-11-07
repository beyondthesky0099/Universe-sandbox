import { dateFromJulian } from './ephemeris';
import { loadSolarSystemOnDate, type SceneSetup } from './presets';
import type { Simulation } from './simulation';
import { toScene } from './solarSystemData';

/** Comet Halley's 2061 return from JPL Horizons (scripts/build-halley.mjs). */
export interface HalleyReturn {
  startJd: number;
  /** Heliocentric ecliptic J2000 [x, y, z (AU), vx, vy, vz (AU/day)] at startJd. */
  start: number[];
  perihelion: { jd: number; date: string; au: number; kms: number };
  earthApproach: { jd: number; date: string; au: number; kms: number };
  venusApproach: { jd: number; date: string; au: number; kms: number };
}

let promise: Promise<HalleyReturn> | undefined;
export function loadHalleyReturn(baseUrl = import.meta.env.BASE_URL): Promise<HalleyReturn> {
  promise ??= fetch(`${baseUrl}data/halley-2061.json`).then((r) => {
    if (!r.ok) throw new Error(`Couldn't load Halley data (${r.status})`);
    return r.json() as Promise<HalleyReturn>;
  });
  return promise;
}

/**
 * The real Solar System four months before Halley's 2061 perihelion, with the comet on its
 * JPL Horizons path (which includes the jets that nudge it), following the comet.
 */
export function loadHalley2061(sim: Simulation, h: HalleyReturn): SceneSetup {
  const setup = loadSolarSystemOnDate(sim, dateFromJulian(h.startJd));
  const sun = sim.bodies.find((b) => b.name === 'Sun')!;
  const halley = sim.bodies.find((b) => b.name === 'Halley');
  const [x, y, z] = toScene([h.start[0], h.start[1], h.start[2]]);
  const [vx, vy, vz] = toScene([h.start[3] * 365.25, h.start[4] * 365.25, h.start[5] * 365.25]);
  const state = { x: sun.x + x, y: sun.y + y, z: sun.z + z, vx: sun.vx + vx, vy: sun.vy + vy, vz: sun.vz + vz };
  if (halley) Object.assign(halley, state);
  else sim.addBody({ name: 'Halley', kind: 'rocky', mass: 1e-16, color: 0xcfe6ff, tag: 'comet', ...state });
  sim.invalidate();
  return {
    ...setup,
    cameraDistance: 1.6,
    timeScale: 4 / 365.25, // four days per second
    elevation: 0.7,
    focus: 'Halley',
    tip: `Halley's Comet returns: perihelion on ${h.perihelion.date.slice(0, 10)}, ${h.perihelion.au.toFixed(3)} AU from the Sun at ${h.perihelion.kms.toFixed(1)} km/s, closest to Earth on ${h.earthApproach.date.slice(0, 10)} at ${h.earthApproach.au.toFixed(2)} AU, and just ${(h.venusApproach.au * 149.6).toFixed(1)} million km from Venus on ${h.venusApproach.date.slice(0, 10)} (JPL Horizons). It starts here in ${dateFromJulian(h.startJd).toISOString().slice(0, 7)} on its real path. Its tails point away from the Sun and grow as it nears it; their lengths are illustrative.`,
  };
}
