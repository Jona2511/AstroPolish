/* AstroPolish v3 - Photoshop-style interface with adjustment layers */
(function () {
  'use strict';
  window.APP_VERSION = '3.4.0'; // keep in sync with package.json (checked by test/release-test.js)
  const E = window.AstroEngine, O = window.AstroOps, F = window.AstroFormats, I18N = window.I18N;
  const $ = (id) => document.getElementById(id);
  const L = (nl, en) => (I18N.getLang() === 'en' ? en : nl);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ap3-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ap3-' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const baseName = (n) => (n || 'astrofoto').replace(/\.[^.]+$/, '');
  const clamp = (v, a, b) => (Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : a); // NaN-safe
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const deep = (o) => JSON.parse(JSON.stringify(o));
  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 3000); }
  function overlay(text) { if (text) { $('overlayText').textContent = text; $('overlay').classList.remove('hidden'); } else $('overlay').classList.add('hidden'); }

  // ------------------------------------------------------------ processor ---
  const proc = (() => {
    let worker = null;
    const pending = new Map(); let seq = 0; const local = {};
    const api = { isWorker: false, lost: false };
    function start() {
      try { if (location.protocol !== 'file:') worker = new Worker('js/worker.js'); } catch (e) { worker = null; }
      if (!worker) return;
      api.isWorker = true;
      worker.onmessage = (e) => {
        const m = e.data, p = pending.get(m.id); if (!p) return; pending.delete(m.id);
        if (m.cmd === 'error') { const err = new Error(m.message); err.name = m.name || 'Error'; err.workerStack = m.stack; p.reject(err); } else p.resolve(m);
      };
      // The worker died (for example: out of memory). Reject what was waiting and start a fresh
      // worker; it has lost the image, so the app has to send the source again (api.lost).
      worker.onerror = (e) => {
        const err = new Error(L('Het rekenproces is gestopt', 'The processing worker stopped') + (e && e.message ? ': ' + e.message : ''));
        err.workerCrash = true;
        for (const p of pending.values()) p.reject(err);
        pending.clear();
        try { worker.terminate(); } catch (x) { /* already gone */ }
        api.lost = true;
        start();
      };
    }
    start();
    return Object.assign(api, {
      call(msg, transfer) {
        msg.id = ++seq;
        if (worker) return new Promise((res, rej) => { pending.set(msg.id, { resolve: res, reject: rej }); worker.postMessage(msg, transfer || []); });
        return new Promise((res, rej) => setTimeout(async () => {
          try {
            if (msg.cmd === 'decode') { const r = (await window.AstroCore.decode(msg)).result; r.id = msg.id; res(r); return; }
            const r = window.AstroCore.handle(local, msg).result; r.id = msg.id; res(r);
          } catch (err) { rej(err); }
        }, 10));
      },
    });
  })();

  // --------------------------------------------------------------- errors ---
  // User-facing message plus the technical details (kept for bug reports).
  function describeError(e) {
    const msg = String((e && e.message) || e || '');
    if (e && e.workerCrash) return L('Het rekenproces is gestopt, waarschijnlijk door te weinig geheugen. Probeer een kleinere voorbeeldgrootte (Bewerken → Voorkeuren), minder lagen of 2×2 binning.', 'The processing worker stopped, probably because it ran out of memory. Try a smaller preview size (Edit → Preferences), fewer layers or 2×2 binning.');
    if (/allocation failed|out of memory|Invalid typed array length|Array buffer allocation/i.test(msg)) return L('Te weinig geheugen voor deze bewerking. Sluit andere documenten, gebruik 2×2 binning of een kleinere exportgrootte.', 'Not enough memory for this operation. Close other documents, use 2×2 binning or a smaller export size.');
    if (/could not be decoded|source image|decode/i.test(msg)) return L('Dit bestand kan niet worden gelezen. Het is beschadigd of het formaat wordt niet ondersteund.', 'This file cannot be read. It is damaged or the format is not supported.');
    return msg || L('Onbekende fout', 'Unknown error');
  }
  function errorDetails(e, context) {
    return [
      'AstroPolish ' + (window.APP_VERSION || ''), 'Context: ' + (context || '-'),
      'Error: ' + ((e && e.name) || 'Error') + ': ' + ((e && e.message) || String(e)),
      'Worker: ' + (proc.isWorker ? 'yes' : 'no'), 'User agent: ' + navigator.userAgent,
      '', 'Stack:', (e && (e.workerStack || e.stack)) || '-',
    ].join('\n');
  }
  let errorOpen = false;
  function showError(title, e, context) {
    console.warn(context || title, e); // the user sees the dialog; keep the console free of 'errors'
    if (errorOpen || $('dlg').open) { toast(title + ': ' + describeError(e), 8000); return; }
    errorOpen = true;
    const box = el('div', '');
    box.appendChild(el('p', '', esc(describeError(e))));
    const det = el('details', ''); det.appendChild(el('summary', '', esc(L('Technische details (voor een bugmelding)', 'Technical details (for a bug report)'))));
    const pre = el('pre', 'errdetails'); pre.textContent = errorDetails(e, context); det.appendChild(pre); box.appendChild(det);
    dialog(title, box, [{ label: L('Details kopiëren', 'Copy details'), action: async () => { try { await navigator.clipboard.writeText(pre.textContent); toast(L('Gekopieerd.', 'Copied.')); } catch (x) { toast(L('Kopiëren lukt niet; selecteer de tekst handmatig.', 'Copy failed; select the text manually.')); } return true; } }, { label: 'OK', primary: true }]);
    const dlg = $('dlg'); const onClose = () => { errorOpen = false; dlg.removeEventListener('close', onClose); }; dlg.addEventListener('close', onClose);
  }
  // after a worker crash the new worker has no image: send it again
  async function recoverWorker() { if (!proc.lost) return false; proc.lost = false; if (D()) { try { await sendSource(); } catch (e) { /* reported by sendSource */ } } return true; }

  // ---------------------------------------------------------------- state ---
  const GEOM0 = { rot: 0, fh: false, fv: false, angle: 0, crop: null, bin: false, scale: 1 };
  const S = {
    docs: [], cur: null, tool: 'hand', spaceHeld: false,
    fg: '#ffffff', bgc: '#000000',
    brush: { size: store.get('brushSize', 60), hard: 0.5, flow: 1 }, heal: { size: 25, hard: 0.6 },
    selFeather: 0, cropAspect: 0, cropRect: null, ruler: null, sample: null, star: null,
    text: { size: 0.045, color: '#ffffff' },
    showOriginal: false, split: false, splitX: 0.5, compareSnap: false, grid: false, clip: false, channel: 'rgb',
    viewMaskId: null, pick: null,
    beforeCanvas: document.createElement('canvas'), afterCanvas: document.createElement('canvas'), snapCanvas: document.createElement('canvas'),
    afterData: null, hist: null, histCh: 'rgb', histLog: false, renderMs: 0, region: null,
    previewBusy: false, previewQueued: false, regionTimer: 0, token: 0, mouse: null, drag: null,
    mode: store.get('mode', 'simple'), simpleShowAll: store.get('simpleShowAll', false), simpleAllStyles: false,
    prefs: Object.assign({ preview: 1200, cache: 12 }, store.get('prefs', {})),
    panels: store.get('panels', { nav: true, hist: true, info: true, props: true, adj: true, layers: true, history: true, actions: true }),
    panelTab: { a: 'nav', b: 'props', c: 'layers', d: 'actions' },
    exportPrefs: Object.assign({ format: 'jpg', quality: 0.95, size: 'orig', compare: false, text: true }, store.get('export', {})),
  };
  const D = () => S.docs.find((d) => d.id === S.cur) || null;
  const curLayer = () => { const d = D(); return d ? d.layers.find((l) => l.id === d.sel) || null : null; };

  // -------------------------------------------------------- op metadata ---
  const ICON = {
    hotpix: '✦', gradient: '◩', vignfix: '◎', colorcal: '⚖', deconv: '◉', stretch: '⤢', hdr: '☀', hdrmt: '▦', palette: 'Ⓗ', chmix: '⧉', scnr: 'Ⓖ',
    starreduce: '✶', starsplit: '✷', spikes: '✳', denoise: '≋', bgsmooth: '∿', dust: '⁘', localcontrast: '◐', sharpen: '△', usm: '▲', highpass: '⊿',
    wavelets: '〰', clahe: '▥', clarity: '◆', dehaze: '☁', brightcon: '☼', levels: '▁', curves: '∫', exposure: '±', vibrance: '▼', huesat: '◑', hsl: '❖',
    colorbalance: '⚌', temptint: '🌡', photofilter: '◍', bw: '◧', invert: '◪', posterize: '▤', threshold: '▣', gradmap: '▨', shadhigh: '◒', autotone: 'Ⓐ',
    gblur: '○', median: '⊡', surface: '◌', minimum: '•', maximum: '●', emboss: '⬓', edges: '⬚', grain: '⣿', glow: '✺', vignette: '◙', heal: '✚', text: 'T',
  };
  const opName = (op) => (O.OPS[op] ? L(O.OPS[op].nl, O.OPS[op].en) : op);
  const BLEND_NAMES = { normal: ['Normaal', 'Normal'], multiply: ['Vermenigvuldigen', 'Multiply'], screen: ['Bleken', 'Screen'], overlay: ['Bedekken', 'Overlay'], softlight: ['Zacht licht', 'Soft light'], hardlight: ['Hard licht', 'Hard light'], lighten: ['Lichter', 'Lighten'], darken: ['Donkerder', 'Darken'], difference: ['Verschil', 'Difference'], add: ['Lineair tegenhouden (toevoegen)', 'Linear dodge (add)'], subtract: ['Aftrekken', 'Subtract'], color: ['Kleur', 'Color'], luminosity: ['Lichtsterkte', 'Luminosity'] };
  const MASK_TYPES = [['none', 'Alles tonen', 'Reveal all'], ['paint', 'Alles verbergen (schilder zichtbaar)', 'Hide all (paint to reveal)'], ['lum', 'Helderheidsbereik', 'Luminance range'], ['hue', 'Kleurbereik', 'Colour range'], ['stars', 'Alleen sterren', 'Stars only'], ['nostars', 'Alles behalve sterren', 'Everything but stars'], ['signal', 'Object (nevel/stelsel)', 'Object (nebula/galaxy)'], ['background', 'Achtergrond', 'Background'], ['shape', 'Selectie (vorm)', 'Selection (shape)']];

  const ACTIONS = [
    ['Deep-sky', 'Deep sky', [['auto', '✨', 'Automatisch', 'Automatic'], ['nebula', '', 'Nevel', 'Nebula'], ['galaxy', '', 'Sterrenstelsel', 'Galaxy'], ['cluster', '', 'Sterrenhoop', 'Star cluster'], ['milkyway', '', 'Melkweg / breed', 'Milky Way / wide'], ['bright', '', 'Maximaal helder', 'Maximum bright'], ['natural', '', 'Natuurlijk', 'Natural'], ['starless', '', 'Zonder sterren', 'Starless'], ['spikes', '', 'Star spikes', 'Star spikes'], ['dreamy', '', 'Dromerig', 'Dreamy'], ['mono', '', 'Zwart-wit', 'Black & white']]],
    ['Duoband-filter', 'Dual-band filter', [['hoo', '', 'HOO', 'HOO'], ['foraxx', '', 'Foraxx', 'Foraxx'], ['hubble', '', 'Hubble-stijl', 'Hubble style']]],
    ['Zonnestelsel', 'Solar system', [['moon', '', 'Maan', 'Moon'], ['moonColour', '', 'Kleurrijke maan', 'Colourful moon'], ['sun', '', 'Zon (witlicht)', 'Sun (white light)'], ['sunHa', '', 'Zon oranje (H-alpha)', 'Sun orange (H-alpha)'], ['planet', '', 'Planeet', 'Planet']]],
  ];

  // ------------------------------------------------------------ documents ---
  let docId = 1;
  function newDoc(img, name) {
    const d = {
      id: 'D' + (docId++), name, original: img, autoCropRect: E.detectAutoCrop(img), autoCrop: true, geom: deep(GEOM0),
      layers: [], sel: null, history: [], hIndex: -1, snaps: [], detected: null, analysis: null, selection: null,
      zoom: 'fit', cx: 0, cy: 0, src: null, prevW: 0, prevH: 0,
    };
    S.docs.push(d);
    return d;
  }
  const SUPPORTED = ['fit', 'fits', 'fts', 'tif', 'tiff', 'jpg', 'jpeg', 'png', 'webp'];
  async function decodeFile(file) {
    const ext = (file.name || '').split('.').pop().toLowerCase();
    const hasExt = /\.[a-z0-9]{1,5}$/i.test(file.name || '');
    if (hasExt ? !SUPPORTED.includes(ext) : !/^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(file.type || '')) {
      throw new Error(L(`Bestandsformaat .${ext} wordt niet ondersteund. Ondersteund: FITS, TIFF, JPG, PNG en WebP.`, `File format .${ext} is not supported. Supported: FITS, TIFF, JPG, PNG and WebP.`));
    }
    if (['fit', 'fits', 'fts', 'tif', 'tiff'].includes(ext)) {
      // FITS/TIFF are decoded in the background worker so the interface does not freeze
      const buffer = await file.arrayBuffer();
      const r = await proc.call({ cmd: 'decode', ext, buffer }, [buffer]);
      return r.img;
    }
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {
      try { bmp = await createImageBitmap(file); } catch (e2) { throw new Error(L('Dit bestand kan niet worden gelezen als afbeelding (beschadigd of niet ondersteund).', 'This file cannot be read as an image (damaged or not supported).')); }
    }
    if (bmp.width * bmp.height > F.MAX_PIXELS) throw new Error(L('Afbeelding is te groot.', 'Image is too large.'));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    const img = E.fromRGBA(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    img.meta.format = ext.toUpperCase();
    return img;
  }
  async function openFiles(files) {
    for (const f of files) {
      overlay(L('Openen: ', 'Opening: ') + f.name);
      await nextFrame();
      try { const img = await decodeFile(f); await openImage(img, f.name); }
      catch (e) { overlay(null); await recoverWorker(); showError(L('Kan niet openen: ', 'Cannot open: ') + f.name, e, 'open ' + f.name); }
    }
    overlay(null);
  }
  async function openImage(img, name, opts) {
    const d = newDoc(img, name);
    await activate(d.id, true);
    if (!opts || opts.auto !== false) applyAction('auto', true);
    else commit(L('Openen', 'Open'), true);
    analyze();
  }
  async function openDemo() { overlay(L('Voorbeeld maken…', 'Creating sample…')); await nextFrame(); await openImage(E.makeDemo(1920, 1080, 7), 'Voorbeeld_nevel.fits'); overlay(null); }

  async function activate(id, fresh) {
    S.cur = id; S.region = null; S.viewMaskId = null; S.cropRect = null; S.ruler = null; S.compareSnap = false;
    renderAll();
    await sendSource(!fresh);
  }
  function closeDoc(id, force) {
    const i = S.docs.findIndex((d) => d.id === id); if (i < 0) return;
    const dd = S.docs[i];
    if (!force && dd.dirty && !window.confirm(L(`"${dd.name}" heeft bewerkingen die nog niet zijn geëxporteerd of als project opgeslagen. Toch sluiten?`, `"${dd.name}" has edits that have not been exported or saved as a project. Close anyway?`))) return;
    S.docs.splice(i, 1);
    if (S.cur === id) { const n = S.docs[Math.min(i, S.docs.length - 1)]; S.cur = null; if (n) activate(n.id); else renderAll(); }
    else renderTabs();
  }

  function buildSource(d) {
    let img = d.original; const g = d.geom; const ac = d.autoCrop && d.autoCropRect;
    img = ac ? E.cropImage(img, ac.x, ac.y, ac.x2 - ac.x, ac.y2 - ac.y) : E.cloneImage(img);
    for (let i = 0; i < g.rot; i++) img = E.rotate90(img);
    if (g.fh) E.flipH(img);
    if (g.fv) E.flipV(img);
    if (g.angle) img = E.rotateArbitrary(img, g.angle);
    if (g.crop) img = E.cropImage(img, g.crop.x * img.w, g.crop.y * img.h, g.crop.w * img.w, g.crop.h * img.h);
    if (g.bin && img.w > 400) img = E.bin2(img);
    if (g.scale && g.scale !== 1) img = E.resize(img, Math.max(8, Math.round(img.w * g.scale)), Math.max(8, Math.round(img.h * g.scale)));
    img.meta = d.original.meta;
    return img;
  }
  async function sendSource(preview) {
    const d = D(); if (!d) return;
    const token = ++S.token;
    busy(L('Bron voorbereiden…', 'Preparing source…'));
    let res;
    try {
      const img = buildSource(d);
      res = await proc.call({ cmd: 'source', img: { w: img.w, h: img.h, r: img.r, g: img.g, b: img.b, mono: img.mono, meta: img.meta }, fileName: d.name, previewSize: S.prefs.preview }, [img.r.buffer, img.g.buffer, img.b.buffer]);
    } catch (e) {
      busy(null);
      if (e && e.workerCrash) proc.lost = false; // reported here; do not loop
      showError(L('Foto kan niet worden voorbereid', 'Photo cannot be prepared'), e, 'source ' + d.name);
      return;
    }
    if (token !== S.token) return;
    if (res.replaced) toast(L(`${res.replaced} ongeldige pixelwaarden (NaN/oneindig) zijn vervangen door 0.`, `${res.replaced} invalid pixel values (NaN/infinity) were replaced by 0.`), 6000);
    const sizeChanged = !d.src || d.src.w !== res.w || d.src.h !== res.h;
    d.src = { w: res.w, h: res.h }; d.prevW = res.pw; d.prevH = res.ph; d.detected = res.detected;
    if (sizeChanged) { d.cx = res.w / 2; d.cy = res.h / 2; if (d.zoom !== 'fit') clampCenter(); }
    putCanvas(S.beforeCanvas, res.before, res.pw, res.ph);
    S.afterCanvas.width = res.pw; S.afterCanvas.height = res.ph; S.afterCanvas.getContext('2d').drawImage(S.beforeCanvas, 0, 0);
    S.region = null; S.chanCache = null; S.clipCanvas = null;
    busy(null);
    renderStatus(); draw();
    if (preview !== false) requestPreview();
    if (S.compareSnap) renderSnapshot();
  }
  async function analyze() {
    const d = D(); if (!d) return;
    try { const r = await proc.call({ cmd: 'analyze' }); d.analysis = r.analysis; renderPanels(['info']); } catch (e) { console.error(e); }
  }
  function putCanvas(canvas, rgba, w, h) {
    canvas.width = w; canvas.height = h;
    const id = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h);
    canvas.getContext('2d').putImageData(id, 0, 0);
    return id;
  }
  function busy(t) { if (t) { $('busyText').textContent = t; $('busy').classList.remove('hidden'); } else $('busy').classList.add('hidden'); }

  // -------------------------------------------------------------- history ---
  function docState(d) { return JSON.stringify({ layers: d.layers, geom: d.geom, autoCrop: d.autoCrop, sel: d.sel }); }
  function commit(label, immediate) {
    const d = D(); if (!d) return;
    clearTimeout(commit.t);
    const run = () => {
      const js = docState(d);
      if (d.history[d.hIndex] && d.history[d.hIndex].state === js) return;
      d.history = d.history.slice(0, d.hIndex + 1);
      d.history.push({ label, state: js });
      if (d.history.length > 150) d.history.shift();
      d.hIndex = d.history.length - 1;
      if (d.history.length > 1) d.dirty = true;
      renderPanels(['history']);
    };
    if (immediate) run(); else commit.t = setTimeout(run, 500);
  }
  async function restore(idx) {
    const d = D(); if (!d || idx < 0 || idx >= d.history.length) return;
    clearTimeout(commit.t);
    const st = JSON.parse(d.history[idx].state);
    const geomChanged = JSON.stringify(st.geom) !== JSON.stringify(d.geom) || st.autoCrop !== d.autoCrop;
    d.hIndex = idx; d.layers = st.layers; d.geom = st.geom; d.autoCrop = st.autoCrop; d.sel = st.sel;
    renderPanels(); renderOptions();
    if (geomChanged) await sendSource(); else requestPreview();
  }
  const undo = () => { const d = D(); if (d) restore(d.hIndex - 1); };
  const redo = () => { const d = D(); if (d) restore(d.hIndex + 1); };

  // --------------------------------------------------------------- layers ---
  function addLayer(op, params, extra, label) {
    const d = D(); if (!d) return null;
    const ly = O.newLayer(op, params, extra);
    if (d.selection && !(extra && extra.mask) && op !== 'text' && op !== 'heal') Object.assign(ly.mask, { type: 'shape', shape: deep(d.selection), shapeFeather: S.selFeather });
    const i = d.layers.findIndex((l) => l.id === d.sel);
    d.layers.splice(i < 0 ? d.layers.length : i + 1, 0, ly);
    d.sel = ly.id;
    S.panelTab.b = 'props';
    renderPanels(['layers', 'props']); requestPreview();
    commit(label || L('Nieuwe laag: ', 'New layer: ') + opName(op), true);
    return ly;
  }
  function deleteLayer(id) {
    const d = D(); if (!d) return; id = id || d.sel;
    const i = d.layers.findIndex((l) => l.id === id); if (i < 0) return;
    const [ly] = d.layers.splice(i, 1);
    const n = d.layers[Math.min(i, d.layers.length - 1)];
    d.sel = n ? n.id : null;
    if (S.viewMaskId === id) S.viewMaskId = null;
    renderPanels(['layers', 'props']); requestPreview(); commit(L('Laag verwijderd: ', 'Layer deleted: ') + layerTitle(ly), true);
  }
  function duplicateLayer() {
    const d = D(), ly = curLayer(); if (!ly) return;
    const c = deep(ly); c.id = O.newLayer(ly.op).id; c.name = layerTitle(ly) + L(' kopie', ' copy');
    d.layers.splice(d.layers.indexOf(ly) + 1, 0, c); d.sel = c.id;
    renderPanels(['layers', 'props']); requestPreview(); commit(L('Laag gedupliceerd', 'Layer duplicated'), true);
  }
  function moveLayer(dir) {
    const d = D(), ly = curLayer(); if (!ly) return;
    const i = d.layers.indexOf(ly), j = i + dir; if (j < 0 || j >= d.layers.length) return;
    d.layers.splice(i, 1); d.layers.splice(j, 0, ly);
    renderPanels(['layers']); requestPreview(); commit(L('Laagvolgorde', 'Layer order'), true);
  }
  function toggleLayer(id) { const d = D(), ly = d.layers.find((l) => l.id === id); if (!ly) return; ly.on = !ly.on; renderPanels(['layers']); if (ly.op === 'text') draw(); else requestPreview(); commit((ly.on ? L('Laag tonen', 'Show layer') : L('Laag verbergen', 'Hide layer')) + ': ' + layerTitle(ly), true); }
  function selectLayer(id) { const d = D(); if (!d) return; d.sel = id; if (S.viewMaskId && S.viewMaskId !== id) { S.viewMaskId = null; requestPreview(); } S.panelTab.b = 'props'; renderPanels(['layers', 'props']); renderOptions(); }
  const layerTitle = (ly) => ly.name || (ly.op === 'text' ? (ly.params.text || L('Tekst', 'Text')) : opName(ly.op));
  function setLayer(ly, key, val, label) { ly[key] = val; if (ly.op === 'text') draw(); else requestPreview(); renderPanels(['layers']); commit(label || L('Laag gewijzigd', 'Layer changed')); }
  function setParam(ly, key, val, label) { ly.params[key] = val; if (ly.op === 'text') draw(); else requestPreview(); commit(label || layerTitle(ly) + ': ' + key); }
  function setMask(ly, key, val) { ly.mask[key] = val; requestPreview(); renderPanels(['layers']); commit(L('Masker: ', 'Mask: ') + layerTitle(ly)); }

  function applyAction(name, initial) {
    const d = D(); if (!d) return;
    let layers, autoCrop = d.autoCrop;
    if (name.startsWith('my:')) {
      const a = store.get('actions', {})[name.slice(3)]; if (!a) return;
      layers = O.sanitizeLayers(a.layers).layers;
    } else {
      const r = O.presetLayers(name, d.detected);
      layers = r.layers; autoCrop = r.autoCrop !== false;
    }
    const keep = d.layers.filter((l) => l.op === 'text' || l.op === 'heal');
    d.layers = layers.concat(keep);
    d.sel = d.layers.length ? d.layers[d.layers.length - 1].id : null;
    d.action = name;
    renderPanels(); renderOptions();
    const label = (initial ? L('Openen + ', 'Open + ') : L('Actie: ', 'Action: ')) + actionName(name);
    if (autoCrop !== d.autoCrop && d.autoCropRect) { d.autoCrop = autoCrop; sendSource().then(() => commit(label, true)); }
    else { requestPreview(); commit(label, true); }
  }
  function actionName(name) {
    if (name.startsWith('my:')) return name.slice(3);
    for (const [, , list] of ACTIONS) for (const [k, , nl, en] of list) if (k === name) return L(nl, en);
    return name;
  }

  // ------------------------------------------------------------- preview ---
  function requestPreview() { S.previewPending = true; clearTimeout(requestPreview.t); requestPreview.t = setTimeout(() => { S.previewPending = false; runPreview(); }, 15); }
  async function runPreview() {
    const d = D(); if (!d || !d.src) return;
    if (S.previewBusy) { S.previewQueued = true; return; }
    S.previewBusy = true; busy(L('Bezig…', 'Working…'));
    try {
      do {
        S.previewQueued = false;
        const dd = D(); if (!dd || !dd.src) break;
        const token = S.token, docAt = dd.id;
        const res = await proc.call({ cmd: 'preview', layers: dd.layers, viewMask: S.viewMaskId, cacheSize: S.prefs.cache });
        if (token !== S.token || S.cur !== docAt) continue;
        S.afterData = putCanvas(S.afterCanvas, res.rgba, res.w, res.h);
        S.hist = res.hist; S.renderMs = res.ms; S.chanCache = null; S.clipCanvas = null;
        S.region = null;
        draw(); renderPanels(['nav', 'hist']); renderStatus();
        if (S.curveRedraw) S.curveRedraw();
      } while (S.previewQueued);
    } catch (e) {
      S.previewBusy = false; busy(null);
      if (await recoverWorker()) { showError(L('Voorbeeld kon niet worden berekend', 'Preview could not be computed'), e, 'preview'); return; }
      showError(L('Voorbeeld kon niet worden berekend', 'Preview could not be computed'), e, 'preview');
      return;
    }
    S.previewBusy = false;
    busy(null);
    if (needRegion()) scheduleRegion(20);
  }
  async function renderSnapshot() {
    const d = D(); if (!d || !d.snaps.length) return;
    const res = await proc.call({ cmd: 'snapshot', layers: JSON.parse(d.snaps[d.snaps.length - 1].state).layers });
    putCanvas(S.snapCanvas, res.rgba, res.w, res.h); draw();
  }

  // ---------------------------------------------------------------- view ---
  const view = $('view'), stage = $('stage');
  const dpr = () => window.devicePixelRatio || 1;
  function mapping() {
    const d = D(), W = stage.clientWidth, H = stage.clientHeight;
    if (!d || !d.src) return { s: 1, ox: 0, oy: 0 };
    if (d.zoom === 'fit') { const s = Math.min((W - 40) / d.src.w, (H - 40) / d.src.h); return { s, ox: (W - d.src.w * s) / 2, oy: (H - d.src.h * s) / 2 }; }
    const s = d.zoom / dpr();
    return { s, ox: W / 2 - d.cx * s, oy: H / 2 - d.cy * s };
  }
  const effZoom = () => mapping().s * dpr();
  function needRegion() { const d = D(); if (!d || !d.src || d.zoom === 'fit') return false; return d.zoom > (d.prevW / d.src.w) * 1.05; }
  function clampCenter() {
    const d = D(); if (!d || !d.src || d.zoom === 'fit') return;
    const s = d.zoom / dpr(), hw = stage.clientWidth / 2 / s, hh = stage.clientHeight / 2 / s;
    d.cx = d.src.w <= hw * 2 ? d.src.w / 2 : clamp(d.cx, hw, d.src.w - hw);
    d.cy = d.src.h <= hh * 2 ? d.src.h / 2 : clamp(d.cy, hh, d.src.h - hh);
  }
  const ZOOMS = [0.0625, 0.125, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8];
  function setZoom(z, at) {
    const d = D(); if (!d || !d.src) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    const m = mapping();
    const pt = at ? { x: (at.x - m.ox) / m.s, y: (at.y - m.oy) / m.s, sx: at.x, sy: at.y } : { x: d.zoom === 'fit' ? d.src.w / 2 : d.cx, y: d.zoom === 'fit' ? d.src.h / 2 : d.cy, sx: W / 2, sy: H / 2 };
    d.zoom = z;
    if (z !== 'fit') { const s = z / dpr(); d.cx = pt.x - (pt.sx - W / 2) / s; d.cy = pt.y - (pt.sy - H / 2) / s; }
    clampCenter(); S.region = null; draw(); renderStatus(); renderPanels(['nav']);
    if (needRegion()) scheduleRegion(30);
  }
  function zoomStep(dir, at) {
    const cur = effZoom();
    let z = dir > 0 ? ZOOMS.find((v) => v > cur * 1.01) : ZOOMS.slice().reverse().find((v) => v < cur * 0.99);
    if (!z) z = dir > 0 ? ZOOMS[ZOOMS.length - 1] : ZOOMS[0];
    setZoom(z, at);
  }

  function channelCanvas(src, ch) {
    S.chanCache = S.chanCache || new Map();
    if (S.chanCache.has(src) && S.chanCache.get(src).ch === ch) return S.chanCache.get(src).c;
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d'); g.drawImage(src, 0, 0);
    const id = g.getImageData(0, 0, c.width, c.height), a = id.data;
    for (let i = 0; i < a.length; i += 4) { const v = ch === 'r' ? a[i] : ch === 'g' ? a[i + 1] : ch === 'b' ? a[i + 2] : (a[i] + a[i + 1] + a[i + 2]) / 3; a[i] = a[i + 1] = a[i + 2] = v; }
    g.putImageData(id, 0, 0);
    S.chanCache.set(src, { ch, c });
    return c;
  }
  function clipCanvas() {
    if (S.clipCanvas || !S.afterData) return S.clipCanvas;
    const d0 = S.afterData, c = document.createElement('canvas'); c.width = d0.width; c.height = d0.height;
    const out = new ImageData(d0.width, d0.height), a = d0.data, o = out.data;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] >= 254 || a[i + 1] >= 254 || a[i + 2] >= 254) { o[i] = 255; o[i + 1] = 30; o[i + 2] = 30; o[i + 3] = 230; }
      else if (a[i] <= 1 && a[i + 1] <= 1 && a[i + 2] <= 1) { o[i] = 40; o[i + 1] = 120; o[i + 2] = 255; o[i + 3] = 230; }
    }
    c.getContext('2d').putImageData(out, 0, 0);
    return (S.clipCanvas = c);
  }

  let antsOffset = 0;
  setInterval(() => { const d = D(); if (d && d.selection) { antsOffset = (antsOffset + 1) % 8; draw(); } }, 150);

  function draw() {
    const d = D();
    const W = stage.clientWidth, H = stage.clientHeight, r = dpr();
    if (view.width !== Math.round(W * r) || view.height !== Math.round(H * r)) { view.width = Math.round(W * r); view.height = Math.round(H * r); }
    const g = view.getContext('2d');
    g.setTransform(r, 0, 0, r, 0, 0);
    g.fillStyle = '#262626'; g.fillRect(0, 0, W, H);
    $('startscreen').classList.toggle('hidden', !!d);
    if (!d || !d.src) return;
    const m = mapping(), dw = d.src.w * m.s, dh = d.src.h * m.s;
    g.fillStyle = '#000'; g.fillRect(m.ox, m.oy, dw, dh);
    g.imageSmoothingEnabled = effZoom() < 2; g.imageSmoothingQuality = 'high';
    const ch = S.channel;
    const pick = (cv) => (ch === 'rgb' ? cv : channelCanvas(cv, ch));
    const paint = (which, x0, x1) => {
      if (x1 <= x0) return;
      g.save(); g.beginPath(); g.rect(x0, 0, x1 - x0, H); g.clip();
      const base = which === 'before' ? (S.compareSnap ? S.snapCanvas : S.beforeCanvas) : S.afterCanvas;
      g.drawImage(pick(base), m.ox, m.oy, dw, dh);
      const R = S.region;
      if (R && d.zoom !== 'fit') {
        const c = which === 'before' ? R.beforeCanvas : R.afterCanvas;
        if (c && (which === 'after' || !S.compareSnap || R.snap)) g.drawImage(pick(c), m.ox + R.rect.x * m.s, m.oy + R.rect.y * m.s, R.rect.w * m.s, R.rect.h * m.s);
      }
      if (which === 'after') {
        if (S.clip && clipCanvas()) { g.imageSmoothingEnabled = false; g.drawImage(S.clipCanvas, m.ox, m.oy, dw, dh); }
        drawTexts(g, m.ox, m.oy, dw, dh, d.layers);
      }
      g.restore();
    };
    if (S.showOriginal) paint('before', 0, W);
    else if (S.split || S.compareSnap) {
      const sx = clamp(S.splitX * W, 0, W);
      paint('before', 0, sx); paint('after', sx, W);
      g.fillStyle = '#fff'; g.fillRect(sx - 0.5, 0, 1, H);
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(sx - 45, 6, 90, 18);
      g.fillStyle = '#fff'; g.font = '11px Segoe UI, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(S.compareSnap ? L('opname | nu', 'snapshot | now') : L('voor | na', 'before | after'), sx, 15);
    } else paint('after', 0, W);
    if (S.grid) {
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath();
      for (let i = 1; i < 3; i++) { g.moveTo(m.ox + dw * i / 3, m.oy); g.lineTo(m.ox + dw * i / 3, m.oy + dh); g.moveTo(m.ox, m.oy + dh * i / 3); g.lineTo(m.ox + dw, m.oy + dh * i / 3); }
      g.stroke();
    }
    const ants = (sh, x, y, w, h) => {
      for (const [col, off] of [['#000', 0], ['#fff', 4]]) {
        g.save(); g.strokeStyle = col; g.lineWidth = 1; g.setLineDash([4, 4]); g.lineDashOffset = -antsOffset + off;
        g.beginPath(); if (sh === 'ellipse') g.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); else g.rect(x, y, w, h);
        g.stroke(); g.restore();
      }
    };
    if (d.selection) { const s = d.selection; ants(s.kind, m.ox + s.x * dw, m.oy + s.y * dh, s.w * dw, s.h * dh); }
    if (S.drag && S.drag.type === 'marquee') { const q = S.drag.rect; ants(S.drag.kind, m.ox + q.x * m.s, m.oy + q.y * m.s, q.w * m.s, q.h * m.s); }
    if (S.tool === 'crop' && S.cropRect) {
      const q = S.cropRect, x = m.ox + q.x * m.s, y = m.oy + q.y * m.s, w = q.w * m.s, h = q.h * m.s;
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, W, y); g.fillRect(0, y + h, W, H - y - h); g.fillRect(0, y, x, h); g.fillRect(x + w, y, W - x - w, h);
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w, h);
      g.strokeStyle = 'rgba(255,255,255,.4)'; g.beginPath();
      for (let i = 1; i < 3; i++) { g.moveTo(x + w * i / 3, y); g.lineTo(x + w * i / 3, y + h); g.moveTo(x, y + h * i / 3); g.lineTo(x + w, y + h * i / 3); }
      g.stroke();
      g.fillStyle = '#fff'; for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) g.fillRect(hx - 3, hy - 3, 6, 6);
    }
    if (S.ruler) {
      const a = S.ruler; g.strokeStyle = '#ffe14d'; g.lineWidth = 1.5; g.beginPath();
      g.moveTo(m.ox + a.x0 * m.s, m.oy + a.y0 * m.s); g.lineTo(m.ox + a.x1 * m.s, m.oy + a.y1 * m.s); g.stroke();
    }
    if (S.star && S.star.found && S.tool === 'star') {
      g.strokeStyle = '#4dff88'; g.lineWidth = 1.5; g.beginPath();
      g.arc(m.ox + S.star.x * m.s, m.oy + S.star.y * m.s, Math.max(6, S.star.fwhm * 1.5 * m.s), 0, Math.PI * 2); g.stroke();
    }
    if (S.drag && S.drag.type === 'stroke') {
      g.save();
      g.strokeStyle = S.drag.mode === 'hide' ? 'rgba(255,80,80,.8)' : S.drag.target === 'heal' ? 'rgba(255,220,90,.8)' : 'rgba(120,200,255,.8)';
      g.lineWidth = Math.max(1, S.drag.r * m.s * 2); g.lineCap = 'round'; g.lineJoin = 'round'; g.globalAlpha = 0.4;
      g.beginPath(); S.drag.pts.forEach((p, i) => { const x = m.ox + p[0] * d.src.w * m.s, y = m.oy + p[1] * d.src.h * m.s; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
      g.restore();
    }
    if (S.mouse && ['brush', 'eraser', 'heal'].includes(S.tool) && !S.spaceHeld) {
      const rr = (S.tool === 'heal' ? S.heal.size : S.brush.size) / 2 * m.s;
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1; g.beginPath(); g.arc(S.mouse.x, S.mouse.y, rr, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,.7)'; g.beginPath(); g.arc(S.mouse.x, S.mouse.y, rr + 1, 0, Math.PI * 2); g.stroke();
    }
    if (S.viewMaskId) { g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(8, H - 26, 200, 18); g.fillStyle = '#ffcf70'; g.font = '11px Segoe UI, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(L('Laagmasker wordt getoond', 'Showing layer mask'), 14, H - 17); }
  }

  function drawTexts(g, x, y, w, h, layers) {
    for (const ly of layers) {
      if (ly.op !== 'text' || !ly.on) continue;
      const p = ly.params;
      const size = Math.max(4, (p.size || 0.045) * h);
      const font = p.font || '"Segoe UI", system-ui, sans-serif';
      g.save();
      g.globalAlpha = ly.opacity;
      g.fillStyle = p.color || '#fff';
      if (p.shadow !== false) { g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = size * 0.25; }
      g.textAlign = p.align || 'left'; g.textBaseline = 'alphabetic';
      const tx = x + (p.x === undefined ? 0.05 : p.x) * w, ty = y + (p.y === undefined ? 0.9 : p.y) * h;
      g.font = `${p.bold === false ? 400 : 600} ${size}px ${font}`;
      g.fillText(p.text || '', tx, ty);
      if (p.sub) { g.font = `400 ${size * 0.55}px ${font}`; g.fillText(p.sub, tx, ty + size * 0.75); }
      g.restore();
    }
  }
  function autoInfo() {
    const d = D(); if (!d) return { title: '', sub: '' };
    const meta = d.original.meta || {}, hd = meta.header || {}, fn = d.name || '';
    let title = meta.object || (d.detected && /^M\d+$/i.test(d.detected.label || '') ? d.detected.label : '');
    if (!title) { const m = fn.match(/\b(M\s?\d{1,3}|NGC\s?\d+|IC\s?\d+|Sh2-?\d+)\b/i); if (m) title = m[1].toUpperCase(); }
    if (!title) title = baseName(fn).replace(/[_-]+/g, ' ').slice(0, 40);
    const bits = [];
    const date = hd['DATE-OBS'] || (fn.match(/(20\d\d)[-_]?(\d\d)[-_]?(\d\d)/) || []).slice(1).join('-');
    if (date) bits.push(String(date).slice(0, 10));
    const exp = hd.EXPTIME || hd.EXPOSURE || (fn.match(/EXP[_-]?(\d+(?:\.\d+)?)/i) || [])[1], cnt = hd.STACKCNT || hd.NCOMBINE || meta.stacked;
    if (exp && cnt) { const tot = exp * cnt; bits.push(`${cnt} × ${exp}s = ${tot >= 3600 ? (tot / 3600).toFixed(1) + ' h' : Math.round(tot / 60) + ' min'}`); } else if (exp) bits.push(exp + 's');
    const scope = hd.TELESCOP || hd.INSTRUME || (/dwarf/i.test(fn) ? 'DWARF 3' : ''); if (scope) bits.push(String(scope));
    return { title, sub: bits.join('  ·  ') };
  }

  // --------------------------------------------------------------- region ---
  function scheduleRegion(delay) { clearTimeout(S.regionTimer); S.regionTimer = setTimeout(loadRegion, delay || 200); }
  async function loadRegion() {
    const d = D(); if (!d || !needRegion()) return;
    if (S.previewBusy) { scheduleRegion(200); return; }
    const m = mapping(), W = stage.clientWidth, H = stage.clientHeight;
    const x = Math.max(0, Math.floor(-m.ox / m.s)), y = Math.max(0, Math.floor(-m.oy / m.s));
    const w = Math.min(d.src.w - x, Math.ceil(W / m.s) + 1), h = Math.min(d.src.h - y, Math.ceil(H / m.s) + 1);
    if (w < 2 || h < 2) return;
    const token = S.token, key = JSON.stringify(d.layers) + S.viewMaskId + S.compareSnap;
    busy(L('Volle resolutie…', 'Full resolution…'));
    try {
      const snap = S.compareSnap && d.snaps.length ? JSON.parse(d.snaps[d.snaps.length - 1].state).layers : null;
      const res = await proc.call({ cmd: 'region', layers: d.layers, viewMask: S.viewMaskId, rect: { x, y, w, h }, beforeLayers: snap });
      if (token === S.token && key === JSON.stringify(d.layers) + S.viewMaskId + S.compareSnap && needRegion()) {
        const a = document.createElement('canvas'), b = document.createElement('canvas');
        putCanvas(a, res.rgba, res.w, res.h); putCanvas(b, res.before, res.w, res.h);
        S.region = { rect: res.rect, afterCanvas: a, beforeCanvas: b, snap: !!snap };
        draw();
      }
    } catch (e) { console.error(e); }
    busy(null);
  }

  // ---------------------------------------------------------------- tools ---
  const TOOLS = [
    ['move', '✥', 'Verplaatsen (tekst)', 'Move (text)', 'V'], ['hand', '✋', 'Hand', 'Hand', 'H'], ['zoom', '🔍', 'Zoomen', 'Zoom', 'Z'], '-',
    ['marquee', '⬚', 'Rechthoekselectie', 'Rectangular marquee', 'M'], ['ellipse', '◯', 'Ovaalselectie', 'Elliptical marquee', 'L'], ['crop', '⛶', 'Bijsnijden', 'Crop', 'C'], '-',
    ['eyedropper', '💧', 'Pipet', 'Eyedropper', 'I'], ['star', '✶', 'Sterinfo (FWHM)', 'Star info (FWHM)', 'S'], ['ruler', '📏', 'Liniaal', 'Ruler', 'R'], '-',
    ['brush', '🖌', 'Penseel (laagmasker)', 'Brush (layer mask)', 'B'], ['eraser', '◻', 'Gum (laagmasker)', 'Eraser (layer mask)', 'E'], ['heal', '✚', 'Herstelpenseel', 'Healing brush', 'J'], '-',
    ['text', 'T', 'Tekst', 'Type', 'T'],
  ];
  function setTool(t) {
    S.tool = t; S.pick = null;
    if (t === 'crop') { const d = D(); if (d && d.src) { if (d.zoom !== 'fit') setZoom('fit'); if (!S.cropRect) S.cropRect = { x: d.src.w * 0.05, y: d.src.h * 0.05, w: d.src.w * 0.9, h: d.src.h * 0.9 }; } }
    else S.cropRect = null;
    renderToolbar(); renderOptions(); updateCursor(); draw();
  }
  function updateCursor() {
    const c = { hand: 'grab', move: 'move', zoom: 'zoom-in', marquee: 'crosshair', ellipse: 'crosshair', crop: 'crosshair', eyedropper: 'crosshair', star: 'crosshair', ruler: 'crosshair', brush: 'none', eraser: 'none', heal: 'none', text: 'text' }[S.spaceHeld ? 'hand' : S.tool];
    stage.style.cursor = S.pick ? 'crosshair' : c || 'default';
  }
  function renderToolbar() {
    const tb = $('toolbar'); tb.innerHTML = '';
    for (const t of TOOLS) {
      if (t === '-') { tb.appendChild(el('div', 'tsep')); continue; }
      const [id, icon, nl, en, key] = t;
      const b = el('button', 'tool' + (S.tool === id ? ' on' : ''), `${icon}<span class="k">${key}</span>`);
      b.title = `${L(nl, en)} (${key})`; b.dataset.tool = id; b.onclick = () => setTool(id);
      tb.appendChild(b);
    }
    const cs = el('div', 'colors');
    cs.innerHTML = `<div class="fg" style="background:${S.fg}" title="${L('Voorgrond: wit = tonen, zwart = verbergen', 'Foreground: white = reveal, black = hide')}"></div><div class="bgc" style="background:${S.bgc}"></div><button class="swap" title="X">⇄</button>`;
    cs.querySelector('.swap').onclick = swapColors;
    tb.appendChild(cs);
  }
  function swapColors() { [S.fg, S.bgc] = [S.bgc, S.fg]; renderToolbar(); renderOptions(); }

  function renderOptions() {
    const ob = $('optionsbar'); ob.innerHTML = '';
    const t = TOOLS.find((x) => x !== '-' && x[0] === S.tool);
    ob.appendChild(el('div', 'tname', `<span class="ic">${t ? t[1] : ''}</span>${esc(t ? L(t[2], t[3]) : '')}`));
    const add = (n) => { ob.appendChild(n); return n; };
    const btn = (label, fn, cls) => { const b = el('button', 'btn sm' + (cls ? ' ' + cls : ''), esc(label)); b.onclick = fn; return add(b); };
    const rng = (label, val, min, max, step, fn, fmt) => {
      const l = el('label', '', `${esc(label)} <input type="range" min="${min}" max="${max}" step="${step}" value="${val}"><span class="val">${fmt ? fmt(val) : val}</span>`);
      const i = l.querySelector('input'), v = l.querySelector('.val'); i.oninput = () => { fn(+i.value); v.textContent = fmt ? fmt(+i.value) : i.value; };
      return add(l);
    };
    const sep = () => add(el('div', 'vsep'));
    const msg = (m) => add(el('span', 'msg', esc(m)));
    const d = D();
    if (S.pick) { msg(L('Klik op de foto om het punt te kiezen voor: ', 'Click the photo to pick the point for: ') + S.pick.label); btn(L('Annuleren', 'Cancel'), () => { S.pick = null; renderOptions(); updateCursor(); }); return; }
    switch (S.tool) {
      case 'hand': case 'zoom':
        btn(L('Passend (Ctrl+0)', 'Fit (Ctrl+0)'), () => setZoom('fit')); btn('100% (Ctrl+1)', () => setZoom(1)); btn('200%', () => setZoom(2));
        sep(); btn('−', () => zoomStep(-1)); btn('+', () => zoomStep(1));
        sep(); msg(S.tool === 'zoom' ? L('Klik = inzoomen, Alt+klik = uitzoomen', 'Click = zoom in, Alt+click = zoom out') : L('Sleep om te verschuiven. Spatie = tijdelijk hand. Dubbelklik = passend/100%.', 'Drag to pan. Space = temporary hand. Double-click = fit/100%.'));
        break;
      case 'move': msg(L('Selecteer een tekstlaag en sleep om de tekst te verplaatsen.', 'Select a text layer and drag to move the text.')); break;
      case 'marquee': case 'ellipse':
        rng(L('Doezelaar', 'Feather'), S.selFeather, 0, 0.1, 0.002, (v) => { S.selFeather = v; }, (v) => (v * 100).toFixed(1) + '%');
        sep(); btn(L('Alles selecteren', 'Select all'), selectAll); btn(L('Deselecteren', 'Deselect'), deselect); btn(L('Masker omkeren', 'Invert mask'), invertSelection);
        sep(); btn(L('Bijsnijden tot selectie', 'Crop to selection'), cropToSelection);
        btn(L('Masker van selectie op huidige laag', 'Mask from selection on current layer'), maskFromSelection);
        sep(); msg(L('Nieuwe aanpassingslagen krijgen de selectie als masker.', 'New adjustment layers get the selection as mask.'));
        break;
      case 'crop': {
        const s = el('select', '', [['0', L('Vrij', 'Free')], ['1', '1:1'], ['1.3333', '4:3'], ['1.5', '3:2'], ['1.7778', '16:9'], ['0.8', '4:5'], ['0.5625', '9:16'], ['2', '2:1']].map(([v, l]) => `<option value="${v}">${l}</option>`).join(''));
        s.value = String(S.cropAspect); s.onchange = () => { S.cropAspect = +s.value; fitCropAspect(); draw(); };
        add(el('label', '', esc(L('Verhouding', 'Ratio')))).appendChild(s);
        sep(); btn('✔ ' + L('Toepassen', 'Apply'), applyCrop, 'primary'); btn('✖ ' + L('Annuleren', 'Cancel'), () => setTool('hand'));
        sep(); btn(L('Bijsnijden herstellen', 'Reset crop'), () => setGeom('crop', null, L('Bijsnijden herstellen', 'Reset crop')));
        msg(L('Sleep een kader; sleep binnen het kader om het te verplaatsen. Enter = toepassen.', 'Drag a frame; drag inside to move it. Enter = apply.'));
        break;
      }
      case 'eyedropper': {
        const s = S.sample;
        if (s) { add(el('span', 'swatch-sm')).style.background = `rgb(${s.r},${s.g},${s.b})`; msg(`R ${s.r}  G ${s.g}  B ${s.b}   (${Math.round(s.x)}, ${Math.round(s.y)})`); }
        else msg(L('Klik op de foto om een kleur te meten.', 'Click the photo to sample a colour.'));
        sep(); btn(L('Als witbalans gebruiken', 'Use as white balance'), () => { if (S.sample) usePick('wbPick', S.sample); });
        btn(L('Als achtergrond gebruiken', 'Use as background'), () => { if (S.sample) usePick('bgPick', S.sample); });
        break;
      }
      case 'star': {
        const s = S.star;
        if (s && s.found) msg(`FWHM ${s.fwhm.toFixed(2)} px · ${L('rondheid', 'roundness')} ${(s.round * 100).toFixed(0)}% · SNR ${s.snr.toFixed(0)} · ${L('piek', 'peak')} ${(s.peak * 100).toFixed(1)}%${s.saturated ? ' · ' + L('verzadigd!', 'saturated!') : ''}`);
        else msg(L('Klik op een ster om scherpte (FWHM), rondheid en signaal te meten.', 'Click a star to measure sharpness (FWHM), roundness and signal.'));
        break;
      }
      case 'ruler': {
        const a = S.ruler;
        if (a) {
          const len = Math.hypot(a.x1 - a.x0, a.y1 - a.y0), ang = Math.atan2(a.y1 - a.y0, a.x1 - a.x0) * 180 / Math.PI;
          msg(`${L('Lengte', 'Length')} ${len.toFixed(1)} px · ${L('hoek', 'angle')} ${ang.toFixed(2)}°`); sep();
          btn(L('Rechtzetten langs liniaal', 'Straighten along ruler'), () => { let a2 = ang; while (a2 > 45) a2 -= 90; while (a2 < -45) a2 += 90; setGeom('angle', (d.geom.angle || 0) - a2, L('Rechtzetten', 'Straighten')); S.ruler = null; });
          btn(L('Wissen', 'Clear'), () => { S.ruler = null; draw(); renderOptions(); });
        } else msg(L('Sleep een lijn om afstand en hoek te meten.', 'Drag a line to measure distance and angle.'));
        break;
      }
      case 'brush': case 'eraser': {
        rng(L('Grootte', 'Size'), S.brush.size, 2, 800, 1, (v) => { S.brush.size = v; store.set('brushSize', v); }, (v) => v + ' px');
        rng(L('Hardheid', 'Hardness'), S.brush.hard, 0, 1, 0.01, (v) => { S.brush.hard = v; }, (v) => Math.round(v * 100) + '%');
        rng(L('Dekking', 'Opacity'), S.brush.flow, 0.05, 1, 0.01, (v) => { S.brush.flow = v; }, (v) => Math.round(v * 100) + '%');
        sep();
        const ly = curLayer();
        msg(ly ? L('Masker van: ', 'Mask of: ') + layerTitle(ly) + (S.tool === 'eraser' || S.fg === '#000000' ? L(' (verbergen)', ' (hide)') : L(' (tonen)', ' (reveal)')) + ' · X = ' + L('wissel', 'swap') : L('Selecteer eerst een laag in het Lagen-paneel.', 'First select a layer in the Layers panel.'));
        if (ly) { sep(); btn(L('Streken wissen', 'Clear strokes'), () => { ly.mask.strokes = []; requestPreview(); renderPanels(['layers', 'props']); commit(L('Masker gewist', 'Mask cleared'), true); }); }
        break;
      }
      case 'heal':
        rng(L('Grootte', 'Size'), S.heal.size, 2, 400, 1, (v) => { S.heal.size = v; }, (v) => v + ' px');
        rng(L('Hardheid', 'Hardness'), S.heal.hard, 0, 1, 0.01, (v) => { S.heal.hard = v; }, (v) => Math.round(v * 100) + '%');
        sep(); msg(L('Schilder over satellietstrepen, vliegtuigen, stof of hete pixels: ze worden opgevuld vanuit de omgeving.', 'Paint over satellite trails, planes, dust or hot pixels: they are filled from the surroundings.'));
        break;
      case 'text':
        rng(L('Grootte', 'Size'), S.text.size, 0.01, 0.2, 0.001, (v) => { S.text.size = v; const ly = curLayer(); if (ly && ly.op === 'text') setParam(ly, 'size', v); }, (v) => (v * 100).toFixed(1) + '%');
        { const c = el('input'); c.type = 'color'; c.value = S.text.color; c.oninput = () => { S.text.color = c.value; const ly = curLayer(); if (ly && ly.op === 'text') setParam(ly, 'color', c.value); }; add(c); }
        sep(); msg(L('Klik op de foto om een tekstlaag te plaatsen.', 'Click the photo to place a text layer.'));
        break;
      default: break;
    }
  }

  function selectAll() { const d = D(); if (!d) return; d.selection = { kind: 'rect', x: 0, y: 0, w: 1, h: 1 }; draw(); renderStatus(); }
  function deselect() { const d = D(); if (!d) return; d.selection = null; draw(); renderStatus(); }
  function invertSelection() {
    const ly = curLayer();
    if (ly && ly.mask && ly.mask.type !== 'none') { setMask(ly, 'invert', !ly.mask.invert); renderPanels(['props']); toast(L('Masker van de laag omgekeerd.', 'Layer mask inverted.')); }
    else toast(L('Omkeren werkt op het masker van de huidige laag.', 'Invert works on the mask of the current layer.'));
  }
  function maskFromSelection() {
    const d = D(), ly = curLayer(); if (!d || !ly || !d.selection || ly.op === 'text') { toast(L('Maak eerst een selectie en kies een laag.', 'Make a selection and choose a layer first.')); return; }
    Object.assign(ly.mask, { type: 'shape', shape: deep(d.selection), shapeFeather: S.selFeather });
    requestPreview(); renderPanels(['layers', 'props']); commit(L('Masker van selectie', 'Mask from selection'), true);
  }
  function cropToSelection() { const d = D(); if (!d || !d.selection) return; const s = d.selection; composeCrop({ x: s.x, y: s.y, w: s.w, h: s.h }); }
  function fitCropAspect() {
    const d = D(); if (!d || !S.cropRect || !S.cropAspect) return;
    const q = S.cropRect, cx = q.x + q.w / 2, cy = q.y + q.h / 2;
    let w = q.w, h = w / S.cropAspect; if (h > d.src.h) { h = d.src.h; w = h * S.cropAspect; }
    S.cropRect = { x: clamp(cx - w / 2, 0, d.src.w - w), y: clamp(cy - h / 2, 0, d.src.h - h), w, h };
  }
  function applyCrop() {
    const d = D(), q = S.cropRect; if (!d || !q || q.w < 8 || q.h < 8) return;
    composeCrop({ x: q.x / d.src.w, y: q.y / d.src.h, w: q.w / d.src.w, h: q.h / d.src.h });
    S.cropRect = null; setTool('hand');
  }
  function composeCrop(n) {
    const d = D(), old = d.geom.crop;
    setGeom('crop', old ? { x: old.x + n.x * old.w, y: old.y + n.y * old.h, w: n.w * old.w, h: n.h * old.h } : n, L('Bijsnijden', 'Crop'));
  }
  function setGeom(k, v, label) {
    const d = D(); if (!d) return;
    d.geom[k] = v; d.selection = null;
    for (const ly of d.layers) { if (ly.params.wbPick) ly.params.wbPick = null; if (ly.params.bgPick) ly.params.bgPick = null; }
    sendSource().then(() => commit(label || L('Afbeelding', 'Image'), true));
    renderPanels(['props']);
  }
  function usePick(key, pt) {
    const d = D(); if (!d) return;
    let ly = d.layers.find((l) => l.op === 'colorcal');
    if (!ly) { const si = d.layers.findIndex((l) => l.op === 'stretch'); ly = O.newLayer('colorcal'); d.layers.splice(si < 0 ? 0 : si, 0, ly); }
    ly.params[key] = { x: pt.x / d.src.w, y: pt.y / d.src.h };
    d.sel = ly.id; requestPreview(); renderPanels(['layers', 'props']);
    commit(key === 'wbPick' ? L('Witbalans met pipet', 'White balance picker') : L('Achtergrond met pipet', 'Background picker'), true);
    toast(L('Kleurkalibratie aangepast.', 'Colour calibration adjusted.'));
  }

  // ------------------------------------------------------- pointer handling ---
  function toSrc(e) { const r = stage.getBoundingClientRect(), m = mapping(); return { x: (e.clientX - r.left - m.ox) / m.s, y: (e.clientY - r.top - m.oy) / m.s, sx: e.clientX - r.left, sy: e.clientY - r.top }; }
  stage.addEventListener('pointerdown', (e) => {
    const d = D(); if (!d || !d.src || e.button === 2 || e.target.closest('.startscreen')) return;
    const p = toSrc(e);
    stage.setPointerCapture(e.pointerId);
    const W = stage.clientWidth;
    if ((S.split || S.compareSnap) && Math.abs(p.sx - S.splitX * W) < 8 && !S.spaceHeld) { S.drag = { type: 'split' }; return; }
    if (S.pick) {
      const ly = d.layers.find((l) => l.id === S.pick.layer);
      if (ly) { ly.params[S.pick.key] = { x: clamp(p.x / d.src.w, 0, 1), y: clamp(p.y / d.src.h, 0, 1) }; requestPreview(); commit(S.pick.label, true); }
      S.pick = null; renderOptions(); renderPanels(['props']); updateCursor(); return;
    }
    const tool = S.spaceHeld || e.button === 1 ? 'hand' : S.tool;
    const inside = p.x >= 0 && p.y >= 0 && p.x <= d.src.w && p.y <= d.src.h;
    switch (tool) {
      case 'hand':
        if (d.zoom === 'fit') { const z = effZoom(); d.zoom = z; d.cx = d.src.w / 2; d.cy = d.src.h / 2; }
        S.drag = { type: 'pan', x: e.clientX, y: e.clientY, cx: d.cx, cy: d.cy }; stage.style.cursor = 'grabbing'; break;
      case 'zoom': zoomStep(e.altKey ? -1 : 1, { x: p.sx, y: p.sy }); break;
      case 'move': {
        const ly = curLayer();
        if (ly && ly.op === 'text') S.drag = { type: 'text', ly, x0: p.x, y0: p.y, px: ly.params.x, py: ly.params.y };
        break;
      }
      case 'marquee': case 'ellipse': S.drag = { type: 'marquee', kind: tool === 'ellipse' ? 'ellipse' : 'rect', x0: clamp(p.x, 0, d.src.w), y0: clamp(p.y, 0, d.src.h), rect: { x: p.x, y: p.y, w: 0, h: 0 } }; break;
      case 'crop': {
        const q = S.cropRect;
        if (q && p.x > q.x && p.y > q.y && p.x < q.x + q.w && p.y < q.y + q.h) S.drag = { type: 'cropmove', dx: p.x - q.x, dy: p.y - q.y };
        else S.drag = { type: 'crop', x0: clamp(p.x, 0, d.src.w), y0: clamp(p.y, 0, d.src.h) };
        break;
      }
      case 'eyedropper': if (inside) sampleAt(p); break;
      case 'star': if (inside) probeStar(p); break;
      case 'ruler': S.ruler = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; S.drag = { type: 'ruler' }; break;
      case 'brush': case 'eraser': {
        const ly = curLayer();
        if (!ly || ly.op === 'text') { toast(L('Selecteer eerst een aanpassingslaag om op het masker te schilderen.', 'Select an adjustment layer first to paint on its mask.')); return; }
        const mode = S.tool === 'eraser' || S.fg === '#000000' ? 'hide' : 'show';
        S.drag = { type: 'stroke', target: 'mask', ly, mode, r: S.brush.size / 2, hard: S.brush.hard, a: S.brush.flow, pts: [[p.x / d.src.w, p.y / d.src.h]] };
        draw(); break;
      }
      case 'heal': S.drag = { type: 'stroke', target: 'heal', mode: 'show', r: S.heal.size / 2, hard: S.heal.hard, a: 1, pts: [[p.x / d.src.w, p.y / d.src.h]] }; draw(); break;
      case 'text': if (inside) addText(p); break;
      default: break;
    }
  });
  stage.addEventListener('pointermove', (e) => {
    const d = D(); if (!d || !d.src) return;
    const p = toSrc(e);
    S.mouse = { x: p.sx, y: p.sy };
    statusPixel(p);
    const dr = S.drag;
    if (!dr) { if (['brush', 'eraser', 'heal'].includes(S.tool)) draw(); return; }
    switch (dr.type) {
      case 'split': S.splitX = clamp(p.sx / stage.clientWidth, 0, 1); draw(); break;
      case 'pan': { const s = mapping().s; d.cx = dr.cx - (e.clientX - dr.x) / s; d.cy = dr.cy - (e.clientY - dr.y) / s; clampCenter(); S.region = null; draw(); break; }
      case 'text': dr.ly.params.x = clamp(dr.px + (p.x - dr.x0) / d.src.w, 0, 1); dr.ly.params.y = clamp(dr.py + (p.y - dr.y0) / d.src.h, 0, 1); draw(); break;
      case 'marquee': {
        const x1 = clamp(p.x, 0, d.src.w), y1 = clamp(p.y, 0, d.src.h); let w = Math.abs(x1 - dr.x0), h = Math.abs(y1 - dr.y0);
        if (e.shiftKey) w = h = Math.min(w, h);
        dr.rect = { x: x1 < dr.x0 ? dr.x0 - w : dr.x0, y: y1 < dr.y0 ? dr.y0 - h : dr.y0, w, h }; draw(); break;
      }
      case 'crop': {
        const x1 = clamp(p.x, 0, d.src.w), y1 = clamp(p.y, 0, d.src.h); let w = Math.abs(x1 - dr.x0), h = Math.abs(y1 - dr.y0);
        if (S.cropAspect) { if (w / Math.max(h, 1e-6) > S.cropAspect) w = h * S.cropAspect; else h = w / S.cropAspect; }
        S.cropRect = { x: x1 < dr.x0 ? dr.x0 - w : dr.x0, y: y1 < dr.y0 ? dr.y0 - h : dr.y0, w, h }; draw(); break;
      }
      case 'cropmove': { const q = S.cropRect; q.x = clamp(p.x - dr.dx, 0, d.src.w - q.w); q.y = clamp(p.y - dr.dy, 0, d.src.h - q.h); draw(); break; }
      case 'ruler': S.ruler.x1 = p.x; S.ruler.y1 = p.y; draw(); renderOptions(); break;
      case 'stroke': dr.pts.push([p.x / d.src.w, p.y / d.src.h]); draw(); break;
      default: break;
    }
  });
  function endDrag() {
    const d = D(), dr = S.drag; S.drag = null; updateCursor();
    if (!d || !dr) return;
    if (dr.type === 'pan') { renderPanels(['nav']); if (needRegion()) scheduleRegion(120); }
    if (dr.type === 'text') commit(L('Tekst verplaatst', 'Text moved'), true);
    if (dr.type === 'marquee') {
      const q = dr.rect;
      d.selection = q.w > 3 && q.h > 3 ? { kind: dr.kind, x: q.x / d.src.w, y: q.y / d.src.h, w: q.w / d.src.w, h: q.h / d.src.h } : null;
      draw(); renderStatus();
    }
    if (dr.type === 'stroke') {
      const st = { pts: simplify(dr.pts), r: dr.r / d.src.w, hard: dr.hard, a: dr.a, mode: dr.mode };
      if (dr.target === 'mask') {
        dr.ly.mask.strokes = (dr.ly.mask.strokes || []).concat([st]);
        requestPreview(); renderPanels(['layers', 'props']); commit(L('Penseel op masker', 'Brush on mask'), true);
      } else {
        let ly = curLayer();
        if (!ly || ly.op !== 'heal') ly = d.layers.slice().reverse().find((l) => l.op === 'heal');
        if (!ly) { ly = O.newLayer('heal'); d.layers.push(ly); }
        ly.params.strokes = (ly.params.strokes || []).concat([st]);
        d.sel = ly.id; requestPreview(); renderPanels(['layers', 'props']); commit(L('Herstelpenseel', 'Healing brush'), true);
      }
      draw();
    }
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', () => { S.mouse = null; draw(); });
  stage.addEventListener('dblclick', (e) => { const d = D(); if (!d) return; if (S.tool === 'hand') { const r = stage.getBoundingClientRect(); setZoom(d.zoom === 'fit' ? 1 : 'fit', d.zoom === 'fit' ? { x: e.clientX - r.left, y: e.clientY - r.top } : null); } if (S.tool === 'crop') applyCrop(); });
  stage.addEventListener('wheel', (e) => {
    const d = D(); if (!d || !d.src) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    if (e.ctrlKey || e.altKey || d.zoom === 'fit') { zoomStep(e.deltaY < 0 ? 1 : -1, { x: e.clientX - r.left, y: e.clientY - r.top }); return; }
    const s = mapping().s; d.cx += (e.shiftKey ? e.deltaY : e.deltaX) / s; d.cy += (e.shiftKey ? 0 : e.deltaY) / s; clampCenter(); S.region = null; draw();
    if (needRegion()) scheduleRegion(200);
  }, { passive: false });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  function simplify(pts) { const out = []; let last = null; for (const p of pts) { if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.0015) { out.push([+p[0].toFixed(5), +p[1].toFixed(5)]); last = p; } } if (!out.length && pts.length) out.push(pts[0]); return out; }

  function sampleAt(p) {
    const d = D(); if (!S.afterData) return;
    const x = Math.floor(p.x / d.src.w * S.afterData.width), y = Math.floor(p.y / d.src.h * S.afterData.height);
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = clamp(x + dx, 0, S.afterData.width - 1), yy = clamp(y + dy, 0, S.afterData.height - 1), i = (yy * S.afterData.width + xx) * 4; r += S.afterData.data[i]; g += S.afterData.data[i + 1]; b += S.afterData.data[i + 2]; n++; }
    S.sample = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), x: p.x, y: p.y };
    renderOptions(); renderPanels(['info']);
  }
  async function probeStar(p) { const r = await proc.call({ cmd: 'probeStar', x: p.x, y: p.y }); S.star = r; renderOptions(); renderPanels(['info']); draw(); }
  function addText(p) {
    const d = D(), inf = autoInfo();
    const hasText = d.layers.some((l) => l.op === 'text');
    const ly = addLayer('text', { text: hasText ? L('Tekst', 'Text') : inf.title, sub: hasText ? '' : inf.sub, x: p.x / d.src.w, y: p.y / d.src.h, size: S.text.size, color: S.text.color, align: 'left', bold: true, shadow: true }, null, L('Tekstlaag', 'Text layer'));
    if (ly) { draw(); setTool('move'); }
  }
  function statusPixel(p) {
    const d = D(); if (!S.afterData || !d) return;
    const e = $('stPix'); if (!e) return;
    const inside = p.x >= 0 && p.y >= 0 && p.x < d.src.w && p.y < d.src.h;
    if (!inside) { e.textContent = ''; return; }
    const x = Math.floor(p.x / d.src.w * S.afterData.width), y = Math.floor(p.y / d.src.h * S.afterData.height), i = (y * S.afterData.width + x) * 4, a = S.afterData.data;
    e.innerHTML = `X <b>${Math.floor(p.x)}</b> Y <b>${Math.floor(p.y)}</b> &nbsp; R <b>${a[i]}</b> G <b>${a[i + 1]}</b> B <b>${a[i + 2]}</b>`;
    S.cursorRGB = [a[i], a[i + 1], a[i + 2], Math.floor(p.x), Math.floor(p.y)];
    renderInfoCursor();
  }

  // ------------------------------------------------------------- menus ---
  const SHORT_OPS = { levels: 'Ctrl+L', curves: 'Ctrl+M', huesat: 'Ctrl+U', colorbalance: 'Ctrl+B', invert: 'Ctrl+I', bw: 'Alt+Shift+Ctrl+B' };
  function adjMenu(groups) {
    const items = [];
    for (const g of groups) for (const k of Object.keys(O.OPS).filter((x) => O.OPS[x].g === g && x !== 'text')) items.push({ label: opName(k), icon: ICON[k], action: () => addLayer(k), shortcut: SHORT_OPS[k], help: helpOf(k) });
    return items;
  }
  function menus() {
    const d = D(), has = !!d, ly = curLayer();
    return [
      [L('Bestand', 'File'), [
        { label: L('Openen…', 'Open…'), shortcut: 'Ctrl+O', action: () => $('fileInput').click() },
        { label: L('Voorbeeld openen', 'Open sample'), action: openDemo },
        { label: L('Sessies combineren (stacken)…', 'Combine sessions (stack)…'), action: () => stackDialog() },
        '-',
        { label: L('Sluiten', 'Close'), shortcut: 'Ctrl+W', action: () => d && closeDoc(d.id), dis: !has },
        { label: L('Alles sluiten', 'Close all'), action: () => { const n = S.docs.filter((x) => x.dirty).length; if (n && !window.confirm(L(`${n} document(en) hebben niet-opgeslagen bewerkingen. Toch alles sluiten?`, `${n} document(s) have unsaved edits. Close all anyway?`))) return; S.docs = []; S.cur = null; renderAll(); }, dis: !has },
        '-',
        { label: L('Exporteren als…', 'Export as…'), shortcut: 'Ctrl+S', action: exportDialog, dis: !has },
        { label: L('Snel exporteren (laatste instellingen)', 'Quick export (last settings)'), shortcut: 'Shift+Ctrl+S', action: quickExport, dis: !has },
        { label: L('Project opslaan (.json)…', 'Save project (.json)…'), shortcut: 'Alt+Ctrl+S', action: saveProject, dis: !has },
        { label: L('Project / lagen laden…', 'Load project / layers…'), action: () => importJSON('project'), dis: !has },
        '-',
        { label: L('Batchverwerking…', 'Batch processing…'), action: batchDialog },
      ]],
      [L('Bewerken', 'Edit'), [
        { label: L('Ongedaan maken', 'Undo'), shortcut: 'Ctrl+Z', action: undo, dis: !has || d.hIndex <= 0 },
        { label: L('Opnieuw', 'Redo'), shortcut: 'Shift+Ctrl+Z', action: redo, dis: !has || d.hIndex >= d.history.length - 1 },
        '-',
        { label: L('Momentopname maken', 'New snapshot'), action: takeSnapshot, dis: !has },
        '-',
        { label: L('Voorkeuren…', 'Preferences…'), shortcut: 'Ctrl+K', action: prefsDialog },
      ]],
      [L('Afbeelding', 'Image'), [
        { label: L('Aanpassingen', 'Adjustments'), sub: adjMenu(['adjust']), dis: !has },
        '-',
        { label: L('Automatische tint', 'Auto tone'), shortcut: 'Shift+Ctrl+L', action: () => addLayer('autotone', { mode: 'tone' }), dis: !has },
        { label: L('Automatisch contrast', 'Auto contrast'), shortcut: 'Alt+Shift+Ctrl+L', action: () => addLayer('autotone', { mode: 'contrast' }), dis: !has },
        { label: L('Automatische kleur', 'Auto colour'), shortcut: 'Shift+Ctrl+B', action: () => addLayer('autotone', { mode: 'color' }), dis: !has },
        '-',
        { label: L('Afbeeldingsgrootte…', 'Image size…'), shortcut: 'Alt+Ctrl+I', action: sizeDialog, dis: !has },
        { label: L('Afbeelding roteren', 'Image rotation'), dis: !has, sub: has ? [
          { label: L('90° rechtsom', '90° clockwise'), action: () => setGeom('rot', (d.geom.rot + 1) % 4, L('Roteren', 'Rotate')) },
          { label: L('90° linksom', '90° counter clockwise'), action: () => setGeom('rot', (d.geom.rot + 3) % 4, L('Roteren', 'Rotate')) },
          { label: '180°', action: () => setGeom('rot', (d.geom.rot + 2) % 4, L('Roteren', 'Rotate')) },
          { label: L('Willekeurig / rechtzetten…', 'Arbitrary / straighten…'), action: rotateDialog },
          '-',
          { label: L('Horizontaal spiegelen', 'Flip horizontal'), action: () => setGeom('fh', !d.geom.fh, L('Spiegelen', 'Flip')) },
          { label: L('Verticaal spiegelen', 'Flip vertical'), action: () => setGeom('fv', !d.geom.fv, L('Spiegelen', 'Flip')) },
        ] : [] },
        { label: L('Bijsnijden', 'Crop'), shortcut: 'C', action: () => setTool('crop'), dis: !has },
        { label: L('Bijsnijden tot selectie', 'Crop to selection'), action: cropToSelection, dis: !has || !d.selection },
        { label: L('Stackranden automatisch wegsnijden', 'Auto-crop stacking borders'), chk: has && d.autoCrop, action: () => { d.autoCrop = !d.autoCrop; sendSource().then(() => commit(L('Randen bijsnijden', 'Crop borders'), true)); }, dis: !has || !d.autoCropRect },
        { label: L('2×2 binning (minder ruis)', '2×2 binning (less noise)'), chk: has && d.geom.bin, action: () => setGeom('bin', !d.geom.bin, 'Binning'), dis: !has },
        { label: L('Geometrie herstellen', 'Reset geometry'), action: () => { d.geom = deep(GEOM0); sendSource().then(() => commit(L('Geometrie herstellen', 'Reset geometry'), true)); }, dis: !has },
      ]],
      [L('Laag', 'Layer'), [
        { label: L('Nieuwe aanpassingslaag', 'New adjustment layer'), sub: adjMenu(['adjust']), dis: !has },
        { label: L('Nieuwe astro-laag', 'New astro layer'), sub: adjMenu(['astro', 'stretch', 'nb', 'stars']), dis: !has },
        { label: L('Nieuwe filterlaag', 'New filter layer'), sub: adjMenu(['noise', 'detail', 'filter', 'repair']), dis: !has },
        { label: L('Nieuwe tekstlaag', 'New text layer'), action: () => { const dd = D(); addText({ x: dd.src.w * 0.04, y: dd.src.h * 0.93 }); }, dis: !has },
        '-',
        { label: L('Laag dupliceren', 'Duplicate layer'), shortcut: 'Ctrl+J', action: duplicateLayer, dis: !ly },
        { label: L('Laag verwijderen', 'Delete layer'), shortcut: 'Del', action: () => deleteLayer(), dis: !ly },
        { label: L('Laag omhoog', 'Bring forward'), shortcut: 'Ctrl+]', action: () => moveLayer(1), dis: !ly },
        { label: L('Laag omlaag', 'Send backward'), shortcut: 'Ctrl+[', action: () => moveLayer(-1), dis: !ly },
        { label: L('Laag tonen/verbergen', 'Show/hide layer'), shortcut: 'Ctrl+,', action: () => ly && toggleLayer(ly.id), dis: !ly },
        '-',
        { label: L('Laagmasker', 'Layer mask'), dis: !ly || ly.op === 'text', sub: ly && ly.op !== 'text' ? maskMenu(ly).concat(['-', { label: L('Masker omkeren', 'Invert mask'), action: () => { setMask(ly, 'invert', !ly.mask.invert); renderPanels(['props']); } }, { label: L('Masker tonen', 'Show mask'), chk: S.viewMaskId === ly.id, action: () => toggleViewMask(ly) }]) : [] },
        '-',
        { label: L('Alle lagen verwijderen', 'Delete all layers'), action: () => { D().layers = []; D().sel = null; renderPanels(); requestPreview(); commit(L('Alle lagen verwijderd', 'All layers deleted'), true); }, dis: !has },
      ]],
      [L('Selecteren', 'Select'), [
        { label: L('Alles', 'All'), shortcut: 'Ctrl+A', action: selectAll, dis: !has },
        { label: L('Deselecteren', 'Deselect'), shortcut: 'Ctrl+D', action: deselect, dis: !has },
        { label: L('Masker omkeren', 'Invert mask'), shortcut: 'Shift+Ctrl+I', action: invertSelection, dis: !has },
        '-',
        { label: L('Rechthoekselectie', 'Rectangular marquee'), shortcut: 'M', action: () => setTool('marquee') },
        { label: L('Ovaalselectie', 'Elliptical marquee'), shortcut: 'L', action: () => setTool('ellipse') },
        '-',
        { label: L('Masker van selectie op huidige laag', 'Mask from selection on current layer'), action: maskFromSelection, dis: !has || !d.selection || !ly },
      ]],
      [L('Filter', 'Filter'), [
        { label: L('Ruis', 'Noise'), sub: adjMenu(['noise']), dis: !has },
        { label: L('Verscherpen en detail', 'Sharpen and detail'), sub: adjMenu(['detail']), dis: !has },
        { label: L('Vervagen, stileren en overige', 'Blur, stylise and other'), sub: adjMenu(['filter']), dis: !has },
        { label: L('Herstellen', 'Repair'), sub: adjMenu(['repair']), dis: !has },
      ]],
      ['Astro', [
        { label: '✨ ' + L('Automatisch bewerken', 'Automatic processing'), action: () => applyAction('auto'), dis: !has },
        { label: L('Acties (stijlen)', 'Actions (styles)'), dis: !has, sub: ACTIONS.flatMap(([gnl, gen, list], i) => (i ? ['-'] : []).concat(list.map(([k, , nl, en]) => ({ label: L(nl, en), action: () => applyAction(k) })))) },
        '-',
        { label: L('Voorbewerking', 'Pre-processing'), sub: adjMenu(['astro']), dis: !has },
        { label: L('Oprekken', 'Stretch'), sub: adjMenu(['stretch']), dis: !has },
        { label: L('Narrowband / duoband', 'Narrowband / dual-band'), sub: adjMenu(['nb']), dis: !has },
        { label: L('Sterren', 'Stars'), sub: adjMenu(['stars']), dis: !has },
        '-',
        { label: L('Sterinfo meten (FWHM)', 'Measure star (FWHM)'), action: () => setTool('star'), dis: !has },
        { label: L('Sessies combineren (stacken)…', 'Combine sessions (stack)…'), action: () => stackDialog() },
        { label: L('Analyse tonen', 'Show analysis'), action: () => { S.panelTab.a = 'info'; renderDock(); }, dis: !has },
      ]],
      [L('Weergave', 'View'), [
        { label: L('Inzoomen', 'Zoom in'), shortcut: 'Ctrl++', action: () => zoomStep(1), dis: !has },
        { label: L('Uitzoomen', 'Zoom out'), shortcut: 'Ctrl+-', action: () => zoomStep(-1), dis: !has },
        { label: L('Passend in venster', 'Fit on screen'), shortcut: 'Ctrl+0', action: () => setZoom('fit'), dis: !has },
        { label: '100%', shortcut: 'Ctrl+1', action: () => setZoom(1), dis: !has },
        { label: '200%', action: () => setZoom(2), dis: !has },
        '-',
        { label: L('Origineel tonen', 'Show original'), shortcut: '\\', chk: S.showOriginal, action: () => { S.showOriginal = !S.showOriginal; draw(); } },
        { label: L('Voor/na splitsen', 'Split before/after'), shortcut: 'Y', chk: S.split, action: () => { S.split = !S.split; draw(); } },
        { label: L('Vergelijken met momentopname', 'Compare with snapshot'), chk: S.compareSnap, dis: !has || !d.snaps.length, action: () => { S.compareSnap = !S.compareSnap; if (S.compareSnap) renderSnapshot(); S.region = null; draw(); if (needRegion()) scheduleRegion(20); } },
        '-',
        { label: L('Kanalen', 'Channels'), sub: [['rgb', 'RGB', 'RGB', 'Ctrl+2'], ['r', 'Rood', 'Red', 'Ctrl+3'], ['g', 'Groen', 'Green', 'Ctrl+4'], ['b', 'Blauw', 'Blue', 'Ctrl+5'], ['l', 'Helderheid', 'Luminance', 'Ctrl+6']].map(([k, nl, en, sc]) => ({ label: L(nl, en), shortcut: sc, chk: S.channel === k, action: () => { S.channel = k; draw(); renderStatus(); } })) },
        { label: L('Over-/onderbelichting tonen', 'Show clipping'), shortcut: 'Alt+K', chk: S.clip, action: () => { S.clip = !S.clip; draw(); } },
        { label: L('Laagmasker tonen', 'Show layer mask'), chk: !!S.viewMaskId, dis: !ly, action: () => toggleViewMask(ly) },
        { label: L('Raster (derden)', 'Grid (thirds)'), shortcut: "Ctrl+'", chk: S.grid, action: () => { S.grid = !S.grid; draw(); } },
      ]],
      [L('Venster', 'Window'), [
        ...[['nav', 'Navigator', 'Navigator'], ['hist', 'Histogram', 'Histogram'], ['info', 'Info', 'Info'], ['props', 'Eigenschappen', 'Properties'], ['adj', 'Aanpassingen', 'Adjustments'], ['layers', 'Lagen', 'Layers'], ['history', 'Geschiedenis', 'History'], ['actions', 'Acties', 'Actions']].map(([k, nl, en]) => ({ label: L(nl, en), chk: S.panels[k], action: () => { S.panels[k] = !S.panels[k]; store.set('panels', S.panels); renderDock(); } })),
        '-',
        { label: L('Eenvoudige modus', 'Simple mode'), chk: S.mode === 'simple', action: () => setMode(S.mode === 'simple' ? 'expert' : 'simple') },
        { label: L('Werkruimte herstellen', 'Reset workspace'), action: () => { S.panels = { nav: true, hist: true, info: true, props: true, adj: true, layers: true, history: true, actions: true }; store.set('panels', S.panels); renderDock(); } },
      ]],
      [L('Help', 'Help'), [
        { label: L('AstroPolish Help', 'AstroPolish Help'), shortcut: 'F1', action: helpDialog },
        { label: L('Sneltoetsen', 'Keyboard shortcuts'), action: keysDialog },
        { label: L('Eenvoudige modus', 'Simple mode'), chk: S.mode === 'simple', action: () => setMode(S.mode === 'simple' ? 'expert' : 'simple') },
        '-',
        { label: 'Nederlands', chk: I18N.getLang() === 'nl', action: () => { I18N.setLang('nl'); renderAll(); } },
        { label: 'English', chk: I18N.getLang() === 'en', action: () => { I18N.setLang('en'); renderAll(); } },
        '-',
        { label: L('Over AstroPolish', 'About AstroPolish'), action: aboutDialog },
      ]],
    ];
  }
  function maskMenu(ly) {
    return MASK_TYPES.map(([k, nl, en]) => ({ label: L(nl, en), chk: ly.mask.type === k, action: () => { const d = D(); if (k === 'shape' && d.selection) Object.assign(ly.mask, { shape: deep(d.selection), shapeFeather: S.selFeather }); setMask(ly, 'type', k); renderPanels(['props']); } }));
  }

  let openMenu = null;
  function renderMenubar() {
    const mb = $('menubar'); mb.innerHTML = '';
    mb.appendChild(el('span', '', '<svg class="logo" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#1473e6"/><path d="M32 12l3.2 12.8L48 28l-12.8 3.2L32 44l-3.2-12.8L16 28l12.8-3.2z" fill="#fff"/></svg>'));
    const ms = menus();
    ms.forEach(([label], idx) => {
      if (S.mode === 'simple' && ![0, 1, 7, 9].includes(idx)) return;
      const b = el('button', 'mtop', esc(label));
      b.onclick = (e) => { e.stopPropagation(); if (openMenu === idx) closeMenus(); else showTopMenu(idx, b); };
      b.onmouseenter = () => { if (openMenu !== null && openMenu !== idx && openMenu >= 0) showTopMenu(idx, b); };
      mb.appendChild(b);
    });
    mb.appendChild(el('span', 'spacer'));
    const sw = el('div', 'modeswitch');
    for (const [m, nl, en, tnl, ten] of [['simple', 'Eenvoudig', 'Simple', 'Stijl kiezen, een paar schuifjes, opslaan', 'Pick a style, a few sliders, save'], ['expert', 'Expert', 'Expert', 'Alle gereedschappen, lagen en maskers (Photoshop-stijl)', 'All tools, layers and masks (Photoshop style)']]) {
      const b = el('button', S.mode === m ? 'on' : '', esc(L(nl, en))); b.title = L(tnl, ten); b.dataset.mode = m; b.onclick = (e) => { e.stopPropagation(); if (S.mode !== m) setMode(m); }; sw.appendChild(b);
    }
    mb.appendChild(sw);
    mb.appendChild(el('span', 'appname', 'AstroPolish 3'));
  }
  function closeMenus() { $('menuLayer').innerHTML = ''; openMenu = null; document.querySelectorAll('.mtop').forEach((x) => x.classList.remove('open')); }
  function showTopMenu(idx, btn) {
    closeMenus(); openMenu = idx; btn.classList.add('open');
    const r = btn.getBoundingClientRect();
    showMenu(menus()[idx][1], r.left, r.bottom, 0);
  }
  function showMenu(items, x, y, depth) {
    const layer = $('menuLayer');
    [...layer.querySelectorAll('.menu')].filter((m) => +m.dataset.depth >= depth).forEach((m) => m.remove());
    const m = el('div', 'menu'); m.dataset.depth = depth;
    for (const it of items) {
      if (it === '-') { m.appendChild(el('div', 'sep')); continue; }
      const mi = el('div', 'mi' + (it.dis ? ' dis' : '') + (it.sub ? ' sub' : ''), `<span class="chk">${it.chk ? '✓' : ''}</span>${it.icon ? `<span style="width:16px;text-align:center">${it.icon}</span>` : ''}<span>${esc(it.label)}</span>${it.shortcut ? `<span class="sc">${esc(it.shortcut)}</span>` : ''}`);
      if (it.help) mi.title = it.help;
      mi.onmouseenter = () => {
        m.querySelectorAll('.mi.open').forEach((o) => o.classList.remove('open'));
        [...layer.querySelectorAll('.menu')].filter((mm) => +mm.dataset.depth > depth).forEach((mm) => mm.remove());
        if (it.sub && !it.dis && it.sub.length) { mi.classList.add('open'); const rr = mi.getBoundingClientRect(); showMenu(it.sub, rr.right - 2, rr.top - 4, depth + 1); }
      };
      mi.onclick = (e) => { e.stopPropagation(); if (it.dis || it.sub) return; closeMenus(); if (it.action) it.action(); };
      m.appendChild(mi);
    }
    layer.appendChild(m);
    const mr = m.getBoundingClientRect();
    m.style.left = Math.max(0, Math.min(x, window.innerWidth - mr.width - 4)) + 'px';
    m.style.top = Math.max(0, Math.min(y, window.innerHeight - mr.height - 4)) + 'px';
  }
  document.addEventListener('click', () => { if (openMenu !== null) closeMenus(); });
  function popupMenu(items, x, y) { closeMenus(); openMenu = -1; showMenu(items, x, y, 0); }

  // -------------------------------------------------------- tabs, status ---
  function renderTabs() {
    const t = $('doctabs'); t.innerHTML = '';
    for (const d of S.docs) {
      const z = d.id === S.cur && d.src ? Math.round(effZoom() * 100) + '%' : '';
      const tab = el('div', 'doctab' + (d.id === S.cur ? ' on' : ''), `<span class="nm">${esc(d.name)}${z ? ' @ ' + z : ''}</span><button class="x" title="${L('Sluiten', 'Close')}">×</button>`);
      tab.onclick = () => { if (d.id !== S.cur) activate(d.id); };
      tab.querySelector('.x').onclick = (e) => { e.stopPropagation(); closeDoc(d.id); };
      t.appendChild(tab);
    }
    const plus = el('button', 'plus', '+'); plus.title = L('Openen', 'Open'); plus.onclick = () => $('fileInput').click(); t.appendChild(plus);
  }
  function renderStatus() {
    const d = D(), sb = $('statusbar');
    if (!d || !d.src) { sb.innerHTML = `<span>AstroPolish 3</span><span>${proc.isWorker ? L('Achtergrondproces actief', 'Background worker active') : L('Zonder achtergrondproces', 'No background worker')}</span>`; renderTabs(); return; }
    sb.innerHTML = `<span><b>${Math.round(effZoom() * 100)}%</b></span><span>${L('Document', 'Document')}: <b>${d.src.w} × ${d.src.h}</b> px · ${esc((d.original.meta && d.original.meta.format) || '')}</span><span>${L('Lagen', 'Layers')}: <b>${d.layers.length}</b></span><span>${L('Voorbeeld', 'Preview')}: <b>${S.renderMs} ms</b></span>${S.channel !== 'rgb' ? `<span>${L('Kanaal', 'Channel')}: <b>${S.channel.toUpperCase()}</b></span>` : ''}${d.selection ? `<span>${L('Selectie', 'Selection')}: <b>${Math.round(d.selection.w * d.src.w)} × ${Math.round(d.selection.h * d.src.h)}</b></span>` : ''}<span id="stPix"></span>`;
    renderTabs();
  }

  // ---------------------------------------------------------------- dock ---
  const PANEL_GROUPS = [['a', [['nav', 'Navigator', 'Navigator'], ['hist', 'Histogram', 'Histogram'], ['info', 'Info', 'Info']]], ['b', [['props', 'Eigenschappen', 'Properties'], ['adj', 'Aanpassingen', 'Adjustments']]], ['c', [['layers', 'Lagen', 'Layers']]], ['d', [['actions', 'Acties', 'Actions'], ['history', 'Geschiedenis', 'History']]]];
  function renderDock() {
    const dock = $('dock'); dock.innerHTML = '';
    if (S.mode === 'simple') {
      const p = el('section', 'panel simplepanel');
      p.appendChild(el('div', 'phead', `<span class="ptab on">${L('Snel bewerken', 'Quick edit')}</span>`));
      const body = el('div', 'pbody'); body.id = 'pb-s'; p.appendChild(body); dock.appendChild(p);
      pSimple(body); return;
    }
    for (const [gid, tabs] of PANEL_GROUPS) {
      const vis = tabs.filter(([k]) => S.panels[k]);
      if (!vis.length) continue;
      if (!vis.find(([k]) => k === S.panelTab[gid])) S.panelTab[gid] = vis[0][0];
      const p = el('section', 'panel'); p.dataset.group = gid;
      const head = el('div', 'phead');
      for (const [k, nl, en] of vis) {
        const b = el('button', 'ptab' + (S.panelTab[gid] === k ? ' on' : ''), esc(L(nl, en)));
        b.dataset.panel = k;
        b.onclick = () => { S.panelTab[gid] = k; renderDock(); };
        head.appendChild(b);
      }
      head.appendChild(el('span', 'spacer'));
      const col = el('button', 'pbtn', '▾'); col.title = L('In-/uitklappen', 'Collapse/expand'); col.onclick = () => p.classList.toggle('collapsed'); head.appendChild(col);
      const body = el('div', 'pbody'); body.id = 'pb-' + gid;
      p.appendChild(head); p.appendChild(body); dock.appendChild(p);
    }
    renderPanels();
  }
  function renderPanels(which) {
    const all = !which, want = (k) => all || which.includes(k);
    if (S.mode === 'simple') { if ($('pb-s') && (all || which.includes('layers') || which.includes('props'))) pSimple($('pb-s')); const d0 = D(); if (d0 && $('sUndo')) { $('sUndo').disabled = d0.hIndex <= 0; $('sRedo').disabled = d0.hIndex >= d0.history.length - 1; } renderStatus(); return; }
    const a = S.panelTab.a, b = S.panelTab.b, d2 = S.panelTab.d;
    if ($('pb-a') && want(a)) ({ nav: pNav, hist: pHist, info: pInfo })[a]($('pb-a'));
    if ($('pb-b') && want(b)) ({ props: pProps, adj: pAdj })[b]($('pb-b'));
    if ($('pb-c') && want('layers')) pLayers($('pb-c'));
    if ($('pb-d') && want(d2)) ({ history: pHistory, actions: pActions })[d2]($('pb-d'));
    if (all || which.includes('layers') || which.includes('history')) renderStatus();
  }

  function pNav(box) {
    const d = D(); box.innerHTML = '';
    if (!d || !d.src) { box.appendChild(el('p', 'pnote', L('Geen document geopend.', 'No document open.'))); return; }
    const wrap = el('div', 'nav'); const c = el('canvas'); wrap.appendChild(c); box.appendChild(wrap);
    const W = 312, H = Math.round(W * d.src.h / d.src.w); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(S.afterCanvas, 0, 0, W, H);
    if (d.zoom !== 'fit') {
      const m = mapping(), sx = W / d.src.w;
      g.strokeStyle = '#ff3b3b'; g.lineWidth = 2; g.strokeRect(-m.ox / m.s * sx, -m.oy / m.s * sx, stage.clientWidth / m.s * sx, stage.clientHeight / m.s * sx);
    }
    const go = (e) => { const r = c.getBoundingClientRect(); if (d.zoom === 'fit') d.zoom = 1; d.cx = (e.clientX - r.left) / r.width * d.src.w; d.cy = (e.clientY - r.top) / r.height * d.src.h; clampCenter(); S.region = null; draw(); };
    c.onpointerdown = (e) => { go(e); c.setPointerCapture(e.pointerId); c.onpointermove = go; };
    c.onpointerup = () => { c.onpointermove = null; pNav(box); renderStatus(); if (needRegion()) scheduleRegion(100); };
    const zl = el('div', 'pline', `<span class="pl">Zoom</span><input type="range" min="0" max="${ZOOMS.length - 1}" step="1"><span>${Math.round(effZoom() * 100)}%</span>`);
    const zi = zl.querySelector('input'); zi.value = Math.max(0, ZOOMS.findIndex((z) => z >= effZoom() * 0.99)); zi.onchange = () => setZoom(ZOOMS[+zi.value]);
    box.appendChild(zl);
  }
  function pHist(box) {
    box.innerHTML = '';
    const top = el('div', 'pline', `<span class="pl">${L('Kanaal', 'Channel')}</span>`);
    const s = el('select', '', [['rgb', 'RGB'], ['colors', L('Kleuren', 'Colours')], ['l', L('Helderheid', 'Luminosity')], ['r', L('Rood', 'Red')], ['g', L('Groen', 'Green')], ['b', L('Blauw', 'Blue')]].map(([v, t]) => `<option value="${v}">${t}</option>`).join(''));
    s.value = S.histCh; s.onchange = () => { S.histCh = s.value; pHist(box); };
    top.appendChild(s);
    const lg = el('label', '', '<input type="checkbox"> log'); lg.querySelector('input').checked = S.histLog; lg.querySelector('input').onchange = (e) => { S.histLog = e.target.checked; pHist(box); };
    top.appendChild(lg); box.appendChild(top);
    const c = el('canvas', 'histc'); c.width = 312; c.height = 130; box.appendChild(c);
    const H = S.hist; if (!H) return;
    const g = c.getContext('2d'), w = c.width, h = c.height, f = S.histLog ? Math.log1p : (v) => v;
    const chans = S.histCh === 'rgb' ? ['l'] : S.histCh === 'colors' ? ['r', 'g', 'b'] : [S.histCh];
    let mx = 1; for (const k of chans) for (let i = 2; i < 254; i++) mx = Math.max(mx, f(H[k][i]));
    const col = { l: 'rgba(220,220,220,.9)', r: 'rgba(255,70,70,.75)', g: 'rgba(70,220,100,.7)', b: 'rgba(80,130,255,.8)' };
    g.globalCompositeOperation = 'lighter';
    for (const k of chans) { g.fillStyle = col[k]; g.beginPath(); g.moveTo(0, h); for (let i = 0; i < 256; i++) g.lineTo(i / 255 * w, h - Math.min(1, f(H[k][i]) / mx) * (h - 2)); g.lineTo(w, h); g.fill(); }
    g.globalCompositeOperation = 'source-over';
    const k0 = chans[0];
    let n = 0, sum = 0, sum2 = 0; for (let i = 0; i < 256; i++) { n += H[k0][i]; sum += i * H[k0][i]; sum2 += i * i * H[k0][i]; }
    const mean = sum / Math.max(1, n), sd = Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean));
    let c2 = 0, med = 0; for (let i = 0; i < 256; i++) { c2 += H[k0][i]; if (c2 >= n / 2) { med = i; break; } }
    const nn = Math.max(1, n * 3), clipHi = (H.r[255] + H.g[255] + H.b[255]) / nn * 100, clipLo = (H.r[0] + H.g[0] + H.b[0]) / nn * 100;
    box.appendChild(el('div', 'infogrid', `<span>${L('Gemiddelde', 'Mean')}: ${mean.toFixed(1)}</span><span>${L('Std.afw.', 'Std dev')}: ${sd.toFixed(1)}</span><span>${L('Mediaan', 'Median')}: ${med}</span><span>${L('Pixels', 'Pixels')}: ${n}</span><span>${L('Wit afgekapt', 'White clipped')}: ${clipHi.toFixed(2)}%</span><span>${L('Zwart afgekapt', 'Black clipped')}: ${clipLo.toFixed(2)}%</span>`));
  }
  function renderInfoCursor() { const e = $('infoCursor'); if (!e || !S.cursorRGB) return; const [r, g, b, x, y] = S.cursorRGB; e.innerHTML = `<span>R ${r}</span><span>X ${x}</span><span>G ${g}</span><span>Y ${y}</span><span>B ${b}</span><span>L ${Math.round((r + g + b) / 3)}</span>`; }
  function pInfo(box) {
    const d = D(); box.innerHTML = '';
    if (!d) { box.appendChild(el('p', 'pnote', L('Geen document geopend.', 'No document open.'))); return; }
    const ic = el('div', 'infogrid', ''); ic.id = 'infoCursor'; box.appendChild(ic); renderInfoCursor();
    if (S.sample) box.appendChild(el('p', 'pnote', `${L('Pipet', 'Eyedropper')}: <span class="swatch-sm" style="background:rgb(${S.sample.r},${S.sample.g},${S.sample.b})"></span> ${S.sample.r}, ${S.sample.g}, ${S.sample.b}`));
    if (S.star && S.star.found) box.appendChild(el('p', 'pnote', `${L('Ster', 'Star')}: FWHM ${S.star.fwhm.toFixed(2)} px · ${L('rondheid', 'roundness')} ${(S.star.round * 100).toFixed(0)}% · SNR ${S.star.snr.toFixed(0)}`));
    const a = d.analysis;
    box.appendChild(el('div', 'psec', L('Analyse', 'Analysis')));
    if (!a) box.appendChild(el('p', 'pnote', L('Bezig…', 'Working…')));
    else {
      const ul = el('ul', 'checklist'); const li = (t) => ul.appendChild(el('li', '', esc(t)));
      if (d.autoCrop && d.autoCropRect) li(L('Stackranden gevonden en weggesneden.', 'Stacking borders found and cropped.'));
      li(a.gradient > 0.6 ? L('Sterke gradient / lichtvervuiling.', 'Strong gradient / light pollution.') : a.gradient > 0.25 ? L('Lichte gradient.', 'Slight gradient.') : L('Achtergrond vrij gelijkmatig.', 'Background fairly even.'));
      if (a.greenCast > 0.08) li(L('Groene zweem.', 'Green cast.'));
      li((a.snr < 15 ? L('Veel ruis', 'Noisy') : a.snr < 40 ? L('Gemiddelde ruis', 'Average noise') : L('Weinig ruis', 'Low noise')) + ` (SNR ${a.snr.toFixed(0)})`);
      li(L(`ca. ${a.stars} sterren`, `approx. ${a.stars} stars`) + (a.fwhm ? `, FWHM ${a.fwhm.toFixed(2)} px` : ''));
      if (d.detected) li(L('Herkend: ', 'Detected: ') + (d.detected.fallback ? L('onbekend', 'unknown') : d.detected.type + (d.detected.label ? ' (' + d.detected.label + ')' : '')) + (d.detected.dualBand ? L(' · duoband-filter', ' · dual-band filter') : ''));
      box.appendChild(ul);
      const t = el('table', 'kv');
      t.innerHTML = `<tr><th>${L('Afmeting', 'Size')}</th><td>${d.src ? d.src.w + ' × ' + d.src.h : ''}</td></tr><tr><th>${L('Achtergrond', 'Background')}</th><td>${(a.background * 100).toFixed(2)}%</td></tr><tr><th>${L('Ruis σ', 'Noise σ')}</th><td>${(a.noise * 100).toFixed(3)}%</td></tr><tr><th>R/G/B ${L('mediaan', 'median')}</th><td>${['r', 'g', 'b'].map((k) => (a.channels[k].median * 100).toFixed(2)).join(' / ')}</td></tr>`;
      box.appendChild(t);
    }
    const hd = d.original.meta && d.original.meta.header;
    if (hd) {
      const det = el('details', ''); det.appendChild(el('summary', 'psec', L('FITS-header', 'FITS header')));
      const t = el('table', 'kv'); t.innerHTML = Object.entries(hd).filter(([k]) => !/^(SIMPLE|BITPIX|NAXIS\d?|EXTEND|END)$/.test(k)).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
      det.appendChild(t); box.appendChild(det);
    }
  }
  function pAdj(box) {
    box.innerHTML = '';
    const sections = [[L('Aanpassingen', 'Adjustments'), ['brightcon', 'levels', 'curves', 'exposure', 'vibrance', 'huesat', 'hsl', 'colorbalance', 'temptint', 'bw', 'photofilter', 'chmix', 'invert', 'posterize', 'threshold', 'gradmap', 'shadhigh', 'autotone']],
      ['Astro', ['gradient', 'colorcal', 'stretch', 'hdr', 'hdrmt', 'deconv', 'palette', 'scnr', 'vignfix', 'hotpix']],
      [L('Sterren', 'Stars'), ['starreduce', 'starsplit', 'spikes']],
      [L('Ruis en detail', 'Noise and detail'), ['denoise', 'bgsmooth', 'dust', 'localcontrast', 'sharpen', 'usm', 'wavelets', 'clahe', 'clarity', 'dehaze', 'highpass']],
      [L('Filters', 'Filters'), ['gblur', 'median', 'surface', 'minimum', 'maximum', 'glow', 'vignette', 'grain', 'emboss', 'edges', 'heal']]];
    for (const [title, ops] of sections) {
      box.appendChild(el('div', 'psec', esc(title)));
      const grid = el('div', 'adjgrid');
      for (const k of ops) { const b = el('button', '', ICON[k] || '•'); b.title = opName(k) + (helpOf(k) ? '\n' + helpOf(k) : ''); b.dataset.op = k; b.onclick = () => (D() ? addLayer(k) : toast(L('Open eerst een foto.', 'Open a photo first.'))); grid.appendChild(b); }
      box.appendChild(grid);
    }
    box.appendChild(el('p', 'pnote', L('Klik op een icoon om een nieuwe laag boven de geselecteerde laag te maken. Is er een selectie, dan wordt die het masker.', 'Click an icon to add a new layer above the selected layer. If there is a selection, it becomes the mask.')));
  }
  function pLayers(box) {
    const d = D(); box.innerHTML = '';
    if (!d) { box.appendChild(el('p', 'pnote', L('Geen document geopend.', 'No document open.'))); return; }
    const ly = curLayer();
    const top = el('div', 'lyr-top');
    const bs = el('select', '', O.BLENDS.map((k) => `<option value="${k}">${esc(L(...BLEND_NAMES[k]))}</option>`).join(''));
    bs.value = ly ? ly.blend : 'normal'; bs.disabled = !ly || ly.op === 'text'; bs.onchange = () => setLayer(ly, 'blend', bs.value, L('Overvloeimodus', 'Blend mode'));
    top.appendChild(bs);
    const op = el('div', 'op', `${L('Dekking', 'Opacity')}: <input type="number" min="0" max="100" step="1">%`);
    const oi = op.querySelector('input'); oi.value = ly ? Math.round(ly.opacity * 100) : 100; oi.disabled = !ly;
    oi.onchange = () => { const v = oi.value.trim() === '' ? NaN : +oi.value; if (!Number.isFinite(v)) { oi.value = Math.round(ly.opacity * 100); return; } setLayer(ly, 'opacity', clamp(v, 0, 100) / 100, L('Dekking', 'Opacity')); };
    top.appendChild(op); box.appendChild(top);
    const ul = el('ul', 'layers');
    for (const l of d.layers.slice().reverse()) {
      const hasMask = l.op !== 'text' && (l.mask.type !== 'none' || (l.mask.strokes && l.mask.strokes.length) || l.mask.invert);
      const li = el('li', 'layer' + (l.id === d.sel ? ' sel' : '') + (l.on ? '' : ' off'),
        `<button class="eye" title="${L('Tonen/verbergen', 'Show/hide')}">👁</button><span class="thumb">${ICON[l.op] || '•'}</span><span class="nm">${esc(layerTitle(l))}<small>${l.op === 'text' ? L('tekst', 'text') : esc(L(...BLEND_NAMES[l.blend || 'normal']))}${l.opacity < 1 ? ' · ' + Math.round(l.opacity * 100) + '%' : ''}</small></span>${hasMask ? `<span class="mk${l.mask.invert ? ' inv' : ''}${S.viewMaskId === l.id ? ' view' : ''}" title="${L('Masker (Alt+klik = tonen)', 'Mask (Alt+click = show)')}">${maskBadge(l.mask)}</span>` : '<span></span>'}`);
      li.draggable = true; li.dataset.id = l.id; li.title = helpOf(l.op);
      li.onclick = (e) => { if (e.target.classList.contains('eye')) return; if (e.altKey && hasMask) { toggleViewMask(l); return; } selectLayer(l.id); };
      li.querySelector('.eye').onclick = (e) => { e.stopPropagation(); toggleLayer(l.id); };
      li.ondblclick = () => { const n = window.prompt(L('Naam van de laag:', 'Layer name:'), layerTitle(l)); if (n !== null) { l.name = n; renderPanels(['layers', 'props']); commit(L('Laag hernoemd', 'Layer renamed'), true); } };
      const mk = li.querySelector('.mk'); if (mk) mk.onclick = (e) => { e.stopPropagation(); if (e.altKey) toggleViewMask(l); else selectLayer(l.id); };
      li.ondragstart = (e) => { e.dataTransfer.setData('text/plain', l.id); };
      li.ondragover = (e) => { e.preventDefault(); li.classList.add('drag-over'); };
      li.ondragleave = () => li.classList.remove('drag-over');
      li.ondrop = (e) => {
        e.preventDefault(); e.stopPropagation(); li.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain'); if (!id || id === l.id) return;
        const from = d.layers.findIndex((x) => x.id === id); if (from < 0) return;
        const [m] = d.layers.splice(from, 1);
        const to = d.layers.findIndex((x) => x.id === l.id); d.layers.splice(to + 1, 0, m);
        renderPanels(['layers']); requestPreview(); commit(L('Laagvolgorde', 'Layer order'), true);
      };
      ul.appendChild(li);
    }
    const base = el('li', 'layer base' + (!d.sel ? ' sel' : ''), `<span></span><span class="thumb">🖼</span><span class="nm">${L('Achtergrond', 'Background')}<small>${esc(d.name)}</small></span><span>🔒</span>`);
    base.onclick = () => { d.sel = null; renderPanels(['layers', 'props']); };
    ul.appendChild(base); box.appendChild(ul);
    const foot = el('div', 'lyr-foot');
    const fb = (lbl, title, fn, dis) => { const b = el('button', 'btn', lbl); b.title = title; b.disabled = !!dis; b.onclick = fn; foot.appendChild(b); return b; };
    fb('◐ ▾', L('Nieuwe aanpassingslaag', 'New adjustment layer'), (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); popupMenu([{ label: L('Aanpassingen', 'Adjustments'), sub: adjMenu(['adjust']) }, { label: 'Astro', sub: adjMenu(['astro', 'stretch', 'nb', 'stars']) }, { label: L('Ruis en detail', 'Noise and detail'), sub: adjMenu(['noise', 'detail']) }, { label: L('Filters', 'Filters'), sub: adjMenu(['filter', 'repair']) }], r.left, r.top - 110); });
    fb('▣ ▾', L('Laagmasker', 'Layer mask'), (e) => { e.stopPropagation(); if (!ly || ly.op === 'text') return; const r = e.currentTarget.getBoundingClientRect(); popupMenu(maskMenu(ly), r.left, r.top - 260); }, !ly || ly.op === 'text');
    fb('▲', L('Omhoog', 'Up'), () => moveLayer(1), !ly);
    fb('▼', L('Omlaag', 'Down'), () => moveLayer(-1), !ly);
    fb('⧉', L('Dupliceren (Ctrl+J)', 'Duplicate (Ctrl+J)'), duplicateLayer, !ly);
    fb('🗑', L('Verwijderen (Del)', 'Delete (Del)'), () => deleteLayer(), !ly);
  }
  function maskBadge(mk) { return { none: '✎', paint: '✎', lum: 'L', hue: 'H', stars: '✶', nostars: '¬✶', signal: 'O', background: 'A', shape: '▭' }[mk.type] || 'M'; }
  function toggleViewMask(ly) { if (!ly) return; S.viewMaskId = S.viewMaskId === ly.id ? null : ly.id; requestPreview(); renderPanels(['layers', 'props']); }

  // ---- properties
  function pProps(box) {
    const d = D(), ly = curLayer(); box.innerHTML = '';
    S.curveRedraw = null;
    if (!d) { box.appendChild(el('p', 'pnote', L('Open een foto via Bestand → Openen, of sleep hem in het venster.', 'Open a photo via File → Open, or drop it on the window.'))); return; }
    if (!ly) { docProps(box, d); return; }
    const title = el('div', 'ptitle', `<span class="ic">${ICON[ly.op] || ''}</span>`);
    const nm = el('input'); nm.type = 'text'; nm.value = layerTitle(ly); nm.onchange = () => { ly.name = nm.value; renderPanels(['layers']); commit(L('Laag hernoemd', 'Layer renamed'), true); };
    title.appendChild(nm); box.appendChild(title);
    if (helpOf(ly.op)) box.appendChild(el('p', 'phelp', esc(helpOf(ly.op))));
    if (ly.op === 'text') { textProps(box, ly); return; }
    const op = O.OPS[ly.op];
    if (!op.p.length) box.appendChild(el('p', 'pnote', L('Deze laag heeft geen instellingen.', 'This layer has no settings.')));
    const p = Object.assign(O.defaults(ly.op), ly.params);
    for (const desc of op.p) { if (desc.show && !desc.show(p)) continue; paramControl(box, ly, desc, p); }
    const btns = el('div', 'pbtns');
    const b1 = el('button', 'btn sm', L('Standaardwaarden', 'Defaults')); b1.onclick = () => { ly.params = O.defaults(ly.op); renderPanels(['props']); requestPreview(); commit(L('Standaardwaarden', 'Defaults'), true); };
    btns.appendChild(b1); box.appendChild(btns);
    maskProps(box, ly, d);
  }
  function numRow(box, label, val, min, max, step, onInput, fmt) {
    const row = el('div', 'prow', `<span class="pl" title="${esc(label)}">${esc(label)}</span><input type="number" min="${min}" max="${max}" step="${step}"><input type="range" min="${min}" max="${max}" step="${step}">`);
    const [ni, ri] = row.querySelectorAll('input');
    const show = (v) => { ni.value = fmt ? fmt(v) : (+v).toFixed(step >= 1 ? 0 : step >= 0.01 ? 2 : 3); };
    ri.value = val; show(val);
    ri.oninput = () => { show(+ri.value); onInput(+ri.value); };
    ni.onchange = () => {
      const raw = ni.value.trim() === '' ? NaN : +ni.value;
      if (!Number.isFinite(raw)) { show(+ri.value); return; } // ignore invalid input, keep the current value
      const v = clamp(raw, min, max); ri.value = v; show(v); onInput(v);
    };
    box.appendChild(row);
    return row;
  }
  function paramControl(box, ly, desc, p) {
    const label = L(desc.nl, desc.en);
    switch (desc.t) {
      case 'r': { const row = numRow(box, label, p[desc.k], desc.min, desc.max, desc.step, (v) => setParam(ly, desc.k, v, layerTitle(ly) + ': ' + label)); row.querySelector('.pl').ondblclick = () => { setParam(ly, desc.k, desc.d); renderPanels(['props']); }; break; }
      case 'c': { const r = el('label', 'pline', `<input type="checkbox"> ${esc(label)}`); const i = r.querySelector('input'); i.checked = !!p[desc.k]; i.onchange = () => { setParam(ly, desc.k, i.checked, layerTitle(ly) + ': ' + label); renderPanels(['props']); }; box.appendChild(r); break; }
      case 's': { const r = el('div', 'pline', `<span class="pl">${esc(label)}</span>`); const s = el('select', '', desc.o.map(([v, nl, en]) => `<option value="${v}">${esc(L(nl, en))}</option>`).join('')); s.value = String(p[desc.k]); s.onchange = () => { const v = isNaN(+s.value) ? s.value : +s.value; setParam(ly, desc.k, v, layerTitle(ly) + ': ' + label); renderPanels(['props']); }; r.appendChild(s); box.appendChild(r); break; }
      case 'color': { const r = el('div', 'pline', `<span class="pl">${esc(label)}</span>`); const c = el('input'); c.type = 'color'; c.value = p[desc.k] || '#ffffff'; c.oninput = () => setParam(ly, desc.k, c.value, layerTitle(ly) + ': ' + label); r.appendChild(c); box.appendChild(r); break; }
      case 'pick': {
        const r = el('div', 'pline', `<span class="pl">${esc(label)}</span>`);
        const b = el('button', 'btn sm' + (S.pick && S.pick.key === desc.k ? ' on' : ''), p[desc.k] ? '✔ ' + L('Ingesteld', 'Set') : '💧 ' + L('Kies punt', 'Pick point'));
        b.onclick = () => { S.pick = { layer: ly.id, key: desc.k, label }; renderOptions(); updateCursor(); toast(L('Klik op de foto.', 'Click on the photo.')); };
        r.appendChild(b);
        if (p[desc.k]) { const x = el('button', 'btn sm', L('Wis', 'Clear')); x.onclick = () => { setParam(ly, desc.k, null); renderPanels(['props']); }; r.appendChild(x); }
        box.appendChild(r); break;
      }
      case 'curves': box.appendChild(curvesEditor(ly)); break;
      case 'hsl': box.appendChild(hslEditor(ly)); break;
      case 'wav': {
        const gains = (p.gains || [0, 0, 0, 0, 0, 0]).slice();
        for (let j = 0; j < 6; j++) numRow(box, L(`Laag ${j + 1} (${2 ** j} px)`, `Layer ${j + 1} (${2 ** j} px)`), gains[j], -1, 3, 0.01, (v) => { const a = (ly.params.gains || [0, 0, 0, 0, 0, 0]).slice(); a[j] = v; setParam(ly, 'gains', a, 'Wavelets'); });
        break;
      }
      case 'levelsauto': { const b = el('button', 'btn sm', L('Automatisch', 'Auto')); b.onclick = () => autoLevels(ly); box.appendChild(el('div', 'pbtns')).appendChild(b); break; }
      case 'info': {
        const n = (ly.params.strokes || []).length;
        box.appendChild(el('p', 'pnote', esc(label) + (n ? ` (${n} ${L('streken', 'strokes')})` : '')));
        const pb = el('div', 'pbtns');
        const b0 = el('button', 'btn sm', '✚ ' + L('Herstelpenseel (J)', 'Healing brush (J)')); b0.onclick = () => setTool('heal'); pb.appendChild(b0);
        if (n) { const b = el('button', 'btn sm', L('Laatste streek weg', 'Remove last stroke')); b.onclick = () => { ly.params.strokes = ly.params.strokes.slice(0, -1); requestPreview(); renderPanels(['props']); commit(L('Streek verwijderd', 'Stroke removed'), true); }; pb.appendChild(b); }
        box.appendChild(pb); break;
      }
      default: break;
    }
  }
  function autoLevels(ly) {
    const H = S.hist; if (!H) return;
    const pct = (arr, q) => { let n = 0; for (const v of arr) n += v; let c = 0; for (let i = 0; i < 256; i++) { c += arr[i]; if (c >= n * q) return i / 255; } return 1; };
    ly.params.inBlack = pct(H.l, 0.001); ly.params.inWhite = Math.max(ly.params.inBlack + 0.05, pct(H.l, 0.999)); ly.params.gamma = 1;
    renderPanels(['props']); requestPreview(); commit(L('Niveaus automatisch', 'Auto levels'), true);
  }
  function maskProps(box, ly, d) {
    box.appendChild(el('div', 'psec', L('Laagmasker', 'Layer mask')));
    const mk = ly.mask;
    const r = el('div', 'pline', `<span class="pl">${L('Type', 'Type')}</span>`);
    const s = el('select', '', MASK_TYPES.map(([k, nl, en]) => `<option value="${k}">${esc(L(nl, en))}</option>`).join(''));
    s.value = mk.type; s.onchange = () => { if (s.value === 'shape' && d.selection) Object.assign(mk, { shape: deep(d.selection), shapeFeather: S.selFeather }); setMask(ly, 'type', s.value); renderPanels(['props']); };
    r.appendChild(s); box.appendChild(r);
    const set = (k) => (v) => setMask(ly, k, v);
    if (mk.type === 'lum') { numRow(box, L('Van (helderheid)', 'From (brightness)'), mk.lo === undefined ? 0.5 : mk.lo, 0, 1, 0.01, set('lo')); numRow(box, L('Tot', 'To'), mk.hi === undefined ? 1 : mk.hi, 0, 1, 0.01, set('hi')); numRow(box, L('Zachtheid', 'Softness'), mk.soft === undefined ? 0.1 : mk.soft, 0.005, 0.5, 0.005, set('soft')); }
    if (mk.type === 'hue') { numRow(box, L('Kleurtoon (°)', 'Hue (°)'), mk.hue || 0, 0, 360, 1, set('hue')); numRow(box, L('Breedte (°)', 'Width (°)'), mk.width || 40, 5, 120, 1, set('width')); box.appendChild(el('p', 'pnote', L('0 = rood (Ha), 180 = blauwgroen (OIII), 220 = blauw.', '0 = red (Ha), 180 = teal (OIII), 220 = blue.'))); }
    if (mk.type === 'stars' || mk.type === 'nostars') numRow(box, L('Grootte sterrenmasker', 'Star mask size'), mk.size === undefined ? 0.5 : mk.size, 0, 1, 0.01, set('size'));
    if (mk.type === 'shape') {
      if (!mk.shape) box.appendChild(el('p', 'pnote', L('Maak een selectie met M of L en klik op "Huidige selectie gebruiken".', 'Make a selection with M or L and click "Use current selection".')));
      numRow(box, L('Rand zachtheid', 'Edge softness'), mk.shapeFeather || 0, 0, 0.2, 0.002, set('shapeFeather'));
      const b = el('button', 'btn sm', L('Huidige selectie gebruiken', 'Use current selection')); b.disabled = !d.selection; b.onclick = () => { mk.shape = deep(d.selection); setMask(ly, 'type', 'shape'); };
      box.appendChild(el('div', 'pbtns')).appendChild(b);
    }
    numRow(box, L('Doezelaar (vervagen)', 'Feather (blur)'), mk.feather || 0, 0, 2, 0.01, set('feather'));
    numRow(box, L('Dichtheid', 'Density'), mk.density === undefined ? 1 : mk.density, 0, 1, 0.01, set('density'));
    const inv = el('label', 'pline', `<input type="checkbox"> ${L('Omkeren', 'Invert')}`); inv.querySelector('input').checked = !!mk.invert; inv.querySelector('input').onchange = (e) => setMask(ly, 'invert', e.target.checked);
    box.appendChild(inv);
    const vm = el('label', 'pline', `<input type="checkbox"> ${L('Masker tonen (Alt+klik op masker)', 'Show mask (Alt+click on mask)')}`); vm.querySelector('input').checked = S.viewMaskId === ly.id; vm.querySelector('input').onchange = () => toggleViewMask(ly);
    box.appendChild(vm);
    const n = (mk.strokes || []).length;
    const pb = el('div', 'pbtns');
    const b2 = el('button', 'btn sm', '🖌 ' + L('Penseel (B)', 'Brush (B)')); b2.onclick = () => setTool('brush'); pb.appendChild(b2);
    if (n) { const b3 = el('button', 'btn sm', L(`Streken wissen (${n})`, `Clear strokes (${n})`)); b3.onclick = () => { setMask(ly, 'strokes', []); renderPanels(['props']); }; pb.appendChild(b3); }
    box.appendChild(pb);
  }
  function textProps(box, ly) {
    const p = ly.params;
    const inp = (label, key) => { const r = el('div', 'pline', `<span class="pl">${esc(label)}</span>`); const i = el('input'); i.type = 'text'; i.value = p[key] || ''; i.oninput = () => { p[key] = i.value; draw(); renderPanels(['layers']); commit(L('Tekst', 'Text')); }; r.appendChild(i); box.appendChild(r); };
    inp(L('Tekst', 'Text'), 'text'); inp(L('Regel 2', 'Line 2'), 'sub');
    const b = el('button', 'btn sm', L('Automatisch invullen', 'Fill in automatically')); b.onclick = () => { const a = autoInfo(); p.text = a.title; p.sub = a.sub; renderPanels(['props', 'layers']); draw(); commit(L('Tekst', 'Text'), true); };
    box.appendChild(el('div', 'pbtns')).appendChild(b);
    numRow(box, L('Grootte (% hoogte)', 'Size (% height)'), p.size || 0.045, 0.01, 0.2, 0.001, (v) => setParam(ly, 'size', v), (v) => (v * 100).toFixed(1));
    numRow(box, 'X', p.x, 0, 1, 0.001, (v) => setParam(ly, 'x', v)); numRow(box, 'Y', p.y, 0, 1, 0.001, (v) => setParam(ly, 'y', v));
    numRow(box, L('Dekking', 'Opacity'), ly.opacity, 0, 1, 0.01, (v) => { ly.opacity = v; draw(); commit(L('Dekking', 'Opacity')); });
    const r = el('div', 'pline', `<span class="pl">${L('Kleur', 'Colour')}</span>`); const c = el('input'); c.type = 'color'; c.value = p.color || '#ffffff'; c.oninput = () => setParam(ly, 'color', c.value); r.appendChild(c);
    const al = el('select', '', [['left', L('Links', 'Left')], ['center', L('Midden', 'Centre')], ['right', L('Rechts', 'Right')]].map(([v, t]) => `<option value="${v}">${t}</option>`).join('')); al.value = p.align || 'left'; al.onchange = () => setParam(ly, 'align', al.value); r.appendChild(al);
    box.appendChild(r);
    const fr = el('div', 'pline', `<span class="pl">${L('Lettertype', 'Font')}</span>`);
    const FONTS = ['"Segoe UI", system-ui, sans-serif', 'Georgia, serif', '"Courier New", monospace', 'Impact, sans-serif', '"Trebuchet MS", sans-serif'];
    const fs = el('select', '', FONTS.map((f, i) => `<option value="${i}">${f.split(',')[0].replace(/"/g, '')}</option>`).join('')); fs.value = String(Math.max(0, FONTS.indexOf(p.font || FONTS[0]))); fs.onchange = () => setParam(ly, 'font', FONTS[+fs.value]); fr.appendChild(fs); box.appendChild(fr);
    const ck = (label, key, def) => { const l = el('label', 'pline', `<input type="checkbox"> ${esc(label)}`); const i = l.querySelector('input'); i.checked = p[key] === undefined ? def : !!p[key]; i.onchange = () => setParam(ly, key, i.checked); box.appendChild(l); };
    ck(L('Vet', 'Bold'), 'bold', true); ck(L('Schaduw', 'Shadow'), 'shadow', true);
    box.appendChild(el('p', 'pnote', L('Verplaats de tekst met het verplaatsgereedschap (V).', 'Move the text with the move tool (V).')));
  }
  function docProps(box, d) {
    box.appendChild(el('div', 'ptitle', `<span class="ic">🖼</span>${esc(d.name)}`));
    box.appendChild(el('p', 'pnote', L('Achtergrond geselecteerd. Kies een laag in het Lagen-paneel of voeg een aanpassing toe.', 'Background selected. Choose a layer in the Layers panel or add an adjustment.')));
    const t = el('table', 'kv');
    t.innerHTML = `<tr><th>${L('Afmeting', 'Size')}</th><td>${d.src ? d.src.w + ' × ' + d.src.h : '-'}</td></tr><tr><th>${L('Origineel', 'Original')}</th><td>${d.original.w} × ${d.original.h} · ${esc((d.original.meta && d.original.meta.format) || '')}</td></tr><tr><th>${L('Rotatie', 'Rotation')}</th><td>${d.geom.rot * 90}°${d.geom.angle ? ' + ' + d.geom.angle.toFixed(2) + '°' : ''}${d.geom.fh ? ' ⇋' : ''}${d.geom.fv ? ' ⇵' : ''}</td></tr><tr><th>${L('Bijgesneden', 'Cropped')}</th><td>${d.geom.crop ? L('ja', 'yes') : L('nee', 'no')}${d.autoCrop && d.autoCropRect ? L(' · stackranden weg', ' · borders removed') : ''}</td></tr>`;
    box.appendChild(t);
    const pb = el('div', 'pbtns');
    for (const [lbl, fn] of [['✨ ' + L('Automatisch', 'Automatic'), () => applyAction('auto')], [L('Bijsnijden', 'Crop'), () => setTool('crop')], [L('Roteren 90°', 'Rotate 90°'), () => setGeom('rot', (d.geom.rot + 1) % 4, L('Roteren', 'Rotate'))], [L('Rechtzetten…', 'Straighten…'), rotateDialog], [L('Grootte…', 'Size…'), sizeDialog]]) { const b = el('button', 'btn sm', esc(lbl)); b.onclick = fn; pb.appendChild(b); }
    box.appendChild(pb);
  }
  function curvesEditor(ly) {
    const wrap = el('div', '');
    S.curveCh = S.curveCh || 'rgb';
    const seg = el('div', 'segm');
    for (const [k, t] of [['rgb', 'RGB'], ['r', 'R'], ['g', 'G'], ['b', 'B']]) { const b = el('button', S.curveCh === k ? 'on' : '', t); b.onclick = () => { S.curveCh = k; renderPanels(['props']); }; seg.appendChild(b); }
    wrap.appendChild(seg);
    const cv = el('canvas', 'curvecanvas'); cv.width = 300; cv.height = 300; wrap.appendChild(cv);
    const getPts = () => ((ly.params.curves && ly.params.curves[S.curveCh]) || [[0, 0], [1, 1]]).map((q) => q.slice());
    const setPts = (pts) => { const all = Object.assign({ rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }, ly.params.curves || {}); all[S.curveCh] = pts; ly.params.curves = all; requestPreview(); };
    const col = { rgb: '#ddd', r: '#ff5c5c', g: '#5fe08a', b: '#6aa0ff' }[S.curveCh];
    const drawC = () => {
      const g = cv.getContext('2d'), W = cv.width, H = cv.height;
      g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, W, H);
      if (S.hist) { const arr = S.hist[S.curveCh === 'rgb' ? 'l' : S.curveCh]; let mx = 1; for (let i = 2; i < 254; i++) mx = Math.max(mx, Math.log1p(arr[i])); g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(0, H); for (let i = 0; i < 256; i++) g.lineTo(i / 255 * W, H - Math.log1p(arr[i]) / mx * H * 0.9); g.lineTo(W, H); g.fill(); }
      g.strokeStyle = '#333'; g.lineWidth = 1; g.beginPath(); for (let i = 1; i < 4; i++) { g.moveTo(i * W / 4, 0); g.lineTo(i * W / 4, H); g.moveTo(0, i * H / 4); g.lineTo(W, i * H / 4); } g.stroke();
      g.strokeStyle = '#444'; g.beginPath(); g.moveTo(0, H); g.lineTo(W, 0); g.stroke();
      const lut = E.curveLUT(getPts(), 256);
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); for (let i = 0; i < 256; i++) { const x = i / 255 * W, y = H - lut[i] * H; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
      g.fillStyle = '#fff'; for (const [x, y] of getPts()) g.fillRect(x * W - 4, H - y * H - 4, 8, 8);
    };
    let di = -1;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp(1 - (e.clientY - r.top) / r.height, 0, 1)]; };
    cv.onpointerdown = (e) => {
      const [x, y] = pos(e), pts = getPts(); let best = -1, bd = 0.05;
      pts.forEach((q, i) => { const dd = Math.hypot(q[0] - x, q[1] - y); if (dd < bd) { bd = dd; best = i; } });
      if (best < 0) { pts.push([x, y]); pts.sort((a, b) => a[0] - b[0]); best = pts.findIndex((q) => q[0] === x); setPts(pts); }
      di = best; cv.setPointerCapture(e.pointerId); drawC();
    };
    cv.onpointermove = (e) => {
      if (di < 0) return; const [x, y] = pos(e), pts = getPts();
      const lo = di > 0 ? pts[di - 1][0] + 0.01 : 0, hi = di < pts.length - 1 ? pts[di + 1][0] - 0.01 : 1;
      pts[di] = [di === 0 ? Math.min(x, hi) : di === pts.length - 1 ? Math.max(x, lo) : clamp(x, lo, hi), y];
      setPts(pts); drawC();
    };
    cv.onpointerup = () => { di = -1; commit(L('Curven', 'Curves')); };
    cv.ondblclick = (e) => { const [x, y] = pos(e), pts = getPts(); const i = pts.findIndex((q) => Math.hypot(q[0] - x, q[1] - y) < 0.05); if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); setPts(pts); drawC(); commit(L('Curven', 'Curves'), true); } };
    S.curveRedraw = drawC; drawC();
    const pr = el('div', 'pbtns');
    for (const [t, pts] of [[L('Reset', 'Reset'), [[0, 0], [1, 1]]], ['S', [[0, 0], [0.25, 0.18], [0.75, 0.84], [1, 1]]], [L('Lichter', 'Lighter'), [[0, 0], [0.4, 0.52], [1, 1]]], [L('Donkerder', 'Darker'), [[0, 0], [0.55, 0.43], [1, 1]]], [L('Achtergrond dieper', 'Deeper background'), [[0, 0], [0.15, 0.08], [0.5, 0.52], [1, 1]]]]) { const b = el('button', 'btn sm', esc(t)); b.onclick = () => { setPts(pts.map((q) => q.slice())); drawC(); commit(L('Curven', 'Curves'), true); }; pr.appendChild(b); }
    wrap.appendChild(pr);
    wrap.appendChild(el('p', 'pnote', L('Klik = punt toevoegen, slepen = verplaatsen, dubbelklik = verwijderen.', 'Click = add point, drag = move, double-click = remove.')));
    return wrap;
  }
  function hslEditor(ly) {
    const wrap = el('div', '');
    const names = { red: ['Rood', 'Red', '#ff4d4d'], orange: ['Oranje', 'Orange', '#ff9d3b'], yellow: ['Geel', 'Yellow', '#ffe14d'], green: ['Groen', 'Green', '#4dd36b'], aqua: ['Blauwgroen', 'Aqua', '#3fd6d6'], blue: ['Blauw', 'Blue', '#4d7dff'], purple: ['Paars', 'Purple', '#9b5cff'], magenta: ['Magenta', 'Magenta', '#ff4dd2'] };
    S.hslSel = S.hslSel || 'red';
    const sw = el('div', 'swatches');
    for (const k of Object.keys(names)) {
      const v = ly.params.hsl && ly.params.hsl[k];
      const b = el('button', (S.hslSel === k ? 'on' : '') + (v && (v[0] || v[1] !== 1 || v[2]) ? ' chg' : '')); b.style.background = names[k][2]; b.title = L(names[k][0], names[k][1]);
      b.onclick = () => { S.hslSel = k; renderPanels(['props']); }; sw.appendChild(b);
    }
    wrap.appendChild(sw);
    wrap.appendChild(el('p', 'pnote', esc(L('Kleur: ', 'Colour: ') + L(names[S.hslSel][0], names[S.hslSel][1]))));
    const get = (i) => ((ly.params.hsl && ly.params.hsl[S.hslSel]) || [0, 1, 0])[i];
    const set = (i) => (v) => { const h = deep(ly.params.hsl || {}); h[S.hslSel] = (h[S.hslSel] || [0, 1, 0]).slice(); h[S.hslSel][i] = v; setParam(ly, 'hsl', h, 'HSL'); };
    numRow(wrap, L('Kleurtoon', 'Hue'), get(0), -1, 1, 0.01, set(0));
    numRow(wrap, L('Verzadiging', 'Saturation'), get(1), 0, 2.5, 0.01, set(1));
    numRow(wrap, L('Luminantie', 'Luminance'), get(2), -1, 1, 0.01, set(2));
    return wrap;
  }
  function pHistory(box) {
    const d = D(); box.innerHTML = '';
    if (!d) { box.appendChild(el('p', 'pnote', L('Geen document geopend.', 'No document open.'))); return; }
    const ul = el('ul', 'list');
    if (d.snaps.length) {
      ul.appendChild(el('li', 'grp', L('Momentopnamen', 'Snapshots')));
      d.snaps.forEach((s) => { const li = el('li', '', `📷 <span class="grow">${esc(s.name)}</span>`); li.onclick = async () => { const st = JSON.parse(s.state); d.layers = st.layers; d.geom = st.geom; d.autoCrop = st.autoCrop; await sendSource(); renderPanels(); commit(L('Momentopname: ', 'Snapshot: ') + s.name, true); }; ul.appendChild(li); });
      ul.appendChild(el('li', 'grp', L('Stappen', 'Steps')));
    }
    d.history.forEach((h, i) => { const li = el('li', (i === d.hIndex ? 'on' : '') + (i > d.hIndex ? ' future' : ''), `<span class="grow">${esc(h.label)}</span>`); li.onclick = () => restore(i); ul.appendChild(li); });
    box.appendChild(ul);
    setTimeout(() => { const on = ul.querySelector('li.on'); if (on) ul.scrollTop = on.offsetTop - ul.clientHeight / 2; }, 0);
    const pb = el('div', 'pbtns');
    for (const [t, fn] of [['↶ ' + L('Ongedaan', 'Undo'), undo], ['↷ ' + L('Opnieuw', 'Redo'), redo], ['📷 ' + L('Momentopname', 'Snapshot'), takeSnapshot]]) { const b = el('button', 'btn sm', esc(t)); b.onclick = fn; pb.appendChild(b); }
    box.appendChild(pb);
  }
  function takeSnapshot() {
    const d = D(); if (!d) return;
    d.snaps.push({ name: L('Opname ', 'Snapshot ') + (d.snaps.length + 1), state: docState(d) });
    renderPanels(['history']); toast(L('Momentopname gemaakt. Weergave → Vergelijken met momentopname.', 'Snapshot taken. View → Compare with snapshot.'));
  }
  function pActions(box) {
    box.innerHTML = '';
    const ul = el('ul', 'list'), d = D();
    for (const [gnl, gen, list] of ACTIONS) {
      ul.appendChild(el('li', 'grp', esc(L(gnl, gen))));
      for (const [k, icon, nl, en] of list) {
        const li = el('li', d && d.action === k ? 'on' : '', `▶ <span class="grow">${icon ? icon + ' ' : ''}${esc(L(nl, en))}</span>`);
        li.title = L('Klik = lagen vervangen door deze actie (tekst- en herstellagen blijven)', 'Click = replace layers with this action (text and healing layers stay)');
        li.dataset.action = k;
        li.onclick = () => (D() ? applyAction(k) : toast(L('Open eerst een foto.', 'Open a photo first.')));
        ul.appendChild(li);
      }
    }
    const my = store.get('actions', {});
    ul.appendChild(el('li', 'grp', L('Mijn acties', 'My actions')));
    for (const n of Object.keys(my)) {
      const li = el('li', d && d.action === 'my:' + n ? 'on' : '', `▶ <span class="grow">${esc(n)}</span><button class="x" title="${L('Verwijderen', 'Delete')}">×</button>`);
      li.onclick = (e) => { if (e.target.classList.contains('x')) return; if (D()) applyAction('my:' + n); };
      li.querySelector('.x').onclick = (e) => { e.stopPropagation(); if (window.confirm(L(`Actie "${n}" verwijderen?`, `Delete action "${n}"?`))) { delete my[n]; store.set('actions', my); pActions(box); } };
      ul.appendChild(li);
    }
    box.appendChild(ul);
    const pb = el('div', 'pbtns');
    const b1 = el('button', 'btn sm', '● ' + L('Lagen opnemen als actie', 'Record layers as action')); b1.disabled = !d; b1.onclick = recordAction;
    const b2 = el('button', 'btn sm', L('Exporteren', 'Export')); b2.onclick = () => saveBlob(new Blob([JSON.stringify({ app: 'AstroPolish', type: 'actions', actions: store.get('actions', {}) }, null, 2)], { type: 'application/json' }), 'astropolish-acties.json');
    const b3 = el('button', 'btn sm', L('Importeren', 'Import')); b3.onclick = () => importJSON('actions');
    pb.appendChild(b1); pb.appendChild(b2); pb.appendChild(b3); box.appendChild(pb);
  }
  function recordAction() {
    const d = D(); if (!d) return;
    const n = window.prompt(L('Naam van de actie:', 'Action name:'), L('Mijn actie', 'My action')); if (!n) return;
    const my = store.get('actions', {});
    my[n.slice(0, 50)] = { layers: deep(d.layers).filter((l) => l.op !== 'heal').map((l) => { if (l.params.wbPick) l.params.wbPick = null; if (l.params.bgPick) l.params.bgPick = null; if (l.mask) l.mask.strokes = []; return l; }) };
    store.set('actions', my); d.action = 'my:' + n.slice(0, 50); renderPanels(['actions']); toast(L('Actie opgeslagen.', 'Action saved.'));
  }


  // ---------------------------------------------------------- simple mode ---
  const HELP = {
    hotpix: ['Haalt losse felle pixels (ruis van de camera) weg.', 'Removes single bright pixels (camera noise).'],
    gradient: ['Haalt lichtvervuiling en ongelijke achtergrond weg, zodat de lucht overal even donker is.', 'Removes light pollution and an uneven background so the sky is equally dark everywhere.'],
    vignfix: ['Maakt donkere hoeken lichter.', 'Brightens dark corners.'],
    colorcal: ['Maakt de achtergrond neutraal grijs en geeft de sterren natuurlijke kleuren.', 'Makes the background neutral grey and gives stars natural colours.'],
    deconv: ['Maakt sterren en details scherper door de wazigheid van de lucht terug te rekenen.', 'Sharpens stars and detail by undoing atmospheric blur.'],
    stretch: ['De belangrijkste stap: maakt de donkere ruwe opname helder zodat de nevel zichtbaar wordt.', 'The key step: brightens the dark raw image so the nebula becomes visible.'],
    hdr: ['Voorkomt dat felle kernen (zoals in Orion) wit uitbijten.', 'Keeps bright cores (like in Orion) from burning out to white.'],
    hdrmt: ['Haalt detail terug in felle gebieden.', 'Recovers detail in bright areas.'],
    palette: ['Kleuren voor foto\'s met een duoband-filter (rood/blauwgroen).', 'Colours for photos taken with a dual-band filter (red/teal).'],
    scnr: ['Haalt een groene waas weg.', 'Removes a green cast.'],
    starreduce: ['Maakt sterren kleiner zodat de nevel meer opvalt.', 'Makes stars smaller so the nebula stands out.'],
    starsplit: ['Bewerk sterren apart: kleiner, minder fel, andere kleur of helemaal weg.', 'Edit stars separately: smaller, dimmer, different colour or removed.'],
    spikes: ['Voegt kruisvormige stralen toe aan felle sterren.', 'Adds cross-shaped rays to bright stars.'],
    denoise: ['Maakt korrelige ruis glad.', 'Smooths out grainy noise.'],
    bgsmooth: ['Maakt alleen de donkere achtergrond gladder, niet de nevel.', 'Smooths only the dark background, not the nebula.'],
    localcontrast: ['Laat structuur in de nevel meer uitkomen.', 'Brings out structure in the nebula.'],
    sharpen: ['Maakt fijne details scherper zonder de ruis te versterken.', 'Sharpens fine detail without boosting noise.'],
    wavelets: ['Versterkt detail per grootte, zoals in RegiStax. Vooral voor maan en planeten.', 'Boosts detail per size, like RegiStax. Mainly for moon and planets.'],
    brightcon: ['Lichter/donkerder en meer of minder contrast.', 'Lighter/darker and more or less contrast.'],
    levels: ['Zwartpunt, middentonen en witpunt instellen.', 'Set black point, midtones and white point.'],
    curves: ['Trek aan de lijn om bepaalde helderheden lichter of donkerder te maken.', 'Drag the line to make certain brightness levels lighter or darker.'],
    vibrance: ['Meer of minder kleur.', 'More or less colour.'],
    huesat: ['Kleur verschuiven, verzadigen of één kleur geven.', 'Shift colour, saturate or colourise.'],
    hsl: ['Pas één kleur aan, bijvoorbeeld alleen het rood van de nevel.', 'Adjust one colour, e.g. only the red of the nebula.'],
    temptint: ['Warmer (geler) of koeler (blauwer).', 'Warmer (yellower) or cooler (bluer).'],
    glow: ['Zachte gloed rond felle delen.', 'Soft glow around bright parts.'],
    vignette: ['Donkere randen voor meer focus op het midden.', 'Dark edges to focus on the centre.'],
    heal: ['Schilder over satellietstrepen of vlekken om ze weg te werken.', 'Paint over satellite trails or spots to remove them.'],
    text: ['Tekst op de foto, bijvoorbeeld de naam van het object.', 'Text on the photo, e.g. the object name.'],
  };
  const helpOf = (op) => (HELP[op] ? L(HELP[op][0], HELP[op][1]) : '');
  const ORDER = ['hotpix', 'vignfix', 'gradient', 'colorcal', 'deconv', 'stretch', 'hdr', 'hdrmt', 'palette', 'denoise', 'bgsmooth', 'starsplit', 'starreduce', 'localcontrast', 'sharpen', 'wavelets', 'brightcon', 'temptint', 'vibrance', 'hsl', 'scnr', 'spikes', 'glow', 'vignette', 'bw', 'huesat'];
  function ensureLayer(op, init) {
    const d = D(); let ly = d.layers.find((l) => l.op === op);
    if (ly) return ly;
    ly = O.newLayer(op, init);
    const oi = ORDER.indexOf(op);
    let at = d.layers.findIndex((l) => l.op === 'text' || (ORDER.indexOf(l.op) > oi));
    if (at < 0) at = d.layers.length;
    d.layers.splice(at, 0, ly);
    return ly;
  }
  // ---- guided simple mode: steps, controls with an explanation, and advice ----
  // Every control edits a normal layer parameter, so Expert mode shows exactly the same settings.
  const layerOf = (op) => D().layers.find((l) => l.op === op && l.on);
  const stretchLayer = () => layerOf('stretch');
  const hasStretch = () => !!layerOf('stretch');
  const pct = (x) => Math.round(x * 100);
  const SIMPLE = [
    { k: 'bright', step: 3, nl: 'Helderheid (stretch)', en: 'Brightness (stretch)', min: 0.04, max: 0.45, step0: 0.005, def: 0.19,
      hnl: 'Maakt zwakke details zichtbaar die nu nauwelijks te zien zijn. Hoger is helderder, maar laat ook meer ruis zien.',
      hen: 'Reveals faint detail that is barely visible now. Higher is brighter, but also shows more noise.',
      visible: hasStretch, get: () => stretchLayer().params.brightness ?? 0.19, set: (v) => { stretchLayer().params.brightness = v; },
      advice: (v) => (v > 0.3 ? ['warn', 'De lucht wordt grijs en ruis valt meer op. Meestal is 0,15–0,25 mooi.', 'The sky turns grey and noise shows more. Usually 0.15–0.25 looks best.'] : v < 0.1 ? ['warn', 'Zwakke nevel kan in het donker wegvallen.', 'Faint nebula may disappear into the dark.'] : null) },
    { k: 'black', step: 3, nl: 'Zwartpunt', en: 'Black point', min: 0, max: 1, step0: 0.01, def: 0.33,
      hnl: 'Bepaalt hoe donker de achtergrond (de lucht) wordt.', hen: 'Sets how dark the background (the sky) becomes.',
      visible: hasStretch, get: () => stretchLayer().params.blackPoint ?? 0.33, set: (v) => { stretchLayer().params.blackPoint = v; },
      advice: (v) => (v > 0.75 ? ['warn', 'Zwakke details kunnen in het zwart verdwijnen.', 'Faint details may vanish into black.'] : null) },
    { k: 'highlights', step: 3, nl: 'Felle delen sparen', en: 'Protect bright areas', min: 0, max: 1, step0: 0.01, def: 0.65,
      hnl: 'Houdt structuur zichtbaar in heldere delen, zoals de kern van de Orionnevel of een sterrenstelsel.', hen: 'Keeps structure visible in bright areas, like the core of the Orion Nebula or a galaxy.',
      visible: () => hasStretch() && (stretchLayer().params.method || 'auto') === 'auto',
      get: () => stretchLayer().params.shoulder ?? 0.5, set: (v) => { stretchLayer().params.shoulder = v; },
      advice: (v) => (v < 0.2 ? ['tip', 'Is de kern een witte vlek? Zet deze hoger.', 'Is the core a white blob? Turn this up.'] : null) },
    { k: 'contrast', step: 3, nl: 'Contrast', en: 'Contrast', min: -1, max: 1, step0: 0.01, def: 0,
      hnl: 'Verschil tussen licht en donker in het object.', hen: 'Difference between light and dark in the object.',
      get: () => (layerOf('brightcon') ? layerOf('brightcon').params.contrast : 0), set: (v) => { const l = ensureLayer('brightcon', { brightness: 0, contrast: 0 }); l.params.contrast = v; l.on = true; },
      advice: (v) => (v > 0.5 ? ['warn', 'Veel contrast kan zwakke delen dichtdrukken.', 'Strong contrast can crush faint areas.'] : null) },
    { k: 'lp', step: 4, nl: 'Lichtvervuiling weghalen', en: 'Remove light pollution', min: 0, max: 1, step0: 0.01, def: 0.85,
      hnl: 'Maakt een oranje of ongelijke lucht egaal donker.', hen: 'Makes an orange or uneven sky evenly dark.',
      get: () => (layerOf('gradient') ? layerOf('gradient').params.amount : 0), set: (v) => { const l = ensureLayer('gradient', { amount: 0 }); l.params.amount = v; l.on = true; },
      advice: (v, a) => (a && a.gradient > 0.25 && v < 0.5 ? ['tip', 'Er is duidelijke lichtvervuiling gemeten: 0,8 of hoger wordt aanbevolen.', 'Clear light pollution was measured: 0.8 or more is recommended.'] : v > 0.9 && D().action === 'milkyway' ? ['warn', 'Bij de Melkweg kan een hoge waarde ook de Melkweg zelf wegnemen.', 'With the Milky Way a high value can remove the Milky Way itself.'] : null) },
    { k: 'color', step: 4, nl: 'Verzadiging', en: 'Saturation', min: 0, max: 3, step0: 0.01, def: 1, fmt: (x) => pct(x) + '%',
      hnl: 'Versterkt de kleuren van nevels en sterren. De lege lucht wordt niet extra gekleurd.', hen: 'Strengthens the colours of nebulae and stars. The empty sky is not coloured extra.',
      get: () => (layerOf('vibrance') ? layerOf('vibrance').params.saturation : 1), set: (v) => { const l = ensureLayer('vibrance', { saturation: 1, vibrance: 0 }); l.params.saturation = v; l.on = true; },
      advice: (v) => (v > 2 ? ['warn', 'Boven 200% worden kleuren snel onnatuurlijk.', 'Above 200% colours quickly look unnatural.'] : null) },
    { k: 'warm', step: 4, nl: 'Koel ↔ warm', en: 'Cool ↔ warm', min: -1, max: 1, step0: 0.01, def: 0,
      hnl: 'Maakt het hele beeld blauwer of geler.', hen: 'Makes the whole image bluer or yellower.',
      get: () => (layerOf('colorcal') ? layerOf('colorcal').params.temperature : 0), set: (v) => { const l = ensureLayer('colorcal', { neutralize: false, whiteBalance: 0 }); l.params.temperature = v; l.on = true; },
      advice: (v, a) => (a && a.greenCast > 0.08 ? ['tip', 'Er is een groene zweem gemeten; die wordt automatisch verminderd.', 'A green cast was measured; it is reduced automatically.'] : null) },
    { k: 'noise', step: 5, nl: 'Ruis wegwerken', en: 'Reduce noise', min: 0, max: 1, step0: 0.01, def: 0.5,
      hnl: 'Vermindert ongewenste korrel, maar kan ook fijne details verzachten.', hen: 'Reduces unwanted grain, but can also soften fine detail.',
      get: () => (layerOf('denoise') ? layerOf('denoise').params.luma : 0), set: (v) => { const l = ensureLayer('denoise', { luma: 0, chroma: 0 }); l.params.luma = v; l.params.chroma = Math.min(1, v * 1.2); l.on = true; },
      advice: (v, a) => (v > 0.8 ? ['warn', 'Zoveel ruisonderdrukking maakt de foto snel wazig of "plasticachtig".', 'This much noise reduction quickly looks blurry or "plastic".'] : a && a.snr < 15 && v < 0.5 ? ['tip', 'Deze opname heeft veel ruis: 0,6–0,75 wordt aanbevolen.', 'This image is noisy: 0.6–0.75 is recommended.'] : null) },
    { k: 'stars', step: 5, nl: 'Sterren kleiner', en: 'Smaller stars', min: 0, max: 1, step0: 0.01, def: 0.3,
      hnl: 'Maakt sterren kleiner, zodat nevels en sterrenstelsels meer opvallen.', hen: 'Makes stars smaller so nebulae and galaxies stand out more.',
      get: () => { const s2 = layerOf('starsplit'); if (s2) return s2.params.reduce; const l = layerOf('starreduce'); return l ? l.params.amount : 0; },
      set: (v) => { const s2 = layerOf('starsplit'); if (s2) { s2.params.reduce = v; return; } const l = ensureLayer('starreduce', { amount: 0 }); l.params.amount = v; l.on = true; },
      advice: (v) => (v > 0.7 ? ['warn', 'Sterk verkleinen kan donkere randjes rond sterren geven.', 'Strong reduction can leave dark rims around stars.'] : D().action === 'cluster' && v > 0.2 ? ['tip', 'Bij een sterrenhoop zijn de sterren het onderwerp: liever laag houden.', 'In a star cluster the stars are the subject: better keep this low.'] : null) },
    { k: 'sharp', step: 5, nl: 'Scherpte', en: 'Sharpness', min: 0, max: 1.5, step0: 0.01, def: 0.3,
      hnl: 'Maakt fijne details scherper.', hen: 'Makes fine details crisper.',
      get: () => (layerOf('sharpen') ? layerOf('sharpen').params.amount : 0), set: (v) => { const l = ensureLayer('sharpen', { amount: 0 }); l.params.amount = v; l.on = true; },
      advice: (v) => (v > 1 ? ['warn', 'Veel verscherpen versterkt ook ruis en geeft randen rond sterren.', 'Heavy sharpening also boosts noise and adds rims around stars.'] : null) },
  ];
  const STEPS = [
    [1, 'Wat staat er op de foto?', 'What is in the photo?'],
    [2, 'Automatische bewerking', 'Automatic edit'],
    [3, 'Helderheid en stretch', 'Brightness and stretch'],
    [4, 'Kleur en lucht', 'Colour and sky'],
    [5, 'Ruis en sterren', 'Noise and stars'],
    [6, 'Vergelijken en opslaan', 'Compare and save'],
  ];
  const OBJECTS = [['nebula', '☁', 'Nevel', 'Nebula'], ['galaxy', '🌀', 'Sterrenstelsel', 'Galaxy'], ['cluster', '✦', 'Sterrenhoop', 'Star cluster'], ['milkyway', '🌌', 'Melkweg / breed', 'Milky Way / wide'], ['moon', '🌙', 'Maan', 'Moon'], ['sun', '🌞', 'Zon', 'Sun'], ['planet', '🪐', 'Planeet', 'Planet']];
  const STYLE_TILES = [['auto', '✨'], ['bright', '☀'], ['natural', '🌿'], ['nebula', '☁'], ['galaxy', '🌀'], ['cluster', '✦'], ['milkyway', '🌌'], ['starless', '○'], ['spikes', '✳'], ['dreamy', '💫'], ['mono', '◧'], ['hoo', 'Ⓗ'], ['foraxx', '🎨'], ['hubble', '🔭'], ['moon', '🌙'], ['moonColour', '🌕'], ['sun', '🌞'], ['sunHa', '🟠'], ['planet', '🪐']];
  function setMode(m) {
    S.mode = m; store.set('mode', m);
    if (m === 'simple') { S.tool = 'hand'; S.cropRect = null; S.viewMaskId = null; const d = D(); if (d) d.selection = null; }
    document.body.classList.toggle('simple', m === 'simple');
    renderAll(); requestPreview();
    setTimeout(() => { clampCenter(); draw(); }, 50);
  }
  function pSimple(box) {
    const d = D(); box.innerHTML = '';
    if (!d) {
      box.appendChild(el('div', 'sstep', `<b>1</b> ${L('Open een foto', 'Open a photo')}`));
      box.appendChild(el('p', 'pnote', L('Klik op <i>Foto openen</i> of sleep een foto in het venster. Het liefst het gestackte FITS-bestand van je telescoop: daar zit veel meer in dan in de JPG.', 'Click <i>Open photo</i> or drop a photo on the window. Preferably the stacked FITS file from your telescope: it holds far more than the JPG.')));
      const b = el('button', 'btn primary big', L('Foto openen…', 'Open photo…')); b.onclick = () => $('fileInput').click(); box.appendChild(b);
      const b2 = el('button', 'btn big', L('Probeer met een voorbeeld', 'Try with a sample')); b2.onclick = openDemo; box.appendChild(b2);
      return;
    }
    // which step is open: per document; "show all" keeps every step open (no forced wizard)
    if (!d.simpleStep) d.simpleStep = 2;
    const showAll = !!S.simpleShowAll;
    const head = el('div', 'guidehead');
    const ga = el('label', 'pline', `<input type="checkbox"> ${esc(L('Alle stappen tegelijk tonen', 'Show all steps at once'))}`);
    ga.querySelector('input').checked = showAll; ga.querySelector('input').onchange = (e) => { S.simpleShowAll = e.target.checked; store.set('simpleShowAll', S.simpleShowAll); pSimple(box); };
    head.appendChild(ga); box.appendChild(head);
    for (const [n, nl, en] of STEPS) {
      const open = showAll || d.simpleStep === n;
      const sec = el('section', 'gstep' + (open ? ' open' : '') + (n < d.simpleStep && !showAll ? ' done' : ''));
      sec.dataset.step = n;
      const h = el('button', 'gstephead', `<b>${n < d.simpleStep && !showAll ? '✓' : n}</b><span>${esc(L(nl, en))}</span><span class="chev">${open ? '▾' : '▸'}</span>`);
      h.onclick = () => { d.simpleStep = open && !showAll ? 0 : n; pSimple(box); };
      sec.appendChild(h);
      if (open) {
        const body = el('div', 'gstepbody');
        stepBody(n, body, d, box);
        if (!showAll && n < STEPS.length) { const nx = el('button', 'btn sm nextstep', L('Volgende stap →', 'Next step →')); nx.onclick = () => { d.simpleStep = n + 1; pSimple(box); }; body.appendChild(nx); }
        sec.appendChild(body);
      }
      box.appendChild(sec);
    }
    const rb = el('div', 'pbtns');
    const r2 = el('button', 'btn sm', '↶ ' + L('Ongedaan', 'Undo')); r2.onclick = undo; r2.disabled = d.hIndex <= 0; r2.id = 'sUndo';
    const r3 = el('button', 'btn sm', '↷ ' + L('Opnieuw', 'Redo')); r3.onclick = redo; r3.disabled = d.hIndex >= d.history.length - 1; r3.id = 'sRedo';
    const r1 = el('button', 'btn sm', '↺ ' + L('Opnieuw beginnen', 'Start over')); r1.title = L('Zet de gekozen stijl terug zoals hij was', 'Reset the chosen style'); r1.onclick = () => applyAction(d.action || 'auto');
    rb.appendChild(r2); rb.appendChild(r3); rb.appendChild(r1); box.appendChild(rb);
    const sv = el('button', 'btn primary big', '💾 ' + L('Opslaan…', 'Save…')); sv.onclick = exportDialog; const sw2 = el('div', 'stickysave'); sw2.appendChild(sv); box.appendChild(sw2);
    const ex = el('div', 'expertnote', `${L('Meer mogelijkheden nodig? Lagen, maskers, curven, tekst…', 'Need more? Layers, masks, curves, text…')} `);
    const eb = el('button', 'linkbtn', L('Naar Expert-modus →', 'Switch to Expert mode →')); eb.onclick = () => setMode('expert'); ex.appendChild(eb);
    box.appendChild(ex);
  }
  function stepBody(n, body, d, box) {
    const note = (nl, en) => body.appendChild(el('p', 'pnote', L(nl, en)));
    if (n === 1) {
      const det = d.detected;
      const what = det && !det.fallback ? (OBJECTS.find((o) => o[0] === det.type) || [])[2] : null;
      note(what ? `AstroPolish denkt dat dit een <b>${esc(L(what, (OBJECTS.find((o) => o[0] === det.type) || [])[3]))}</b> is${det.label ? ` (${esc(det.label)})` : ''}. Klopt dat niet? Kies hieronder wat er op de foto staat; de bewerking past zich daarop aan.` : 'Kies wat er op de foto staat; de bewerking past zich daarop aan.',
        what ? `AstroPolish thinks this is a <b>${esc((OBJECTS.find((o) => o[0] === det.type) || [])[3])}</b>${det.label ? ` (${esc(det.label)})` : ''}. Not right? Choose what is in the photo below; the edit adapts to it.` : 'Choose what is in the photo; the edit adapts to it.');
      const g = el('div', 'stylegrid');
      for (const [k, ic, nl, en] of OBJECTS) {
        const b = el('button', 'stile' + (d.action === k || (d.action === 'auto' && det && det.type === k) ? ' on' : ''), `<span class="ic">${ic}</span><span>${esc(L(nl, en))}</span>`);
        b.dataset.object = k; b.onclick = () => { applyAction(k); };
        g.appendChild(b);
      }
      body.appendChild(g);
      const db = el('label', 'pline', `<input type="checkbox"> ${esc(L('Gemaakt met een duoband-filter (bijv. Dwarf duo-band, L-eNhance)', 'Taken with a dual-band filter (e.g. Dwarf duo-band, L-eNhance)'))}`);
      db.querySelector('input').checked = ['hoo', 'foraxx', 'hubble'].includes(d.action) || !!(det && det.dualBand);
      db.querySelector('input').onchange = (e) => applyAction(e.target.checked ? 'hoo' : 'nebula');
      body.appendChild(db);
      return;
    }
    if (n === 2) {
      note('De foto is al automatisch bewerkt: lichtvervuiling weg, kleuren gekalibreerd, uitgerekt, ruis en sterren aangepakt. Probeer gerust een andere stijl; je kunt altijd terug.',
        'The photo has already been edited automatically: light pollution removed, colours calibrated, stretched, noise and stars handled. Feel free to try another style; you can always go back.');
      const grid = el('div', 'stylegrid'), all = ACTIONS.flatMap(([, , list]) => list), det = d.detected && d.detected.type, showAllStyles = S.simpleAllStyles;
      const solar = ['moon', 'moonColour', 'sun', 'sunHa', 'planet'], nb = ['hoo', 'foraxx', 'hubble'], isSolar = solar.includes(det) || solar.includes(d.action);
      let tiles = STYLE_TILES.filter(([k]) => showAllStyles || (isSolar ? solar.includes(k) || k === 'auto' : !solar.includes(k) && ((d.detected && d.detected.dualBand) || nb.includes(d.action) ? true : !nb.includes(k))));
      if (!showAllStyles) tiles = tiles.slice(0, 9);
      for (const [k, ic] of tiles) {
        const a = all.find((x) => x[0] === k); if (!a) continue;
        const b = el('button', 'stile' + (d.action === k ? ' on' : ''), `<span class="ic">${ic}</span><span>${esc(L(a[2], a[3]))}</span>`);
        b.dataset.action = k; b.onclick = () => applyAction(k);
        grid.appendChild(b);
      }
      body.appendChild(grid);
      const more = el('button', 'linkbtn', showAllStyles ? L('Minder stijlen', 'Fewer styles') : L('Alle stijlen tonen', 'Show all styles'));
      more.onclick = () => { S.simpleAllStyles = !showAllStyles; pSimple(box); };
      body.appendChild(more);
      return;
    }
    if (n === 6) {
      note('Houd de knop vast om het origineel te zien, of zet voor/na naast elkaar. Bekijk op 100% of de sterren rond zijn en de ruis meevalt.',
        'Hold the button to see the original, or show before/after side by side. Check at 100% that stars are round and noise is acceptable.');
      const vb = el('div', 'pbtns');
      const cmp = el('button', 'btn' + (S.showOriginal ? ' on' : ''), '👁 ' + L('Houd vast: origineel', 'Hold: original'));
      cmp.onpointerdown = () => { S.showOriginal = true; draw(); }; const up = () => { if (S.showOriginal) { S.showOriginal = false; draw(); } };
      cmp.onpointerup = up; cmp.onpointerleave = up;
      const sp = el('button', 'btn' + (S.split ? ' on' : ''), '◧ ' + L('Voor/na', 'Before/after')); sp.onclick = () => { S.split = !S.split; draw(); pSimple(box); };
      const z = el('button', 'btn', '🔍 ' + (d.zoom === 'fit' ? L('Inzoomen 100%', 'Zoom 100%') : L('Hele foto', 'Whole photo'))); z.onclick = () => { setZoom(d.zoom === 'fit' ? 1 : 'fit'); pSimple(box); };
      vb.appendChild(cmp); vb.appendChild(sp); vb.appendChild(z); body.appendChild(vb);
      note('Kies bij opslaan bijvoorbeeld "Instagram 4:5" of "Bureaublad". Je origineel blijft altijd bewaard.', 'When saving you can pick e.g. "Instagram 4:5" or "Desktop". Your original is never changed.');
      return;
    }
    const intro = {
      3: ['Een astrofoto komt heel donker uit de telescoop. Uitrekken (stretch) maakt de zwakke nevel zichtbaar; daarna bepaal je hoe donker de lucht is en hoeveel structuur felle delen houden.', 'An astrophoto comes out of the telescope very dark. Stretching makes the faint nebula visible; then you choose how dark the sky is and how much structure bright areas keep.'],
      4: ['Eerst de lucht egaal maken, dan de kleuren op smaak brengen.', 'First make the sky even, then adjust the colours to taste.'],
      5: ['Ruisonderdrukking en kleinere sterren laten het object beter uitkomen. Zet ze niet te hoog: dan wordt het beeld onnatuurlijk.', 'Noise reduction and smaller stars make the object stand out. Do not overdo it: the image becomes unnatural.'],
    }[n];
    if (intro) note(intro[0], intro[1]);
    for (const c of SIMPLE.filter((x) => x.step === n)) {
      if (c.visible && !c.visible()) continue;
      const row = el('div', 'srow', `<div class="sl"><span>${esc(L(c.nl, c.en))}</span><span class="v"></span></div><input type="range" min="${c.min}" max="${c.max}" step="${c.step0}"><div class="sh">${esc(L(c.hnl, c.hen))}</div><div class="adv"></div>`);
      const i = row.querySelector('input'), v = row.querySelector('.v'), adv = row.querySelector('.adv');
      i.title = L(c.hnl, c.hen);
      const show = (x) => {
        v.textContent = c.fmt ? c.fmt(x) : (x > 0 && c.min < 0 ? '+' : '') + pct(x);
        const a = c.advice ? c.advice(x, d.analysis) : null;
        adv.className = 'adv' + (a ? ' ' + a[0] : ''); adv.textContent = a ? (a[0] === 'warn' ? '⚠ ' : '💡 ') + L(a[1], a[2]) : '';
      };
      const cur = c.get(d); i.value = cur; show(cur);
      i.oninput = () => { c.set(+i.value); show(+i.value); requestPreview(); commit(L(c.nl, c.en)); };
      i.ondblclick = () => { i.value = c.def; i.oninput(); };
      row.dataset.k = c.k;
      body.appendChild(row);
    }
    body.appendChild(el('p', 'pnote small', L('Dubbelklik op een schuifje om het terug te zetten.', 'Double-click a slider to reset it.')));
  }

  // -------------------------------------------------------------- dialogs ---
  function dialog(title, body, buttons, opts) {
    const dlg = $('dlg'); const b = $('dlgBody'); b.innerHTML = '';
    dlg.className = 'dlg' + (opts && opts.wide ? ' wide' : '');
    b.appendChild(el('div', 'dh', esc(title)));
    const db = el('div', 'db'); if (typeof body === 'string') db.innerHTML = body; else db.appendChild(body); b.appendChild(db);
    const df = el('div', 'df');
    for (const bt of (buttons || [{ label: L('Sluiten', 'Close') }])) { const x = el('button', 'btn' + (bt.primary ? ' primary' : ''), esc(bt.label)); x.onclick = async () => { if (bt.action) { const keep = await bt.action(); if (keep === true) return; } dlg.close(); }; df.appendChild(x); }
    b.appendChild(df);
    if (!dlg.open) dlg.showModal();
    return db;
  }
  const SIZES = [
    ['orig', 'Origineel formaat', 'Original size', { mode: 'original' }], ['4k', 'Max. 3840 px (4K)', 'Max 3840 px (4K)', { mode: 'long', size: 3840 }],
    ['2k', 'Max. 2048 px', 'Max 2048 px', { mode: 'long', size: 2048 }], ['1080', 'Max. 1080 px', 'Max 1080 px', { mode: 'long', size: 1080 }],
    ['ig45', 'Instagram 4:5 (1080×1350)', 'Instagram 4:5 (1080×1350)', { mode: 'pad', ratio: [4, 5], width: 1080 }], ['ig11', 'Instagram 1:1 (1080×1080)', 'Instagram 1:1 (1080×1080)', { mode: 'pad', ratio: [1, 1], width: 1080 }],
    ['wall', 'Bureaublad 16:9 (3840×2160)', 'Desktop 16:9 (3840×2160)', { mode: 'fill', ratio: [16, 9], width: 3840 }], ['phone', 'Telefoon (1179×2556)', 'Phone (1179×2556)', { mode: 'fill', ratio: [1179, 2556], width: 1179 }],
    ['up2', 'Vergroot 2×', 'Enlarge 2×', { mode: 'upscale', factor: 2 }], ['half', '50%', '50%', { mode: 'scale', factor: 0.5 }],
  ];
  function exportDialog() {
    const d = D(); if (!d) return;
    const P = S.exportPrefs;
    const box = el('div', 'grid2');
    box.innerHTML = `<span>${L('Bestandsnaam', 'File name')}</span><input type="text" id="exName">
      <span>${L('Formaat', 'Format')}</span><select id="exFmt"><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option><option value="tif">TIFF 16-bit</option><option value="fits">FITS 32-bit float</option></select>
      <span>${L('Kwaliteit (JPG/WebP)', 'Quality (JPG/WebP)')}</span><span><input type="range" id="exQ" min="0.5" max="1" step="0.01"> <b id="exQv"></b></span>
      <span>${L('Afmeting', 'Size')}</span><select id="exSize">${SIZES.map(([k, nl, en]) => `<option value="${k}">${esc(L(nl, en))}</option>`).join('')}</select>
      <span>${L('Extra', 'Extras')}</span><span><label><input type="checkbox" id="exCmp"> ${L('Voor/na naast elkaar', 'Before/after side by side')}</label><br><label><input type="checkbox" id="exTxt"> ${L('Tekstlagen meenemen (JPG/PNG/WebP)', 'Include text layers (JPG/PNG/WebP)')}</label></span>
      <span></span><span class="pnote">${d.src.w} × ${d.src.h} px · ${d.layers.length} ${L('lagen', 'layers')}</span>`;
    dialog(L('Exporteren als', 'Export as'), box, [{ label: L('Annuleren', 'Cancel') }, { label: L('Exporteren', 'Export'), primary: true, action: async () => {
      Object.assign(P, { format: $('exFmt').value, quality: +$('exQ').value, size: $('exSize').value, compare: $('exCmp').checked, text: $('exTxt').checked });
      store.set('export', P);
      const nm = $('exName').value || baseName(d.name) + '_astropolish';
      $('dlg').close();
      await doExport(nm);
      return true;
    } }]);
    $('exName').value = baseName(d.name) + '_astropolish'; $('exFmt').value = P.format; $('exQ').value = P.quality; $('exQv').textContent = Math.round(P.quality * 100) + '%';
    $('exQ').oninput = () => { $('exQv').textContent = Math.round(+$('exQ').value * 100) + '%'; };
    $('exSize').value = P.size; $('exCmp').checked = P.compare; $('exTxt').checked = P.text;
  }
  async function quickExport() { const d = D(); if (d) await doExport(baseName(d.name) + '_astropolish'); }
  async function doExport(name) {
    const P = S.exportPrefs;
    overlay(L('Exporteren in volle resolutie…', 'Exporting at full resolution…'));
    try {
      await nextFrame();
      const blob = await renderFull(D(), P);
      overlay(null);
      const saved = await saveBlob(blob, `${name}.${P.format}`);
      if (saved) { toast(L('Opgeslagen: ', 'Saved: ') + saved); const d = D(); if (d) d.dirty = false; }
    } catch (e) { overlay(null); await recoverWorker(); showError(L('Exporteren is mislukt', 'Export failed'), e, `export ${P.format} ${P.size}`); }
  }
  function compareLayers(d) { return d.original.meta && d.original.meta.linear ? [O.newLayer('stretch', { method: 'auto', brightness: 0.2, colorPreserve: 0 })] : null; }
  async function renderFull(d, P) {
    const size = (SIZES.find((s) => s[0] === P.size) || SIZES[0])[3];
    const format = P.format === 'tif' ? 'rgb16' : P.format === 'fits' ? 'float' : 'rgba';
    const res = await proc.call({ cmd: 'full', layers: d.layers, format, size, compare: !!P.compare, compareLayers: P.compare ? compareLayers(d) : null });
    if (format === 'rgb16') return new Blob([F.writeTIFF16(res.data, res.w, res.h)], { type: 'image/tiff' });
    if (format === 'float') {
      const meta = d.original.meta || {}, hd = meta.header || {};
      const extra = { OBJECT: meta.object || autoInfo().title, SOFTWARE: 'AstroPolish 3' };
      for (const k of ['DATE-OBS', 'EXPTIME', 'TELESCOP', 'INSTRUME', 'FILTER', 'STACKCNT', 'RA', 'DEC']) if (hd[k] !== undefined) extra[k] = hd[k];
      return new Blob([F.writeFITS(res.r, res.g, res.b, res.w, res.h, extra)], { type: 'application/fits' });
    }
    const c = document.createElement('canvas'); putCanvas(c, res.data, res.w, res.h);
    const g = c.getContext('2d');
    if (P.text !== false) {
      if (P.compare) drawTexts(g, res.w / 2, 0, res.w / 2, res.h, d.layers);
      else if (size.mode === 'pad') { const f = Math.min(res.w / d.src.w, res.h / d.src.h), iw = d.src.w * f, ih = d.src.h * f; drawTexts(g, (res.w - iw) / 2, (res.h - ih) / 2, iw, ih, d.layers); }
      else drawTexts(g, 0, 0, res.w, res.h, d.layers);
    }
    if (P.compare) { const fs = Math.max(14, res.h * 0.03); g.font = `600 ${fs}px "Segoe UI", sans-serif`; g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 6; g.textBaseline = 'top'; g.fillText(L('Voor', 'Before'), fs, fs); g.fillText(L('Na', 'After'), res.w / 2 + fs, fs); }
    const mime = P.format === 'png' ? 'image/png' : P.format === 'webp' ? 'image/webp' : 'image/jpeg';
    return await new Promise((r) => c.toBlob(r, mime, P.quality));
  }
  const TYPES = { jpg: ['JPEG', 'image/jpeg', '.jpg'], png: ['PNG', 'image/png', '.png'], webp: ['WebP', 'image/webp', '.webp'], tif: ['TIFF', 'image/tiff', '.tif'], fits: ['FITS', 'application/fits', '.fits'], json: ['JSON', 'application/json', '.json'] };
  async function saveBlob(blob, name) {
    const ext = name.split('.').pop(), t = TYPES[ext];
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name, types: t ? [{ description: t[0], accept: { [t[1]]: [t[2]] } }] : undefined });
        const w = await h.createWritable(); await w.write(blob); await w.close(); return h.name;
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
        // writing to the chosen file failed (disk full, no permission...): the original file is left
        // untouched by the File System Access API; fall back to a normal download and say so
        console.error(e);
        toast(L('Opslaan op de gekozen plek lukte niet (', 'Saving to the chosen location failed (') + (e.message || e) + L('). Het bestand wordt gedownload.', '). The file is downloaded instead.'), 8000);
      }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return name;
  }
  async function saveProject() {
    const d = D(); if (!d) return;
    try {
      const saved = await saveBlob(new Blob([JSON.stringify({ app: 'AstroPolish', type: 'project', version: 3, appVersion: window.APP_VERSION || '', file: d.name, layers: d.layers, geom: d.geom, autoCrop: d.autoCrop }, null, 2)], { type: 'application/json' }), baseName(d.name) + '.astropolish.json');
      if (saved) { d.dirty = false; toast(L('Project opgeslagen: ', 'Project saved: ') + saved + L(' (bewaar het samen met de originele foto)', ' (keep it together with the original photo)'), 6000); }
    } catch (e) { showError(L('Project opslaan is mislukt', 'Saving the project failed'), e, 'save project'); }
  }
  function importJSON(kind) {
    const inp = $('jsonInput');
    inp.onchange = async () => {
      const f = inp.files[0]; inp.value = ''; if (!f) return;
      let js;
      try { js = JSON.parse(await f.text()); } catch (e) { showError(L('Dit bestand kan niet worden gelezen', 'This file cannot be read'), new Error(L('Geen geldig JSON-bestand: ', 'Not a valid JSON file: ') + e.message), 'import ' + f.name); return; }
      if (!js || typeof js !== 'object' || (js.app && js.app !== 'AstroPolish')) { toast(L('Dit is geen AstroPolish-bestand.', 'This is not an AstroPolish file.'), 6000); return; }
      if (js.type === 'actions' || kind === 'actions') {
        const acts = {}; let dropped = 0;
        for (const [n, a] of Object.entries(js.actions || {})) { const r = O.sanitizeLayers(a && a.layers); dropped += r.dropped; if (r.layers.length) acts[String(n).slice(0, 50)] = { layers: r.layers }; }
        store.set('actions', Object.assign(store.get('actions', {}), acts)); renderPanels(['actions']);
        toast(L(`${Object.keys(acts).length} acties geïmporteerd.`, `${Object.keys(acts).length} actions imported.`) + (dropped ? L(` ${dropped} onbekende lagen overgeslagen.`, ` ${dropped} unknown layers skipped.`) : ''), 6000);
        return;
      }
      const d = D(); if (!d) { toast(L('Open eerst de foto waar dit project bij hoort.', 'First open the photo this project belongs to.'), 6000); return; }
      if (!Array.isArray(js.layers)) { toast(L('Geen lagen in dit bestand.', 'No layers in this file.')); return; }
      const r = O.sanitizeLayers(js.layers);
      d.layers = r.layers; d.sel = null;
      if (js.geom && typeof js.geom === 'object') d.geom = O.sanitizeGeom(js.geom, GEOM0);
      if (typeof js.autoCrop === 'boolean') d.autoCrop = js.autoCrop;
      await sendSource(); renderPanels(); commit(L('Project geladen', 'Project loaded'), true);
      const other = js.file && js.file !== d.name ? L(` Let op: gemaakt voor "${js.file}".`, ` Note: made for "${js.file}".`) : '';
      toast(L('Project geladen.', 'Project loaded.') + (r.dropped ? L(` ${r.dropped} onbekende of ongeldige lagen overgeslagen.`, ` ${r.dropped} unknown or invalid layers skipped.`) : '') + other, 7000);
    };
    inp.click();
  }
  function sizeDialog() {
    const d = D(); if (!d) return;
    const box = el('div', 'grid2');
    box.innerHTML = `<span>${L('Schaal', 'Scale')}</span><span><input type="number" id="szP" min="10" max="400" step="1" style="width:70px"> %</span><span>Binning</span><label><input type="checkbox" id="szB"> 2×2 (${L('halve grootte, minder ruis', 'half size, less noise')})</label><span></span><span class="pnote">${L('Huidig', 'Current')}: ${d.src.w} × ${d.src.h} px</span>`;
    dialog(L('Afbeeldingsgrootte', 'Image size'), box, [{ label: L('Annuleren', 'Cancel') }, { label: 'OK', primary: true, action: () => { const v = +$('szP').value; if ($('szP').value.trim() === '' || !Number.isFinite(v)) { toast(L('Vul een percentage tussen 10 en 400 in.', 'Enter a percentage between 10 and 400.')); return true; } d.geom.bin = $('szB').checked; setGeom('scale', clamp(v, 10, 400) / 100, L('Afbeeldingsgrootte', 'Image size')); } }]);
    $('szP').value = Math.round((d.geom.scale || 1) * 100); $('szB').checked = !!d.geom.bin;
  }
  function rotateDialog() {
    const d = D(); if (!d) return;
    const box = el('div', 'grid2');
    box.innerHTML = `<span>${L('Hoek (graden)', 'Angle (degrees)')}</span><input type="number" id="rtA" min="-45" max="45" step="0.1" style="width:90px"><span></span><span class="pnote">${L('Positief = rechtsom. Lege hoeken worden automatisch weggesneden. Tip: meet een hoek met de liniaal (R).', 'Positive = clockwise. Empty corners are cropped automatically. Tip: measure an angle with the ruler (R).')}</span>`;
    dialog(L('Rechtzetten', 'Straighten'), box, [{ label: L('Annuleren', 'Cancel') }, { label: 'OK', primary: true, action: () => { const v = +$('rtA').value; if ($('rtA').value.trim() === '' || !Number.isFinite(v)) { toast(L('Vul een hoek tussen -45 en 45 graden in.', 'Enter an angle between -45 and 45 degrees.')); return true; } setGeom('angle', clamp(v, -45, 45), L('Rechtzetten', 'Straighten')); } }]);
    $('rtA').value = d.geom.angle || 0;
  }
  function prefsDialog() {
    const box = el('div', 'grid2');
    box.innerHTML = `<span>${L('Taal', 'Language')}</span><select id="pfL"><option value="nl">Nederlands</option><option value="en">English</option></select>
      <span>${L('Voorbeeldgrootte', 'Preview size')}</span><select id="pfP"><option value="800">800 px (${L('snelst', 'fastest')})</option><option value="1200">1200 px</option><option value="1600">1600 px</option><option value="2000">2000 px (${L('scherpst', 'sharpest')})</option></select>
      <span>${L('Laag-cache', 'Layer cache')}</span><select id="pfC"><option value="6">6</option><option value="12">12</option><option value="20">20</option></select>
      <span></span><span class="pnote">${L('Een grotere cache maakt aanpassen sneller maar gebruikt meer geheugen.', 'A larger cache makes edits faster but uses more memory.')}</span>`;
    dialog(L('Voorkeuren', 'Preferences'), box, [{ label: L('Annuleren', 'Cancel') }, { label: 'OK', primary: true, action: async () => {
      I18N.setLang($('pfL').value); S.prefs.preview = +$('pfP').value; S.prefs.cache = +$('pfC').value; store.set('prefs', S.prefs);
      renderAll(); if (D()) await sendSource();
    } }]);
    $('pfL').value = I18N.getLang(); $('pfP').value = String(S.prefs.preview); $('pfC').value = String(S.prefs.cache);
  }
  function helpDialog() {
    dialog(L('AstroPolish Help', 'AstroPolish Help'), L(`
      <p>AstroPolish werkt zoals Photoshop, met <b>aanpassingslagen</b>. Elke bewerking is een laag die je kunt verbergen, verplaatsen, maskeren, met een overvloeimodus mengen en later nog aanpassen. Het origineel blijft altijd onaangetast.</p>
      <h3>Snel beginnen</h3><ol><li>Bestand → Openen (of sleep een foto in het venster). AstroPolish maakt meteen een complete automatische bewerking als lagen.</li><li>Kies bij <i>Acties</i> een andere stijl, of pas lagen aan in <i>Eigenschappen</i>.</li><li>Bestand → Exporteren als (Ctrl+S).</li></ol>
      <h3>Lagen en maskers</h3><p>Nieuwe lagen komen boven de geselecteerde laag. Een masker kan gebaseerd zijn op helderheid, kleur, sterren, object of achtergrond, of op een selectie. Daarbovenop kun je schilderen met het penseel (B) of de gum (E). Alt+klik op het masker-icoon toont het masker.</p>
      <h3>Astro</h3><p>Lichtvervuiling, kleurkalibratie (met pipet), oprekken (STF, statistisch, arcsinh, GHS, log, niveaus, handmatig), HDR, deconvolutie, narrowband-paletten (HOO, Foraxx, Hubble), sterren verkleinen/verwijderen/kleuren, star spikes, ruis (4 methoden), wavelets, CLAHE, en sessies combineren met uitlijning op sterren.</p>
      <h3>Gereedschappen</h3><p>Hand (H), Zoom (Z), Selecties (M, L), Bijsnijden (C), Pipet (I), Sterinfo met FWHM (S), Liniaal en rechtzetten (R), Penseel/Gum op laagmaskers (B, E), Herstelpenseel voor satellietstrepen (J), Tekst (T), Verplaatsen (V).</p>
      <p class="pnote">Alles draait lokaal op je computer. Sterren verwijderen en ruisonderdrukking werken zonder AI-modellen.</p>`, `
      <p>AstroPolish works like Photoshop with <b>adjustment layers</b>. Every edit is a layer you can hide, reorder, mask, blend and change later. The original is never touched.</p>
      <h3>Quick start</h3><ol><li>File → Open (or drop a photo). AstroPolish immediately builds a complete automatic edit as layers.</li><li>Choose another style under <i>Actions</i>, or tweak layers in <i>Properties</i>.</li><li>File → Export as (Ctrl+S).</li></ol>
      <h3>Layers and masks</h3><p>New layers are placed above the selected layer. A mask can be based on luminance, colour, stars, object or background, or a selection. On top of that you can paint with the brush (B) or eraser (E). Alt+click the mask icon to view the mask.</p>
      <h3>Astro</h3><p>Light pollution, colour calibration (with picker), stretching (STF, statistical, arcsinh, GHS, log, levels, manual), HDR, deconvolution, narrowband palettes (HOO, Foraxx, Hubble), reduce/remove/colour stars, star spikes, noise (4 methods), wavelets, CLAHE and combining sessions with star alignment.</p>
      <h3>Tools</h3><p>Hand (H), Zoom (Z), Marquees (M, L), Crop (C), Eyedropper (I), Star info with FWHM (S), Ruler and straighten (R), Brush/Eraser on layer masks (B, E), Healing brush for satellite trails (J), Type (T), Move (V).</p>
      <p class="pnote">Everything runs locally. Star removal and noise reduction work without AI models.</p>`), null, { wide: true });
  }
  function keysDialog() {
    const rows = [['Ctrl+O', L('Openen', 'Open')], ['Ctrl+S', L('Exporteren als', 'Export as')], ['Shift+Ctrl+S', L('Snel exporteren', 'Quick export')], ['Alt+Ctrl+S', L('Project opslaan', 'Save project')], ['Ctrl+W', L('Sluiten', 'Close')],
      ['Ctrl+Z / Shift+Ctrl+Z / Ctrl+Y', L('Ongedaan maken / opnieuw', 'Undo / redo')], ['Ctrl+J', L('Laag dupliceren', 'Duplicate layer')], ['Del', L('Laag verwijderen', 'Delete layer')], ['Ctrl+[ / Ctrl+]', L('Laag omlaag / omhoog', 'Layer down / up')],
      ['Ctrl+L / M / U / B / I', L('Niveaus / Curven / Kleurtoon / Kleurbalans / Negatief', 'Levels / Curves / Hue / Colour balance / Invert')], ['Shift+Ctrl+L / Shift+Ctrl+B', L('Automatische tint / kleur', 'Auto tone / colour')],
      ['Ctrl+0 / Ctrl+1 / Ctrl++ / Ctrl+-', L('Passend / 100% / in / uit', 'Fit / 100% / in / out')], [L('Spatie', 'Space'), L('Tijdelijk hand', 'Temporary hand')], ['\\', L('Origineel tonen', 'Show original')], ['Y', L('Voor/na splitsen', 'Split before/after')],
      ['Ctrl+2..6', L('Kanalen RGB/R/G/B/L', 'Channels RGB/R/G/B/L')], ['Alt+K', L('Over-/onderbelichting', 'Clipping')], ['Ctrl+A / Ctrl+D', L('Alles / deselecteren', 'All / deselect')],
      ['V H Z M L C I S R B E J T', L('Gereedschappen', 'Tools')], ['[ / ]', L('Penseel kleiner / groter', 'Brush smaller / larger')], ['X / D', L('Kleuren wisselen / standaard', 'Swap / default colours')], ['Enter / Esc', L('Bijsnijden toepassen / annuleren', 'Apply / cancel crop')], ['F1', 'Help']];
    dialog(L('Sneltoetsen', 'Keyboard shortcuts'), `<table class="keys">${rows.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join('')}</table>`, null, { wide: true });
  }
  function aboutDialog() { dialog(L('Over AstroPolish', 'About AstroPolish'), `<p><b>AstroPolish 3</b><br>${L('Astrofoto-editor voor de Dwarf 3 en andere smart-telescopen.', 'Astrophoto editor for the Dwarf 3 and other smart telescopes.')}</p><p>${Object.keys(O.OPS).length - 1} ${L('bewerkingen', 'operations')} · ${O.BLENDS.length} ${L('overvloeimodi', 'blend modes')} · ${MASK_TYPES.length} ${L('maskertypes', 'mask types')} · ${TOOLS.filter((t) => t !== '-').length} ${L('gereedschappen', 'tools')}</p><p class="pnote">Open source (MIT) · github.com/Jona2511/astropolish</p>`); }

  function batchDialog() {
    const files = [];
    const box = el('div', '');
    const opts = `<option value="auto">${L('Automatisch per foto', 'Automatic per photo')}</option>${D() ? `<option value="layers">${L('Lagen van huidig document', 'Layers of current document')}</option>` : ''}${ACTIONS.flatMap(([, , l]) => l).map(([k, , nl, en]) => `<option value="a:${k}">${L('Actie: ', 'Action: ')}${esc(L(nl, en))}</option>`).join('')}${Object.keys(store.get('actions', {})).map((n) => `<option value="a:my:${esc(n)}">${L('Actie: ', 'Action: ')}${esc(n)}</option>`).join('')}`;
    box.innerHTML = `<p>${L('Verwerk veel foto\'s in één keer. De instellingen van "Exporteren als" (formaat, afmeting) worden gebruikt.', 'Process many photos at once. The settings from "Export as" (format, size) are used.')}</p>
      <div class="grid2"><span>${L('Bewerking', 'Processing')}</span><select id="btMode">${opts}</select></div>
      <p><button class="btn" id="btPick">${L("Foto's kiezen…", 'Choose photos…')}</button></p><ul class="files" id="btList"></ul>`;
    const render = () => { const u = $('btList'); if (u) u.innerHTML = files.map((f) => `<li><span>${esc(f.file.name)}</span><em class="${f.cls || ''}">${esc(f.status)}</em></li>`).join(''); };
    dialog(L('Batchverwerking', 'Batch processing'), box, [{ label: L('Sluiten', 'Close') }, { label: L('Start', 'Start'), primary: true, action: async () => { await runBatch(files, $('btMode').value, render); return true; } }], { wide: true });
    $('btPick').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = $('fileInput').accept; i.onchange = () => { for (const f of i.files) files.push({ file: f, status: L('wacht', 'waiting') }); render(); }; i.click(); };
    batchDialog.files = files; batchDialog.render = render;
  }
  async function runBatch(files, mode, render) {
    const cur = D(), P = S.exportPrefs;
    let dir = null;
    if (window.showDirectoryPicker) { try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e && e.name === 'AbortError') return; } }
    const curLayers = cur ? deep(cur.layers) : null;
    let n = 0;
    for (const f of files) {
      if (f.cls === 'ok') continue;
      f.status = L('bezig…', 'working…'); f.cls = 'busy2'; render();
      const d = newDoc(await decodeFile(f.file).catch(() => null) || E.newImage(1, 1), f.file.name);
      try {
        if (d.original.w < 2) throw new Error('decode');
        S.cur = d.id; await sendSource(false);
        if (mode === 'layers') d.layers = deep(curLayers);
        else {
          const name = mode === 'auto' ? 'auto' : mode.slice(2);
          if (name.startsWith('my:')) d.layers = deep(store.get('actions', {})[name.slice(3)].layers);
          else { const r = O.presetLayers(name, d.detected); d.layers = r.layers; if (r.autoCrop === false && d.autoCrop) { d.autoCrop = false; await sendSource(false); } }
        }
        const blob = await renderFull(d, P);
        const nm = `${baseName(f.file.name)}_astropolish.${P.format}`;
        if (dir) { const fh = await dir.getFileHandle(nm, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); } else await saveBlob(blob, nm);
        f.status = L('klaar', 'done'); f.cls = 'ok'; n++;
      } catch (e) { console.error(e); f.status = L('fout', 'error'); f.cls = 'err'; }
      S.docs.splice(S.docs.indexOf(d), 1);
      render();
    }
    S.cur = cur ? cur.id : null;
    if (cur) await sendSource();
    renderAll();
    toast(L(`${n} foto's verwerkt.`, `${n} photos processed.`), 5000);
  }
  function stackDialog(preset) {
    const files = (preset || []).map((f) => ({ file: f, status: L('wacht', 'waiting') }));
    const box = el('div', '');
    box.innerHTML = `<p>${L('Kies de gestackte bestanden van meerdere sessies van hetzelfde object. Ze worden op de sterren uitgelijnd (verschuiving en rotatie), genormaliseerd en gemiddeld. De eerste foto is de referentie.', 'Choose the stacked files of several sessions of the same object. They are aligned on the stars (shift and rotation), normalised and averaged. The first photo is the reference.')}</p>
      <p><button class="btn" id="stPick">${L("Foto's kiezen…", 'Choose photos…')}</button></p><ul class="files" id="stList"></ul>`;
    const render = () => { const u = $('stList'); if (u) u.innerHTML = files.map((f, i) => `<li><span>${i === 0 ? '⭐ ' : ''}${esc(f.file.name)}</span><em class="${f.cls || ''}">${esc(f.status)}</em></li>`).join(''); };
    dialog(L('Sessies combineren', 'Combine sessions'), box, [{ label: L('Sluiten', 'Close') }, { label: L('Combineren', 'Combine'), primary: true, action: async () => { const ok = await runStack(files, render); return !ok; } }], { wide: true });
    $('stPick').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = $('fileInput').accept; i.onchange = () => { for (const f of i.files) files.push({ file: f, status: L('wacht', 'waiting') }); render(); }; i.click(); };
    stackDialog.files = files; stackDialog.render = render;
    render();
  }
  async function runStack(files, render) {
    if (files.length < 2) { toast(L('Kies minstens twee foto\'s.', 'Choose at least two photos.')); return false; }
    await proc.call({ cmd: 'stackReset' });
    let ok = 0, ref = null;
    for (const f of files) {
      f.status = L('bezig…', 'working…'); f.cls = 'busy2'; render();
      try {
        const img = await decodeFile(f.file);
        if (!ref) ref = f.file.name;
        const r = await proc.call({ cmd: 'stackAdd', img: { w: img.w, h: img.h, r: img.r, g: img.g, b: img.b, mono: img.mono, meta: img.meta } }, [img.r.buffer, img.g.buffer, img.b.buffer]);
        if (r.ok) { ok++; f.cls = 'ok'; f.status = ok === 1 ? L('referentie', 'reference') : L(`uitgelijnd · ${r.matches} sterren · ${r.rot}°`, `aligned · ${r.matches} stars · ${r.rot}°`); }
        else { f.cls = 'err'; f.status = L('kon niet uitlijnen', 'could not align'); }
      } catch (e) { console.error(e); f.cls = 'err'; f.status = L('kan niet openen', 'cannot open'); }
      render();
    }
    if (ok < 2) { toast(L('Te weinig foto\'s konden worden uitgelijnd.', 'Too few photos could be aligned.'), 5000); return false; }
    overlay(L('Combineren…', 'Combining…'));
    try {
      const res = await proc.call({ cmd: 'stackFinish' });
      $('dlg').close();
      await openImage(res.img, `${baseName(ref)}_gecombineerd_${ok}x.fits`);
      toast(L(`${ok} opnames gecombineerd.`, `${ok} images combined.`), 5000);
    } catch (e) { toast(String(e.message || e)); }
    overlay(null);
    return true;
  }

  // ---------------------------------------------------------- start screen ---
  function renderStart() {
    const s = $('startscreen');
    if (S.mode === 'simple') {
      s.innerHTML = `<div class="box simplestart"><div class="steps">
        <h1>AstroPolish</h1><p class="lead">${L('Mooie astrofoto\'s in drie stappen.', 'Beautiful astrophotos in three steps.')}</p>
        <ol><li><b>${L('Open je foto', 'Open your photo')}</b><span>${L('Het gestackte FITS- of JPG-bestand van je Dwarf 3. De app maakt hem meteen zo helder en mooi mogelijk.', 'The stacked FITS or JPG file from your Dwarf 3. The app immediately makes it as bright and beautiful as possible.')}</span></li>
        <li><b>${L('Kies een stijl', 'Choose a style')}</b><span>${L('Niet tevreden? Klik een andere stijl aan of schuif aan helderheid, kleur of ruis.', 'Not happy? Click another style or move the brightness, colour or noise sliders.')}</span></li>
        <li><b>${L('Opslaan', 'Save')}</b><span>${L('Als JPG voor je telefoon, Instagram of als bureaubladachtergrond.', 'As JPG for your phone, Instagram or as a desktop background.')}</span></li></ol>
        <div class="pbtns"><button class="btn primary big" id="ssOpen">${L('Foto openen…', 'Open photo…')}</button><button class="btn big" id="ssDemo">${L('Probeer met een voorbeeld', 'Try with a sample')}</button></div>
        <p class="pnote">${L('Of sleep een foto in dit venster. Alles blijft op je eigen computer.', 'Or drop a photo on this window. Everything stays on your computer.')}</p></div></div>`;
      $('ssOpen').onclick = () => $('fileInput').click(); $('ssDemo').onclick = openDemo;
      return;
    }
    s.innerHTML = `<div class="box"><div class="col"><h1>AstroPolish</h1>
      <button class="btn primary big" id="ssOpen">${L('Openen…', 'Open…')}</button>
      <button class="btn big" id="ssDemo">${L('Voorbeeld openen', 'Open sample')}</button>
      <button class="btn big" id="ssStack">${L('Sessies combineren…', 'Combine sessions…')}</button>
      <button class="btn big" id="ssBatch">${L('Batchverwerking…', 'Batch processing…')}</button>
      <button class="btn big" id="ssHelp">${L('Help en sneltoetsen', 'Help and shortcuts')}</button></div>
      <div class="drop"><div><b>${L("Sleep foto's hierheen", 'Drop photos here')}</b>JPG · PNG · WebP · TIFF (8/16/32-bit) · FITS (RGB/Bayer)<br><br>${L('Meerdere FITS tegelijk slepen = sessies combineren.', 'Dropping several FITS at once = combine sessions.')}<br><br><span class="pnote">${L('Alles blijft op je eigen computer.', 'Everything stays on your computer.')}</span></div></div></div>`;
    $('ssOpen').onclick = () => $('fileInput').click(); $('ssDemo').onclick = openDemo; $('ssStack').onclick = () => stackDialog(); $('ssBatch').onclick = batchDialog; $('ssHelp').onclick = helpDialog;
  }
  function renderAll() { document.documentElement.lang = I18N.getLang(); document.body.classList.toggle('simple', S.mode === 'simple'); renderMenubar(); renderToolbar(); renderOptions(); renderStart(); renderDock(); renderStatus(); draw(); }

  // ------------------------------------------------------------- keyboard ---
  const typing = () => { const a = document.activeElement; return a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['range', 'checkbox', 'button', 'color'].includes(a.type)) || a.tagName === 'SELECT'); };
  window.addEventListener('keydown', (e) => {
    if ($('dlg').open) return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (k === 'Escape') { closeMenus(); if (S.tool === 'crop') setTool('hand'); if (S.pick) { S.pick = null; renderOptions(); updateCursor(); } return; }
    if (typing()) return;
    if (k === ' ') { if (!S.spaceHeld) { S.spaceHeld = true; updateCursor(); } e.preventDefault(); return; }
    if (ctrl) {
      const lk = k.toLowerCase();
      const map = {
        o: () => $('fileInput').click(), s: () => (e.shiftKey ? quickExport() : e.altKey ? saveProject() : exportDialog()), w: () => D() && closeDoc(D().id),
        z: () => (e.shiftKey ? redo() : undo()), y: redo, j: duplicateLayer, a: selectAll, d: deselect, k: prefsDialog,
        l: () => (e.shiftKey && e.altKey ? addLayer('autotone', { mode: 'contrast' }) : e.shiftKey ? addLayer('autotone', { mode: 'tone' }) : addLayer('levels')),
        m: () => addLayer('curves'), u: () => addLayer('huesat'), b: () => (e.shiftKey && e.altKey ? addLayer('bw') : e.shiftKey ? addLayer('autotone', { mode: 'color' }) : addLayer('colorbalance')),
        i: () => (e.shiftKey ? invertSelection() : e.altKey ? sizeDialog() : addLayer('invert')),
        0: () => setZoom('fit'), 1: () => setZoom(1), '=': () => zoomStep(1), '+': () => zoomStep(1), '-': () => zoomStep(-1),
        2: () => { S.channel = 'rgb'; draw(); }, 3: () => { S.channel = 'r'; draw(); }, 4: () => { S.channel = 'g'; draw(); }, 5: () => { S.channel = 'b'; draw(); }, 6: () => { S.channel = 'l'; draw(); },
        '[': () => moveLayer(-1), ']': () => moveLayer(1), ',': () => { const l = curLayer(); if (l) toggleLayer(l.id); }, "'": () => { S.grid = !S.grid; draw(); },
      };
      const fn = map[lk];
      if (S.mode === 'simple' && 'lmubijad[],\''.includes(lk)) { e.preventDefault(); return; }
      if (fn && (D() || ['o', 'k'].includes(lk))) { e.preventDefault(); fn(); renderStatus(); }
      return;
    }
    if (e.altKey && k.toLowerCase() === 'k') { S.clip = !S.clip; draw(); e.preventDefault(); return; }
    if (k === 'F1') { e.preventDefault(); helpDialog(); return; }
    if (S.mode === 'simple') { if (k === '\\') { S.showOriginal = !S.showOriginal; draw(); } if (k.toLowerCase() === 'y') { S.split = !S.split; draw(); } return; }
    if (k === 'Delete' || k === 'Backspace') { if (curLayer()) { deleteLayer(); e.preventDefault(); } return; }
    if (k === 'Enter' && S.tool === 'crop') { applyCrop(); return; }
    if (k === '\\') { S.showOriginal = !S.showOriginal; draw(); return; }
    if (k === '[' || k === ']') { const t = S.tool === 'heal' ? S.heal : S.brush; t.size = clamp(Math.round(t.size * (k === ']' ? 1.2 : 1 / 1.2)), 2, 800); renderOptions(); draw(); return; }
    const toolKeys = { v: 'move', h: 'hand', z: 'zoom', m: 'marquee', l: 'ellipse', c: 'crop', i: 'eyedropper', s: 'star', r: 'ruler', b: 'brush', e: 'eraser', j: 'heal', t: 'text' };
    const lk = k.toLowerCase();
    if (toolKeys[lk]) { setTool(toolKeys[lk]); return; }
    if (lk === 'x') swapColors();
    if (lk === 'd') { S.fg = '#ffffff'; S.bgc = '#000000'; renderToolbar(); renderOptions(); }
    if (lk === 'y') { S.split = !S.split; draw(); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') { S.spaceHeld = false; updateCursor(); } });
  window.addEventListener('resize', () => { clampCenter(); draw(); if (needRegion()) scheduleRegion(); });

  // ----------------------------------------------------------- drag & drop ---
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dragDepth++; document.body.classList.add('dragover'); } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragover'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragover');
    const files = [...((e.dataTransfer && e.dataTransfer.files) || [])]; if (!files.length) return;
    if ($('dlg').open && (batchDialog.files || stackDialog.files)) { const list = $('stList') ? stackDialog : batchDialog; for (const f of files) list.files.push({ file: f, status: L('wacht', 'waiting') }); list.render(); return; }
    if (files.length > 1 && files.every((f) => /\.(fits?|fts)$/i.test(f.name))) { stackDialog(files); return; }
    openFiles(files);
  });
  $('fileInput').onchange = (e) => { const f = [...e.target.files]; e.target.value = ''; openFiles(f); };

  // warn before closing the window/tab with unsaved edits (Electron shows its own dialog for this)
  window.addEventListener('beforeunload', (e) => { if (S.docs.some((d) => d.dirty)) { e.preventDefault(); e.returnValue = ''; } });

  // ---------------------------------------------------------------- init ---
  renderAll();
  window.AstroApp = { S, D, openDemo, openImage, addLayer, deleteLayer, selectLayer, setTool, setZoom, applyAction, undo, redo, renderFull, exportDialog, takeSnapshot, isWorker: proc.isWorker, setGeom, curLayer, requestPreview, toggleViewMask, setParam, setMask, setMode };
})();
