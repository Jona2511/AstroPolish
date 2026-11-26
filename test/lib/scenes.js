// Realistic synthetic LINEAR scenes (as a smart telescope delivers a stacked FITS), with ground truth.
// They imitate the things that make automatic processing hard on real data:
//   - a sky background with a warm light-pollution gradient and shot noise (variance grows with signal)
//   - objects whose brightness spans 3-4 orders of magnitude (a nearly saturated core, faint outer
//     structure at only 1-3x the noise level per pixel)
//   - emission colours (H-alpha red, OIII teal), galaxy colours (yellow core, blue arms), star colours
//   - many stars with a power-law brightness distribution, a few saturated ones
// Each scene returns { img, signal, regions } where `signal` is the noise-free object luminance
// (without background and stars) and `regions` are pixel index lists used by the quality metrics.
// NOTE: synthetic data cannot replace real telescope files (see test/README.md).
const E = require('../../app/js/engine.js');
const { rng, geom } = require('./synth.js');

function smoothNoise(R, w, h, scale, octaves) {
  // value noise: sum of bilinearly interpolated random grids
  const out = new Float32Array(w * h);
  let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const s = scale / 2 ** o, gx = Math.ceil(w / s) + 2, gy = Math.ceil(h / s) + 2;
    const g = new Float32Array(gx * gy).map(() => R.u() * 2 - 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = x / s, fy = y / s, x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
      const a = g[y0 * gx + x0] * (1 - tx) + g[y0 * gx + x0 + 1] * tx, b = g[(y0 + 1) * gx + x0] * (1 - tx) + g[(y0 + 1) * gx + x0 + 1] * tx;
      out[y * w + x] += amp * (a * (1 - ty) + b * ty);
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function scene(kind, o) {
  o = Object.assign({ w: 720, h: 480, seed: 7 }, o);
  const { w, h } = o, n = w * h, R = rng(o.seed + kind.length * 101);
  const img = geom(E.newImage(w, h));
  const sig = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) };
  const cx = w * 0.52, cy = h * 0.5, S = Math.min(w, h);
  const tex = smoothNoise(R, w, h, S / 6, 4), tex2 = smoothNoise(R, w, h, S / 14, 3);
  const put = (i, l, col) => { sig.r[i] += l * col[0]; sig.g[i] += l * col[1]; sig.b[i] += l * col[2]; };
  // ---- objects (noise-free, linear, in units of the full 0..1 range)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, dx = (x - cx) / S, dy = (y - cy) / S, r = Math.hypot(dx, dy);
    if (kind === 'm42' || kind === 'dualband' || kind === 'mono') {
      // bright compact core + mid nebula + very faint, extended, textured outer nebula
      const core = 0.75 * Math.exp(-r / 0.025);
      const mid = 0.05 * Math.exp(-r / 0.09) * (0.75 + 0.5 * tex2[i]);
      const faint = 0.006 * Math.exp(-r / 0.32) * Math.max(0, 0.6 + 0.9 * tex[i]);
      if (kind === 'dualband') { put(i, core + mid, [0.7, 0.75, 0.7]); put(i, faint * 1.4, [1, 0.12, 0.14]); put(i, mid * 0.4 * (0.5 + tex[i]), [0.05, 0.6, 0.55]); }
      else if (kind === 'mono') put(i, core + mid + faint, [1, 1, 1]);
      else { put(i, core, [0.85, 1.0, 0.95]); put(i, mid, [1.0, 0.45, 0.5]); put(i, faint, [1.0, 0.3, 0.38]); }
    } else if (kind === 'galaxy') {
      const ex = dx * Math.cos(0.5) + dy * Math.sin(0.5), ey = (-dx * Math.sin(0.5) + dy * Math.cos(0.5)) * 2.4, re = Math.hypot(ex, ey);
      const bulge = 0.55 * Math.exp(-7.67 * ((re / 0.03) ** 0.25 - 1)) / Math.exp(7.67);
      const disk = 0.03 * Math.exp(-re / 0.07);
      const ang = Math.atan2(ey, ex), arm = 0.5 + 0.5 * Math.cos(2 * ang - 9 * re * 2 * Math.PI / 2);
      const arms = 0.008 * Math.exp(-re / 0.16) * arm * (0.7 + 0.6 * tex2[i]);
      put(i, bulge * 40 + disk, [1.0, 0.85, 0.65]); put(i, arms, [0.7, 0.85, 1.0]);
    } else if (kind === 'widefield') {
      const band = Math.exp(-(((y - h * 0.55 + (x - w / 2) * 0.35) / (h * 0.22)) ** 2));
      const dust = Math.max(0, 1 - 1.6 * Math.max(0, tex2[i] - 0.1));
      put(i, 0.012 * band * dust * (0.8 + 0.4 * tex[i]), [1.0, 0.9, 0.8]);
    }
    // cluster: stars only
  }
  // ---- truth luminance of the object
  const signal = new Float32Array(n);
  for (let i = 0; i < n; i++) signal[i] = (sig.r[i] + sig.g[i] + sig.b[i]) / 3;
  // ---- sky background with a warm gradient
  const bg = [0.045, 0.04, 0.032];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    // light pollution: a linear ramp, or (o.gradient === 'curved') a light dome near the horizon plus a brighter corner
    const gr = o.gradient === 'curved' ? 0.016 * (1 - v) ** 2 + 0.008 * ((u - 0.5) ** 2 + (v - 0.5) ** 2) * 2 + 0.004 * u : 0.012 * u + 0.006 * (1 - v);
    const i = y * w + x;
    img.r[i] = bg[0] + gr * 1.2 + sig.r[i]; img.g[i] = bg[1] + gr + sig.g[i]; img.b[i] = bg[2] + gr * 0.7 + sig.b[i];
  }
  // ---- stars
  const nStars = kind === 'cluster' ? 900 : kind === 'widefield' ? 1400 : 380;
  const starMask = new Uint8Array(n);
  const stars = [];
  for (let k = 0; k < nStars; k++) {
    let x = R.u() * w, y = R.u() * h;
    if (kind === 'cluster' && k < 500) { const a = R.u() * 6.283, rr = S * 0.18 * Math.sqrt(-Math.log(1 - 0.95 * R.u())) * 0.5; x = cx + rr * Math.cos(a); y = cy + rr * Math.sin(a); }
    const peak = Math.min(1.4, 0.008 / Math.pow(R.u() + 0.004, 1.15));
    const sigma = 1.1 + 0.25 * Math.log10(1 + peak * 200);
    const t = R.u(), col = t < 0.3 ? [1, 0.82, 0.62] : t < 0.75 ? [1, 0.97, 0.9] : [0.82, 0.9, 1];
    stars.push({ x, y, peak });
    const rad = Math.ceil(sigma * 4);
    for (let yy = Math.max(0, Math.floor(y - rad)); yy <= Math.min(h - 1, Math.ceil(y + rad)); yy++) for (let xx = Math.max(0, Math.floor(x - rad)); xx <= Math.min(w - 1, Math.ceil(x + rad)); xx++) {
      const v = peak * Math.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * sigma * sigma)), i = yy * w + xx;
      img.r[i] += v * col[0]; img.g[i] += v * col[1]; img.b[i] += v * col[2];
      if (v > 0.002) starMask[i] = 1;
    }
  }
  // ---- noise: read noise + shot noise (variance grows with signal), then saturate at 1
  for (const c of ['r', 'g', 'b']) for (let i = 0; i < n; i++) {
    const v = img[c][i];
    img[c][i] = Math.min(1, Math.max(0, v + Math.sqrt(0.0018 ** 2 + 0.00004 * v) * R.n()));
  }
  if (kind === 'mono') { for (let i = 0; i < n; i++) { const l = (img.r[i] + img.g[i] + img.b[i]) / 3; img.r[i] = img.g[i] = img.b[i] = l; } img.mono = true; }
  img.meta = { linear: true, format: 'FITS' };
  // ---- regions (truth based; star pixels excluded; 12 px border excluded)
  const noise = 0.0018;
  const regions = { bg: [], faint: [], mid: [], core: [], ha: [], o3: [] };
  for (let y = 12; y < h - 12; y++) for (let x = 12; x < w - 12; x++) {
    const i = y * w + x; if (starMask[i]) continue;
    const s = signal[i];
    if (s < 0.1 * noise) regions.bg.push(i);
    else if (s > 1 * noise && s < 4 * noise) regions.faint.push(i);
    else if (s > 0.01 && s < 0.08) regions.mid.push(i);
    else if (s > 0.15) regions.core.push(i);
    if (kind === 'dualband' && s > 2 * noise) { if (sig.r[i] > 2.5 * sig.g[i]) regions.ha.push(i); else if (sig.g[i] > 1.2 * sig.r[i]) regions.o3.push(i); }
    if (kind === 'm42' && s > 2 * noise && s < 0.08 && sig.r[i] > 1.8 * sig.g[i]) regions.ha.push(i);
  }
  return { img, signal, regions, stars, starMask, kind, center: [cx, cy], type: { m42: 'nebula', dualband: 'nebula', mono: 'nebula', galaxy: 'galaxy', cluster: 'cluster', widefield: 'milkyway' }[kind] };
}

