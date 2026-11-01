import Anthropic from '@anthropic-ai/sdk';
import { createApp } from './app.ts';

/**
 * Astrarium companion server: community gallery, multiplayer rooms, and the Claude-powered
 * scene builder. Configure with environment variables:
 *
 *   PORT                 (default 8787)
 *   DATA_DIR             where gallery.json is stored (default ./data)
 *   ALLOWED_ORIGINS      comma-separated browser origins, e.g. https://you.github.io (default *)
 *   STATIC_DIR           serve the built web app too (e.g. ../dist)
 *   ANTHROPIC_API_KEY    enables the scene builder (any credential the Anthropic SDK accepts works)
 *   DESCRIBE_PER_HOUR    scene-builder requests per visitor per hour (default 20)
 */

const hasCredentials = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
const sceneClient = hasCredentials || process.env.ENABLE_SCENE_BUILDER === '1' ? new Anthropic() : undefined;

const { server } = await createApp({
  sceneClient,
  dataDir: process.env.DATA_DIR ?? './data',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
  staticDir: process.env.STATIC_DIR,
  limits: { describe: Number(process.env.DESCRIBE_PER_HOUR ?? 20) },
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`Astrarium server on http://localhost:${port}`);
  console.log(`  scene builder: ${sceneClient ? 'enabled' : 'disabled (set ANTHROPIC_API_KEY)'}`);
  console.log(`  allowed origins: ${process.env.ALLOWED_ORIGINS ?? '*'}`);
});
