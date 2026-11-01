import type { SceneSpec } from '../game/sceneSpec';
import type { SceneFile } from '../ui/share';

/** Client for the optional Astrarium companion server (gallery, multiplayer, scene builder). */

export interface ServerFeatures {
  describe: boolean;
  gallery: boolean;
  multiplayer: boolean;
}

export interface GallerySummary {
  id: string;
  title: string;
  author: string;
  created: string;
  votes: number;
  bodies: number;
}

export class ServerClient {
  readonly base: string;

  constructor(base: string) {
    this.base = base.replace(/\/+$/, '');
  }

  get wsUrl(): string {
    return `${this.base.replace(/^http/, 'ws')}/ws`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    } catch {
      throw new Error(`Couldn't reach the server at ${this.base}.`);
    }
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `Server error (${res.status}).`);
    return body;
  }

  async health(): Promise<ServerFeatures> {
    const r = await this.request<{ features: ServerFeatures }>('/api/health');
    return r.features;
  }

  async describe(prompt: string): Promise<SceneSpec> {
    return (await this.request<{ scene: SceneSpec }>('/api/describe', { method: 'POST', body: JSON.stringify({ prompt }) })).scene;
  }

  async listScenes(sort: 'top' | 'new'): Promise<GallerySummary[]> {
    return (await this.request<{ scenes: GallerySummary[] }>(`/api/scenes?sort=${sort}`)).scenes;
  }

  async getScene(id: string): Promise<SceneFile> {
    return (await this.request<{ entry: { scene: SceneFile } }>(`/api/scenes/${encodeURIComponent(id)}`)).entry.scene;
  }

  async publish(title: string, author: string, scene: SceneFile): Promise<GallerySummary> {
    return (await this.request<{ scene: GallerySummary }>('/api/scenes', { method: 'POST', body: JSON.stringify({ title, author, scene }) })).scene;
  }

  async vote(id: string): Promise<number> {
    return (await this.request<{ votes: number }>(`/api/scenes/${encodeURIComponent(id)}/vote`, { method: 'POST' })).votes;
  }
}

/** Where to find the server: saved setting, build-time default, or the page's own origin. */
export function defaultServerUrl(saved: string | undefined): string | undefined {
  if (saved) return saved;
  const env = import.meta.env.VITE_ASTRARIUM_SERVER as string | undefined;
  if (env) return env;
  return undefined;
}
