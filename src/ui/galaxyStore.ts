/** Bookmarks and visited systems per galaxy seed, persisted in localStorage. */
export class GalaxyStore {
  private bookmarks = new Set<number>();
  private visited = new Set<number>();
  private seed = 0;

  load(seed: number): void {
    this.seed = seed;
    this.bookmarks.clear();
    this.visited.clear();
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) {
        const data = JSON.parse(raw) as { bookmarks?: number[]; visited?: number[] };
        data.bookmarks?.forEach((i) => this.bookmarks.add(i));
        data.visited?.forEach((i) => this.visited.add(i));
      }
    } catch {
      // Storage unavailable or corrupt: start empty.
    }
  }

  private get key(): string {
    return `astrarium:galaxy:${this.seed}`;
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify({ bookmarks: [...this.bookmarks], visited: [...this.visited] }));
    } catch {
      // Ignore quota / private-mode errors.
    }
  }

  isBookmarked(i: number): boolean {
    return this.bookmarks.has(i);
  }

  toggleBookmark(i: number): boolean {
    if (this.bookmarks.has(i)) this.bookmarks.delete(i);
    else this.bookmarks.add(i);
    this.save();
    return this.bookmarks.has(i);
  }

  markVisited(i: number): void {
    if (this.visited.has(i)) return;
    this.visited.add(i);
    this.save();
  }

  isVisited(i: number): boolean {
    return this.visited.has(i);
  }

  get bookmarkList(): number[] {
    return [...this.bookmarks];
  }

  get visitedList(): number[] {
    return [...this.visited];
  }
}

/** Small typed wrapper over localStorage for app preferences. */
export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`astrarium:${key}`);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`astrarium:${key}`, JSON.stringify(value));
    } catch {
      // ignore
    }
  },
};
