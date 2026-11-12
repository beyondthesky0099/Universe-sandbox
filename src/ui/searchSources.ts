/**
 * Search entries (search.ts) for each of the app's catalogues. Pure functions of the loaded data.
 */
import { describePulsar, pulsarName, type PulsarRecord } from '../sim/pulsars';
import { equatorialToGalactic } from '../procgen/galaxy';
import type { StarCluster } from '../sim/clusters';
import type { Eclipse } from '../sim/eclipse';
import type { ExoCatalog } from '../sim/exoplanets';
import type { Flyby } from '../sim/flybys';
import { COSMIC_STRUCTURES, displayName, isFamous, type LocalGalaxy } from '../sim/galaxies';
import type { GwEvent } from '../sim/gwEvents';
import { galacticToEcliptic, type Nebula } from '../sim/nebulae';
import type { BrightStar, NearStar } from '../sim/stars';
import type { VoyagerEncounter } from '../sim/voyager';
import { lightYears, type SearchEntry } from './search';

const NEBULA_KIND: Record<Nebula['kind'], string> = { hii: 'HII region', pn: 'Planetary nebula', snr: 'Supernova remnant', dark: 'Dark nebula', refl: 'Reflection nebula' };

/** Nebulae: to the Galaxy Map when the distance is known, otherwise to the Sky tab. */
export function nebulaEntries(list: Nebula[]): SearchEntry[] {
  return list.map((n) => ({
    name: n.name ?? n.id,
    aliases: n.name ? [n.id] : undefined,
    kind: NEBULA_KIND[n.kind],
    detail: n.distanceKpc ? `${lightYears(n.distanceKpc)} away` : 'on the sky (distance unknown)',
    rank: n.name ? 60 : 0,
    action: n.distanceKpc
      ? { type: 'map', l: n.l, b: n.b, dKpc: n.distanceKpc, sizePc: n.radiusDeg > 0 ? n.distanceKpc * 1000 * Math.tan((n.radiusDeg * Math.PI) / 180) * 2 : undefined }
      : { type: 'sky', v: galacticToEcliptic(n.l, n.b), radiusDeg: n.radiusDeg },
  }));
}

const CLUSTER_KIND: Record<StarCluster['kind'], string> = { open: 'Open cluster', group: 'Moving group', globular: 'Globular cluster' };

export function clusterEntries(list: StarCluster[]): SearchEntry[] {
  return list.map((c) => ({
    name: c.name ?? c.id,
    aliases: c.name ? [c.id] : undefined,
    kind: CLUSTER_KIND[c.kind],
    detail: [c.distancePc ? `${lightYears(c.distancePc / 1000)} away` : undefined, c.members ? `${c.members.toLocaleString('en-US')} Gaia members` : undefined].filter(Boolean).join(' · '),
    rank: c.name ? 50 : c.kind === 'globular' ? 10 : 0,
    action: c.distancePc
      ? { type: 'map', l: c.l, b: c.b, dKpc: c.distancePc / 1000, sizePc: c.radiusPc ? c.radiusPc * 2 : undefined }
      : { type: 'sky', v: galacticToEcliptic(c.l, c.b), radiusDeg: c.radiusDeg },
  }));
}

/** Exoplanet systems and each planet in them: load the system in the Sandbox. */
export function exoplanetEntries(cat: ExoCatalog): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const h of cat.hosts) {
    const away = Number.isFinite(h.distancePc) ? ` · ${lightYears(h.distancePc / 1000)}` : '';
    out.push({ name: h.name, kind: 'Planetary system', detail: `${h.planets.length} planet${h.planets.length === 1 ? '' : 's'}${away}`, rank: 20 + Math.min(20, h.planets.length * 3), action: { type: 'exo', host: h.name } });
    for (const p of h.planets) {
      out.push({
        name: p.name,
        kind: 'Exoplanet',
        detail: `${p.massEarth >= 30 ? `${(p.massEarth / 317.8).toFixed(1)} Jupiter masses` : `${p.massEarth.toFixed(1)} Earth masses`}${p.habitable ? ' · temperate' : ''} · around ${h.name}`,
        rank: p.habitable ? 15 : 5,
        action: { type: 'exo', host: h.name },
      });
    }
  }
  return out;
}

/** Named stars: the bright ones (Sky tab) and those within 20 parsecs. */
export function starEntries(bright: BrightStar[], near: NearStar[]): SearchEntry[] {
  const out = new Map<string, SearchEntry>();
  for (const [x, y, z, mag, , name] of bright) {
    if (!name) continue;
    out.set(name, { name, kind: 'Star', detail: `magnitude ${mag.toFixed(1)}`, rank: Math.max(0, 70 - mag * 10), action: { type: 'sky', v: [x, y, z] } });
  }
  for (const s of near) {
    if (!s.name || s.name === 'Sol' || s.name === 'Sun') continue;
    const d = Math.hypot(...s.xyz);
    if (d <= 0) continue;
    const prev = out.get(s.name);
    const detail = `${lightYears(d / 1000)} away${s.spect ? ` · ${s.spect}` : ''} · magnitude ${s.mag.toFixed(1)}`;
    out.set(s.name, { name: s.name, kind: 'Star', detail, rank: prev?.rank ?? 30, action: { type: 'sky', v: [s.xyz[0] / d, s.xyz[1] / d, s.xyz[2] / d] } });
  }
  return [...out.values()];
}

