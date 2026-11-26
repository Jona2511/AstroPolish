// Node test for the layer engine: presets as layer stacks, every op, masks, blend modes, cache
const E = require('../app/js/engine.js');
const O = require('../app/js/ops.js');
const fs = require('fs');
const out = process.argv[2] || '/tmp/ops';
fs.mkdirSync(out, { recursive: true });
let img = E.makeDemo(+process.env.W || 1200, +process.env.H || 700, 7);
const c = E.detectAutoCrop(img); if (c) img = E.cropImage(img, c.x, c.y, c.x2 - c.x, c.y2 - c.y);
const prev = E.downscale(img, 900);
const full = Object.assign(E.cloneImage(img), { scale: 1, x0: 0, y0: 0, fullW: img.w, fullH: img.h });
const save = (name, im) => { const b = Buffer.alloc(im.w * im.h * 3); for (let i = 0; i < im.w * im.h; i++) { b[i * 3] = im.r[i] * 255; b[i * 3 + 1] = im.g[i] * 255; b[i * 3 + 2] = im.b[i] * 255; } fs.writeFileSync(`${out}/${name}.rgb`, b); fs.writeFileSync(`${out}/${name}.dim`, `${im.w} ${im.h}`); };
const bad = (im) => { let n = 0; for (const k of ['r', 'g', 'b']) for (const v of im[k]) if (!(v >= 0 && v <= 1)) n++; return n; };
let fail = 0;
// 1. preset stack + cache behaviour
const det = { type: 'nebula' };
const { layers } = O.presetLayers('auto', det);
const store = { srcKey: 1, ctx: new Map(), cache: new Map() };
let t = Date.now(); let r = O.processStack(prev, layers, store, { cache: true }); const t1 = Date.now() - t;
layers[layers.length - 1].params.amount = (layers[layers.length - 1].params.amount || 0.5) + 0.05;
t = Date.now(); O.processStack(prev, layers, store, { cache: true }); const t2 = Date.now() - t;
const f = O.processStack(full, layers, store, {});
console.log('preset stack', layers.map((l) => l.op).join(' > '));
console.log(`preview ${t1} ms, cached edit of last layer ${t2} ms, full bad=${bad(f)}`);
save('stack_full', f);
if (bad(f)) fail++;
// 2. every op on a stretched base
const base = O.processStack(prev, [O.newLayer('gradient'), O.newLayer('colorcal'), O.newLayer('stretch')], { srcKey: 2, ctx: new Map(), cache: null }, {});
for (const op of Object.keys(O.OPS)) {
  const st = { srcKey: 3, ctx: new Map(), cache: null };
  const L = O.newLayer(op);
  if (op === 'heal') L.params.strokes = [{ pts: [[0.1, 0.1], [0.9, 0.8]], r: 0.01, mode: 'show' }];
  if (op === 'curves') L.params.curves = { rgb: [[0, 0], [0.3, 0.2], [0.7, 0.85], [1, 1]] };
  if (op === 'hsl') L.params.hsl = { red: [0.3, 1.5, 0.1] };
  t = Date.now();
  let res;
  try { res = O.processStack(base, [L], st, {}); } catch (e) { console.log(op.padEnd(14), 'ERROR', e.message); fail++; continue; }
  const b = bad(res);
  if (b) fail++;
  console.log(op.padEnd(14), String(Date.now() - t).padStart(5), 'ms', b ? 'BAD ' + b : 'ok');
  save('op_' + op, res);
}
// 3. masks and blend modes
for (const m of [{ type: 'lum', lo: 0.3, hi: 1 }, { type: 'hue', hue: 0, width: 40 }, { type: 'stars' }, { type: 'nostars' }, { type: 'signal' }, { type: 'background' }, { type: 'shape', shape: { kind: 'ellipse', x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, shapeFeather: 0.05 }, { type: 'paint', strokes: [{ pts: [[0.5, 0.5]], r: 0.1, mode: 'show' }] }]) {
  const L = O.newLayer('huesat', { hue: 120, sat: 0.5 }); Object.assign(L.mask, m);
  const res = O.processStack(base, [L], { srcKey: 4, ctx: new Map() }, {});
  console.log('mask', m.type.padEnd(10), bad(res) ? 'BAD' : 'ok'); save('mask_' + m.type, res);
}
for (const bm of O.BLENDS) {
  const L = O.newLayer('gblur', { radius: 6 }); L.blend = bm; L.opacity = 0.8;
  const res = O.processStack(base, [L], { srcKey: 5, ctx: new Map() }, {});
  if (bad(res)) { fail++; console.log('blend', bm, 'BAD'); }
}
console.log('blend modes ok:', O.BLENDS.length);
for (const name of ['nebula', 'galaxy', 'hoo', 'hubble', 'starless', 'spikes', 'dreamy', 'moon', 'sunHa', 'planet']) {
  const { layers: Ls } = O.presetLayers(name, null);
  const res = O.processStack(prev, Ls, { srcKey: 6, ctx: new Map() }, {});
  save('preset_' + name, res); if (bad(res)) fail++;
}
console.log(fail ? 'OPS FAIL ' + fail : 'OPS OK');
process.exit(fail ? 1 : 0);
