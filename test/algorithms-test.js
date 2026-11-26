// Numerical tests for the image-processing algorithms: each test checks a property that a
// correct implementation must have (exact identities, monotonicity, noise and flux behaviour,
// preview/export consistency, determinism) instead of only "runs without error".
// Usage: node test/algorithms-test.js      (VERBOSE=1 prints measured values for passing checks)
const E = require('../app/js/engine.js');
const O = require('../app/js/ops.js');
const ST = require('../app/js/stack.js');
const I = E._;
const { check, summary } = require('./lib/check.js');
const { rng, geom, starField, mean, std, median, bgIndex, fwhmAt, finite01 } = require('./lib/synth.js');

const run = (img, layers, store) => O.processStack(img, layers, store || { srcKey: 1, ctx: new Map(), cache: null }, {});
const L = (op, params, extra) => O.newLayer(op, params, extra);
const f = (v, d) => (Number.isFinite(v) ? v.toFixed(d === undefined ? 4 : d) : String(v));

// ------------------------------------------------------------------ 1. transfer functions ---
{
  let ok = true, worst = '';
  for (const m of [0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.99]) {
    if (I.mtf(m, 0) !== 0 || I.mtf(m, 1) !== 1 || Math.abs(I.mtf(m, m) - 0.5) > 1e-9) { ok = false; worst = 'm=' + m; }
    let prev = -1; for (let x = 0; x <= 1; x += 1 / 512) { const v = I.mtf(m, x); if (!(v >= prev)) { ok = false; worst = `m=${m} x=${x}`; } prev = v; }
  }
  check('MTF: mtf(m,0)=0, mtf(m,1)=1, mtf(m,m)=0.5 and monotone', ok, worst);
}
{
  let ok = true, worst = '';
  for (const b of [-1, -0.5, 0, 0.5, 2, 5, 12]) for (const D of [0.1, 1, 10, 1000]) for (const SP of [0.005, 0.05, 0.2]) for (const [LP, HP] of [[0, 1], [SP * 0.5, 0.9], [SP, SP + 0.2]]) {
    const g = I.ghsFunc(D, b, SP, LP, HP);
    if (Math.abs(g(0)) > 1e-6 || Math.abs(g(1) - 1) > 1e-6) { ok = false; worst = `endpoints b=${b} D=${D} SP=${SP}`; }
    let prev = -Infinity;
    for (let x = 0; x <= 1; x += 1 / 1024) { const v = g(x); if (!Number.isFinite(v) || v < prev - 1e-9) { ok = false; worst = `b=${b} D=${D} SP=${SP} LP=${LP} HP=${HP} x=${x} v=${v}`; break; } prev = v; }
  }
  check('GHS: g(0)=0, g(1)=1, finite and monotone for b in [-1..12], D in [0.1..1000]', ok, worst);
}
{
  const id = E.curveLUT([[0, 0], [1, 1]], 1024);
  let e = 0; for (let i = 0; i < id.length; i++) e = Math.max(e, Math.abs(id[i] - i / 1023));
  check('Curves: identity curve is exact', e < 1e-6, f(e, 8));
  const lut = E.curveLUT([[0, 0], [0.2, 0.05], [0.25, 0.6], [0.8, 0.62], [1, 1]], 2048);
  let mono = true; for (let i = 1; i < lut.length; i++) if (lut[i] < lut[i - 1] - 1e-7) mono = false;
  check('Curves: monotone points give a monotone curve without overshoot (Fritsch-Carlson)', mono && Math.min(...lut) >= 0 && Math.max(...lut) <= 1);
}

