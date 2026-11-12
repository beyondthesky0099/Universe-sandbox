import { captureState, restoreState } from '../sim/state';
import { $, escapeHtml, toast } from '../ui/dom';
import { prefs } from '../ui/galaxyStore';
import { buildFromSpec } from '../game/sceneSpec';
import { ServerClient } from '../net/server';
import { type Peer } from '../net/multiplayer';
import type { SimState } from '../sim/state';
import type { App } from '../app';

/** The companion server: the Claude scene builder, the gallery and multiplayer rooms. */
export class OnlineUI {
  constructor(private readonly app: App) {}

  /** Connect to a companion server; `remember` keeps it as the user's choice for next time. */
  async connectServer(url: string, announce = true, remember = true): Promise<void> {
    const status = $('server-status');
    try {
      const client = new ServerClient(url);
      const features = await client.health();
      this.app.server = client;
      if (remember) prefs.set('serverUrl', url);
      $<HTMLInputElement>('server-url').value = url;
      const on = Object.entries(features).filter(([, v]) => v).map(([k]) => k);
      status.textContent = `Connected: ${on.join(', ') || 'no features'}.`;
      $('describe-status').textContent = features.describe ? '' : 'This server has the scene builder turned off.';
      if (announce) toast('Connected to the Astrarium server');
    } catch (err) {
      this.app.server = undefined;
      status.textContent = (err as Error).message;
      if (announce) toast((err as Error).message);
    }
  }

  requireServer(): ServerClient | undefined {
    if (this.app.server) return this.app.server;
    toast('Connect a companion server first (Settings → Server).');
    if (document.body.classList.contains('panels-hidden')) document.body.classList.remove('panels-hidden');
    $('server-url').focus();
    return undefined;
  }

  async describeScene(): Promise<void> {
    const server = this.requireServer();
    const prompt = $<HTMLTextAreaElement>('describe-input').value.trim();
    if (!server) return;
    if (!prompt) return void toast('Describe the scene you want first.');
    const btn = $<HTMLButtonElement>('btn-describe');
    btn.disabled = true;
    $('describe-status').textContent = 'Claude is designing your scene…';
    try {
      const spec = await server.describe(prompt);
      this.app.loadScenario({ name: spec.title, description: spec.summary, load: () => buildFromSpec(this.app.sim, spec) });
      this.app.syncSettingsUi();
      $('describe-status').textContent = `Built “${spec.title}” with ${spec.bodies.length} bodies.`;
    } catch (err) {
      $('describe-status').textContent = (err as Error).message;
    } finally {
      btn.disabled = false;
    }
  }

  async openGallery(): Promise<void> {
    const server = this.requireServer();
    if (!server) return;
    $('gallery-modal').classList.remove('hidden');
    $('gallery-status').textContent = 'Loading…';
    try {
      const sort = $<HTMLSelectElement>('gallery-sort').value as 'top' | 'new';
      const scenes = await server.listScenes(sort);
      $('gallery-status').textContent = scenes.length ? '' : 'No scenes yet: publish the first one!';
      $('gallery-list').innerHTML = scenes
        .map(
          (s) =>
            `<div class="card"><h3>${escapeHtml(s.title)}</h3><p>by ${escapeHtml(s.author)} · ${s.bodies} bodies · ${new Date(s.created).toLocaleDateString()}</p><div class="row"><button data-vote="${s.id}" title="Upvote">▲ ${s.votes}</button><span style="flex:1"></span><button class="primary" data-load="${s.id}">Load</button></div></div>`,
        )
        .join('');
    } catch (err) {
      $('gallery-status').textContent = (err as Error).message;
    }
  }

  async publishScene(): Promise<void> {
    const server = this.requireServer();
    if (!server) return;
    const title = $<HTMLInputElement>('publish-name').value.trim() || this.app.scenario.name;
    const author = $<HTMLInputElement>('publish-author').value.trim();
    prefs.set('author', author);
    try {
      await server.publish(title, author, this.app.makeSceneFile(true));
      $('publish-modal').classList.add('hidden');
      toast('Published to the gallery!');
    } catch (err) {
      toast((err as Error).message);
    }
  }

  openMultiplayer(): void {
    $('mp-modal').classList.remove('hidden');
    const room = $<HTMLInputElement>('mp-room');
    if (!room.value) room.value = Math.random().toString(36).slice(2, 8).toUpperCase();
    const name = $<HTMLInputElement>('mp-name');
    if (!name.value) name.value = prefs.get('author', '') || `Explorer ${Math.floor(Math.random() * 900 + 100)}`;
    if (this.app.mp.connected) $('mp-status').textContent = `Connected to room ${this.app.mp.room} as ${this.app.mp.host ? 'host' : 'guest'}.`;
  }

  async joinRoom(): Promise<void> {
    const server = this.requireServer();
    if (!server) return;
    const room = $<HTMLInputElement>('mp-room').value.trim();
    const name = $<HTMLInputElement>('mp-name').value.trim();
    if (!/^[A-Za-z0-9-]{1,24}$/.test(room)) return void toast('Room codes use letters, digits and dashes.');
    prefs.set('author', name);
    $('mp-status').textContent = 'Connecting…';
    try {
      await this.app.mp.connect(server.wsUrl, room, name);
      $('btn-mp').classList.add('active');
      if (this.app.view !== 'system') this.app.setView('system');
    } catch (err) {
      $('mp-status').textContent = (err as Error).message;
    }
  }

  renderPeers(peers: Peer[]): void {
    const before = new Set(($('mp-peers').dataset.ids ?? '').split(',').filter(Boolean));
    for (const p of peers) if (before.size && !before.has(p.id) && p.id !== this.app.mp.id) toast(`${p.name} joined`);
    $('mp-peers').dataset.ids = peers.map((p) => p.id).join(',');
    $('mp-peers').innerHTML = peers
      .map((p) => `<li><span>${escapeHtml(p.name)}${p.id === this.app.mp.id ? ' (you)' : ''}</span><span class="muted">${p.host ? 'host' : 'guest'}</span></li>`)
      .join('');
    // A newly joined guest should get the scene right away.
    if (this.app.mp.host && peers.length > before.size) this.app.mpTimer = 0;
  }

  /** State to broadcast: bodies and a capped set of particles, plus the host's clock settings. */
  syncState(): SimState {
    const state = captureState(this.app.sim, { json: true, particles: this.app.sim.particles.count <= 2500 });
    (state as SimState & { view?: unknown }).view = { timeScale: this.app.timeScale, running: this.app.running };
    return state;
  }

  applyRemoteState(state: SimState): void {
    const view = (state as SimState & { view?: { timeScale: number; running: boolean } }).view;
    const forces = this.app.sim.customForces;
    restoreState(this.app.sim, state);
    this.app.sim.customForces = forces;
    this.app.host.commit();
    if (view && !this.app.mp.host) {
      if (Math.abs(view.timeScale - this.app.timeScale) > 1e-9) this.app.setTimeScale(view.timeScale);
      if (view.running !== this.app.running) this.app.setRunning(view.running);
    }
    if (this.app.system.selectedId !== undefined && !this.app.sim.getBody(this.app.system.selectedId)) this.app.hideBodyPanel();
  }

  /** Share a local change with the room (guests' changes go to the host, which rebroadcasts). */
  shareEdit(): void {
    if (this.app.mp.connected) this.app.mp.sendEdit(this.syncState());
  }
}
