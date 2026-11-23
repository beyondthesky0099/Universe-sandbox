/**
 * One search over everything the app knows: stars, nebulae, clusters, exoplanets, galaxies,
 * black holes, the bodies in the current scene, scenarios, lessons, challenges, gravitational-wave
 * events, flybys, spacecraft encounters and eclipses. Entries carry what to do when picked; the
 * app (app.ts) carries it out.
 *
 * Matching ignores case, spaces, punctuation and accents ("ngc2070" finds "NGC 2070", "eta car"
 * finds "Eta Carinae"), knows that "Messier 42" is M42, and ranks exact names, then names that
 * start with the query, then whole words, then anything containing it; famous objects first.
 * A kind of object is a query too ("pulsars", "agn", "novae", "quasar"): it lists the famous
 * members of that kind, ranked.
 */

export type SearchAction =
  /** Fly to a point in the Milky Way map: galactic l, b (degrees), distance (kpc). */
  | { type: 'map'; l: number; b: number; dKpc: number; sizePc?: number; pulsar?: string; blackHole?: string; object?: string }
  /** Turn the Sky tab to an ecliptic direction (unit vector). */
  | { type: 'sky'; v: [number, number, number]; radiusDeg?: number; body?: string }
  /** A galaxy in the Universe tab, by name. */
  | { type: 'galaxy'; name: string }
  /** A point in the Universe tab: galactic l, b and distance (Mpc). */
  | { type: 'cosmos'; l: number; b: number; dMpc: number; viewMpc?: number }
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
  /** Normalised names: the name itself first, then bracketed designations and aliases. */
  keys: string[];
  words: string[];
  /** Words of the kind label and its synonyms ("agn" for a quasar), for searches by kind. */
  kinds: string[];
}

/** Extra words a kind answers to, by a pattern on its label. */
const KIND_SYNONYMS: [RegExp, string][] = [
  [/pulsar|magnetar/i, 'pulsars neutron star psr'],
  [/magnetar/i, 'magnetars'],
  [/black hole/i, 'blackhole bh black holes'],
  [/x-ray binary/i, 'xrb xray x ray binaries'],
  [/quasar|seyfert|blazar|bl lac|liner|nucleus|active/i, 'agn active galactic nucleus active galaxy nuclei'],
  [/quasar/i, 'quasars qso'],
  [/blazar|bl lac/i, 'blazars'],
  [/seyfert|liner|nucleus/i, 'seyferts'],
  [/\bnova\b|dwarf nova|polar|cataclysmic|am cvn|nova-like|supersoft/i, 'cataclysmic variable cv cvs novae white dwarf'],
  [/dwarf nova|polar|cataclysmic|am cvn|nova-like|supersoft/i, 'cataclysmic variables'],
  [/cepheid/i, 'cepheids variable star variables'],
  [/maser/i, 'masers star forming region'],
  [/wolf/i, 'wr stars'],
  [/nebula/i, 'nebulae'],
  [/cluster/i, 'clusters'],
  [/galaxy/i, 'galaxies'],
  [/exoplanet|planetary system/i, 'exoplanets planets'],
  [/^star$/i, 'stars'],
  [/gravitational/i, 'gw merger'],
  [/scenario/i, 'scenarios presets'],
  [/lesson/i, 'lessons'],
  [/challenge/i, 'challenges'],
  [/eclipse/i, 'eclipses'],
  [/wall|supercluster|large-scale|void|stream|dark matter/i, 'structure structures superstructure large scale cosmic web'],
  [/wall/i, 'walls filament'],
  [/supercluster/i, 'superclusters'],
];
function kindWords(kind: string): string[] {
  const extra = KIND_SYNONYMS.filter(([re]) => re.test(kind)).map(([, w]) => w);
  return [...new Set(words([kind, ...extra].join(' ')))];
}
/**
 * Close enough for a typo: the same first letter and at most one edit (two for long words) by
 * Damerau–Levenshtein ("boots" → "bootes", "corana" → "corona", "herclues" → "hercules").
 */
