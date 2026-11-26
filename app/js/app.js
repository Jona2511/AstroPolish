/* AstroPolish - user interface (v2) */
(function () {
  'use strict';
  const E = window.AstroEngine, F = window.AstroFormats, t = window.I18N.t;
  const $ = (id) => document.getElementById(id);
  const L = (nl, en) => (window.I18N.getLang() === 'en' ? en : nl);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ap-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ap-' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };

  // ------------------------------------------------------------ processor ---
  function createProcessor() {
    let worker = null;
    try { if (location.protocol !== 'file:') worker = new Worker('js/worker.js'); } catch (e) { worker = null; }
    const pending = new Map();
    let seq = 0;
    if (worker) {
      worker.onmessage = (e) => {
        const m = e.data, p = pending.get(m.id);
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
        if (worker) return new Promise((resolve, reject) => { pending.set(msg.id, { resolve, reject }); worker.postMessage(msg, transfer || []); });
        return new Promise((resolve, reject) => setTimeout(() => {
          try { const r = window.AstroCore.handle(local, msg).result; r.id = msg.id; resolve(r); } catch (err) { reject(err); }
        }, 16));
      },
      isWorker: !!worker,
    };
  }
  const proc = createProcessor();

  // ---------------------------------------------------------------- state ---
  const GEOM0 = { rot: 0, fh: false, fv: false, angle: 0, crop: null, bin: false };
  const OVERLAY0 = { on: false, title: '', sub: '', pos: 'br', size: 1, opacity: 0.85, color: '#ffffff' };
  const S = {
    original: null, fileName: '', autoCropRect: null, geom: Object.assign({}, GEOM0), overlay: Object.assign({}, OVERLAY0),
    preset: 'auto', params: Object.assign({}, E.DEFAULTS), detected: null, analysis: null,
    src: null, prevW: 0, prevH: 0,
    beforeCanvas: document.createElement('canvas'), afterCanvas: document.createElement('canvas'), snapCanvas: document.createElement('canvas'), clipCanvas: null,
    afterData: null, hist: null, histLog: false,
    view: 'split', split: 0.5, zoom: 'fit', cx: 0, cy: 0, region: null, holdOriginal: false,
    previewBusy: false, previewQueued: false, regionTimer: 0, sourceToken: 0,
    tool: null, cropRect: null, cropAspect: 0, snapParams: null,
    tab: 'style', history: [], hIndex: -1, histTimer: 0, restoring: false,
  };

  // ------------------------------------------------------------ presets ---
  const PRESET_GROUPS = [
    [L('Deep-sky', 'Deep sky'), [
      ['auto', '✨', 'Automatisch', 'Automatic', 'Beste keuze voor jouw foto', 'Best choice for your photo'],
      ['nebula', '🌫️', 'Nevel', 'Nebula', 'Orion, Lagune, Hart…', 'Orion, Lagoon, Heart…'],
      ['galaxy', '🌀', 'Sterrenstelsel', 'Galaxy', 'Andromeda, M81, M51…', 'Andromeda, M81, M51…'],
      ['cluster', '💫', 'Sterrenhoop', 'Star cluster', 'Plejaden, M13…', 'Pleiades, M13…'],
      ['milkyway', '🌌', 'Melkweg / breed', 'Milky Way / wide', 'Groothoekcamera', 'Wide-angle camera'],
      ['bright', '🔆', 'Maximaal helder', 'Maximum bright', 'Zo veel mogelijk zichtbaar', 'Show as much as possible'],
      ['natural', '🍃', 'Natuurlijk', 'Natural', 'Rustig en subtiel', 'Calm and subtle'],
      ['starless', '🌁', 'Zonder sterren', 'Starless', 'Alleen de nevel', 'Only the nebula'],
      ['spikes', '✳️', 'Star spikes', 'Star spikes', 'Kruisjes op felle sterren', 'Crosses on bright stars'],
      ['dreamy', '💜', 'Dromerig', 'Dreamy', 'Zachte gloed', 'Soft glow'],
      ['mono', '◐', 'Zwart-wit', 'Black & white', 'Klassiek en strak', 'Classic and clean'],
    ]],
    [L('Duoband-filter (Ha/OIII)', 'Dual-band filter (Ha/OIII)'), [
      ['hoo', '🔴', 'HOO', 'HOO', 'Rood + blauwgroen', 'Red + teal'],
      ['foraxx', '🟠', 'Foraxx', 'Foraxx', 'Goud + blauwgroen', 'Gold + teal'],
      ['hubble', '🟡', 'Hubble-stijl', 'Hubble style', 'SHO-achtig goud/blauw', 'SHO-like gold/blue'],
    ]],
    [L('Zonnestelsel', 'Solar system'), [
      ['moon', '🌕', 'Maan', 'Moon', 'Scherpe kraters', 'Crisp craters'],
      ['moonColour', '🌈', 'Kleurrijke maan', 'Colourful moon', 'Mineralen zichtbaar', 'Shows minerals'],
      ['sun', '☀️', 'Zon (witlicht)', 'Sun (white light)', 'Alleen met zonnefilter!', 'Only with a solar filter!'],
      ['sunHa', '🔥', 'Zon oranje', 'Sun orange', 'H-alpha-look', 'H-alpha look'],
      ['planet', '🪐', 'Planeet', 'Planet', 'Jupiter, Saturnus…', 'Jupiter, Saturn…'],
    ]],
  ];
  const TYPE_NAMES = { nebula: ['nevel', 'nebula'], galaxy: ['sterrenstelsel', 'galaxy'], cluster: ['sterrenhoop', 'star cluster'], milkyway: ['melkweg / breedbeeld', 'Milky Way / wide field'], moon: ['maan', 'moon'], sun: ['zon', 'sun'], planet: ['planeet', 'planet'] };

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
  const baseName = (n) => (n || 'astrofoto').replace(/\.[^.]+$/, '');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

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
    const img = E.fromRGBA(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    img.meta.format = ext.toUpperCase();
    return img;
  }

  async function openFile(file) {
    overlay(t('loading'));
    await nextFrame();
    try { await setOriginal(await decodeFile(file), file.name); }
    catch (e) { console.error(e); overlay(null); toast(t('loadError', { msg: e.message || e }), 6000); }
  }
  async function openDemo() {
    overlay(t('makingDemo'));
    await nextFrame();
    await setOriginal(E.makeDemo(1920, 1080, 7), 'Voorbeeld_nevel.fits');
  }

  async function setOriginal(img, fileName) {
    S.original = img; S.fileName = fileName;
    S.geom = Object.assign({}, GEOM0); S.preset = 'auto'; S.snapParams = null; S.tool = null;
    S.params.wbPick = null; S.params.bgPick = null;
    S.autoCropRect = E.detectAutoCrop(img);
    $('welcome').classList.add('hidden'); $('editor').classList.remove('hidden');
    ['btnNew', 'btnBatch', 'undoGroup'].forEach((id) => $(id).classList.remove('hidden'));
    $('btnViewSnap').classList.add('hidden');
    if (S.view === 'snap') S.view = 'split';
    setSeg('[data-view]', S.view);
    S.zoom = 'fit'; setSeg('[data-zoom]', 'fit');
    S.history = []; S.hIndex = -1;
    await sendSource(true);
    overlay(null);
    analyzeSource();
    if (!sessionStorageGet('hintSeen')) { $('hint').classList.add('show'); setTimeout(() => $('hint').classList.remove('show'), 6000); sessionStorageSet('hintSeen', 1); }
  }
  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  function buildSource() {
    let img = S.original;
    const g = S.geom;
    const ac = S.params.autoCrop && S.autoCropRect;
    img = ac ? E.cropImage(img, ac.x, ac.y, ac.x2 - ac.x, ac.y2 - ac.y) : E.cloneImage(img);
    for (let i = 0; i < g.rot; i++) img = E.rotate90(img);
    if (g.fh) E.flipH(img);
    if (g.fv) E.flipV(img);
    if (g.angle) img = E.rotateArbitrary(img, g.angle);
    if (g.crop) img = E.cropImage(img, g.crop.x * img.w, g.crop.y * img.h, g.crop.w * img.w, g.crop.h * img.h);
    if (g.bin && img.w > 400) img = E.bin2(img);
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
    else { requestPreview(); if (S.snapParams) renderSnapshot(); }
    draw();
  }

  async function analyzeSource() {
    try {
      const res = await proc.call({ cmd: 'analyze' });
      S.analysis = res.analysis;
      if (S.tab === 'style' || S.tab === 'info') renderTab();
    } catch (e) { console.error(e); }
  }

  function putCanvas(canvas, rgba, w, h) {
    canvas.width = w; canvas.height = h;
    const id = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h);
    canvas.getContext('2d').putImageData(id, 0, 0);
    return id;
  }

  // ------------------------------------------------------------- presets ---
  function choosePreset(key, fromLoad) {
    const prevCrop = S.params.autoCrop;
    const keep = { wbPick: S.params.wbPick, bgPick: S.params.bgPick, view: S.params.view };
    S.preset = key;
    let params;
    const custom = key.startsWith('my:') ? (store.get('presets', {})[key.slice(3)]) : null;
    if (custom) {
      params = Object.assign({}, E.DEFAULTS, custom.params);
      if (custom.overlay) S.overlay = Object.assign({}, OVERLAY0, custom.overlay);
    } else if (key === 'auto') {
      const det = S.detected || { type: 'nebula', fallback: true };
      params = Object.assign({}, E.DEFAULTS, E.PRESETS[det.type] || E.PRESETS.nebula);
      if (det.fallback) { params.starReduce = 0.2; params.saturation = 1.4; params.brightness = 0.23; }
    } else params = Object.assign({}, E.DEFAULTS, E.PRESETS[key]);
    S.params = Object.assign(params, keep);
    renderTab();
    if (S.original && S.autoCropRect && params.autoCrop !== prevCrop) { sendSource(false).then(() => commitHistory(true)); return; }
    requestPreview();
    commitHistory(fromLoad);
  }

  // ------------------------------------------------------------- history ---
  function stateJSON() { return JSON.stringify({ params: S.params, preset: S.preset, geom: S.geom, overlay: S.overlay }); }
  function commitHistory(immediate) {
    clearTimeout(S.histTimer);
    const doIt = () => {
      if (S.restoring) return;
      const js = stateJSON();
      if (S.history[S.hIndex] === js) return;
      S.history = S.history.slice(0, S.hIndex + 1);
      S.history.push(js);
      if (S.history.length > 100) S.history.shift();
      S.hIndex = S.history.length - 1;
      updateUndo();
    };
    if (immediate) doIt(); else S.histTimer = setTimeout(doIt, 450);
  }
  function updateUndo() { $('btnUndo').disabled = S.hIndex <= 0; $('btnRedo').disabled = S.hIndex >= S.history.length - 1; }
  async function restore(idx) {
    if (idx < 0 || idx >= S.history.length) return;
    S.hIndex = idx; updateUndo();
    const st = JSON.parse(S.history[idx]);
    const geomChanged = JSON.stringify(st.geom) !== JSON.stringify(S.geom) || st.params.autoCrop !== S.params.autoCrop;
    S.restoring = true;
    S.params = st.params; S.preset = st.preset; S.geom = st.geom; S.overlay = st.overlay;
    renderTab();
    if (geomChanged) await sendSource(false); else requestPreview();
    S.restoring = false;
  }

  // -------------------------------------------------------- param changes ---
  const SOURCE_KEYS = ['autoCrop'];
  function setParam(key, value, opts) {
    S.params[key] = value;
    if (S.preset !== 'custom' && !(opts && opts.keepPreset)) markPresetModified();
    if (SOURCE_KEYS.includes(key)) sendSource(false); else requestPreview();
    syncControls();
    commitHistory();
  }
  function markPresetModified() { /* the preset button stays highlighted, values are simply customised */ }

  // ------------------------------------------------------- control builders ---
  let updaters = [];
  function syncControls() { for (const u of updaters) u(); }
  const fmtPct = (v) => Math.round(v * 100);
  function fmtAuto(v, mn, mx) {
    if (mn < 0) return (v > 0 ? '+' : '') + Math.round(v * 100);
    if (mx > 1.5) return (+v).toFixed(mx >= 10 ? 0 : 2);
    return Math.round(v * 100);
  }

  function slider(box, key, mn, mx, step, nl, en, opt) {
    opt = opt || {};
    const get = opt.get || (() => S.params[key]);
    const set = opt.set || ((v) => setParam(key, v));
    const row = el('label', 'slider');
    row.innerHTML = `<span class="sl-name">${esc(L(nl, en))}</span><input type="range" min="${mn}" max="${mx}" step="${step}"><span class="sl-val"></span>`;
    const inp = row.querySelector('input'), val = row.querySelector('.sl-val');
    inp.oninput = () => set(+inp.value);
    inp.ondblclick = () => {
      if (opt.reset) { opt.reset(); return; }
      const base = presetValue(key);
      if (base !== undefined) set(base);
    };
    const upd = () => {
      const v = get();
      if (document.activeElement !== inp) inp.value = v;
      val.textContent = opt.fmt ? opt.fmt(v) : fmtAuto(v, mn, mx);
    };
    updaters.push(upd); upd();
    if (opt.hint) row.title = L(opt.hint[0], opt.hint[1]);
    box.appendChild(row);
    return row;
  }
  function presetValue(key) {
    if (S.preset.startsWith('my:')) { const c = store.get('presets', {})[S.preset.slice(3)]; if (c && key in c.params) return c.params[key]; }
    const base = S.preset === 'auto' ? (E.PRESETS[(S.detected && S.detected.type) || 'nebula'] || {}) : (E.PRESETS[S.preset] || {});
    return key in base ? base[key] : E.DEFAULTS[key];
  }
  function check(box, key, nl, en, opt) {
    opt = opt || {};
    const row = el('label', 'check', `<input type="checkbox"><span>${esc(L(nl, en))}</span>`);
    const inp = row.querySelector('input');
    inp.onchange = () => (opt.set ? opt.set(inp.checked) : setParam(key, inp.checked));
    const upd = () => { inp.checked = !!(opt.get ? opt.get() : S.params[key]); };
    updaters.push(upd); upd();
    box.appendChild(row);
    return row;
  }
  function select(box, key, options, nl, en, opt) {
    opt = opt || {};
    const row = el('label', 'select', `<span class="sl-name">${esc(L(nl, en))}</span><select>${options.map(([v, a, b]) => `<option value="${v}">${esc(L(a, b))}</option>`).join('')}</select>`);
    const inp = row.querySelector('select');
    inp.onchange = () => { const v = isNaN(+inp.value) || inp.value === '' ? inp.value : +inp.value; if (opt.set) opt.set(v); else setParam(key, v); if (opt.rerender) renderTab(); };
    const upd = () => { inp.value = String(opt.get ? opt.get() : S.params[key]); };
    updaters.push(upd); upd();
    box.appendChild(row);
    return row;
  }
  function heading(box, nl, en) { box.appendChild(el('h4', '', esc(L(nl, en)))); }
  function note(box, nl, en) { box.appendChild(el('p', 'note', L(nl, en))); }
  function buttons(box, list) {
    const row = el('div', 'btnrow');
    for (const [nl, en, fn, cls] of list) { const b = el('button', cls || 'ghost small', esc(L(nl, en))); b.onclick = fn; row.appendChild(b); }
    box.appendChild(row);
    return row;
  }
  function card(box, nl, en, cls) {
    const c = el('section', 'card' + (cls ? ' ' + cls : ''));
    if (nl) c.appendChild(el('h3', '', esc(L(nl, en))));
    box.appendChild(c);
    return c;
  }

  // ----------------------------------------------------------------- tabs ---
  const TABS = [
    ['style', '✨', 'Stijl', 'Style'], ['light', '☀', 'Licht', 'Light'], ['colour', '🎨', 'Kleur', 'Colour'], ['detail', '🔍', 'Detail', 'Detail'],
    ['stars', '⭐', 'Sterren', 'Stars'], ['effect', '🪄', 'Effect', 'Effect'], ['image', '🖼', 'Beeld', 'Image'], ['info', 'ℹ', 'Info', 'Info'],
  ];
  function buildTabs() {
    const nav = $('tabs'); nav.innerHTML = '';
    for (const [id, icon, nl, en] of TABS) {
      const b = el('button', 'tab' + (S.tab === id ? ' on' : ''), `<span class="ti">${icon}</span><span>${esc(L(nl, en))}</span>`);
      b.dataset.tab = id;
      b.onclick = () => { S.tab = id; buildTabs(); renderTab(); };
      nav.appendChild(b);
    }
  }
  function renderTab() {
    updaters = [];
    const body = $('tabBody');
    const scroll = body.scrollTop;
    body.innerHTML = '';
    ({ style: tabStyle, light: tabLight, colour: tabColour, detail: tabDetail, stars: tabStars, effect: tabEffect, image: tabImage, info: tabInfo })[S.tab](body);
    body.scrollTop = scroll;
    syncControls();
  }

  // ---- style tab
  function tabStyle(body) {
    for (const [group, list] of PRESET_GROUPS) {
      const c = card(body, group, group);
      const grid = el('div', 'presets');
      for (const [key, icon, nl, en, dnl, den] of list) {
        const b = el('button', 'preset' + (key === 'auto' ? ' featured' : '') + (S.preset === key ? ' on' : ''),
          `<span class="pi">${icon}</span><span class="pt"><b>${esc(L(nl, en))}</b><small>${esc(L(dnl, den))}</small></span>`);
        b.dataset.preset = key;
        b.onclick = () => choosePreset(key);
        grid.appendChild(b);
      }
      c.appendChild(grid);
      if (group === PRESET_GROUPS[0][0]) {
        const det = el('p', 'detected');
        if (S.preset === 'auto' && S.detected) {
          if (S.detected.fallback) det.textContent = L('Geen object herkend, gekozen voor een algemene stijl.', 'No object recognised, using a general style.');
          else {
            const lbl = S.detected.label && /^M\d+$/i.test(S.detected.label) ? ` (${S.detected.label})` : '';
            det.textContent = L('Herkend als: ', 'Recognised as: ') + L(TYPE_NAMES[S.detected.type][0], TYPE_NAMES[S.detected.type][1]) + lbl;
          }
        }
        c.appendChild(det);
      }
    }
    // own presets
    const my = store.get('presets', {});
    const cm = card(body, 'Mijn stijlen', 'My styles');
    const names = Object.keys(my);
    if (names.length) {
      const grid = el('div', 'chips');
      for (const n of names) {
        const chip = el('span', 'chip' + (S.preset === 'my:' + n ? ' on' : ''), `<button class="chip-main">${esc(n)}</button><button class="chip-x" title="${esc(L('Verwijderen', 'Delete'))}">×</button>`);
        chip.querySelector('.chip-main').onclick = () => choosePreset('my:' + n);
        chip.querySelector('.chip-x').onclick = () => { if (confirmDelete(n)) { delete my[n]; store.set('presets', my); renderTab(); } };
        grid.appendChild(chip);
      }
      cm.appendChild(grid);
    } else note(cm, 'Bewaar je eigen instellingen als stijl, dan staan ze hier.', 'Save your own settings as a style and they appear here.');
    buttons(cm, [
      ['＋ Huidige instellingen bewaren', '＋ Save current settings', saveMyPreset],
      ['Exporteren', 'Export', exportPresets], ['Importeren', 'Import', () => importJSON('presets')],
    ]);
    // quick sliders
    const q = card(body, 'Snel bijstellen', 'Quick adjust');
    slider(q, 'q1', 0, 1, 0.001, 'Helderheid', 'Brightness', { get: () => (S.params.brightness - 0.06) / 0.36, set: (v) => setParam('brightness', 0.06 + v * 0.36), fmt: fmtPct, reset: () => setParam('brightness', presetValue('brightness')) });
    slider(q, 'q2', 0, 1, 0.001, 'Kleur', 'Colour', { get: () => S.params.saturation / 3, set: (v) => setParam('saturation', v * 3), fmt: fmtPct, reset: () => setParam('saturation', presetValue('saturation')) });
    slider(q, 'q3', 0, 1, 0.001, 'Ruis weghalen', 'Remove noise', { get: () => S.params.denoise, set: (v) => { S.params.chromaDenoise = Math.min(1, v + 0.15); setParam('denoise', v); }, fmt: fmtPct });
    slider(q, 'q4', 0, 1, 0.001, 'Details', 'Detail', { get: () => S.params.localContrast, set: (v) => { S.params.sharpen = v * 0.8; setParam('localContrast', v); }, fmt: fmtPct });
    slider(q, 'q5', 0, 1, 0.001, 'Sterren kleiner', 'Smaller stars', { get: () => S.params.starReduce, set: (v) => setParam('starReduce', v), fmt: fmtPct });
    slider(q, 'q6', 0, 1, 0.001, 'Achtergrond donkerder', 'Darker background', { get: () => S.params.blackPoint, set: (v) => setParam('blackPoint', v), fmt: fmtPct });
    buttons(q, [['Terug naar stijl', 'Back to style', () => choosePreset(S.preset)]]);
    // analysis checklist
    const a = card(body, 'Wat AstroPolish in je foto ziet', 'What AstroPolish sees in your photo');
    a.appendChild(checklist());
    // settings files
    const f = card(body, 'Instellingen', 'Settings');
    note(f, 'Bewaar alle instellingen van deze foto in een bestand en laad ze later weer, ook op een andere foto.', 'Save all settings of this photo to a file and load them again later, also on another photo.');
    buttons(f, [['Instellingen opslaan', 'Save settings', exportProject], ['Instellingen laden', 'Load settings', () => importJSON('project')]]);
  }
  function confirmDelete(n) { return window.confirm(L(`Stijl "${n}" verwijderen?`, `Delete style "${n}"?`)); }

  function checklist() {
    const ul = el('ul', 'checklist');
    const a = S.analysis;
    const add = (icon, nl, en) => ul.appendChild(el('li', '', `<span>${icon}</span><span>${L(nl, en)}</span>`));
    if (!a) { add('⏳', 'Foto wordt geanalyseerd…', 'Analysing photo…'); return ul; }
    if (S.autoCropRect && S.params.autoCrop) add('✂️', 'Zwarte stackranden gevonden en weggesneden.', 'Black stacking borders found and cropped.');
    if (a.gradient > 0.6) add('🌆', 'Sterke lichtvervuiling of gradient: wordt verwijderd.', 'Strong light pollution or gradient: being removed.');
    else if (a.gradient > 0.25) add('🌆', 'Lichte gradient in de achtergrond: wordt verwijderd.', 'Slight background gradient: being removed.');
    else add('✅', 'Achtergrond is vrij gelijkmatig.', 'Background is fairly even.');
    if (a.greenCast > 0.08) add('🟢', 'Groene zweem gevonden: wordt geneutraliseerd.', 'Green cast found: being neutralised.');
    else if (a.colourCast > 0.12) add('🎨', 'Kleurzweem in de achtergrond: wordt geneutraliseerd.', 'Colour cast in the background: being neutralised.');
    const snr = a.snr;
    if (snr < 15) add('🌫️', 'Veel ruis: zet bij Detail de ruisonderdrukking hoger of combineer meer sessies.', 'Lots of noise: raise noise reduction under Detail or combine more sessions.');
    else if (snr < 40) add('🔉', 'Gemiddelde hoeveelheid ruis.', 'Average amount of noise.');
    else add('🔇', 'Weinig ruis: je kunt flink verscherpen.', 'Little noise: you can sharpen quite a bit.');
    if (a.stars) add('⭐', L(`Ongeveer ${a.stars} sterren gevonden`, `About ${a.stars} stars found`) + (a.fwhm ? L(`, scherpte (FWHM) ${a.fwhm.toFixed(1)} px.`, `, sharpness (FWHM) ${a.fwhm.toFixed(1)} px.`) : '.'), '');
    if (S.detected && S.detected.dualBand) add('🔴', 'Duoband-filter herkend: probeer HOO, Foraxx of Hubble-stijl.', 'Dual-band filter detected: try HOO, Foraxx or Hubble style.');
    return ul;
  }

  // ---- light tab
  function tabLight(body) {
    const c = card(body, 'Oprekken (helderheid)', 'Stretch (brightness)');
    select(c, 'stretchMode', [['auto', 'Automatisch (aanbevolen)', 'Automatic (recommended)'], ['arcsinh', 'Arcsinh (behoudt kleur)', 'Arcsinh (keeps colour)'], ['ghs', 'GHS (generalised hyperbolic)', 'GHS (generalised hyperbolic)'], ['levels', 'Niveaus (maan/zon/planeet)', 'Levels (moon/sun/planet)']], 'Methode', 'Method', { rerender: true });
    slider(c, 'brightness', 0.06, 0.42, 0.005, 'Helderheid', 'Brightness', { fmt: (v) => Math.round((v - 0.06) / 0.36 * 100) });
    slider(c, 'blackPoint', 0, 1, 0.01, 'Zwartpunt (achtergrond donkerder)', 'Black point (darker background)');
    slider(c, 'colorPreserve', 0, 1, 0.01, 'Kleurbehoud bij oprekken', 'Preserve colour while stretching');
    slider(c, 'highlightProtect', 0, 1, 0.01, 'Felle delen beschermen (HDR)', 'Protect bright areas (HDR)');
    if (S.params.stretchMode === 'ghs') {
      heading(c, 'GHS-vorm', 'GHS shape');
      slider(c, 'ghsB', -3, 12, 0.1, 'Lokale intensiteit (b)', 'Local intensity (b)', { fmt: (v) => v.toFixed(1) });
      slider(c, 'ghsLP', 0, 1, 0.01, 'Schaduwen beschermen (LP)', 'Protect shadows (LP)');
      slider(c, 'ghsHP', 0.5, 1, 0.01, 'Hoge lichten beschermen (HP)', 'Protect highlights (HP)');
    }
    const t2 = card(body, 'Contrast en niveaus', 'Contrast and levels');
    slider(t2, 'contrast', -0.3, 0.5, 0.01, 'Contrast', 'Contrast');
    slider(t2, 'lvBlack', 0, 0.4, 0.005, 'Zwart', 'Black');
    slider(t2, 'lvGamma', 0.4, 2.5, 0.01, 'Middentonen (gamma)', 'Midtones (gamma)', { fmt: (v) => v.toFixed(2) });
    slider(t2, 'lvWhite', 0.6, 1, 0.005, 'Wit', 'White');
    const cv = card(body, 'Curves', 'Curves');
    cv.appendChild(curvesEditor());
    const h = card(body, 'Histogram', 'Histogram');
    h.appendChild(histCanvas());
  }

  // ---- colour tab
  function tabColour(body) {
    const c = card(body, 'Kleurkalibratie', 'Colour calibration');
    check(c, 'neutralize', 'Achtergrond neutraal grijs maken', 'Make background neutral grey');
    slider(c, 'whiteBalance', 0, 1, 0.01, 'Automatische witbalans (op sterren)', 'Automatic white balance (on stars)');
    buttons(c, [
      ['💧 Pipet: witte ster', '💧 Picker: white star', () => startTool('wb')],
      ['💧 Pipet: achtergrond', '💧 Picker: background', () => startTool('bg')],
      ['Pipet wissen', 'Clear picker', () => { S.params.wbPick = null; S.params.bgPick = null; setParam('whiteBalance', S.params.whiteBalance); }],
    ]);
    if (S.params.wbPick || S.params.bgPick) note(c, '✔ Pipet actief.', '✔ Picker active.');
    slider(c, 'temperature', -1, 1, 0.01, 'Temperatuur (blauw ↔ warm)', 'Temperature (blue ↔ warm)');
    slider(c, 'tint', -1, 1, 0.01, 'Tint (groen ↔ paars)', 'Tint (green ↔ magenta)');
    const nb = card(body, 'Duoband / narrowband', 'Dual-band / narrowband');
    select(nb, 'palette', [
      ['rgb', 'Normaal (RGB)', 'Normal (RGB)'], ['hoo', 'HOO (rood + blauwgroen)', 'HOO (red + teal)'], ['hooSoft', 'HOO zacht', 'HOO soft'],
      ['foraxx', 'Foraxx (dynamisch)', 'Foraxx (dynamic)'], ['sho', 'Hubble-achtig (SHO-stijl)', 'Hubble-like (SHO style)'], ['ha', 'Alleen H-alpha (zw-w)', 'H-alpha only (b&w)'], ['oiii', 'Alleen OIII (zw-w)', 'OIII only (b&w)'],
    ], 'Kleurenpalet', 'Palette');
    slider(nb, 'oiiiBoost', 0, 1, 0.01, 'OIII (blauwgroen) versterken', 'Boost OIII (teal)');
    note(nb, 'Voor foto\'s met de duoband-filter van de Dwarf 3: Ha zit in rood, OIII in groen en blauw.', 'For photos with the Dwarf 3 dual-band filter: Ha is in red, OIII in green and blue.');
    const s = card(body, 'Verzadiging', 'Saturation');
    slider(s, 'saturation', 0, 3.5, 0.01, 'Verzadiging', 'Saturation', { fmt: (v) => Math.round(v * 100) });
    slider(s, 'vibrance', 0, 1, 0.01, 'Levendigheid (zwakke kleuren)', 'Vibrance (weak colours)');
    slider(s, 'scnr', 0, 1, 0.01, 'Groene zweem verwijderen (SCNR)', 'Remove green cast (SCNR)');
    const hs = card(body, 'Kleur per tint (HSL)', 'Per-hue colour (HSL)');
    hs.appendChild(hslEditor());
    const cb = card(body, 'Kleurbalans', 'Colour balance');
    for (const [k, nl, en] of [['Shadow', 'Schaduwen', 'Shadows'], ['Mid', 'Middentonen', 'Midtones'], ['High', 'Hoge lichten', 'Highlights']]) {
      heading(cb, nl, en);
      slider(cb, 'cb' + k + 'T', -1, 1, 0.01, 'Blauw ↔ warm', 'Blue ↔ warm');
      slider(cb, 'cb' + k + 'G', -1, 1, 0.01, 'Groen ↔ paars', 'Green ↔ magenta');
    }
    const m = card(body, 'Speciaal', 'Special');
    check(m, 'mono', 'Zwart-wit', 'Black & white');
    check(m, 'invert', 'Negatief (vage details zien)', 'Negative (see faint detail)');
    slider(m, 'colorize', 0, 1, 0.01, 'Inkleuren', 'Colourise');
    slider(m, 'colorizeHue', 0, 360, 1, 'Kleur voor inkleuren', 'Colourise hue', { fmt: (v) => Math.round(v) + '°' });
  }

  // ---- detail tab
  function tabDetail(body) {
    const n = card(body, 'Ruis', 'Noise');
    select(n, 'denoiseMethod', [['guided', 'Snel (randbehoudend)', 'Fast (edge preserving)'], ['wavelet', 'Wavelets (multischaal)', 'Wavelets (multiscale)']], 'Methode', 'Method');
    slider(n, 'denoise', 0, 1, 0.01, 'Ruisonderdrukking', 'Noise reduction');
    slider(n, 'chromaDenoise', 0, 1, 0.01, 'Kleurruis weghalen', 'Remove colour noise');
    slider(n, 'bgSmooth', 0, 1, 0.01, 'Achtergrond gladder', 'Smoother background');
    const d = card(body, 'Scherpte en structuur', 'Sharpness and structure');
    slider(d, 'localContrast', 0, 1, 0.01, 'Lokaal contrast (structuur)', 'Local contrast (structure)');
    slider(d, 'sharpen', 0, 1, 0.01, 'Verscherpen', 'Sharpen');
    heading(d, 'Deconvolutie', 'Deconvolution');
    slider(d, 'deconv', 0, 1, 0.01, 'Sterkte', 'Strength');
    slider(d, 'deconvRadius', 0.5, 4, 0.05, 'Onscherpte (sterrenstraal, px)', 'Blur (star radius, px)', { fmt: (v) => v.toFixed(2) });
    note(d, 'Deconvolutie maakt sterren kleiner en details scherper. Rustig opbouwen en bekijken op 100%.', 'Deconvolution makes stars smaller and details sharper. Build up slowly and check at 100%.');
    const w = card(body, 'Wavelets (zoals RegiStax)', 'Wavelets (like RegiStax)');
    note(w, 'Laag 1 = fijnste details, laag 6 = grote structuren. Vooral handig voor maan, zon en planeten.', 'Layer 1 = finest detail, layer 6 = large structures. Especially useful for moon, sun and planets.');
    for (let j = 0; j < 6; j++) {
      slider(w, 'wav' + j, -1, 3, 0.01, `Laag ${j + 1}`, `Layer ${j + 1}`, {
        get: () => (S.params.wavelets || [0, 0, 0, 0, 0, 0])[j],
        set: (v) => { const a = (S.params.wavelets || [0, 0, 0, 0, 0, 0]).slice(); a[j] = v; setParam('wavelets', a); },
        reset: () => { const a = (S.params.wavelets || [0, 0, 0, 0, 0, 0]).slice(); a[j] = 0; setParam('wavelets', a); },
      });
    }
    buttons(w, [['Alle lagen op 0', 'Reset all layers', () => setParam('wavelets', [0, 0, 0, 0, 0, 0])]]);
  }

  // ---- stars tab
  function tabStars(body) {
    const c = card(body, 'Sterren', 'Stars');
    slider(c, 'starReduce', 0, 1, 0.01, 'Sterren kleiner', 'Smaller stars');
    slider(c, 'starBrightness', -1, 0.5, 0.01, 'Helderheid sterren (−100 = weg)', 'Star brightness (−100 = removed)');
    slider(c, 'starSat', 0, 2.5, 0.01, 'Kleur van sterren', 'Star colour', { fmt: (v) => Math.round(v * 100) });
    slider(c, 'starHalo', 0, 1, 0.01, 'Halo\'s verkleinen', 'Reduce halos');
    slider(c, 'defringe', 0, 1, 0.01, 'Blauwe/paarse randen weg', 'Remove blue/purple fringes');
    check(c, 'starSeparate', 'Sterren apart bewerken (nevel en sterren gescheiden)', 'Process stars separately (nebula and stars split)');
    slider(c, 'starMaskSize', 0, 1, 0.01, 'Grootte sterrenmasker', 'Star mask size');
    note(c, 'Bekijk het resultaat met de weergave "Sterrenmasker" of "Zonder sterren" onder de foto. Sterren verwijderen werkt zonder AI. Grote of heel felle sterren laten soms een vlekje achter.', 'Check the result with the "Star mask" or "Without stars" view below the photo. Star removal works without AI. Large or very bright stars sometimes leave a small spot.');
    const s = card(body, 'Star spikes', 'Star spikes');
    slider(s, 'spikes', 0, 1, 0.01, 'Hoeveelheid (aantal sterren)', 'Amount (number of stars)');
    slider(s, 'spikeLength', 0, 1, 0.01, 'Lengte', 'Length');
    slider(s, 'spikeAngle', 0, 90, 1, 'Hoek', 'Angle', { fmt: (v) => Math.round(v) + '°' });
    select(s, 'spikeCount', [[4, '4 stralen', '4 rays'], [6, '6 stralen (JWST-stijl)', '6 rays (JWST style)'], [8, '8 stralen', '8 rays']], 'Stralen', 'Rays');
  }

  // ---- effect tab
  function tabEffect(body) {
    const c = card(body, 'Effecten', 'Effects');
    slider(c, 'glow', 0, 1, 0.01, 'Zachte gloed', 'Soft glow');
    slider(c, 'vignette', -1, 1, 0.01, 'Vignet (rand donker ↔ licht)', 'Vignette (dark ↔ light edges)');
    const tx = card(body, 'Tekst / watermerk', 'Text / watermark');
    const O = S.overlay;
    const setO = (k, v) => { O[k] = v; draw(); commitHistory(); };
    check(tx, 'ov', 'Tekst op de foto zetten', 'Put text on the photo', { get: () => O.on, set: (v) => { if (v && !O.title) { const inf = autoInfo(); O.title = inf.title; O.sub = inf.sub; } setO('on', v); renderTab(); } });
    const inp = (lbl, key) => {
      const r = el('label', 'select', `<span class="sl-name">${esc(lbl)}</span><input type="text">`);
      const i = r.querySelector('input'); i.value = O[key] || ''; i.oninput = () => setO(key, i.value);
      tx.appendChild(r);
    };
    inp(L('Titel', 'Title'), 'title');
    inp(L('Regel 2 (bijv. datum, belichting, telescoop)', 'Line 2 (e.g. date, exposure, telescope)'), 'sub');
    buttons(tx, [['Automatisch invullen', 'Fill in automatically', () => { const inf = autoInfo(); O.title = inf.title; O.sub = inf.sub; draw(); renderTab(); commitHistory(); }]]);
    select(tx, 'pos', [['br', 'Rechtsonder', 'Bottom right'], ['bl', 'Linksonder', 'Bottom left'], ['bc', 'Midden onder', 'Bottom centre'], ['tr', 'Rechtsboven', 'Top right'], ['tl', 'Linksboven', 'Top left']], 'Positie', 'Position', { get: () => O.pos, set: (v) => setO('pos', v) });
    slider(tx, 'osize', 0.5, 3, 0.05, 'Grootte', 'Size', { get: () => O.size, set: (v) => { setO('size', v); syncControls(); }, fmt: (v) => Math.round(v * 100) + '%' });
    slider(tx, 'oop', 0.1, 1, 0.01, 'Zichtbaarheid', 'Opacity', { get: () => O.opacity, set: (v) => { setO('opacity', v); syncControls(); } });
    const cr = el('label', 'select', `<span class="sl-name">${esc(L('Kleur', 'Colour'))}</span><input type="color">`);
    const ci = cr.querySelector('input'); ci.value = O.color; ci.oninput = () => setO('color', ci.value);
    tx.appendChild(cr);
    note(tx, 'De tekst komt mee bij JPG, PNG en WebP.', 'Text is included in JPG, PNG and WebP.');
  }

  // ---- image tab
  function tabImage(body) {
    const g = S.geom;
    const c = card(body, 'Draaien en bijsnijden', 'Rotate and crop');
    buttons(c, [
      ['⟳ 90°', '⟳ 90°', () => setGeom('rot', (g.rot + 1) % 4)],
      ['⇋ Spiegelen', '⇋ Flip', () => setGeom('fh', !g.fh)],
      ['⇵ Ondersteboven', '⇵ Upside down', () => setGeom('fv', !g.fv)],
    ]);
    slider(c, 'angle', -45, 45, 0.1, 'Rechtzetten (graden)', 'Straighten (degrees)', { get: () => g.angle, set: (v) => { g.angle = v; syncControls(); clearTimeout(S.angleT); S.angleT = setTimeout(() => setGeom('angle', v), 350); }, fmt: (v) => v.toFixed(1) + '°', reset: () => setGeom('angle', 0) });
    buttons(c, [['✂ Bijsnijden…', '✂ Crop…', () => startTool('crop')], ['Bijsnijden ongedaan', 'Remove crop', () => setGeom('crop', null)]]);
    check(c, 'autoCrop', 'Zwarte stackranden automatisch wegsnijden', 'Automatically crop black stacking borders');
    check(c, 'bin', '2×2 binning (halve grootte, veel minder ruis)', '2×2 binning (half size, much less noise)', { get: () => g.bin, set: (v) => setGeom('bin', v) });
    const p = card(body, 'Lichtvervuiling en gradient', 'Light pollution and gradient');
    slider(p, 'gradient', 0, 1, 0.01, 'Verwijderen', 'Remove');
    select(p, 'gradientMethod', [['poly', 'Glad (polynoom)', 'Smooth (polynomial)'], ['grid', 'Raster (complex, volgt vlekken)', 'Grid (complex, follows patches)']], 'Methode', 'Method', { rerender: true });
    if (S.params.gradientMethod === 'grid') slider(p, 'gradientSmooth', 0, 1, 0.01, 'Gladheid', 'Smoothness');
    else select(p, 'gradientDegree', [[1, 'Eenvoudig (scheef)', 'Simple (tilted)'], [2, 'Normaal', 'Normal'], [3, 'Complex', 'Complex'], [4, 'Zeer complex', 'Very complex']], 'Soort gradient', 'Gradient type');
    check(p, 'gradientDivide', 'Delen i.p.v. aftrekken (voor vignettering)', 'Divide instead of subtract (for vignetting)');
    slider(p, 'vignetteFix', 0, 1, 0.01, 'Vignettering corrigeren (donkere hoeken)', 'Correct vignetting (dark corners)');
    note(p, 'Tip: kies de weergave "Gevonden lichtvervuiling" onder de foto om te zien wat er wordt weggehaald.', 'Tip: choose the "Detected light pollution" view below the photo to see what is removed.');
    const h = card(body, 'Opschonen', 'Clean up');
    check(h, 'hotPixels', 'Hete pixels verwijderen', 'Remove hot pixels');
  }
  function setGeom(k, v) {
    S.geom[k] = v;
    if (k !== 'crop' || v === null) { /* geometry changes invalidate picked points */ }
    S.params.wbPick = null; S.params.bgPick = null;
    sendSource(false).then(() => commitHistory(true));
    renderTab();
  }

  // ---- info tab
  function tabInfo(body) {
    const h = card(body, 'Histogram', 'Histogram');
    h.appendChild(histCanvas());
    check(h, 'hlog', 'Logaritmische schaal', 'Logarithmic scale', { get: () => S.histLog, set: (v) => { S.histLog = v; drawHist(); } });
    const a = S.analysis;
    const c = card(body, 'Analyse (origineel)', 'Analysis (original)');
    if (!a) note(c, 'Bezig…', 'Working…');
    else {
      const rows = [
        [L('Afmetingen', 'Size'), S.src ? `${S.src.w} × ${S.src.h} px` : '-'],
        [L('Sterren (geschat)', 'Stars (estimate)'), a.stars],
        [L('Scherpte (FWHM)', 'Sharpness (FWHM)'), a.fwhm ? a.fwhm.toFixed(2) + ' px' : '-'],
        [L('Achtergrond', 'Background'), (a.background * 100).toFixed(2) + ' %'],
        [L('Ruis (σ)', 'Noise (σ)'), (a.noise * 100).toFixed(3) + ' %'],
        [L('Signaal/ruis (globaal)', 'Signal/noise (rough)'), a.snr.toFixed(1)],
        [L('Gradient-sterkte', 'Gradient strength'), a.gradient ? a.gradient.toFixed(2) : '-'],
        ['R / G / B ' + L('mediaan', 'median'), ['r', 'g', 'b'].map((k) => (a.channels[k].median * 100).toFixed(2)).join(' / ')],
      ];
      c.appendChild(table(rows));
    }
    const meta = S.original && S.original.meta;
    if (meta && meta.header) {
      const hc = card(body, 'FITS-gegevens', 'FITS header');
      const rows = Object.entries(meta.header).filter(([k]) => !/^(SIMPLE|BITPIX|NAXIS\d?|EXTEND|END|COMMENT|HISTORY)$/.test(k)).map(([k, v]) => [k, String(v)]);
      hc.appendChild(table(rows));
    }
    const fi = card(body, 'Bestand', 'File');
    fi.appendChild(table([[L('Naam', 'Name'), S.fileName], [L('Formaat', 'Format'), (meta && meta.format) || '-'], [L('Herkend', 'Detected'), S.detected ? (S.detected.type + (S.detected.label ? ' (' + S.detected.label + ')' : '')) : '-']]));
  }
  function table(rows) {
    const tb = el('table', 'kv');
    for (const [k, v] of rows) { const tr = el('tr', '', `<th>${esc(k)}</th><td>${esc(v)}</td>`); tb.appendChild(tr); }
    return tb;
  }

  // ---------------------------------------------------------- histogram ---
  function histCanvas() {
    const c = el('canvas', 'hist'); c.width = 330; c.height = 90;
    S.histEls = (S.histEls || []).filter((x) => document.body.contains(x)); S.histEls.push(c);
    setTimeout(drawHist, 0);
    return c;
  }
  function drawHist() {
    const H = S.hist; if (!H) return;
    for (const c of (S.histEls || [])) {
      if (!document.body.contains(c)) continue;
      const g = c.getContext('2d'), w = c.width, h = c.height;
      g.clearRect(0, 0, w, h);
      const f = S.histLog ? (v) => Math.log1p(v) : (v) => v;
      let mx = 1;
      for (const k of ['r', 'g', 'b']) for (let i = 2; i < 254; i++) mx = Math.max(mx, f(H[k][i]));
      g.globalCompositeOperation = 'lighter';
      const cols = { r: 'rgba(255,90,90,.75)', g: 'rgba(90,220,120,.7)', b: 'rgba(90,140,255,.8)' };
      for (const k of ['r', 'g', 'b']) {
        g.fillStyle = cols[k]; g.beginPath(); g.moveTo(0, h);
        for (let i = 0; i < 256; i++) g.lineTo(i / 255 * w, h - Math.min(1, f(H[k][i]) / mx) * (h - 2));
        g.lineTo(w, h); g.closePath(); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    }
  }

  // ------------------------------------------------------- curves editor ---
  function curvesEditor() {
    const wrap = el('div', 'curves');
    const chans = [['rgb', 'RGB'], ['r', 'R'], ['g', 'G'], ['b', 'B']];
    S.curveCh = S.curveCh || 'rgb';
    const tabs = el('div', 'seg mini');
    for (const [k, lbl] of chans) { const b = el('button', S.curveCh === k ? 'on' : '', lbl); b.onclick = () => { S.curveCh = k; renderTab(); }; tabs.appendChild(b); }
    wrap.appendChild(tabs);
    const cv = el('canvas', 'curvecanvas'); cv.width = 300; cv.height = 300;
    wrap.appendChild(cv);
    const getPts = () => ((S.params.curves && S.params.curves[S.curveCh]) || [[0, 0], [1, 1]]).map((p) => p.slice());
    const setPts = (pts) => { const cvs = Object.assign({ rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }, S.params.curves || {}); cvs[S.curveCh] = pts; S.params.curves = cvs; };
    const col = { rgb: '#ffffff', r: '#ff6b6b', g: '#5fe08a', b: '#6aa0ff' }[S.curveCh];
    const drawC = () => {
      const g = cv.getContext('2d'), W = cv.width, H = cv.height;
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#0e1020'; g.fillRect(0, 0, W, H);
      if (S.hist) {
        const hk = S.curveCh === 'rgb' ? 'l' : S.curveCh; const arr = S.hist[hk] || S.hist.r; let mx = 1;
        for (let i = 2; i < 254; i++) mx = Math.max(mx, Math.log1p(arr[i]));
        g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(0, H);
        for (let i = 0; i < 256; i++) g.lineTo(i / 255 * W, H - Math.log1p(arr[i]) / mx * H * 0.9);
        g.lineTo(W, H); g.fill();
      }
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * W / 4, 0); g.lineTo(i * W / 4, H); g.moveTo(0, i * H / 4); g.lineTo(W, i * H / 4); g.stroke(); }
      g.strokeStyle = 'rgba(255,255,255,.2)'; g.beginPath(); g.moveTo(0, H); g.lineTo(W, 0); g.stroke();
      const lut = E.curveLUT(getPts(), 256);
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
      for (let i = 0; i < 256; i++) { const x = i / 255 * W, y = H - lut[i] * H; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
      for (const [x, y] of getPts()) { g.fillStyle = '#fff'; g.beginPath(); g.arc(x * W, H - y * H, 5, 0, Math.PI * 2); g.fill(); }
    };
    let dragIdx = -1;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))]; };
    cv.onpointerdown = (e) => {
      const [x, y] = pos(e); const pts = getPts();
      let best = -1, bd = 0.05;
      pts.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = i; } });
      if (best < 0) { pts.push([x, y]); pts.sort((a, b) => a[0] - b[0]); best = pts.findIndex((p) => p[0] === x && p[1] === y); setPts(pts); }
      dragIdx = best; cv.setPointerCapture(e.pointerId); drawC(); requestPreview();
    };
    cv.onpointermove = (e) => {
      if (dragIdx < 0) return;
      const [x, y] = pos(e); const pts = getPts();
      const lo = dragIdx > 0 ? pts[dragIdx - 1][0] + 0.01 : 0, hi = dragIdx < pts.length - 1 ? pts[dragIdx + 1][0] - 0.01 : 1;
      pts[dragIdx] = [dragIdx === 0 ? 0 : dragIdx === pts.length - 1 ? 1 : Math.max(lo, Math.min(hi, x)), y];
      if (dragIdx === 0) pts[0][0] = Math.min(x, pts[1] ? pts[1][0] - 0.01 : 1);
      if (dragIdx === pts.length - 1 && pts.length > 1) pts[dragIdx][0] = Math.max(x, pts[dragIdx - 1][0] + 0.01);
      setPts(pts); drawC(); requestPreview();
    };
    cv.onpointerup = () => { dragIdx = -1; commitHistory(); };
    cv.ondblclick = (e) => {
      const [x, y] = pos(e); const pts = getPts();
      const i = pts.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < 0.05);
      if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); setPts(pts); drawC(); requestPreview(); commitHistory(); }
    };
    S.curveRedraw = drawC;
    drawC();
    const row = el('div', 'btnrow');
    const presets = [
      [L('Reset', 'Reset'), [[0, 0], [1, 1]]], [L('S-curve', 'S-curve'), [[0, 0], [0.25, 0.18], [0.75, 0.84], [1, 1]]],
      [L('Lichter', 'Lighter'), [[0, 0], [0.4, 0.52], [1, 1]]], [L('Donkerder', 'Darker'), [[0, 0], [0.55, 0.43], [1, 1]]],
    ];
    for (const [lbl, pts] of presets) { const b = el('button', 'ghost small', esc(lbl)); b.onclick = () => { setPts(pts.map((p) => p.slice())); drawC(); requestPreview(); commitHistory(); }; row.appendChild(b); }
    wrap.appendChild(row);
    wrap.appendChild(el('p', 'note', L('Klik om een punt toe te voegen, sleep om te verplaatsen, dubbelklik om te verwijderen.', 'Click to add a point, drag to move, double-click to remove.')));
    return wrap;
  }

  // ---------------------------------------------------------- HSL editor ---
  function hslEditor() {
    const wrap = el('div', 'hsl');
    const names = { red: ['Rood', 'Red', '#ff4d4d'], orange: ['Oranje', 'Orange', '#ff9d3b'], yellow: ['Geel', 'Yellow', '#ffe14d'], green: ['Groen', 'Green', '#4dd36b'], aqua: ['Blauwgroen', 'Aqua', '#3fd6d6'], blue: ['Blauw', 'Blue', '#4d7dff'], purple: ['Paars', 'Purple', '#9b5cff'], magenta: ['Magenta', 'Magenta', '#ff4dd2'] };
    S.hslSel = S.hslSel || 'red';
    const sw = el('div', 'swatches');
    for (const k of Object.keys(names)) {
      const b = el('button', 'swatch' + (S.hslSel === k ? ' on' : '')); b.style.background = names[k][2]; b.title = L(names[k][0], names[k][1]);
      const v = S.params.hsl && S.params.hsl[k];
      if (v && (v[0] || v[1] !== 1 || v[2])) b.classList.add('changed');
      b.onclick = () => { S.hslSel = k; renderTab(); };
      sw.appendChild(b);
    }
    wrap.appendChild(sw);
    wrap.appendChild(el('p', 'note', esc(L('Gekozen: ', 'Selected: ') + L(names[S.hslSel][0], names[S.hslSel][1]))));
    const get = (i) => ((S.params.hsl && S.params.hsl[S.hslSel]) || [0, 1, 0])[i];
    const set = (i, v) => {
      const h = JSON.parse(JSON.stringify(S.params.hsl || {}));
      h[S.hslSel] = (h[S.hslSel] || [0, 1, 0]).slice(); h[S.hslSel][i] = v;
      setParam('hsl', h);
    };
    slider(wrap, 'hslH', -1, 1, 0.01, 'Tint verschuiven', 'Hue shift', { get: () => get(0), set: (v) => set(0, v), reset: () => set(0, 0) });
    slider(wrap, 'hslS', 0, 2.5, 0.01, 'Verzadiging', 'Saturation', { get: () => get(1), set: (v) => set(1, v), fmt: (v) => Math.round(v * 100), reset: () => set(1, 1) });
    slider(wrap, 'hslL', -1, 1, 0.01, 'Helderheid', 'Lightness', { get: () => get(2), set: (v) => set(2, v), reset: () => set(2, 0) });
    buttons(wrap, [['Alle kleuren resetten', 'Reset all colours', () => setParam('hsl', null)]]);
    return wrap;
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
        const params = Object.assign({}, S.params, { view: ['stars', 'starless', 'gradient'].includes(S.viewMode) ? S.viewMode : 'normal' });
        const res = await proc.call({ cmd: 'preview', params });
        if (token !== S.sourceToken) continue;
        S.afterData = putCanvas(S.afterCanvas, res.rgba, res.w, res.h);
        S.hist = res.hist;
        drawHist();
        if (S.curveRedraw) S.curveRedraw();
        if (S.viewMode === 'clip') buildClip();
        S.region = null;
        draw();
      } while (S.previewQueued);
    } catch (e) { console.error(e); toast(String(e.message || e)); }
    S.previewBusy = false;
    if (S.zoom !== 'fit') scheduleRegion(10); else $('busy').classList.add('hidden');
  }

  function buildClip() {
    const d = S.afterData; if (!d) return;
    const c = S.clipCanvas || (S.clipCanvas = document.createElement('canvas'));
    c.width = d.width; c.height = d.height;
    const out = new ImageData(d.width, d.height), a = d.data, o = out.data;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] >= 254 || a[i + 1] >= 254 || a[i + 2] >= 254) { o[i] = 255; o[i + 1] = 40; o[i + 2] = 40; o[i + 3] = 230; }
      else if (a[i] <= 1 && a[i + 1] <= 1 && a[i + 2] <= 1) { o[i] = 40; o[i + 1] = 120; o[i + 2] = 255; o[i + 3] = 230; }
    }
    c.getContext('2d').putImageData(out, 0, 0);
  }

  async function renderSnapshot() {
    if (!S.snapParams || !S.src) return;
    const res = await proc.call({ cmd: 'snapshot', params: S.snapParams });
    putCanvas(S.snapCanvas, res.rgba, res.w, res.h);
    draw();
  }

  // ---------------------------------------------------------------- view ---
  const view = $('view'), stage = $('stage');
  function mapping() {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (S.zoom === 'fit') {
      const s = Math.min(W / S.src.w, H / S.src.h);
      return { s, ox: (W - S.src.w * s) / 2, oy: (H - S.src.h * s) / 2 };
    }
    const s = S.zoom / (window.devicePixelRatio || 1);
    return { s, ox: W / 2 - S.cx * s, oy: H / 2 - S.cy * s };
  }
  function clampCenter() {
    const s = S.zoom / (window.devicePixelRatio || 1);
    const hw = stage.clientWidth / 2 / s, hh = stage.clientHeight / 2 / s;
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
    let mode = S.holdOriginal ? 'before' : S.view;
    if (S.tool) mode = 'after';
    const snapMode = mode === 'snap';
    const splitX = (mode === 'split' || snapMode) ? Math.max(0, Math.min(W, S.split * W)) : mode === 'after' ? 0 : W;

    const paint = (which, clipX0, clipX1) => {
      if (clipX1 <= clipX0) return;
      g.save(); g.beginPath(); g.rect(clipX0, 0, clipX1 - clipX0, H); g.clip();
      const srcCanvas = which === 'before' ? (snapMode ? S.snapCanvas : S.beforeCanvas) : S.afterCanvas;
      g.drawImage(srcCanvas, m.ox, m.oy, dw, dh);
      const R = S.region;
      if (R && S.zoom !== 'fit' && (!snapMode || which === 'after' || R.snap)) {
        const c = which === 'before' ? R.beforeCanvas : R.afterCanvas;
        g.imageSmoothingEnabled = S.zoom < 1;
        g.drawImage(c, m.ox + R.rect.x * m.s, m.oy + R.rect.y * m.s, R.rect.w * m.s, R.rect.h * m.s);
        g.imageSmoothingEnabled = true;
      }
      if (which === 'after') {
        if (S.viewMode === 'clip' && S.clipCanvas) { g.imageSmoothingEnabled = false; g.drawImage(S.clipCanvas, m.ox, m.oy, dw, dh); g.imageSmoothingEnabled = true; }
        if (S.overlay.on) drawOverlay(g, m.ox, m.oy, dw, dh);
      }
      g.restore();
    };
    paint('before', 0, splitX);
    paint('after', splitX, W);
    if (mode === 'split' || snapMode) {
      g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(splitX - 1, 0, 2, H);
      g.beginPath(); g.arc(splitX, H / 2, 16, 0, Math.PI * 2); g.fillStyle = 'rgba(15,16,30,.85)'; g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(splitX - 9, H / 2); g.lineTo(splitX - 3, H / 2 - 5); g.lineTo(splitX - 3, H / 2 + 5); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(splitX + 9, H / 2); g.lineTo(splitX + 3, H / 2 - 5); g.lineTo(splitX + 3, H / 2 + 5); g.closePath(); g.fill();
    }
    // crop tool overlay
    if (S.tool === 'crop' && S.cropRect) {
      const r = S.cropRect;
      const x = m.ox + r.x * m.s, y = m.oy + r.y * m.s, w = r.w * m.s, h = r.h * m.s;
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.fillRect(0, 0, W, y); g.fillRect(0, y + h, W, H - y - h); g.fillRect(0, y, x, h); g.fillRect(x + w, y, W - x - w, h);
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1;
      for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(x + w * i / 3, y); g.lineTo(x + w * i / 3, y + h); g.moveTo(x, y + h * i / 3); g.lineTo(x + w, y + h * i / 3); g.stroke(); }
    }
    $('tagBefore').textContent = snapMode ? t('vsSnap') : t('before');
    $('tagBefore').style.display = mode === 'after' ? 'none' : '';
    $('tagAfter').style.display = mode === 'before' ? 'none' : '';
  }

  // text overlay for preview and export
  function drawOverlay(g, x, y, w, h) {
    const O = S.overlay;
    if (!O.title && !O.sub) return;
    const base = Math.max(8, Math.min(w, h) * 0.035 * O.size);
    const pad = base * 0.9;
    g.save();
    g.globalAlpha = O.opacity;
    g.fillStyle = O.color;
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = base * 0.3;
    const right = O.pos.endsWith('r'), center = O.pos === 'bc', top = O.pos.startsWith('t');
    g.textAlign = center ? 'center' : right ? 'right' : 'left';
    const tx = center ? x + w / 2 : right ? x + w - pad : x + pad;
    const lines = [[O.title, `600 ${base}px "Segoe UI", system-ui, sans-serif`, base], [O.sub, `400 ${base * 0.55}px "Segoe UI", system-ui, sans-serif`, base * 0.55]].filter((l) => l[0]);
    if (top) {
      let ty = y + pad;
      for (const [txt, font, sz] of lines) { g.font = font; g.textBaseline = 'top'; g.fillText(txt, tx, ty); ty += sz * 1.25; }
    } else {
      let ty = y + h - pad;
      for (const [txt, font, sz] of lines.slice().reverse()) { g.font = font; g.textBaseline = 'bottom'; g.fillText(txt, tx, ty); ty -= sz * 1.3; }
    }
    g.restore();
  }

  function autoInfo() {
    const meta = (S.original && S.original.meta) || {};
    const hd = meta.header || {};
    const fn = S.fileName || '';
    let title = meta.object || (S.detected && S.detected.label && /^M\d+$/i.test(S.detected.label) ? S.detected.label : '') || '';
    if (!title) { const m = fn.match(/\b(M\s?\d{1,3}|NGC\s?\d+|IC\s?\d+|Sh2-?\d+)\b/i); if (m) title = m[1].toUpperCase(); }
    if (!title) title = baseName(fn).replace(/[_-]+/g, ' ').slice(0, 40);
    const bits = [];
    const date = hd['DATE-OBS'] || (fn.match(/(20\d\d)[-_]?(\d\d)[-_]?(\d\d)/) || []).slice(1).join('-');
    if (date) bits.push(String(date).slice(0, 10));
    const exp = hd.EXPTIME || hd.EXPOSURE || (fn.match(/EXP[_-]?(\d+(?:\.\d+)?)/i) || [])[1];
    const cnt = hd.STACKCNT || hd.NCOMBINE || meta.stacked;
    if (exp && cnt) { const tot = exp * cnt; bits.push(`${cnt} × ${exp}s = ${tot >= 3600 ? (tot / 3600).toFixed(1) + ' h' : Math.round(tot / 60) + ' min'}`); }
    else if (exp) bits.push(`${exp}s`);
    const scope = hd.TELESCOP || hd.INSTRUME || (/dwarf/i.test(fn) ? 'DWARF 3' : '');
    if (scope) bits.push(String(scope));
    return { title, sub: bits.join('  ·  ') };
  }

  // --------------------------------------------------------------- region ---
  function scheduleRegion(delay) { clearTimeout(S.regionTimer); S.regionTimer = setTimeout(loadRegion, delay || 250); }
  async function loadRegion() {
    if (!S.src || S.zoom === 'fit') return;
    if (S.previewBusy) { scheduleRegion(200); return; }
    const m = mapping();
    const W = stage.clientWidth, H = stage.clientHeight;
    let x = Math.floor(-m.ox / m.s), y = Math.floor(-m.oy / m.s);
    let w = Math.ceil(W / m.s), h = Math.ceil(H / m.s);
    x = Math.max(0, x); y = Math.max(0, y); w = Math.min(S.src.w - x, w); h = Math.min(S.src.h - y, h);
    if (w < 2 || h < 2) return;
    $('busy').classList.remove('hidden');
    const token = S.sourceToken, key = JSON.stringify(S.params);
    try {
      const params = Object.assign({}, S.params, { view: ['stars', 'starless', 'gradient'].includes(S.viewMode) ? S.viewMode : 'normal' });
      const snap = S.view === 'snap' && S.snapParams;
      const res = await proc.call({ cmd: 'region', params, rect: { x, y, w, h }, beforeParams: snap ? S.snapParams : null });
      if (token !== S.sourceToken || key !== JSON.stringify(S.params) || S.zoom === 'fit') { $('busy').classList.add('hidden'); return; }
      const a = document.createElement('canvas'), b = document.createElement('canvas');
      putCanvas(a, res.rgba, res.w, res.h); putCanvas(b, res.before, res.w, res.h);
      S.region = { rect: res.rect, afterCanvas: a, beforeCanvas: b, snap: !!snap };
      draw();
    } catch (e) { console.error(e); }
    $('busy').classList.add('hidden');
  }

  function setSeg(sel, val) {
    document.querySelectorAll(sel).forEach((b) => b.classList.toggle('on', (b.dataset.view || b.dataset.zoom) === String(val)));
  }
  function setZoom(z) {
    S.zoom = z === 'fit' ? 'fit' : +z;
    setSeg('[data-zoom]', z);
    S.region = null;
    if (S.zoom !== 'fit') { clampCenter(); scheduleRegion(10); }
    draw();
  }

  // ---------------------------------------------------------------- tools ---
  function toSource(e) {
    const r = stage.getBoundingClientRect(), m = mapping();
    return { x: (e.clientX - r.left - m.ox) / m.s, y: (e.clientY - r.top - m.oy) / m.s };
  }
  function startTool(tool) {
    if (!S.src) return;
    S.tool = tool;
    if (tool === 'crop') { setZoom('fit'); S.cropRect = { x: S.src.w * 0.05, y: S.src.h * 0.05, w: S.src.w * 0.9, h: S.src.h * 0.9 }; }
    $('toolBanner').classList.remove('hidden');
    $('toolApply').classList.toggle('hidden', tool !== 'crop');
    const ex = $('toolExtra'); ex.innerHTML = '';
    if (tool === 'crop') {
      $('toolText').textContent = L('Sleep een kader over de foto.', 'Drag a frame over the photo.');
      const sel = el('select', 'small-select', [['0', L('Vrij', 'Free')], ['1', '1:1'], ['1.3333', '4:3'], ['1.5', '3:2'], ['1.7778', '16:9'], ['0.8', '4:5 (Instagram)'], ['0.5625', '9:16'], ['2', '2:1']].map(([v, l]) => `<option value="${v}">${l}</option>`).join(''));
      sel.value = String(S.cropAspect || 0);
      sel.onchange = () => { S.cropAspect = +sel.value; if (S.cropAspect) { const r = S.cropRect; const cx = r.x + r.w / 2, cy = r.y + r.h / 2; let w = r.w, h = w / S.cropAspect; if (h > S.src.h) { h = S.src.h * 0.9; w = h * S.cropAspect; } S.cropRect = { x: Math.max(0, cx - w / 2), y: Math.max(0, cy - h / 2), w, h }; } draw(); };
      ex.appendChild(sel);
    } else if (tool === 'wb') $('toolText').textContent = L('Klik op een witte ster of een neutraal grijs gebied.', 'Click on a white star or a neutral grey area.');
    else $('toolText').textContent = L('Klik op een stuk lege achtergrond (zonder nevel of sterren).', 'Click on an empty piece of background (no nebula or stars).');
    stage.classList.add('tool-' + tool);
    draw();
  }
  function endTool() { if (S.tool) stage.classList.remove('tool-' + S.tool); S.tool = null; $('toolBanner').classList.add('hidden'); draw(); }
  function applyCrop() {
    const r = S.cropRect;
    if (!r || r.w < 10 || r.h < 10) { endTool(); return; }
    const n = { x: r.x / S.src.w, y: r.y / S.src.h, w: r.w / S.src.w, h: r.h / S.src.h };
    const old = S.geom.crop;
    // binning halves the size but the crop is relative, so no correction needed
    S.geom.crop = old ? { x: old.x + n.x * old.w, y: old.y + n.y * old.h, w: n.w * old.w, h: n.h * old.h } : n;
    endTool();
    S.params.wbPick = null; S.params.bgPick = null;
    sendSource(false).then(() => commitHistory(true));
  }

  // pointer interaction: tools, split handle or panning
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (!S.src || e.target.closest('.toolbanner')) return;
    const r = stage.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (S.tool === 'wb' || S.tool === 'bg') {
      const p = toSource(e);
      if (p.x < 0 || p.y < 0 || p.x > S.src.w || p.y > S.src.h) return;
      const pick = { x: p.x / S.src.w, y: p.y / S.src.h };
      if (S.tool === 'wb') S.params.wbPick = pick; else S.params.bgPick = pick;
      endTool(); setParam('whiteBalance', S.params.whiteBalance); renderTab();
      toast(L('Witbalans aangepast.', 'White balance adjusted.'));
      return;
    }
    if (S.tool === 'crop') {
      const p = toSource(e);
      drag = { type: 'crop', x0: Math.max(0, Math.min(S.src.w, p.x)), y0: Math.max(0, Math.min(S.src.h, p.y)) };
      stage.setPointerCapture(e.pointerId); return;
    }
    const split = S.view === 'split' || S.view === 'snap';
    const nearSplit = split && Math.abs(x - S.split * r.width) < 28;
    if (nearSplit || (split && S.zoom === 'fit')) { drag = { type: 'split' }; S.split = x / r.width; draw(); }
    else if (S.zoom !== 'fit') drag = { type: 'pan', x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy };
    if (drag) { stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); }
  });
  stage.addEventListener('pointermove', (e) => {
    probe(e);
    if (!drag) return;
    const r = stage.getBoundingClientRect();
    if (drag.type === 'crop') {
      const p = toSource(e);
      let x1 = Math.max(0, Math.min(S.src.w, p.x)), y1 = Math.max(0, Math.min(S.src.h, p.y));
      let w = Math.abs(x1 - drag.x0), h = Math.abs(y1 - drag.y0);
      if (S.cropAspect) { if (w / h > S.cropAspect) w = h * S.cropAspect; else h = w / S.cropAspect; }
      const x = x1 < drag.x0 ? drag.x0 - w : drag.x0, y = y1 < drag.y0 ? drag.y0 - h : drag.y0;
      S.cropRect = { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(w, S.src.w - Math.max(0, x)), h: Math.min(h, S.src.h - Math.max(0, y)) };
      draw();
    } else if (drag.type === 'split') { S.split = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); draw(); }
    else {
      const s = mapping().s;
      S.cx = drag.cx - (e.clientX - drag.x) / s; S.cy = drag.cy - (e.clientY - drag.y) / s;
      clampCenter(); draw();
    }
  });
  const endDrag = () => { if (drag && drag.type === 'pan') scheduleRegion(150); drag = null; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', () => { $('probe').textContent = ''; });
  stage.addEventListener('dblclick', (e) => {
    if (!S.src || S.tool || e.target.closest('.toolbanner')) return;
    const r = stage.getBoundingClientRect(), m = mapping();
    if (S.zoom === 'fit') { S.cx = (e.clientX - r.left - m.ox) / m.s; S.cy = (e.clientY - r.top - m.oy) / m.s; setZoom(1); }
    else setZoom('fit');
  });
  stage.addEventListener('wheel', (e) => {
    if (!S.src || S.tool) return;
    e.preventDefault();
    if (e.deltaY < 0 && S.zoom === 'fit') {
      const r = stage.getBoundingClientRect(), m = mapping();
      S.cx = (e.clientX - r.left - m.ox) / m.s; S.cy = (e.clientY - r.top - m.oy) / m.s; setZoom(1);
    } else if (e.deltaY < 0 && S.zoom === 1) setZoom(2);
    else if (e.deltaY > 0 && S.zoom === 2) setZoom(1);
    else if (e.deltaY > 0 && S.zoom !== 'fit') setZoom('fit');
  }, { passive: false });

  function probe(e) {
    if (!S.src || !S.afterData) return;
    const p = toSource(e);
    if (p.x < 0 || p.y < 0 || p.x >= S.src.w || p.y >= S.src.h) { $('probe').textContent = ''; return; }
    const px = Math.floor(p.x / S.src.w * S.afterData.width), py = Math.floor(p.y / S.src.h * S.afterData.height);
    const i = (py * S.afterData.width + px) * 4, d = S.afterData.data;
    $('probe').textContent = `x ${Math.floor(p.x)}  y ${Math.floor(p.y)}   R ${d[i]}  G ${d[i + 1]}  B ${d[i + 2]}`;
  }

  // ---------------------------------------------------------------- save ---
  const SIZES = [
    ['orig', 'Origineel formaat', 'Original size', { mode: 'original' }],
    ['4k', 'Max. 3840 px (4K)', 'Max 3840 px (4K)', { mode: 'long', size: 3840 }],
    ['2k', 'Max. 2048 px', 'Max 2048 px', { mode: 'long', size: 2048 }],
    ['1080', 'Max. 1080 px (delen)', 'Max 1080 px (sharing)', { mode: 'long', size: 1080 }],
    ['ig45', 'Instagram 4:5 (1080×1350)', 'Instagram 4:5 (1080×1350)', { mode: 'pad', ratio: [4, 5], width: 1080 }],
    ['ig11', 'Instagram 1:1 (1080×1080)', 'Instagram 1:1 (1080×1080)', { mode: 'pad', ratio: [1, 1], width: 1080 }],
    ['wall', 'Bureaublad 16:9 (3840×2160)', 'Desktop 16:9 (3840×2160)', { mode: 'fill', ratio: [16, 9], width: 3840 }],
    ['phone', 'Telefoon-achtergrond (1179×2556)', 'Phone wallpaper (1179×2556)', { mode: 'fill', ratio: [1179, 2556], width: 1179 }],
    ['up2', 'Vergroot 2×', 'Enlarge 2×', { mode: 'upscale', factor: 2 }],
    ['cmp', 'Voor/na naast elkaar', 'Before/after side by side', { mode: 'long', size: 3840, compare: true }],
  ];
  function buildSizes() {
    const s = $('exportSize'); const v = s.value || store.get('size', 'orig');
    s.innerHTML = SIZES.map(([k, nl, en]) => `<option value="${k}">${esc(L(nl, en))}</option>`).join('');
    s.value = v;
  }
  function compareParams() {
    const lin = S.original && S.original.meta && S.original.meta.linear;
    if (!lin) return null;
    return Object.assign({}, E.DEFAULTS, { gradient: 0, hotPixels: false, neutralize: false, whiteBalance: 0, highlightProtect: 0, colorPreserve: 0, denoise: 0, chromaDenoise: 0, starReduce: 0, localContrast: 0, sharpen: 0, contrast: 0, saturation: 1, vibrance: 0, scnr: 0 });
  }

  async function renderFull(fmt, sizeKey) {
    const size = (SIZES.find((s) => s[0] === sizeKey) || SIZES[0])[3];
    const format = fmt === 'tif' ? 'rgb16' : fmt === 'fits' ? 'float' : 'rgba';
    const res = await proc.call({ cmd: 'full', params: Object.assign({}, S.params, { view: 'normal' }), format, size, compare: !!size.compare, compareParams: size.compare ? compareParams() : null });
    if (format === 'rgb16') return new Blob([F.writeTIFF16(res.data, res.w, res.h)], { type: 'image/tiff' });
    if (format === 'float') {
      const meta = (S.original && S.original.meta) || {};
      const hd = meta.header || {};
      const extra = { OBJECT: meta.object || autoInfo().title, SOFTWARE: 'AstroPolish', COMMENT: undefined };
      for (const k of ['DATE-OBS', 'EXPTIME', 'TELESCOP', 'INSTRUME', 'FILTER', 'STACKCNT', 'RA', 'DEC']) if (hd[k] !== undefined) extra[k] = hd[k];
      return new Blob([F.writeFITS(res.r, res.g, res.b, res.w, res.h, extra)], { type: 'application/fits' });
    }
    const c = document.createElement('canvas');
    putCanvas(c, res.data, res.w, res.h);
    if (S.overlay.on) {
      const g = c.getContext('2d');
      if (size.compare) drawOverlay(g, res.w / 2, 0, res.w / 2, res.h); else drawOverlay(g, 0, 0, res.w, res.h);
    }
    if (size.compare) {
      const g = c.getContext('2d'); const fs = Math.max(14, res.h * 0.03);
      g.font = `600 ${fs}px "Segoe UI", system-ui, sans-serif`; g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 6; g.textBaseline = 'top';
      g.fillText(L('Voor', 'Before'), fs, fs); g.fillText(L('Na', 'After'), res.w / 2 + fs, fs);
    }
    const q = store.get('jpgq', 0.95);
    const mime = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
    return await new Promise((r) => c.toBlob(r, mime, q));
  }

  const TYPES = {
    jpg: { description: 'JPEG', accept: { 'image/jpeg': ['.jpg'] } }, png: { description: 'PNG', accept: { 'image/png': ['.png'] } },
    webp: { description: 'WebP', accept: { 'image/webp': ['.webp'] } }, tif: { description: 'TIFF', accept: { 'image/tiff': ['.tif'] } },
    fits: { description: 'FITS', accept: { 'application/fits': ['.fits'] } }, json: { description: 'JSON', accept: { 'application/json': ['.json'] } },
  };
  async function saveBlob(blob, name) {
    const ext = name.split('.').pop();
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name, types: TYPES[ext] ? [TYPES[ext]] : undefined });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        return h.name;
      } catch (e) { if (e && e.name === 'AbortError') return null; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return name;
  }

  async function save() {
    if (!S.src) return;
    const fmt = $('format').value, sizeKey = $('exportSize').value;
    overlay(t('processing'));
    try {
      await nextFrame();
      const blob = await renderFull(fmt, sizeKey);
      overlay(null);
      const suffix = sizeKey === 'cmp' ? '_voor-na' : sizeKey === 'orig' ? '' : '_' + sizeKey;
      const saved = await saveBlob(blob, `${baseName(S.fileName)}_astropolish${suffix}.${fmt}`);
      if (saved) toast(t('saved', { name: saved }));
    } catch (e) { console.error(e); overlay(null); toast(String(e.message || e), 6000); }
  }

  // --------------------------------------------------- presets & projects ---
  function saveMyPreset() {
    const name = window.prompt(L('Naam voor deze stijl:', 'Name for this style:'), L('Mijn stijl', 'My style'));
    if (!name) return;
    const my = store.get('presets', {});
    const params = Object.assign({}, S.params); delete params.wbPick; delete params.bgPick; delete params.view;
    my[name.slice(0, 40)] = { params, overlay: S.overlay.on ? S.overlay : null };
    store.set('presets', my);
    S.preset = 'my:' + name.slice(0, 40);
    renderTab();
    toast(L('Stijl bewaard.', 'Style saved.'));
  }
  async function exportPresets() {
    const blob = new Blob([JSON.stringify({ app: 'AstroPolish', type: 'presets', presets: store.get('presets', {}) }, null, 2)], { type: 'application/json' });
    await saveBlob(blob, 'astropolish-stijlen.json');
  }
  async function exportProject() {
    const blob = new Blob([JSON.stringify({ app: 'AstroPolish', type: 'project', version: 2, file: S.fileName, preset: S.preset, params: S.params, geom: S.geom, overlay: S.overlay }, null, 2)], { type: 'application/json' });
    await saveBlob(blob, `${baseName(S.fileName)}.astropolish.json`);
  }
  function importJSON(kind) {
    const inp = $('importInput');
    inp.onchange = async () => {
      const f = inp.files[0]; inp.value = '';
      if (!f) return;
      try {
        const js = JSON.parse(await f.text());
        if (js.type === 'presets' || kind === 'presets' && js.presets) {
          const my = Object.assign(store.get('presets', {}), js.presets || {});
          store.set('presets', my); renderTab(); toast(L('Stijlen geïmporteerd.', 'Styles imported.'));
        } else if (js.type === 'project' || js.params) {
          S.params = Object.assign({}, E.DEFAULTS, js.params); S.preset = js.preset || 'auto';
          if (js.overlay) S.overlay = Object.assign({}, OVERLAY0, js.overlay);
          if (js.geom && S.original) { S.geom = Object.assign({}, GEOM0, js.geom); await sendSource(false); } else requestPreview();
          renderTab(); commitHistory(true); toast(L('Instellingen geladen.', 'Settings loaded.'));
        }
      } catch (e) { toast(L('Dit bestand kan niet worden gelezen.', 'This file cannot be read.')); }
    };
    inp.click();
  }

  // --------------------------------------------------------------- batch ---
  let batchFiles = [];
  function openBatch() { batchFiles = []; renderBatch(); $('batchDlg').showModal(); }
  const STATUS = { waiting: ['wacht', 'waiting'], busy: ['bezig…', 'working…'], done: ['klaar', 'done'], error: ['fout', 'error'] };
  function renderBatch() {
    const ul = $('batchList'); ul.innerHTML = '';
    batchFiles.forEach((f) => ul.appendChild(el('li', '', `<span>${esc(f.file.name)}</span><em class="st-${f.status}">${esc(L(...STATUS[f.status]))}</em>`)));
    $('batchStart').disabled = !batchFiles.some((f) => f.status === 'waiting');
  }
  async function runBatch() {
    const fmt = $('format').value, sizeKey = $('exportSize').value;
    let dir = null;
    if (window.showDirectoryPicker) {
      try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e && e.name === 'AbortError') return; dir = null; }
    }
    $('batchStart').disabled = true;
    const keep = { original: S.original, fileName: S.fileName, geom: S.geom, autoCropRect: S.autoCropRect, detected: S.detected, preset: S.preset, params: Object.assign({}, S.params) };
    let done = 0;
    for (const f of batchFiles) {
      if (f.status !== 'waiting') continue;
      f.status = 'busy'; renderBatch();
      try {
        const img = await decodeFile(f.file);
        S.original = img; S.fileName = f.file.name; S.geom = Object.assign({}, GEOM0, { fh: keep.geom.fh, fv: keep.geom.fv, rot: keep.geom.rot, bin: keep.geom.bin });
        S.autoCropRect = E.detectAutoCrop(img);
        S.params = Object.assign({}, keep.params, { wbPick: null, bgPick: null });
        if (keep.preset === 'auto') {
          await sendSource(false);
          const det = S.detected || { type: 'nebula', fallback: true };
          S.params = Object.assign({}, E.DEFAULTS, E.PRESETS[det.type] || E.PRESETS.nebula);
        }
        await sendSource(false);
        const blob = await renderFull(fmt, sizeKey);
        const name = `${baseName(f.file.name)}_astropolish.${fmt}`;
        if (dir) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); }
        else await saveBlob(blob, name);
        f.status = 'done'; done++;
      } catch (e) { console.error(e); f.status = 'error'; }
      renderBatch();
    }
    Object.assign(S, keep);
    if (S.original) await sendSource(false);
    renderTab();
    toast(t('batchAllDone', { n: done }), 5000);
  }

  // --------------------------------------------------------------- stack ---
  let stackFiles = [];
  function openStack() { stackFiles = []; renderStack(); $('stackDlg').showModal(); }
  function renderStack() {
    const ul = $('stackList'); ul.innerHTML = '';
    stackFiles.forEach((f, i) => ul.appendChild(el('li', '', `<span>${i === 0 ? '⭐ ' : ''}${esc(f.file.name)}</span><em class="st-${f.status}">${esc(f.info || L(...STATUS[f.status]))}</em>`)));
    $('stackStart').disabled = stackFiles.length < 2 || !stackFiles.some((f) => f.status === 'waiting');
  }
  async function runStack() {
    $('stackStart').disabled = true;
    await proc.call({ cmd: 'stackReset' });
    let ok = 0, ref = null;
    for (const f of stackFiles) {
      f.status = 'busy'; f.info = ''; renderStack();
      try {
        const img = await decodeFile(f.file);
        if (ref && (img.w !== ref.w || img.h !== ref.h)) { /* different sizes are allowed: alignment handles shifts, the first photo sets the frame */ }
        if (!ref) ref = { w: img.w, h: img.h, name: f.file.name };
        const r = await proc.call({ cmd: 'stackAdd', img: { w: img.w, h: img.h, r: img.r, g: img.g, b: img.b, mono: img.mono, meta: img.meta } }, [img.r.buffer, img.g.buffer, img.b.buffer]);
        if (r.ok) { f.status = 'done'; ok++; f.info = ok === 1 ? L('referentie', 'reference') : L(`uitgelijnd: ${r.matches} sterren, ${r.rot}°`, `aligned: ${r.matches} stars, ${r.rot}°`); }
        else { f.status = 'error'; f.info = L('kon niet uitlijnen', 'could not align'); }
      } catch (e) { console.error(e); f.status = 'error'; f.info = L('kan niet openen', 'cannot open'); }
      renderStack();
    }
    if (ok < 2) { toast(L('Te weinig foto\'s konden worden uitgelijnd.', 'Too few photos could be aligned.'), 5000); return; }
    overlay(L('Combineren…', 'Combining…'));
    try {
      const res = await proc.call({ cmd: 'stackFinish' });
      $('stackDlg').close();
      await setOriginal(res.img, `${baseName(ref.name)}_gecombineerd_${ok}x.fits`);
      toast(L(`${ok} opnames gecombineerd.`, `${ok} images combined.`), 5000);
    } catch (e) { overlay(null); toast(String(e.message || e)); }
  }

  // ----------------------------------------------------------------- i18n ---
  function applyLang() {
    document.documentElement.lang = window.I18N.getLang();
    document.querySelectorAll('[data-i18n]').forEach((x) => { x.textContent = t(x.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach((x) => { x.title = t(x.dataset.i18nTitle); });
    document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === window.I18N.getLang()));
    $('helpBody').innerHTML = t('help');
    PRESET_GROUPS[0][0] = L('Deep-sky', 'Deep sky'); PRESET_GROUPS[1][0] = L('Duoband-filter (Ha/OIII)', 'Dual-band filter (Ha/OIII)'); PRESET_GROUPS[2][0] = L('Zonnestelsel', 'Solar system');
    buildSizes(); buildTabs(); renderTab(); draw();
  }

  // ---------------------------------------------------------------- wire up ---
  function init() {
    $('format').value = store.get('format', 'jpg');
    applyLang();
    document.querySelectorAll('[data-lang]').forEach((b) => b.onclick = () => { window.I18N.setLang(b.dataset.lang); applyLang(); });
    $('fileInput').onchange = (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; };
    $('btnDemo').onclick = openDemo;
    $('btnNew').onclick = () => $('fileInput').click();
    $('btnHelp').onclick = () => $('helpDlg').showModal();
    $('helpClose').onclick = () => $('helpDlg').close();
    $('btnSave').onclick = save;
    $('format').onchange = () => store.set('format', $('format').value);
    $('exportSize').onchange = () => store.set('size', $('exportSize').value);
    $('btnBatch').onclick = openBatch;
    $('batchClose').onclick = () => $('batchDlg').close();
    $('batchInput').onchange = (e) => { for (const f of e.target.files) batchFiles.push({ file: f, status: 'waiting' }); e.target.value = ''; renderBatch(); };
    $('batchStart').onclick = runBatch;
    $('btnStack').onclick = openStack; $('btnStack2').onclick = openStack;
    $('stackClose').onclick = () => $('stackDlg').close();
    $('stackInput').onchange = (e) => { for (const f of e.target.files) stackFiles.push({ file: f, status: 'waiting' }); e.target.value = ''; renderStack(); };
    $('stackStart').onclick = runStack;
    $('btnUndo').onclick = () => restore(S.hIndex - 1);
    $('btnRedo').onclick = () => restore(S.hIndex + 1);
    $('btnCrop').onclick = () => startTool('crop');
    $('btnPickWB').onclick = () => startTool('wb');
    $('toolApply').onclick = applyCrop;
    $('toolCancel').onclick = endTool;
    $('btnSnap').onclick = () => {
      if (!S.src) return;
      S.snapParams = JSON.parse(JSON.stringify(S.params));
      $('btnViewSnap').classList.remove('hidden');
      S.view = 'snap'; setSeg('[data-view]', 'snap');
      renderSnapshot();
      toast(L('Momentopname gemaakt. Pas nu iets aan en vergelijk.', 'Snapshot taken. Now change something and compare.'));
    };
    $('viewMode').onchange = () => { S.viewMode = $('viewMode').value; if (S.viewMode === 'clip') buildClip(); requestPreview(); };
    document.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => { S.view = b.dataset.view; setSeg('[data-view]', S.view); S.region = null; if (S.zoom !== 'fit') scheduleRegion(10); draw(); });
    document.querySelectorAll('[data-zoom]').forEach((b) => b.onclick = () => setZoom(b.dataset.zoom));

    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragover'); });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragover'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragover');
      const files = [...(e.dataTransfer.files || [])];
      if (!files.length) return;
      if ($('batchDlg').open) { files.forEach((f) => batchFiles.push({ file: f, status: 'waiting' })); renderBatch(); return; }
      if ($('stackDlg').open) { files.forEach((f) => stackFiles.push({ file: f, status: 'waiting' })); renderStack(); return; }
      if (files.length > 1 && files.every((f) => /\.(fits?|fts|tiff?)$/i.test(f.name))) { openStack(); files.forEach((f) => stackFiles.push({ file: f, status: 'waiting' })); renderStack(); return; }
      openFile(files[0]);
    });

    window.addEventListener('keydown', (e) => {
      const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
      if (e.code === 'Space' && S.src && !typing && document.activeElement.tagName !== 'BUTTON') { e.preventDefault(); if (!S.holdOriginal) { S.holdOriginal = true; draw(); } }
      if (e.key === 'Escape' && S.tool) endTool();
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); save(); }
        if (k === 'o') { e.preventDefault(); $('fileInput').click(); }
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); restore(S.hIndex - 1); }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); restore(S.hIndex + 1); }
      }
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space' && S.holdOriginal) { S.holdOriginal = false; draw(); } });
    window.addEventListener('resize', () => { draw(); if (S.src && S.zoom !== 'fit') { clampCenter(); scheduleRegion(); } });
  }

  init();
  // exposed for automated tests
  window.AstroApp = { S, openDemo, choosePreset, save, renderFull, setZoom, setParam, restore, startTool, applyCrop, setGeom, isWorker: proc.isWorker };
})();
