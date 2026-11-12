#!/usr/bin/env node
/**
 * Bundle the companion server (../server: gallery, multiplayer rooms, Claude scene builder) into
 * one CommonJS file, ./server.cjs, that the desktop app starts in-process (main.cjs). Uses the
 * rolldown bundler the web build already installs. Run `npm install` in ../server first.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
if (!existsSync(new URL('server/node_modules/ws', root))) {
  console.error('Run `npm install` in ../server first (the bundle includes its dependencies).');
  process.exit(1);
}
const require = createRequire(new URL('package.json', root));
// (A file:// URL: on Windows a bare absolute path like D:\\… is not an importable specifier.)
const { build } = await import(pathToFileURL(require.resolve('rolldown')).href);
await build({
  input: fileURLToPath(new URL('server/src/embedded.ts', root)),
  platform: 'node',
  // ws can use optional native add-ons; it works without them.
  external: ['bufferutil', 'utf-8-validate'],
  output: { file: fileURLToPath(new URL('./server.cjs', import.meta.url)), format: 'cjs', codeSplitting: false },
  logLevel: 'warn',
});
console.log('Bundled ../server into desktop/server.cjs');
