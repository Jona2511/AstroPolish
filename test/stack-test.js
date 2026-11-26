// Node test: stacking aligns a shifted + rotated copy of the demo image
const E = require('../app/js/engine.js');
const S = require('../app/js/stack.js');
const base = E.makeDemo(1400, 900, 3);
function transformed(img, dx, dy, deg, seed) {
  const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const out = E.newImage(img.w, img.h, img);
  const cx = img.w / 2, cy = img.h / 2;
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const X = x - cx - dx, Y = y - cy - dy;
    const sx = ca * X + sa * Y + cx, sy = -sa * X + ca * Y + cy;
    const i = y * img.w + x;
    for (const c of ['r', 'g', 'b']) out[c][i] = Math.max(0, E.sampleBilinear(img[c], img.w, img.h, sx, sy)) + rnd() * 0.004;
  }
  return out;
}
const state = { stack: {} };
const r1 = S.add(state, base);
const r2 = S.add(state, transformed(base, 23.5, -14.2, 1.7, 5));
const r3 = S.add(state, transformed(base, -8, 31, -2.4, 9));
console.log(JSON.stringify([r1, r2, r3]));
const out = S.finish(state);
// compare with base in the center
let err = 0, n = 0;
for (let y = 300; y < 600; y++) for (let x = 400; x < 1000; x++) { const i = y * out.w + x; err += Math.abs(out.g[i] - base.g[i]); n++; }
console.log('mean abs diff', (err / n).toFixed(5));
const ok = r2.ok && r3.ok && Math.abs(r2.shift[0] - 0) < 100 && err / n < 0.004;
console.log(ok ? 'STACK OK' : 'STACK FAIL');
process.exit(ok ? 0 : 1);
