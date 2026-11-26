/*
 * AstroPolish - combine several stacked images (e.g. multiple nights).
 * Star detection -> triangle matching -> similarity transform (shift, rotation,
 * scale) with RANSAC -> warp -> normalised average.
 */
(function (root) {
  'use strict';
  const E = root.AstroEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  function findStars(img) {
    const small = E.downscale(img, 1600);
    const f = img.w / small.w;
    const stars = E.detectStars(small, null, 60, 10);
    return stars.map((s) => ({ x: (s.x + 0.5) * f - 0.5, y: (s.y + 0.5) * f - 0.5, flux: s.flux }));
  }

  function triangles(stars, n) {
    const P = stars.slice(0, n);
    const out = [];
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) for (let k = j + 1; k < P.length; k++) {
      const idx = [i, j, k];
      // side opposite to each vertex
      const sides = [[d(P[j], P[k]), i], [d(P[i], P[k]), j], [d(P[i], P[j]), k]].sort((a, b) => a[0] - b[0]);
      if (sides[2][0] < 10) continue;
      out.push({ u: sides[0][0] / sides[2][0], v: sides[1][0] / sides[2][0], verts: [sides[0][1], sides[1][1], sides[2][1]], idx });
    }
    return out;
  }

  function fitSimilarity(pairs) {
    // x_a = a*x_b - b*y_b + tx ; y_a = b*x_b + a*y_b + ty  (least squares)
    let n = pairs.length;
    if (n < 2) return null;
    let sxb = 0, syb = 0, sxa = 0, sya = 0;
    for (const [A, B] of pairs) { sxa += A.x; sya += A.y; sxb += B.x; syb += B.y; }
    sxa /= n; sya /= n; sxb /= n; syb /= n;
    let num1 = 0, num2 = 0, den = 0;
    for (const [A, B] of pairs) {
      const xb = B.x - sxb, yb = B.y - syb, xa = A.x - sxa, ya = A.y - sya;
      num1 += xb * xa + yb * ya; num2 += xb * ya - yb * xa; den += xb * xb + yb * yb;
    }
    if (den <= 0) return null;
    const a = num1 / den, b = num2 / den;
    return { a, b, tx: sxa - a * sxb + b * syb, ty: sya - b * sxb - a * syb };
  }
  const apply = (T, p) => ({ x: T.a * p.x - T.b * p.y + T.tx, y: T.b * p.x + T.a * p.y + T.ty });

  function match(refStars, stars) {
    const tA = triangles(refStars, 18), tB = triangles(stars, 18);
    const votes = new Map();
    for (const a of tA) {
      let best = null, bd = 0.008;
      for (const b of tB) { const dd = Math.abs(a.u - b.u) + Math.abs(a.v - b.v); if (dd < bd) { bd = dd; best = b; } }
      if (!best) continue;
      for (let q = 0; q < 3; q++) {
        const key = a.verts[q] + ':' + best.verts[q];
        votes.set(key, (votes.get(key) || 0) + 1);
      }
    }
    const cands = [...votes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 40).map(([k]) => { const [i, j] = k.split(':').map(Number); return [refStars[i], stars[j]]; });
    if (cands.length < 3) return null;
    let bestT = null, bestIn = [];
    let seed = 1;
    const rnd = (n) => { seed = (seed * 16807) % 2147483647; return seed % n; };
    for (let it = 0; it < 400; it++) {
      const p1 = cands[rnd(cands.length)], p2 = cands[rnd(cands.length)];
      if (p1 === p2) continue;
      const T = fitSimilarity([p1, p2]);
      if (!T) continue;
      const sc = Math.hypot(T.a, T.b);
      if (sc < 0.8 || sc > 1.25) continue;
      const inl = cands.filter(([A, B]) => { const q = apply(T, B); return Math.hypot(q.x - A.x, q.y - A.y) < 4; });
      if (inl.length > bestIn.length) { bestIn = inl; bestT = T; }
    }
    if (bestIn.length < 3) return null;
    // refine using all detected stars close to their predicted position
    let T = fitSimilarity(bestIn);
    const pairs = [];
    for (const B of stars) {
      const q = apply(T, B);
      let best = null, bd = 3;
      for (const A of refStars) { const dd = Math.hypot(q.x - A.x, q.y - A.y); if (dd < bd) { bd = dd; best = A; } }
      if (best) pairs.push([best, B]);
    }
    if (pairs.length >= 4) T = fitSimilarity(pairs) || T;
    T.matches = Math.max(bestIn.length, pairs.length);
    return T;
  }

  function add(state, img) {
    const stars = findStars(img);
    const st = state.stack;
    const meds = {}, mads = {};
    for (const c of ['r', 'g', 'b']) { const m = E.medMad(img[c]); meds[c] = m.med; mads[c] = Math.max(1e-6, m.mad); }
    if (!st.ref) {
      const n = img.w * img.h;
      st.ref = { w: img.w, h: img.h, stars, meds, mads, meta: img.meta, mono: img.mono };
      st.sum = { r: new Float32Array(img.r), g: new Float32Array(img.g), b: new Float32Array(img.b) };
      st.cnt = new Uint16Array(n).fill(1);
      st.n = 1;
      return { ok: true, stars: stars.length, matches: stars.length, shift: [0, 0], rot: 0 };
    }
    const T = match(st.ref.stars, stars);
    if (!T) return { ok: false, stars: stars.length };
    // inverse transform: ref -> target
    const s2 = T.a * T.a + T.b * T.b;
    const ia = T.a / s2, ib = -T.b / s2;
    const itx = -(ia * T.tx - ib * T.ty), ity = -(ib * T.tx + ia * T.ty);
    const { w, h } = st.ref;
    for (const c of ['r', 'g', 'b']) {
      const k = st.ref.mads[c] / mads[c];
      const src = img[c], sum = st.sum[c];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const sx = ia * x - ib * y + itx, sy = ib * x + ia * y + ity;
        const v = E.sampleBilinear(src, img.w, img.h, sx, sy);
        if (v < 0) continue;
        const i = y * w + x;
        sum[i] += (v - meds[c]) * k + st.ref.meds[c];
        if (c === 'r') st.cnt[i]++;
      }
    }
    st.n++;
    return { ok: true, stars: stars.length, matches: T.matches, shift: [Math.round(T.tx), Math.round(T.ty)], rot: Math.round(Math.atan2(T.b, T.a) * 1800 / Math.PI) / 10 };
  }

  function finish(state) {
    const st = state.stack;
    if (!st.ref) return null;
    const { w, h } = st.ref;
    const out = { w, h, r: new Float32Array(w * h), g: new Float32Array(w * h), b: new Float32Array(w * h), mono: st.ref.mono, meta: Object.assign({}, st.ref.meta, { stacked: st.n }) };
    const need = Math.max(1, Math.ceil(st.n * 0.6));
    for (let i = 0; i < w * h; i++) {
      const c = st.cnt[i];
      if (c < need) { out.r[i] = out.g[i] = out.b[i] = 0; continue; }
      out.r[i] = Math.max(0, st.sum.r[i] / c); out.g[i] = Math.max(0, st.sum.g[i] / c); out.b[i] = Math.max(0, st.sum.b[i] / c);
    }
    state.stack = {};
    return out;
  }

  const api = { add, finish, match, findStars };
  root.AstroStack = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
