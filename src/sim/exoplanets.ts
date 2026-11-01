import { radiusFor, type BodyKind } from './body';
import { starColor, starTemperature, kelvinToRgb, rgbToHex, GAS_PALETTE, ROCKY_PALETTE } from './color';
import { isHabitable, surfaceTemperature } from './climate';
import { addOrbiting, type SceneSetup } from './presets';
import type { Simulation } from './simulation';
import { EARTH_MASS, GAS_GIANT_MIN_MASS } from './units';

/** NASA Exoplanet Archive acknowledgement (requested for any use of their data). */
export const EXOPLANET_ACKNOWLEDGEMENT =
  'This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program.';

export interface ExoPlanet {
  name: string;
  /** Semi-major axis (AU); estimated from the period when missing. */
  a: number;
  periodDays?: number;
  e: number;
  massEarth: number;
  /** True when the mass was estimated from the radius. */
  massEstimated: boolean;
  radiusEarth?: number;
  eqTempK?: number;
  year?: number;
  /** Rough temperature-based habitability using this app's climate model. */
  habitable: boolean;
}

export interface ExoHost {
  name: string;
  distancePc: number;
  raDeg: number;
  decDeg: number;
  massSun: number;
  radiusSun?: number;
  teffK?: number;
  ageGyr?: number;
  starsInSystem: number;
  planets: ExoPlanet[];
}

export interface ExoCatalog {
  retrieved: string;
  hosts: ExoHost[];
}

type RawHost = [string, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number, RawPlanet[]];
type RawPlanet = [string, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null];

/** Mass from radius (Earth units) using Chen & Kipping (2017)-style power laws. */
export function massFromRadius(radiusEarth: number): number {
  if (radiusEarth < 1.23) return Math.pow(radiusEarth, 1 / 0.279);
  if (radiusEarth < 11) return 2.74 * Math.pow(radiusEarth / 1.23, 1 / 0.589);
  return 300; // radius saturates for gas giants: mass is unconstrained, assume ~1 Jupiter
}

export function parseCatalog(json: { retrieved: string; systems: RawHost[] }): ExoCatalog {
  const hosts: ExoHost[] = [];
  for (const raw of json.systems) {
    const [name, dist, ra, dec, mass, radius, teff, age, stars, rawPlanets] = raw;
    const massSun = mass ?? (teff ? Math.pow(teff / 5778, 1.9) : 1);
    const lum = Math.pow(massSun, 3.5);
    const planets: ExoPlanet[] = [];
    for (const p of rawPlanets) {
      const [suffix, aRaw, period, ecc, , massE, radE, eqt, year] = p;
      let a = aRaw ?? undefined;
      if (a === undefined && period) a = Math.cbrt(massSun * (period / 365.25) ** 2);
      if (a === undefined || !(a > 0)) continue;
      const massEstimated = massE === null && radE !== null;
      const massEarth = massE ?? (radE ? massFromRadius(radE) : 1);
      const kind: BodyKind = massEarth * EARTH_MASS >= GAS_GIANT_MIN_MASS ? 'gas' : 'rocky';
      const t = surfaceTemperature(kind, massEarth * EARTH_MASS, lum / (a * a));
      planets.push({
        name: `${name} ${suffix}`,
        a,
        periodDays: period ?? undefined,
        e: Math.min(0.95, ecc ?? 0),
        massEarth,
        massEstimated,
        radiusEarth: radE ?? undefined,
        eqTempK: eqt ?? undefined,
        year: year ?? undefined,
        habitable: isHabitable(kind, massEarth * EARTH_MASS, t),
      });
    }
    if (!planets.length) continue;
    planets.sort((p, q) => p.a - q.a);
    hosts.push({
      name,
      distancePc: dist ?? NaN,
      raDeg: ra ?? 0,
      decDeg: dec ?? 0,
      massSun,
      radiusSun: radius ?? undefined,
      teffK: teff ?? undefined,
      ageGyr: age ?? undefined,
      starsInSystem: stars,
      planets,
    });
  }
  hosts.sort((a, b) => (a.distancePc || 1e9) - (b.distancePc || 1e9));
  return { retrieved: json.retrieved, hosts };
}

let catalogPromise: Promise<ExoCatalog> | undefined;

/** Load the bundled catalogue (fetched on first use; ~240 KB gzipped). */
export function loadCatalog(baseUrl = import.meta.env.BASE_URL): Promise<ExoCatalog> {
  catalogPromise ??= fetch(`${baseUrl}data/exoplanets.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the exoplanet catalogue (${r.status})`);
      return r.json();
    })
    .then(parseCatalog);
  return catalogPromise;
}

