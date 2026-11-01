import { isSimState, type SimState } from '../sim/state';

export interface SceneFile {
  app: 'astrarium';
  version: 1;
  savedAt: string;
  name?: string;
  timeScale: number;
  camera?: { position: [number, number, number]; target: [number, number, number] };
  state: SimState;
}

export function isSceneFile(v: unknown): v is SceneFile {
  return typeof v === 'object' && v !== null && (v as SceneFile).app === 'astrarium' && isSimState((v as SceneFile).state);
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Encode a scene into a compact URL-safe string (deflate when available). */
export async function encodeScene(scene: SceneFile): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(scene));
  if (typeof CompressionStream !== 'undefined') return `z${toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
  return `j${toBase64Url(bytes)}`;
}

export async function decodeScene(code: string): Promise<SceneFile> {
  const kind = code[0];
  let bytes = fromBase64Url(code.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'j') throw new Error('Unknown scene encoding');
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isSceneFile(parsed)) throw new Error('Not an Astrarium scene');
  return parsed;
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readSceneFile(file: File): Promise<SceneFile> {
  const parsed: unknown = JSON.parse(await file.text());
  if (isSceneFile(parsed)) return parsed;
  // Accept a bare SimState too.
  if (isSimState(parsed)) return { app: 'astrarium', version: 1, savedAt: '', timeScale: 0.3, state: parsed };
  throw new Error('That file is not an Astrarium scene.');
}
