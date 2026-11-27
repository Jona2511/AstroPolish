// Tests for the Electron security helpers and settings (runs without Electron installed).
const path = require('path');
const fs = require('fs');
const { isSafeExternalUrl, resolveAppFile, ALLOWED_PERMISSIONS } = require('../electron/security.js');
const { check, summary } = require('./lib/check.js');

for (const u of ['https://github.com/Jona2511/AstroPolish', 'mailto:someone@example.com']) check(`external link allowed: ${u}`, isSafeExternalUrl(u));
for (const u of ['http://example.com', 'file:///C:/Windows/System32/calc.exe', 'ms-msdt:/id', 'javascript:alert(1)', 'smb://server/share', 'app://astropolish/index.html', 'not a url', '']) check(`external link blocked: ${u || '(empty)'}`, !isSafeExternalUrl(u));

const APP = path.join(path.sep, 'opt', 'AstroPolish', 'app');
check('app:// root maps to index.html', resolveAppFile(APP, 'app://astropolish/') === path.join(APP, 'index.html'));
check('app:// file inside app folder is served', resolveAppFile(APP, 'app://astropolish/js/app.js') === path.join(APP, 'js', 'app.js'));
for (const u of ['app://astropolish/../package.json', 'app://astropolish/%2e%2e/%2e%2e/etc/passwd', 'app://astropolish/..%2f..%2fsecret', 'app://astropolish/%2e%2e%5c..%5cwin.ini', 'app://astropolish/js/%00.js', 'app://astropolish/%E0%A4%A'])
  check(`path traversal blocked: ${u}`, resolveAppFile(APP, u) === null || resolveAppFile(APP, u).startsWith(APP + path.sep));
// regression: the old check startsWith(APP_DIR) also accepted the sibling folder '.../app-evil'
check('sibling folder with the same prefix (app-evil) is not served', resolveAppFile(APP, 'app://astropolish/%2e%2e%2fapp-evil%2fx.js') === null);
check('only file saving and clipboard-write permissions are granted', [...ALLOWED_PERMISSIONS].sort().join(',') === 'clipboard-sanitized-write,fileSystem');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
check('BrowserWindow: contextIsolation on', /contextIsolation:\s*true/.test(main));
check('BrowserWindow: nodeIntegration off', /nodeIntegration:\s*false/.test(main));
check('BrowserWindow: sandbox on', /sandbox:\s*true/.test(main));
check('BrowserWindow: no preload script / no IPC', !/preload\s*:/.test(main) && !/ipcMain/.test(main));
check('webviews are blocked', /will-attach-webview/.test(main));
check('new windows are denied', /action:\s*'deny'/.test(main));
const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
check('index.html has a Content-Security-Policy', /http-equiv="Content-Security-Policy"/.test(html) && /script-src 'self'/.test(html) && !/script-src[^;]*unsafe-inline/.test(html));
check('index.html has no inline scripts', !/<script(?![^>]*\bsrc=)[^>]*>/.test(html));
const pkg = require('../package.json');
const major = +String(pkg.devDependencies.electron).replace(/[^0-9.]/g, '').split('.')[0];
check('Electron is a supported major version (>= 43, Nov 2026)', major >= 43, pkg.devDependencies.electron);

// Native close dialog follows the app language (was always Dutch)
const { dialogLang, closeDialogText } = require('../electron/dialogs.js');
check('close dialog: Dutch for nl and nl-NL', dialogLang('nl') === 'nl' && dialogLang('nl-NL') === 'nl');
check('close dialog: English for en, en-US, other languages and empty', ['en', 'en-US', 'de', '', undefined].every((l) => dialogLang(l) === 'en'));
check('close dialog: English buttons in English', closeDialogText('en').buttons.join('|') === 'Close anyway|Cancel');
check('close dialog: Dutch buttons in Dutch', closeDialogText('nl').buttons.join('|') === 'Toch sluiten|Annuleren');
check('close dialog: both languages have the same fields', ['buttons', 'message', 'detail'].every((k) => closeDialogText('nl')[k] && closeDialogText('en')[k]));
check('close dialog: main.js uses the translated texts (no hard-coded Dutch buttons)', /closeDialogText\(/.test(main) && !/'Toch sluiten'/.test(main));

summary('ELECTRON');
