import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { createApp } from '../src/app.ts';
import { MODEL, sanitizeScene, type SceneClient, type SceneSpecT } from '../src/scene.ts';

const sampleScene: SceneSpecT = {
  title: 'Twin suns',
  summary: 'Two stars and a planet.',
  timeScale: 0.5,
  cameraDistance: 12,
  relativity: false,
  bodies: [
    { name: 'Alpha', kind: 'star', mass: 1, massUnit: 'sun', orbits: '', a: 0, e: 0, inclinationDeg: 0, phaseDeg: 0, x: 0, z: 0, vx: 0, vz: 0, color: '' },
    { name: 'Beta', kind: 'star', mass: 0.5, massUnit: 'sun', orbits: 'Alpha', a: 0.6, e: 0.1, inclinationDeg: 0, phaseDeg: 0, x: 0, z: 0, vx: 0, vz: 0, color: '' },
    { name: 'Tess', kind: 'rocky', mass: 1, massUnit: 'earth', orbits: 'Alpha', a: 3, e: 0, inclinationDeg: 2, phaseDeg: 90, x: 0, z: 0, vx: 0, vz: 0, color: '#3f78c8' },
  ],
};

/** A fake Anthropic client that records the request and returns a canned parsed response. */
function fakeClient(reply: { stop_reason: string; parsed_output: SceneSpecT | null }) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          return reply;
        },
      },
    },
  } as unknown as SceneClient;
  return { client, calls };
}

async function start(sceneClient?: SceneClient, origins = ['*']) {
  const dir = await mkdtemp(join(tmpdir(), 'astrarium-'));
  const app = await createApp({ sceneClient, dataDir: dir, allowedOrigins: origins, limits: { describe: 2 } });
  await new Promise<void>((r) => app.server.listen(0, r));
  const port = (app.server.address() as AddressInfo).port;
  return { ...app, base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws` };
}

describe('scene builder endpoint', () => {
  it('calls Claude with structured output and fallbacks, and returns a sanitized scene', async () => {
    const { client, calls } = fakeClient({ stop_reason: 'end_turn', parsed_output: sampleScene });
    const app = await start(client);
    const res = await fetch(`${app.base}/api/describe`, { method: 'POST', body: JSON.stringify({ prompt: 'two suns and an earth' }) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { scene: SceneSpecT };
    assert.equal(body.scene.bodies.length, 3);
    assert.equal(calls[0].model, MODEL);
    assert.equal(calls[0].fallbacks, 'default');
    assert.deepEqual(calls[0].betas, ['server-side-fallback-2026-07-01']);
    assert.ok((calls[0].output_config as { format: unknown }).format);
    app.server.close();
  });

  it('reports refusals, empty prompts, missing configuration and rate limits', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal', parsed_output: null });
    const app = await start(client);
    const post = (prompt: string) => fetch(`${app.base}/api/describe`, { method: 'POST', body: JSON.stringify({ prompt }) });
    assert.equal((await post('')).status, 400);
    assert.equal((await post('something')).status, 422);
    assert.equal((await post('again')).status, 429); // limit of 2 per hour in this test
    app.server.close();
    const bare = await start();
    assert.equal((await fetch(`${bare.base}/api/describe`, { method: 'POST', body: '{"prompt":"x"}' })).status, 503);
    const health = (await (await fetch(`${bare.base}/api/health`)).json()) as { features: { describe: boolean } };
    assert.equal(health.features.describe, false);
    bare.server.close();
  });

  it('sanitizes out-of-range values and unknown parents', () => {
    const clean = sanitizeScene({
      ...sampleScene,
      timeScale: 1e9,
      bodies: [
        { ...sampleScene.bodies[0], mass: -5 },
        { ...sampleScene.bodies[2], orbits: 'Nowhere', e: 3, color: 'red' },
        { ...sampleScene.bodies[2] }, // duplicate name dropped
      ],
    });
    assert.equal(clean.timeScale, 50);
    assert.equal(clean.bodies.length, 2);
    assert.ok(clean.bodies[0].mass > 0);
    assert.equal(clean.bodies[1].orbits, '');
    assert.equal(clean.bodies[1].e, 0.95);
    assert.equal(clean.bodies[1].color, '');
  });
});

describe('gallery', () => {
  let app: Awaited<ReturnType<typeof start>>;
  before(async () => (app = await start()));
  after(() => app.server.close());

  const scene = { app: 'astrarium', version: 1, savedAt: '', timeScale: 1, state: { format: 'astrarium-scene', version: 1, time: 0, settings: {}, bodies: [{ id: 1 }] } };

  it('publishes, lists, fetches and votes once per visitor', async () => {
    const res = await fetch(`${app.base}/api/scenes`, { method: 'POST', body: JSON.stringify({ title: 'My <b>scene</b>', author: 'Ada', scene }) });
    assert.equal(res.status, 201);
    const { scene: summary } = (await res.json()) as { scene: { id: string; title: string } };
    const list = (await (await fetch(`${app.base}/api/scenes?sort=new`)).json()) as { scenes: { id: string }[] };
    assert.equal(list.scenes[0].id, summary.id);
    const full = (await (await fetch(`${app.base}/api/scenes/${summary.id}`)).json()) as { entry: { scene: typeof scene } };
    assert.equal(full.entry.scene.app, 'astrarium');
    const v1 = (await (await fetch(`${app.base}/api/scenes/${summary.id}/vote`, { method: 'POST' })).json()) as { votes: number };
    const v2 = (await (await fetch(`${app.base}/api/scenes/${summary.id}/vote`, { method: 'POST' })).json()) as { votes: number };
    assert.equal(v1.votes, 1);
    assert.equal(v2.votes, 1);
  });

  it('rejects things that are not scenes', async () => {
    const res = await fetch(`${app.base}/api/scenes`, { method: 'POST', body: JSON.stringify({ title: 'x', scene: { hello: 1 } }) });
    assert.equal(res.status, 400);
    assert.equal((await fetch(`${app.base}/api/scenes/nope1234`)).status, 404);
  });

  it('applies CORS only for allowed origins', async () => {
    const strict = await start(undefined, ['https://ok.example']);
    const ok = await fetch(`${strict.base}/api/health`, { headers: { Origin: 'https://ok.example' } });
    const bad = await fetch(`${strict.base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://ok.example');
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
    strict.server.close();
  });
});

