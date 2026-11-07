import { defineConfig } from 'vitest/config';

// Cross-origin isolation (COOP + COEP) lets the physics worker share memory with helper threads
// for multi-core particle forces. GitHub Pages can't send these headers, so the website stays
// single-threaded; the dev and preview servers (and the desktop app) send them.
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' };

export default defineConfig({
  base: './',
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