/** Galaxies in the Universe tab. */
export function galaxyEntries(list: LocalGalaxy[]): SearchEntry[] {
  return list.map((g) => {
    const shown = displayName(g);
    return {
      name: shown,
      aliases: shown !== g.name ? [g.name] : undefined,
      kind: 'Galaxy',
      detail: g.name === 'Milky Way' ? 'our galaxy' : `${lightYears(g.d * 1000)} away`,
      rank: isFamous(g) ? 80 : Math.max(0, (g.lk ?? 8) - 8) * 5,
      action: { type: 'galaxy', name: g.name },
    };
  });
}

export function structureEntries(): SearchEntry[] {
  return COSMIC_STRUCTURES.map((s) => ({ name: s.name, kind: s.name === 'Local Group' ? 'Galaxy group' : 'Galaxy cluster', detail: `${lightYears(s.d * 1000)} away`, rank: 70, action: { type: 'cosmos', l: s.l, b: s.b, dMpc: s.d } }));
}

export function compactEntries(list: { name: string; kind: 'blackhole' | 'pulsar'; raDeg: number; decDeg: number; distanceKpc: number; mass?: number }[]): SearchEntry[] {
  return list.map((o) => {
    const [l, b] = equatorialToGalactic(o.raDeg, o.decDeg);
    return {
      name: o.name,
      kind: o.kind === 'blackhole' ? 'Black hole' : 'Pulsar',
      detail: `${o.mass ? `${o.mass} M☉ · ` : ''}${lightYears(o.distanceKpc)} away`,
      rank: 40,
      action: { type: 'map', l, b, dKpc: o.distanceKpc },
    };
  });
}

/** Real pulsars (ATNF catalogue): by J and B name, and by their remnant's name. */
export function pulsarEntries(list: PulsarRecord[]): SearchEntry[] {
  return list.map((p) => {
    const [l, b] = equatorialToGalactic(p.raDeg, p.decDeg);
    return {
      name: `${pulsarName(p)}${p.snr ? ` (${p.snr})` : ''}`,
      kind: p.magnetar ? 'Magnetar' : 'Pulsar',
      detail: `${describePulsar(p)} · ${lightYears(p.distanceKpc)} away`,
      rank: p.bname || p.snr || p.magnetar ? 45 : 20,
      action: { type: 'map', l, b, dKpc: p.distanceKpc, pulsar: p.jname },
    };
  });
}

/** The Sun, Moon and planets, as they are in the sky now. */
export function skyBodyEntries(): SearchEntry[] {
  return ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'].map((name) => ({
    name,
    kind: name === 'Sun' ? 'Star' : name === 'Moon' ? 'Moon' : 'Planet',
    detail: 'in the sky now',
    rank: 90,
    action: { type: 'sky', v: [0, 0, 1], body: name },
  }));
}

export function activityEntries(opts: {
  presets: { id: string; name: string; description: string }[];
  lessons: { id: string; title: string; summary: string }[];
  challenges: { id: string; title: string; summary: string }[];
  gw: GwEvent[];
  flybys: Flyby[];
  voyager: VoyagerEncounter[];
  eclipses: Eclipse[];
}): SearchEntry[] {
  const short = (s: string) => (s.length > 90 ? `${s.slice(0, 88)}…` : s);
  return [
    ...opts.presets.map((p): SearchEntry => ({ name: p.name, kind: 'Scenario', detail: short(p.description), rank: 45, action: { type: 'preset', id: p.id } })),
    ...opts.lessons.map((l): SearchEntry => ({ name: l.title, kind: 'Lesson', detail: short(l.summary), rank: 35, action: { type: 'lesson', id: l.id } })),
    ...opts.challenges.map((c): SearchEntry => ({ name: c.title, kind: 'Challenge', detail: short(c.summary), rank: 35, action: { type: 'challenge', id: c.id } })),
    ...opts.gw.map((e, i): SearchEntry => ({ name: e.name, kind: 'Gravitational waves', detail: `${e.kind === 'BBH' ? 'two black holes' : e.kind === 'BNS' ? 'two neutron stars' : 'a neutron star and a black hole'} · ${e.date}`, rank: 40, action: { type: 'gw', index: i } })),
    ...opts.flybys.map((f, i): SearchEntry => ({ name: `${f.name} flyby`, aliases: [f.name, f.des], kind: 'Asteroid flyby', detail: `closest to Earth ${f.date.slice(0, 11)}`, rank: 25, action: { type: 'flyby', index: i } })),
    ...opts.voyager.map((e, i): SearchEntry => ({ name: `${e.craft} at ${e.planet}`, aliases: [e.craft], kind: 'Spacecraft flyby', detail: e.closestUtc.slice(0, 10), rank: 30, action: { type: 'voyager', index: i } })),
    ...opts.eclipses.map((e, i): SearchEntry => ({ name: `${e.type[0].toUpperCase()}${e.type.slice(1)} solar eclipse ${e.date}`, aliases: [`eclipse ${e.date}`, `${e.date} eclipse`], kind: 'Eclipse', detail: 'watch it from anywhere on Earth', rank: 30, action: { type: 'eclipse', index: i } })),
  ];
}