// ------------------------------------------------------------------ quality metrics ---
const med = (a) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };
const robustStd = (a) => { const m = med(a); return 1.4826 * med(a.map((v) => Math.abs(v - m))); };
function spearman(xs, ys) {
  const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Float64Array(a.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; };
  const rx = rank(xs), ry = rank(ys), n = xs.length, mx = (n - 1) / 2;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - mx); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - mx) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
function sample(arr, k, seed) { if (arr.length <= k) return arr; const R = rng(seed || 3), out = []; for (let j = 0; j < k; j++) out.push(arr[Math.floor(R.u() * arr.length)]); return out; }

function metrics(out, sc) {
  const L = E._.lum(out), { regions } = sc;
  const pick = (idx) => idx.map((i) => L[i]);
  const bgL = pick(regions.bg), bgMed = med(bgL), bgStd = robustStd(bgL);
  const m = { bg: bgMed, bgNoise: bgStd };
  if (regions.faint.length > 200) {
    const f = med(pick(regions.faint));
    m.faintDelta = f - bgMed;          // how much brighter the faint nebula is than the sky (display units)
    m.faintCNR = (f - bgMed) / Math.max(1e-4, bgStd);
  }
  if (regions.mid.length > 200) m.midDelta = med(pick(regions.mid)) - bgMed;
  if (regions.core.length > 50) {
    const core = regions.core;
    let clip = 0; for (const i of core) if (Math.max(out.r[i], out.g[i], out.b[i]) >= 0.985) clip++;
    m.coreClip = clip / core.length;   // burnt-out fraction of the bright core
    const s = sample(core, 3000, 5);
    m.coreDetail = spearman(s.map((i) => sc.signal[i]), s.map((i) => L[i])); // structure kept in the core (1 = perfect order)
    // a "white blob": most of the core displayed almost white, so its structure is invisible
    let white = 0; for (const i of core) if (L[i] > 0.9) white++;
    m.coreWhite = white / core.length;
    const cs = core.map((i) => L[i]).sort((a, b) => a - b);
    m.coreSpread = cs[Math.floor(cs.length * 0.9)] - cs[Math.floor(cs.length * 0.1)]; // tonal range used by the core
  }
  if (regions.core.length > 50) {
    // dark ring ("halo") around the bright core: the azimuthal profile of a centrally bright object
    // must fall monotonically; haloDip = how far it dips below what lies further out
    const [cx, cy] = sc.center, w = out.w, prof = [];
    for (let r = 0; r < 140; r += 2) { const v = []; for (let a = 0; a < 64; a++) { const x = Math.round(cx + r * Math.cos(a * 0.0982)), y = Math.round(cy + r * Math.sin(a * 0.0982)); const i = y * w + x; if (x >= 0 && y >= 0 && x < w && y < out.h && !sc.starMask[i]) v.push(L[i]); } if (v.length > 8) prof.push(med(v)); }
    let dip = 0; for (let j = 0; j < prof.length; j++) for (let k = j + 1; k < prof.length; k++) dip = Math.max(dip, prof[k] - prof[j]);
    m.haloDip = dip;
  }
  let zero = 0; for (const v of L) if (v <= 0.002) zero++;
  m.blackClip = zero / L.length;
  const bm = ['r', 'g', 'b'].map((c) => med(regions.bg.map((i) => out[c][i])));
  m.bgTint = Math.max(...bm) - Math.min(...bm);
  // colour mottle in the sky: spread of the colour differences (r-g, b-g) in the background
  m.bgChroma = (robustStd(regions.bg.map((i) => out.r[i] - out.g[i])) + robustStd(regions.bg.map((i) => out.b[i] - out.g[i]))) / 2;
  if (regions.ha.length > 100) { const r = med(regions.ha.map((i) => out.r[i])), g = med(regions.ha.map((i) => out.g[i])); m.haRed = r - g; }
  if (regions.o3.length > 100) { const r = med(regions.o3.map((i) => out.r[i])), g = med(regions.o3.map((i) => out.g[i])), b = med(regions.o3.map((i) => out.b[i])); m.o3Teal = (g + b) / 2 - r; }
  return m;
}

module.exports = { scene, metrics, spearman, med, robustStd };