// --------------------------------------------------------------------------- 2. stretching ---
{
  const { img, stars } = starField({ w: 400, h: 300, bg: [0.02, 0.02, 0.02], noise: 0.001, stars: 80, peak: [0.02, 0.9], seed: 3, nebula: 0.01 });
  const bgi = bgIndex(img.w, img.h, stars, 9);
  for (const method of ['auto', 'stat', 'arcsinh', 'ghs', 'log']) {
    const out = run(img, [L('stretch', { method, brightness: 0.25 })]);
    const lum = E._.lum(out);
    const bgMed = median(bgi.map((i) => lum[i]));
    let white = 0, black = 0; for (const v of lum) { if (v >= 0.999) white++; if (v <= 0) black++; }
    const n = lum.length;
    check(`Stretch ${method}: background lands near the requested brightness (0.25)`, Math.abs(bgMed - 0.25) < 0.05, f(bgMed, 3));
    check(`Stretch ${method}: highlight clipping < 0.2% of pixels`, white / n < 0.002, (100 * white / n).toFixed(3) + '%');
    check(`Stretch ${method}: shadow clipping < 1% of pixels`, black / n < 0.01, (100 * black / n).toFixed(3) + '%');
    // dynamic range: brighter input stays brighter (on a smooth, noise-free ramp)
    const ramp = geom(E.newImage(256, 1)); for (let x = 0; x < 256; x++) ramp.r[x] = ramp.g[x] = ramp.b[x] = 0.02 + 0.5 * (x / 255) ** 2;
    const st = { srcKey: 9, ctx: new Map(), cache: null };
    run(img, [L('stretch', { method, brightness: 0.25 })], st); // measure on the star field, apply to the ramp (same ctx)
    const r2 = O.processStack(ramp, [Object.assign(L('stretch', { method, brightness: 0.25 }), { id: 'x' })], st, {});
    let mono = true; for (let x = 1; x < 256; x++) if (r2.g[x] < r2.g[x - 1] - 1e-6) mono = false;
    check(`Stretch ${method}: transfer curve is monotone`, mono);
  }
}

