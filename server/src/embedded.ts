import Anthropic from '@anthropic-ai/sdk';
import type { Server } from 'node:http';
import { createApp } from './app.ts';

/**
 * The server inside the desktop app (desktop/main.cjs, bundled by desktop/build-server.mjs):
 * the same gallery, rooms and scene builder as src/index.ts, listening on 127.0.0.1 only, on a
 * free port. The scene builder is on when Anthropic credentials are in the environment.
 */
export async function startEmbedded(opts: { dataDir: string; allowedOrigins: string[] }): Promise<{ server: Server; url: string }> {
  const hasCredentials = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
  const { server } = await createApp({ sceneClient: hasCredentials ? new Anthropic() : undefined, dataDir: opts.dataDir, allowedOrigins: opts.allowedOrigins });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}` };
}
