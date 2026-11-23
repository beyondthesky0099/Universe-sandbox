/**
 * Sgr A* and the S-stars: the Milky Way's central black hole (4.28 × 10⁶ M☉) with the stars on
 * the orbits Gillessen et al. (2017, ApJ 837, 30) fitted to 25 years of observations. Their
 * semi-major axes are in arcseconds as seen from the Sun; at R0 = 8.32 kpc, 1″ is 8,320 AU. S2,
 * the best known, swings round the black hole every 16 years, to within 120 AU of it (about 17
 * light-hours) at nearly 8,000 km/s: following it was part of the 2020 Nobel Prize in Physics.
 *
 * Each star starts where it is on its orbit at the given date (from its periapse time). The
 * orientations are relative to the plane of the sky. Star masses are not measured; B stars like
 * S2 have ~10–15 M☉, and next to the black hole they hardly matter.
 */
import type { SceneSetup } from './presets';
import type { Simulation } from './simulation';
import type { GalacticExtras, SStar } from './galacticExtras';
import { keplerToState } from './orbits';
import { G } from './units';

const DEG = Math.PI / 180;

/** True anomaly at a date (decimal year) from the periapse time and period. */
export function sStarTrueAnomaly(s: Pick<SStar, 'e' | 'tpYear' | 'periodYears'>, year: number): number {
  const phase = (year - s.tpYear) / s.periodYears;
  const M = 2 * Math.PI * (phase - Math.floor(phase));
  let E = s.e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 60; k++) E -= (E - s.e * Math.sin(E) - M) / (1 - s.e * Math.cos(E));
  return 2 * Math.atan2(Math.sqrt(1 + s.e) * Math.sin(E / 2), Math.sqrt(1 - s.e) * Math.cos(E / 2));
}

export function sStarAxisAu(s: Pick<SStar, 'aArcsec'>, r0Kpc: number): number {
  return s.aArcsec * r0Kpc * 1000;
}

export function loadSStars(sim: Simulation, d: GalacticExtras, date = new Date()): SceneSetup {
  const year = 1970 + date.getTime() / (365.25 * 86400000);
  const M = d.sgrA.massMsun;
  sim.addBody({ name: 'Sgr A*', kind: 'blackhole', mass: M });
  for (const s of d.sStars) {
    const mass = s.name === 'S2' ? 13.6 : 10;
    const { pos, vel } = keplerToState(G * sim.gravityScale * (M + mass), {
      a: sStarAxisAu(s, d.sgrA.r0Kpc),
      e: s.e,
      inc: s.i * DEG,
      lan: s.node * DEG,
      argp: s.peri * DEG,
      nu: sStarTrueAnomaly(s, year),
    });
    sim.addBody({ name: s.name, kind: 'star', mass, age: 6e6, x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z });
  }
  sim.recenter();
  return {
    cameraDistance: 4000,
    focus: 'Sgr A*',
    timeScale: 0.4,
    elevation: 0.5,
    tip: `The real S-stars round the Milky Way's black hole (${(M / 1e6).toFixed(2)} million Suns), on the orbits Gillessen et al. (2017) measured. S2 comes round every 16 years, passing 120 AU from the hole at 7,700 km/s; tracking it won the 2020 Nobel Prize in Physics.`,
  };
}