// ---------------------------------------------------------------- 3. blend modes and masks ---
{
  const base = geom(E.newImage(16, 16)); base.r.fill(0.3); base.g.fill(0.6); base.b.fill(0.8);
  const t = { r: 0.7, g: 0.4, b: 0.2 }; // 'invert' layer gives top = 1 - base
  const F = {
    normal: (b, s) => s, multiply: (b, s) => b * s, screen: (b, s) => 1 - (1 - b) * (1 - s),
    overlay: (b, s) => (b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)), softlight: (b, s) => (1 - 2 * s) * b * b + 2 * s * b,
    hardlight: (b, s) => (s < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)), lighten: Math.max, darken: Math.min,
    difference: (b, s) => Math.abs(b - s), add: (b, s) => Math.min(1, b + s), subtract: (b, s) => Math.max(0, b - s),
  };
  let ok = true, bad = '';
  for (const mode of Object.keys(F)) {
    const ly = L('invert'); ly.blend = mode; ly.opacity = 0.6;
    const out = run(base, [ly]);
    for (const c of ['r', 'g', 'b']) { const b = base[c][0], exp = b + (F[mode](b, t[c]) - b) * 0.6; if (Math.abs(out[c][0] - exp) > 1e-6) { ok = false; bad = `${mode}.${c}: ${out[c][0]} vs ${exp}`; } }
  }
  check('Blend modes: 11 separable modes match the reference formulas at 60% opacity', ok, bad);
  const lumOf = (o) => (o.r[0] + o.g[0] + o.b[0]) / 3;
  const ly = L('invert'); ly.blend = 'luminosity';
  const out = run(base, [ly]);
  check('Blend luminosity: luminance of the top layer, colour differences of the base', Math.abs(lumOf(out) - (0.7 + 0.4 + 0.2) / 3) < 1e-6 && Math.abs((out.r[0] - out.g[0]) - (0.3 - 0.6)) < 1e-6);
  const ly2 = L('invert'); ly2.blend = 'color';
  const out2 = run(base, [ly2]);
  check('Blend color: base luminance kept', Math.abs(lumOf(out2) - (0.3 + 0.6 + 0.8) / 3) < 1e-6);
  const zero = L('invert'); zero.opacity = 0;
  const off = L('invert'); off.on = false;
  const same = (a, b) => ['r', 'g', 'b'].every((c) => a[c].every((v, i) => v === b[c][i]));
  check('Layer with opacity 0 leaves the image bit-identical', same(run(base, [zero]), base));
  check('Hidden layer leaves the image bit-identical', same(run(base, [off]), base));
}
{
  const ramp = geom(E.newImage(201, 3)); for (let x = 0; x < 201; x++) for (let y = 0; y < 3; y++) { const v = x / 200; ramp.r[y * 201 + x] = ramp.g[y * 201 + x] = ramp.b[y * 201 + x] = v; }
  const env = { sc: 1, ctx: {} };
  const m = O.computeMask(ramp, { type: 'lum', lo: 0.5, hi: 1.2, soft: 0.05 }, env);
  check('Luminance mask: 0 well below the range, 1 inside it', m[20] === 0 && m[150] === 1 && m[100] > 0 && m[100] < 1);
  const mi = O.computeMask(ramp, { type: 'lum', lo: 0.5, hi: 1.2, soft: 0.05, invert: true }, env);
  check('Inverted mask = 1 - mask', mi.every((v, i) => Math.abs(v - (1 - m[i])) < 1e-6));
  const md = O.computeMask(ramp, { type: 'lum', lo: 0.5, hi: 1.2, soft: 0.05, density: 0.4 }, env);
  check('Mask density 40%: hidden areas are still 60% visible', Math.abs(md[20] - 0.6) < 1e-6 && Math.abs(md[150] - 1) < 1e-6);
  const sq = geom(E.newImage(100, 100));
  const ms = O.computeMask(sq, { type: 'shape', shape: { kind: 'ellipse', x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, shapeFeather: 0 }, env);
  check('Elliptical selection mask: 1 in the centre, 0 in the corners', ms[50 * 100 + 50] > 0.99 && ms[5 * 100 + 5] < 0.01);
  const { img } = starField({ w: 200, h: 150, seed: 5 });
  let allIn = true;
  for (const t of ['lum', 'hue', 'stars', 'nostars', 'signal', 'background', 'paint']) {
    const mk = O.computeMask(img, { type: t, strokes: t === 'paint' ? [{ pts: [[0.5, 0.5]], r: 0.1, mode: 'show' }] : [] }, { sc: 1, ctx: {} });
    if (mk && !mk.every((v) => v >= 0 && v <= 1 && Number.isFinite(v))) allIn = false;
  }
  check('Every mask type stays within 0..1 and finite', allIn);
}

// ------------------------------------------------------------------------------ 4. wavelets ---
{
  const { img } = starField({ w: 160, h: 120, seed: 7 });
  const lay = I.atrous(img.g, img.w, img.h, 6);
  let e = 0;
  for (let i = 0; i < img.g.length; i++) { let s = 0; for (const l of lay) s += l[i]; e = Math.max(e, Math.abs(s - img.g[i])); }
  check('A trous wavelets: layers + residual reconstruct the input exactly', e < 1e-5, f(e, 8));
}

// ------------------------------------------------------------- 5. background (gradient) removal ---
{
  const { img, stars, truth } = starField({ w: 400, h: 300, bg: [0.05, 0.05, 0.05], grad: 0.04, noise: 0.002, stars: 60, seed: 11 });
  const bgi = bgIndex(img.w, img.h, stars, 10);
  const side = (im, left) => median(bgi.filter((i) => (left ? i % img.w < 60 : i % img.w > img.w - 60)).map((i) => im.g[i]));
  const before = side(img, false) - side(img, true);
  const out = run(img, [L('gradient', { amount: 1 })]);
  const after = side(out, false) - side(out, true);
  check('Gradient removal: left/right background difference reduced by > 90%', Math.abs(after) < 0.1 * Math.abs(before), `${f(before)} -> ${f(after)}`);
  // star flux preserved (aperture sum above local background)
  const flux = (im, s) => { let t = 0; for (let y = Math.round(s.y) - 4; y <= Math.round(s.y) + 4; y++) for (let x = Math.round(s.x) - 4; x <= Math.round(s.x) + 4; x++) t += im.g[y * im.w + x]; let b = 0, n = 0; for (let y = Math.round(s.y) - 8; y <= Math.round(s.y) + 8; y++) for (let x = Math.round(s.x) - 8; x <= Math.round(s.x) + 8; x++) if (Math.abs(x - s.x) > 6 || Math.abs(y - s.y) > 6) { if (x >= 0 && y >= 0 && x < im.w && y < im.h) { b += im.g[y * im.w + x]; n++; } } return t - 81 * b / n; };
  const bright = stars.filter((s) => s.a > 0.2 && s.x > 10 && s.y > 10 && s.x < img.w - 10 && s.y < img.h - 10);
  const ratios = bright.map((s) => flux(out, s) / flux(truth, s));
  check('Gradient removal: star flux preserved within 5%', ratios.length > 2 && ratios.every((r) => Math.abs(r - 1) < 0.05), ratios.map((r) => r.toFixed(3)).join(' '));
  check('Gradient removal: output finite and in 0..1', finite01(out));
}

// ----------------------------------------------------------------- 6. colour calibration ---
{
  const { img, stars } = starField({ w: 400, h: 300, bg: [0.08, 0.06, 0.04], noise: 0.001, stars: 80, seed: 13 });
  const bgi = bgIndex(img.w, img.h, stars, 9);
  const out = run(img, [L('colorcal', { neutralize: true, whiteBalance: 0 })]);
  const mr = median(bgi.map((i) => out.r[i])), mg = median(bgi.map((i) => out.g[i])), mb = median(bgi.map((i) => out.b[i]));
  const spread = Math.max(mr, mg, mb) - Math.min(mr, mg, mb);
  check('Colour calibration: colour cast of the background removed (R=G=B within 0.002)', spread < 0.002, `R ${f(mr)} G ${f(mg)} B ${f(mb)}`);
}

// ---------------------------------------------------------------------- 7. deconvolution ---
{
  const { img, stars } = starField({ w: 300, h: 220, bg: [0.05, 0.05, 0.05], noise: 0.0015, stars: 25, sigma: 2.0, peak: [0.15, 0.6], seed: 17 });
  const out = run(img, [L('deconv', { strength: 0.8, radius: 2.0 })]);
  const iso = stars.filter((s) => s.a > 0.2 && stars.every((t) => t === s || Math.hypot(t.x - s.x, t.y - s.y) > 16) && s.x > 12 && s.y > 12 && s.x < img.w - 12 && s.y < img.h - 12);
  const fb = iso.map((s) => fwhmAt(img.g, img.w, img.h, s.x, s.y, 0.05)), fa = iso.map((s) => fwhmAt(out.g, out.w, out.h, s.x, s.y, 0.05));
  const shr = mean(fa) / mean(fb);
  check('Deconvolution: stars become sharper (FWHM at least 5% smaller)', iso.length > 2 && shr < 0.95, `FWHM ${f(mean(fb), 2)} -> ${f(mean(fa), 2)} px`);
  // no dark ringing: the azimuthally averaged profile around isolated stars never drops below the
  // true background (0.05) by more than 0.3 x noise. (Single pixels may: noise is slightly amplified.)
  let worstRing = Infinity;
  for (const [r0, r1] of [[3, 5], [5, 7], [7, 9], [9, 11]]) {
    const v = mean(iso.flatMap((s) => { const a = []; for (let y = Math.round(s.y) - 12; y <= Math.round(s.y) + 12; y++) for (let x = Math.round(s.x) - 12; x <= Math.round(s.x) + 12; x++) { const d = Math.hypot(x - s.x, y - s.y); if (d >= r0 && d < r1) a.push(out.g[y * out.w + x]); } return a; }));
    worstRing = Math.min(worstRing, v - 0.05);
  }
  check('Deconvolution: no dark rings (radial profile stays above background - 0.3 sigma)', worstRing > -0.3 * 0.0015, f(worstRing, 5));
  check('Deconvolution: output finite and in 0..1', finite01(out));
}

// -------------------------------------------------------------------------- 8. noise reduction ---
{
  const R = rng(21), flat = geom(E.newImage(256, 256));
  for (let i = 0; i < flat.g.length; i++) { flat.r[i] = 0.3 + 0.02 * R.n(); flat.g[i] = 0.3 + 0.02 * R.n(); flat.b[i] = 0.3 + 0.02 * R.n(); }
  const s0 = std(flat.g), m0 = mean(flat.g);
  for (const method of ['guided', 'wavelet', 'median', 'bilateral']) {
    const out = run(flat, [L('denoise', { method, luma: 0.6, chroma: 0.6 })]);
    const s1 = std(out.g), m1 = mean(out.g);
    check(`Noise reduction (${method}): noise reduced by at least 35%`, s1 < 0.65 * s0, `sigma ${f(s0)} -> ${f(s1)}`);
    check(`Noise reduction (${method}): no brightness shift (< 0.1 sigma)`, Math.abs(m1 - m0) < 0.1 * s0, `mean ${f(m0)} -> ${f(m1)}`);
  }
  // edges survive edge-preserving methods
  const edge = geom(E.newImage(128, 64));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) { const v = (x < 64 ? 0.2 : 0.6) + 0.01 * R.n(); const i = y * 128 + x; edge.r[i] = edge.g[i] = edge.b[i] = v; }
  for (const method of ['guided', 'bilateral']) {
    const out = run(edge, [L('denoise', { method, luma: 0.6, chroma: 0 })]);
    const step = mean(Array.from({ length: 64 }, (_, y) => out.g[y * 128 + 66])) - mean(Array.from({ length: 64 }, (_, y) => out.g[y * 128 + 61]));
    check(`Noise reduction (${method}): a hard edge keeps > 85% of its contrast`, step > 0.85 * 0.4, f(step, 3));
  }
  // background smoothing must not shift the sky either
  const out = run(flat, [L('bgsmooth', { amount: 0.8 })]);
  check('Background smoothing: no brightness shift (< 0.1 sigma)', Math.abs(mean(out.g) - m0) < 0.1 * s0, `${f(m0)} -> ${f(mean(out.g))}`);
}

