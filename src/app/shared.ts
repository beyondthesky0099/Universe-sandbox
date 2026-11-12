/**
 * Types, constants and small helpers shared by the App (app.ts) and its feature controllers.
 */
import type { PulsarRecord } from '../sim/pulsars';
import type { CompactObject } from '../sim/compactObjects';
import * as THREE from 'three';
import { type StarSystemSpec } from '../procgen/starSystem';
import { displayName, galaxyForm, LY_PER_MPC, type LocalGalaxy } from '../sim/galaxies';
import { ageAt, formatLookback, lookbackTime } from '../sim/cosmology';
import { QUALITY_PRESETS } from '../render/systemView';
import { type Body, type BodyKind } from '../sim/body';
import { GAS_PALETTE, ROCKY_PALETTE } from '../sim/color';
import { type SceneSetup } from '../sim/presets';
import { type ExoHost } from '../sim/exoplanets';
import { EARTH_MASS, fmt, formatTime, JUPITER_MASS, getDisplayUnits } from '../sim/units';

/** Places to watch the sky from: name, latitude, longitude. */
export const SKY_PLACES: [string, number, number][] = [
    ['Greenwich, London', 51.4778, -0.0015], ['New York', 40.7128, -74.006], ['Los Angeles', 34.0522, -118.2437],
    ['Mexico City', 19.4326, -99.1332], ['São Paulo', -23.5505, -46.6333], ['Reykjavík', 64.1466, -21.9426],
    ['Cape Town', -33.9249, 18.4241], ['Cairo', 30.0444, 31.2357], ['Mumbai', 19.076, 72.8777],
    ['Delhi', 28.6139, 77.209], ['Beijing', 39.9042, 116.4074], ['Tokyo', 35.6762, 139.6503],
    ['Sydney', -33.8688, 151.2093], ['Mauna Kea observatories', 19.8207, -155.4681],
    ['Atacama Desert (ALMA)', -23.0229, -67.7552], ['North Pole', 90, 0], ['South Pole', -90, 0],
];

export type ViewName = 'cosmos' | 'galaxy' | 'system' | 'sky';

export type Tool = 'select' | 'spawn' | 'nudge';

export type QualityName = keyof typeof QUALITY_PRESETS;

/**
 * Phones, tablets and small laptops: start with lighter graphics (low quality, no bloom or
 * lensing) unless the user has chosen otherwise. In a phone emulation (4× slower CPU) this took
 * the default Solar System from about 2.5 to 17 frames per second.
 */
