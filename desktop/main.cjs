/**
 * Astrarium for desktop (Windows, also macOS/Linux): the web app in its own Chromium window.
 *
 * Why a desktop build runs faster than a browser tab:
 * - It asks for the high-performance GPU, so laptops with two GPUs use the discrete one.
 * - The window is never throttled in the background, and GPU rasterization is on.
 * - Pages are cross-origin isolated, so the physics spreads particle forces over all CPU cores.
 * - The app detects the desktop shell and starts at high quality.
 *
 * The built web app (../dist, copied into ./web) is served from a private app:// origin, so
 * fetch() of the bundled data and the Web Worker work exactly as on the website.
 */
const { app, BrowserWindow, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WEB = path.join(__dirname, 'web');

app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#02030a',
    title: 'Astrarium',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // Links to other sites open in the user's browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  // F11: full screen.
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  void win.loadURL('app://astrarium/index.html');
  return win;
}

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = path.normalize(path.join(WEB, rel));
    // Never serve anything outside the bundled web app.
    if (file !== WEB && !file.startsWith(WEB + path.sep)) return new Response('Not found', { status: 404 });
    // Cross-origin isolation (COOP + COEP) unlocks SharedArrayBuffer, so the physics can use
    // several CPU cores (see src/sim/parallel.ts). "credentialless" still lets the page load
    // images and data from other sites (without cookies), such as a companion server.
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
