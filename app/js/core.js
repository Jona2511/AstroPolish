/*
 * AstroPolish - message handler shared by the Web Worker and the in-page fallback.
 */
(function (root) {
  'use strict';
  const E = root.AstroEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const ST = root.AstroStack || (typeof require !== 'undefined' ? require('./stack.js') : null);
  const PREVIEW_SIZE = 1200;

  // export sizing: original, long side, pad to aspect ratio, upscale
  function sizeForExport(img, opt) {
    if (!opt || opt.mode === 'original') return img;
    if (opt.mode === 'upscale') return E.resize(img, Math.round(img.w * (opt.factor || 2)), Math.round(img.h * (opt.factor || 2)));
    if (opt.mode === 'long') {
      const f = opt.size / Math.max(img.w, img.h);
      if (f >= 1) return img;
      return E.resize(img, Math.round(img.w * f), Math.round(img.h * f));
    }
    if (opt.mode === 'pad' || opt.mode === 'fill') {
      const [rw, rh] = opt.ratio;
      const tw = opt.width, th = Math.round(opt.width * rh / rw);
      if (opt.mode === 'fill') {
        // crop to aspect, then resize
        const ar = tw / th;
        let cw = img.w, ch = Math.round(img.w / ar);
        if (ch > img.h) { ch = img.h; cw = Math.round(img.h * ar); }
        const c = E.cropImage(img, (img.w - cw) / 2, (img.h - ch) / 2, cw, ch);
        return E.resize(c, tw, th);
      }
      const f = Math.min(tw / img.w, th / img.h);
      const r = E.resize(img, Math.max(1, Math.round(img.w * f)), Math.max(1, Math.round(img.h * f)));
      return E.pad(r, tw, th, 0);
    }
    return img;
  }

  function handle(state, msg) {
    switch (msg.cmd) {
      case 'source': {
        const src = msg.img;
        src.scale = 1; src.x0 = 0; src.y0 = 0; src.fullW = src.w; src.fullH = src.h;
        state.src = src;
        state.prev = E.downscale(src, msg.previewSize || PREVIEW_SIZE);
        state.cache = {};
        const before = E.toRGBA(state.prev);
        const det = E.autoPreset(state.prev, msg.fileName || '');
        return { result: { cmd: 'source', w: src.w, h: src.h, pw: state.prev.w, ph: state.prev.h, before, detected: det }, transfer: [before.buffer] };
      }
      case 'analyze': {
        const a = E.analyze(state.prev, state.prev.scale);
        return { result: { cmd: 'analyze', analysis: a } };
      }
      case 'preview': {
        const ctx = {};
        const t = Date.now();
        const out = E.process(state.prev, msg.params, ctx, state.cache);
        const rgba = E.toRGBA(out);
        const hist = E.histogram(out);
        return { result: { cmd: 'preview', rgba, w: out.w, h: out.h, hist, ms: Date.now() - t }, transfer: [rgba.buffer] };
      }
      case 'snapshot': {
        // processed preview with other params (A/B compare) - no cache pollution
        const out = E.process(state.prev, msg.params, {}, null);
        const rgba = E.toRGBA(out);
        return { result: { cmd: 'snapshot', rgba, w: out.w, h: out.h }, transfer: [rgba.buffer] };
      }
      case 'region': {
        const ctx = {};
        E.process(state.prev, msg.params, ctx, state.cache);
        const src = state.src;
        const R = msg.rect;
        const margin = Math.min(320, Math.round(src.w / 12));
        const x = Math.max(0, R.x - margin), y = Math.max(0, R.y - margin);
        const x2 = Math.min(src.w, R.x + R.w + margin), y2 = Math.min(src.h, R.y + R.h + margin);
        const crop = E.cropImage(src, x, y, x2 - x, y2 - y);
        Object.assign(crop, { x0: x, y0: y, fullW: src.w, fullH: src.h, scale: 1 });
        const out = E.process(crop, msg.params, ctx);
        const inner = E.cropImage(out, R.x - x, R.y - y, R.w, R.h);
        const rgba = E.toRGBA(inner);
        let before;
        if (msg.beforeParams) {
          const ctxB = {};
          E.process(state.prev, msg.beforeParams, ctxB, null);
          const ob = E.process(crop, msg.beforeParams, ctxB);
          before = E.toRGBA(E.cropImage(ob, R.x - x, R.y - y, R.w, R.h));
        } else before = E.toRGBA(E.cropImage(src, R.x, R.y, R.w, R.h));
        return { result: { cmd: 'region', rect: R, w: inner.w, h: inner.h, rgba, before }, transfer: [rgba.buffer, before.buffer] };
      }
      case 'full': {
        const ctx = {};
        E.process(state.prev, msg.params, ctx, state.cache);
        let out = E.process(state.src, msg.params, ctx);
        if (msg.compare) {
          // side by side: original (stretched when linear) | result
          let orig = state.src;
          if (msg.compareParams) { const c2 = {}; E.process(state.prev, msg.compareParams, c2, null); orig = E.process(state.src, msg.compareParams, c2); }
          const both = E.newImage(out.w * 2, out.h, out);
          for (const c of ['r', 'g', 'b']) for (let yy = 0; yy < out.h; yy++) {
            both[c].set(orig[c].subarray(yy * out.w, (yy + 1) * out.w), yy * out.w * 2);
            both[c].set(out[c].subarray(yy * out.w, (yy + 1) * out.w), yy * out.w * 2 + out.w);
          }
          out = both;
        }
        out = sizeForExport(out, msg.size);
        if (msg.format === 'rgb16') {
          const data = E.toRGB16(out);
          return { result: { cmd: 'full', w: out.w, h: out.h, data, format: 'rgb16' }, transfer: [data.buffer] };
        }
        if (msg.format === 'float') {
          return { result: { cmd: 'full', w: out.w, h: out.h, r: out.r, g: out.g, b: out.b, format: 'float' }, transfer: [out.r.buffer, out.g.buffer, out.b.buffer] };
        }
        const data = E.toRGBA(out);
        return { result: { cmd: 'full', w: out.w, h: out.h, data, format: 'rgba' }, transfer: [data.buffer] };
      }
      case 'stackReset': state.stack = {}; return { result: { cmd: 'stackReset' } };
      case 'stackAdd': {
        if (!state.stack) state.stack = {};
        const r = ST.add(state, msg.img);
        return { result: Object.assign({ cmd: 'stackAdd' }, r) };
      }
      case 'stackFinish': {
        const out = ST.finish(state);
        if (!out) throw new Error('nothing to combine');
        return { result: { cmd: 'stackFinish', img: out }, transfer: [out.r.buffer, out.g.buffer, out.b.buffer] };
      }
      default:
        throw new Error('unknown command ' + msg.cmd);
    }
  }

  const api = { handle, PREVIEW_SIZE };
  root.AstroCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
