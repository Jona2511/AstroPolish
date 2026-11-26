/* AstroPolish - user interface */
(function () {
  'use strict';
  const E = window.AstroEngine, F = window.AstroFormats, t = window.I18N.t;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ processor ---
  // Web Worker when possible (keeps the interface smooth), otherwise in-page.
  function createProcessor() {
    let worker = null;
    try {
      if (location.protocol !== 'file:') worker = new Worker('js/worker.js');
    } catch (e) { worker = null; }
    const pending = new Map();
    let seq = 0;
    if (worker) {
      worker.onmessage = (e) => {
        const m = e.data;
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        if (m.cmd === 'error') p.reject(new Error(m.message)); else p.resolve(m);
      };
      worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'worker error')); pending.clear(); };
    }
    const local = {};
    return {
      call(msg, transfer) {
        msg.id = ++seq;
        if (worker) {
          return new Promise((resolve, reject) => { pending.set(msg.id, { resolve, reject }); worker.postMessage(msg, transfer || []); });
        }
        return new Promise((resolve, reject) => setTimeout(() => {
          try { const r = window.AstroCore.handle(local, msg).result; r.id = msg.id; resolve(r); } catch (err) { reject(err); }
        }, 16));
      },
      isWorker: !!worker,
    };
  }
  const proc = createProcessor();

  // ---------------------------------------------------------------- state ---
  const S = {
    original: null, fileName: '', rot: 0, fh: false, fv: false, crop: null,
    preset: 'auto', params: Object.assign({}, E.DEFAULTS), detected: null,
    src: null, // {w,h}
    prevW: 0, prevH: 0, beforeCanvas: document.createElement('canvas'), afterCanvas: document.createElement('canvas'),
    view: 'split', split: 0.5, zoom: 'fit', cx: 0, cy: 0, region: null, holdOriginal: false,
    previewBusy: false, previewQueued: false, regionTimer: 0, sourceToken: 0,
  };

  const PRESET_LIST = [
    ['auto', '✨'], ['nebula', '🌫️'], ['galaxy', '🌀'], ['cluster', '💫'], ['milkyway', '🌌'], ['bright', '🔆'],
    ['natural', '🍃'], ['mono', '◐'], ['moon', '🌕'], ['moonColour', '🌈'], ['sun', '☀️'], ['planet', '🪐'],
  ];

  // slider definitions: key, min, max, step, group
  const ADV = [
    ['g_prep', [
      ['autoCrop', 'check'], ['hotPixels', 'check'], ['gradient', 0, 1, 0.01],
      ['gradientDegree', 'select', [[1, 'deg1'], [2, 'deg2'], [3, 'deg3'], [4, 'deg4']]],
    ]],
    ['g_light', [
      ['stretchMode', 'select', [['auto', 'mode_auto'], ['levels', 'mode_levels']]],
      ['brightness', 0.06, 0.42, 0.005], ['blackPoint', 0, 1, 0.01], ['colorPreserve', 0, 1, 0.01],
      ['highlightProtect', 0, 1, 0.01], ['contrast', -0.3, 0.5, 0.01],
    ]],
    ['g_colour', [
      ['neutralize', 'check'], ['whiteBalance', 0, 1, 0.01], ['temperature', -1, 1, 0.01], ['tint', -1, 1, 0.01],
      ['saturation', 0, 3.5, 0.01], ['vibrance', 0, 1, 0.01], ['scnr', 0, 1, 0.01], ['mono', 'check'],
    ]],
    ['g_detail', [
      ['denoise', 0, 1, 0.01], ['chromaDenoise', 0, 1, 0.01], ['starReduce', 0, 1, 0.01],
      ['localContrast', 0, 1, 0.01], ['sharpen', 0, 1, 0.01],
    ]],
  ];
  // quick sliders map 0..100 onto one or more params
  const QUICK = [
    ['q_brightness', (p) => (p.brightness - 0.06) / 0.36, (v, p) => { p.brightness = 0.06 + v * 0.36; }],
    ['q_colour', (p) => p.saturation / 3, (v, p) => { p.saturation = v * 3; }],
    ['q_noise', (p) => p.denoise, (v, p) => { p.denoise = v; p.chromaDenoise = Math.min(1, v + 0.15); }],
    ['q_detail', (p) => p.localContrast, (v, p) => { p.localContrast = v; p.sharpen = v * 0.8; }],
    ['q_stars', (p) => p.starReduce, (v, p) => { p.starReduce = v; }],
  ];

  // ------------------------------------------------------------- helpers ---
  function toast(msg, ms) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), ms || 3500);
  }
  function overlay(text) {
    if (text) { $('overlayText').textContent = text; $('overlay').classList.remove('hidden'); }
    else $('overlay').classList.add('hidden');
  }
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  function baseName(n) { return (n || 'astrofoto').replace(/\.[^.]+$/, ''); }

  // ------------------------------------------------------------- loading ---
  async function decodeFile(file) {
    const name = file.name || '';
    const ext = name.split('.').pop().toLowerCase();
    if (['fit', 'fits', 'fts'].includes(ext)) return F.readFITS(await file.arrayBuffer());
    if (['tif', 'tiff'].includes(ext)) return await F.readTIFF(await file.arrayBuffer());
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bmp = await createImageBitmap(file); }
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const img = E.fromRGBA(d, c.width, c.height);
    img.meta.format = ext.toUpperCase();
    return img;
  }

  async function openFile(file) {
    overlay(t('loading'));
    await nextFrame();
    try {
      const img = await decodeFile(file);
      await setOriginal(img, file.name);
    } catch (e) {
      console.error(e);
      overlay(null);
      toast(t('loadError', { msg: e.message || e }), 6000);
    }
  }

  async function openDemo() {
    overlay(t('makingDemo'));
    await nextFrame();
    const img = E.makeDemo(1920, 1080, 7);
    await setOriginal(img, 'Voorbeeld_nevel.fits');
  }

  async function setOriginal(img, fileName) {
    S.original = img; S.fileName = fileName; S.rot = 0; S.fh = false; S.fv = false;
    S.preset = 'auto';
    S.crop = E.detectAutoCrop(img);
    $('welcome').classList.add('hidden'); $('editor').classList.remove('hidden');
    $('btnNew').classList.remove('hidden'); $('btnBatch').classList.remove('hidden');
    S.zoom = 'fit'; setSeg('[data-zoom]', 'fit');
    await sendSource(true);
    overlay(null);
    if (!sessionStorageGet('hintSeen')) { $('hint').classList.add('show'); setTimeout(() => $('hint').classList.remove('show'), 6000); sessionStorageSet('hintSeen', 1); }
  }
  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  function buildSource() {
    let img = S.original;
    if (S.params.autoCrop && S.crop) img = E.cropImage(img, S.crop.x, S.crop.y, S.crop.x2 - S.crop.x, S.crop.y2 - S.crop.y);
    else img = E.cloneImage(img);
    for (let i = 0; i < S.rot; i++) img = E.rotate90(img);
    if (S.fh) E.flipH(img);
    if (S.fv) E.flipV(img);
    img.meta = S.original.meta;
    return img;
  }

  async function sendSource(applyPreset) {
    const token = ++S.sourceToken;
    const img = buildSource();
    const res = await proc.call({ cmd: 'source', img: { w: img.w, h: img.h, r: img.r, g: img.g, b: img.b, mono: img.mono, meta: img.meta }, fileName: S.fileName }, [img.r.buffer, img.g.buffer, img.b.buffer]);
    if (token !== S.sourceToken) return;
    S.src = { w: res.w, h: res.h }; S.prevW = res.pw; S.prevH = res.ph;
    S.detected = res.detected;
    putCanvas(S.beforeCanvas, res.before, res.pw, res.ph);
    S.afterCanvas.width = res.pw; S.afterCanvas.height = res.ph;
    S.afterCanvas.getContext('2d').drawImage(S.beforeCanvas, 0, 0);
    S.region = null; S.cx = res.w / 2; S.cy = res.h / 2;
    $('fileInfo').textContent = `${S.fileName} · ${res.w}×${res.h}`;
    if (applyPreset) choosePreset(S.preset, true);
    else requestPreview();
    draw();
  }

  function putCanvas(canvas, rgba, w, h) {
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
  }

  // ------------------------------------------------------------- presets ---
  function buildPresets() {
    const box = $('presets'); box.innerHTML = '';
    for (const [key, icon] of PRESET_LIST) {
      const b = document.createElement('button');
      b.className = 'preset' + (key === 'auto' ? ' featured' : '');
      b.dataset.preset = key;
      b.innerHTML = `<span class="pi">${icon}</span><span class="pt"><b>${t('p_' + key)}</b><small>${t('p_' + key + '_d')}</small></span>`;
      b.onclick = () => choosePreset(key);
      box.appendChild(b);
    }
    markPreset();
  }
  function markPreset() {
    document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('on', b.dataset.preset === S.preset));
  }

  function choosePreset(key, fromLoad) {
    const prevCrop = S.params.autoCrop;
    S.preset = key;
    // automatic detection needs only metadata + preview pixels (done in worker)
    let params;
    if (key === 'auto') {
      const det = S.detected || { type: 'nebula', fallback: true };
      const base = E.PRESETS[det.type] || E.PRESETS.nebula;
      params = Object.assign({}, E.DEFAULTS, base);
      if (det.fallback) { params.starReduce = 0.2; params.saturation = 1.4; params.brightness = 0.23; }
    } else params = Object.assign({}, E.DEFAULTS, E.PRESETS[key]);
    S.params = params;
    markPreset(); syncControls(); showDetected();
    // the source was built with the previous crop setting: rebuild it when that changes
    if (S.original && S.crop && params.autoCrop !== prevCrop) { sendSource(false); return; }
    requestPreview();
  }

  function showDetected() {
    const el = $('detected');
    if (S.preset !== 'auto' || !S.detected) { el.textContent = ''; return; }
    if (S.detected.fallback) { el.textContent = t('detectedNone'); return; }
    const lbl = S.detected.label && /^M\d+$/i.test(S.detected.label) ? ` (${S.detected.label})` : '';
    el.textContent = t('detected', { type: t('t_' + S.detected.type) + lbl });
  }

  // ------------------------------------------------------------ controls ---
  const controls = {};
  function buildControls() {
    const q = $('quick'); q.innerHTML = '';
    QUICK.forEach(([key, get, set], i) => {
      const row = document.createElement('label'); row.className = 'slider';
      row.innerHTML = `<span class="sl-name">${t(key)}</span><input type="range" min="0" max="1000" step="1"><span class="sl-val"></span>`;
      const inp = row.querySelector('input');
      inp.oninput = () => { set(inp.value / 1000, S.params); row.querySelector('.sl-val').textContent = Math.round(inp.value / 10); syncControls(); requestPreview(); };
      inp.ondblclick = () => { choosePresetValueReset(); };
      controls['quick' + i] = { el: inp, val: row.querySelector('.sl-val'), get };
      q.appendChild(row);
    });
    const adv = $('advancedBody'); adv.innerHTML = '';
    for (const [group, items] of ADV) {
      const h = document.createElement('h4'); h.textContent = t(group); adv.appendChild(h);
      for (const it of items) {
        const [key, type] = it;
        const row = document.createElement('label');
        if (type === 'check') {
          row.className = 'check';
          row.innerHTML = `<input type="checkbox"><span>${t('s_' + key)}</span>`;
          const inp = row.querySelector('input');
          inp.onchange = () => {
            S.params[key] = inp.checked;
            if (key === 'autoCrop') sendSource(false); else requestPreview();
          };
          controls[key] = { el: inp, type };
        } else if (type === 'select') {
          row.className = 'select';
          row.innerHTML = `<span class="sl-name">${t('s_' + key)}</span><select>${it[2].map(([v, l]) => `<option value="${v}">${t(l)}</option>`).join('')}</select>`;
          const inp = row.querySelector('select');
          inp.onchange = () => { const v = inp.value; S.params[key] = isNaN(+v) ? v : +v; requestPreview(); };
          controls[key] = { el: inp, type };
        } else {
          const [, mn, mx, st] = it;
          row.className = 'slider';
          row.innerHTML = `<span class="sl-name">${t('s_' + key)}</span><input type="range" min="${mn}" max="${mx}" step="${st}"><span class="sl-val"></span>`;
          const inp = row.querySelector('input');
          inp.oninput = () => { S.params[key] = +inp.value; syncControls(); requestPreview(); };
          controls[key] = { el: inp, type: 'range', val: row.querySelector('.sl-val'), mn: +mn, mx: +mx };
        }
        adv.appendChild(row);
      }
    }
    syncControls();
  }
  function choosePresetValueReset() { choosePreset(S.preset); }

  function syncControls() {
    for (const k in controls) {
      const c = controls[k];
      if (k.startsWith('quick')) {
        const v = Math.max(0, Math.min(1, c.get(S.params)));
        if (document.activeElement !== c.el) c.el.value = Math.round(v * 1000);
        c.val.textContent = Math.round(v * 100);
        continue;
      }
      const v = S.params[k];
      if (c.type === 'check') c.el.checked = !!v;
      else if (c.type === 'select') c.el.value = String(v);
      else {
        if (document.activeElement !== c.el) c.el.value = v;
        c.val.textContent = c.mn < 0 ? (v > 0 ? '+' : '') + Math.round(v * 100) : (c.mx > 1.5 ? v.toFixed(2) : Math.round(v * 100));
      }
    }
  }

  // ------------------------------------------------------------- preview ---
  async function requestPreview() {
    if (!S.src) return;
    if (S.previewBusy) { S.previewQueued = true; return; }
    S.previewBusy = true; $('busy').classList.remove('hidden');
    try {
      do {
        S.previewQueued = false;
        const token = S.sourceToken;
        const res = await proc.call({ cmd: 'preview', params: Object.assign({}, S.params) });
        if (token !== S.sourceToken) continue;
        putCanvas(S.afterCanvas, res.rgba, res.w, res.h);
        drawHist(res.hist);
        S.region = null;
        draw();
      } while (S.previewQueued);
    } catch (e) { console.error(e); toast(String(e.message || e)); }
    S.previewBusy = false;
    if (S.zoom !== 'fit') scheduleRegion(10); else $('busy').classList.add('hidden');
  }

  function drawHist(H) {
    const c = $('hist'), g = c.getContext('2d');
    const w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    let mx = 1;
    for (const k of ['r', 'g', 'b']) for (let i = 2; i < 254; i++) mx = Math.max(mx, H[k][i]);
    g.globalCompositeOperation = 'lighter';
    const cols = { r: 'rgba(255,90,90,.75)', g: 'rgba(90,220,120,.7)', b: 'rgba(90,140,255,.8)' };
    for (const k of ['r', 'g', 'b']) {
      g.fillStyle = cols[k]; g.beginPath(); g.moveTo(0, h);
      for (let i = 0; i < 256; i++) g.lineTo(i / 255 * w, h - Math.min(1, H[k][i] / mx) * (h - 2));
      g.lineTo(w, h); g.closePath(); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------- view ---
  const view = $('view'), stage = $('stage');
  function fitScale() {
    const W = stage.clientWidth, H = stage.clientHeight;
    return Math.min(W / S.src.w, H / S.src.h);
  }
  // returns mapping from full-res source coords to css pixels
  function mapping() {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (S.zoom === 'fit') {
      const s = fitScale();
      return { s, ox: (W - S.src.w * s) / 2, oy: (H - S.src.h * s) / 2 };
    }
    const s = S.zoom / (window.devicePixelRatio || 1);
    return { s, ox: W / 2 - S.cx * s, oy: H / 2 - S.cy * s };
  }
  function clampCenter() {
    const m = { s: S.zoom / (window.devicePixelRatio || 1) };
    const hw = stage.clientWidth / 2 / m.s, hh = stage.clientHeight / 2 / m.s;
    S.cx = S.src.w <= hw * 2 ? S.src.w / 2 : Math.max(hw, Math.min(S.src.w - hw, S.cx));
    S.cy = S.src.h <= hh * 2 ? S.src.h / 2 : Math.max(hh, Math.min(S.src.h - hh, S.cy));
  }

  function draw() {
    if (!S.src) return;
    const dpr = window.devicePixelRatio || 1;
    const W = stage.clientWidth, H = stage.clientHeight;
    if (view.width !== Math.round(W * dpr) || view.height !== Math.round(H * dpr)) { view.width = Math.round(W * dpr); view.height = Math.round(H * dpr); }
    const g = view.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const m = mapping();
    const dw = S.src.w * m.s, dh = S.src.h * m.s;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const mode = S.holdOriginal ? 'before' : S.view;
    const splitX = mode === 'split' ? Math.max(0, Math.min(W, S.split * W)) : mode === 'after' ? 0 : W;

    const paint = (which, clipX0, clipX1) => {
      if (clipX1 <= clipX0) return;
      g.save(); g.beginPath(); g.rect(clipX0, 0, clipX1 - clipX0, H); g.clip();
      g.drawImage(which === 'before' ? S.beforeCanvas : S.afterCanvas, m.ox, m.oy, dw, dh);
      const R = S.region;
      if (R && S.zoom !== 'fit') {
        const c = which === 'before' ? R.beforeCanvas : R.afterCanvas;
        g.imageSmoothingEnabled = S.zoom < 1;
        g.drawImage(c, m.ox + R.rect.x * m.s, m.oy + R.rect.y * m.s, R.rect.w * m.s, R.rect.h * m.s);
      }
      g.restore();
    };
    paint('before', 0, splitX);
    paint('after', splitX, W);
    if (mode === 'split') {
      g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(splitX - 1, 0, 2, H);
      g.beginPath(); g.arc(splitX, H / 2, 16, 0, Math.PI * 2); g.fillStyle = 'rgba(15,16,30,.85)'; g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#fff'; g.beginPath();
      g.moveTo(splitX - 9, H / 2); g.lineTo(splitX - 3, H / 2 - 5); g.lineTo(splitX - 3, H / 2 + 5); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(splitX + 9, H / 2); g.lineTo(splitX + 3, H / 2 - 5); g.lineTo(splitX + 3, H / 2 + 5); g.closePath(); g.fill();
    }
    $('tagBefore').style.display = mode === 'after' ? 'none' : '';
    $('tagAfter').style.display = mode === 'before' ? 'none' : '';
  }

  function scheduleRegion(delay) {
    clearTimeout(S.regionTimer);
    S.regionTimer = setTimeout(loadRegion, delay || 250);
  }
  async function loadRegion() {
    if (!S.src || S.zoom === 'fit') return;
    if (S.previewBusy) { scheduleRegion(200); return; }
    const m = mapping();
    const W = stage.clientWidth, H = stage.clientHeight;
    let x = Math.floor(-m.ox / m.s), y = Math.floor(-m.oy / m.s);
    let w = Math.ceil(W / m.s), h = Math.ceil(H / m.s);
    x = Math.max(0, x); y = Math.max(0, y); w = Math.min(S.src.w - x, w); h = Math.min(S.src.h - y, h);
    if (w < 2 || h < 2) return;
    const rect = { x, y, w, h };
    $('busy').classList.remove('hidden');
    const token = S.sourceToken;
    const key = JSON.stringify(S.params);
    try {
      const res = await proc.call({ cmd: 'region', params: Object.assign({}, S.params), rect });
      if (token !== S.sourceToken || key !== JSON.stringify(S.params) || S.zoom === 'fit') { $('busy').classList.add('hidden'); return; }
      const a = document.createElement('canvas'), b = document.createElement('canvas');
      putCanvas(a, res.rgba, res.w, res.h); putCanvas(b, res.before, res.w, res.h);
      S.region = { rect: res.rect, afterCanvas: a, beforeCanvas: b };
      draw();
    } catch (e) { console.error(e); }
    $('busy').classList.add('hidden');
  }

  function setSeg(sel, val) {
    document.querySelectorAll(sel).forEach((b) => b.classList.toggle('on', (b.dataset.view || b.dataset.zoom) === String(val)));
  }

  // pointer interaction: split handle or panning
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (!S.src) return;
    const r = stage.getBoundingClientRect();
    const x = e.clientX - r.left;
    const nearSplit = S.view === 'split' && Math.abs(x - S.split * r.width) < 28;
    if (nearSplit || (S.view === 'split' && S.zoom === 'fit')) { drag = { type: 'split' }; S.split = x / r.width; draw(); }
    else if (S.zoom !== 'fit') drag = { type: 'pan', x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy };
    if (drag) { stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = stage.getBoundingClientRect();
    if (drag.type === 'split') { S.split = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); draw(); }
    else {
      const s = mapping().s;
      S.cx = drag.cx - (e.clientX - drag.x) / s; S.cy = drag.cy - (e.clientY - drag.y) / s;
      clampCenter(); draw();
    }
  });
  const endDrag = () => { if (drag && drag.type === 'pan') scheduleRegion(150); drag = null; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', (e) => {
    if (!S.src) return;
    const r = stage.getBoundingClientRect();
    const m = mapping();
    if (S.zoom === 'fit') {
      S.cx = (e.clientX - r.left - m.ox) / m.s; S.cy = (e.clientY - r.top - m.oy) / m.s;
      setZoom(1);
    } else setZoom('fit');
  });
  stage.addEventListener('wheel', (e) => {
    if (!S.src) return;
    e.preventDefault();
    if (e.deltaY < 0 && S.zoom === 'fit') {
      const r = stage.getBoundingClientRect(), m = mapping();
      S.cx = (e.clientX - r.left - m.ox) / m.s; S.cy = (e.clientY - r.top - m.oy) / m.s; setZoom(1);
    } else if (e.deltaY > 0 && S.zoom !== 'fit') setZoom('fit');
  }, { passive: false });

  function setZoom(z) {
    S.zoom = z === 'fit' ? 'fit' : +z;
    setSeg('[data-zoom]', z);
    S.region = null;
    if (S.zoom !== 'fit') { clampCenter(); scheduleRegion(10); }
    draw();
  }

  // ---------------------------------------------------------------- save ---
  async function renderFull(format) {
    const res = await proc.call({ cmd: 'full', params: Object.assign({}, S.params), format: format === 'tif' ? 'rgb16' : 'rgba' });
    if (format === 'tif') return new Blob([F.writeTIFF16(res.data, res.w, res.h)], { type: 'image/tiff' });
    const c = document.createElement('canvas');
    putCanvas(c, res.data, res.w, res.h);
    return await new Promise((r) => c.toBlob(r, format === 'png' ? 'image/png' : 'image/jpeg', 0.95));
  }

  async function saveBlob(blob, name) {
    const types = {
      jpg: { description: 'JPEG', accept: { 'image/jpeg': ['.jpg'] } },
      png: { description: 'PNG', accept: { 'image/png': ['.png'] } },
      tif: { description: 'TIFF', accept: { 'image/tiff': ['.tif'] } },
    };
    const ext = name.split('.').pop();
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name, types: [types[ext]] });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        return h.name;
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return name;
  }

  async function save() {
    if (!S.src) return;
    const fmt = $('format').value;
    overlay(t('processing'));
    try {
      await nextFrame();
      const blob = await renderFull(fmt);
      overlay(null);
      const saved = await saveBlob(blob, `${baseName(S.fileName)}_astropolish.${fmt}`);
      if (saved) toast(t('saved', { name: saved }));
    } catch (e) { console.error(e); overlay(null); toast(String(e.message || e), 6000); }
  }

  // --------------------------------------------------------------- batch ---
  let batchFiles = [];
  function openBatch() { batchFiles = []; renderBatch(); $('batchDlg').showModal(); }
  function renderBatch() {
    const ul = $('batchList'); ul.innerHTML = '';
    batchFiles.forEach((f) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(f.file.name)}</span><em class="st-${f.status}">${t('batch' + f.status[0].toUpperCase() + f.status.slice(1))}</em>`;
      ul.appendChild(li);
    });
    $('batchStart').disabled = !batchFiles.length || batchFiles.every((f) => f.status !== 'waiting');
  }
  function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  async function runBatch() {
    const fmt = $('format').value;
    let dir = null;
    if (window.showDirectoryPicker) {
      try { toast(t('batchFolder')); dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e && e.name === 'AbortError') return; dir = null; }
    }
    $('batchStart').disabled = true;
    const keepPreset = S.preset, keepParams = Object.assign({}, S.params);
    const keep = { original: S.original, fileName: S.fileName, rot: S.rot, fh: S.fh, fv: S.fv, crop: S.crop, detected: S.detected };
    let done = 0;
    for (const f of batchFiles) {
      if (f.status !== 'waiting') continue;
      f.status = 'busy'; renderBatch();
      try {
        const img = await decodeFile(f.file);
        S.original = img; S.fileName = f.file.name; S.rot = 0; S.fh = keep.fh; S.fv = keep.fv;
        S.crop = E.detectAutoCrop(img);
        S.params = Object.assign({}, keepParams);
        if (keepPreset === 'auto') {
          await sendSource(false);
          const det = S.detected || { type: 'nebula', fallback: true };
          S.params = Object.assign({}, E.DEFAULTS, E.PRESETS[det.type] || E.PRESETS.nebula);
        }
        await sendSource(false);
        const blob = await renderFull(fmt);
        const name = `${baseName(f.file.name)}_astropolish.${fmt}`;
        if (dir) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); }
        else await saveBlob(blob, name);
        f.status = 'done'; done++;
      } catch (e) { console.error(e); f.status = 'error'; }
      renderBatch();
    }
    // restore the photo that was open
    Object.assign(S, keep); S.preset = keepPreset; S.params = keepParams;
    if (S.original) await sendSource(false);
    syncControls(); markPreset(); showDetected();
    toast(t('batchAllDone', { n: done }), 5000);
  }

  // ----------------------------------------------------------------- i18n ---
  function applyLang() {
    document.documentElement.lang = window.I18N.getLang();
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === window.I18N.getLang()));
    $('helpBody').innerHTML = t('help');
    buildPresets(); buildControls(); showDetected();
  }

  // ---------------------------------------------------------------- wire up ---
  function init() {
    applyLang();
    document.querySelectorAll('[data-lang]').forEach((b) => b.onclick = () => { window.I18N.setLang(b.dataset.lang); applyLang(); });
    $('fileInput').onchange = (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; };
    $('btnDemo').onclick = openDemo;
    $('btnNew').onclick = () => $('fileInput').click();
    $('btnHelp').onclick = () => $('helpDlg').showModal();
    $('helpClose').onclick = () => $('helpDlg').close();
    $('btnSave').onclick = save;
    $('btnReset').onclick = () => choosePreset(S.preset);
    $('btnBatch').onclick = openBatch;
    $('batchClose').onclick = () => $('batchDlg').close();
    $('batchInput').onchange = (e) => {
      for (const f of e.target.files) batchFiles.push({ file: f, status: 'waiting' });
      e.target.value = ''; renderBatch();
    };
    $('batchStart').onclick = runBatch;
    document.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => { S.view = b.dataset.view; setSeg('[data-view]', S.view); draw(); });
    document.querySelectorAll('[data-zoom]').forEach((b) => b.onclick = () => setZoom(b.dataset.zoom));
    $('btnRot').onclick = () => { S.rot = (S.rot + 1) % 4; sendSource(false); };
    $('btnFlipH').onclick = () => { S.fh = !S.fh; sendSource(false); };
    $('btnFlipV').onclick = () => { S.fv = !S.fv; sendSource(false); };

    // drag & drop anywhere
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragover'); });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragover'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragover');
      const files = [...(e.dataTransfer.files || [])];
      if (!files.length) return;
      if ($('batchDlg').open) { files.forEach((f) => batchFiles.push({ file: f, status: 'waiting' })); renderBatch(); return; }
      openFile(files[0]);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && S.src && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); if (!S.holdOriginal) { S.holdOriginal = true; draw(); } }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); $('fileInput').click(); }
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space' && S.holdOriginal) { S.holdOriginal = false; draw(); } });
    window.addEventListener('resize', () => { draw(); if (S.zoom !== 'fit') { clampCenter(); scheduleRegion(); } });
  }

  init();
  // exposed for automated tests
  window.AstroApp = { S, openDemo, choosePreset, save, renderFull, setZoom, isWorker: proc.isWorker };
})();
