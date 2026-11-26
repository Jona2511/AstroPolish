/*
 * AstroPolish - processing engine.
 * Pure JavaScript, no dependencies, works in browsers, Electron and Node.
 *
 * Pipeline (each step optional, controlled by params):
 *   hot pixels -> gradient removal -> background neutralisation + star colour
 *   calibration -> stretch (auto STF / levels) -> HDR highlight protection ->
 *   noise reduction (luma + chroma) -> star reduction -> local contrast ->
 *   sharpening -> contrast curve -> saturation / vibrance -> green removal -> mono
 *
 * process(img, params, ctx): when ctx is empty the global measurements
 * (gradient model, colour factors, stretch) are computed from img and stored
 * in ctx. Processing the full resolution image (or a crop of it) with the same
 * ctx then gives the same look as the small preview.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ helpers ---
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  function cloneImage(img) {
    return {
      w: img.w, h: img.h, r: new Float32Array(img.r), g: new Float32Array(img.g), b: new Float32Array(img.b),
      mono: img.mono, meta: img.meta,
      x0: img.x0 || 0, y0: img.y0 || 0, fullW: img.fullW || img.w, fullH: img.fullH || img.h,
      scale: img.scale || 1,
    };
  }

  function lum(img, out) {
    const n = img.w * img.h, L = out || new Float32Array(n);
    const r = img.r, g = img.g, b = img.b;
    for (let i = 0; i < n; i++) L[i] = (r[i] + g[i] + b[i]) / 3;
    return L;
  }

  // median + MAD with a fine histogram (fast, accurate to 1/65536)
  function medMad(arr, step) {
    step = step || Math.max(1, Math.floor(arr.length / 400000));
    const B = 65536, hist = new Uint32Array(B);
    let n = 0;
    for (let i = 0; i < arr.length; i += step) { hist[Math.min(B - 1, Math.max(0, (arr[i] * (B - 1)) | 0))]++; n++; }
    const med = histPct(hist, n, 0.5);
    const dh = new Uint32Array(B);
    for (let i = 0; i < arr.length; i += step) { const d = Math.abs(arr[i] - med); dh[Math.min(B - 1, (d * (B - 1)) | 0)]++; }
    const mad = histPct(dh, n, 0.5);
    return { med, mad };
  }
  function histPct(hist, n, p) {
    const target = n * p;
    let c = 0;
    for (let i = 0; i < hist.length; i++) { c += hist[i]; if (c >= target) return (i + 0.5) / (hist.length - 1); }
    return 1;
  }
  function percentile(arr, p, step) {
    step = step || Math.max(1, Math.floor(arr.length / 400000));
    const B = 65536, hist = new Uint32Array(B);
    let n = 0;
    for (let i = 0; i < arr.length; i += step) { hist[Math.min(B - 1, Math.max(0, (arr[i] * (B - 1)) | 0))]++; n++; }
    return histPct(hist, n, p);
  }

  // separable box blur with running sums, edge clamped
  function boxBlur(src, w, h, r, out) {
    out = out || new Float32Array(w * h);
    if (r < 1) { out.set(src); return out; }
    const tmp = new Float32Array(w * h);
    const inv = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[o + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = s * inv;
        const xa = Math.min(w - 1, x + r + 1), xr = Math.max(0, x - r);
        s += src[o + xa] - src[o + xr];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s * inv;
        const ya = Math.min(h - 1, y + r + 1), yr = Math.max(0, y - r);
        s += tmp[ya * w + x] - tmp[yr * w + x];
      }
    }
    return out;
  }

  // gaussian approximation with 3 box passes
  function gauss(src, w, h, sigma) {
    if (sigma < 0.4) return new Float32Array(src);
    const n = 3;
    const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
    let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
    const m = Math.round(mIdeal);
    let a = src, b = null;
    for (let i = 0; i < n; i++) {
      const r = ((i < m ? wl : wu) - 1) / 2;
      b = boxBlur(a, w, h, Math.max(1, Math.round(r)));
      a = b;
    }
    return a;
  }

  function minMaxFilter(src, w, h, r, isMax) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        let v = src[o + x];
        for (let k = -r; k <= r; k++) {
          const xx = x + k; if (xx < 0 || xx >= w) continue;
          const s = src[o + xx]; if (isMax ? s > v : s < v) v = s;
        }
        tmp[o + x] = v;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = tmp[y * w + x];
        for (let k = -r; k <= r; k++) {
          const yy = y + k; if (yy < 0 || yy >= h) continue;
          const s = tmp[yy * w + x]; if (isMax ? s > v : s < v) v = s;
        }
        out[y * w + x] = v;
      }
    }
    return out;
  }

  // self guided filter (edge preserving smoothing)
  function guided(I, w, h, r, eps) {
    const n = w * h;
    const mI = boxBlur(I, w, h, r);
    const II = new Float32Array(n);
    for (let i = 0; i < n; i++) II[i] = I[i] * I[i];
    const mII = boxBlur(II, w, h, r);
    const a = II, bb = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = mII[i] - mI[i] * mI[i];
      const ai = v / (v + eps);
      a[i] = ai; bb[i] = mI[i] - ai * mI[i];
    }
    const ma = boxBlur(a, w, h, r), mb = boxBlur(bb, w, h, r);
    const q = mI;
    for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
    return q;
  }

  // midtones transfer function
  function mtf(m, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    return ((m - 1) * x) / ((2 * m - 1) * x - m);
  }

  // multiply rgb so that luminance goes from L to Lnew (keeps colour)
  function applyLumRatio(img, L, Lnew, lo, hi) {
    const n = img.w * img.h;
    for (let i = 0; i < n; i++) {
      const l = L[i];
      let f = l > 1e-5 ? Lnew[i] / l : 1;
      if (f < lo) f = lo; else if (f > hi) f = hi;
      if (l <= 1e-5) { const d = Lnew[i] - l; img.r[i] += d; img.g[i] += d; img.b[i] += d; continue; }
      img.r[i] *= f; img.g[i] *= f; img.b[i] *= f;
    }
  }

  // ------------------------------------------------------ source steps ---
  // Largest rectangle without empty/black borders (stacking edges, field rotation)
  function detectAutoCrop(img) {
    const { w, h } = img;
    const ds = Math.max(1, Math.floor(Math.max(w, h) / 600));
    const mw = Math.floor(w / ds), mh = Math.floor(h / ds);
    const L = new Float32Array(mw * mh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const i = y * ds * w + x * ds;
      L[y * mw + x] = (img.r[i] + img.g[i] + img.b[i]) / 3;
    }
    const { med } = medMad(L, 1);
    const thr = Math.max(1e-5, med * 0.15);
    const bad = new Uint8Array(mw * mh);
    let anyBad = 0;
    for (let i = 0; i < L.length; i++) if (L[i] <= thr) { bad[i] = 1; anyBad++; }
    if (anyBad === 0 || med <= 1e-5) return null;
    let x0 = 0, y0 = 0, x1 = mw - 1, y1 = mh - 1;
    const maxCut = 0.2;
    const rowBad = (y) => { let c = 0; for (let x = x0; x <= x1; x++) c += bad[y * mw + x]; return c / (x1 - x0 + 1); };
    const colBad = (x) => { let c = 0; for (let y = y0; y <= y1; y++) c += bad[y * mw + x]; return c / (y1 - y0 + 1); };
    for (let it = 0; it < mw + mh; it++) {
      const f = [rowBad(y0), rowBad(y1), colBad(x0), colBad(x1)];
      let k = 0; for (let j = 1; j < 4; j++) if (f[j] > f[k]) k = j;
      if (f[k] <= 0.01) break;
      if (k === 0) y0++; else if (k === 1) y1--; else if (k === 2) x0++; else x1--;
      if (y0 > mh * maxCut || y1 < mh * (1 - maxCut) || x0 > mw * maxCut || x1 < mw * (1 - maxCut)) break;
    }
    if (x0 === 0 && y0 === 0 && x1 === mw - 1 && y1 === mh - 1) return null;
    const m = 2; // a little extra margin
    return {
      x: Math.min(w - 2, (x0 + (x0 ? m : 0)) * ds), y: Math.min(h - 2, (y0 + (y0 ? m : 0)) * ds),
      x2: Math.max(1, (x1 + 1 - (x1 < mw - 1 ? m : 0)) * ds), y2: Math.max(1, (y1 + 1 - (y1 < mh - 1 ? m : 0)) * ds),
    };
  }

  function cropImage(img, x, y, cw, ch) {
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    cw = Math.min(img.w - x, Math.round(cw)); ch = Math.min(img.h - y, Math.round(ch));
    const out = { w: cw, h: ch, r: new Float32Array(cw * ch), g: new Float32Array(cw * ch), b: new Float32Array(cw * ch), mono: img.mono, meta: img.meta };
    for (const k of ['r', 'g', 'b']) for (let yy = 0; yy < ch; yy++) {
      const s = (y + yy) * img.w + x;
      out[k].set(img[k].subarray(s, s + cw), yy * cw);
    }
    return out;
  }

  function rotate90(img) {
    const { w, h } = img;
    const out = { w: h, h: w, r: new Float32Array(w * h), g: new Float32Array(w * h), b: new Float32Array(w * h), mono: img.mono, meta: img.meta };
    for (const k of ['r', 'g', 'b']) {
      const s = img[k], d = out[k];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[x * h + (h - 1 - y)] = s[y * w + x];
    }
    return out;
  }
  function flipH(img) {
    const { w, h } = img;
    for (const k of ['r', 'g', 'b']) { const a = img[k]; for (let y = 0; y < h; y++) { const o = y * w; a.subarray(o, o + w).reverse(); } }
    return img;
  }
  function flipVert(img) {
    const { w, h } = img;
    for (const k of ['r', 'g', 'b']) {
      const a = img[k], tmp = new Float32Array(w);
      for (let y = 0; y < (h >> 1); y++) { const p = y * w, q = (h - 1 - y) * w; tmp.set(a.subarray(p, p + w)); a.copyWithin(p, q, q + w); a.set(tmp, q); }
    }
    return img;
  }

  // area-average downscale
  function downscale(img, maxSide) {
    const f = Math.max(img.w, img.h) / maxSide;
    if (f <= 1) { const c = cloneImage(img); c.scale = 1; return c; }
    const tw = Math.max(1, Math.round(img.w / f)), th = Math.max(1, Math.round(img.h / f));
    const out = { w: tw, h: th, r: new Float32Array(tw * th), g: new Float32Array(tw * th), b: new Float32Array(tw * th), mono: img.mono, meta: img.meta };
    const sx = img.w / tw, sy = img.h / th;
    for (const k of ['r', 'g', 'b']) {
      const s = img[k], d = out[k];
      for (let y = 0; y < th; y++) {
        const ya = Math.floor(y * sy), yb = Math.max(ya + 1, Math.floor((y + 1) * sy));
        for (let x = 0; x < tw; x++) {
          const xa = Math.floor(x * sx), xb = Math.max(xa + 1, Math.floor((x + 1) * sx));
          let sum = 0;
          for (let yy = ya; yy < yb; yy++) { const o = yy * img.w; for (let xx = xa; xx < xb; xx++) sum += s[o + xx]; }
          d[y * tw + x] = sum / ((yb - ya) * (xb - xa));
        }
      }
    }
    out.scale = tw / img.w; out.fullW = tw; out.fullH = th; out.x0 = 0; out.y0 = 0;
    return out;
  }

  // ------------------------------------------------------ pipeline steps ---
  function removeHotPixels(img) {
    const { w, h } = img;
    let fixed = 0;
    for (const k of ['r', 'g', 'b']) {
      const a = img[k];
      const { med, mad } = medMad(a);
      const thr = Math.max(0.01, 8 * 1.4826 * mad);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x, v = a[i];
          if (v - med < thr) continue;
          let mx = -1, sum = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const s = a[i + dy * w + dx]; sum += s; if (s > mx) mx = s;
          }
          if (v - mx > thr && (v - med) > 2.5 * (mx - med)) { a[i] = sum / 8; fixed++; }
        }
      }
    }
    return fixed;
  }

  function polyTerms(deg) {
    const t = [];
    for (let i = 0; i <= deg; i++) for (let j = 0; j <= deg - i; j++) t.push([i, j]);
    return t;
  }
  function solve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) A[i][i] += 1e-9;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      const d = A[c][c] || 1e-12;
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / d;
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
      x[r] = s / (A[r][r] || 1e-12);
    }
    return x;
  }

  // background model: tile medians, outlier rejection, polynomial fit
  function fitGradient(img, deg) {
    const { w, h } = img;
    const gx = 24, gy = Math.max(8, Math.round(24 * h / w));
    const tw = w / gx, th = h / gy;
    const tiles = [];
    const tmp = { r: [], g: [], b: [] };
    const med = (arr) => { arr.sort((a, b) => a - b); return arr[arr.length >> 1]; };
    for (let ty = 0; ty < gy; ty++) for (let tx = 0; tx < gx; tx++) {
      const xa = Math.floor(tx * tw), xb = Math.floor((tx + 1) * tw), ya = Math.floor(ty * th), yb = Math.floor((ty + 1) * th);
      const step = Math.max(1, Math.floor(Math.sqrt((xb - xa) * (yb - ya) / 400)));
      tmp.r.length = tmp.g.length = tmp.b.length = 0;
      for (let y = ya; y < yb; y += step) for (let x = xa; x < xb; x += step) {
        const i = y * w + x; tmp.r.push(img.r[i]); tmp.g.push(img.g[i]); tmp.b.push(img.b[i]);
      }
      if (!tmp.r.length) continue;
      const r = med(tmp.r), g = med(tmp.g), b = med(tmp.b);
      const cx = (img.x0 + (xa + xb) / 2) / img.fullW * 2 - 1;
      const cy = (img.y0 + (ya + yb) / 2) / img.fullH * 2 - 1;
      tiles.push({ x: cx, y: cy, r, g, b, l: (r + g + b) / 3, ok: true });
    }
    const terms = polyTerms(deg);
    const basis = (x, y) => terms.map(([i, j]) => Math.pow(x, i) * Math.pow(y, j));
    // initial rejection: bright objects and empty borders
    const ls = tiles.map((t) => t.l).sort((a, b) => a - b);
    const m0 = ls[ls.length >> 1];
    const dev = ls.map((v) => Math.abs(v - m0)).sort((a, b) => a - b);
    const s0 = Math.max(1e-6, 1.4826 * dev[dev.length >> 1]);
    for (const t of tiles) t.ok = t.l < m0 + 2.0 * s0 && t.l > m0 - 4 * s0;
    let coef = null;
    for (let iter = 0; iter < 4; iter++) {
      const good = tiles.filter((t) => t.ok);
      if (good.length < terms.length * 2) break;
      coef = {};
      for (const c of ['r', 'g', 'b']) {
        const n = terms.length;
        const A = Array.from({ length: n }, () => new Array(n).fill(0));
        const bb = new Array(n).fill(0);
        for (const t of good) {
          const v = basis(t.x, t.y);
          for (let i = 0; i < n; i++) { bb[i] += v[i] * t[c]; for (let j = 0; j < n; j++) A[i][j] += v[i] * v[j]; }
        }
        coef[c] = solve(A, bb);
      }
      // residual rejection
      const res = tiles.map((t) => {
        const v = basis(t.x, t.y);
        let m = 0; for (const c of ['r', 'g', 'b']) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * coef[c][i]; m += s; }
        return t.l - m / 3;
      });
      const okRes = res.filter((_, i) => tiles[i].ok).map(Math.abs).sort((a, b) => a - b);
      const sig = Math.max(1e-6, 1.4826 * okRes[okRes.length >> 1]);
      let changed = false;
      tiles.forEach((t, i) => { const ok = res[i] < 2.5 * sig && res[i] > -4 * sig; if (ok !== t.ok) { t.ok = ok; changed = true; } });
      if (!changed) break;
    }
    if (!coef) return null;
    // mean level of the model (to keep overall brightness)
    const mean = {};
    for (const c of ['r', 'g', 'b']) {
      let s = 0, k = 0;
      for (const t of tiles) { const v = basis(t.x, t.y); let m = 0; for (let i = 0; i < v.length; i++) m += v[i] * coef[c][i]; s += m; k++; }
      mean[c] = s / k;
    }
    let minMean = Infinity;
    for (const c of ['r', 'g', 'b']) minMean = Math.min(minMean, mean[c]);
    return { terms, coef, mean, used: tiles.filter((t) => t.ok).length, total: tiles.length };
  }

  function applyGradient(img, model, amount) {
    const { w, h } = img;
    const T = model.terms, nT = T.length;
    const px = new Float64Array(9), py = new Float64Array(9);
    const chans = ['r', 'g', 'b'];
    for (let y = 0; y < h; y++) {
      const ny = (img.y0 + y + 0.5) / img.fullH * 2 - 1;
      py[0] = 1; for (let k = 1; k < 9; k++) py[k] = py[k - 1] * ny;
      for (let x = 0; x < w; x++) {
        const nx = (img.x0 + x + 0.5) / img.fullW * 2 - 1;
        px[0] = 1; for (let k = 1; k < 9; k++) px[k] = px[k - 1] * nx;
        const i = y * w + x;
        for (let c = 0; c < 3; c++) {
          const co = model.coef[chans[c]];
          let m = 0;
          for (let t = 0; t < nT; t++) m += co[t] * px[T[t][0]] * py[T[t][1]];
          const a = img[chans[c]];
          a[i] = a[i] - amount * (m - model.mean[chans[c]]);
        }
      }
    }
  }

  // star-based colour calibration + background neutralisation
  function measureColour(img) {
    const { w, h } = img;
    const bg = {};
    for (const c of ['r', 'g', 'b']) bg[c] = medMad(img[c]).med;
    const L = lum(img);
    const sigma = Math.max(1.5, 3 * (img.scale || 1));
    const B = gauss(L, w, h, sigma);
    const hp = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) hp[i] = L[i] - B[i];
    const thr = percentile(hp.map((v) => clamp01(v * 4 + 0.5)), 0.997);
    const t = (thr - 0.5) / 4;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < L.length; i++) {
      if (hp[i] < t || hp[i] <= 0) continue;
      const r = img.r[i], g = img.g[i], b = img.b[i];
      if (r > 0.95 || g > 0.95 || b > 0.95) continue;
      const rr = r - bg.r, gg = g - bg.g, bb = b - bg.b;
      if (rr <= 0 || gg <= 0 || bb <= 0) continue;
      sr += rr; sg += gg; sb += bb; n++;
    }
    let k = { r: 1, g: 1, b: 1 };
    if (n > 20) {
      const avg = (sr + sg + sb) / 3;
      k = { r: avg / sr, g: avg / sg, b: avg / sb };
      for (const c of ['r', 'g', 'b']) k[c] = Math.min(2.5, Math.max(0.4, k[c]));
    }
    return { bg, k, stars: n };
  }

  function applyColour(img, col, p) {
    const s = p.whiteBalance;
    const k = {
      r: (1 + (col.k.r - 1) * s) * (1 + 0.25 * p.temperature),
      g: (1 + (col.k.g - 1) * s) * (1 - 0.2 * p.tint),
      b: (1 + (col.k.b - 1) * s) * (1 - 0.25 * p.temperature),
    };
    const neutral = p.neutralize ? 1 : 0;
    const bgAvg = (col.bg.r + col.bg.g + col.bg.b) / 3;
    const n = img.w * img.h;
    for (const c of ['r', 'g', 'b']) {
      const a = img[c], bgc = col.bg[c], kc = k[c];
      const target = neutral ? bgAvg : bgc;
      for (let i = 0; i < n; i++) a[i] = target + (a[i] - bgc) * kc;
    }
  }

  function measureStretch(img, p) {
    const L = lum(img);
    if (p.stretchMode === 'levels') {
      const lo = percentile(L.map(clamp01), 0.002 + 0.03 * p.blackPoint);
      const hi = Math.max(lo + 0.01, Math.min(1, percentile(L.map(clamp01), 0.99995) * 1.04));
      const m = Math.min(0.95, Math.max(0.05, 0.5 - (p.brightness - 0.22) * 1.6));
      return { c0: lo, c1: hi, m };
    }
    const Lc = L.map(clamp01);
    const { med, mad } = medMad(Lc);
    const sigmas = -3.6 + 2.4 * p.blackPoint; // blackPoint 0.33 -> about -2.8
    let c0 = Math.max(0, Math.min(med * 0.98, med + sigmas * 1.4826 * mad));
    const c1 = Math.max(c0 + 0.01, Math.min(1, percentile(Lc, 0.99995) * 1.02));
    const x = (med - c0) / (c1 - c0);
    const B = p.brightness;
    let m;
    if (x <= 0) m = 0.5; else if (x >= B) m = 0.5; else m = (x * (B - 1)) / (2 * B * x - B - x);
    m = Math.min(0.5, Math.max(0.00005, m));
    return { c0, c1, m };
  }

  function applyStretch(img, st, p) {
    const n = img.w * img.h;
    const { c0, c1, m } = st;
    const sc = 1 / (c1 - c0);
    const cp = p.colorPreserve;
    const r = img.r, g = img.g, b = img.b;
    for (let i = 0; i < n; i++) {
      const vr = clamp01((r[i] - c0) * sc), vg = clamp01((g[i] - c0) * sc), vb = clamp01((b[i] - c0) * sc);
      const sr = mtf(m, vr), sg = mtf(m, vg), sb = mtf(m, vb);
      if (cp > 0) {
        const lv = (vr + vg + vb) / 3;
        let pr, pg, pb;
        if (lv > 1e-6) {
          const f = mtf(m, lv) / lv;
          pr = vr * f; pg = vg * f; pb = vb * f;
          const mx = Math.max(pr, pg, pb);
          if (mx > 1) { pr /= mx; pg /= mx; pb /= mx; }
        } else { pr = sr; pg = sg; pb = sb; }
        r[i] = sr + (pr - sr) * cp; g[i] = sg + (pg - sg) * cp; b[i] = sb + (pb - sb) * cp;
      } else { r[i] = sr; g[i] = sg; b[i] = sb; }
    }
  }

  function highlightProtect(img, amount, sc) {
    const { w, h } = img;
    const L = lum(img);
    const B = gauss(L, w, h, Math.max(2, (img.fullW / sc) / 90 * sc));
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const f = 1 - amount * 0.55 * smooth(0.35, 1.0, B[i]);
      img.r[i] *= f; img.g[i] *= f; img.b[i] *= f;
    }
  }

  function noiseSigma(L, w, h) {
    const bl = boxBlur(L, w, h, 1);
    const d = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) d[i] = Math.abs(L[i] - bl[i]);
    return 1.4826 * medMad(d).med * 1.12;
  }

  function denoise(img, luma, chroma, sc) {
    const { w, h } = img;
    const n = w * h;
    const Y = lum(img);
    const Cr = new Float32Array(n), Cb = new Float32Array(n);
    for (let i = 0; i < n; i++) { Cr[i] = img.r[i] - Y[i]; Cb[i] = img.b[i] - Y[i]; }
    let Yn = Y;
    if (luma > 0) {
      const sig = Math.max(1e-4, noiseSigma(Y, w, h));
      const k = 1 + 3.5 * luma;
      const r = Math.max(1, Math.round((1 + 2 * luma) * Math.max(0.5, sc)));
      const q = guided(Y, w, h, r, (k * sig) * (k * sig));
      const amt = Math.min(1, luma * 1.25);
      Yn = new Float32Array(n);
      for (let i = 0; i < n; i++) Yn[i] = Y[i] + (q[i] - Y[i]) * amt;
      if (luma > 0.55) { // second, wider pass for the background
        const r2 = Math.max(1, Math.round(4 * Math.max(0.5, sc)));
        const q2 = guided(Yn, w, h, r2, (k * sig * 0.8) ** 2);
        const a2 = (luma - 0.55) / 0.45;
        for (let i = 0; i < n; i++) Yn[i] += (q2[i] - Yn[i]) * a2;
      }
    }
    let CrN = Cr, CbN = Cb;
    if (chroma > 0) {
      const s = (1 + 5 * chroma) * Math.max(0.4, sc);
      const a = Math.min(1, chroma * 1.3);
      const cr = gauss(Cr, w, h, s), cb = gauss(Cb, w, h, s);
      CrN = new Float32Array(n); CbN = new Float32Array(n);
      for (let i = 0; i < n; i++) { CrN[i] = Cr[i] + (cr[i] - Cr[i]) * a; CbN[i] = Cb[i] + (cb[i] - Cb[i]) * a; }
    }
    for (let i = 0; i < n; i++) {
      const y = Yn[i], r = y + CrN[i], b = y + CbN[i];
      img.r[i] = r; img.b[i] = b; img.g[i] = 3 * y - r - b;
    }
  }

  function starReduce(img, amount, sc) {
    const { w, h } = img;
    const L = lum(img);
    const r = Math.max(1, Math.round((1 + 2.5 * amount) * sc));
    const open = minMaxFilter(minMaxFilter(L, w, h, r, false), w, h, r, true);
    const openS = gauss(open, w, h, Math.max(0.6, r * 0.6));
    const Ln = new Float32Array(L.length);
    const a = Math.min(0.95, amount);
    for (let i = 0; i < L.length; i++) {
      const res = Math.max(0, L[i] - Math.max(open[i], openS[i]));
      Ln[i] = L[i] - res * a;
    }
    applyLumRatio(img, L, Ln, 0.05, 1);
  }

  function signalMask(L, w, h, bgOut, sc) {
    const B = gauss(L, w, h, Math.max(1, 2 * sc));
    const m = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) m[i] = smooth(bgOut + 0.015, bgOut + 0.12, B[i]);
    return m;
  }

  function localContrast(img, amount, bgOut, sc) {
    const { w, h } = img;
    const L = lum(img);
    const blur = gauss(L, w, h, Math.max(3, (img.fullW / Math.max(sc, 1e-3)) / 45 * sc));
    const mask = signalMask(L, w, h, bgOut, sc);
    const Ln = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) Ln[i] = L[i] + (L[i] - blur[i]) * amount * 1.6 * mask[i];
    applyLumRatio(img, L, Ln, 0.4, 2.5);
  }

  function sharpen(img, amount, bgOut, sc) {
    const { w, h } = img;
    const L = lum(img);
    const blur = gauss(L, w, h, Math.max(0.7, 1.2 * sc));
    const mask = signalMask(L, w, h, bgOut, sc);
    const Ln = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) Ln[i] = L[i] + (L[i] - blur[i]) * amount * 2.2 * (0.15 + 0.85 * mask[i]);
    applyLumRatio(img, L, Ln, 0.5, 2.5);
  }

  function curves(img, contrast, bgOut, levelsMode) {
    const n = img.w * img.h;
    const L = lum(img);
    const Ln = new Float32Array(n);
    const piv = levelsMode ? 0.5 : Math.min(0.5, bgOut + 0.15);
    for (let i = 0; i < n; i++) {
      const y = clamp01(L[i]);
      let s;
      if (y < piv) { const t = y / piv; s = piv * (t * t * (3 - 2 * t) * 0.5 + t * 0.5); }
      else { const t = (y - piv) / (1 - piv); s = piv + (1 - piv) * (t * t * (3 - 2 * t) * 0.5 + t * 0.5); }
      Ln[i] = y + (s - y) * contrast * 2;
    }
    applyLumRatio(img, L, Ln, 0.2, 3);
  }

  function saturate(img, sat, vib, bgOut, sc) {
    const { w, h } = img;
    const n = w * h;
    const L = lum(img);
    const mask = signalMask(L, w, h, bgOut, sc);
    for (let i = 0; i < n; i++) {
      const r = img.r[i], g = img.g[i], b = img.b[i], y = L[i];
      const C = Math.max(r, g, b) - Math.min(r, g, b);
      const tot = sat * (1 + vib * (1 - Math.min(1, C * 2.5)));
      const f = 1 + (tot - 1) * (0.2 + 0.8 * mask[i]);
      let nr = y + (r - y) * f, ng = y + (g - y) * f, nb = y + (b - y) * f;
      const mx = Math.max(nr, ng, nb);
      if (mx > 1) { const k = (1 - y) / Math.max(1e-6, mx - y); nr = y + (nr - y) * k; ng = y + (ng - y) * k; nb = y + (nb - y) * k; }
      img.r[i] = nr; img.g[i] = ng; img.b[i] = nb;
    }
  }

  function scnr(img, amount) {
    const n = img.w * img.h;
    for (let i = 0; i < n; i++) {
      const m = (img.r[i] + img.b[i]) / 2;
      if (img.g[i] > m) img.g[i] = img.g[i] + (m - img.g[i]) * amount;
    }
  }

  function clampAll(img) {
    for (const c of ['r', 'g', 'b']) { const a = img[c]; for (let i = 0; i < a.length; i++) a[i] = a[i] < 0 ? 0 : a[i] > 1 ? 1 : a[i]; }
  }

  // ---------------------------------------------------------- process ---
  function process(src, params, ctx, onStep) {
    const p = Object.assign({}, DEFAULTS, params);
    ctx = ctx || {};
    const img = cloneImage(src);
    const sc = img.scale || 1; // pixels of this image per full-res pixel
    const step = (name) => { if (onStep) onStep(name); };
    const levels = p.stretchMode === 'levels';

    if (p.hotPixels && sc >= 0.99) { step('hot'); removeHotPixels(img); }

    if (p.gradient > 0) {
      step('gradient');
      if (!('gradient' in ctx)) ctx.gradient = fitGradient(img, p.gradientDegree);
      if (ctx.gradient) applyGradient(img, ctx.gradient, p.gradient);
    }

    step('colour');
    if (!ctx.colour) ctx.colour = measureColour(img);
    applyColour(img, ctx.colour, p);

    step('stretch');
    if (!ctx.stretch) ctx.stretch = measureStretch(img, p);
    applyStretch(img, ctx.stretch, p);
    if (ctx.bgOut === undefined) ctx.bgOut = medMad(lum(img)).med;
    const bgOut = ctx.bgOut;

    if (p.highlightProtect > 0 && !levels) { step('hdr'); highlightProtect(img, p.highlightProtect, sc); }
    if (p.denoise > 0 || p.chromaDenoise > 0) { step('denoise'); denoise(img, p.denoise, p.chromaDenoise, sc); }
    if (p.starReduce > 0) { step('stars'); starReduce(img, p.starReduce, sc); }
    if (p.localContrast > 0) { step('local'); localContrast(img, p.localContrast, levels ? 0 : bgOut, sc); }
    if (p.sharpen > 0) { step('sharpen'); sharpen(img, p.sharpen, levels ? 0 : bgOut, sc); }
    if (p.contrast !== 0) { step('curves'); curves(img, p.contrast, bgOut, levels); }
    if (p.mono || img.mono) {
      const L = lum(img); img.r.set(L); img.g.set(L); img.b.set(L);
    } else {
      step('colour2');
      if (p.saturation !== 1 || p.vibrance > 0) saturate(img, p.saturation, p.vibrance, levels ? 0 : bgOut, sc);
      if (p.scnr > 0) scnr(img, p.scnr);
    }
    clampAll(img);
    return img;
  }

  // ------------------------------------------------------------ presets ---
  const DEFAULTS = {
    autoCrop: true, hotPixels: true,
    gradient: 0.85, gradientDegree: 2,
    neutralize: true, whiteBalance: 0.7, temperature: 0, tint: 0,
    stretchMode: 'auto', brightness: 0.22, blackPoint: 0.33, colorPreserve: 0.5, highlightProtect: 0.4,
    denoise: 0.5, chromaDenoise: 0.6, starReduce: 0.15, localContrast: 0.3, sharpen: 0.3,
    contrast: 0.12, saturation: 1.35, vibrance: 0.3, scnr: 0.5, mono: false,
  };

  const PRESETS = {
    auto: {},
    nebula: { gradient: 0.85, whiteBalance: 0.55, brightness: 0.25, colorPreserve: 0.6, highlightProtect: 0.35, denoise: 0.55, chromaDenoise: 0.7, starReduce: 0.35, localContrast: 0.45, sharpen: 0.25, contrast: 0.15, saturation: 1.55, vibrance: 0.4, scnr: 0.25 },
    galaxy: { gradient: 0.9, whiteBalance: 0.8, brightness: 0.2, colorPreserve: 0.55, highlightProtect: 0.7, denoise: 0.6, chromaDenoise: 0.7, starReduce: 0.15, localContrast: 0.35, sharpen: 0.35, contrast: 0.18, saturation: 1.4, vibrance: 0.3, scnr: 0.6 },
    cluster: { gradient: 0.85, whiteBalance: 0.8, brightness: 0.17, colorPreserve: 0.75, highlightProtect: 0.6, denoise: 0.45, chromaDenoise: 0.6, starReduce: 0, localContrast: 0.1, sharpen: 0.3, contrast: 0.12, saturation: 1.45, vibrance: 0.35, scnr: 0.5 },
    milkyway: { gradient: 0.65, gradientDegree: 3, whiteBalance: 0.6, brightness: 0.2, colorPreserve: 0.5, highlightProtect: 0.3, denoise: 0.5, chromaDenoise: 0.65, starReduce: 0.2, localContrast: 0.4, sharpen: 0.2, contrast: 0.15, saturation: 1.35, vibrance: 0.35, scnr: 0.4 },
    bright: { gradient: 0.9, whiteBalance: 0.65, brightness: 0.32, blackPoint: 0.28, colorPreserve: 0.55, highlightProtect: 0.6, denoise: 0.7, chromaDenoise: 0.8, starReduce: 0.25, localContrast: 0.5, sharpen: 0.3, contrast: 0.1, saturation: 1.45, vibrance: 0.35, scnr: 0.5 },
    natural: { gradient: 0.8, whiteBalance: 0.7, brightness: 0.16, colorPreserve: 0.4, highlightProtect: 0.3, denoise: 0.4, chromaDenoise: 0.55, starReduce: 0, localContrast: 0.15, sharpen: 0.15, contrast: 0.08, saturation: 1.15, vibrance: 0.15, scnr: 0.4 },
    moon: { autoCrop: false, hotPixels: false, gradient: 0, stretchMode: 'levels', whiteBalance: 0.4, brightness: 0.19, blackPoint: 0.2, colorPreserve: 0, highlightProtect: 0, denoise: 0.4, chromaDenoise: 0.7, starReduce: 0, localContrast: 0.3, sharpen: 0.55, contrast: 0.12, saturation: 1.0, vibrance: 0, scnr: 0 },
    moonColour: { autoCrop: false, hotPixels: false, gradient: 0, stretchMode: 'levels', whiteBalance: 0.6, brightness: 0.19, blackPoint: 0.2, colorPreserve: 0, highlightProtect: 0, denoise: 0.3, chromaDenoise: 0.9, starReduce: 0, localContrast: 0.35, sharpen: 0.6, contrast: 0.2, saturation: 3.2, vibrance: 0.6, scnr: 0 },
    sun: { autoCrop: false, hotPixels: false, gradient: 0, stretchMode: 'levels', whiteBalance: 0, brightness: 0.22, blackPoint: 0.2, colorPreserve: 0, highlightProtect: 0, denoise: 0.25, chromaDenoise: 0.6, starReduce: 0, localContrast: 0.4, sharpen: 0.6, contrast: 0.25, saturation: 1.2, vibrance: 0.1, scnr: 0 },
    planet: { autoCrop: false, hotPixels: false, gradient: 0, stretchMode: 'levels', whiteBalance: 0.5, brightness: 0.22, blackPoint: 0.15, colorPreserve: 0, highlightProtect: 0, denoise: 0.35, chromaDenoise: 0.8, starReduce: 0, localContrast: 0.2, sharpen: 0.8, contrast: 0.15, saturation: 1.3, vibrance: 0.2, scnr: 0.2 },
    mono: { mono: true, whiteBalance: 0, brightness: 0.22, denoise: 0.55, starReduce: 0.2, localContrast: 0.4, sharpen: 0.3, contrast: 0.25 },
  };

  // Messier type table: N nebula, G galaxy, C cluster
  const MESSIER = 'NCCCCCCNCCCCCCCNNCCNCCCCCCNCCCGGGCCCCCCCCNNCCCCCGCGCCCCCNGGGGCGGGGCCCCCCCGCNGNCCGGGGGGGGGGGCCGGGNGGGGGCGGGCGGG';
  const NAMES = [
    [/moon|maan|lunar|luna\b/i, 'moon'], [/\bsun\b|\bzon\b|solar|sunspot/i, 'sun'],
    [/jupiter|saturn|saturnus|mars|venus|mercur|uranus|neptun|planet/i, 'planet'],
    [/milky|melkweg|wide|breed/i, 'milkyway'],
    [/androm|triangul|whirlpool|draaikolk|pinwheel|sombrero|bode|cigar|sigaar|leo.?trip|galax|sterrenstelsel|ngc.?891|ngc.?4565|ngc.?253/i, 'galaxy'],
    [/pleiad|zevengesternte|hercules|cluster|sterrenhoop|beehive|praesepe|double.?cluster|ngc.?869|ngc.?884|omega.?cen/i, 'cluster'],
    [/orion|lagoon|lagune|eagle|adelaar|horsehead|paardenkop|rosette|heart|soul|hart|ziel|north.?america|noord.?amerika|pelican|pelikaan|veil|sluier|california|crab|krab|ring|dumbbell|halter|nebula|nevel|ic.?\d|sh2|sadr|cocoon|iris|bubble|bel|crescent|trifid|swan|zwaan|elephant|olifant|ngc.?7000|ngc.?2244|ngc.?6960|ngc.?6992/i, 'nebula'],
  ];

  function guessFromText(text) {
    if (!text) return null;
    const t = String(text);
    const m = t.match(/\bM[ _-]?0*(\d{1,3})(?!\d)/i);
    if (m) {
      const k = parseInt(m[1], 10);
      if (k >= 1 && k <= 110) {
        const ty = MESSIER[k - 1];
        return { type: ty === 'N' ? 'nebula' : ty === 'G' ? 'galaxy' : 'cluster', label: 'M' + k };
      }
    }
    for (const [re, type] of NAMES) { const mm = t.match(re); if (mm) return { type, label: mm[0] }; }
    return null;
  }

  // guess a preset from the pixels when name gives no clue
  function guessFromPixels(img) {
    const L = lum(img);
    const { med, mad } = medMad(L);
    const p999 = percentile(L, 0.999);
    const range = Math.max(1e-4, p999 - med);
    let bright = 0, n = 0;
    for (let i = 0; i < L.length; i += 7) { n++; if (L[i] - med > 0.35 * range) bright++; }
    const frac = bright / n;
    if (frac > 0.04 && med < 0.08) {
      // big bright disc on black sky: moon or sun
      let r = 0, b = 0, k = 0;
      for (let i = 0; i < L.length; i += 7) if (L[i] - med > 0.35 * range) { r += img.r[i]; b += img.b[i]; k++; }
      if (k && r / Math.max(1e-6, b) > 1.8) return { type: 'sun', label: '' };
      return { type: 'moon', label: '' };
    }
    return null;
  }

  function autoPreset(img, fileName) {
    const g = guessFromText((img.meta && img.meta.object) || '') || guessFromText(fileName || '') || guessFromPixels(img);
    return g || { type: 'nebula', label: '', fallback: true };
  }

  function presetParams(name, img, fileName) {
    if (name === 'auto') {
      const g = autoPreset(img, fileName);
      const base = g.type === 'planet' ? PRESETS.planet : PRESETS[g.type] || PRESETS.nebula;
      const p = Object.assign({}, DEFAULTS, base);
      if (g.fallback) { p.starReduce = 0.2; p.saturation = 1.4; p.brightness = 0.23; }
      return { params: p, detected: g };
    }
    return { params: Object.assign({}, DEFAULTS, PRESETS[name] || {}), detected: null };
  }

  // ------------------------------------------------------ conversions ---
  function toRGBA(img, out) {
    const n = img.w * img.h;
    out = out || new Uint8ClampedArray(n * 4);
    let seed = 12345;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const d = (seed / 0x7fffffff) - 0.5;
      out[i * 4] = img.r[i] * 255 + d;
      out[i * 4 + 1] = img.g[i] * 255 + d;
      out[i * 4 + 2] = img.b[i] * 255 + d;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  function fromRGBA(data, w, h) {
    const n = w * h;
    const img = { w, h, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), mono: false, meta: { format: 'RGB8', linear: false } };
    let mono = true;
    for (let i = 0; i < n; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      img.r[i] = r / 255; img.g[i] = g / 255; img.b[i] = b / 255;
      if (mono && (r !== g || g !== b)) mono = false;
    }
    img.mono = mono;
    return img;
  }
  function toRGB16(img) {
    const n = img.w * img.h, out = new Uint16Array(n * 3);
    for (let i = 0; i < n; i++) {
      out[i * 3] = Math.round(img.r[i] * 65535); out[i * 3 + 1] = Math.round(img.g[i] * 65535); out[i * 3 + 2] = Math.round(img.b[i] * 65535);
    }
    return out;
  }

  // histogram of the processed image for the UI (256 bins per channel)
  function histogram(img) {
    const H = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256) };
    const n = img.w * img.h;
    const step = Math.max(1, Math.floor(n / 300000));
    for (let i = 0; i < n; i += step) {
      H.r[Math.min(255, (img.r[i] * 255) | 0)]++; H.g[Math.min(255, (img.g[i] * 255) | 0)]++; H.b[Math.min(255, (img.b[i] * 255) | 0)]++;
    }
    return H;
  }

  // ------------------------------------------------------------ demo ---
  // Synthetic linear "stacked" image: nebula + stars + gradient + noise + green cast + rotated borders
  function makeDemo(w, h, seed) {
    let s = seed || 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    const gaussR = () => { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const n = w * h;
    const img = { w, h, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), mono: false, meta: { format: 'demo', linear: true, object: 'Demo nebula' } };
    // value noise for nebula structure
    const G = 64, grid = new Float32Array((G + 1) * (G + 1));
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    const vnoise = (x, y) => {
      const xi = Math.floor(x) % G, yi = Math.floor(y) % G, xf = x - Math.floor(x), yf = y - Math.floor(y);
      const a = grid[yi * (G + 1) + xi], b = grid[yi * (G + 1) + xi + 1], c = grid[(yi + 1) * (G + 1) + xi], d = grid[(yi + 1) * (G + 1) + xi + 1];
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const fbm = (x, y) => { let t = 0, amp = 0.5, f = 1; for (let o = 0; o < 5; o++) { t += amp * vnoise(x * f + 13, y * f + 7); amp *= 0.5; f *= 2; } return t; };
    const cx = w * 0.52, cy = h * 0.48, R = Math.min(w, h) * 0.33;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = (x - cx) / R, dy = (y - cy) / R;
      const rr = dx * dx + dy * dy;
      const f = fbm(x / w * 6, y / h * 6);
      const neb = Math.max(0, Math.exp(-rr * 1.6) * (f * 1.6 - 0.45)) * 0.03;
      const core = Math.exp(-rr * 12) * 0.012;
      const oiii = Math.max(0, Math.exp(-rr * 4) * (fbm(x / w * 9 + 3, y / h * 9) - 0.45)) * 0.012;
      const grad = 0.004 + 0.006 * (x / w) + 0.003 * (y / h) * (y / h);
      img.r[i] = 0.02 + grad * 1.1 + neb + core * 0.8;
      img.g[i] = 0.024 + grad * 1.3 + neb * 0.25 + core * 0.7 + oiii * 0.8;
      img.b[i] = 0.018 + grad * 0.9 + neb * 0.35 + core * 0.6 + oiii;
    }
    const nStars = Math.round(n / 1800);
    for (let k = 0; k < nStars; k++) {
      const sx = rnd() * w, sy = rnd() * h;
      const br = Math.pow(rnd(), 6) * 0.9 + 0.004;
      const sg = 0.9 + br * 2.2;
      const t = rnd();
      const cr = 0.8 + 0.4 * t, cb = 1.2 - 0.4 * t;
      const rad = Math.ceil(sg * 4);
      for (let yy = Math.max(0, Math.floor(sy - rad)); yy < Math.min(h, sy + rad); yy++)
        for (let xx = Math.max(0, Math.floor(sx - rad)); xx < Math.min(w, sx + rad); xx++) {
          const d2 = ((xx - sx) ** 2 + (yy - sy) ** 2) / (2 * sg * sg);
          const v = br * Math.exp(-d2);
          const i = yy * w + xx;
          img.r[i] += v * cr; img.g[i] += v; img.b[i] += v * cb;
        }
    }
    for (let i = 0; i < n; i++) {
      img.r[i] = clamp01(img.r[i] + gaussR() * 0.0035);
      img.g[i] = clamp01(img.g[i] + gaussR() * 0.0035);
      img.b[i] = clamp01(img.b[i] + gaussR() * 0.0035);
    }
    // a few hot pixels
    for (let k = 0; k < n / 20000; k++) { const i = Math.floor(rnd() * n); img.r[i] = 0.9; }
    // field-rotation black corners
    const ang = 0.05;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const X = (x - w / 2) * Math.cos(ang) - (y - h / 2) * Math.sin(ang), Y = (x - w / 2) * Math.sin(ang) + (y - h / 2) * Math.cos(ang);
      if (Math.abs(X) > w / 2 - 2 || Math.abs(Y) > h / 2 - 2) { const i = y * w + x; img.r[i] = img.g[i] = img.b[i] = 0; }
    }
    return img;
  }

  const api = {
    DEFAULTS, PRESETS, process, presetParams, autoPreset, guessFromText,
    detectAutoCrop, cropImage, rotate90, flipH, flipV: flipVert, downscale, cloneImage,
    toRGBA, fromRGBA, toRGB16, histogram, makeDemo, medMad, percentile,
  };
  root.AstroEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
