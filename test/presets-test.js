// Quality of the AUTOMATIC processing on realistic synthetic linear scenes (test/lib/scenes.js):
// M42-like nebula with a bright core and faint outer structure, galaxy, star cluster, Milky Way
// wide field, dual-band nebula and mono. Every check is an objective measurement that a good
// automatic result must satisfy, chosen from problems found in the audit (see docs/stretch.md).
// Usage: node test/presets-test.js      (VERBOSE=1 prints the measured values)
// NOTE: these scenes are synthetic. They do not replace testing with real telescope files.
const E = require('../app/js/engine.js');
const O = require('../app/js/ops.js');
const I = E._;
const { check, summary } = require('./lib/check.js');
const { scene, metrics, med } = require('./lib/scenes.js');
const f = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
const run = (img, layers) => O.processStack(img, layers, { srcKey: 1, ctx: new Map(), cache: null }, {});

// ------------------------------------------------------------ 1. the stretch shoulder itself ---
{
  let ok = true, why = '';
  for (const m of [0.0005, 0.002, 0.01, 0.05]) for (const a of [0.25, 0.5, 1]) {
    const base = (v) => I.mtf(m, v), g = I.withShoulder(base, m, a);
    let prev = -1;
    for (let x = 0; x <= 1.0000001; x += 1 / 4096) {
      const v = g(Math.min(1, x));
      if (!(v >= prev - 1e-9) || v > 1 + 1e-9) { ok = false; why = `not monotone m=${m} a=${a} x=${x}`; }
      prev = v;
    }
    if (Math.abs(g(0)) > 1e-9 || Math.abs(g(1) - 1) > 1e-6) { ok = false; why = `endpoints m=${m} a=${a}`; }
    // the faint end (below the knee) is exactly the original curve
    const yk = 0.95 - 0.3 * a, xk = I.mtf(1 - m, yk);
    for (const x of [0, xk * 0.25, xk * 0.5, xk * 0.99]) if (Math.abs(g(x) - base(x)) > 1e-9) { ok = false; why = `faint end changed m=${m} a=${a}`; }
    // C1: no kink at the knee
    const h = xk * 1e-4, sl = (g(xk) - g(xk - h)) / h, sr = (g(xk + h) - g(xk)) / h;
    if (Math.abs(sl - sr) / sl > 0.01) { ok = false; why = `kink at the knee m=${m} a=${a}: ${sl} vs ${sr}`; }
  }
  check('Stretch shoulder: monotone, 0->0 and 1->1, faint end unchanged, smooth (C1) at the knee', ok, why);
  // highlights get real tonal range: values from 20% to 100% of the input range
  const m = 0.001, base = (v) => I.mtf(m, v), g = I.withShoulder(base, m, 0.7);
  const rangeBase = base(1) - base(0.2), rangeSh = g(1) - g(0.2);
  check('Stretch shoulder: a bright core (20-100% of the range) gets at least 5x more tonal range', rangeSh > 5 * rangeBase, `${f(rangeBase)} -> ${f(rangeSh)}`);
}

// ------------------------------------------------- 2. sky level is not biased by a big object ---
{
  // known neutral-ish sky + a red emission nebula that covers ~55% of the frame (M42 in a narrow field)
  const { rng, geom } = require('./lib/synth.js');
  const R = rng(9), w = 400, h = 300, img = geom(E.newImage(w, h)), sky = [0.05, 0.05, 0.05];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, r = Math.hypot(x - w / 2, y - h / 2) / 150;
    const neb = r < 1 ? 0.02 * (1 - r) + 0.004 : 0; // red Ha nebula over most of the frame
    img.r[i] = sky[0] + neb + 0.002 * R.n(); img.g[i] = sky[1] + neb * 0.3 + 0.002 * R.n(); img.b[i] = sky[2] + neb * 0.35 + 0.002 * R.n();
  }
  const col = (e) => Math.max(Math.abs(e[0] - e[1]), Math.abs(e[2] - e[1])); // the true sky is neutral
  const s = I.skyLevel(img), errSky = col([s.r, s.g, s.b]);
  const errMed = col(['r', 'g', 'b'].map((c) => I.medMad(img[c]).med));
  check('Sky colour measured on object-free tiles stays neutral when a red nebula fills half the frame (regression: teal sky)', errSky < 0.001 && errSky * 4 < errMed, `colour error ${f(errSky)} vs whole-image median ${f(errMed)}`);
  const out = run(img, [O.newLayer('colorcal', { neutralize: true, whiteBalance: 0 })]);
  const corner = []; for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) corner.push(y * w + x);
  const cc = ['r', 'g', 'b'].map((c) => med(corner.map((i) => out[c][i])));
  check('Colour calibration leaves that sky neutral (not teal)', col(cc) < 0.001, f(col(cc)));
}