/** Equatorial (RA, Dec, distance) → scene coordinates in AU. */
export function hostPosition(h: ExoHost): [number, number, number] {
  const AU_PER_PC = 206264.806;
  const d = (h.distancePc || 0) * AU_PER_PC;
  const ra = (h.raDeg * Math.PI) / 180, dec = (h.decDeg * Math.PI) / 180;
  const x = d * Math.cos(dec) * Math.cos(ra);
  const y = d * Math.cos(dec) * Math.sin(ra);
  const z = d * Math.sin(dec);
  return [x, z, -y];
}

/**
 * Load a real exoplanet system. Most known exoplanets orbit very close to their stars, so
 * the usual inflated game radii are shrunk to fit this system's architecture.
 */
export function loadExoSystem(sim: Simulation, host: ExoHost): SceneSetup {
  const innermost = Math.min(...host.planets.map((p) => p.a * (1 - p.e)));
  let minGap = Infinity;
  for (let i = 1; i < host.planets.length; i++) minGap = Math.min(minGap, host.planets[i].a - host.planets[i - 1].a);
  const starRadius = Math.min(radiusFor('star', host.massSun), innermost * 0.3);
  const planetCap = Math.min(innermost * 0.12, Number.isFinite(minGap) ? minGap * 0.2 : Infinity);
  const temp = host.teffK ?? starTemperature(host.massSun);
  const star = sim.addBody({
    name: host.name,
    kind: 'star',
    mass: host.massSun,
    radius: starRadius,
    color: host.teffK ? rgbToHex(kelvinToRgb(temp)) : starColor(host.massSun),
    age: (host.ageGyr ?? 4) * 1e9,
  });
  let i = 0;
  for (const p of host.planets) {
    const mass = p.massEarth * EARTH_MASS;
    const kind: BodyKind = mass >= GAS_GIANT_MIN_MASS ? 'gas' : 'rocky';
    const palette = kind === 'gas' ? GAS_PALETTE : ROCKY_PALETTE;
    const color = p.habitable ? 0x3f78c8 : palette[i++ % palette.length];
    const body = addOrbiting(sim, star, { name: p.name, mass, kind, color }, { a: p.a, e: p.e, nu: (i * 2.39996) % (Math.PI * 2), inc: (i % 3) * 0.004 });
    body.radius = Math.min(radiusFor(kind, mass), planetCap);
  }
  sim.recenter();
  const outer = host.planets[host.planets.length - 1].a;
  const innerPeriod = Math.sqrt(host.planets[0].a ** 3 / host.massSun);
  return {
    cameraDistance: Math.max(outer * 2.4, innermost * 8),
    timeScale: Math.min(2, Math.max(0.0005, innerPeriod / 4)),
    elevation: 0.8,
    tip: `${host.name}: ${host.planets.length} known planet${host.planets.length === 1 ? '' : 's'}, ${host.distancePc ? `${(host.distancePc * 3.2616).toFixed(1)} light-years away` : 'distance unknown'}. Body sizes are scaled to fit.`,
  };
}

/** Known planet hosts within `maxPc` parsecs, plus the Sun, as a static star map (gravity off). */
export function loadNeighbourhood(sim: Simulation, catalog: ExoCatalog, maxPc = 15): SceneSetup {
  sim.gravityScale = 0;
  sim.collisions = false;
  sim.tidal = false;
  sim.addBody({ name: 'Sun', kind: 'star', mass: 1, tag: 'home', radius: 4000 });
  let farthest = 1;
  for (const h of catalog.hosts) {
    if (!(h.distancePc <= maxPc)) continue;
    const [x, y, z] = hostPosition(h);
    farthest = Math.max(farthest, Math.hypot(x, y, z));
    sim.addBody({
      name: h.name,
      kind: 'star',
      mass: Math.max(0.08, h.massSun),
      radius: 4000,
      color: h.teffK ? rgbToHex(kelvinToRgb(h.teffK)) : starColor(h.massSun),
      x,
      y,
      z,
      tag: `exohost:${h.name}`,
    });
  }
  return {
    cameraDistance: farthest * 1.6,
    timeScale: 0.001,
    elevation: 0.5,
    tip: `Known planet-hosting stars within ${maxPc} parsecs (${(maxPc * 3.26).toFixed(0)} light-years). Select one and press "Visit system".`,
  };
}