export function nearWord(q: string, w: string): boolean {
  if (q.length < 4 || q[0] !== w[0]) return false;
  const max = q.length >= 8 ? 2 : 1;
  if (Math.abs(q.length - w.length) > max) return false;
  const d: number[][] = Array.from({ length: q.length + 1 }, (_, i) => [i, ...Array(w.length).fill(0)]);
  for (let j = 0; j <= w.length; j++) d[0][j] = j;
  for (let i = 1; i <= q.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= w.length; j++) {
      const cost = q[i - 1] === w[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && q[i - 1] === w[j - 2] && q[i - 2] === w[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return false;
  }
  return d[q.length][w.length] <= max;
}

/** A query word names a kind word when either starts with the other ("novae" ↔ "nova", "pulsars" ↔ "pulsar"). */
const sameWord = (q: string, k: string) => k.startsWith(q) || (q.length >= 3 && q.startsWith(k));

/** A prepared index: normalise the names once, search many times. */
export class SearchIndex {
  private readonly items: Indexed[] = [];

  add(entries: Iterable<SearchEntry>): void {
    for (const entry of entries) {
      // A designation in brackets is a name too: "Orion Nebula (M42)" is found as "M42".
      const inBrackets = [...entry.name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
      const names = [entry.name, ...inBrackets, ...(entry.aliases ?? [])];
      this.items.push({ entry, keys: names.map(normalize), words: names.flatMap(words), kinds: kindWords(entry.kind) });
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
      it.keys.forEach((k, i) => {
        // An exact name is only a little better than a name that starts with the query, so a
        // famous object ("Orion Nebula") outranks an obscure exact one (the dwarf galaxy "Orion").
        // An exact alias ("PSR B0531+21 (Crab)") counts a little below a name that starts with the
        // query, so "crab" gives the famous nebula, with the pulsar just behind it.
        if (k === q) score = Math.max(score, i === 0 ? 650 : 570);
        else if (k.startsWith(q)) score = Math.max(score, 600 - Math.min(100, k.length - q.length));
        else if (k.includes(q)) score = Math.max(score, 200 - Math.min(100, k.length - q.length));
      });
      // Every query word starts some word of the name ("eta car" → "Eta Carinae").
      if (score < 400 && qWords.length && qWords.every((w) => it.words.some((x) => x.startsWith(w)))) score = Math.max(score, 400);
      // Or mixes the two ("hercules structure", "virgo cluster"): each word in the name or the kind.
      if (score < 300 && qWords.length > 1 && qWords.some((w) => it.words.some((x) => x.startsWith(w))) && qWords.every((w) => it.words.some((x) => x.startsWith(w)) || it.kinds.some((k) => sameWord(w, k))))
        score = Math.max(score, 300);
      // Or names the kind ("pulsars", "agn", "dwarf nova"): below any name match, so the rank decides.
      if (score < 180 && qWords.length && qWords.every((w) => it.kinds.some((k) => sameWord(w, k)))) score = Math.max(score, 180);
      if (score > 0) scored.push({ entry: it.entry, score: score + 1.5 * (it.entry.rank ?? 0) });
    };
    for (const it of this.items) consider(it);
    if (extra.length) {
      const tmp = new SearchIndex();
      tmp.add(extra);
      for (const it of tmp.items) consider(it);
    }
    // Few or no matches: forgive a typo in each word ("boots void", "hercules corana").
    if (scored.length < 3 && qWords.length) {
      const seen = new Set(scored.map((s) => s.entry));
      const near = (w: string, it: Indexed) => it.words.some((x) => x.startsWith(w) || nearWord(w, x)) || it.kinds.some((k) => sameWord(w, k) || nearWord(w, k));
      for (const it of this.items) {
        if (seen.has(it.entry)) continue;
        if (qWords.every((w) => near(w, it)) && qWords.some((w) => it.words.some((x) => x.startsWith(w) || nearWord(w, x))))
          scored.push({ entry: it.entry, score: 120 + 1.5 * (it.entry.rank ?? 0) });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length);
    return scored.slice(0, limit).map((s) => s.entry);
  }
}

/** "1,340 ly" from a distance in kpc. */
export function lightYears(dKpc: number): string {
  const ly = dKpc * 3261.56;
  if (ly >= 1e9) return `${(ly / 1e9).toFixed(1)} billion ly`;
  if (ly >= 1e6) return `${(ly / 1e6).toFixed(ly >= 1e7 ? 0 : 1)} million ly`;
  return `${(ly >= 100 ? Math.round(ly / 10) * 10 : Math.round(ly * 10) / 10).toLocaleString('en-US')} ly`;
}
