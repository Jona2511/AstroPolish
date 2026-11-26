// Dependency-free "lint": syntax check of every JS file, plus a few project rules.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { check, summary } = require('./lib/check.js');
const ROOT = path.join(__dirname, '..');
const files = [];
for (const dir of ['app/js', 'electron', 'test', 'test/lib']) for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.js')) files.push(path.join(dir, f));
for (const f of files) {
  let ok = true, msg = '';
  try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); } catch (e) { ok = false; msg = String(e.stderr).split('\n').slice(0, 4).join(' '); }
  check(`syntax: ${f}`, ok, msg);
}
for (const f of files.filter((x) => x.startsWith('app/') || x.startsWith('electron/'))) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  check(`no 'debugger' statement: ${f}`, !/\bdebugger\b/.test(src));
  check(`strict mode or module: ${f}`, /'use strict'/.test(src) || f.startsWith('electron/') || f.endsWith('worker.js'));
  check(`no eval/new Function: ${f}`, !/\beval\s*\(|new Function\s*\(/.test(src));
}
const pkg = require('../package.json');
const app = fs.readFileSync(path.join(ROOT, 'app/js/app.js'), 'utf8');
const v = (app.match(/APP_VERSION = '([^']+)'/) || [])[1];
check('app version (app.js) matches package.json', v === pkg.version, `${v} vs ${pkg.version}`);
check('licence is MIT and LICENSE file present', pkg.license === 'MIT' && fs.existsSync(path.join(ROOT, 'LICENSE')));
check('no runtime dependencies (app ships without node_modules)', !pkg.dependencies || Object.keys(pkg.dependencies).length === 0);
summary('LINT');