// ------------------------------------------------------------------------------- 9. stars ---
{
  // regression: star reduction used to darken (and clip) a star-free noisy sky
  const R = rng(23), sky = geom(E.newImage(256, 256));
  for (let i = 0; i < sky.g.length; i++) { const v = 0.2 + 0.015 * R.n(); sky.r[i] = sky.g[i] = sky.b[i] = v; }
  const m0 = mean(sky.g), s0 = std(sky.g);
  const out = run(sky, [L('starreduce', { amount: 0.8 })]);
  check('Star reduction on a star-free sky: no darkening (< 0.1 sigma)', Math.abs(mean(out.g) - m0) < 0.1 * s0, `${f(m0)} -> ${f(mean(out.g))}`);
  const { img, stars } = starField({ w: 300, h: 220, bg: [0.15, 0.15, 0.15], noise: 0.004, stars: 30, sigma: 2.2, peak: [0.3, 0.7], seed: 29 });
  const red = run(img, [L('starreduce', { amount: 0.8 })]);
  const iso = stars.filter((s) => s.a > 0.35 && s.x > 12 && s.y > 12 && s.x < img.w - 12 && s.y < img.h - 12);
  const pk = (im, s) => im.g[Math.round(s.y) * im.w + Math.round(s.x)] - 0.15;
  const ratio = mean(iso.map((s) => pk(red, s) / pk(img, s)));
  check('Star reduction: star peaks reduced by at least 20%', ratio < 0.8, f(ratio, 3));
  // star removal: stars gone, background kept
  const bgi = bgIndex(img.w, img.h, stars, 10);
  const sl = run(img, [L('starsplit', { brightness: -1, reduce: 0 })]);
  const left = mean(iso.map((s) => pk(sl, s) / pk(img, s)));
  check('Star removal: bright star peaks reduced by > 80%', left < 0.2, f(left, 3));
  check('Star removal: background level unchanged (< 0.002)', Math.abs(median(bgi.map((i) => sl.g[i])) - median(bgi.map((i) => img.g[i]))) < 0.002);
  check('Star separation: output finite and in 0..1', finite01(sl));
}

