import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';

/**
 * Multiplayer relay. Each room has one host whose browser runs the authoritative
 * simulation and broadcasts state snapshots; guests run the same physics locally between
 * snapshots and send their edits to the host. The server only routes messages.
 *
 * Client → server messages:
 *   { type: 'state', state }  host only, relayed to every guest
 *   { type: 'edit', state }   from a guest: forwarded to the host; from the host: relayed to guests
 *   { type: 'chat', text }    relayed to everyone
 * Server → client messages:
 *   { type: 'welcome', id, host }  on join
 *   { type: 'peers', peers: [{ id, name, host }] }  whenever membership changes
 *   { type: 'state' | 'edit', from, state }
 *   { type: 'chat', from, name, text }
 *   { type: 'promoted' }  you became the host (the previous host left)
 */

interface Client {
  id: string;
  name: string;
  ws: WebSocket;
}

interface Room {
  clients: Client[];
}

const MAX_ROOMS = 500;
const MAX_CLIENTS = 16;

export class Rooms {
  private readonly rooms = new Map<string, Room>();

  get size(): number {
    return this.rooms.size;
  }

  static cleanRoom(code: string | null): string | undefined {
    const c = (code ?? '').trim();
    return /^[A-Za-z0-9-]{1,24}$/.test(c) ? c.toUpperCase() : undefined;
  }

  join(ws: WebSocket, roomCode: string, rawName: string): void {
    let room = this.rooms.get(roomCode);
    if (!room) {
      if (this.rooms.size >= MAX_ROOMS) return void ws.close(1013, 'Server is full');
      room = { clients: [] };
      this.rooms.set(roomCode, room);
    }
    if (room.clients.length >= MAX_CLIENTS) return void ws.close(1013, 'Room is full');
    const client: Client = {
      id: randomBytes(4).toString('hex'),
      name: (rawName || 'Explorer').replace(/[\u0000-\u001f]/g, '').slice(0, 24) || 'Explorer',
      ws,
    };
    room.clients.push(client);
    const isHost = room.clients[0] === client;
    this.send(client, { type: 'welcome', id: client.id, host: isHost });
    this.broadcastPeers(room);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg: { type?: string; state?: unknown; text?: unknown };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      const host = room!.clients[0];
      switch (msg.type) {
        case 'state':
          if (client === host) this.relay(room!, client, { type: 'state', from: client.id, state: msg.state });
          break;
        case 'edit':
          if (client === host) this.relay(room!, client, { type: 'edit', from: client.id, state: msg.state });
          else if (host) this.send(host, { type: 'edit', from: client.id, state: msg.state });
          break;
        case 'chat':
          if (typeof msg.text === 'string' && msg.text.trim()) {
            const out = { type: 'chat', from: client.id, name: client.name, text: msg.text.trim().slice(0, 300) };
            for (const c of room!.clients) this.send(c, out);
          }
          break;
      }
    });

    ws.on('close', () => {
      const wasHost = room!.clients[0] === client;
      room!.clients = room!.clients.filter((c) => c !== client);
      if (!room!.clients.length) {
        this.rooms.delete(roomCode);
        return;
      }
      if (wasHost) this.send(room!.clients[0], { type: 'promoted' });
      this.broadcastPeers(room!);
    });
  }

  private relay(room: Room, from: Client, msg: unknown): void {
    const text = JSON.stringify(msg);
    for (const c of room.clients) if (c !== from && c.ws.readyState === c.ws.OPEN) c.ws.send(text);
  }

  private send(c: Client, msg: unknown): void {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  }

  private broadcastPeers(room: Room): void {
    const peers = room.clients.map((c, i) => ({ id: c.id, name: c.name, host: i === 0 }));
    for (const c of room.clients) this.send(c, { type: 'peers', peers });
  }
}
