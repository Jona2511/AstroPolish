// Minimal assertion helper (no dependencies). Each check prints one line; summary() sets the exit code.
let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? '  (' + detail + ')' : detail && process.env.VERBOSE ? '  (' + detail + ')' : ''}`);
  return ok;
}
function summary(label) {
  console.log(`${label}: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
  return failed === 0;
}
module.exports = { check, summary };
