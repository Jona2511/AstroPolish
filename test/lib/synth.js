// Deterministic synthetic astro data with known ground truth (for algorithm tests).
// NOTE: synthetic data proves mathematical properties; it does not replace tests on real
// telescope data (see test/README.md, "Tests met echte data").
const E = require('../../app/js/engine.js');

function rng(seed) {
  let s = seed >>> 0 || 1;
  const u = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = () => { let a = 0; while (a === 0) a = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u()); };
  return { u, n };
}

const geom = (img) => Object.assign(img, { scale: 1, x0: 0, y0: 0, fullW: img.w, fullH: img.h, meta: img.meta || { linear: true } });

// Linear star field: background (+ optional gradient and colour cast), gaussian stars, gaussian noise.
function starField(o) {
  o = Object.assign({ w: 400, h: 300, bg: [0.05, 0.05, 0.05], grad: 0, noise: 0.002, stars: 60, sigma: 1.6, seed: 1, peak: [0.05, 0.6], nebula: 0 }, o);
  const R = rng(o.seed), img = geom(E.newImage(o.w, o.h));
  const list = [];
  for (let k = 0; k < o.stars; k++) list.push({ x: 8 + R.u() * (o.w - 16), y: 8 + R.u() * (o.h - 16), a: o.peak[0] + (o.peak[1] - o.peak[0]) * R.u() ** 2, col: [1, 0.9 + 0.2 * R.u(), 0.8 + 0.4 * R.u()] });
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
    const i = y * o.w + x, g = o.grad * (x / o.w);
    const neb = o.nebula ? o.nebula * Math.exp(-(((x - o.w / 2) / (o.w / 5)) ** 2 + ((y - o.h / 2) / (o.h / 5)) ** 2)) : 0;
    img.r[i] = o.bg[0] + g + neb; img.g[i] = o.bg[1] + g + neb * 0.3; img.b[i] = o.bg[2] + g + neb * 0.4;
  }
  for (const s of list) {
    const r = Math.ceil(o.sigma * 5);
    for (let y = Math.max(0, Math.floor(s.y - r)); y <= Math.min(o.h - 1, Math.ceil(s.y + r)); y++) for (let x = Math.max(0, Math.floor(s.x - r)); x <= Math.min(o.w - 1, Math.ceil(s.x + r)); x++) {
      const v = s.a * Math.exp(-((x - s.x) ** 2 + (y - s.y) ** 2) / (2 * o.sigma * o.sigma)), i = y * o.w + x;
      img.r[i] += v * s.col[0]; img.g[i] += v * s.col[1]; img.b[i] += v * s.col[2];
    }
  }
  const truth = E.cloneImage(img);
  if (o.noise) for (const c of ['r', 'g', 'b']) for (let i = 0; i < img[c].length; i++) img[c][i] = Math.max(0, img[c][i] + o.noise * R.n());
  return { img, truth: geom(truth), stars: list };
}

// statistics helpers
const mean = (a, idx) => { let s = 0, n = 0; if (idx) for (const i of idx) { s += a[i]; n++; } else for (const v of a) { s += v; n++; } return s / n; };
const std = (a, idx) => { const m = mean(a, idx); let s = 0, n = 0; const f = (v) => { s += (v - m) ** 2; n++; }; if (idx) for (const i of idx) f(a[i]); else for (const v of a) f(v); return Math.sqrt(s / n); };
const median = (vals) => { const s = Float64Array.from(vals).sort(); return s.length ? s[s.length >> 1] : NaN; };
// indices of pixels farther than d from every star (pure background)
function bgIndex(w, h, stars, d) {
  const out = [];
  for (let y = 4; y < h - 4; y++) for (let x = 4; x < w - 4; x++) if (stars.every((s) => (s.x - x) ** 2 + (s.y - y) ** 2 > d * d)) out.push(y * w + x);
  return out;
}
// second-moment FWHM of a star in channel arrays, background subtracted
function fwhmAt(a, w, h, sx, sy, bg, r) {
  r = r || 6;
  let s = 0, sxx = 0;
  for (let y = Math.round(sy) - r; y <= Math.round(sy) + r; y++) for (let x = Math.round(sx) - r; x <= Math.round(sx) + r; x++) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const v = Math.max(0, a[y * w + x] - bg);
    s += v; sxx += v * (((x - sx) ** 2 + (y - sy) ** 2) / 2);
  }
  return s > 0 ? 2.3548 * Math.sqrt(sxx / s) : NaN;
}
const finite01 = (img) => ['r', 'g', 'b'].every((k) => img[k].every((v) => Number.isFinite(v) && v >= 0 && v <= 1));

module.exports = { rng, geom, starField, mean, std, median, bgIndex, fwhmAt, finite01 };