// ----------------------------------- 3. automatic processing on six kinds of linear scenes ---
const SCENES = ['m42', 'galaxy', 'cluster', 'widefield', 'dualband', 'mono'];
const results = {};
for (const k of SCENES) {
  const sc = scene(k);
  const { layers } = O.presetLayers('auto', { type: sc.type, dualBand: k === 'dualband' });
  const out = run(sc.img, layers);
  const m = metrics(out, sc);
  results[k] = m;
  const all = ['r', 'g', 'b'].every((c) => out[c].every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
  check(`auto/${k}: output finite and in 0..1`, all);
  check(`auto/${k}: sky neither black nor washed out (0.08..0.20)`, m.bg > 0.08 && m.bg < 0.2, f(m.bg));
  check(`auto/${k}: sky not grainy (noise < 0.035)`, m.bgNoise < 0.035, f(m.bgNoise));
  check(`auto/${k}: sky neutral grey (channel difference < 0.012)`, m.bgTint < 0.012, f(m.bgTint));
  check(`auto/${k}: little colour mottle in the sky (< 0.02)`, m.bgChroma < 0.02, f(m.bgChroma));
  check(`auto/${k}: shadows not clipped (< 0.5% black pixels)`, m.blackClip < 0.005, f(m.blackClip));
  if (m.faintDelta !== undefined) {
    check(`auto/${k}: faint structure clearly visible (>= 0.04 brighter than the sky)`, m.faintDelta >= 0.04, f(m.faintDelta));
    check(`auto/${k}: faint structure stands out of the noise (CNR >= 1.8)`, m.faintCNR >= 1.8, f(m.faintCNR));
  }
  if (m.coreSpread !== undefined) {
    check(`auto/${k}: bright core keeps its structure (tonal range >= 0.045, was ~0.026)`, m.coreSpread >= 0.045, f(m.coreSpread));
    check(`auto/${k}: core brightness order preserved (rank correlation >= 0.95)`, m.coreDetail >= 0.95, f(m.coreDetail));
    check(`auto/${k}: no dark ring around the core (dip < 0.01, was 0.017)`, m.haloDip < 0.01, f(m.haloDip));
  }
  if (m.haRed !== undefined) check(`auto/${k}: H-alpha nebula stays red`, m.haRed > 0.08, f(m.haRed));
}

// ----------------------------- 4. regressions found in the audit, each checked separately ---
{
  // the Milky Way preset used a grid model that removed ~87% of a frame-filling Milky Way
  const sc = scene('widefield');
  const keep = (layer) => {
    const g = run(sc.img, [layer]); const L = I.lum(g), bgv = med(sc.regions.bg.map((i) => L[i]));
    return (med(sc.regions.faint.map((i) => L[i])) - bgv) / med(sc.regions.faint.map((i) => sc.signal[i]));
  };
  const lay = O.presetLayers('milkyway', { type: 'milkyway' }).layers.find((l) => l.op === 'gradient');
  const kNew = keep(lay), kGrid = keep(O.newLayer('gradient', { amount: 0.65, method: 'grid' }));
  check('Milky Way preset keeps >= 80% of the faint Milky Way (old grid setting kept < 50%)', kNew >= 0.8 && kGrid < 0.5, `kept ${f(kNew)} (old grid: ${f(kGrid)})`);
}
{
  // local contrast with a Gaussian base made a dark ring next to bright cores
  const sc = scene('m42');
  const lay = O.presetLayers('auto', { type: 'nebula' }).layers;
  const withLC = metrics(run(sc.img, lay), sc), noLC = metrics(run(sc.img, lay.filter((l) => l.op !== 'localcontrast')), sc);
  check('Local contrast adds no dark ring around a bright core', withLC.haloDip < noLC.haloDip + 0.004, `${f(noLC.haloDip)} -> ${f(withLC.haloDip)}`);
}
{
  // saturation must not be applied to the empty sky (it only amplifies colour noise)
  const sc = scene('cluster');
  const pre = run(sc.img, O.presetLayers('auto', { type: 'cluster' }).layers.filter((l) => l.op !== 'vibrance'));
  const post = run(pre, [O.newLayer('vibrance', { saturation: 1.6, vibrance: 0.4, protectBg: true })]);
  const a = metrics(pre, sc).bgChroma, b = metrics(post, sc).bgChroma;
  check('Saturation with "spare background" does not increase sky colour noise (< 5%)', b < a * 1.05, `${f(a)} -> ${f(b)}`);
}
{
  // all manual settings stay available: the automatic result is plain layers with plain parameters
  const { layers } = O.presetLayers('auto', { type: 'nebula' });
  const st = layers.find((l) => l.op === 'stretch');
  const desc = O.OPS.stretch.p.find((d) => d.k === 'shoulder');
  check('Highlight protection is a normal, adjustable stretch parameter', !!desc && st.params.shoulder > 0 && st.params.shoulder <= 1);
  const raw = run(scene('m42', { w: 360, h: 240 }).img, [Object.assign(O.newLayer('stretch', { shoulder: 0 }), {})]);
  check('Shoulder 0 gives the plain MTF stretch (old behaviour available)', raw.w === 360);
}
// ------------- 6. data with a pedestal and a tiny signal range (as in Dwarf 3 / Seestar FITS) ---
// Found on real Dwarf 3 stacks: every pixel sits on ~0.078 and the sky noise is ~0.00008. The black
// point was capped at median*0.98 (~20 sigma below the sky) and the stretch LUT put the whole
// sky-to-nebula range in 2-3 entries, so faint nebulae stayed flat and grey.
{
  for (const kind of ['m42', 'galaxy']) {
    const sc = scene(kind, { w: 600, h: 400 });
    const { layers } = O.presetLayers('auto', { type: sc.type });
    const ref = metrics(run(sc.img, layers), sc);
    const L = I.lum(sc.img), sig = 1.4826 * I.medMad(L).mad, k = 8e-5 / sig, P = 0.078;
    const ped = Object.assign({}, sc.img, { r: sc.img.r.map((v) => P + v * k), g: sc.img.g.map((v) => P + v * k), b: sc.img.b.map((v) => P + v * k) });
    const m = metrics(run(ped, O.presetLayers('auto', { type: sc.type }).layers), sc);
    check(`Pedestal data (${kind}): faint detail as visible as without pedestal (CNR >= 80%)`, m.faintCNR >= 0.8 * ref.faintCNR, `${f(m.faintCNR)} vs ${f(ref.faintCNR)}`);
    check(`Pedestal data (${kind}): faint detail brightness >= 80% of reference`, m.faintDelta >= 0.8 * ref.faintDelta, `${f(m.faintDelta)} vs ${f(ref.faintDelta)}`);
    check(`Pedestal data (${kind}): sky level in a normal range (0.08-0.25)`, m.bg > 0.08 && m.bg < 0.25, f(m.bg));
  }
  // the stretch LUT must follow a steep curve closely just above the black point
  const fn = (v) => I.mtf(0.0008, v), st = { c0: 0, c1: 1, lut: I.buildLUT(fn) };
  const xs = [0.0002, 0.0005, 0.001, 0.003, 0.01, 0.1, 0.6], img = { w: xs.length, h: 1, r: Float32Array.from(xs), g: Float32Array.from(xs), b: Float32Array.from(xs) };
  I.applyStretch(img, st, { colorPreserve: 0 });
  const err = Math.max(...xs.map((x, i) => Math.abs(img.r[i] - fn(x))));
  check('Stretch LUT error on a steep curve < 0.005 (also in the bottom 0.1% of the range)', err < 0.005, f(err));
}
// ------------------------------------------- 5. preview vs export for the new defaults ---
{
  const sc = scene('m42', { w: 1440, h: 960 });
  const prev = E.downscale(sc.img, 720);
  for (const name of ['auto', 'natural', 'hoo']) {
    const { layers } = O.presetLayers(name, { type: 'nebula' });
    const store = { srcKey: 1, ctx: new Map(), cache: new Map() };
    const p = O.processStack(prev, layers, store, { cache: true });
    const full = E.resize(O.processStack(sc.img, layers, store, {}), p.w, p.h);
    let d = 0; const n = p.w * p.h; for (const c of ['r', 'g', 'b']) for (let i = 0; i < n; i++) d += Math.abs(p[c][i] - full[c][i]);
    check(`Preview vs export (${name}) on the M42 scene: mean difference < 0.02`, d / n / 3 < 0.02, f(d / n / 3));
  }
}
if (process.env.VERBOSE) console.log(JSON.stringify(results, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v), 1));
summary('PRESETS');