// ---------------------------------------------------------------------------- 10. stacking ---
{
  const { truth } = starField({ w: 500, h: 360, bg: [0.05, 0.05, 0.05], noise: 0, stars: 120, sigma: 1.8, peak: [0.05, 0.8], seed: 31 });
  const R = rng(37), SIG = 0.01;
  function frame(dx, dy, deg) {
    const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), cx = truth.w / 2, cy = truth.h / 2;
    const out = geom(E.newImage(truth.w, truth.h));
    for (let y = 0; y < truth.h; y++) for (let x = 0; x < truth.w; x++) {
      const X = x - cx - dx, Y = y - cy - dy, sx = ca * X + sa * Y + cx, sy = -sa * X + ca * Y + cy, i = y * truth.w + x;
      for (const c of ['r', 'g', 'b']) { const v = E.sampleBilinear(truth[c], truth.w, truth.h, sx, sy); out[c][i] = Math.max(0, (v < 0 ? 0.05 : v) + SIG * R.n()); }
    }
    return out;
  }
  const state = { stack: {} };
  const res = [ST.add(state, frame(0, 0, 0)), ST.add(state, frame(12.3, -7.6, 1.5)), ST.add(state, frame(-9.1, 14.2, -2.2)), ST.add(state, frame(5.5, 3.3, 0.7))];
  check('Stacking: all 4 frames aligned', res.every((r) => r.ok), JSON.stringify(res.map((r) => r.ok)));
  check('Stacking: recovered rotations match (|rot| within 0.15 degrees)', [[1, 1.5], [2, 2.2], [3, 0.7]].every(([k, d]) => Math.abs(Math.abs(res[k].rot) - d) < 0.15), res.map((r) => r.rot).join(', '));
  const out = ST.finish(state);
  // residual against the noise-free truth in the centre (avoids the borders that not all frames cover)
  const idx = []; for (let y = 60; y < truth.h - 60; y++) for (let x = 60; x < truth.w - 60; x++) idx.push(y * truth.w + x);
  const resid = idx.map((i) => out.g[i] - truth.g[i]);
  const sres = std(resid), bias = mean(resid);
  check('Stacking: noise reduced to < 0.65x of one frame (ideal 0.5x for 4 frames)', sres < 0.65 * SIG, `${f(sres, 5)} vs ${SIG}`);
  check('Stacking: no brightness bias (< 0.002)', Math.abs(bias) < 0.002, f(bias, 5));
  const blank = geom(E.newImage(300, 200)); blank.g.fill(0.1); blank.r.fill(0.1); blank.b.fill(0.1);
  const st2 = { stack: {} }; ST.add(st2, frame(0, 0, 0));
  let r2; try { r2 = ST.add(st2, blank); } catch (e) { r2 = { error: e.message }; }
  check('Stacking: frame without stars is rejected without crashing', r2 && r2.ok === false, JSON.stringify(r2));
}

