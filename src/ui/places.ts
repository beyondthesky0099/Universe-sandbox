/**
 * Places: saved viewpoints you can return to or share, in every view.
 *
 * - **Sandbox:** the scenario, plus the camera relative to the followed body (in that body's radii,
 *   so the place survives orbiting and the real-size toggle) or in absolute AU.
 * - **Galaxy Map / Universe:** the camera and its target (and the galaxy's seed).
 * - **Sky:** the date, the observer's latitude and longitude, and where the camera looks.
 *
 * A few built-in places are kept beside the user's own. Places are stored in localStorage and
 * can be shared as a link (`#place=…`, base64url JSON).
 */
export type Vec3 = [number, number, number];

export type PlaceView =
  | {
      kind: 'system';
      scenario: string;
      presetId?: string;
      /** Name of the followed body; the offsets are then in its radii. */
      follow?: string;
      camera: Vec3;
      target: Vec3;
      /** Built-ins: put the camera on the far side of `follow` from this body, `distance` radii out. */
      lookAt?: string;
      distance?: number;
      /** Built-ins: offsets are in the followed body's own frame (y along its spin axis), e.g. above Saturn's rings. */
      poleFrame?: boolean;
    }
  | { kind: 'galaxy'; seed: number; origin: string; camera: Vec3; target: Vec3 }
  | { kind: 'cosmos'; camera: Vec3; target: Vec3 }
  | { kind: 'sky'; date: string; lat: number; lon: number; alt: number; az: number }
  /** Built-ins only: whatever the search's top result for `query` is. */
  | { kind: 'search'; query: string };

export interface Place {
  id: string;
  name: string;
  /** Field of view, degrees. */
  fov?: number;
  created: number;
  view: PlaceView;
  builtIn?: boolean;
}

export const BUILT_IN_PLACES: Place[] = [
  { id: 'b-earthrise', name: 'Earth beyond the Moon', created: 0, builtIn: true, view: { kind: 'system', scenario: 'Solar System (true scale)', presetId: 'solar-true', follow: 'Moon', lookAt: 'Earth', distance: 6, camera: [0, 0, 0], target: [0, 0, 0] } },
  { id: 'b-saturn', name: "Saturn's rings", created: 0, builtIn: true, view: { kind: 'system', scenario: 'Solar System (true scale)', presetId: 'solar-true', follow: 'Saturn', poleFrame: true, camera: [3.4, 1.5, 2.2], target: [0, 0, 0] } },
  { id: 'b-jupiter', name: 'Jupiter and its moons', created: 0, builtIn: true, view: { kind: 'system', scenario: 'Solar System (true scale)', presetId: 'solar-true', follow: 'Jupiter', camera: [0, 12, 30], target: [0, 0, 0] } },
  { id: 'b-orion', name: 'Orion Nebula', created: 0, builtIn: true, view: { kind: 'search', query: 'Orion Nebula' } },
  { id: 'b-pleiades', name: 'The Pleiades', created: 0, builtIn: true, view: { kind: 'search', query: 'Pleiades' } },
  { id: 'b-crab', name: 'Crab Nebula', created: 0, builtIn: true, view: { kind: 'search', query: 'Crab Nebula' } },
  { id: 'b-andromeda', name: 'Andromeda Galaxy', created: 0, builtIn: true, view: { kind: 'search', query: 'Andromeda Galaxy' } },
];

const KEY = 'astrarium.places';
const MAX = 200;

export const VIEW_LABEL: Record<PlaceView['kind'], string> = { system: 'Sandbox', galaxy: 'Galaxy Map', cosmos: 'Universe', sky: 'Sky', search: 'Famous' };

/** A short description for the list: the view, and the body, place or scenario. */
export function placeSummary(p: Place): string {
  const v = p.view;
  switch (v.kind) {
    case 'system':
      return v.follow ? `${VIEW_LABEL.system} · near ${v.follow}` : `${VIEW_LABEL.system} · ${v.scenario}`;
    case 'sky':
      return `Sky · ${v.lat.toFixed(1)}°, ${v.lon.toFixed(1)}° · ${v.date.slice(0, 16).replace('T', ' ')} UTC`;
    case 'galaxy':
      return `Galaxy Map · ${v.origin}`;
    default:
      return VIEW_LABEL[v.kind];
  }
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
}

/** Checks a place read from storage or a link (they are untrusted). */
export function validPlace(p: unknown): p is Place {
  if (!p || typeof p !== 'object') return false;
  const o = p as Partial<Place>;
  if (typeof o.name !== 'string' || !o.name || o.name.length > 120 || !o.view || typeof o.view !== 'object') return false;
  if (o.fov !== undefined && (typeof o.fov !== 'number' || !(o.fov > 0 && o.fov < 180))) return false;
  const v = o.view as PlaceView;
  switch (v.kind) {
    case 'system':
      return typeof v.scenario === 'string' && isVec3(v.camera) && isVec3(v.target) && (v.follow === undefined || typeof v.follow === 'string');
    case 'galaxy':
      return typeof v.seed === 'number' && typeof v.origin === 'string' && isVec3(v.camera) && isVec3(v.target);
    case 'cosmos':
      return isVec3(v.camera) && isVec3(v.target);
    case 'sky':
      return typeof v.date === 'string' && !Number.isNaN(Date.parse(v.date)) && [v.lat, v.lon, v.alt, v.az].every((x) => typeof x === 'number' && Number.isFinite(x)) && Math.abs(v.lat) <= 90;
    case 'search':
      return typeof v.query === 'string' && v.query.length < 120;
    default:
      return false;
  }
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** A place as a link fragment value (rounded to keep links short). */
export function encodePlace(p: Place): string {
  const round = (x: number) => Number(x.toPrecision(7));
  const json = JSON.stringify({ name: p.name, fov: p.fov && round(p.fov), view: p.view }, (_k, v) => (typeof v === 'number' ? round(v) : v));
  return toBase64Url(json);
}

export function decodePlace(code: string): Place | undefined {
  try {
    const raw = JSON.parse(fromBase64Url(code)) as Partial<Place>;
    const p = { ...raw, id: newId(), created: Date.now() };
    return validPlace(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

export function newId(): string {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** The user's places, newest first, kept in localStorage (or in memory if storage is blocked). */
export class PlaceStore {
  private list: Place[] = [];

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeStorage()) {
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) ?? '[]') as unknown;
      if (Array.isArray(raw)) this.list = raw.filter(validPlace).map((p) => ({ ...p, builtIn: undefined }));
    } catch {
      this.list = [];
    }
  }

  get places(): Place[] {
    return this.list;
  }

  add(p: Place): void {
    this.list = [p, ...this.list.filter((q) => q.id !== p.id)].slice(0, MAX);
    this.save();
  }

  remove(id: string): void {
    this.list = this.list.filter((p) => p.id !== id);
    this.save();
  }

  rename(id: string, name: string): void {
    const p = this.list.find((q) => q.id === id);
    if (!p || !name.trim()) return;
    p.name = name.trim().slice(0, 120);
    this.save();
  }

  private save(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.list));
    } catch {
      // Storage full or blocked: the places last for this visit only.
    }
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
