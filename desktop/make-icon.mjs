#!/usr/bin/env node
/**
 * Render desktop/icon.svg to desktop/icon.png (512×512, transparent), used by electron-builder
 * for the Windows icon. Needs Playwright with Chromium (preinstalled in the dev container).
 *
 *   node desktop/make-icon.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = createRequire('/tmp/x.js')('playwright');
}
const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8');
const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator('svg').screenshot({ path: new URL('./icon.png', import.meta.url).pathname, omitBackground: true });
await browser.close();
console.log('icon.png written');
