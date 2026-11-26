// AstroPolish desktop app (Electron). Serves the web app from a private app:// scheme
// so the background worker and file saving work exactly like in the browser.
//
// Security model: the renderer is sandboxed, has no Node.js access, no preload script and no IPC.
// It can only load files from the app folder; every other navigation is blocked and only
// https/mailto links are handed to the system browser.
const { app, BrowserWindow, protocol, net, shell, Menu, dialog, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { isSafeExternalUrl, resolveAppFile, ALLOWED_PERMISSIONS } = require('./security.js');

const APP_DIR = path.join(__dirname, '..', 'app');
const ORIGIN = 'app://astropolish';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function openExternalSafely(url) { if (isSafeExternalUrl(url)) shell.openExternal(new URL(url).toString()); }

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#07080f',
    title: 'AstroPolish',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  win.loadURL(ORIGIN + '/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafely(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) { e.preventDefault(); openExternalSafely(url); }
  });
  // The page asks before closing when there are unsaved edits (beforeunload). Electron cancels
  // the close silently in that case, so ask the user here.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Toch sluiten', 'Annuleren'], defaultId: 1, cancelId: 1,
      title: 'AstroPolish', message: 'Er zijn bewerkingen die nog niet zijn geëxporteerd of als project opgeslagen.',
      detail: 'Wil je AstroPolish toch sluiten? Niet-opgeslagen bewerkingen gaan dan verloren.',
    });
    if (choice === 0) e.preventDefault(); // preventDefault here means: ignore beforeunload and close
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const file = resolveAppFile(APP_DIR, req.url);
    if (!file) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Deny every permission except writing files chosen in the save dialog and the clipboard
  // (used to copy error details).
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(ALLOWED_PERMISSIONS.has(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  // Windows/Linux: no menu bar (the app has its own). macOS always shows a menu bar and needs the
  // standard app/edit/window menus for Cmd+Q, Cmd+C/V in text fields, Cmd+M and so on.
  Menu.setApplicationMenu(process.platform === 'darwin'
    // Undo/redo/select-all are left out on purpose: the app handles Cmd+Z, Shift+Cmd+Z and Cmd+A itself.
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }] }, { role: 'windowMenu' }])
    : null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// No <webview> tags and no extra windows, whatever the page tries.
app.on('web-contents-created', (e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

