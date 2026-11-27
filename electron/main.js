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
const { closeDialogText } = require('./dialogs.js');

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
  // the close silently in that case, so ask the user here, in the language the app is shown in
  // (app.js keeps <html lang> up to date). Reading that language is asynchronous, so the close is
  // cancelled first and the window is destroyed afterwards if the user chooses to close anyway.
  let closing = false; // set when the window (not a reload) is being closed
  let asking = false;  // a close dialog is already open
  let uiLang = app.getLocale();
  win.on('close', () => { closing = true; });
  win.webContents.on('will-prevent-unload', (e) => {
    if (!closing) {
      // Not a window close (for example a reload): ask synchronously with the last known language.
      const t = closeDialogText(uiLang);
      const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: t.buttons, defaultId: 1, cancelId: 1, title: 'AstroPolish', message: t.message, detail: t.detail });
      if (choice === 0) e.preventDefault(); // preventDefault here means: ignore beforeunload and continue
      return;
    }
    closing = false;
    if (asking) return;
    asking = true;
    win.webContents.executeJavaScript('document.documentElement.lang', true)
      .catch(() => uiLang)
      .then((lang) => {
        if (lang) uiLang = lang;
        const t = closeDialogText(uiLang);
        return dialog.showMessageBox(win, { type: 'question', buttons: t.buttons, defaultId: 1, cancelId: 1, title: 'AstroPolish', message: t.message, detail: t.detail });
      })
      .then(({ response }) => {
        asking = false;
        if (response !== 0) { quitting = false; return; } // Cancel also cancels a pending quit
        if (win.isDestroyed()) return;
        win.destroy(); // closes without running beforeunload again
        if (quitting) app.quit(); // continue a quit (Cmd+Q) that this dialog interrupted
      })
      .catch(() => { asking = false; });
  });
}

// Set when the user quits the app (for example Cmd+Q on macOS), so a confirmed close dialog can finish the quit.
let quitting = false;
app.on('before-quit', () => { quitting = true; });

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

