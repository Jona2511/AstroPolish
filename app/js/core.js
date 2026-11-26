/*
 * AstroPolish - message handler shared by the Web Worker and the in-page fallback (v3, layers).
 */
(function (root) {
  'use strict';
  const E = root.AstroEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const O = root.AstroOps || (typeof require !== 'undefined' ? require('./ops.js') : null);
  const ST = root.AstroStack || (typeof require !== 'undefined' ? require('./stack.js') : null);
  let srcCounter = 0;

  function sizeForExport(img, opt) {
    if (!opt || opt.mode === 'original') return img;
    if (opt.mode === 'scale') { const f = opt.factor || 1; return f === 1 ? img : E.resize(img, Math.max(1, Math.round(img.w * f)), Math.max(1, Math.round(img.h * f))); }
    if (opt.mode === 'upscale') return E.resize(img, Math.round(img.w * (opt.factor || 2)), Math.round(img.h * (opt.factor || 2)));
    if (opt.mode === 'long') {
      const f = opt.size / Math.max(img.w, img.h);
      return f >= 1 ? img : E.resize(img, Math.round(img.w * f), Math.round(img.h * f));
    }
    if (opt.mode === 'pad' || opt.mode === 'fill') {
      const [rw, rh] = opt.ratio;
      const tw = opt.width, th = Math.round(opt.width * rh / rw);
      if (opt.mode === 'fill') {
        const ar = tw / th;
        let cw = img.w, ch = Math.round(img.w / ar);
        if (ch > img.h) { ch = img.h; cw = Math.round(img.h * ar); }
        return E.resize(E.cropImage(img, (img.w - cw) / 2, (img.h - ch) / 2, cw, ch), tw, th);
      }
      const f = Math.min(tw / img.w, th / img.h);
      return E.pad(E.resize(img, Math.max(1, Math.round(img.w * f)), Math.max(1, Math.round(img.h * f))), tw, th, 0);
    }
    return img;
  }

  // make sure the measurements (ctx) exist for these layers: run them once on the preview
  function warm(state, layers) { O.processStack(state.prev, layers, state.store, { cache: true }); }

  // decode FITS/TIFF (async because deflate-compressed TIFF uses DecompressionStream)
  async function decode(msg) {
    const F = root.AstroFormats || (typeof require !== 'undefined' ? require('./formats.js') : null);
    const img = ['tif', 'tiff'].includes(msg.ext) ? await F.readTIFF(msg.buffer) : F.readFITS(msg.buffer);
    return { result: { cmd: 'decode', img }, transfer: [img.r.buffer, img.g.buffer, img.b.buffer] };
  }

  function handle(state, msg) {
    switch (msg.cmd) {
      case 'source': {
        const src = msg.img;
        Object.assign(src, { scale: 1, x0: 0, y0: 0, fullW: src.w, fullH: src.h });
        // defensive: whatever the decoder produced, NaN/Inf must never enter the pipeline
        const replaced = E.sanitize(src);
        state.src = src;
        state.prev = E.downscale(src, msg.previewSize || 1200);
        state.store = { srcKey: ++srcCounter, ctx: new Map(), cache: new Map() };
        const before = E.toRGBA(state.prev);
        const det = E.autoPreset(state.prev, msg.fileName || '');
        return { result: { cmd: 'source', w: src.w, h: src.h, pw: state.prev.w, ph: state.prev.h, before, detected: det, replaced }, transfer: [before.buffer] };
      }
      case 'analyze': return { result: { cmd: 'analyze', analysis: E.analyze(state.prev, state.prev.scale) } };
      case 'preview': {
        const t = Date.now();
        const out = O.processStack(state.prev, msg.layers, state.store, { cache: true, viewMask: msg.viewMask, cacheSize: msg.cacheSize || 12 });
        const rgba = E.toRGBA(out);
        return { result: { cmd: 'preview', rgba, w: out.w, h: out.h, hist: E.histogram(out), ms: Date.now() - t }, transfer: [rgba.buffer] };
      }
      case 'snapshot': {
        const out = O.processStack(state.prev, msg.layers, { srcKey: state.store.srcKey, ctx: state.store.ctx, cache: null }, {});
        const rgba = E.toRGBA(out);
        return { result: { cmd: 'snapshot', rgba, w: out.w, h: out.h }, transfer: [rgba.buffer] };
      }
      case 'region': {
        warm(state, msg.layers);
        const src = state.src, R = msg.rect;
        const margin = Math.min(320, Math.round(src.w / 12));
        const x = Math.max(0, R.x - margin), y = Math.max(0, R.y - margin);
        const x2 = Math.min(src.w, R.x + R.w + margin), y2 = Math.min(src.h, R.y + R.h + margin);
        const crop = Object.assign(E.cropImage(src, x, y, x2 - x, y2 - y), { x0: x, y0: y, fullW: src.w, fullH: src.h, scale: 1 });
        const out = O.processStack(crop, msg.layers, state.store, { viewMask: msg.viewMask });
        const inner = E.cropImage(out, R.x - x, R.y - y, R.w, R.h);
        const rgba = E.toRGBA(inner);
        let before;
        if (msg.beforeLayers) { warm(state, msg.beforeLayers); before = E.toRGBA(E.cropImage(O.processStack(crop, msg.beforeLayers, state.store, {}), R.x - x, R.y - y, R.w, R.h)); }
        else before = E.toRGBA(E.cropImage(src, R.x, R.y, R.w, R.h));
        return { result: { cmd: 'region', rect: R, w: inner.w, h: inner.h, rgba, before }, transfer: [rgba.buffer, before.buffer] };
      }
      case 'full': {
        warm(state, msg.layers);
        let out = O.processStack(state.src, msg.layers, state.store, {});
        if (msg.compare) {
          let orig = state.src;
          if (msg.compareLayers) { warm(state, msg.compareLayers); orig = O.processStack(state.src, msg.compareLayers, state.store, {}); }
          const both = E.newImage(out.w * 2, out.h, out);
          for (const c of ['r', 'g', 'b']) for (let yy = 0; yy < out.h; yy++) {
            both[c].set(orig[c].subarray(yy * out.w, (yy + 1) * out.w), yy * out.w * 2);
            both[c].set(out[c].subarray(yy * out.w, (yy + 1) * out.w), yy * out.w * 2 + out.w);
          }
          out = both;
        }
        out = sizeForExport(out, msg.size);
        if (msg.format === 'rgb16') { const data = E.toRGB16(out); return { result: { cmd: 'full', w: out.w, h: out.h, data, format: 'rgb16' }, transfer: [data.buffer] }; }
        if (msg.format === 'float') return { result: { cmd: 'full', w: out.w, h: out.h, r: out.r, g: out.g, b: out.b, format: 'float' }, transfer: [out.r.buffer, out.g.buffer, out.b.buffer] };
        const data = E.toRGBA(out);
        return { result: { cmd: 'full', w: out.w, h: out.h, data, format: 'rgba' }, transfer: [data.buffer] };
      }
      case 'probeStar': {
        // star measurement on the original data around a clicked point
        const src = state.src, R = 14;
        const cx = Math.round(msg.x), cy = Math.round(msg.y);
        const x0 = Math.max(0, cx - R), y0 = Math.max(0, cy - R), x1 = Math.min(src.w - 1, cx + R), y1 = Math.min(src.h - 1, cy + R);
        const vals = [];
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * src.w + x; vals.push((src.r[i] + src.g[i] + src.b[i]) / 3); }
        const sorted = vals.slice().sort((a, b) => a - b), bg = sorted[Math.floor(sorted.length * 0.3)];
        let px = cx, py = cy, pk = -1;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * src.w + x; const v = (src.r[i] + src.g[i] + src.b[i]) / 3; if (v > pk) { pk = v; px = x; py = y; } }
        let sf = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sr = 0, sg = 0, sb = 0;
        const r2 = 8;
        for (let y = Math.max(0, py - r2); y <= Math.min(src.h - 1, py + r2); y++) for (let x = Math.max(0, px - r2); x <= Math.min(src.w - 1, px + r2); x++) {
          const i = y * src.w + x; const f = Math.max(0, (src.r[i] + src.g[i] + src.b[i]) / 3 - bg);
          sf += f; sx += f * (x - px); sy += f * (y - py); sxx += f * (x - px) ** 2; syy += f * (y - py) ** 2;
          sr += Math.max(0, src.r[i] - bg); sg += Math.max(0, src.g[i] - bg); sb += Math.max(0, src.b[i] - bg);
        }
        if (sf <= 0) return { result: { cmd: 'probeStar', found: false } };
        const mx = sx / sf, my = sy / sf;
        const vx = Math.max(0.05, sxx / sf - mx * mx), vy = Math.max(0.05, syy / sf - my * my);
        const fwhm = 2.355 * Math.sqrt((vx + vy) / 2);
        const noise = 1.4826 * (sorted[Math.floor(sorted.length * 0.5)] - sorted[Math.floor(sorted.length * 0.25)]) / 0.6745 + 1e-6;
        return { result: { cmd: 'probeStar', found: true, x: px + mx, y: py + my, fwhm, round: Math.min(vx, vy) / Math.max(vx, vy), peak: pk, bg, snr: (pk - bg) / noise, saturated: pk > 0.97, color: [sr / sf, sg / sf, sb / sf] } };
      }
      case 'stackReset': state.stack = {}; return { result: { cmd: 'stackReset' } };
      case 'stackAdd': { if (!state.stack) state.stack = {}; return { result: Object.assign({ cmd: 'stackAdd' }, ST.add(state, msg.img)) }; }
      case 'stackFinish': {
        const out = ST.finish(state);
        if (!out) throw new Error('nothing to combine');
        return { result: { cmd: 'stackFinish', img: out }, transfer: [out.r.buffer, out.g.buffer, out.b.buffer] };
      }
      default: throw new Error('unknown command ' + msg.cmd);
    }
  }

  const api = { decode, handle };
  root.AstroCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
