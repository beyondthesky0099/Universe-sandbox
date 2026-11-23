/**
 * Famous impacts, at true scale (sim/trueScale.ts), with the impact energy reported in megatons
 * when they hit (simulation.ts):
 *
 * - Chicxulub, 66 million years ago: an asteroid ~10 km across (2,600 kg/m³, so 1.4 × 10¹⁵ kg)
 *   arriving at ~20 km/s and striking at ~60° from the horizontal (Collins et al. 2020, Nature
 *   Communications 11, 1480), ending the age of the dinosaurs. It starts 450,000 km out.
 * - Comet Shoemaker–Levy 9, July 1994: torn into 21 fragments (A to W) by Jupiter's tides in 1992,
 *   which struck Jupiter one after another over about six days (16–22 July 1994) at ~60 km/s,
 *   leaving dark scars bigger than Earth. Here they fall in along one line, spaced to arrive over
 *   six days; their sizes (0.5–2 km, comet-like 600 kg/m³) are illustrative, and the real ones hit
 *   just behind Jupiter's limb as seen from Earth.
 */
import type { Preset } from './presets';
import type { Simulation } from './simulation';
import { setTrueScale } from './trueScale';
import { EARTH_MASS, G, JUPITER_MASS } from './units';

const KM_PER_AU = 1.495978707e8;
const KMS = 1 / 4.74047; // AU/yr per km/s
const MSUN_KG = 1.98847e30;

/** Mass (M☉) of a sphere of diameter d (km) and density rho (kg/m³). */
function sphereMass(dKm: number, rho: number): number {
  return ((4 / 3) * Math.PI * (dKm * 500) ** 3 * rho) / MSUN_KG;
}

export const chicxulub: Preset = {
  id: 'chicxulub',
  name: 'Chicxulub impact (66 million years ago)',
  description: 'The 10 km asteroid that ended the age of the dinosaurs, arriving at 20 km/s. At true scale.',
  load(sim: Simulation) {
    sim.addBody({ name: 'Earth', kind: 'rocky', mass: EARTH_MASS, color: 0x4f7fd0 });
    const startKm = 450000;
    const v = 20 * KMS;
    // Aimed to strike at ~60° from the horizontal: an offset of R⊕ cos 60° across the path.
    const offsetKm = 6371 * Math.cos((60 * Math.PI) / 180);
    sim.addBody({ name: 'Chicxulub impactor', kind: 'rocky', mass: sphereMass(10, 2600), color: 0x8a7f74, x: startKm / KM_PER_AU, y: 0, z: offsetKm / KM_PER_AU, vx: -v, vy: 0, vz: 0 });
    setTrueScale(sim, true);
    sim.recenter();
    return {
      cameraDistance: 60000 / KM_PER_AU,
      focus: 'Earth',
      timeScale: 2e-5,
      elevation: 0.35,
      tip: 'Chicxulub, 66 million years ago: a ~10 km asteroid at ~20 km/s (Collins et al. 2020). It reaches Earth in about six hours; when it hits, the energy is shown in megatons. The crater, 180 km wide, lies under Mexico’s Yucatán peninsula.',
    };
  },
};

export const shoemakerLevy9: Preset = {
  id: 'shoemaker-levy-9',
  name: 'Comet Shoemaker–Levy 9 hits Jupiter (1994)',
  description: 'The 21 fragments of a comet torn apart by Jupiter, striking it one after another over six days in July 1994. At true scale.',
  load(sim: Simulation) {
    sim.addBody({ name: 'Jupiter', kind: 'gas', mass: JUPITER_MASS, color: 0xd8b48a });
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K', 'L', 'N', 'P1', 'P2', 'Q1', 'Q2', 'R', 'S', 'T', 'U', 'V', 'W'];
    // The largest (G, K, L, H) bigger; the rest 0.5–1 km.
    const big: Record<string, number> = { G: 2, K: 1.8, L: 1.6, H: 1.4, Q1: 1.2 };
    const gm = G * sim.gravityScale * JUPITER_MASS;
    const sqrt2gm = Math.sqrt(2 * gm);
    names.forEach((n, k) => {
      // Radial infall from rest at infinity (parabolic): r = (1.5 t √(2GM))^(2/3) for arrival in t.
      const tYears = ((0.6 + (k / (names.length - 1)) * 6) * 1) / 365.25;
      const r = (1.5 * tYears * sqrt2gm) ** (2 / 3);
      const v = Math.sqrt((2 * gm) / r);
      // Along one line, a little off centre so they strike at an angle.
      const off = (40000 / KM_PER_AU) * (0.6 + 0.4 * Math.sin(k));
      sim.addBody({ name: `Fragment ${n}`, kind: 'rocky', tag: 'comet', mass: sphereMass(big[n] ?? 0.5 + 0.5 * ((k * 7) % 5) / 4, 600), color: 0xcfe6ff, x: r, y: 0.0002 * Math.sin(k), z: off, vx: -v, vy: 0, vz: 0 });
    });
    setTrueScale(sim, true);
    sim.recenter();
    return {
      cameraDistance: 0.03,
      focus: 'Jupiter',
      timeScale: 2e-3,
      elevation: 0.5,
      tip: 'Shoemaker–Levy 9: Jupiter’s tides tore this comet into 21 pieces in 1992, and between 16 and 22 July 1994 they struck Jupiter one after another at ~60 km/s. Watch the train come in; each hit is reported in megatons. (Fragment sizes and the single line of approach are illustrative.)',
    };
  },
};
