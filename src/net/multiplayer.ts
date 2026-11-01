import type { SimState } from '../sim/state';

/** Browser side of the multiplayer relay (see server/src/rooms.ts for the protocol). */

export interface Peer {
  id: string;
  name: string;
  host: boolean;
}

export interface MultiplayerHandlers {
  /** Authoritative snapshot from the host (guests only). */
  onState(state: SimState): void;
  /** An edit made by someone else. Hosts apply it; guests also see the host's edits here. */
  onEdit(state: SimState, from: string): void;
  onPeers(peers: Peer[]): void;
  onRole(host: boolean): void;
  onChat(name: string, text: string): void;
  onClose(reason: string): void;
}

export class Multiplayer {
  private ws?: WebSocket;
  id = '';
  host = false;
  peers: Peer[] = [];
  room = '';
  private readonly handlers: MultiplayerHandlers;

  constructor(handlers: MultiplayerHandlers) {
    this.handlers = handlers;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(wsUrl: string, room: string, name: string): Promise<void> {
    this.disconnect();
    this.room = room.toUpperCase();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsUrl}?room=${encodeURIComponent(this.room)}&name=${encodeURIComponent(name)}`);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onerror = () => {
        if (!opened) reject(new Error('Could not connect to the multiplayer server.'));
      };
      ws.onclose = (e) => {
        if (this.ws === ws) {
          this.ws = undefined;
          this.handlers.onClose(e.reason || 'Disconnected');
        }
      };
      ws.onmessage = (e) => {
        let msg: { type: string; [k: string]: unknown };
        try {
          msg = JSON.parse(String(e.data));
        } catch {
          return;
        }
        switch (msg.type) {
          case 'welcome':
            this.id = String(msg.id);
            this.host = !!msg.host;
            this.handlers.onRole(this.host);
            break;
          case 'promoted':
            this.host = true;
            this.handlers.onRole(true);
            break;
          case 'peers':
            this.peers = msg.peers as Peer[];
            this.handlers.onPeers(this.peers);
            break;
          case 'state':
            if (!this.host) this.handlers.onState(msg.state as SimState);
            break;
          case 'edit':
            this.handlers.onEdit(msg.state as SimState, String(msg.from));
            break;
          case 'chat':
            this.handlers.onChat(String(msg.name), String(msg.text));
            break;
        }
      };
    });
  }

  disconnect(): void {
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
    this.peers = [];
    this.host = false;
  }

  private send(msg: unknown): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  /** Host: broadcast the authoritative state. */
  sendState(state: SimState): void {
    if (this.host) this.send({ type: 'state', state });
  }

  /** Anyone: share a change you made (guests' edits go to the host). */
  sendEdit(state: SimState): void {
    this.send({ type: 'edit', state });
  }

  chat(text: string): void {
    this.send({ type: 'chat', text });
  }
}
