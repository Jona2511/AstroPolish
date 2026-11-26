/*
 * AstroPolish - processing engine (v2).
 * Pure JavaScript, no dependencies, works in browsers, Electron and Node.
 *
 * Pipeline, in three cached stages:
 *  1. linear:  hot pixels, gradient removal (polynomial / grid), vignetting,
 *              background neutralisation, star colour calibration, white-balance
 *              picker, Richardson-Lucy deconvolution
 *  2. stretch: auto STF / arcsinh / GHS / levels, HDR protection, narrowband
 *              palettes (HOO, Foraxx, SHO-like), noise reduction (guided or
 *              wavelet), background smoothing, star separation (starless + stars)
 *  3. finish:  star reduction, local contrast, sharpening, wavelet layers,
 *              curves, levels, contrast, saturation, vibrance, HSL, colour
 *              balance, SCNR, star layer (brightness, colour, halo, fringes),
 *              recombination, star spikes, glow, vignette, mono, invert, colourise
 *
 * process(img, params, ctx, cache): global measurements are stored in ctx the
 * first time (normally on the small preview) and reused for full resolution
 * or 100% crops so that every scale gives the same look.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ helpers ---
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const CH = ['r', 'g', 'b'];

  function cloneImage(img) {
    return {
      w: img.w, h: img.h, r: new Float32Array(img.r), g: new Float32Array(img.g), b: new Float32Array(img.b),
      mono: img.mono, meta: img.meta,
      x0: img.x0 || 0, y0: img.y0 || 0, fullW: img.fullW || img.w, fullH: img.fullH || img.h,
      scale: img.scale || 1,
    };
  }
  function geomOf(img) { return { x0: img.x0 || 0, y0: img.y0 || 0, fullW: img.fullW || img.w, fullH: img.fullH || img.h, scale: img.scale || 1 }; }

  function lum(img, out) {
    const n = img.w * img.h, L = out || new Float32Array(n);
    const r = img.r, g = img.g, b = img.b;
    for (let i = 0; i < n; i++) L[i] = (r[i] + g[i] + b[i]) / 3;
    return L;
  }

  function histPct(hist, n, p) {
    const target = n * p;
    let c = 0;
    for (let i = 0; i < hist.length; i++) { c += hist[i]; if (c >= target) return (i + 0.5) / (hist.length - 1); }
    return 1;
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
    return { med, mad: histPct(dh, n, 0.5) };
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
        s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s * inv;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
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
    const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    let a = src;
    for (let i = 0; i < n; i++) a = boxBlur(a, w, h, Math.max(1, Math.round(((i < m ? wl : wu) - 1) / 2)));
    return a;
  }

  function minMaxFilter(src, w, h, r, isMax) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        let v = src[o + x];
        const a = Math.max(0, x - r), b = Math.min(w - 1, x + r);
        for (let xx = a; xx <= b; xx++) { const s = src[o + xx]; if (isMax ? s > v : s < v) v = s; }
        tmp[o + x] = v;
      }
    }
    for (let y = 0; y < h; y++) {
      const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
      for (let x = 0; x < w; x++) {
        let v = tmp[y * w + x];
        for (let yy = a; yy <= b; yy++) { const s = tmp[yy * w + x]; if (isMax ? s > v : s < v) v = s; }
        out[y * w + x] = v;
      }
    }
    return out;
  }
  const opening = (L, w, h, r) => minMaxFilter(minMaxFilter(L, w, h, r, false), w, h, r, true);

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

  // a trous B3-spline wavelet decomposition: returns [layer0..layerN-1, residual]
  function atrous(src, w, h, nLayers) {
    const layers = [];
    let cur = src;
    const K = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
    for (let j = 0; j < nLayers; j++) {
      const step = 1 << j;
      const tmp = new Float32Array(w * h), nxt = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        const o = y * w;
        for (let x = 0; x < w; x++) {
          let s = 0;
          for (let k = -2; k <= 2; k++) {
            let xx = x + k * step;
            if (xx < 0) xx = -xx; if (xx >= w) xx = 2 * w - 2 - xx; xx = Math.max(0, Math.min(w - 1, xx));
            s += K[k + 2] * cur[o + xx];
          }
          tmp[o + x] = s;
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let s = 0;
          for (let k = -2; k <= 2; k++) {
            let yy = y + k * step;
            if (yy < 0) yy = -yy; if (yy >= h) yy = 2 * h - 2 - yy; yy = Math.max(0, Math.min(h - 1, yy));
            s += K[k + 2] * tmp[yy * w + x];
          }
          nxt[y * w + x] = s;
        }
      }
      const layer = new Float32Array(w * h);
      for (let i = 0; i < layer.length; i++) layer[i] = cur[i] - nxt[i];
      layers.push(layer);
      cur = nxt;
    }
    layers.push(cur);
    return layers;
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
      if (l <= 1e-5) { const d = Lnew[i] - l; img.r[i] += d; img.g[i] += d; img.b[i] += d; continue; }
      let f = Lnew[i] / l;
      if (f < lo) f = lo; else if (f > hi) f = hi;
      img.r[i] *= f; img.g[i] *= f; img.b[i] *= f;
    }
  }

  // monotone cubic interpolation (Fritsch-Carlson) to a LUT of n entries
  function curveLUT(points, n) {
    n = n || 1024;
    const pts = (points || [[0, 0], [1, 1]]).slice().sort((a, b) => a[0] - b[0]);
    const lut = new Float32Array(n);
    if (pts.length < 2) { for (let i = 0; i < n; i++) lut[i] = i / (n - 1); return lut; }
    const k = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const d = [], m = new Array(k).fill(0);
    for (let i = 0; i < k - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
    m[0] = d[0]; m[k - 1] = d[k - 2];
    for (let i = 1; i < k - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < k - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    let seg = 0;
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      if (x <= xs[0]) { lut[i] = ys[0]; continue; }
      if (x >= xs[k - 1]) { lut[i] = ys[k - 1]; continue; }
      while (seg < k - 2 && x > xs[seg + 1]) seg++;
      const hh = xs[seg + 1] - xs[seg], t = (x - xs[seg]) / hh;
      const t2 = t * t, t3 = t2 * t;
      lut[i] = clamp01((2 * t3 - 3 * t2 + 1) * ys[seg] + (t3 - 2 * t2 + t) * hh * m[seg] + (-2 * t3 + 3 * t2) * ys[seg + 1] + (t3 - t2) * hh * m[seg + 1]);
    }
    return lut;
  }
  const lutGet = (lut, v) => { const n = lut.length - 1; const f = clamp01(v) * n; const i = f | 0; const t = f - i; return i >= n ? lut[n] : lut[i] + (lut[i + 1] - lut[i]) * t; };
  const isIdentityCurve = (pts) => !pts || (pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1);

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
    const m = 2;
    return {
      x: Math.min(w - 2, (x0 + (x0 ? m : 0)) * ds), y: Math.min(h - 2, (y0 + (y0 ? m : 0)) * ds),
      x2: Math.max(1, (x1 + 1 - (x1 < mw - 1 ? m : 0)) * ds), y2: Math.max(1, (y1 + 1 - (y1 < mh - 1 ? m : 0)) * ds),
    };
  }

  function newImage(w, h, like) {
    const n = w * h;
    return { w, h, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), mono: like ? like.mono : false, meta: like ? like.meta : {} };
  }

  function cropImage(img, x, y, cw, ch) {
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    cw = Math.max(1, Math.min(img.w - x, Math.round(cw))); ch = Math.max(1, Math.min(img.h - y, Math.round(ch)));
    const out = newImage(cw, ch, img);
    for (const k of CH) for (let yy = 0; yy < ch; yy++) {
      const s = (y + yy) * img.w + x;
      out[k].set(img[k].subarray(s, s + cw), yy * cw);
    }
    return out;
  }

  function rotate90(img) {
    const { w, h } = img;
    const out = newImage(h, w, img);
    for (const k of CH) {
      const s = img[k], d = out[k];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[x * h + (h - 1 - y)] = s[y * w + x];
    }
    return out;
  }
  function flipH(img) {
    const { w, h } = img;
    for (const k of CH) { const a = img[k]; for (let y = 0; y < h; y++) { const o = y * w; a.subarray(o, o + w).reverse(); } }
    return img;
  }
  function flipVert(img) {
    const { w, h } = img;
    for (const k of CH) {
      const a = img[k], tmp = new Float32Array(w);
      for (let y = 0; y < (h >> 1); y++) { const p = y * w, q = (h - 1 - y) * w; tmp.set(a.subarray(p, p + w)); a.copyWithin(p, q, q + w); a.set(tmp, q); }
    }
    return img;
  }
  function sampleBilinear(a, w, h, x, y) {
    if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return -1;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    return (a[y0 * w + x0] * (1 - fx) + a[y0 * w + x1] * fx) * (1 - fy) + (a[y1 * w + x0] * (1 - fx) + a[y1 * w + x1] * fx) * fy;
  }
  // rotate by any angle and crop to the largest rectangle without empty corners
  function rotateArbitrary(img, deg) {
    if (!deg) return img;
    const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const { w, h } = img;
    // largest axis-aligned rectangle inside the rotated w x h rectangle
    const sinA = Math.abs(sa), cosA = Math.abs(ca);
    const longSide = Math.max(w, h), shortSide = Math.min(w, h);
    let cw, ch;
    if (shortSide <= 2 * sinA * cosA * longSide || Math.abs(sinA - cosA) < 1e-10) {
      const x = 0.5 * shortSide;
      if (w >= h) { cw = x / sinA; ch = x / cosA; } else { cw = x / cosA; ch = x / sinA; }
    } else {
      const cos2a = cosA * cosA - sinA * sinA;
      cw = (w * cosA - h * sinA) / cos2a; ch = (h * cosA - w * sinA) / cos2a;
    }
    cw = Math.max(2, Math.floor(cw)); ch = Math.max(2, Math.floor(ch));
    const out = newImage(cw, ch, img);
    const cx = w / 2, cy = h / 2;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const dx = x - cw / 2 + 0.5, dy = y - ch / 2 + 0.5;
      const sx = ca * dx + sa * dy + cx - 0.5, sy = -sa * dx + ca * dy + cy - 0.5;
      const i = y * cw + x;
      for (const k of CH) out[k][i] = Math.max(0, sampleBilinear(img[k], w, h, sx, sy));
    }
    return out;
  }
  function bin2(img) {
    const tw = img.w >> 1, th = img.h >> 1;
    const out = newImage(tw, th, img);
    for (const k of CH) {
      const s = img[k], d = out[k];
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const i = 2 * y * img.w + 2 * x;
        d[y * tw + x] = (s[i] + s[i + 1] + s[i + img.w] + s[i + img.w + 1]) / 4;
      }
    }
    return out;
  }

  // area-average downscale
  function downscale(img, maxSide) {
    const f = Math.max(img.w, img.h) / maxSide;
    if (f <= 1) { const c = cloneImage(img); c.scale = 1; c.fullW = c.w; c.fullH = c.h; return c; }
    const tw = Math.max(1, Math.round(img.w / f)), th = Math.max(1, Math.round(img.h / f));
    const out = resizeArea(img, tw, th);
    out.scale = tw / img.w; out.fullW = tw; out.fullH = th; out.x0 = 0; out.y0 = 0;
    return out;
  }
  function resizeArea(img, tw, th) {
    const out = newImage(tw, th, img);
    const sx = img.w / tw, sy = img.h / th;
    for (const k of CH) {
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
    return out;
  }
  // bicubic (Catmull-Rom) resize, used for enlarging
  function resizeBicubic(img, tw, th) {
    const out = newImage(tw, th, img);
    const w = img.w, h = img.h, sx = w / tw, sy = h / th;
    const cub = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    for (const k of CH) {
      const s = img[k], d = out[k];
      for (let y = 0; y < th; y++) {
        const fy = (y + 0.5) * sy - 0.5, y1 = Math.floor(fy), ty = fy - y1;
        const ys = [y1 - 1, y1, y1 + 1, y1 + 2].map((v) => Math.max(0, Math.min(h - 1, v)) * w);
        for (let x = 0; x < tw; x++) {
          const fx = (x + 0.5) * sx - 0.5, x1 = Math.floor(fx), tx = fx - x1;
          const xs = [x1 - 1, x1, x1 + 1, x1 + 2].map((v) => Math.max(0, Math.min(w - 1, v)));
          const rows = ys.map((o) => cub(s[o + xs[0]], s[o + xs[1]], s[o + xs[2]], s[o + xs[3]], tx));
          d[y * tw + x] = clamp01(cub(rows[0], rows[1], rows[2], rows[3], ty));
        }
      }
    }
    return out;
  }
  function resize(img, tw, th) { return (tw > img.w || th > img.h) ? resizeBicubic(img, tw, th) : resizeArea(img, tw, th); }
  function pad(img, tw, th, value) {
    const out = newImage(tw, th, img);
    const ox = Math.floor((tw - img.w) / 2), oy = Math.floor((th - img.h) / 2);
    for (const k of CH) {
      out[k].fill(value || 0);
      for (let y = 0; y < img.h; y++) out[k].set(img[k].subarray(y * img.w, (y + 1) * img.w), (y + oy) * tw + ox);
    }
    return out;
  }

  // --------------------------------------------------- star detection ---
  // returns stars sorted by flux: {x, y, flux, peak, fwhm, r, g, b}
  function detectStars(img, L, maxN, sigmaK) {
    const { w, h } = img;
    L = L || lum(img);
    const { med, mad } = medMad(L);
    const sig = Math.max(1e-5, 1.4826 * mad);
    const thr = med + (sigmaK || 6) * sig;
    const stars = [];
    const R = 3;
    for (let y = R; y < h - R; y++) {
      for (let x = R; x < w - R; x++) {
        const i = y * w + x, v = L[i];
        if (v < thr) continue;
        let isMax = true;
        for (let dy = -2; dy <= 2 && isMax; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          const u = L[i + dy * w + dx];
          if (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0)))) { isMax = false; break; }
        }
        if (!isMax) continue;
        let sx = 0, sy = 0, sf = 0, sxx = 0, syy = 0, sr = 0, sg = 0, sb = 0;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const j = i + dy * w + dx;
          const f = Math.max(0, L[j] - med);
          sx += f * dx; sy += f * dy; sf += f; sxx += f * dx * dx; syy += f * dy * dy;
          sr += Math.max(0, img.r[j] - med); sg += Math.max(0, img.g[j] - med); sb += Math.max(0, img.b[j] - med);
        }
        if (sf <= 0) continue;
        const cx = sx / sf, cy = sy / sf;
        const varr = Math.max(0.05, (sxx / sf - cx * cx + syy / sf - cy * cy) / 2);
        // reject extended blobs (nebula knots) and single hot pixels
        const fwhm = 2.355 * Math.sqrt(varr);
        if (fwhm < 0.7 || fwhm > 7) continue;
        stars.push({ x: x + cx, y: y + cy, flux: sf, peak: v, fwhm, r: sr / sf, g: sg / sf, b: sb / sf });
      }
    }
    stars.sort((a, b) => b.flux - a.flux);
    return stars.slice(0, maxN || 500);
  }

  // ------------------------------------------------------ pipeline steps ---
  function removeHotPixels(img) {
    const { w, h } = img;
    let fixed = 0;
    for (const k of CH) {
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

  // background samples: tile medians with rejection of bright objects / empty borders
  function backgroundTiles(img) {
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
      tiles.push({
        tx, ty, x: (img.x0 + (xa + xb) / 2) / img.fullW * 2 - 1, y: (img.y0 + (ya + yb) / 2) / img.fullH * 2 - 1,
        r, g, b, l: (r + g + b) / 3, ok: true,
      });
    }
    const ls = tiles.map((t) => t.l).sort((a, b) => a - b);
    const m0 = ls[ls.length >> 1];
    const dev = ls.map((v) => Math.abs(v - m0)).sort((a, b) => a - b);
    const s0 = Math.max(1e-6, 1.4826 * dev[dev.length >> 1]);
    for (const t of tiles) t.ok = t.l < m0 + 2.0 * s0 && t.l > m0 - 4 * s0;
    return { tiles, gx, gy };
  }

  // polynomial background model
  function fitGradient(img, deg) {
    const { tiles } = backgroundTiles(img);
    const terms = polyTerms(deg);
    const basis = (x, y) => terms.map(([i, j]) => Math.pow(x, i) * Math.pow(y, j));
    let coef = null;
    for (let iter = 0; iter < 4; iter++) {
      const good = tiles.filter((t) => t.ok);
      if (good.length < terms.length * 2) break;
      coef = {};
      for (const c of CH) {
        const n = terms.length;
        const A = Array.from({ length: n }, () => new Array(n).fill(0));
        const bb = new Array(n).fill(0);
        for (const t of good) {
          const v = basis(t.x, t.y);
          for (let i = 0; i < n; i++) { bb[i] += v[i] * t[c]; for (let j = 0; j < n; j++) A[i][j] += v[i] * v[j]; }
        }
        coef[c] = solve(A, bb);
      }
      const res = tiles.map((t) => {
        const v = basis(t.x, t.y);
        let m = 0; for (const c of CH) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * coef[c][i]; m += s; }
        return t.l - m / 3;
      });
      const okRes = res.filter((_, i) => tiles[i].ok).map(Math.abs).sort((a, b) => a - b);
      const sig = Math.max(1e-6, 1.4826 * okRes[okRes.length >> 1]);
      let changed = false;
      tiles.forEach((t, i) => { const ok = res[i] < 2.5 * sig && res[i] > -4 * sig; if (ok !== t.ok) { t.ok = ok; changed = true; } });
      if (!changed) break;
    }
    if (!coef) return null;
    const mean = {};
    for (const c of CH) {
      let s = 0;
      for (const t of tiles) { const v = basis(t.x, t.y); let m = 0; for (let i = 0; i < v.length; i++) m += v[i] * coef[c][i]; s += m; }
      mean[c] = s / tiles.length;
    }
    return { kind: 'poly', terms, coef, mean, used: tiles.filter((t) => t.ok).length, total: tiles.length };
  }

  // grid background model: rejected tiles are filled from neighbours, then smoothed (RBF-like, follows complex gradients)
  function fitGrid(img, smoothness) {
    const { tiles, gx, gy } = backgroundTiles(img);
    const grid = {};
    for (const c of CH) {
      const g = new Float32Array(gx * gy), wgt = new Float32Array(gx * gy);
      for (const t of tiles) if (t.ok) { g[t.ty * gx + t.tx] = t[c]; wgt[t.ty * gx + t.tx] = 1; }
      // fill holes by repeated neighbour averaging
      for (let it = 0; it < gx + gy; it++) {
        let holes = 0;
        const g2 = new Float32Array(g), w2 = new Float32Array(wgt);
        for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
          const i = y * gx + x; if (wgt[i]) continue;
          let s = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= gx || yy >= gy) continue;
            const j = yy * gx + xx; if (wgt[j]) { s += g[j]; n++; }
          }
          if (n) { g2[i] = s / n; w2[i] = 1; } else holes++;
        }
        g.set(g2); wgt.set(w2);
        if (!holes) break;
      }
      const sm = gauss(g, gx, gy, 0.8 + 2.5 * (smoothness === undefined ? 0.5 : smoothness));
      grid[c] = sm;
    }
    const mean = {};
    for (const c of CH) { let s = 0; for (const v of grid[c]) s += v; mean[c] = s / grid[c].length; }
    return { kind: 'grid', gx, gy, grid, mean, used: tiles.filter((t) => t.ok).length, total: tiles.length };
  }

  function evalModel(model, c, nx, ny) {
    if (model.kind === 'grid') {
      const fx = clamp01((nx + 1) / 2) * model.gx - 0.5, fy = clamp01((ny + 1) / 2) * model.gy - 0.5;
      const g = model.grid[c], gx = model.gx, gy = model.gy;
      const x0 = Math.max(0, Math.min(gx - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(gy - 1, Math.floor(fy)));
      const x1 = Math.min(gx - 1, x0 + 1), y1 = Math.min(gy - 1, y0 + 1);
      const tx = clamp01(fx - x0), ty = clamp01(fy - y0);
      return (g[y0 * gx + x0] * (1 - tx) + g[y0 * gx + x1] * tx) * (1 - ty) + (g[y1 * gx + x0] * (1 - tx) + g[y1 * gx + x1] * tx) * ty;
    }
    const T = model.terms, co = model.coef[c];
    let m = 0;
    for (let t = 0; t < T.length; t++) m += co[t] * Math.pow(nx, T[t][0]) * Math.pow(ny, T[t][1]);
    return m;
  }

  function applyGradient(img, model, amount, divide, viewOut) {
    const { w, h } = img;
    // evaluate on a coarse grid and interpolate (fast for any model)
    const step = 8;
    const cw = Math.ceil(w / step) + 1, chh = Math.ceil(h / step) + 1;
    for (const c of CH) {
      const coarse = new Float32Array(cw * chh);
      for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
        const nx = (img.x0 + Math.min(w - 1, x * step) + 0.5) / img.fullW * 2 - 1;
        const ny = (img.y0 + Math.min(h - 1, y * step) + 0.5) / img.fullH * 2 - 1;
        coarse[y * cw + x] = evalModel(model, c, nx, ny);
      }
      const a = img[c], mean = model.mean[c];
      for (let y = 0; y < h; y++) {
        const fy = y / step, y0 = Math.floor(fy), ty = fy - y0, y1 = Math.min(chh - 1, y0 + 1);
        for (let x = 0; x < w; x++) {
          const fx = x / step, x0 = Math.floor(fx), tx = fx - x0, x1 = Math.min(cw - 1, x0 + 1);
          const m = (coarse[y0 * cw + x0] * (1 - tx) + coarse[y0 * cw + x1] * tx) * (1 - ty) + (coarse[y1 * cw + x0] * (1 - tx) + coarse[y1 * cw + x1] * tx) * ty;
          const i = y * w + x;
          if (viewOut) { viewOut[c][i] = m; continue; }
          if (divide) { const f = mean / Math.max(1e-6, m); a[i] = a[i] * (1 + (f - 1) * amount); }
          else a[i] = a[i] - amount * (m - mean);
        }
      }
    }
  }

  function vignetteCorrect(img, amount) {
    const { w, h } = img;
    for (let y = 0; y < h; y++) {
      const ny = (img.y0 + y + 0.5) / img.fullH * 2 - 1;
      for (let x = 0; x < w; x++) {
        const nx = (img.x0 + x + 0.5) / img.fullW * 2 - 1;
        const r2 = (nx * nx + ny * ny) / 2;
        const f = 1 + amount * 0.8 * r2 + amount * 0.4 * r2 * r2;
        const i = y * w + x;
        img.r[i] *= f; img.g[i] *= f; img.b[i] *= f;
      }
    }
  }

  // star-based colour calibration + background neutralisation
  function measureColour(img) {
    const { w, h } = img;
    const bg = {};
    for (const c of CH) bg[c] = medMad(img[c]).med;
    const L = lum(img);
    const B = gauss(L, w, h, Math.max(1.5, 3 * (img.scale || 1)));
    const hp = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) hp[i] = L[i] - B[i];
    const t = (percentile(hp.map((v) => clamp01(v * 4 + 0.5)), 0.997) - 0.5) / 4;
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
      for (const c of CH) k[c] = Math.min(2.5, Math.max(0.4, k[c]));
    }
    return { bg, k, stars: n };
  }

  // white balance from a picked point (normalised source coords)
  function measurePick(img, pick, bg) {
    const x = Math.round(pick.x * img.fullW - img.x0), y = Math.round(pick.y * img.fullH - img.y0);
    const R = Math.max(2, Math.round(4 * (img.scale || 1)));
    let s = { r: 0, g: 0, b: 0 }, n = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) continue;
      const i = yy * img.w + xx; for (const c of CH) s[c] += img[c][i]; n++;
    }
    if (!n) return null;
    const v = {}; for (const c of CH) v[c] = Math.max(1e-5, s[c] / n - (pick.background ? 0 : bg[c]));
    if (pick.background) return { bgPick: { r: s.r / n, g: s.g / n, b: s.b / n } };
    const avg = (v.r + v.g + v.b) / 3;
    const k = {}; for (const c of CH) k[c] = Math.min(4, Math.max(0.25, avg / v[c]));
    return { k };
  }

  function applyColour(img, col, p) {
    const s = p.whiteBalance;
    const base = col.pickK || col.k;
    const str = col.pickK ? 1 : s;
    const k = {
      r: (1 + (base.r - 1) * str) * (1 + 0.25 * p.temperature),
      g: (1 + (base.g - 1) * str) * (1 - 0.2 * p.tint),
      b: (1 + (base.b - 1) * str) * (1 - 0.25 * p.temperature),
    };
    const bgAvg = (col.bg.r + col.bg.g + col.bg.b) / 3;
    const n = img.w * img.h;
    for (const c of CH) {
      const a = img[c], bgc = col.bg[c], kc = k[c];
      const target = p.neutralize ? bgAvg : bgc;
      for (let i = 0; i < n; i++) a[i] = target + (a[i] - bgc) * kc;
    }
  }

  // Richardson-Lucy deconvolution on luminance (gaussian PSF), protected background
  function deconvolve(img, strength, radius, sc) {
    const { w, h } = img;
    const L = lum(img);
    const sigma = Math.max(0.45, radius * sc);
    const iters = Math.round(6 + 24 * strength);
    const { med, mad } = medMad(L);
    const noise = Math.max(1e-5, 1.4826 * mad);
    const Lb = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) Lb[i] = Math.max(1e-6, L[i]);
    let est = new Float32Array(Lb);
    for (let it = 0; it < iters; it++) {
      const conv = gauss(est, w, h, sigma);
      const ratio = new Float32Array(L.length);
      for (let i = 0; i < L.length; i++) { let r = Lb[i] / Math.max(1e-6, conv[i]); if (r > 1.6) r = 1.6; else if (r < 0.6) r = 0.6; ratio[i] = r; }
      const back = gauss(ratio, w, h, sigma);
      for (let i = 0; i < L.length; i++) est[i] *= back[i];
    }
    const blurL = gauss(L, w, h, Math.max(1, 2 * sc));
    const Ln = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) {
      const m = smooth(med + 3 * noise, med + 15 * noise, blurL[i]);
      // no dark rings: never darken more than a little, and leave saturated star cores alone
      const v = L[i] + (Math.min(est[i], 1) - L[i]) * m * Math.min(1, strength * 1.5);
      Ln[i] = Math.max(v, L[i] * 0.92);
    }
    applyLumRatio(img, L, Ln, 0.3, 3);
  }

  // --------------------------------------------------------- stretching ---
  function ghsFunc(D, b, SP, LP, HP) {
    const T = (x) => {
      if (D <= 1e-9) return x;
      if (b === -1) return Math.log1p(D * x) / D;
      if (b < 0) return (1 - Math.pow(1 - b * D * x, (b + 1) / b)) / (D * (b + 1));
      if (b === 0) return (1 - Math.exp(-D * x)) / D;
      return (1 - Math.pow(1 + b * D * x, -1 / b)) / D;
    };
    const f0 = (x) => (x >= SP ? T(x - SP) : -T(SP - x));
    const d = (x) => (f0(x + 1e-5) - f0(x - 1e-5)) / 2e-5;
    const fLP = f0(LP), dLP = d(LP), fHP = f0(HP), dHP = d(HP);
    const f = (x) => (x < LP ? fLP + dLP * (x - LP) : x > HP ? fHP + dHP * (x - HP) : f0(x));
    const a = f(0), z = f(1);
    return (x) => (f(x) - a) / (z - a);
  }

  function buildLUT(fn, n) {
    n = n || 4096;
    const lut = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) lut[i] = clamp01(fn(i / n));
    return lut;
  }

  function measureStretch(img, p) {
    const L = lum(img).map(clamp01);
    if (p.stretchMode === 'levels') {
      const lo = percentile(L, 0.002 + 0.03 * p.blackPoint);
      const hi = Math.max(lo + 0.01, Math.min(1, percentile(L, 0.99995) * 1.04));
      const m = Math.min(0.95, Math.max(0.05, 0.5 - (p.brightness - 0.22) * 1.6));
      return { c0: lo, c1: hi, lut: buildLUT((x) => mtf(m, x)) };
    }
    const { med, mad } = medMad(L);
    const sigmas = -3.6 + 2.4 * p.blackPoint;
    const c0 = Math.max(0, Math.min(med * 0.98, med + sigmas * 1.4826 * mad));
    const c1 = Math.max(c0 + 0.01, Math.min(1, percentile(L, 0.99995) * 1.02));
    const x = Math.max(1e-6, (med - c0) / (c1 - c0));
    const B = p.brightness;
    let fn;
    if (p.stretchMode === 'arcsinh') {
      let lo = 0, hi = 12;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2, beta = Math.expm1(mid); const v = Math.asinh(beta * x) / Math.asinh(beta); if (v < B) lo = mid; else hi = mid; }
      const beta = Math.max(1e-3, Math.expm1((lo + hi) / 2));
      fn = (v) => Math.asinh(beta * v) / Math.asinh(beta);
    } else if (p.stretchMode === 'ghs') {
      const b = p.ghsB, LP = Math.min(x, x * p.ghsLP), HP = Math.max(x + 0.01, p.ghsHP);
      let lo = -4, hi = 9;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; const g = ghsFunc(Math.pow(10, mid), b, x, LP, HP); if (g(x) < B) lo = mid; else hi = mid; }
      fn = ghsFunc(Math.pow(10, (lo + hi) / 2), b, x, LP, HP);
      // GHS keeps the symmetry point fixed at the background: lift it to the target level
      const base = fn(x);
      if (base < B * 0.98) { const m2 = (base * (B - 1)) / (2 * B * base - B - base); const g0 = fn; fn = (v) => mtf(m2, g0(v)); }
    } else {
      let m;
      if (x >= B) m = 0.5; else m = (x * (B - 1)) / (2 * B * x - B - x);
      m = Math.min(0.5, Math.max(0.00005, m));
      fn = (v) => mtf(m, v);
    }
    return { c0, c1, lut: buildLUT(fn) };
  }

  function applyStretch(img, st, p) {
    const n = img.w * img.h;
    const { c0, c1, lut } = st;
    const N = lut.length - 1;
    const g = (v) => { const f = v * N; const i = f | 0; return i >= N ? lut[N] : lut[i] + (lut[i + 1] - lut[i]) * (f - i); };
    const sc = 1 / (c1 - c0);
    const cp = p.colorPreserve;
    const R = img.r, G = img.g, Bc = img.b;
    for (let i = 0; i < n; i++) {
      const vr = clamp01((R[i] - c0) * sc), vg = clamp01((G[i] - c0) * sc), vb = clamp01((Bc[i] - c0) * sc);
      const sr = g(vr), sg = g(vg), sb = g(vb);
      if (cp > 0) {
        const lv = (vr + vg + vb) / 3;
        let pr = sr, pg = sg, pb = sb;
        if (lv > 1e-6) {
          const f = g(lv) / lv;
          pr = vr * f; pg = vg * f; pb = vb * f;
          const mx = Math.max(pr, pg, pb);
          if (mx > 1) { pr /= mx; pg /= mx; pb /= mx; }
        }
        R[i] = sr + (pr - sr) * cp; G[i] = sg + (pg - sg) * cp; Bc[i] = sb + (pb - sb) * cp;
      } else { R[i] = sr; G[i] = sg; Bc[i] = sb; }
    }
  }

  function highlightProtect(img, amount) {
    const { w, h } = img;
    const L = lum(img);
    const B = gauss(L, w, h, Math.max(2, (img.fullW || img.w) / 90));
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const f = 1 - amount * 0.55 * smooth(0.35, 1.0, B[i]);
      img.r[i] *= f; img.g[i] *= f; img.b[i] *= f;
    }
  }

  // narrowband palettes for dual-band (Ha + OIII) data, on stretched values
  function applyPalette(img, pal, oiiiBoost, bg) {
    if (!pal || pal === 'rgb') return;
    const n = img.w * img.h;
    const k = 1 + 3 * (oiiiBoost || 0);
    bg = Math.min(0.6, bg || 0);
    for (let i = 0; i < n; i++) {
      const Ha = img.r[i];
      let O = (img.g[i] + img.b[i]) / 2;
      // boost only the OIII signal above the background
      if (k !== 1 && O > bg) O = bg + (1 - bg) * (1 - Math.pow(1 - clamp01((O - bg) / (1 - bg)), k));
      let r, g, b;
      switch (pal) {
        case 'hoo': r = Ha; g = O; b = O; break;
        case 'hooSoft': r = Ha; g = 0.25 * Ha + 0.75 * O; b = O; break;
        case 'foraxx': { const t = Math.pow(Math.max(1e-6, Ha * O), 1 - Ha * O); r = Ha; g = t * Ha + (1 - t) * O; b = O; break; }
        case 'sho': r = Ha; g = 0.6 * Ha + 0.4 * O; b = 0.85 * O + 0.05 * Ha; break;
        case 'ha': r = g = b = Ha; break;
        case 'oiii': r = g = b = O; break;
        default: return;
      }
      img.r[i] = r; img.g[i] = g; img.b[i] = b;
    }
    // keep the background neutral grey after remixing the channels
    if (pal !== 'ha' && pal !== 'oiii') {
      const m = {}; for (const c of CH) m[c] = medMad(img[c]).med;
      const avg = (m.r + m.g + m.b) / 3;
      for (const c of CH) { const d = m[c] - avg, a = img[c]; for (let i = 0; i < n; i++) a[i] -= d * (1 - clamp01((a[i] - m[c]) * 3)); }
    }
  }

  function noiseSigma(L, w, h) {
    const bl = boxBlur(L, w, h, 1);
    const d = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) d[i] = Math.abs(L[i] - bl[i]);
    return 1.4826 * medMad(d).med * 1.12;
  }

  function waveletDenoise(Y, w, h, amount) {
    const layers = atrous(Y, w, h, 4);
    const k = 3.2 * amount;
    const out = new Float32Array(layers[4]);
    for (let j = 0; j < 4; j++) {
      const lay = layers[j];
      const abs = new Float32Array(lay.length);
      for (let i = 0; i < lay.length; i++) abs[i] = Math.abs(lay[i]);
      const sig = 1.4826 * medMad(abs).med / 0.6745 * 0.6745 + 1e-6;
      const t = k * sig * [1, 0.8, 0.6, 0.45][j];
      for (let i = 0; i < lay.length; i++) { const v = lay[i]; const a = Math.abs(v) - t; out[i] += a > 0 ? Math.sign(v) * a : 0; }
    }
    return out;
  }

  function denoise(img, luma, chroma, sc, method) {
    const { w, h } = img;
    const n = w * h;
    const Y = lum(img);
    const Cr = new Float32Array(n), Cb = new Float32Array(n);
    for (let i = 0; i < n; i++) { Cr[i] = img.r[i] - Y[i]; Cb[i] = img.b[i] - Y[i]; }
    let Yn = Y;
    if (luma > 0) {
      const amt = Math.min(1, luma * 1.25);
      let q;
      if (method === 'wavelet') q = waveletDenoise(Y, w, h, luma);
      else {
        const sig = Math.max(1e-4, noiseSigma(Y, w, h));
        const k = 1 + 3.5 * luma;
        const r = Math.max(1, Math.round((1 + 2 * luma) * Math.max(0.5, sc)));
        q = guided(Y, w, h, r, (k * sig) * (k * sig));
        if (luma > 0.55) {
          const q2 = guided(q, w, h, Math.max(1, Math.round(4 * Math.max(0.5, sc))), (k * sig * 0.8) ** 2);
          const a2 = (luma - 0.55) / 0.45;
          for (let i = 0; i < n; i++) q[i] += (q2[i] - q[i]) * a2;
        }
      }
      Yn = new Float32Array(n);
      for (let i = 0; i < n; i++) Yn[i] = Y[i] + (q[i] - Y[i]) * amt;
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

  function signalMask(L, w, h, bgOut, sc) {
    const B = gauss(L, w, h, Math.max(1, 2 * sc));
    const m = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) m[i] = smooth(bgOut + 0.015, bgOut + 0.12, B[i]);
    return m;
  }

  function backgroundSmooth(img, amount, bgOut, sc) {
    const { w, h } = img;
    const L = lum(img);
    const mask = signalMask(L, w, h, bgOut, sc);
    for (const c of CH) {
      const bl = gauss(img[c], w, h, Math.max(1, 3 * sc));
      const a = img[c];
      for (let i = 0; i < a.length; i++) a[i] += (bl[i] - a[i]) * amount * (1 - mask[i]);
    }
  }

  // ---- star separation (morphological, no AI): returns { starless, stars, mask }
  function starMaskOf(img, sc, size) {
    const { w, h } = img;
    const L = lum(img);
    const r = Math.max(1, Math.round((4 + 10 * (size === undefined ? 0.5 : size)) * Math.max(0.35, sc)));
    const open = opening(L, w, h, r);
    // second, wider scale for big saturated stars (only where the image is very bright)
    const open2 = opening(L, w, h, r * 3);
    const th = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) {
      // contrast relative to the remaining headroom (stars on a bright nebula are still found)
      const a1 = (L[i] - open[i]) / Math.max(0.12, 1 - open[i]) * 0.6, a2 = (L[i] - open2[i]) / Math.max(0.12, 1 - open2[i]) * 0.6 * smooth(0.75, 0.92, L[i]);
      th[i] = Math.max(L[i] - open[i], a1, a2);
    }
    const sig = Math.max(1e-4, noiseSigma(L, w, h));
    const t0 = 4.5 * sig + 0.015;
    let m = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) m[i] = smooth(t0, t0 * 2.5 + 0.03, th[i]);
    m = minMaxFilter(m, w, h, Math.max(1, Math.round(2 * Math.max(0.5, sc))), true);
    m = gauss(m, w, h, Math.max(0.7, 1.2 * sc));
    for (let i = 0; i < m.length; i++) m[i] = clamp01(m[i] * 3);
    return m;
  }

  function separateStars(img, sc, mask) {
    const { w, h } = img;
    const n = w * h;
    const wgt = new Float32Array(n);
    for (let i = 0; i < n; i++) wgt[i] = 1 - mask[i];
    const starless = newImage(w, h, img);
    const radii = [2, 4, 8, 16, 32].map((r) => Math.max(1, r * Math.max(0.35, sc)));
    const assigned = new Uint8Array(n);
    const fill = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) };
    for (let k = 0; k < radii.length; k++) {
      const den = gauss(wgt, w, h, radii[k]);
      const nums = {};
      for (const c of CH) { const t = new Float32Array(n); for (let i = 0; i < n; i++) t[i] = img[c][i] * wgt[i]; nums[c] = gauss(t, w, h, radii[k]); }
      const last = k === radii.length - 1;
      for (let i = 0; i < n; i++) {
        if (assigned[i] || mask[i] < 0.01) continue;
        if (den[i] > 0.3 || last) { for (const c of CH) fill[c][i] = nums[c][i] / Math.max(1e-4, den[i]); assigned[i] = 1; }
      }
    }
    const stars = newImage(w, h, img);
    for (const c of CH) {
      const a = img[c], s = starless[c], t = stars[c], f = fill[c];
      for (let i = 0; i < n; i++) {
        const m = mask[i];
        const sv = m < 0.01 ? a[i] : Math.min(a[i], a[i] * (1 - m) + f[i] * m);
        s[i] = sv;
        t[i] = sv >= 0.999 ? 0 : clamp01(1 - (1 - a[i]) / (1 - sv));
      }
    }
    Object.assign(starless, geomOf(img)); Object.assign(stars, geomOf(img));
    return { starless, stars };
  }

  function processStarLayer(T, p, sc) {
    const { w, h } = T;
    const n = w * h;
    const L = lum(T);
    // size reduction: erosion + power curve on the stars-only layer
    if (p.starReduce > 0) {
      const r = Math.max(1, Math.round(1 * Math.max(0.5, sc)));
      const er = minMaxFilter(L, w, h, r, false);
      const Ln = new Float32Array(n);
      const a = Math.min(0.9, p.starReduce);
      for (let i = 0; i < n; i++) Ln[i] = Math.pow(L[i] + (er[i] - L[i]) * a * 0.8, 1 + a * 0.8);
      applyLumRatio(T, L, Ln, 0, 1);
    }
    if (p.starHalo > 0) {
      const L2 = lum(T), Ln = new Float32Array(n);
      for (let i = 0; i < n; i++) Ln[i] = L2[i] * smooth(0, 0.25 + 0.5 * p.starHalo, L2[i]) ** (p.starHalo);
      applyLumRatio(T, L2, Ln, 0, 1);
    }
    const bright = 1 + p.starBrightness;
    const sat = p.starSat, def = p.defringe;
    for (let i = 0; i < n; i++) {
      let r = T.r[i], g = T.g[i], b = T.b[i];
      const y = (r + g + b) / 3;
      let s = sat;
      if (def > 0 && b > r && b > g * 0.95) s *= 1 - def * 0.9; // blue / purple fringes
      r = y + (r - y) * s; g = y + (g - y) * s; b = y + (b - y) * s;
      T.r[i] = clamp01(r * bright); T.g[i] = clamp01(g * bright); T.b[i] = clamp01(b * bright);
    }
  }

  function screenCombine(S, T) {
    const n = S.w * S.h;
    for (const c of CH) { const a = S[c], t = T[c]; for (let i = 0; i < n; i++) a[i] = 1 - (1 - clamp01(a[i])) * (1 - t[i]); }
  }

  // old-style star reduction (no separation)
  function starReduce(img, amount, sc) {
    const { w, h } = img;
    const L = lum(img);
    const r = Math.max(1, Math.round((1 + 2.5 * amount) * sc));
    const open = opening(L, w, h, r);
    const openS = gauss(open, w, h, Math.max(0.6, r * 0.6));
    const Ln = new Float32Array(L.length);
    const a = Math.min(0.95, amount);
    for (let i = 0; i < L.length; i++) Ln[i] = L[i] - Math.max(0, L[i] - Math.max(open[i], openS[i])) * a;
    applyLumRatio(img, L, Ln, 0.05, 1);
  }

  function localContrast(img, amount, bgOut, sc) {
    const { w, h } = img;
    const L = lum(img);
    const blur = gauss(L, w, h, Math.max(3, (img.fullW || img.w) / 45));
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

  // RegiStax-style wavelet sharpening: gains per layer (0 = unchanged)
  function waveletSharpen(img, gains, bgOut, sc, protectBg) {
    const { w, h } = img;
    const L = lum(img);
    const layers = atrous(L, w, h, 6);
    const mask = protectBg ? signalMask(L, w, h, bgOut, sc) : null;
    const Ln = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) Ln[i] = L[i];
    for (let j = 0; j < 6; j++) {
      const gsum = gains[j] || 0; if (!gsum) continue;
      const lay = layers[j];
      for (let i = 0; i < L.length; i++) Ln[i] += lay[i] * gsum * (mask ? 0.2 + 0.8 * mask[i] : 1);
    }
    applyLumRatio(img, L, Ln, 0.3, 3);
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

  function userCurves(img, cv) {
    if (!cv) return;
    const n = img.w * img.h;
    const lr = isIdentityCurve(cv.rgb) ? null : curveLUT(cv.rgb);
    const lc = {};
    for (const c of CH) lc[c] = isIdentityCurve(cv[c]) ? null : curveLUT(cv[c]);
    if (!lr && !lc.r && !lc.g && !lc.b) return;
    for (const c of CH) {
      const a = img[c];
      for (let i = 0; i < n; i++) {
        let v = a[i];
        if (lc[c]) v = lutGet(lc[c], v);
        if (lr) v = lutGet(lr, v);
        a[i] = v;
      }
    }
  }

  function levels(img, black, gamma, white) {
    if (black === 0 && gamma === 1 && white === 1) return;
    const n = img.w * img.h, sc = 1 / Math.max(0.01, white - black), ig = 1 / gamma;
    for (const c of CH) { const a = img[c]; for (let i = 0; i < n; i++) a[i] = Math.pow(clamp01((a[i] - black) * sc), ig); }
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

  // HSL per colour range: hsl = { red: [hueShift(-1..1), sat(0..2), light(-1..1)], ... }
  const HUES = { red: 0, orange: 30, yellow: 60, green: 120, aqua: 180, blue: 220, purple: 270, magenta: 315 };
  function hslAdjust(img, hsl) {
    if (!hsl) return;
    const keys = Object.keys(HUES).filter((k) => hsl[k] && (hsl[k][0] || hsl[k][1] !== 1 || hsl[k][2]));
    if (!keys.length) return;
    const n = img.w * img.h;
    for (let i = 0; i < n; i++) {
      const r = clamp01(img.r[i]), g = clamp01(img.g[i]), b = clamp01(img.b[i]);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d < 1e-4) continue;
      let hue;
      if (mx === r) hue = ((g - b) / d) % 6; else if (mx === g) hue = (b - r) / d + 2; else hue = (r - g) / d + 4;
      hue *= 60; if (hue < 0) hue += 360;
      let dh = 0, ds = 1, dl = 0, wsum = 0;
      for (const k of keys) {
        let dist = Math.abs(hue - HUES[k]); if (dist > 180) dist = 360 - dist;
        const wgt = dist < 45 ? 0.5 + 0.5 * Math.cos(dist / 45 * Math.PI) : 0;
        if (!wgt) continue;
        const v = hsl[k];
        dh += wgt * v[0] * 30; ds *= 1 + (v[1] - 1) * wgt; dl += wgt * v[2] * 0.3; wsum += wgt;
      }
      if (!wsum) continue;
      const satW = Math.min(1, d * 3); // grey pixels hardly change
      const l = (mx + mn) / 2;
      let s = d / (1 - Math.abs(2 * l - 1) + 1e-6);
      let nh = (hue + dh * satW + 360) % 360;
      s = clamp01(s * (1 + (ds - 1) * satW));
      const nl = clamp01(l + dl * satW * (1 - Math.abs(2 * l - 1)));
      const c = (1 - Math.abs(2 * nl - 1)) * s, x = c * (1 - Math.abs((nh / 60) % 2 - 1)), m0 = nl - c / 2;
      let rr, gg, bb;
      if (nh < 60) [rr, gg, bb] = [c, x, 0]; else if (nh < 120) [rr, gg, bb] = [x, c, 0]; else if (nh < 180) [rr, gg, bb] = [0, c, x];
      else if (nh < 240) [rr, gg, bb] = [0, x, c]; else if (nh < 300) [rr, gg, bb] = [x, 0, c]; else [rr, gg, bb] = [c, 0, x];
      img.r[i] = rr + m0; img.g[i] = gg + m0; img.b[i] = bb + m0;
    }
  }

  function colourBalance(img, p) {
    const vals = [p.cbShadowT, p.cbShadowG, p.cbMidT, p.cbMidG, p.cbHighT, p.cbHighG];
    if (vals.every((v) => !v)) return;
    const n = img.w * img.h;
    for (let i = 0; i < n; i++) {
      const y = clamp01((img.r[i] + img.g[i] + img.b[i]) / 3);
      const ws = (1 - y) * (1 - y), wh = y * y, wm = Math.max(0, 1 - ws - wh);
      const t = ws * p.cbShadowT + wm * p.cbMidT + wh * p.cbHighT;
      const g = ws * p.cbShadowG + wm * p.cbMidG + wh * p.cbHighG;
      img.r[i] *= 1 + 0.25 * t; img.b[i] *= 1 - 0.25 * t; img.g[i] *= 1 - 0.2 * g;
    }
  }

  function scnr(img, amount) {
    const n = img.w * img.h;
    for (let i = 0; i < n; i++) {
      const m = (img.r[i] + img.b[i]) / 2;
      if (img.g[i] > m) img.g[i] = img.g[i] + (m - img.g[i]) * amount;
    }
  }

  // diffraction spikes on bright stars (stars in normalised coordinates from ctx)
  function drawSpikes(img, stars, p) {
    if (!stars || !stars.length) return;
    const { w, h } = img;
    const sc = img.scale || 1;
    const count = Math.max(1, Math.round(4 + 76 * p.spikes));
    const list = stars.slice(0, count);
    const maxFlux = list[0].flux;
    const nSp = p.spikeCount || 4;
    const base = p.spikeAngle * Math.PI / 180;
    const layer = { r: new Float32Array(w * h), g: new Float32Array(w * h), b: new Float32Array(w * h) };
    for (const s of list) {
      const x0 = s.nx * img.fullW - img.x0, y0 = s.ny * img.fullH - img.y0;
      const rel = Math.sqrt(s.flux / maxFlux);
      const len = (0.012 + 0.09 * p.spikeLength) * img.fullW * rel;
      if (len < 3) continue;
      if (x0 < -len || y0 < -len || x0 > w + len || y0 > h + len) continue;
      const cs = (s.r + s.g + s.b) / 3 || 1;
      const col = { r: 0.55 + 0.45 * s.r / cs, g: 0.55 + 0.45 * s.g / cs, b: 0.55 + 0.45 * s.b / cs };
      const inten = 0.9 * Math.min(1, 0.4 + rel);
      const width = Math.max(0.6, (0.6 + 1.4 * rel) * sc);
      for (let k = 0; k < nSp; k++) {
        const a = base + k * Math.PI * 2 / nSp;
        const dx = Math.cos(a), dy = Math.sin(a);
        for (let t = 1; t < len; t += 0.5) {
          const fall = Math.pow(1 - t / len, 2.2) * inten;
          const px = x0 + dx * t, py = y0 + dy * t;
          // gaussian cross-section
          for (let o = -2; o <= 2; o++) {
            const qx = px - dy * o * 0.5, qy = py + dx * o * 0.5;
            const xi = Math.round(qx), yi = Math.round(qy);
            if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
            const wgt = Math.exp(-((o * 0.5) ** 2) / (2 * width * width * 0.25)) * fall * 0.5;
            const i = yi * w + xi;
            layer.r[i] = Math.max(layer.r[i], wgt * col.r); layer.g[i] = Math.max(layer.g[i], wgt * col.g); layer.b[i] = Math.max(layer.b[i], wgt * col.b);
          }
        }
      }
    }
    const blurR = Math.max(0.5, 0.6 * sc);
    for (const c of CH) {
      const l = gauss(layer[c], w, h, blurR), a = img[c];
      for (let i = 0; i < a.length; i++) a[i] = 1 - (1 - clamp01(a[i])) * (1 - clamp01(l[i] * 1.3));
    }
  }

  function glow(img, amount, bgOut, sc) {
    const { w, h } = img;
    const L = lum(img);
    const mask = signalMask(L, w, h, bgOut, sc);
    for (const c of CH) {
      const bl = gauss(img[c], w, h, Math.max(3, (img.fullW || img.w) / 60));
      const a = img[c];
      for (let i = 0; i < a.length; i++) { const gv = clamp01(bl[i] - bgOut * 0.8) * amount * 0.8 * (0.3 + 0.7 * mask[i]); a[i] = 1 - (1 - clamp01(a[i])) * (1 - gv); }
    }
  }

  function vignetteEffect(img, amount) {
    const { w, h } = img;
    for (let y = 0; y < h; y++) {
      const ny = (img.y0 + y + 0.5) / img.fullH * 2 - 1;
      for (let x = 0; x < w; x++) {
        const nx = (img.x0 + x + 0.5) / img.fullW * 2 - 1;
        const r2 = (nx * nx + ny * ny) / 2;
        const f = amount > 0 ? 1 - amount * 0.85 * smooth(0.15, 1, r2) : 1 - amount * 0.5 * smooth(0.15, 1, r2);
        const i = y * w + x;
        if (amount > 0) { img.r[i] *= f; img.g[i] *= f; img.b[i] *= f; }
        else { const k = -amount * 0.5 * smooth(0.15, 1, r2); img.r[i] += (1 - img.r[i]) * k * 0.3; img.g[i] += (1 - img.g[i]) * k * 0.3; img.b[i] += (1 - img.b[i]) * k * 0.3; }
      }
    }
  }

  function finalTone(img, p) {
    const n = img.w * img.h;
    if (p.mono || img.mono) { const L = lum(img); img.r.set(L); img.g.set(L); img.b.set(L); }
    if (p.colorize > 0) {
      const hue = p.colorizeHue;
      const c = [0, 1, 2].map((k) => clamp01(Math.abs(((hue / 60 + [0, 4, 2][k]) % 6) - 3) - 1));
      for (let i = 0; i < n; i++) {
        const y = (img.r[i] + img.g[i] + img.b[i]) / 3;
        const tr = y < 0.5 ? 2 * y * c[0] : 1 - 2 * (1 - y) * (1 - c[0]);
        const tg = y < 0.5 ? 2 * y * c[1] : 1 - 2 * (1 - y) * (1 - c[1]);
        const tb = y < 0.5 ? 2 * y * c[2] : 1 - 2 * (1 - y) * (1 - c[2]);
        img.r[i] += (tr - img.r[i]) * p.colorize; img.g[i] += (tg - img.g[i]) * p.colorize; img.b[i] += (tb - img.b[i]) * p.colorize;
      }
    }
    if (p.invert) for (const c of CH) { const a = img[c]; for (let i = 0; i < n; i++) a[i] = 1 - clamp01(a[i]); }
  }

  function clampAll(img) {
    for (const c of CH) { const a = img[c]; for (let i = 0; i < a.length; i++) a[i] = a[i] < 0 ? 0 : a[i] > 1 ? 1 : a[i]; }
  }

  // ---------------------------------------------------------- process ---
  const STAGE1 = ['view', 'hotPixels', 'gradient', 'gradientDegree', 'gradientMethod', 'gradientSmooth', 'gradientDivide', 'vignetteFix', 'neutralize', 'whiteBalance', 'temperature', 'tint', 'wbPick', 'bgPick', 'deconv', 'deconvRadius'];
  const STAGE2 = ['stretchMode', 'brightness', 'blackPoint', 'colorPreserve', 'highlightProtect', 'ghsB', 'ghsLP', 'ghsHP', 'palette', 'oiiiBoost', 'denoise', 'chromaDenoise', 'denoiseMethod', 'bgSmooth', 'starBrightness', 'starSat', 'starHalo', 'defringe', 'starSeparate', 'starMaskSize'];
  const keyOf = (p, keys) => JSON.stringify(keys.map((k) => p[k]));

  function needsSeparation(p) {
    return p.starSeparate || p.starBrightness !== 0 || p.starSat !== 1 || p.starHalo > 0 || p.defringe > 0 || p.view === 'stars' || p.view === 'starless';
  }

  function process(src, params, ctx, cache, onStep) {
    const p = Object.assign({}, DEFAULTS, params);
    ctx = ctx || {};
    const step = (name) => { if (onStep) onStep(name); };
    const sc = src.scale || 1;
    const levelsMode = p.stretchMode === 'levels';
    const k1 = keyOf(p, STAGE1), k2 = k1 + keyOf(p, STAGE2) + (p.view === 'gradient') + (p.spikes > 0);

    // ---- stage 1: linear
    let img;
    if (cache && cache.k1 === k1 && cache.s1) { img = cloneImage(cache.s1); Object.assign(ctx, cache.ctx1); }
    else {
      img = cloneImage(src);
      if (p.hotPixels && sc >= 0.99) { step('hot'); removeHotPixels(img); }
      if (p.vignetteFix > 0) vignetteCorrect(img, p.vignetteFix);
      if (p.gradient > 0) {
        step('gradient');
        if (!('gradient' in ctx)) ctx.gradient = p.gradientMethod === 'grid' ? fitGrid(img, p.gradientSmooth) : fitGradient(img, p.gradientDegree);
        if (ctx.gradient) {
          if (p.view === 'gradient') {
            const v = newImage(img.w, img.h, img); Object.assign(v, geomOf(img));
            applyGradient(img, ctx.gradient, 0, false, v);
            const mn = Math.min(ctx.gradient.mean.r, ctx.gradient.mean.g, ctx.gradient.mean.b);
            let lo = Infinity, hi = -Infinity;
            for (const c of CH) for (const x of v[c]) { if (x < lo) lo = x; if (x > hi) hi = x; }
            for (const c of CH) for (let i = 0; i < v[c].length; i++) v[c][i] = 0.1 + 0.8 * (v[c][i] - lo) / Math.max(1e-6, hi - lo);
            void mn;
            return v;
          }
          applyGradient(img, ctx.gradient, p.gradient, p.gradientDivide);
        }
      }
      step('colour');
      if (!ctx.colour) {
        ctx.colour = measureColour(img);
        if (p.wbPick) { const r = measurePick(img, p.wbPick, ctx.colour.bg); if (r && r.k) ctx.colour.pickK = r.k; }
        if (p.bgPick) { const r = measurePick(img, Object.assign({ background: true }, p.bgPick), ctx.colour.bg); if (r && r.bgPick) ctx.colour.bg = r.bgPick; }
      }
      applyColour(img, ctx.colour, p);
      if (p.deconv > 0) { step('deconv'); deconvolve(img, p.deconv, p.deconvRadius, sc); }
      if (cache) { cache.k1 = k1; cache.s1 = cloneImage(img); cache.ctx1 = { gradient: ctx.gradient, colour: ctx.colour }; cache.k2 = null; }
    }

    // ---- stage 2: stretch, palette, noise, separation
    let S, T = null;
    if (cache && cache.k2 === k2 && cache.s2) {
      S = cloneImage(cache.s2); T = cache.t2 ? cloneImage(cache.t2) : null; Object.assign(ctx, cache.ctx2);
    } else {
      step('stretch');
      if (!ctx.stretch) ctx.stretch = measureStretch(img, p);
      applyStretch(img, ctx.stretch, p);
      if (ctx.bgOut === undefined) ctx.bgOut = medMad(lum(img)).med;
      if (p.highlightProtect > 0 && !levelsMode) { step('hdr'); highlightProtect(img, p.highlightProtect); }
      applyPalette(img, p.palette, p.oiiiBoost, ctx.bgOut);
      if (!ctx.stars && p.spikes > 0) {
        const st = detectStars(img, null, 300, 8);
        ctx.stars = st.map((s) => ({ nx: (s.x + 0.5 + img.x0) / img.fullW, ny: (s.y + 0.5 + img.y0) / img.fullH, flux: s.flux / (sc * sc), r: s.r, g: s.g, b: s.b }));
      }
      if (needsSeparation(p)) {
        step('stars');
        const mask = starMaskOf(img, sc, p.starMaskSize);
        if (p.view === 'stars') { const v = newImage(img.w, img.h, img); v.r.set(mask); v.g.set(mask); v.b.set(mask); Object.assign(v, geomOf(img)); return v; }
        const sep = separateStars(img, sc, mask);
        S = sep.starless; T = sep.stars;
      } else S = img;
      if (p.denoise > 0 || p.chromaDenoise > 0) { step('denoise'); denoise(S, p.denoise, p.chromaDenoise, sc, p.denoiseMethod); }
      if (p.bgSmooth > 0) backgroundSmooth(S, p.bgSmooth, levelsMode ? 0 : ctx.bgOut, sc);
      if (cache) { cache.k2 = k2; cache.s2 = cloneImage(S); cache.t2 = T ? cloneImage(T) : null; cache.ctx2 = { stretch: ctx.stretch, bgOut: ctx.bgOut, stars: ctx.stars }; }
    }
    const bgOut = levelsMode ? 0 : ctx.bgOut;

    // ---- stage 3: finishing
    if (!T && p.starReduce > 0) { step('stars'); starReduce(S, p.starReduce, sc); }
    if (p.localContrast > 0) { step('local'); localContrast(S, p.localContrast, bgOut, sc); }
    if (p.sharpen > 0) { step('sharpen'); sharpen(S, p.sharpen, bgOut, sc); }
    if (p.wavelets && p.wavelets.some((v) => v)) { step('wavelets'); waveletSharpen(S, p.wavelets, bgOut, sc, !levelsMode); }
    if (p.contrast !== 0) curves(S, p.contrast, bgOut, levelsMode);
    userCurves(S, p.curves);
    levels(S, p.lvBlack, p.lvGamma, p.lvWhite);
    if (!(p.mono || S.mono)) {
      if (p.saturation !== 1 || p.vibrance > 0) saturate(S, p.saturation, p.vibrance, bgOut, sc);
      hslAdjust(S, p.hsl);
      colourBalance(S, p);
      if (p.scnr > 0) scnr(S, p.scnr);
    }
    if (p.view === 'starless') { clampAll(S); return S; }
    if (T) { step('recombine'); processStarLayer(T, p, sc); screenCombine(S, T); }
    if (p.spikes > 0) { step('spikes'); drawSpikes(S, ctx.stars, p); }
    if (p.glow > 0) glow(S, p.glow, bgOut, sc);
    if (p.vignette !== 0) vignetteEffect(S, p.vignette);
    finalTone(S, p);
    clampAll(S);
    return S;
  }

  // ------------------------------------------------------------ analysis ---
  function analyze(img, sc) {
    const out = { channels: {} };
    for (const c of CH) {
      const a = img[c];
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < a.length; i += 3) { if (a[i] < mn) mn = a[i]; if (a[i] > mx) mx = a[i]; }
      const { med, mad } = medMad(a);
      out.channels[c] = { min: mn, max: mx, median: med, mad };
    }
    const L = lum(img);
    const { med, mad } = medMad(L);
    out.noise = 1.4826 * mad;
    out.background = med;
    const stars = detectStars(img, L, 2000, 8);
    out.stars = Math.round(stars.length / (sc * sc));
    const f = stars.slice(0, 200).map((s) => s.fwhm).sort((a, b) => a - b);
    out.fwhm = f.length ? f[f.length >> 1] / sc : null;
    // issues for the friendly checklist
    const ch = out.channels;
    const meanBg = (ch.r.median + ch.g.median + ch.b.median) / 3;
    out.greenCast = meanBg > 0 ? (ch.g.median - (ch.r.median + ch.b.median) / 2) / meanBg : 0;
    out.colourCast = meanBg > 0 ? Math.max(Math.abs(ch.r.median - meanBg), Math.abs(ch.g.median - meanBg), Math.abs(ch.b.median - meanBg)) / meanBg : 0;
    const g = fitGradient(img, 2);
    if (g) {
      let mn = Infinity, mx = -Infinity;
      for (let y = -1; y <= 1; y += 0.25) for (let x = -1; x <= 1; x += 0.25) { let v = 0; for (const c of CH) v += evalModel(g, c, x, y); v /= 3; mn = Math.min(mn, v); mx = Math.max(mx, v); }
      out.gradient = meanBg > 0 ? (mx - mn) / Math.max(meanBg, out.noise * 3) : 0;
    }
    out.snr = out.noise > 0 ? (percentile(L, 0.99) - med) / out.noise : 0;
    return out;
  }

  // ------------------------------------------------------------ presets ---
  const DEFAULTS = {
    autoCrop: true, hotPixels: true,
    gradient: 0.85, gradientDegree: 2, gradientMethod: 'poly', gradientSmooth: 0.5, gradientDivide: false, vignetteFix: 0,
    neutralize: true, whiteBalance: 0.7, temperature: 0, tint: 0, wbPick: null, bgPick: null,
    deconv: 0, deconvRadius: 1.5,
    stretchMode: 'auto', brightness: 0.22, blackPoint: 0.33, colorPreserve: 0.5, highlightProtect: 0.4,
    ghsB: 2, ghsLP: 0.5, ghsHP: 1,
    palette: 'rgb', oiiiBoost: 0,
    denoise: 0.5, chromaDenoise: 0.6, denoiseMethod: 'guided', bgSmooth: 0,
    starSeparate: false, starMaskSize: 0.5, starReduce: 0.15, starBrightness: 0, starSat: 1, starHalo: 0, defringe: 0,
    localContrast: 0.3, sharpen: 0.3, wavelets: [0, 0, 0, 0, 0, 0],
    contrast: 0.12, curves: null, lvBlack: 0, lvGamma: 1, lvWhite: 1,
    saturation: 1.35, vibrance: 0.3, scnr: 0.5, hsl: null,
    cbShadowT: 0, cbShadowG: 0, cbMidT: 0, cbMidG: 0, cbHighT: 0, cbHighG: 0,
    mono: false, invert: false, colorize: 0, colorizeHue: 30,
    glow: 0, spikes: 0, spikeLength: 0.5, spikeAngle: 45, spikeCount: 4, vignette: 0,
    view: 'normal',
  };

  const PRESETS = {
    auto: {},
    nebula: { gradient: 0.85, whiteBalance: 0.55, brightness: 0.25, colorPreserve: 0.6, highlightProtect: 0.35, denoise: 0.55, chromaDenoise: 0.7, starReduce: 0.35, localContrast: 0.45, sharpen: 0.25, contrast: 0.15, saturation: 1.55, vibrance: 0.4, scnr: 0.25 },
    galaxy: { gradient: 0.9, whiteBalance: 0.8, brightness: 0.2, colorPreserve: 0.55, highlightProtect: 0.7, denoise: 0.6, chromaDenoise: 0.7, starReduce: 0.15, localContrast: 0.35, sharpen: 0.35, contrast: 0.18, saturation: 1.4, vibrance: 0.3, scnr: 0.6 },
    cluster: { gradient: 0.85, whiteBalance: 0.8, brightness: 0.17, colorPreserve: 0.75, highlightProtect: 0.6, denoise: 0.45, chromaDenoise: 0.6, starReduce: 0, localContrast: 0.1, sharpen: 0.3, contrast: 0.12, saturation: 1.45, vibrance: 0.35, scnr: 0.5 },
    milkyway: { gradient: 0.65, gradientMethod: 'grid', whiteBalance: 0.6, brightness: 0.2, colorPreserve: 0.5, highlightProtect: 0.3, denoise: 0.5, chromaDenoise: 0.65, starReduce: 0.2, localContrast: 0.4, sharpen: 0.2, contrast: 0.15, saturation: 1.35, vibrance: 0.35, scnr: 0.4 },
    bright: { gradient: 0.9, whiteBalance: 0.65, brightness: 0.32, blackPoint: 0.28, colorPreserve: 0.55, highlightProtect: 0.6, denoise: 0.7, chromaDenoise: 0.8, starReduce: 0.25, localContrast: 0.5, sharpen: 0.3, contrast: 0.1, saturation: 1.45, vibrance: 0.35, scnr: 0.5, bgSmooth: 0.4 },
    natural: { gradient: 0.8, whiteBalance: 0.7, brightness: 0.16, colorPreserve: 0.4, highlightProtect: 0.3, denoise: 0.4, chromaDenoise: 0.55, starReduce: 0, localContrast: 0.15, sharpen: 0.15, contrast: 0.08, saturation: 1.15, vibrance: 0.15, scnr: 0.4 },
    starless: { gradient: 0.85, whiteBalance: 0.6, brightness: 0.26, colorPreserve: 0.6, highlightProtect: 0.4, denoise: 0.6, chromaDenoise: 0.75, starBrightness: -1, localContrast: 0.55, sharpen: 0.3, contrast: 0.18, saturation: 1.6, vibrance: 0.4, scnr: 0.3, bgSmooth: 0.3 },
    hoo: { gradient: 0.85, whiteBalance: 0.3, palette: 'hoo', oiiiBoost: 0.35, brightness: 0.25, colorPreserve: 0.6, highlightProtect: 0.4, denoise: 0.6, chromaDenoise: 0.75, starReduce: 0.35, localContrast: 0.45, sharpen: 0.25, contrast: 0.15, saturation: 1.5, vibrance: 0.4, scnr: 0 },
    foraxx: { gradient: 0.85, whiteBalance: 0.3, palette: 'foraxx', oiiiBoost: 0.3, brightness: 0.25, colorPreserve: 0.6, highlightProtect: 0.4, denoise: 0.6, chromaDenoise: 0.75, starReduce: 0.35, localContrast: 0.45, sharpen: 0.25, contrast: 0.15, saturation: 1.6, vibrance: 0.45, scnr: 0 },
    hubble: { gradient: 0.85, whiteBalance: 0.3, palette: 'sho', oiiiBoost: 0.4, brightness: 0.25, colorPreserve: 0.6, highlightProtect: 0.45, denoise: 0.6, chromaDenoise: 0.75, starReduce: 0.4, starSat: 0.4, localContrast: 0.5, sharpen: 0.25, contrast: 0.18, saturation: 1.7, vibrance: 0.45, scnr: 0, hsl: { red: [0.6, 1, 0.1], orange: [0.3, 1.2, 0.05], yellow: [0, 1.2, 0], green: [0, 0.5, 0], aqua: [0.2, 1.3, 0], blue: [0, 1.2, 0], purple: [0, 1, 0], magenta: [-0.3, 0.8, 0] } },
    spikes: { gradient: 0.85, whiteBalance: 0.7, brightness: 0.22, colorPreserve: 0.6, highlightProtect: 0.5, denoise: 0.55, chromaDenoise: 0.7, starReduce: 0.2, localContrast: 0.35, sharpen: 0.3, contrast: 0.15, saturation: 1.45, vibrance: 0.35, scnr: 0.5, spikes: 0.35, spikeLength: 0.45 },
    dreamy: { gradient: 0.85, whiteBalance: 0.6, brightness: 0.26, colorPreserve: 0.6, highlightProtect: 0.5, denoise: 0.75, chromaDenoise: 0.85, starReduce: 0.45, localContrast: 0.35, sharpen: 0.1, contrast: 0.1, saturation: 1.6, vibrance: 0.5, scnr: 0.3, glow: 0.45, bgSmooth: 0.5, vignette: 0.25 },
    mono: { mono: true, whiteBalance: 0, brightness: 0.22, denoise: 0.55, starReduce: 0.2, localContrast: 0.4, sharpen: 0.3, contrast: 0.25 },
    moon: { autoCrop: false, hotPixels: false, gradient: 0, stretchMode: 'levels', whiteBalance: 0.4, brightness: 0.19, blackPoint: 0.2, colorPreserve: 0, highlightProtect: 0, denoise: 0.4, chromaDenoise: 0.7, starReduce: 0, localContrast: 0.3, sharpen: 0.4, contrast: 0.12, saturation: 1.0, vibrance: 0, scnr: 0, wavelets: [0.6, 0.5, 0.3, 0.1, 0, 0] },
    moonColour: { autoCrop: false, hotPixels: false, gradient: 0, stretchMode: 'levels', whiteBalance: 0.6, brightness: 0.19, blackPoint: 0.2, colorPreserve: 0, highlightProtect: 0, denoise: 0.3, chromaDenoise: 0.9, starReduce: 0, localContrast: 0.35, sharpen: 0.4, contrast: 0.2, saturation: 3.2, vibrance: 0.6, scnr: 0, wavelets: [0.5, 0.4, 0.2, 0, 0, 0] },
    sun: { autoCrop: false, hotPixels: false, gradient: 0, stretchMode: 'levels', whiteBalance: 0, brightness: 0.22, blackPoint: 0.2, colorPreserve: 0, highlightProtect: 0, denoise: 0.25, chromaDenoise: 0.6, starReduce: 0, localContrast: 0.4, sharpen: 0.4, contrast: 0.25, saturation: 1.2, vibrance: 0.1, scnr: 0, wavelets: [0.5, 0.5, 0.3, 0, 0, 0] },
    sunHa: { autoCrop: false, hotPixels: false, gradient: 0, stretchMode: 'levels', whiteBalance: 0, brightness: 0.24, blackPoint: 0.2, colorPreserve: 0, highlightProtect: 0, denoise: 0.3, chromaDenoise: 0.6, starReduce: 0, localContrast: 0.45, sharpen: 0.4, contrast: 0.25, saturation: 1, vibrance: 0, scnr: 0, mono: true, colorize: 0.85, colorizeHue: 28, wavelets: [0.5, 0.5, 0.3, 0, 0, 0] },
    planet: { autoCrop: false, hotPixels: false, gradient: 0, stretchMode: 'levels', whiteBalance: 0.5, brightness: 0.22, blackPoint: 0.15, colorPreserve: 0, highlightProtect: 0, denoise: 0.35, chromaDenoise: 0.8, starReduce: 0, localContrast: 0.2, sharpen: 0.5, contrast: 0.15, saturation: 1.3, vibrance: 0.2, scnr: 0.2, wavelets: [0.8, 0.7, 0.4, 0.1, 0, 0] },
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

  function guessFromPixels(img) {
    const L = lum(img);
    const { med } = medMad(L);
    const p999 = percentile(L, 0.999);
    const range = Math.max(1e-4, p999 - med);
    let bright = 0, n = 0;
    for (let i = 0; i < L.length; i += 7) { n++; if (L[i] - med > 0.35 * range) bright++; }
    const frac = bright / n;
    if (frac > 0.04 && med < 0.08) {
      let r = 0, b = 0, k = 0;
      for (let i = 0; i < L.length; i += 7) if (L[i] - med > 0.35 * range) { r += img.r[i]; b += img.b[i]; k++; }
      if (k && r / Math.max(1e-6, b) > 1.8) return { type: 'sun', label: '' };
      return { type: 'moon', label: '' };
    }
    return null;
  }

  // a dual-band (Ha/OIII) filter leaves almost no signal in "pure" green; stars are red/teal
  function looksDualBand(meta) {
    const t = JSON.stringify((meta && meta.header) || {}) + ' ' + ((meta && meta.object) || '');
    return /duo|dual|astro_filter|ha.?oiii|l-?extreme|l-?enhance|nbz|alp-?t/i.test(t);
  }

  function autoPreset(img, fileName) {
    const g = guessFromText((img.meta && img.meta.object) || '') || guessFromText(fileName || '') || guessFromPixels(img);
    const r = g || { type: 'nebula', label: '', fallback: true };
    r.dualBand = looksDualBand(img.meta) || /duo|dual/i.test(fileName || '');
    return r;
  }

  function presetParams(name, img, fileName) {
    if (name === 'auto') {
      const g = autoPreset(img, fileName);
      const base = PRESETS[g.type] || PRESETS.nebula;
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

  function histogram(img) {
    const H = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256) };
    const n = img.w * img.h;
    const step = Math.max(1, Math.floor(n / 300000));
    for (let i = 0; i < n; i += step) {
      H.r[Math.min(255, (img.r[i] * 255) | 0)]++; H.g[Math.min(255, (img.g[i] * 255) | 0)]++; H.b[Math.min(255, (img.b[i] * 255) | 0)]++;
      H.l[Math.min(255, (((img.r[i] + img.g[i] + img.b[i]) / 3) * 255) | 0)]++;
    }
    return H;
  }

  // ------------------------------------------------------------ demo ---
  function makeDemo(w, h, seed) {
    let s = seed || 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    const gaussR = () => { let u = 0; while (u === 0) u = rnd(); const v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const n = w * h;
    const img = { w, h, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), mono: false, meta: { format: 'demo', linear: true, object: 'Demo nebula' } };
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
          const v = br * Math.exp(-((xx - sx) ** 2 + (yy - sy) ** 2) / (2 * sg * sg));
          const i = yy * w + xx;
          img.r[i] += v * cr; img.g[i] += v; img.b[i] += v * cb;
        }
    }
    for (let i = 0; i < n; i++) {
      img.r[i] = clamp01(img.r[i] + gaussR() * 0.0035);
      img.g[i] = clamp01(img.g[i] + gaussR() * 0.0035);
      img.b[i] = clamp01(img.b[i] + gaussR() * 0.0035);
    }
    for (let k = 0; k < n / 20000; k++) { const i = Math.floor(rnd() * n); img.r[i] = 0.9; }
    const ang = 0.05;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const X = (x - w / 2) * Math.cos(ang) - (y - h / 2) * Math.sin(ang), Y = (x - w / 2) * Math.sin(ang) + (y - h / 2) * Math.cos(ang);
      if (Math.abs(X) > w / 2 - 2 || Math.abs(Y) > h / 2 - 2) { const i = y * w + x; img.r[i] = img.g[i] = img.b[i] = 0; }
    }
    return img;
  }

  const api = {
    DEFAULTS, PRESETS, HUES, process, presetParams, autoPreset, guessFromText, analyze, detectStars,
    detectAutoCrop, cropImage, rotate90, rotateArbitrary, bin2, flipH, flipV: flipVert, downscale, resize, pad, cloneImage, newImage,
    toRGBA, fromRGBA, toRGB16, histogram, makeDemo, medMad, percentile, lum, gauss, curveLUT, sampleBilinear,
  };
  root.AstroEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
