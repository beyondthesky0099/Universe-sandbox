/**
 * One search over everything the app knows: stars, nebulae, clusters, exoplanets, galaxies,
 * black holes, the bodies in the current scene, scenarios, lessons, challenges, gravitational-wave
 * events, flybys, spacecraft encounters and eclipses. Entries carry what to do when picked; the
 * app (app.ts) carries it out.
 *
 * Matching ignores case, spaces, punctuation and accents ("ngc2070" finds "NGC 2070", "eta car"
 * finds "Eta Carinae"), knows that "Messier 42" is M42, and ranks exact names, then names that
 * start with the query, then whole words, then anything containing it; famous objects first.
 */

export type SearchAction =
  /** Fly to a point in the Milky Way map: galactic l, b (degrees), distance (kpc). */
  | { type: 'map'; l: number; b: number; dKpc: number; sizePc?: number; pulsar?: string }
  /** Turn the Sky tab to an ecliptic direction (unit vector). */
  | { type: 'sky'; v: [number, number, number]; radiusDeg?: number; body?: string }
  /** A galaxy in the Universe tab, by name. */
  | { type: 'galaxy'; name: string }
  /** A point in the Universe tab: galactic l, b and distance (Mpc). */
  | { type: 'cosmos'; l: number; b: number; dMpc: number }
  /** A body in the current scene, by id. */
  | { type: 'body'; id: number }
  /** Load a real exoplanet system, by host name. */
  | { type: 'exo'; host: string }
  | { type: 'preset'; id: string }
  | { type: 'lesson'; id: string }
  | { type: 'challenge'; id: string }
  | { type: 'gw'; index: number }
  | { type: 'flyby'; index: number }
  | { type: 'voyager'; index: number }
  | { type: 'eclipse'; index: number };

export interface SearchEntry {
  name: string;
  /** Other names it is known by (catalogue designations, the host of a planet, ...). */
  aliases?: string[];
  /** What it is, shown as a badge: "Nebula", "Exoplanet", ... */
  kind: string;
  /** One line of detail: distance, type, ... */
  detail?: string;
  /** Higher ranks first among equally good matches (famous, named objects). */
  rank?: number;
  action: SearchAction;
}

const GREEK: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu',
  ν: 'nu', ξ: 'xi', ο: 'omicron', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
};

/** Lowercase, accents and Greek letters spelled out, "messier" → "m", then letters and digits only. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[α-ω]/g, (c) => GREEK[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bmessier\s*/g, 'm')
    .replace(/[^a-z0-9]+/g, '');
}

/** Lowercase words (letters and digits), for whole-word matches. */
function words(s: string): string[] {
  return normalizeWords(s).split(' ').filter(Boolean);
}
function normalizeWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/[α-ω]/g, (c) => GREEK[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface Indexed {
  entry: SearchEntry;
  keys: string[];
  words: string[];
}

/** A prepared index: normalise the names once, search many times. */
export class SearchIndex {
  private readonly items: Indexed[] = [];

  add(entries: Iterable<SearchEntry>): void {
    for (const entry of entries) {
      // A designation in brackets is a name too: "Orion Nebula (M42)" is found as "M42".
      const inBrackets = [...entry.name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
      const names = [entry.name, ...inBrackets, ...(entry.aliases ?? [])];
      this.items.push({ entry, keys: names.map(normalize), words: names.flatMap(words) });
    }
  }

  get size(): number {
    return this.items.length;
  }

  /** The best matches for `query`, best first (plus any extra entries, such as the current scene's bodies). */
  search(query: string, limit = 40, extra: SearchEntry[] = []): SearchEntry[] {
    const q = normalize(query);
    if (!q) return [];
    const qWords = words(query);
    const scored: { entry: SearchEntry; score: number }[] = [];
    const consider = (it: Indexed) => {
      let score = 0;
      for (const k of it.keys) {
        // An exact name is only a little better than a name that starts with the query, so a
        // famous object ("Orion Nebula") outranks an obscure exact one (the dwarf galaxy "Orion").
        if (k === q) score = Math.max(score, 650);
        else if (k.startsWith(q)) score = Math.max(score, 600 - Math.min(100, k.length - q.length));
        else if (k.includes(q)) score = Math.max(score, 200 - Math.min(100, k.length - q.length));
      }
      // Every query word starts some word of the name ("eta car" → "Eta Carinae").
      if (score < 400 && qWords.length && qWords.every((w) => it.words.some((x) => x.startsWith(w)))) score = Math.max(score, 400);
      if (score > 0) scored.push({ entry: it.entry, score: score + 1.5 * (it.entry.rank ?? 0) });
    };
    for (const it of this.items) consider(it);
    if (extra.length) {
      const tmp = new SearchIndex();
      tmp.add(extra);
      for (const it of tmp.items) consider(it);
    }
    scored.sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length);
    return scored.slice(0, limit).map((s) => s.entry);
  }
}

/** "1,340 ly" from a distance in kpc. */
export function lightYears(dKpc: number): string {
  const ly = dKpc * 3261.56;
  if (ly >= 1e6) return `${(ly / 1e6).toFixed(ly >= 1e7 ? 0 : 1)} million ly`;
  return `${(ly >= 100 ? Math.round(ly / 10) * 10 : Math.round(ly * 10) / 10).toLocaleString('en-US')} ly`;
}