// ---------------------------------------- 11. preview vs export, cache and determinism ---
{
  let img = E.makeDemo(1800, 1200, 11);
  const c = E.detectAutoCrop(img); if (c) img = E.cropImage(img, c.x, c.y, c.x2 - c.x, c.y2 - c.y);
  geom(img);
  const prev = E.downscale(img, 900);
  for (const name of ['auto', 'natural', 'starless', 'hoo', 'galaxy', 'spikes']) {
    const { layers } = O.presetLayers(name, { type: 'nebula' });
    const store = { srcKey: 1, ctx: new Map(), cache: new Map() };
    const p = O.processStack(prev, layers, store, { cache: true });
    const full = O.processStack(img, layers, store, {});
    const fd = E.resize(full, p.w, p.h);
    let d = 0; const n = p.w * p.h;
    for (const k of ['r', 'g', 'b']) for (let i = 0; i < n; i++) d += Math.abs(p[k][i] - fd[k][i]);
    const mad = d / n / 3, dmed = Math.abs(E.medMad(p.g).med - E.medMad(fd.g).med);
    check(`Preview vs export (${name}): mean difference < 0.02 and background within 0.012`, mad < 0.02 && dmed < 0.012, `mean abs diff ${f(mad)}, background diff ${f(dmed)}`);
    check(`Export (${name}): finite and in 0..1`, finite01(full));
    // cached re-render equals uncached render, bit for bit
    const again = O.processStack(prev, layers, store, { cache: true });
    const fresh = O.processStack(prev, layers, { srcKey: 1, ctx: new Map(), cache: null }, {});
    const eq = (a, b) => ['r', 'g', 'b'].every((k) => a[k].every((v, i) => v === b[k][i]));
    check(`Determinism (${name}): cached render == uncached render == first render`, eq(again, p) && eq(fresh, p));
  }
}

// --------------------------------------------------------------- 12. sanitising and conversions ---
{
  const im = geom(E.newImage(4, 1)); im.r.set([NaN, Infinity, -Infinity, 1.7]); im.g.set([0.5, -0.3, 0.25, 1]); im.b.set([0, 0, 0, 0]);
  const bad = E.sanitize(im);
  check('sanitize: NaN/±Inf become 0, values clamped to 0..1', bad === 3 && im.r[0] === 0 && im.r[1] === 0 && im.r[2] === 0 && im.r[3] === 1 && im.g[1] === 0);
  const t = geom(E.newImage(2, 1)); t.r.set([1.5, NaN]); t.g.set([1, 0.5]); t.b.set([0, 0]);
  const o = E.toRGB16(t);
  check('toRGB16: values above 1 saturate at 65535 instead of wrapping to black (regression)', o[0] === 65535 && o[3] === 0);
  const nanImg = geom(E.newImage(32, 32)); for (const k of ['r', 'g', 'b']) nanImg[k].fill(0.2); nanImg.g[100] = NaN;
  const res = run(nanImg, [L('gblur', { radius: 4 })]);
  check('Pipeline: a NaN never reaches the output (clampAll)', finite01(res));
}

summary('ALGORITHMS');