describe('multiplayer rooms', () => {
  it('relays host state to guests, guest edits to the host, and promotes a new host', async () => {
    const app = await start();
    const connect = (name: string) =>
      new Promise<{ ws: WebSocket; inbox: Record<string, unknown>[] }>((resolve) => {
        const ws = new WebSocket(`${app.ws}?room=test-1&name=${name}`);
        const inbox: Record<string, unknown>[] = [];
        ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
        ws.on('open', () => resolve({ ws, inbox }));
      });
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const host = await connect('Host');
    const guest = await connect('Guest');
    await wait(100);
    assert.equal(host.inbox.find((m) => m.type === 'welcome')?.host, true);
    assert.equal(guest.inbox.find((m) => m.type === 'welcome')?.host, false);
    host.ws.send(JSON.stringify({ type: 'state', state: { t: 1 } }));
    guest.ws.send(JSON.stringify({ type: 'edit', state: { t: 2 } }));
    guest.ws.send(JSON.stringify({ type: 'state', state: { t: 99 } })); // ignored: guests can't broadcast state
    await wait(150);
    assert.deepEqual(guest.inbox.filter((m) => m.type === 'state').map((m) => m.state), [{ t: 1 }]);
    assert.deepEqual(host.inbox.filter((m) => m.type === 'edit').map((m) => m.state), [{ t: 2 }]);
    host.ws.close();
    await wait(150);
    assert.ok(guest.inbox.some((m) => m.type === 'promoted'));
    guest.ws.close();
    app.server.close();
  });
});
