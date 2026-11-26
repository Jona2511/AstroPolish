/*
 * AstroPolish - message handler shared by the Web Worker and the in-page fallback.
 */
(function (root) {
  'use strict';
  const E = root.AstroEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const PREVIEW_SIZE = 1200;

  function handle(state, msg) {
    switch (msg.cmd) {
      case 'source': {
        const src = msg.img;
        src.scale = 1; src.x0 = 0; src.y0 = 0; src.fullW = src.w; src.fullH = src.h;
        state.src = src;
        state.prev = E.downscale(src, msg.previewSize || PREVIEW_SIZE);
        const before = E.toRGBA(state.prev);
        const det = E.autoPreset(state.prev, msg.fileName || '');
        return { result: { cmd: 'source', w: src.w, h: src.h, pw: state.prev.w, ph: state.prev.h, before, detected: det }, transfer: [before.buffer] };
      }
      case 'preview': {
        const ctx = {};
        const t = Date.now();
        const out = E.process(state.prev, msg.params, ctx);
        const rgba = E.toRGBA(out);
        const hist = E.histogram(out);
        return { result: { cmd: 'preview', id: msg.id, rgba, w: out.w, h: out.h, hist, ms: Date.now() - t }, transfer: [rgba.buffer] };
      }
      case 'region': {
        const ctx = {};
        E.process(state.prev, msg.params, ctx);
        const src = state.src;
        const R = msg.rect;
        const margin = Math.min(320, Math.round(src.w / 12));
        const x = Math.max(0, R.x - margin), y = Math.max(0, R.y - margin);
        const x2 = Math.min(src.w, R.x + R.w + margin), y2 = Math.min(src.h, R.y + R.h + margin);
        const crop = E.cropImage(src, x, y, x2 - x, y2 - y);
        Object.assign(crop, { x0: x, y0: y, fullW: src.w, fullH: src.h, scale: 1 });
        const out = E.process(crop, msg.params, ctx);
        const inner = E.cropImage(out, R.x - x, R.y - y, R.w, R.h);
        const innerBefore = E.cropImage(src, R.x, R.y, R.w, R.h);
        const rgba = E.toRGBA(inner), before = E.toRGBA(innerBefore);
        return { result: { cmd: 'region', id: msg.id, rect: R, w: inner.w, h: inner.h, rgba, before }, transfer: [rgba.buffer, before.buffer] };
      }
      case 'full': {
        const ctx = {};
        E.process(state.prev, msg.params, ctx);
        const out = E.process(state.src, msg.params, ctx);
        if (msg.format === 'rgb16') {
          const data = E.toRGB16(out);
          return { result: { cmd: 'full', id: msg.id, w: out.w, h: out.h, data, format: 'rgb16' }, transfer: [data.buffer] };
        }
        const data = E.toRGBA(out);
        return { result: { cmd: 'full', id: msg.id, w: out.w, h: out.h, data, format: 'rgba' }, transfer: [data.buffer] };
      }
      default:
        throw new Error('unknown command ' + msg.cmd);
    }
  }

  const api = { handle, PREVIEW_SIZE };
  root.AstroCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
