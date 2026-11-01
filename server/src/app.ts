import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { Gallery, GalleryError } from './gallery.ts';
import { Rooms } from './rooms.ts';
import { describeScene, SceneError, type SceneClient } from './scene.ts';

export interface AppOptions {
  /** Anthropic client for the scene builder; omit to disable it. */
  sceneClient?: SceneClient;
  dataDir: string;
  /** Allowed browser origins for CORS ('*' allows any). */
  allowedOrigins: string[];
  /** Serve the built web app from this directory (optional). */
  staticDir?: string;
  /** Requests per IP per hour. */
  limits?: { describe?: number; publish?: number; vote?: number };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

/** Fixed-window per-key rate limiter. */
class RateLimiter {
  private readonly hits = new Map<string, { count: number; reset: number }>();
  private readonly perHour: number;
  constructor(perHour: number) {
    this.perHour = perHour;
  }
  allow(key: string): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || now > h.reset) {
      this.hits.set(key, { count: 1, reset: now + 3_600_000 });
      return true;
    }
    if (h.count >= this.perHour) return false;
    h.count++;
    return true;
  }
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function clientIp(req: IncomingMessage): string {
  // Trust X-Forwarded-For only for its first hop (typical single reverse proxy).
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  return createHash('sha256').update(ip).digest('base64url').slice(0, 16);
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, 'Request too large.');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

export async function createApp(opts: AppOptions): Promise<{ server: Server; gallery: Gallery; rooms: Rooms }> {
  const gallery = new Gallery(opts.dataDir);
  await gallery.load();
  const rooms = new Rooms();
  const limits = {
    describe: new RateLimiter(opts.limits?.describe ?? 20),
    publish: new RateLimiter(opts.limits?.publish ?? 20),
    vote: new RateLimiter(opts.limits?.vote ?? 300),
  };
  const anyOrigin = opts.allowedOrigins.includes('*');

  const cors = (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && (anyOrigin || opts.allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', anyOrigin ? '*' : origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const serveStatic = async (req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> => {
    if (!opts.staticDir || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    const root = resolve(opts.staticDir);
    let file = normalize(join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root)) return false;
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      await stat(file);
    } catch {
      file = join(root, 'index.html'); // single-page app fallback
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    if (req.method === 'HEAD') return void res.end(), true;
    createReadStream(file).pipe(res);
    return true;
  };

  const server = createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (path === '/api/health' && req.method === 'GET') {
        return json(res, 200, { ok: true, features: { describe: !!opts.sceneClient, gallery: true, multiplayer: true }, rooms: rooms.size });
      }
      if (path === '/api/describe' && req.method === 'POST') {
        if (!opts.sceneClient) throw new HttpError(503, 'The scene builder is not configured on this server.');
        if (!limits.describe.allow(clientIp(req))) throw new HttpError(429, 'Hourly scene-builder limit reached. Try again later.');
        const body = (await readJson(req, 8_000)) as { prompt?: unknown };
        const scene = await describeScene(opts.sceneClient, typeof body.prompt === 'string' ? body.prompt : '');
        return json(res, 200, { scene });
      }
      if (path === '/api/scenes' && req.method === 'GET') {
        const sort = url.searchParams.get('sort') === 'new' ? 'new' : 'top';
        return json(res, 200, { scenes: gallery.list(sort, Number(url.searchParams.get('limit') ?? 50)) });
      }
      if (path === '/api/scenes' && req.method === 'POST') {
        if (!limits.publish.allow(clientIp(req))) throw new HttpError(429, 'Hourly publishing limit reached.');
        const body = (await readJson(req, 2_000_000)) as { title?: unknown; author?: unknown; scene?: unknown };
        return json(res, 201, { scene: await gallery.add(body) });
      }
      const m = path.match(/^\/api\/scenes\/([A-Za-z0-9_-]{4,32})(\/vote)?$/);
      if (m && req.method === 'GET' && !m[2]) {
        const entry = gallery.get(m[1]);
        if (!entry) throw new HttpError(404, 'Scene not found.');
        return json(res, 200, { entry });
      }
      if (m && req.method === 'POST' && m[2]) {
        const ip = clientIp(req);
        if (!limits.vote.allow(ip)) throw new HttpError(429, 'Too many votes.');
        return json(res, 200, { votes: await gallery.vote(m[1], ip) });
      }
      if (path.startsWith('/api/')) throw new HttpError(404, 'Not found.');
      if (await serveStatic(req, res, path)) return;
      throw new HttpError(404, 'Not found.');
    } catch (err) {
      if (err instanceof HttpError || err instanceof SceneError || err instanceof GalleryError) return json(res, err.status, { error: err.message });
      console.error(err);
      return json(res, 500, { error: 'Internal server error.' });
    }
  });

  // Multiplayer over WebSocket at /ws?room=CODE&name=NAME
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origin = req.headers.origin;
    const room = Rooms.cleanRoom(url.searchParams.get('room'));
    if (url.pathname !== '/ws' || !room || (origin && !anyOrigin && !opts.allowedOrigins.includes(origin))) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => rooms.join(ws, room, url.searchParams.get('name') ?? ''));
  });
  server.on('close', () => wss.close());

  return { server, gallery, rooms };
}
