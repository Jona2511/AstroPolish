// Node test: run every preset on a synthetic image, write raw RGB for inspection
const E = require('../app/js/engine.js');
const fs = require('fs');
const out = process.argv[2] || '/tmp/ap';
fs.mkdirSync(out, { recursive: true });
const W = +process.env.W || 1920, H = +process.env.H || 1080;
let t = Date.now();
let img = E.makeDemo(W, H, 7);
console.log('demo', Date.now() - t, 'ms');
const crop = E.detectAutoCrop(img);
console.log('autocrop', crop);
if (crop) img = E.cropImage(img, crop.x, crop.y, crop.x2 - crop.x, crop.y2 - crop.y);
const save = (name, im) => {
  const buf = Buffer.alloc(im.w * im.h * 3);
  for (let i = 0; i < im.w * im.h; i++) { buf[i*3]=Math.round(im.r[i]*255); buf[i*3+1]=Math.round(im.g[i]*255); buf[i*3+2]=Math.round(im.b[i]*255); }
  fs.writeFileSync(`${out}/${name}.rgb`, buf); fs.writeFileSync(`${out}/${name}.dim`, `${im.w} ${im.h}`);
};
save('00_original_linear', img);
const presets = (process.env.PRESETS || Object.keys(E.PRESETS).join(',')).split(',');
for (const name of presets) {
  const { params, detected } = E.presetParams(name, img, 'DWARF_RAW_TELE_M 42_EXP_15.fits');
  const prev = E.downscale(img, 1200);
  const ctx = {};
  t = Date.now();
  const p = E.process(prev, params, ctx);
  const tp = Date.now() - t;
  t = Date.now();
  const full = E.process(Object.assign(E.cloneImage(img), {scale:1}), params, ctx);
  const tf = Date.now() - t;
  const st = E.medMad(full.g);
  console.log(name.padEnd(10), 'preview', tp, 'ms  full', tf, 'ms  bg', st.med.toFixed(3), detected ? JSON.stringify(detected) : '', 'k', JSON.stringify(ctx.colour.k), 'grad', ctx.gradient && ctx.gradient.used + '/' + ctx.gradient.total);
  save(name, full);
  save(name + '_preview', p);
}
