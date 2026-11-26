/**
 * Famous objects the big catalogues miss or leave unnamed (scripts/build-famous-objects.mjs):
 * record-breaking and strange stars, a few Messier objects that aren't clusters or nebulae of
 * the usual kind, large nebulae, oddball galaxies, extreme galaxy clusters and a lensed quasar.
 * Each carries a one-line note on why it matters and the paper behind it.
 */
import { comovingDistance } from './cosmology';
import type { LocalGalaxy } from './galaxies';
import type { Nebula, NebulaKind } from './nebulae';

/** A star shown up close: radius (R☉), temperature (K), mass (M☉) and where they come from. */
export interface UpCloseVisit {
  radiusSun: number;
  temperature: number;
  mass: number;
  ref: string;
}

/** A single object on the Galaxy Map: galactic l, b (degrees) and distance d (kpc). */
export interface FamousMapObject {
  name: string;
  aliases?: string[];
  /** What it is, in words ("Red supergiant", "Magnetar"). */
  kind: string;
  l: number;
  b: number;
  d: number;
  /** The distance is only roughly known. */
  approx?: boolean;
  /** A star that can be visited up close: its radius (R☉), temperature (K), mass (M☉) and their source. */
  visit?: UpCloseVisit;
  /** A star's V magnitude and B−V colour (SIMBAD), to estimate its size when no visit is given. */
  vmag?: number;
  bv?: number;
  note: string;
  ref: string;
}

export interface FamousNebula {
  name: string;
  id: string;
  kind: NebulaKind;
  l: number;
  b: number;
  d: number;
  radiusDeg: number;
  ref: string;
}

/** A galaxy, galaxy cluster or quasar in the Universe tab: by redshift z, or distance d (Mpc). */
export interface FamousCosmos {
  name: string;
  aliases?: string[];
  kind: 'galaxy' | 'cluster' | 'quasar';
  label: string;
  l: number;
  b: number;
  z?: number;
  d?: number;
  t?: number;
  m?: string;
  size?: number;
  note: string;
  ref: string;
}

/** A familiar name for a nebula already in the catalogues (matched by position in the build). */
export interface NebulaName {
  kind: NebulaKind;
  id: string;
  name: string;
}

/** An asterism: stars at different distances that only line up on the sky (found in the Sky tab). */
export interface FamousSkyObject {
  name: string;
  aliases?: string[];
  kind: string;
  l: number;
  b: number;
  radiusDeg: number;
  note: string;
  ref: string;
}

export interface FamousObjects {
  map: FamousMapObject[];
  nebulae: FamousNebula[];
  nebulaNames?: NebulaName[];
  sky?: FamousSkyObject[];
  cosmos: FamousCosmos[];
}

const EMPTY: FamousObjects = { map: [], nebulae: [], nebulaNames: [], sky: [], cosmos: [] };

/** Give catalogue nebulae their familiar names (Thor's Helmet, the Red Spider, …), in place. */
export function nameNebulae(list: Nebula[], names: NebulaName[] = []): Nebula[] {
  const byKey = new Map(names.map((n) => [`${n.kind}|${n.id}`, n.name]));
  for (const n of list) {
    const name = byKey.get(`${n.kind}|${n.id}`);
    if (name) n.name = name;
  }
  return list;
}

let promise: Promise<FamousObjects> | undefined;
/** The famous objects; empty (never an error) if the file can't be loaded. */
export function loadFamous(baseUrl = import.meta.env.BASE_URL): Promise<FamousObjects> {
  promise ??= fetch(`${baseUrl}data/famous-objects.json`)
    .then((r) => (r.ok ? (r.json() as Promise<FamousObjects>) : EMPTY))
    .catch(() => EMPTY);
  return promise;
}

/** The famous nebulae as nebula-layer entries, with the paper their distance comes from. */
export function famousNebulae(list: FamousNebula[]): Nebula[] {
  return list.map((n) => ({ kind: n.kind, l: n.l, b: n.b, distanceKpc: n.d, radiusDeg: n.radiusDeg, id: n.id, name: n.name, ref: n.ref }));
}

/** The famous galaxies, clusters and quasars as Universe-tab entries. */
export function famousGalaxies(list: FamousCosmos[]): LocalGalaxy[] {
  return list.map((f) => {
    const byRedshift = f.z !== undefined;
    const g: LocalGalaxy = {
      name: f.name,
      kind: f.kind,
      l: f.l,
      b: f.b,
      d: byRedshift ? comovingDistance(f.z!) : f.d!,
      note: f.note,
      ref: f.ref,
      label: f.label,
      ...(byRedshift ? { z: f.z, zd: true } : {}),
      ...(f.t !== undefined ? { t: f.t } : {}),
      ...(f.m ? { m: f.m } : {}),
      ...(f.size !== undefined ? { size: f.size } : {}),
      ...(f.aliases ? { aliases: f.aliases } : {}),
      ...(f.kind === 'quasar' ? { cl: 'Q' as const } : {}),
    };
    // A single lensed star (Earendel) is not a galaxy to fly into.
    if (/single star/i.test(f.label)) g.noVisit = true;
    return g;
  });
}
