// Node test: run presets and extra variants on a synthetic image; writes raw RGB for inspection.
// Usage: node test/engine-test.js <outdir>   (env W, H, PRESETS=comma list)
const E = require('../app/js/engine.js');
const fs = require('fs');
const out = process.argv[2] || '/tmp/ap';
fs.mkdirSync(out, { recursive: true });
const W = +process.env.W || 1920, H = +process.env.H || 1080;
let img = E.makeDemo(W, H, 7);
const crop = E.detectAutoCrop(img);
if (crop) img = E.cropImage(img, crop.x, crop.y, crop.x2 - crop.x, crop.y2 - crop.y);
const save = (name, im) => {
  const buf = Buffer.alloc(im.w * im.h * 3);
  for (let i = 0; i < im.w * im.h; i++) { buf[i * 3] = Math.round(im.r[i] * 255); buf[i * 3 + 1] = Math.round(im.g[i] * 255); buf[i * 3 + 2] = Math.round(im.b[i] * 255); }
  fs.writeFileSync(`${out}/${name}.rgb`, buf); fs.writeFileSync(`${out}/${name}.dim`, `${im.w} ${im.h}`);
};
save('00_original', img);
const variants = {};
for (const k of Object.keys(E.PRESETS)) variants[k] = { preset: k };
Object.assign(variants, {
  x_arcsinh: { preset: 'nebula', stretchMode: 'arcsinh' },
  x_ghs: { preset: 'nebula', stretchMode: 'ghs' },
  x_wavelet_nr: { preset: 'nebula', denoiseMethod: 'wavelet', denoise: 0.8 },
  x_deconv: { preset: 'nebula', deconv: 0.8 },
  x_grid_grad: { preset: 'nebula', gradientMethod: 'grid' },
  x_curves: { preset: 'nebula', curves: { rgb: [[0, 0], [0.3, 0.2], [0.7, 0.85], [1, 1]] } },
  x_view_stars: { preset: 'nebula', view: 'stars' },
  x_view_gradient: { preset: 'nebula', view: 'gradient' },
});
const only = process.env.PRESETS ? process.env.PRESETS.split(',') : null;
let fail = 0;
for (const [name, v] of Object.entries(variants)) {
  if (only && !only.includes(name)) continue;
  const { params } = E.presetParams(v.preset, img, 'DWARF_RAW_TELE_M 42_EXP_15.fits');
  Object.assign(params, v, { preset: undefined });
  const prev = E.downscale(img, 1200);
  const ctx = {}, cache = {};
  let t = Date.now();
  const p = E.process(prev, params, ctx, cache);
  const tp = Date.now() - t;
  t = Date.now();
  // second run with cache and a late-stage change must be faster
  E.process(prev, Object.assign({}, params, { saturation: params.saturation + 0.1 }), {}, cache);
  const tc = Date.now() - t;
  t = Date.now();
  const full = E.process(Object.assign(E.cloneImage(img), { scale: 1 }), params, ctx);
  const tf = Date.now() - t;
  let bad = 0; for (const c of ['r', 'g', 'b']) for (const x of full[c]) if (!(x >= 0 && x <= 1)) bad++;
  if (bad) fail++;
  console.log(name.padEnd(16), 'preview', String(tp).padStart(5), 'ms  cached', String(tc).padStart(5), 'ms  full', String(tf).padStart(6), 'ms  bg', E.medMad(full.g).med.toFixed(3), bad ? 'NaN/out of range: ' + bad : '');
  save(name, full);
}
const a = E.analyze(E.downscale(img, 1200), E.downscale(img, 1200).scale);
console.log('analyze', JSON.stringify({ stars: a.stars, fwhm: a.fwhm && a.fwhm.toFixed(2), noise: a.noise.toFixed(4), gradient: a.gradient && a.gradient.toFixed(2), green: a.greenCast.toFixed(2), snr: a.snr.toFixed(1) }));
process.exit(fail ? 1 : 0);
