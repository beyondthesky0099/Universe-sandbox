#!/usr/bin/env node
/** Copy the built web app (../dist, from `npm run build` at the repo root) into ./web for packaging. */
import { cpSync, existsSync, rmSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const web = new URL('./web/', import.meta.url);
if (!existsSync(new URL('index.html', dist))) {
  console.error('No ../dist/index.html: run `npm run build` in the repository root first.');
  process.exit(1);
}
rmSync(web, { recursive: true, force: true });
cpSync(dist, web, { recursive: true });
console.log('Copied dist/ to desktop/web/');
