/*
 * AstroPolish - layer engine (v3).
 * Every edit is an adjustment layer: { id, op, on, opacity, blend, params, mask }.
 * Layers are applied in order; each layer can be masked (luminance, colour,
 * stars, signal, selection shape, painted strokes) and blended with 13 modes.
 * Global measurements (gradient model, stretch curve, star list...) are stored
 * per layer in a ctx keyed by the layer chain, measured once on the preview and
 * reused for full resolution and 100% crops.
 */
(function (root) {
  'use strict';
  const E = root.AstroEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const I = E._;
  const { clamp01, smooth, lum, medMad, percentile, gauss } = I;
  const CH = ['r', 'g', 'b'];

  // ---------------------------------------------------------- descriptors ---
  const R = (k, d, min, max, step, nl, en, extra) => Object.assign({ k, d, t: 'r', min, max, step, nl, en }, extra || {});
  const C = (k, d, nl, en, extra) => Object.assign({ k, d, t: 'c', nl, en }, extra || {});
  const S = (k, d, o, nl, en, extra) => Object.assign({ k, d, t: 's', o, nl, en }, extra || {});
  const X = (t, k, d, nl, en, extra) => Object.assign({ k, d, t, nl, en }, extra || {});

  const bgOf = (img, env) => { if (env.ctx.bg === undefined) env.ctx.bg = medMad(lum(img)).med; return env.ctx.bg; };
  const geom = (dst, src) => Object.assign(dst, I.geomOf(src));
  const fullPx = (img, frac) => frac * (img.fullW || img.w); // fraction of image width -> current pixels

  function mapPixels(img, fn) {
    const n = img.w * img.h, out = [0, 0, 0];
    const r = img.r, g = img.g, b = img.b;
    for (let i = 0; i < n; i++) { fn(r[i], g[i], b[i], out, i); r[i] = out[0]; g[i] = out[1]; b[i] = out[2]; }
    return img;
  }
  function rgb2hsl(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d < 1e-6) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1) + 1e-9);
    let h;
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return [h, s, l];
  }
  function hsl2rgb(h, s, l, out) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    let r, g, b;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    out[0] = r + m; out[1] = g + m; out[2] = b + m;
  }
  const hex2rgb = (h) => { const v = parseInt(String(h || '#ffffff').slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };

  // normalized-convolution inpainting (used by healing brush)
  function inpaint(img, mask, sc) {
    const { w, h } = img, n = w * h;
    const wgt = new Float32Array(n);
    for (let i = 0; i < n; i++) wgt[i] = 1 - mask[i];
    const fill = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) };
    const done = new Uint8Array(n);
    const radii = [2, 4, 8, 16, 32, 64].map((r) => Math.max(1, r * Math.max(0.35, sc)));
    for (let k = 0; k < radii.length; k++) {
      const den = gauss(wgt, w, h, radii[k]);
      const nums = {};
      for (const c of CH) { const t = new Float32Array(n); for (let i = 0; i < n; i++) t[i] = img[c][i] * wgt[i]; nums[c] = gauss(t, w, h, radii[k]); }
      const last = k === radii.length - 1;
      for (let i = 0; i < n; i++) {
        if (done[i] || mask[i] < 0.01) continue;
        if (den[i] > 0.35 || last) { for (const c of CH) fill[c][i] = nums[c][i] / Math.max(1e-4, den[i]); done[i] = 1; }
      }
    }
    for (const c of CH) { const a = img[c], f = fill[c]; for (let i = 0; i < n; i++) if (mask[i] > 0) a[i] = a[i] * (1 - mask[i]) + f[i] * mask[i]; }
    return img;
  }

  // rasterise brush strokes (normalised coordinates) into a mask
  function strokesInto(m, img, strokes) {
    if (!strokes || !strokes.length) return m;
    const { w, h } = img;
    for (const st of strokes) {
      const r = Math.max(0.6, st.r * img.fullW);
      const hard = st.hard === undefined ? 0.5 : st.hard;
      const flow = st.a === undefined ? 1 : st.a;
      const val = st.mode === 'hide' ? 0 : 1;
      const pts = st.pts;
      const stamp = (cx, cy) => {
        const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
        const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - cx, y - cy) / r; if (d >= 1) continue;
          const a = (d < hard ? 1 : 1 - smooth(hard, 1, d)) * flow;
          const i = y * w + x;
          m[i] = val ? Math.max(m[i], a) : Math.min(m[i], 1 - a);
        }
      };
      for (let k = 0; k < pts.length; k++) {
        const px = pts[k][0] * img.fullW - img.x0, py = pts[k][1] * img.fullH - img.y0;
        if (k === 0) { stamp(px, py); continue; }
        const qx = pts[k - 1][0] * img.fullW - img.x0, qy = pts[k - 1][1] * img.fullH - img.y0;
        const dist = Math.hypot(px - qx, py - qy), steps = Math.max(1, Math.ceil(dist / Math.max(0.5, r * 0.25)));
        for (let s = 1; s <= steps; s++) stamp(qx + (px - qx) * s / steps, qy + (py - qy) * s / steps);
      }
    }
    return m;
  }

  function shapeMask(img, sh, feather) {
    const { w, h } = img, m = new Float32Array(w * h);
    const fx = Math.max(1e-4, feather || 0);
    for (let y = 0; y < h; y++) {
      const ny = (img.y0 + y + 0.5) / img.fullH;
      for (let x = 0; x < w; x++) {
        const nx = (img.x0 + x + 0.5) / img.fullW;
        let v;
        if (sh.kind === 'ellipse') {
          const dx = (nx - (sh.x + sh.w / 2)) / (sh.w / 2), dy = (ny - (sh.y + sh.h / 2)) / (sh.h / 2);
          const d = Math.sqrt(dx * dx + dy * dy);
          v = 1 - smooth(1 - fx * 4, 1 + fx * 4, d);
        } else {
          const ex = Math.min(nx - sh.x, sh.x + sh.w - nx), ey = Math.min(ny - sh.y, sh.y + sh.h - ny);
          v = smooth(-fx, fx, Math.min(ex, ey * img.fullH / img.fullW));
        }
        m[y * w + x] = v;
      }
    }
    return m;
  }

  // mask spec -> Float32Array (or null for "everything")
  function computeMask(img, mk, env) {
    if (!mk) return null;
    const type = mk.type || 'none';
    const hasStrokes = mk.strokes && mk.strokes.length;
    if (type === 'none' && !hasStrokes && !mk.invert) return null;
    const { w, h } = img, n = w * h, sc = env.sc;
    let m;
    const L = () => lum(img);
    switch (type) {
      case 'lum': {
        const lo = mk.lo === undefined ? 0.5 : mk.lo, hi = mk.hi === undefined ? 1 : mk.hi, f = Math.max(0.005, mk.soft === undefined ? 0.1 : mk.soft);
        const l = L(); m = new Float32Array(n);
        for (let i = 0; i < n; i++) m[i] = smooth(lo - f, lo + f, l[i]) * (1 - smooth(hi - f, hi + f, l[i]));
        break;
      }
      case 'hue': {
        const hc = mk.hue || 0, wd = mk.width || 40; m = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const [hh, s] = rgb2hsl(clamp01(img.r[i]), clamp01(img.g[i]), clamp01(img.b[i]));
          let d = Math.abs(hh - hc); if (d > 180) d = 360 - d;
          m[i] = (1 - smooth(wd * 0.6, wd * 1.2, d)) * smooth(0.05, 0.25, s);
        }
        break;
      }
      case 'stars': m = I.starMaskOf(img, sc, mk.size === undefined ? 0.5 : mk.size); break;
      case 'nostars': { m = I.starMaskOf(img, sc, mk.size === undefined ? 0.5 : mk.size); for (let i = 0; i < n; i++) m[i] = 1 - m[i]; break; }
      case 'signal': case 'background': {
        const bg = bgOf(img, env);
        m = I.signalMask(L(), w, h, bg, sc);
        if (type === 'background') for (let i = 0; i < n; i++) m[i] = 1 - m[i];
        break;
      }
      case 'shape': m = mk.shape ? shapeMask(img, mk.shape, mk.shapeFeather) : new Float32Array(n).fill(1); break;
      case 'paint': m = new Float32Array(n); break; // start hidden, strokes reveal
      default: m = new Float32Array(n).fill(1);
    }
    if (hasStrokes) strokesInto(m, img, mk.strokes);
    if (mk.feather > 0) m = gauss(m, w, h, Math.max(0.5, fullPx(img, mk.feather * 0.02)));
    if (mk.invert) for (let i = 0; i < n; i++) m[i] = 1 - m[i];
    const dens = mk.density === undefined ? 1 : mk.density;
    if (dens < 1) for (let i = 0; i < n; i++) m[i] = 1 - dens * (1 - m[i]);
    return m;
  }

  // ---------------------------------------------------------- blend modes ---
  const BLENDS = {
    normal: (b, t) => t, multiply: (b, t) => b * t, screen: (b, t) => 1 - (1 - b) * (1 - t),
    overlay: (b, t) => (b < 0.5 ? 2 * b * t : 1 - 2 * (1 - b) * (1 - t)),
    softlight: (b, t) => (1 - 2 * t) * b * b + 2 * t * b,
    hardlight: (b, t) => (t < 0.5 ? 2 * b * t : 1 - 2 * (1 - b) * (1 - t)),
    lighten: (b, t) => Math.max(b, t), darken: (b, t) => Math.min(b, t), difference: (b, t) => Math.abs(b - t),
    add: (b, t) => Math.min(1, b + t), subtract: (b, t) => Math.max(0, b - t),
    color: null, luminosity: null,
  };
  function blendInto(base, top, mode, opacity, mask) {
    const n = base.w * base.h;
    const f = BLENDS[mode] || BLENDS.normal;
    for (let i = 0; i < n; i++) {
      const a = opacity * (mask ? mask[i] : 1);
      if (a <= 0) continue;
      const br = base.r[i], bg = base.g[i], bb = base.b[i];
      let tr = top.r[i], tg = top.g[i], tb = top.b[i];
      if (mode === 'color' || mode === 'luminosity') {
        const lb = (br + bg + bb) / 3, lt = (tr + tg + tb) / 3;
        if (mode === 'color') { tr += lb - lt; tg += lb - lt; tb += lb - lt; }
        else { tr = br + lt - lb; tg = bg + lt - lb; tb = bb + lt - lb; }
      } else if (mode !== 'normal') { tr = f(clamp01(br), clamp01(tr)); tg = f(clamp01(bg), clamp01(tg)); tb = f(clamp01(bb), clamp01(tb)); }
      base.r[i] = br + (tr - br) * a; base.g[i] = bg + (tg - bg) * a; base.b[i] = bb + (tb - bb) * a;
    }
    return base;
  }

  // ------------------------------------------------------------- the ops ---
  const OPTS_STRETCH = [['auto', 'Automatisch (STF)', 'Automatic (STF)'], ['stat', 'Statistisch (per kanaal)', 'Statistical (per channel)'], ['arcsinh', 'Arcsinh', 'Arcsinh'], ['ghs', 'GHS', 'GHS'], ['log', 'Logaritmisch', 'Logarithmic'], ['levels', 'Niveaus (maan/planeet)', 'Levels (moon/planet)'], ['manual', 'Handmatig (zwart/midden/wit)', 'Manual (black/mid/white)']];
  const PALETTES = [['hoo', 'HOO', 'HOO'], ['hooSoft', 'HOO zacht', 'HOO soft'], ['foraxx', 'Foraxx', 'Foraxx'], ['sho', 'Hubble-achtig (SHO)', 'Hubble-like (SHO)'], ['ha', 'Alleen Ha', 'Ha only'], ['oiii', 'Alleen OIII', 'OIII only']];
  const BLUR_OPTS = [['guided', 'Snel (randbehoudend)', 'Fast (edge preserving)'], ['wavelet', 'Wavelets', 'Wavelets'], ['median', 'Mediaan', 'Median'], ['bilateral', 'Oppervlak (bilateraal)', 'Surface (bilateral)']];

  function medianFilter(a, w, h, r) {
    const out = new Float32Array(a.length), k = (2 * r + 1) * (2 * r + 1), buf = new Float32Array(k), mid = k >> 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -r; dy <= r; dy++) { const o = Math.min(h - 1, Math.max(0, y + dy)) * w; for (let dx = -r; dx <= r; dx++) buf[n++] = a[o + Math.min(w - 1, Math.max(0, x + dx))]; }
      // quickselect for the median
      let lo = 0, hi = k - 1;
      while (lo < hi) {
        const piv = buf[mid]; let i = lo, j = hi;
        while (i <= j) { while (buf[i] < piv) i++; while (buf[j] > piv) j--; if (i <= j) { const t = buf[i]; buf[i] = buf[j]; buf[j] = t; i++; j--; } }
        if (j < mid) lo = i; if (mid < i) hi = j;
      }
      out[y * w + x] = buf[mid];
    }
    return out;
  }
  function bilateral(img, radius, range) {
    // fast approximation: guided filter per channel with range-dependent eps
    for (const c of CH) img[c] = I.guided(img[c], img.w, img.h, Math.max(1, Math.round(radius)), range * range);
    return img;
  }

  const OPS = {
    // ---- astro: linear preparation
    hotpix: { g: 'astro', nl: 'Hete pixels verwijderen', en: 'Remove hot pixels', p: [], run: (img) => { I.removeHotPixels(img); return img; } },
    gradient: {
      g: 'astro', nl: 'Lichtvervuiling / gradient verwijderen', en: 'Remove light pollution / gradient',
      p: [R('amount', 0.9, 0, 1, 0.01, 'Sterkte', 'Strength'), S('method', 'poly', [['poly', 'Glad (polynoom)', 'Smooth (polynomial)'], ['grid', 'Raster (complex)', 'Grid (complex)']], 'Methode', 'Method'),
        S('degree', 2, [[1, 'Eenvoudig', 'Simple'], [2, 'Normaal', 'Normal'], [3, 'Complex', 'Complex'], [4, 'Zeer complex', 'Very complex']], 'Soort', 'Type', { show: (p) => p.method === 'poly' }),
        R('smooth', 0.5, 0, 1, 0.01, 'Gladheid', 'Smoothness', { show: (p) => p.method === 'grid' }), C('divide', false, 'Delen (vignettering)', 'Divide (vignetting)'), C('showModel', false, 'Toon gevonden gradient', 'Show detected gradient')],
      run: (img, p, env) => {
        if (!('model' in env.ctx)) env.ctx.model = p.method === 'grid' ? I.fitGrid(img, p.smooth) : I.fitGradient(img, p.degree);
        const model = env.ctx.model; if (!model) return img;
        if (p.showModel) {
          const v = E.newImage(img.w, img.h, img); geom(v, img);
          I.applyGradient(img, model, 0, false, v);
          let lo = Infinity, hi = -Infinity;
          for (const c of CH) for (const x of v[c]) { if (x < lo) lo = x; if (x > hi) hi = x; }
          for (const c of CH) for (let i = 0; i < v[c].length; i++) v[c][i] = 0.1 + 0.8 * (v[c][i] - lo) / Math.max(1e-6, hi - lo);
          return v;
        }
        I.applyGradient(img, model, p.amount, p.divide); return img;
      },
    },
    vignfix: { g: 'astro', nl: 'Vignettering corrigeren', en: 'Correct vignetting', p: [R('amount', 0.3, 0, 1, 0.01, 'Sterkte', 'Strength')], run: (img, p) => { I.vignetteCorrect(img, p.amount); return img; } },
    colorcal: {
      g: 'astro', nl: 'Kleurkalibratie (achtergrond + sterren)', en: 'Colour calibration (background + stars)',
      p: [C('neutralize', true, 'Achtergrond neutraal', 'Neutral background'), R('whiteBalance', 0.7, 0, 1, 0.01, 'Witbalans op sterren', 'White balance on stars'),
        R('temperature', 0, -1, 1, 0.01, 'Temperatuur', 'Temperature'), R('tint', 0, -1, 1, 0.01, 'Tint', 'Tint'),
        X('pick', 'wbPick', null, 'Pipet witte ster', 'Picker white star'), X('pick', 'bgPick', null, 'Pipet achtergrond', 'Picker background')],
      run: (img, p, env) => {
        if (!env.ctx.col) {
          env.ctx.col = I.measureColour(img);
          if (p.wbPick) { const r = I.measurePick(img, p.wbPick, env.ctx.col.bg); if (r && r.k) env.ctx.col.pickK = r.k; }
          if (p.bgPick) { const r = I.measurePick(img, Object.assign({ background: true }, p.bgPick), env.ctx.col.bg); if (r && r.bgPick) env.ctx.col.bg = r.bgPick; }
        }
        I.applyColour(img, env.ctx.col, p); return img;
      },
    },
    deconv: { g: 'astro', nl: 'Deconvolutie', en: 'Deconvolution', p: [R('strength', 0.5, 0, 1, 0.01, 'Sterkte', 'Strength'), R('radius', 1.5, 0.5, 4, 0.05, 'Sterrenstraal (px)', 'Star radius (px)')], run: (img, p, env) => { I.deconvolve(img, p.strength, p.radius, env.sc); return img; } },

    // ---- stretch
    stretch: {
      g: 'stretch', nl: 'Oprekken (stretch)', en: 'Stretch',
      p: [S('method', 'auto', OPTS_STRETCH, 'Methode', 'Method'), R('brightness', 0.22, 0.04, 0.45, 0.005, 'Helderheid', 'Brightness', { show: (p) => p.method !== 'manual' }),
        R('blackPoint', 0.33, 0, 1, 0.01, 'Zwartpunt', 'Black point', { show: (p) => p.method !== 'manual' }), R('colorPreserve', 0.5, 0, 1, 0.01, 'Kleurbehoud', 'Colour preservation'),
        R('ghsB', 2, -3, 12, 0.1, 'GHS lokale intensiteit (b)', 'GHS local intensity (b)', { show: (p) => p.method === 'ghs' }), R('ghsLP', 0.5, 0, 1, 0.01, 'GHS schaduwen beschermen', 'GHS protect shadows', { show: (p) => p.method === 'ghs' }),
        R('ghsHP', 1, 0.5, 1, 0.01, 'GHS hoge lichten beschermen', 'GHS protect highlights', { show: (p) => p.method === 'ghs' }),
        R('black', 0.0, 0, 0.5, 0.001, 'Zwart', 'Black', { show: (p) => p.method === 'manual' }), R('mid', 0.25, 0.001, 0.999, 0.001, 'Midden', 'Midtones', { show: (p) => p.method === 'manual' }),
        R('white', 1, 0.05, 1, 0.001, 'Wit', 'White', { show: (p) => p.method === 'manual' })],
      run: (img, p, env) => {
        const ctx = env.ctx;
        if (p.method === 'manual') {
          const lut = I.buildLUT((x) => I.mtf(1 - p.mid, x));
          I.applyStretch(img, { c0: p.black, c1: Math.max(p.black + 0.001, p.white), lut }, { colorPreserve: p.colorPreserve });
          return img;
        }
        if (p.method === 'stat') {
          if (!ctx.st) {
            ctx.st = {};
            for (const c of CH) {
              const a = img[c].map(clamp01); const { med, mad } = medMad(a);
              const c0 = Math.max(0, med + (-3.6 + 2.4 * p.blackPoint) * 1.4826 * mad), x = Math.max(1e-6, (med - c0) / (1 - c0)), B = p.brightness;
              const m = x >= B ? 0.5 : (x * (B - 1)) / (2 * B * x - B - x);
              ctx.st[c] = { c0, m: Math.min(0.5, Math.max(5e-5, m)) };
            }
          }
          for (const c of CH) { const { c0, m } = ctx.st[c], a = img[c], k = 1 / (1 - c0); for (let i = 0; i < a.length; i++) a[i] = I.mtf(m, clamp01((a[i] - c0) * k)); }
          return img;
        }
        if (p.method === 'log') {
          if (!ctx.lg) {
            const L = lum(img).map(clamp01); const { med, mad } = medMad(L);
            const c0 = Math.max(0, med + (-3.6 + 2.4 * p.blackPoint) * 1.4826 * mad), x = Math.max(1e-6, (med - c0) / (1 - c0));
            let lo = 0, hi = 14;
            for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2, k = Math.expm1(mid); const v = Math.log1p(k * x) / Math.log1p(k); if (v < p.brightness) lo = mid; else hi = mid; }
            const k = Math.expm1((lo + hi) / 2);
            ctx.lg = { c0, c1: 1, lut: I.buildLUT((v) => Math.log1p(k * v) / Math.log1p(k)) };
          }
          I.applyStretch(img, ctx.lg, p); return img;
        }
        if (!ctx.st2) ctx.st2 = I.measureStretch(img, { stretchMode: p.method, brightness: p.brightness, blackPoint: p.blackPoint, ghsB: p.ghsB, ghsLP: p.ghsLP, ghsHP: p.ghsHP });
        I.applyStretch(img, ctx.st2, p); return img;
      },
    },
    hdr: { g: 'stretch', nl: 'Felle delen beschermen (HDR)', en: 'Protect bright areas (HDR)', p: [R('amount', 0.5, 0, 1, 0.01, 'Sterkte', 'Strength')], run: (img, p) => { I.highlightProtect(img, p.amount); return img; } },
    hdrmt: {
      g: 'stretch', nl: 'HDR multischaal', en: 'HDR multiscale',
      p: [R('amount', 0.5, 0, 1, 0.01, 'Sterkte', 'Strength'), R('layers', 5, 3, 7, 1, 'Schaal (lagen)', 'Scale (layers)')],
      run: (img, p, env) => {
        const L = lum(img); const lay = I.atrous(L, img.w, img.h, Math.round(p.layers));
        const res = lay[lay.length - 1];
        // measured once (preview) and reused, so a zoomed-in region and the export use the same reference
        if (env.ctx.med === undefined) env.ctx.med = medMad(res).med;
        const med = env.ctx.med;
        const Ln = new Float32Array(L.length);
        for (let i = 0; i < L.length; i++) Ln[i] = L[i] - (res[i] - med) * p.amount * 0.8 * smooth(med, 1, res[i]);
        I.applyLumRatio(img, L, Ln, 0.2, 2); return img;
      },
    },

    // ---- narrowband & channels
    palette: {
      g: 'nb', nl: 'Narrowband-palet (duoband)', en: 'Narrowband palette (dual-band)',
      p: [S('palette', 'hoo', PALETTES, 'Palet', 'Palette'), R('oiiiBoost', 0.3, 0, 1, 0.01, 'OIII versterken', 'Boost OIII')],
      run: (img, p, env) => { I.applyPalette(img, p.palette, p.oiiiBoost, bgOf(img, env), env.sc, env.ctx); return img; },
    },
    chmix: {
      g: 'adjust', nl: 'Kanaalmixer', en: 'Channel mixer',
      p: [R('rr', 1, -2, 2, 0.01, 'Rood ← R', 'Red ← R'), R('rg', 0, -2, 2, 0.01, 'Rood ← G', 'Red ← G'), R('rb', 0, -2, 2, 0.01, 'Rood ← B', 'Red ← B'),
        R('gr', 0, -2, 2, 0.01, 'Groen ← R', 'Green ← R'), R('gg', 1, -2, 2, 0.01, 'Groen ← G', 'Green ← G'), R('gb', 0, -2, 2, 0.01, 'Groen ← B', 'Green ← B'),
        R('br', 0, -2, 2, 0.01, 'Blauw ← R', 'Blue ← R'), R('bg', 0, -2, 2, 0.01, 'Blauw ← G', 'Blue ← G'), R('bb', 1, -2, 2, 0.01, 'Blauw ← B', 'Blue ← B'), C('mono', false, 'Zwart-wit (alleen rij Rood)', 'Monochrome (red row only)')],
      run: (img, p) => mapPixels(img, (r, g, b, o) => {
        const R0 = p.rr * r + p.rg * g + p.rb * b;
        if (p.mono) { o[0] = o[1] = o[2] = R0; return; }
        o[0] = R0; o[1] = p.gr * r + p.gg * g + p.gb * b; o[2] = p.br * r + p.bg * g + p.bb * b;
      }),
    },
    scnr: { g: 'astro', nl: 'Groene zweem verwijderen (SCNR)', en: 'Remove green (SCNR)', p: [R('amount', 0.8, 0, 1, 0.01, 'Sterkte', 'Strength'), S('method', 'avg', [['avg', 'Gemiddeld neutraal', 'Average neutral'], ['max', 'Maximum neutraal', 'Maximum neutral']], 'Methode', 'Method')],
      run: (img, p) => mapPixels(img, (r, g, b, o) => { const m = p.method === 'max' ? Math.max(r, b) : (r + b) / 2; o[0] = r; o[2] = b; o[1] = g > m ? g + (m - g) * p.amount : g; }) },

    // ---- stars
    starreduce: { g: 'stars', nl: 'Sterren verkleinen', en: 'Reduce stars', p: [R('amount', 0.4, 0, 1, 0.01, 'Sterkte', 'Strength')], run: (img, p, env) => { I.starReduce(img, p.amount, env.sc); return img; } },
    starsplit: {
      g: 'stars', nl: 'Sterren bewerken / verwijderen', en: 'Edit / remove stars',
      p: [R('brightness', 0, -1, 0.5, 0.01, 'Helderheid sterren (−100 = weg)', 'Star brightness (−100 = removed)'), R('reduce', 0.3, 0, 1, 0.01, 'Kleiner', 'Smaller'),
        R('sat', 1, 0, 2.5, 0.01, 'Kleur', 'Colour'), R('halo', 0, 0, 1, 0.01, 'Halo\'s verkleinen', 'Reduce halos'), R('defringe', 0, 0, 1, 0.01, 'Blauwe randen weg', 'Remove blue fringes'),
        R('size', 0.5, 0, 1, 0.01, 'Grootte sterrenmasker', 'Star mask size')],
      run: (img, p, env) => {
        const mask = I.starMaskOf(img, env.sc, p.size);
        const { starless, stars } = I.separateStars(img, env.sc, mask);
        I.processStarLayer(stars, { starReduce: p.reduce, starHalo: p.halo, starBrightness: p.brightness, starSat: p.sat, defringe: p.defringe }, env.sc);
        I.screenCombine(starless, stars);
        return starless;
      },
    },
    spikes: {
      g: 'stars', nl: 'Star spikes (diffractiepieken)', en: 'Star spikes (diffraction)',
      p: [R('amount', 0.35, 0, 1, 0.01, 'Aantal sterren', 'Number of stars'), R('length', 0.45, 0, 1, 0.01, 'Lengte', 'Length'), R('angle', 45, 0, 90, 1, 'Hoek', 'Angle'),
        S('count', 4, [[4, '4 stralen', '4 rays'], [6, '6 stralen (JWST)', '6 rays (JWST)'], [8, '8 stralen', '8 rays']], 'Stralen', 'Rays')],
      run: (img, p, env) => {
        if (!env.ctx.stars) { const st = E.detectStars(img, null, 300, 8); env.ctx.stars = st.map((s) => ({ nx: (s.x + 0.5 + img.x0) / img.fullW, ny: (s.y + 0.5 + img.y0) / img.fullH, flux: s.flux / (env.sc * env.sc), r: s.r, g: s.g, b: s.b })); }
        I.drawSpikes(img, env.ctx.stars, { spikes: p.amount, spikeLength: p.length, spikeAngle: p.angle, spikeCount: p.count }); return img;
      },
    },

    // ---- noise
    denoise: {
      g: 'noise', nl: 'Ruis verminderen', en: 'Reduce noise',
      p: [S('method', 'guided', BLUR_OPTS, 'Methode', 'Method'), R('luma', 0.5, 0, 1, 0.01, 'Helderheidsruis', 'Luminance noise'), R('chroma', 0.6, 0, 1, 0.01, 'Kleurruis', 'Colour noise')],
      run: (img, p, env) => {
        if (p.method === 'median') { const r = Math.max(1, Math.round(p.luma * 3 * Math.max(0.5, env.sc))); for (const c of CH) img[c] = medianFilter(img[c], img.w, img.h, r); if (p.chroma) I.denoise(img, 0, p.chroma, env.sc); return img; }
        if (p.method === 'bilateral') { bilateral(img, (1 + 3 * p.luma) * Math.max(0.5, env.sc), 0.02 + 0.08 * p.luma); if (p.chroma) I.denoise(img, 0, p.chroma, env.sc); return img; }
        I.denoise(img, p.luma, p.chroma, env.sc, p.method); return img;
      },
    },
    bgsmooth: { g: 'noise', nl: 'Achtergrond gladmaken', en: 'Smooth background', p: [R('amount', 0.5, 0, 1, 0.01, 'Sterkte', 'Strength')], run: (img, p, env) => { I.backgroundSmooth(img, p.amount, bgOf(img, env), env.sc); return img; } },
    dust: {
      g: 'noise', nl: 'Stof en krassen', en: 'Dust & scratches', p: [R('radius', 1, 1, 4, 1, 'Straal', 'Radius'), R('threshold', 0.05, 0, 0.5, 0.005, 'Drempel', 'Threshold')],
      run: (img, p, env) => { const r = Math.max(1, Math.round(p.radius * Math.max(0.5, env.sc))); for (const c of CH) { const md = medianFilter(img[c], img.w, img.h, r), a = img[c]; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - md[i]) > p.threshold) a[i] = md[i]; } return img; },
    },

    // ---- detail
    localcontrast: { g: 'detail', nl: 'Lokaal contrast', en: 'Local contrast', p: [R('amount', 0.4, 0, 1.5, 0.01, 'Sterkte', 'Strength')], run: (img, p, env) => { I.localContrast(img, p.amount, bgOf(img, env), env.sc); return img; } },
    sharpen: { g: 'detail', nl: 'Verscherpen (slim)', en: 'Sharpen (smart)', p: [R('amount', 0.4, 0, 1.5, 0.01, 'Sterkte', 'Strength')], run: (img, p, env) => { I.sharpen(img, p.amount, bgOf(img, env), env.sc); return img; } },
    usm: {
      g: 'detail', nl: 'Onscherp masker', en: 'Unsharp mask',
      p: [R('amount', 0.8, 0, 3, 0.01, 'Hoeveelheid', 'Amount'), R('radius', 1.5, 0.3, 20, 0.1, 'Straal (px)', 'Radius (px)'), R('threshold', 0, 0, 0.2, 0.002, 'Drempel', 'Threshold')],
      run: (img, p, env) => {
        const L = lum(img), bl = gauss(L, img.w, img.h, Math.max(0.4, p.radius * env.sc)), Ln = new Float32Array(L.length);
        for (let i = 0; i < L.length; i++) { const d = L[i] - bl[i]; Ln[i] = Math.abs(d) < p.threshold ? L[i] : L[i] + d * p.amount; }
        I.applyLumRatio(img, L, Ln, 0.3, 3); return img;
      },
    },
    highpass: { g: 'filter', nl: 'Hoogdoorlaat (gebruik met Bedekken)', en: 'High pass (use with Overlay)', p: [R('radius', 3, 0.5, 50, 0.5, 'Straal (px)', 'Radius (px)')],
      run: (img, p, env) => { for (const c of CH) { const bl = gauss(img[c], img.w, img.h, Math.max(0.4, p.radius * env.sc)), a = img[c]; for (let i = 0; i < a.length; i++) a[i] = clamp01(0.5 + a[i] - bl[i]); } return img; } },
    wavelets: { g: 'detail', nl: 'Wavelets (RegiStax)', en: 'Wavelets (RegiStax)', p: [X('wav', 'gains', [0.5, 0.4, 0.2, 0, 0, 0], 'Lagen', 'Layers'), C('protect', true, 'Achtergrond beschermen', 'Protect background')],
      run: (img, p, env) => { I.waveletSharpen(img, p.gains, bgOf(img, env), env.sc, p.protect); return img; } },
    clahe: {
      g: 'detail', nl: 'CLAHE (adaptief contrast)', en: 'CLAHE (adaptive contrast)', p: [R('amount', 0.5, 0, 1, 0.01, 'Sterkte', 'Strength'), R('clip', 2, 1, 6, 0.1, 'Contrastlimiet', 'Clip limit'), R('tiles', 8, 2, 16, 1, 'Tegels', 'Tiles')],
      run: (img, p, env) => {
        const { w, h } = img, L = lum(img);
        if (!env.ctx.grid) env.ctx.grid = Math.round(p.tiles);
        const tx = Math.max(1, Math.round(p.tiles)), ty = Math.max(1, Math.round(p.tiles * h / w));
        const bins = 256, luts = [];
        for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
          const x0 = Math.floor(i * w / tx), x1 = Math.floor((i + 1) * w / tx), y0 = Math.floor(j * h / ty), y1 = Math.floor((j + 1) * h / ty);
          const hist = new Float32Array(bins); let n = 0;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { hist[Math.min(255, (clamp01(L[y * w + x]) * 255) | 0)]++; n++; }
          const lim = Math.max(1, p.clip * n / bins); let ex = 0;
          for (let k = 0; k < bins; k++) if (hist[k] > lim) { ex += hist[k] - lim; hist[k] = lim; }
          const add = ex / bins; let cum = 0; const lut = new Float32Array(bins);
          for (let k = 0; k < bins; k++) { cum += hist[k] + add; lut[k] = cum / Math.max(1, n); }
          luts.push(lut);
        }
        const Ln = new Float32Array(L.length);
        for (let y = 0; y < h; y++) {
          const fy = (y + 0.5) / (h / ty) - 0.5, j0 = Math.max(0, Math.min(ty - 1, Math.floor(fy))), j1 = Math.min(ty - 1, j0 + 1), wy = clamp01(fy - j0);
          for (let x = 0; x < w; x++) {
            const fx = (x + 0.5) / (w / tx) - 0.5, i0 = Math.max(0, Math.min(tx - 1, Math.floor(fx))), i1 = Math.min(tx - 1, i0 + 1), wx = clamp01(fx - i0);
            const k = Math.min(255, (clamp01(L[y * w + x]) * 255) | 0);
            const v = (luts[j0 * tx + i0][k] * (1 - wx) + luts[j0 * tx + i1][k] * wx) * (1 - wy) + (luts[j1 * tx + i0][k] * (1 - wx) + luts[j1 * tx + i1][k] * wx) * wy;
            Ln[y * w + x] = L[y * w + x] + (v - L[y * w + x]) * p.amount;
          }
        }
        I.applyLumRatio(img, L, Ln, 0.2, 4); return img;
      },
    },
    clarity: {
      g: 'detail', nl: 'Helderheid / structuur (Camera Raw)', en: 'Clarity / texture (Camera Raw)', p: [R('clarity', 0.4, -1, 1, 0.01, 'Helderheid (clarity)', 'Clarity'), R('texture', 0.2, -1, 1, 0.01, 'Structuur (texture)', 'Texture')],
      run: (img, p) => {
        const L = lum(img), big = gauss(L, img.w, img.h, Math.max(2, fullPx(img, 0.01))), mid = gauss(L, img.w, img.h, Math.max(1, fullPx(img, 0.0025)));
        const Ln = new Float32Array(L.length);
        for (let i = 0; i < L.length; i++) { const midW = 1 - Math.abs(2 * L[i] - 1); Ln[i] = L[i] + (L[i] - big[i]) * p.clarity * midW + (L[i] - mid[i]) * p.texture; }
        I.applyLumRatio(img, L, Ln, 0.3, 3); return img;
      },
    },
    dehaze: {
      g: 'detail', nl: 'Nevel verwijderen (dehaze)', en: 'Dehaze', p: [R('amount', 0.4, -1, 1, 0.01, 'Sterkte', 'Strength')],
      run: (img, p) => {
        const dark = new Float32Array(img.w * img.h);
        for (let i = 0; i < dark.length; i++) dark[i] = Math.min(img.r[i], img.g[i], img.b[i]);
        const veil = gauss(I.minMaxFilter(dark, img.w, img.h, Math.max(1, Math.round(fullPx(img, 0.01))), false), img.w, img.h, Math.max(2, fullPx(img, 0.02)));
        for (const c of CH) { const a = img[c]; for (let i = 0; i < a.length; i++) { const v = veil[i] * p.amount * 0.9; a[i] = (a[i] - v) / Math.max(0.2, 1 - v); } }
        return img;
      },
    },

    // ---- adjustments (Photoshop)
    brightcon: { g: 'adjust', nl: 'Helderheid/contrast', en: 'Brightness/contrast', p: [R('brightness', 0, -1, 1, 0.01, 'Helderheid', 'Brightness'), R('contrast', 0.15, -1, 1, 0.01, 'Contrast', 'Contrast'), C('astro', true, 'Astro-contrast (spil bij achtergrond)', 'Astro contrast (pivot at background)')],
      run: (img, p, env) => {
        if (p.contrast) I.curves(img, p.contrast, p.astro ? bgOf(img, env) : 0.35, !p.astro);
        if (p.brightness) mapPixels(img, (r, g, b, o) => { const k = p.brightness; o[0] = k > 0 ? r + (1 - r) * k * 0.5 : r * (1 + k * 0.5); o[1] = k > 0 ? g + (1 - g) * k * 0.5 : g * (1 + k * 0.5); o[2] = k > 0 ? b + (1 - b) * k * 0.5 : b * (1 + k * 0.5); });
        return img;
      } },
    levels: {
      g: 'adjust', nl: 'Niveaus', en: 'Levels',
      p: [S('channel', 'rgb', [['rgb', 'RGB', 'RGB'], ['r', 'Rood', 'Red'], ['g', 'Groen', 'Green'], ['b', 'Blauw', 'Blue']], 'Kanaal', 'Channel'), R('inBlack', 0, 0, 0.9, 0.001, 'Invoer zwart', 'Input black'),
        R('gamma', 1, 0.1, 5, 0.01, 'Gamma', 'Gamma'), R('inWhite', 1, 0.1, 1, 0.001, 'Invoer wit', 'Input white'), R('outBlack', 0, 0, 0.9, 0.001, 'Uitvoer zwart', 'Output black'), R('outWhite', 1, 0.1, 1, 0.001, 'Uitvoer wit', 'Output white'), X('levelsauto', 'auto', null, 'Automatisch', 'Auto')],
      run: (img, p) => {
        const chs = p.channel === 'rgb' ? CH : [p.channel];
        const sc = 1 / Math.max(1e-3, p.inWhite - p.inBlack), ig = 1 / p.gamma;
        for (const c of chs) { const a = img[c]; for (let i = 0; i < a.length; i++) a[i] = p.outBlack + (p.outWhite - p.outBlack) * Math.pow(clamp01((a[i] - p.inBlack) * sc), ig); }
        return img;
      },
    },
    curves: { g: 'adjust', nl: 'Curven', en: 'Curves', p: [X('curves', 'curves', null, 'Curven', 'Curves')], run: (img, p) => { I.userCurves(img, p.curves); return img; } },
    exposure: { g: 'adjust', nl: 'Belichting', en: 'Exposure', p: [R('exposure', 0, -3, 3, 0.01, 'Belichting (stops)', 'Exposure (stops)'), R('offset', 0, -0.3, 0.3, 0.001, 'Verschuiving', 'Offset'), R('gamma', 1, 0.2, 3, 0.01, 'Gamma-correctie', 'Gamma correction')],
      run: (img, p) => { const k = Math.pow(2, p.exposure), ig = 1 / p.gamma; for (const c of CH) { const a = img[c]; for (let i = 0; i < a.length; i++) a[i] = Math.pow(Math.max(0, a[i] * k + p.offset), ig); } return img; } },
    vibrance: { g: 'adjust', nl: 'Levendigheid / verzadiging', en: 'Vibrance / saturation', p: [R('saturation', 1.3, 0, 3.5, 0.01, 'Verzadiging', 'Saturation'), R('vibrance', 0.3, 0, 1, 0.01, 'Levendigheid', 'Vibrance'), C('protectBg', true, 'Achtergrond sparen', 'Spare background')],
      run: (img, p, env) => { I.saturate(img, p.saturation, p.vibrance, p.protectBg ? bgOf(img, env) : -1, env.sc); return img; } },
    huesat: {
      g: 'adjust', nl: 'Kleurtoon/verzadiging', en: 'Hue/saturation', p: [R('hue', 0, -180, 180, 1, 'Kleurtoon', 'Hue'), R('sat', 0, -1, 1, 0.01, 'Verzadiging', 'Saturation'), R('light', 0, -1, 1, 0.01, 'Lichtheid', 'Lightness'), C('colorize', false, 'Vullen met kleur', 'Colourise')],
      run: (img, p) => mapPixels(img, (r, g, b, o) => {
        let [h, s, l] = rgb2hsl(clamp01(r), clamp01(g), clamp01(b));
        if (p.colorize) { h = (p.hue + 360) % 360; s = clamp01(0.25 + p.sat * 0.75); } else { h = (h + p.hue + 360) % 360; s = clamp01(s * (1 + p.sat)); }
        l = p.light > 0 ? l + (1 - l) * p.light : l * (1 + p.light);
        hsl2rgb(h, s, clamp01(l), o);
      }),
    },
    hsl: { g: 'adjust', nl: 'Kleur per tint (HSL)', en: 'Per-hue colour (HSL)', p: [X('hsl', 'hsl', null, 'HSL', 'HSL')], run: (img, p) => { I.hslAdjust(img, p.hsl); return img; } },
    colorbalance: {
      g: 'adjust', nl: 'Kleurbalans', en: 'Colour balance',
      p: [R('cbShadowT', 0, -1, 1, 0.01, 'Schaduwen: blauw ↔ warm', 'Shadows: blue ↔ warm'), R('cbShadowG', 0, -1, 1, 0.01, 'Schaduwen: groen ↔ paars', 'Shadows: green ↔ magenta'),
        R('cbMidT', 0, -1, 1, 0.01, 'Middentonen: blauw ↔ warm', 'Midtones: blue ↔ warm'), R('cbMidG', 0, -1, 1, 0.01, 'Middentonen: groen ↔ paars', 'Midtones: green ↔ magenta'),
        R('cbHighT', 0, -1, 1, 0.01, 'Hoge lichten: blauw ↔ warm', 'Highlights: blue ↔ warm'), R('cbHighG', 0, -1, 1, 0.01, 'Hoge lichten: groen ↔ paars', 'Highlights: green ↔ magenta')],
      run: (img, p) => { I.colourBalance(img, p); return img; },
    },
    temptint: { g: 'adjust', nl: 'Witbalans (temperatuur/tint)', en: 'White balance (temperature/tint)', p: [R('temperature', 0, -1, 1, 0.01, 'Temperatuur', 'Temperature'), R('tint', 0, -1, 1, 0.01, 'Tint', 'Tint')],
      run: (img, p) => mapPixels(img, (r, g, b, o) => { o[0] = r * (1 + 0.25 * p.temperature); o[1] = g * (1 - 0.2 * p.tint); o[2] = b * (1 - 0.25 * p.temperature); }) },
    photofilter: { g: 'adjust', nl: 'Fotofilter', en: 'Photo filter', p: [X('color', 'color', '#ec8a00', 'Filterkleur', 'Filter colour'), R('density', 0.25, 0, 1, 0.01, 'Dichtheid', 'Density'), C('preserve', true, 'Lichtsterkte behouden', 'Preserve luminosity')],
      run: (img, p) => { const c = hex2rgb(p.color); return mapPixels(img, (r, g, b, o) => { const l = (r + g + b) / 3; let nr = r * (1 - p.density) + r * c[0] * 2 * p.density, ng = g * (1 - p.density) + g * c[1] * 2 * p.density, nb = b * (1 - p.density) + b * c[2] * 2 * p.density; if (p.preserve) { const nl = (nr + ng + nb) / 3 || 1; const k = l / nl; nr *= k; ng *= k; nb *= k; } o[0] = nr; o[1] = ng; o[2] = nb; }); } },
    bw: { g: 'adjust', nl: 'Zwart-wit', en: 'Black & white', p: [R('wr', 0.4, -1, 2, 0.01, 'Rood', 'Red'), R('wg', 0.35, -1, 2, 0.01, 'Groen', 'Green'), R('wb', 0.25, -1, 2, 0.01, 'Blauw', 'Blue'), X('color', 'tintColor', '#ffffff', 'Tint (wit = geen)', 'Tint (white = none)')],
      run: (img, p) => { const t = hex2rgb(p.tintColor); return mapPixels(img, (r, g, b, o) => { const y = p.wr * r + p.wg * g + p.wb * b; o[0] = y * t[0]; o[1] = y * t[1]; o[2] = y * t[2]; }); } },
    invert: { g: 'adjust', nl: 'Negatief', en: 'Invert', p: [], run: (img) => mapPixels(img, (r, g, b, o) => { o[0] = 1 - clamp01(r); o[1] = 1 - clamp01(g); o[2] = 1 - clamp01(b); }) },
    posterize: { g: 'adjust', nl: 'Posteriseren', en: 'Posterize', p: [R('levels', 6, 2, 32, 1, 'Niveaus', 'Levels')], run: (img, p) => { const k = Math.round(p.levels) - 1; return mapPixels(img, (r, g, b, o) => { o[0] = Math.round(clamp01(r) * k) / k; o[1] = Math.round(clamp01(g) * k) / k; o[2] = Math.round(clamp01(b) * k) / k; }); } },
    threshold: { g: 'adjust', nl: 'Drempel', en: 'Threshold', p: [R('level', 0.5, 0, 1, 0.001, 'Niveau', 'Level')], run: (img, p) => mapPixels(img, (r, g, b, o) => { o[0] = o[1] = o[2] = (r + g + b) / 3 >= p.level ? 1 : 0; }) },
    gradmap: {
      g: 'adjust', nl: 'Verloop toewijzen', en: 'Gradient map', p: [X('color', 'c0', '#000000', 'Schaduwen', 'Shadows'), X('color', 'c1', '#c4502a', 'Middentonen', 'Midtones'), X('color', 'c2', '#fff1d6', 'Hoge lichten', 'Highlights')],
      run: (img, p) => { const a = hex2rgb(p.c0), m = hex2rgb(p.c1), z = hex2rgb(p.c2); return mapPixels(img, (r, g, b, o) => { const y = clamp01((r + g + b) / 3); const [u, v, t] = y < 0.5 ? [a, m, y * 2] : [m, z, (y - 0.5) * 2]; o[0] = u[0] + (v[0] - u[0]) * t; o[1] = u[1] + (v[1] - u[1]) * t; o[2] = u[2] + (v[2] - u[2]) * t; }); },
    },
    shadhigh: {
      g: 'adjust', nl: 'Schaduwen/hoge lichten', en: 'Shadows/highlights', p: [R('shadows', 0.3, 0, 1, 0.01, 'Schaduwen ophalen', 'Lift shadows'), R('highlights', 0.2, 0, 1, 0.01, 'Hoge lichten dempen', 'Recover highlights'), R('radius', 0.02, 0.002, 0.1, 0.001, 'Straal', 'Radius')],
      run: (img, p) => {
        const L = lum(img), B = gauss(L, img.w, img.h, Math.max(1, fullPx(img, p.radius))), Ln = new Float32Array(L.length);
        for (let i = 0; i < L.length; i++) { const sh = Math.pow(1 - B[i], 2) * p.shadows * 0.5, hi = Math.pow(B[i], 2) * p.highlights * 0.5; Ln[i] = L[i] + sh * (1 - L[i]) * L[i] * 3 - hi * L[i] * 0.8; }
        I.applyLumRatio(img, L, Ln, 0.3, 4); return img;
      },
    },
    autotone: {
      g: 'adjust', nl: 'Automatische tint/contrast/kleur', en: 'Auto tone/contrast/colour', p: [S('mode', 'color', [['tone', 'Automatische tint (per kanaal)', 'Auto tone (per channel)'], ['contrast', 'Automatisch contrast', 'Auto contrast'], ['color', 'Automatische kleur', 'Auto colour']], 'Soort', 'Type'), R('clip', 0.001, 0, 0.02, 0.0005, 'Afkappen', 'Clip')],
      run: (img, p, env) => {
        if (!env.ctx.at) {
          const at = {};
          if (p.mode === 'contrast') { const L = lum(img); const lo = percentile(L.map(clamp01), p.clip), hi = percentile(L.map(clamp01), 1 - p.clip); for (const c of CH) at[c] = [lo, hi]; }
          else for (const c of CH) at[c] = [percentile(img[c].map(clamp01), p.clip), percentile(img[c].map(clamp01), 1 - p.clip)];
          if (p.mode === 'color') { const m = {}; for (const c of CH) m[c] = medMad(img[c]).med; const avg = (m.r + m.g + m.b) / 3; at.shift = {}; for (const c of CH) at.shift[c] = avg - m[c]; }
          env.ctx.at = at;
        }
        const at = env.ctx.at;
        for (const c of CH) { const [lo, hi] = at[c], k = 1 / Math.max(1e-3, hi - lo), a = img[c], sh = at.shift ? at.shift[c] : 0; for (let i = 0; i < a.length; i++) a[i] = (a[i] + sh - lo) * k; }
        return img;
      },
    },

    // ---- filters / effects
    gblur: { g: 'filter', nl: 'Gaussiaans vervagen', en: 'Gaussian blur', p: [R('radius', 2, 0.3, 100, 0.1, 'Straal (px)', 'Radius (px)')], run: (img, p, env) => { for (const c of CH) img[c] = gauss(img[c], img.w, img.h, Math.max(0.3, p.radius * env.sc)); return img; } },
    median: { g: 'filter', nl: 'Mediaan', en: 'Median', p: [R('radius', 1, 1, 5, 1, 'Straal', 'Radius')], run: (img, p, env) => { const r = Math.max(1, Math.round(p.radius * Math.max(0.5, env.sc))); for (const c of CH) img[c] = medianFilter(img[c], img.w, img.h, r); return img; } },
    surface: { g: 'filter', nl: 'Oppervlakte vervagen', en: 'Surface blur', p: [R('radius', 4, 1, 20, 0.5, 'Straal', 'Radius'), R('threshold', 0.05, 0.005, 0.3, 0.005, 'Drempel', 'Threshold')], run: (img, p, env) => bilateral(img, p.radius * Math.max(0.5, env.sc), p.threshold) },
    minimum: { g: 'filter', nl: 'Minimum (sterren dunner)', en: 'Minimum (thinner stars)', p: [R('radius', 1, 1, 5, 1, 'Straal', 'Radius')], run: (img, p, env) => { const r = Math.max(1, Math.round(p.radius * Math.max(0.5, env.sc))); for (const c of CH) img[c] = I.minMaxFilter(img[c], img.w, img.h, r, false); return img; } },
    maximum: { g: 'filter', nl: 'Maximum', en: 'Maximum', p: [R('radius', 1, 1, 5, 1, 'Straal', 'Radius')], run: (img, p, env) => { const r = Math.max(1, Math.round(p.radius * Math.max(0.5, env.sc))); for (const c of CH) img[c] = I.minMaxFilter(img[c], img.w, img.h, r, true); return img; } },
    emboss: { g: 'filter', nl: 'Reliëf', en: 'Emboss', p: [R('amount', 1, 0.1, 5, 0.1, 'Hoeveelheid', 'Amount'), R('angle', 135, 0, 360, 1, 'Hoek', 'Angle')],
      run: (img, p) => { const L = lum(img), dx = Math.cos(p.angle * Math.PI / 180), dy = Math.sin(p.angle * Math.PI / 180), w = img.w, h = img.h; for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const v = 0.5 + (L[i + Math.round(dy) * w + Math.round(dx)] - L[i - Math.round(dy) * w - Math.round(dx)]) * p.amount; img.r[i] = img.g[i] = img.b[i] = v; } return img; } },
    edges: { g: 'filter', nl: 'Randen zoeken', en: 'Find edges', p: [R('amount', 3, 0.5, 10, 0.1, 'Hoeveelheid', 'Amount')],
      run: (img, p) => { const L = lum(img), w = img.w, h = img.h; for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const gx = L[i + 1] - L[i - 1], gy = L[i + w] - L[i - w]; const v = 1 - clamp01(Math.hypot(gx, gy) * p.amount); img.r[i] = img.g[i] = img.b[i] = v; } return img; } },
    grain: { g: 'filter', nl: 'Ruis/korrel toevoegen', en: 'Add noise/grain', p: [R('amount', 0.03, 0, 0.2, 0.001, 'Hoeveelheid', 'Amount'), C('mono', true, 'Monochroom', 'Monochrome')],
      run: (img, p) => { let s = 9; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; }; return mapPixels(img, (r, g, b, o) => { const k = rnd() * p.amount * 2; o[0] = r + k; o[1] = g + (p.mono ? k : rnd() * p.amount * 2); o[2] = b + (p.mono ? k : rnd() * p.amount * 2); }); } },
    glow: { g: 'filter', nl: 'Zachte gloed (Orton)', en: 'Soft glow (Orton)', p: [R('amount', 0.4, 0, 1, 0.01, 'Sterkte', 'Strength')], run: (img, p, env) => { I.glow(img, p.amount, bgOf(img, env), env.sc); return img; } },
    vignette: { g: 'filter', nl: 'Vignet', en: 'Vignette', p: [R('amount', 0.3, -1, 1, 0.01, 'Sterkte (− = licht)', 'Strength (− = light)')], run: (img, p) => { I.vignetteEffect(img, p.amount); return img; } },

    // ---- repair
    heal: { g: 'repair', nl: 'Herstelpenseel (satellietstrepen, vlekken)', en: 'Healing brush (satellite trails, spots)', p: [X('info', 'strokes', [], 'Schilder met het herstelpenseel (J) over de plek die weg moet.', 'Paint with the healing brush (J) over what should go.')],
      run: (img, p, env) => { if (!p.strokes || !p.strokes.length) return img; const m = strokesInto(new Float32Array(img.w * img.h), img, p.strokes); return inpaint(img, m, env.sc); } },

    // ---- text (drawn by the interface, ignored here)
    text: { g: 'text', nl: 'Tekst', en: 'Text', p: [], run: (img) => img },
  };

  const GROUPS = [
    ['astro', 'Astro', 'Astro'], ['stretch', 'Oprekken', 'Stretch'], ['nb', 'Narrowband', 'Narrowband'], ['stars', 'Sterren', 'Stars'],
    ['noise', 'Ruis', 'Noise'], ['detail', 'Detail en scherpte', 'Detail and sharpness'], ['adjust', 'Aanpassingen', 'Adjustments'], ['filter', 'Filters en effecten', 'Filters and effects'], ['repair', 'Herstellen', 'Repair'],
  ];

  function defaults(op) {
    const p = {};
    for (const d of (OPS[op] ? OPS[op].p : [])) p[d.k] = Array.isArray(d.d) ? d.d.slice() : d.d;
    return p;
  }
  let uid = 1;
  function newLayer(op, params, extra) {
    return Object.assign({ id: 'L' + Date.now().toString(36) + (uid++), op, on: true, opacity: 1, blend: 'normal', params: Object.assign(defaults(op), params || {}), mask: { type: 'none', invert: false, feather: 0, density: 1, strokes: [] } }, extra || {});
  }

  // ------------------------------------------------------ preset -> layers ---
  function presetLayers(name, detected) {
    let type = name;
    if (name === 'auto') type = (detected && detected.type) || 'nebula';
    const P = Object.assign({}, E.DEFAULTS, E.PRESETS[type] || E.PRESETS.nebula);
    if (name === 'auto' && detected && detected.fallback) { P.starReduce = 0.2; P.saturation = 1.4; P.brightness = 0.23; }
    const L = [];
    const add = (op, params, extra) => L.push(newLayer(op, params, extra));
    if (P.hotPixels) add('hotpix');
    if (P.vignetteFix > 0) add('vignfix', { amount: P.vignetteFix });
    if (P.gradient > 0) add('gradient', { amount: P.gradient, method: P.gradientMethod, degree: P.gradientDegree, smooth: P.gradientSmooth, divide: P.gradientDivide });
    add('colorcal', { neutralize: P.neutralize, whiteBalance: P.whiteBalance, temperature: P.temperature, tint: P.tint });
    if (P.deconv > 0) add('deconv', { strength: P.deconv, radius: P.deconvRadius });
    add('stretch', { method: P.stretchMode, brightness: P.brightness, blackPoint: P.blackPoint, colorPreserve: P.colorPreserve, ghsB: P.ghsB, ghsLP: P.ghsLP, ghsHP: P.ghsHP });
    if (P.highlightProtect > 0 && P.stretchMode !== 'levels') add('hdr', { amount: P.highlightProtect });
    if (P.palette && P.palette !== 'rgb') add('palette', { palette: P.palette, oiiiBoost: P.oiiiBoost });
    if (P.denoise > 0 || P.chromaDenoise > 0) add('denoise', { method: P.denoiseMethod, luma: P.denoise, chroma: P.chromaDenoise });
    if (P.bgSmooth > 0) add('bgsmooth', { amount: P.bgSmooth });
    if (P.starBrightness !== 0 || P.starSat !== 1 || P.starHalo > 0) add('starsplit', { brightness: P.starBrightness, reduce: P.starReduce, sat: P.starSat, halo: P.starHalo, defringe: P.defringe });
    else if (P.starReduce > 0) add('starreduce', { amount: P.starReduce });
    if (P.localContrast > 0) add('localcontrast', { amount: P.localContrast }, P.starBrightness === -1 ? {} : { mask: { type: 'nostars', invert: false, feather: 0, density: 1, strokes: [] } });
    if (P.sharpen > 0) add('sharpen', { amount: P.sharpen });
    if (P.wavelets && P.wavelets.some((v) => v)) add('wavelets', { gains: P.wavelets.slice(), protect: P.stretchMode !== 'levels' });
    if (P.contrast) add('brightcon', { brightness: 0, contrast: P.contrast, astro: P.stretchMode !== 'levels' });
    if (P.saturation !== 1 || P.vibrance > 0) add('vibrance', { saturation: P.saturation, vibrance: P.vibrance, protectBg: P.stretchMode !== 'levels' });
    if (P.hsl) add('hsl', { hsl: JSON.parse(JSON.stringify(P.hsl)) });
    if (P.scnr > 0) add('scnr', { amount: P.scnr });
    if (P.spikes > 0) add('spikes', { amount: P.spikes, length: P.spikeLength, angle: P.spikeAngle, count: P.spikeCount });
    if (P.glow > 0) add('glow', { amount: P.glow });
    if (P.vignette) add('vignette', { amount: P.vignette });
    if (P.mono) add('bw', { wr: 0.4, wg: 0.35, wb: 0.25 });
    if (P.colorize > 0) add('huesat', { hue: P.colorizeHue, sat: 0.6, light: 0, colorize: true }, { opacity: P.colorize });
    return { layers: L, autoCrop: P.autoCrop };
  }

  // ------------------------------------------------------- stack processing ---
  function hashStr(s, h) {
    h = h || 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return h;
  }
  const layerKey = (L) => JSON.stringify([L.op, L.on, L.opacity, L.blend, L.params, L.mask]);

  function lruSet(map, key, val, max) {
    if (map.has(key)) map.delete(key);
    map.set(key, val);
    while (map.size > max) map.delete(map.keys().next().value);
  }

  /*
   * store: { srcKey, ctx: Map, cache: Map }   opts: { cache, viewMask, onStep }
   */
  function processStack(src, layers, store, opts) {
    opts = opts || {};
    const sc = src.scale || 1;
    const keys = [];
    let h = hashStr(String(store.srcKey || 0));
    for (const L of layers) { h = hashStr(layerKey(L), h); keys.push(String(h)); }
    let start = -1, img = null;
    if (opts.cache && store.cache) {
      let top = layers.length - 1;
      if (opts.viewMask) { const vi = layers.findIndex((l) => l.id === opts.viewMask && l.on); if (vi >= 0) top = vi - 1; }
      for (let i = top; i >= 0; i--) if (store.cache.has(keys[i])) { start = i; img = E.cloneImage(store.cache.get(keys[i])); break; }
    }
    if (!img) img = E.cloneImage(src);
    for (let i = start + 1; i < layers.length; i++) {
      const L = layers[i];
      const op = Object.prototype.hasOwnProperty.call(OPS, L.op) ? OPS[L.op] : null; // never 'constructor' etc.
      if (L.on && op && L.op !== 'text') {
        if (opts.onStep) opts.onStep(L.op, i);
        let ctx = store.ctx.get(keys[i]);
        if (!ctx) { ctx = {}; lruSet(store.ctx, keys[i], ctx, 400); }
        const env = { sc, ctx };
        const p = Object.assign(defaults(L.op), L.params);
        const masked = L.mask && (L.mask.type !== 'none' || (L.mask.strokes && L.mask.strokes.length) || L.mask.invert);
        if (opts.viewMask === L.id) {
          const m = computeMask(img, L.mask, env) || new Float32Array(img.w * img.h).fill(1);
          const v = E.newImage(img.w, img.h, img); geom(v, img); v.r.set(m); v.g.set(m); v.b.set(m);
          return v;
        }
        const simple = !masked && L.opacity >= 1 && (L.blend || 'normal') === 'normal';
        if (simple) { const g0 = I.geomOf(img); img = op.run(img, p, env); if (img.fullW === undefined) Object.assign(img, g0); }
        else {
          const mask = masked ? computeMask(img, L.mask, env) : null;
          const out = op.run(E.cloneImage(img), p, env);
          blendInto(img, out, L.blend || 'normal', L.opacity, mask);
        }
      }
      if (opts.cache && store.cache) lruSet(store.cache, keys[i], E.cloneImage(img), opts.cacheSize || 10);
      if (opts.stopAfter === L.id) break;
    }
    I.clampAll(img);
    return img;
  }

  // ------------------------------------------------- validation of loaded projects ---
  // Projects/actions come from files: keep only well-formed layers of known operations and coerce
  // every field to its expected type, so a damaged or hand-edited file cannot break the editor.
  const isOp = (op) => typeof op === 'string' && Object.prototype.hasOwnProperty.call(OPS, op);
  const MASK_TYPES = ['none', 'paint', 'lum', 'hue', 'stars', 'nostars', 'signal', 'background', 'shape'];
  const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  function sanitizePts(pts) { return Array.isArray(pts) ? pts.filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, 20000).map((p) => [num(p[0], 0, -1, 2), num(p[1], 0, -1, 2)]) : []; }
  function sanitizeStrokes(st) {
    return Array.isArray(st) ? st.filter((s) => s && typeof s === 'object').slice(0, 2000).map((s) => ({ pts: sanitizePts(s.pts), r: num(s.r, 0.01, 1e-5, 1), hard: num(s.hard, 0.5, 0, 1), a: num(s.a, 1, 0, 1), mode: s.mode === 'hide' ? 'hide' : 'show' })).filter((s) => s.pts.length) : [];
  }
  function sanitizeParams(op, params) {
    const out = defaults(op), src = params && typeof params === 'object' ? params : {};
    for (const d of OPS[op].p) {
      const v = src[d.k];
      if (v === undefined) continue;
      switch (d.t) {
        case 'r': out[d.k] = num(v, d.d, d.min, d.max); break;
        case 'c': out[d.k] = !!v; break;
        case 's': if (d.o.some((o) => o[0] === v)) out[d.k] = v; break;
        case 'color': if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out[d.k] = v; break;
        case 'pick': out[d.k] = v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: num(v.x, 0.5, 0, 1), y: num(v.y, 0.5, 0, 1) } : null; break;
        case 'wav': if (Array.isArray(v)) out[d.k] = Array.from({ length: 6 }, (_, i) => num(v[i], 0, -1, 3)); break;
        case 'curves': if (v && typeof v === 'object') { const c = {}; for (const k of ['rgb', 'r', 'g', 'b']) { const p = sanitizePts(v[k]); if (p.length >= 2) c[k] = p.map(([x, y]) => [num(x, 0, 0, 1), num(y, 0, 0, 1)]); } out[d.k] = c; } break;
        case 'hsl': if (v && typeof v === 'object') { const h = {}; for (const k of Object.keys(v).slice(0, 8)) if (Array.isArray(v[k])) h[k] = [num(v[k][0], 0, -1, 1), num(v[k][1], 1, 0, 2.5), num(v[k][2], 0, -1, 1)]; out[d.k] = h; } break;
        default: break;
      }
    }
    // free-form params used by some ops
    if (op === 'heal') out.strokes = sanitizeStrokes(src.strokes);
    if (op === 'text') for (const k of ['text', 'sub', 'font', 'color', 'align']) if (typeof src[k] === 'string') out[k] = src[k].slice(0, 200);
    if (op === 'text') { for (const k of ['x', 'y']) out[k] = num(src[k], k === 'x' ? 0.05 : 0.9, 0, 1); out.size = num(src.size, 0.045, 0.005, 0.5); out.bold = src.bold !== false; out.shadow = src.shadow !== false; }
    return out;
  }
  function sanitizeLayers(list) {
    const layers = []; let dropped = 0;
    if (!Array.isArray(list)) return { layers, dropped: 0 };
    for (const l of list.slice(0, 200)) {
      if (!l || typeof l !== 'object' || !isOp(l.op)) { dropped++; continue; }
      const ly = newLayer(l.op, sanitizeParams(l.op, l.params));
      ly.on = l.on !== false;
      ly.opacity = num(l.opacity, 1, 0, 1);
      ly.blend = Object.prototype.hasOwnProperty.call(BLENDS, l.blend) ? l.blend : 'normal';
      if (typeof l.name === 'string' && l.name) ly.name = l.name.slice(0, 80);
      const m = l.mask && typeof l.mask === 'object' ? l.mask : {};
      ly.mask = {
        type: MASK_TYPES.includes(m.type) ? m.type : 'none', invert: !!m.invert, feather: num(m.feather, 0, 0, 2), density: num(m.density, 1, 0, 1),
        strokes: sanitizeStrokes(m.strokes), lo: num(m.lo, 0.5, 0, 1), hi: num(m.hi, 1, 0, 1.5), soft: num(m.soft, 0.1, 0.005, 0.5),
        hue: num(m.hue, 0, 0, 360), width: num(m.width, 40, 5, 120), size: num(m.size, 0.5, 0, 1), shapeFeather: num(m.shapeFeather, 0, 0, 0.2),
        shape: m.shape && typeof m.shape === 'object' && ['rect', 'ellipse'].includes(m.shape.kind) ? { kind: m.shape.kind, x: num(m.shape.x, 0, 0, 1), y: num(m.shape.y, 0, 0, 1), w: num(m.shape.w, 1, 0, 1), h: num(m.shape.h, 1, 0, 1) } : null,
      };
      layers.push(ly);
    }
    return { layers, dropped };
  }
  function sanitizeGeom(g, base) {
    const o = JSON.parse(JSON.stringify(base));
    if (!g || typeof g !== 'object') return o;
    o.rot = [0, 1, 2, 3].includes(g.rot) ? g.rot : 0; o.fh = !!g.fh; o.fv = !!g.fv; o.bin = !!g.bin;
    o.angle = num(g.angle, 0, -45, 45); o.scale = num(g.scale, 1, 0.1, 4);
    const c = g.crop;
    o.crop = c && typeof c === 'object' && [c.x, c.y, c.w, c.h].every(Number.isFinite) && c.w > 0.001 && c.h > 0.001 ? { x: num(c.x, 0, 0, 1), y: num(c.y, 0, 0, 1), w: num(c.w, 1, 0.001, 1), h: num(c.h, 1, 0.001, 1) } : null;
    return o;
  }

  const api = { OPS, GROUPS, BLENDS: Object.keys(BLENDS), defaults, newLayer, presetLayers, processStack, computeMask, inpaint, sanitizeLayers, sanitizeGeom };
  root.AstroOps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
