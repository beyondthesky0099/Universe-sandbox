import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Community scene gallery persisted to a JSON file. Small and dependency-free by design. */

export interface GalleryEntry {
  id: string;
  title: string;
  author: string;
  created: string;
  votes: number;
  bodies: number;
  /** The full scene file (as saved by the app). */
  scene: unknown;
}

export type GallerySummary = Omit<GalleryEntry, 'scene'>;

const MAX_SCENE_BYTES = 1_500_000;

export class GalleryError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function clean(text: unknown, max: number, fallback: string): string {
  const s = typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
  return (s || fallback).slice(0, max);
}

/** Shape check for a scene file produced by Astrarium (see src/ui/share.ts in the app). */
export function validateScene(scene: unknown): number {
  const s = scene as { app?: unknown; state?: { format?: unknown; bodies?: unknown } };
  if (!s || s.app !== 'astrarium' || !s.state || s.state.format !== 'astrarium-scene' || !Array.isArray(s.state.bodies)) {
    throw new GalleryError(400, 'That is not an Astrarium scene.');
  }
  if (s.state.bodies.length > 5000) throw new GalleryError(400, 'Scenes are limited to 5,000 bodies.');
  if (JSON.stringify(scene).length > MAX_SCENE_BYTES) throw new GalleryError(413, 'That scene is too large to share (1.5 MB limit).');
  return s.state.bodies.length;
}

export class Gallery {
  private entries: GalleryEntry[] = [];
  private voters = new Set<string>();
  private saving?: Promise<void>;
  private dirty = false;

  private readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  private get file(): string {
    return join(this.dir, 'gallery.json');
  }

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8')) as { entries?: GalleryEntry[]; voters?: string[] };
      this.entries = data.entries ?? [];
      this.voters = new Set(data.voters ?? []);
    } catch {
      this.entries = [];
    }
  }

  list(sort: 'top' | 'new' = 'top', limit = 50): GallerySummary[] {
    const sorted = [...this.entries].sort((a, b) => (sort === 'new' ? b.created.localeCompare(a.created) : b.votes - a.votes || b.created.localeCompare(a.created)));
    return sorted.slice(0, Math.min(200, Math.max(1, limit))).map(({ scene: _scene, ...rest }) => rest);
  }

  get(id: string): GalleryEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  async add(input: { title?: unknown; author?: unknown; scene?: unknown }): Promise<GallerySummary> {
    const bodies = validateScene(input.scene);
    if (this.entries.length >= 10_000) throw new GalleryError(507, 'The gallery is full.');
    const entry: GalleryEntry = {
      id: randomBytes(6).toString('base64url'),
      title: clean(input.title, 80, 'Untitled scene'),
      author: clean(input.author, 40, 'Anonymous'),
      created: new Date().toISOString(),
      votes: 0,
      bodies,
      scene: input.scene,
    };
    this.entries.push(entry);
    await this.save();
    const { scene: _scene, ...summary } = entry;
    return summary;
  }

  /** One vote per voter key (e.g. a hashed IP) per scene. Returns the new count. */
  async vote(id: string, voterKey: string): Promise<number> {
    const entry = this.get(id);
    if (!entry) throw new GalleryError(404, 'Scene not found.');
    const key = `${id}:${voterKey}`;
    if (!this.voters.has(key)) {
      this.voters.add(key);
      entry.votes++;
      await this.save();
    }
    return entry.votes;
  }

  /** Atomic write (temp file + rename); concurrent saves coalesce. */
  private async save(): Promise<void> {
    this.dirty = true;
    if (this.saving) return this.saving;
    this.saving = (async () => {
      while (this.dirty) {
        this.dirty = false;
        const tmp = `${this.file}.${process.pid}.tmp`;
        await writeFile(tmp, JSON.stringify({ entries: this.entries, voters: [...this.voters] }));
        await rename(tmp, this.file);
      }
    })().finally(() => (this.saving = undefined));
    return this.saving;
  }
}
