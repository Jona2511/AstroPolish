// Project/action files: what is saved can be loaded again and renders identically; damaged or
// hand-edited files are cleaned up instead of breaking the editor.
const E = require('../app/js/engine.js');
const O = require('../app/js/ops.js');
const C = require('../app/js/core.js');
const fs = require('fs');
const path = require('path');
const { check, summary } = require('./lib/check.js');
const { starField } = require('./lib/synth.js');

const { img } = starField({ w: 240, h: 160, seed: 3, nebula: 0.03 });
const render = (layers) => O.processStack(img, layers, { srcKey: 1, ctx: new Map(), cache: null }, {});
const same = (a, b) => ['r', 'g', 'b'].every((k) => a[k].every((v, i) => v === b[k][i]));

// 1. every preset survives save -> JSON -> load and renders bit-identically
for (const name of ['auto', 'hoo', 'starless', 'spikes', 'moon']) {
  const { layers } = O.presetLayers(name, { type: 'nebula' });
  layers[1].mask = Object.assign(layers[1].mask, { type: 'lum', lo: 0.2, hi: 0.9, invert: true, feather: 0.3, strokes: [{ pts: [[0.2, 0.2], [0.5, 0.6]], r: 0.03, hard: 0.5, a: 1, mode: 'hide' }] });
  layers[1].blend = 'screen'; layers[1].opacity = 0.7;
  const saved = JSON.parse(JSON.stringify({ app: 'AstroPolish', type: 'project', version: 3, layers }));
  const { layers: loaded, dropped } = O.sanitizeLayers(saved.layers);
  check(`project round trip (${name}): no layers lost`, dropped === 0 && loaded.length === layers.length);
  check(`project round trip (${name}): renders identically`, same(render(layers), render(loaded)));
}
// 2. curves, HSL, wavelets, text and healing strokes keep their values
{
  const ls = [O.newLayer('curves', { curves: { rgb: [[0, 0], [0.4, 0.6], [1, 1]] } }), O.newLayer('hsl', { hsl: { red: [0.2, 1.4, -0.1] } }), O.newLayer('wavelets', { gains: [0.5, 0.2, 0, 0, 0, 0.1] }),
    O.newLayer('text', { text: 'M 42', sub: '2026-11-26', x: 0.1, y: 0.8, size: 0.05, color: '#ffcc00' }), O.newLayer('heal', { strokes: [{ pts: [[0.1, 0.1], [0.3, 0.3]], r: 0.01, hard: 0.6, a: 1, mode: 'show' }] })];
  const back = O.sanitizeLayers(JSON.parse(JSON.stringify(ls))).layers;
  check('curve points preserved', JSON.stringify(back[0].params.curves.rgb) === JSON.stringify([[0, 0], [0.4, 0.6], [1, 1]]));
  check('HSL values preserved', JSON.stringify(back[1].params.hsl.red) === JSON.stringify([0.2, 1.4, -0.1]));
  check('wavelet gains preserved', JSON.stringify(back[2].params.gains) === JSON.stringify([0.5, 0.2, 0, 0, 0, 0.1]));
  check('text layer preserved', back[3].params.text === 'M 42' && back[3].params.color === '#ffcc00' && back[3].params.y === 0.8);
  check('healing strokes preserved', back[4].params.strokes.length === 1 && back[4].params.strokes[0].pts.length === 2);
  check('healing renders identically after reload', same(render(ls), render(back)));
}
// 3. damaged / hostile input is cleaned, never throws
{
  const junk = [null, 5, 'x', { op: 'doesNotExist' }, { op: '__proto__' }, { op: 'constructor' },
    { op: 'stretch', params: { brightness: 'abc', method: 'evil', blackPoint: NaN, colorPreserve: 1e9 }, opacity: 'x', blend: 'nonsense', mask: { type: 'weird', feather: -5, strokes: [{ pts: [[NaN, 1], [0.5, 0.5]] }, 'bad'] } },
    { op: 'curves', params: { curves: { rgb: 'not an array' } } }, { op: 'heal', params: { strokes: 'x' } }, { op: 'text', params: { text: { toString: 1 } } }];
  let r, threw = null;
  try { r = O.sanitizeLayers(junk); } catch (e) { threw = e.message; }
  check('damaged project: sanitizeLayers never throws', threw === null, threw);
  check('damaged project: unknown/invalid layers dropped and counted', r && r.dropped === 6 && r.layers.length === 4, r && `${r.layers.length} kept, ${r.dropped} dropped`);
  const st = r.layers[0];
  check('damaged project: invalid numbers replaced by defaults or clamped', st.params.brightness === O.defaults('stretch').brightness && st.params.method === 'auto' && st.params.colorPreserve === 1 && st.opacity === 1 && st.blend === 'normal');
  check('damaged project: invalid mask repaired', st.mask.type === 'none' && st.mask.feather === 0 && st.mask.strokes.length === 1 && st.mask.strokes[0].pts.length === 1);
  let out, err = null;
  try { out = render(r.layers); } catch (e) { err = e.message; }
  check('damaged project: cleaned layers render to finite 0..1 values', !err && ['r', 'g', 'b'].every((k) => out[k].every((v) => v >= 0 && v <= 1)), err);
  check('sanitizeLayers(non-array) returns an empty list', O.sanitizeLayers({ a: 1 }).layers.length === 0);
  const g = O.sanitizeGeom({ rot: 7, angle: 999, scale: -2, crop: { x: 0.1, y: 0.1, w: NaN, h: 0.5 }, fh: 'yes' }, { rot: 0, fh: false, fv: false, angle: 0, crop: null, bin: false, scale: 1 });
  check('sanitizeGeom: invalid geometry repaired', g.rot === 0 && g.angle === 45 && g.scale === 0.1 && g.crop === null && g.fh === true);
}
// 4. a 'source' with NaN pixels is sanitised in the worker core and reported
{
  const bad = E.cloneImage(img); bad.r[5] = NaN; bad.g[6] = Infinity;
  const state = {};
  const res = C.handle(state, { cmd: 'source', img: { w: bad.w, h: bad.h, r: bad.r, g: bad.g, b: bad.b, mono: false, meta: {} }, previewSize: 200 }).result;
  check('worker source: NaN/Inf replaced and counted', res.replaced === 2 && Number.isFinite(state.src.r[5]) && state.src.g[6] === 0);
}
// 5. decode command (used by the worker) returns the same image as the readers
(async () => {
  const b = fs.readFileSync(path.join(__dirname, 'fixtures', 'tif_u16_mono_deflate_pred.tif'));
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const r = await C.decode({ cmd: 'decode', ext: 'tif', buffer: buf });
  check('worker decode: TIFF decoded with transferable channel buffers', r.result.img.w === 37 && r.transfer.length === 3);
  summary('PROJECT');
})();
