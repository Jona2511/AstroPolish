// Pure helpers for the Electron main process (no Electron imports, so they can be unit-tested).
const path = require('path');

// Only plain web links and e-mail addresses may be opened outside the app.
function isSafeExternalUrl(url) {
  try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'mailto:'; } catch (e) { return false; }
}

// Resolve an app:// URL to a file inside appDir, or null if it would point outside it.
function resolveAppFile(appDir, reqUrl) {
  let pathname;
  try { pathname = new URL(reqUrl).pathname; } catch (e) { return null; }
  let rel;
  try { rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); } catch (e) { return null; }
  if (rel.includes('\0')) return null;
  const file = path.normalize(path.join(appDir, rel));
  return file === appDir || file.startsWith(appDir + path.sep) ? file : null;
}

const ALLOWED_PERMISSIONS = new Set(['fileSystem', 'clipboard-sanitized-write']);

module.exports = { isSafeExternalUrl, resolveAppFile, ALLOWED_PERMISSIONS };