export const LOW_POWER = (() => {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const touchPhone = window.matchMedia?.('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
  return touchPhone || (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
})();

/** Running in the desktop app (desktop/, Electron): start with higher quality. */
export const DESKTOP = /\bElectron\//.test(navigator.userAgent);

export interface SpawnType {
  id: string;
  label: string;
  kind?: BodyKind;
  mass: number;
  swatch: string;
  palette?: number[];
  /** Spawns a cloud of particles instead of a body. */
  particles?: number;
}

export const SPAWN_TYPES: SpawnType[] = [
  { id: 'asteroid', label: 'Asteroid', kind: 'rocky', mass: 0.01 * EARTH_MASS, swatch: '#8a8f99', palette: ROCKY_PALETTE },
  { id: 'rocky', label: 'Rocky planet', kind: 'rocky', mass: EARTH_MASS, swatch: '#4f8fd0', palette: ROCKY_PALETTE },
  { id: 'gas', label: 'Gas giant', kind: 'gas', mass: JUPITER_MASS, swatch: '#d8b48a', palette: GAS_PALETTE },
  { id: 'reddwarf', label: 'Red dwarf', kind: 'star', mass: 0.2, swatch: '#ffb36b' },
  { id: 'sun', label: 'Yellow star', kind: 'star', mass: 1, swatch: '#fff1d8' },
  { id: 'bluegiant', label: 'Blue giant', kind: 'star', mass: 15, swatch: '#a9c4ff' },
  { id: 'giant', label: 'Red giant', kind: 'giant', mass: 1.2, swatch: '#ff8a4a' },
  { id: 'whitedwarf', label: 'White dwarf', kind: 'whitedwarf', mass: 0.6, swatch: '#eaf2ff' },
  { id: 'neutron', label: 'Neutron star', kind: 'neutron', mass: 1.4, swatch: '#cfe6ff' },
  { id: 'blackhole', label: 'Black hole', kind: 'blackhole', mass: 10, swatch: '#b07cff' },
  { id: 'cloud', label: 'Dust cloud', mass: 0, swatch: '#c8a27a', particles: 500 },
  { id: 'probe', label: 'Probe', kind: 'rocky', mass: 1e-15, swatch: '#7fdcff' },
];

export interface SpawnDrag {
  start: THREE.Vector3;
  current: THREE.Vector3;
  planeY: number;
  lastPredict: number;
  path?: Float32Array;
}

/** Where the current sandbox scene came from. */
export type Origin =
  | { kind: 'star'; index: number; spec: StarSystemSpec }
  | { kind: 'core' }
  | { kind: 'sol' }
  | { kind: 'exo'; host: ExoHost }
  | { kind: 'pulsar'; index: number; record: PulsarRecord }
  | { kind: 'blackhole'; index: number; object: CompactObject }
  | { kind: 'neighbourhood' };

export interface Scenario {
  name: string;
  description?: string;
  load: () => SceneSetup;
  presetId?: string;
  origin?: Origin;
}

export const AUTO_EXIT_DISTANCE = 40000;

 // AU: zooming out this far returns to the galaxy map
export const AUTO_ENTER_DISTANCE = 0.6;

 // galaxy units: zooming this close to a selected star enters it
export const GALAXY_EXIT_DISTANCE = 560;

 // galaxy units: zooming out this far leaves for the Universe map

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// -----------------------------------------------------------------------------

export function kindLabel(b: Body): string {
  if (b.tag === 'probe' || b.tag === 'ship') return 'Spacecraft';
  if (b.tag === 'comet') return 'Comet';
  if (b.tag === 'galaxy') return 'Galaxy (all its mass as one point)';
  switch (b.kind) {
    case 'rocky':
      return b.mass < 0.05 * EARTH_MASS ? 'Asteroid' : 'Rocky planet';
    case 'gas':
      return 'Gas giant';
    case 'star':
      return 'Star';
    case 'giant':
      return 'Red giant';
    case 'whitedwarf':
      return 'White dwarf';
    case 'neutron':
      return 'Neutron star';
    case 'blackhole':
      return 'Black hole';
  }
}

export function formatAge(years: number): string {
  if (years >= 1e9) return `${(years / 1e9).toFixed(2)} Gyr`;
  if (years >= 1e6) return `${(years / 1e6).toFixed(1)} Myr`;
  if (years >= 1e3) return `${(years / 1e3).toFixed(1)} kyr`;
  return formatTime(years);
}

export function formatFactor(f: number): string {
  return f >= 0.999 ? 'real' : `${fmt(f)}×`;
}

export function formatEvolution(rate: number): string {
  return rate <= 1.01 ? 'real time' : `${formatAge(rate)}/yr`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatRate(yearsPerSecond: number): string {
  if (getDisplayUnits() === 'kpc-myr') return `${fmt(yearsPerSecond)} Myr/s`;
  if (yearsPerSecond < 1 / 12) return `${fmt(yearsPerSecond * 365.25)} d/s`;
  return `${fmt(yearsPerSecond)} yr/s`;
}

export function describeSystem(spec: StarSystemSpec): string {
  const parts = [`${spec.star.spectralClass}-type star with ${spec.planets.length} planet${spec.planets.length === 1 ? '' : 's'}`];
  if (spec.habitableCount) parts.push(`${spec.habitableCount} potentially habitable`);
  if (spec.belt) parts.push('an asteroid belt');
  if (spec.companion) parts.push(`a distant ${spec.companion.spectralClass}-type companion`);
  return `${parts.join(', ')}.`;
}

/** Superscript exponent for "3.2 × 10¹¹". */
export function sciMass(log10: number): string {
  const e = Math.floor(log10);
  const m = Math.pow(10, log10 - e);
  const sup = String(e).replace(/[0-9-]/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹⁻'['0123456789-'.indexOf(c)]);
  return `${m.toFixed(1)} × 10${sup} M☉`;
}

export function cosmosFacts(g: LocalGalaxy): [string, string][] {
  const form = galaxyForm(g);
  const facts: [string, string][] = [];
  const kind = g.kind ?? 'galaxy';
  if (kind === 'cluster') facts.push(['Type', 'Rich galaxy cluster (Abell)']);
  else if (kind === 'quasar') facts.push(['Type', 'Quasar: a galaxy with a feeding supermassive black hole']);
  else facts.push(['Type', `${form[0].toUpperCase()}${form.slice(1)} galaxy`]);
  if (g.note) facts.push(['Why it matters', g.note]);
  if (g.name === 'Milky Way') {
    facts.push(['Distance', 'You are here'], ['Diameter', 'about 100,000 light-years']);
  } else {
    const mly = (g.d * LY_PER_MPC) / 1e6;
    facts.push([g.zd ? 'Distance (from redshift)' : 'Distance', `${mly < 1 ? `${Math.round(mly * 1000).toLocaleString('en-US')} thousand` : fmt(mly)} ${mly < 1 ? '' : 'million '}light-years`.replace('  ', ' ')]);
    if (g.z !== undefined) {
      facts.push(['Redshift', g.z >= 1 ? g.z.toFixed(2) : g.z.toFixed(4)]);
      facts.push(['Light left it', `${formatLookback(lookbackTime(g.z))} ago${g.z > 3 ? `, when the universe was ${formatLookback(ageAt(g.z))} old` : ''}`]);
    }
    if (g.size && !g.zd) facts.push(['Diameter', `${Math.round(g.size * 3261.6).toLocaleString('en-US')} light-years`]);
    if (g.name === 'MESSIER087') facts.push(['Central black hole', '6.5 billion M☉: the first black hole ever imaged (Event Horizon Telescope, 2019)']);
  }
  if (kind === 'cluster') {
    if (g.rich !== undefined) facts.push(['Richness class', `${g.rich} (${['poorest', 'poor', 'moderate', 'rich', 'very rich', 'richest'][g.rich] ?? ''})`]);
    if (g.count !== undefined) facts.push(['Bright members', `${g.count} galaxies within 2 magnitudes of the third brightest`]);
    if (g.bm) facts.push(['Bautz–Morgan type', g.bm]);
  }
  if (g.vmag !== undefined) facts.push(['Brightness', `magnitude ${g.vmag.toFixed(1)}`]);
  if (g.mass !== undefined) facts.push(['Mass', sciMass(g.mass)]);
  if (g.hi !== undefined) facts.push(['Hydrogen gas', sciMass(g.hi)]);
  if (g.v !== undefined && g.name !== 'Milky Way' && g.z === undefined) facts.push([g.zd ? 'Recession velocity' : 'Radial velocity', `${Math.abs(g.v)} km/s ${g.v < 0 ? 'toward us' : 'away from us'}`]);
  if (g.md && g.name !== 'Milky Way') facts.push(['Main neighbour', displayName({ name: g.md })]);
  if (g.pa !== undefined && kind === 'galaxy') facts.push(['Position angle', `${g.pa}° (HyperLEDA / OpenNGC)`]);
  facts.push([
    'Data',
    g.ref ?? (kind === 'cluster' ? 'Abell, Corwin & Olowin 1989' : kind === 'quasar' ? 'Véron-Cetty & Véron 2010' : g.zd ? '2MASS Redshift Survey (Huchra et al. 2012)' : 'Karachentsev et al. 2013'),
  ]);
  return facts;
}

/** A distance in light-years, in AU when under a tenth of a light-year. */
export function formatLy(ly: number): string {
  if (ly * 63241 < 1) return `${(ly * 9.4607e12).toLocaleString('en-US', { maximumSignificantDigits: 3 })} km`;
  if (ly < 0.1) return `${Math.round(ly * 63241).toLocaleString('en-US')} AU`;
  if (ly < 100) return `${ly.toFixed(ly < 10 ? 2 : 1)} light-years`;
  if (ly < 1e6) return `${Math.round(ly).toLocaleString('en-US')} light-years`;
  if (ly < 1e9) return `${(ly / 1e6).toPrecision(3)} million light-years`;
  return `${(ly / 1e9).toPrecision(3)} billion light-years`;
}
