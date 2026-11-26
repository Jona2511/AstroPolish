/*
 * AstroPolish - file format readers/writers (FITS, TIFF) without dependencies.
 * Images are represented as { w, h, r, g, b, mono, meta } with Float32Array
 * channels normalised to 0..1.
 */
(function (root) {
  'use strict';

  function makeImage(w, h) {
    const n = w * h;
    return { w, h, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), mono: false, meta: {} };
  }

  // Shared limits and helpers ------------------------------------------------
  // Largest image we try to open: 3 float channels of 250 Mpx is already 3 GB.
  const MAX_PIXELS = 250e6;
  function checkSize(kind, w, h) {
    if (!(w > 0 && h > 0) || !Number.isInteger(w) || !Number.isInteger(h)) throw new Error(`${kind}: ongeldige afmetingen (${w} x ${h})`);
    if (w * h > MAX_PIXELS) throw new Error(`${kind}: afbeelding is te groot (${w} x ${h} = ${Math.round(w * h / 1e6)} Mpx, maximaal ${MAX_PIXELS / 1e6} Mpx)`);
  }
  const damaged = (kind, detail) => new Error(`${kind}-bestand is onvolledig of beschadigd${detail ? ' (' + detail + ')' : ''}`);

  // Normalise floating point data to 0..1 without clipping the faint end:
  // - NaN / ±Inf are "no data" and become 0 (they are excluded from the statistics);
  // - negative values (bias-subtracted data) are kept by shifting the black point,
  //   using a robust low percentile so a single extreme outlier cannot squash the range;
  // - the white point is 1.0 for 0..1 data, the maximum for data slightly above 1
  //   (calibration overshoot), 65535 for ADU-scaled data, otherwise the maximum.
  function normaliseFloat(chans) {
    let mn = Infinity, mx = -Infinity;
    for (const a of chans) for (let i = 0; i < a.length; i++) { const v = a[i]; if (v === v && v !== Infinity && v !== -Infinity) { if (v < mn) mn = v; if (v > mx) mx = v; } }
    if (mn === Infinity) { for (const a of chans) a.fill(0); return { lo: 0, hi: 1 }; }
    let lo = 0;
    if (mn < 0) {
      // 0.01 % percentile of the (sub-sampled) finite values
      const n = chans[0].length, step = Math.max(1, Math.floor(n / 200000)), smp = [];
      for (const a of chans) for (let i = 0; i < n; i += step) { const v = a[i]; if (Number.isFinite(v)) smp.push(v); }
      smp.sort((a, b) => a - b);
      lo = Math.min(0, smp[Math.floor(smp.length * 1e-4)]);
    }
    let hi;
    if (mx <= 1) hi = 1;
    else if (mx <= 2) hi = mx;
    else if (mx <= 65535 * 1.0001) hi = 65535;
    else hi = mx;
    const sc = 1 / Math.max(1e-30, hi - lo);
    for (const a of chans) for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (!Number.isFinite(x)) { a[i] = 0; continue; } // no data
      const v = (x - lo) * sc;
      a[i] = v > 0 ? (v < 1 ? v : 1) : 0;
    }
    return { lo, hi };
  }

  // ---------------------------------------------------------------- FITS ---
  function parseFITSHeader(bytes, pos) {
    const hdr = {};
    let done = false;
    while (!done && pos + 2880 <= bytes.length) {
      for (let c = 0; c < 36; c++) {
        let card = '';
        for (let k = 0; k < 80; k++) card += String.fromCharCode(bytes[pos + c * 80 + k]);
        const key = card.substring(0, 8).trim();
        if (key === 'END') { done = true; break; }
        if (card[8] === '=' && card[9] === ' ' || card[8] === '=') {
          const t = card.substring(10).trim();
          let val;
          if (t.startsWith("'")) {
            // string value: '' is an escaped quote
            let s = '', i = 1;
            for (; i < t.length; i++) {
              if (t[i] === "'") { if (t[i + 1] === "'") { s += "'"; i++; } else break; } else s += t[i];
            }
            val = s.replace(/\s+$/, '');
          } else {
            const v = t.split('/')[0].trim();
            if (v === 'T') val = true; else if (v === 'F') val = false;
            else { const f = Number(v.replace(/D/i, 'E')); val = v !== '' && Number.isFinite(f) ? f : v; }
          }
          if (!(key in hdr)) hdr[key] = val;
        }
      }
      pos += 2880;
    }
    if (!done) return null;
    return { hdr, dataStart: pos };
  }

  function readFITS(buffer) {
    if (!buffer || buffer.byteLength < 2880) throw new Error('FITS: geen geldig FITS-bestand (te klein)');
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    const magic = String.fromCharCode(...bytes.subarray(0, 6));
    if (magic !== 'SIMPLE') throw new Error('FITS: geen geldig FITS-bestand (SIMPLE ontbreekt)');
    // walk the HDUs: use the primary image, or the first IMAGE extension when the primary has no data
    let pos = 0, hdr = null, dataStart = 0;
    for (let hdu = 0; hdu < 16 && pos < bytes.length; hdu++) {
      const parsed = parseFITSHeader(bytes, pos);
      if (!parsed) { if (hdu === 0) throw new Error('FITS: header niet gevonden of beschadigd (END ontbreekt)'); break; }
      const h = parsed.hdr;
      const naxis = h.NAXIS | 0;
      let n = naxis > 0 ? 1 : 0;
      for (let i = 1; i <= naxis; i++) n *= (h['NAXIS' + i] | 0);
      const dataBytes = (Math.abs(h.BITPIX | 0) / 8) * (h.GCOUNT || 1) * ((h.PCOUNT | 0) + n);
      if (hdu > 0 && h.XTENSION === 'BINTABLE' && h.ZIMAGE === true) throw new Error('FITS: gecomprimeerde FITS (fpack/tile compression) wordt niet ondersteund. Pak het bestand eerst uit (funpack).');
      if (naxis >= 2 && (hdu === 0 || h.XTENSION === 'IMAGE')) { hdr = h; dataStart = parsed.dataStart; break; }
      pos = parsed.dataStart + Math.ceil(dataBytes / 2880) * 2880;
    }
    if (!hdr) throw new Error('FITS: geen afbeelding in bestand');
    pos = dataStart;
    const bitpix = hdr.BITPIX;
    const w = hdr.NAXIS1, h = hdr.NAXIS2, planes = hdr.NAXIS >= 3 ? (hdr.NAXIS3 || 1) : 1;
    checkSize('FITS', w, h);
    if (![8, 16, 32, -32, -64].includes(bitpix)) throw new Error('FITS: BITPIX ' + bitpix + ' wordt niet ondersteund');
    const bzero = Number(hdr.BZERO) || 0, bscale = hdr.BSCALE === undefined ? 1 : Number(hdr.BSCALE);
    const bpp = Math.abs(bitpix) / 8;
    const n = w * h, use = Math.min(planes, 3);
    const need = pos + n * use * bpp;
    if (need > bytes.length) throw damaged('FITS', `${bytes.length} van de ${need} bytes aanwezig`);
    const read = {
      8: (o) => bytes[o], 16: (o) => dv.getInt16(o, false), 32: (o) => dv.getInt32(o, false),
      [-32]: (o) => dv.getFloat32(o, false), [-64]: (o) => dv.getFloat64(o, false),
    }[bitpix];
    const raw = [];
    let mn = Infinity;
    const blank = bitpix > 0 && hdr.BLANK !== undefined ? hdr.BLANK : null;
    for (let p = 0; p < use; p++) {
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const s = read(pos + (p * n + i) * bpp);
        const v = blank !== null && s === blank ? NaN : s * bscale + bzero;
        a[i] = v;
        if (v < mn) mn = v;
      }
      raw.push(a);
    }
    if (bitpix < 0) normaliseFloat(raw);
    else {
      // integer data: map the physical range of the data type to 0..1
      let lo = 0, hi;
      if (bitpix === 8) hi = 255 * bscale + bzero;
      else if (bitpix === 16) hi = bzero === 32768 ? 65535 : 32767;
      else { hi = -Infinity; for (const a of raw) for (let i = 0; i < n; i++) if (a[i] > hi) hi = a[i]; if (!(hi > 0)) hi = 1; }
      if (mn < 0) lo = mn;
      const sc = 1 / (hi - lo || 1);
      for (const a of raw) for (let i = 0; i < n; i++) { const v = (a[i] - lo) * sc; a[i] = v > 0 ? (v < 1 ? v : 1) : 0; }
    }

    const topDown = String(hdr.ROWORDER || '').toUpperCase() === 'TOP-DOWN';
    let img;
    if (raw.length >= 3) {
      img = { w, h, r: raw[0], g: raw[1], b: raw[2], mono: false, meta: {} };
    } else {
      const bayer = String(hdr.BAYERPAT || hdr.COLORTYP || '').toUpperCase().replace(/[^RGB]/g, '');
      if (bayer.length === 4) {
        // the pattern refers to the pixel order as stored in the file, so debayer before flipping
        img = debayer(raw[0], w, h, bayer, (hdr.XBAYROFF || 0) | 0, (hdr.YBAYROFF || 0) | 0);
      } else {
        img = { w, h, r: raw[0], g: new Float32Array(raw[0]), b: new Float32Array(raw[0]), mono: true, meta: {} };
      }
    }
    if (!topDown) flipV(img);
    img.meta = { format: 'FITS', linear: true, object: hdr.OBJECT ? String(hdr.OBJECT) : '', header: hdr };
    return img;
  }

  function flipV(img) {
    const { w, h } = img;
    for (const ch of [img.r, img.g, img.b]) {
      const tmp = new Float32Array(w);
      for (let y = 0; y < (h >> 1); y++) {
        const a = y * w, b = (h - 1 - y) * w;
        tmp.set(ch.subarray(a, a + w));
        ch.copyWithin(a, b, b + w);
        ch.set(tmp, b);
      }
    }
  }

  // Bilinear demosaic, generic for RGGB/BGGR/GRBG/GBRG.
  function debayer(src, w, h, pat, xo, yo) {
    const img = makeImage(w, h);
    const colAt = (x, y) => pat[(((y + yo) & 1) << 1) | ((x + xo) & 1)];
    const outs = { R: img.r, G: img.g, B: img.b };
    const K = [1, 2, 1, 2, 4, 2, 1, 2, 1];
    for (const c of ['R', 'G', 'B']) {
      const out = outs[c];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (colAt(x, y) === c) { out[y * w + x] = src[y * w + x]; continue; }
          let s = 0, ws = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy; if (yy < 0 || yy >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx; if (xx < 0 || xx >= w) continue;
              if (colAt(xx, yy) === c) { const k = K[(dy + 1) * 3 + dx + 1]; s += src[yy * w + xx] * k; ws += k; }
            }
          }
          out[y * w + x] = ws ? s / ws : 0;
        }
      }
    }
    return img;
  }

  // ---------------------------------------------------------------- TIFF ---
  async function readTIFF(buffer) {
    if (!buffer || buffer.byteLength < 16) throw new Error('TIFF: geen geldig TIFF-bestand (te klein)');
    const dv = new DataView(buffer);
    const bo = String.fromCharCode(dv.getUint8(0), dv.getUint8(1));
    if (bo !== 'II' && bo !== 'MM') throw new Error('TIFF: ongeldig bestand');
    const le = bo === 'II';
    const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
    if (u16(2) !== 42) throw new Error('TIFF: BigTIFF wordt niet ondersteund');
    const ifd = u32(4);
    if (ifd + 2 > buffer.byteLength) throw damaged('TIFF', 'IFD buiten het bestand');
    const cnt = u16(ifd);
    if (ifd + 2 + cnt * 12 > buffer.byteLength) throw damaged('TIFF', 'IFD buiten het bestand');
    const tags = {};
    const tsize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
    for (let i = 0; i < cnt; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), n = u32(e + 4);
      const sz = (tsize[type] || 1) * n;
      const off = sz <= 4 ? e + 8 : u32(e + 8);
      const vals = [];
      if (off + sz > buffer.byteLength) { if ([256, 257, 258, 273, 277, 279].includes(tag)) throw damaged('TIFF', 'tag ' + tag); continue; }
      for (let k = 0; k < Math.min(n, 100000); k++) {
        if (type === 3) vals.push(u16(off + k * 2));
        else if (type === 4) vals.push(u32(off + k * 4));
        else if (type === 1 || type === 7) vals.push(dv.getUint8(off + k));
        else if (type === 2) vals.push(dv.getUint8(off + k));
        else vals.push(u32(off + k * 4));
      }
      tags[tag] = vals;
    }
    const g = (t, d) => (tags[t] ? tags[t][0] : d);
    const w = g(256), h = g(257);
    checkSize('TIFF', w, h);
    const bps = g(258, 1), spp = g(277, 1), comp = g(259, 1), photo = g(262, 1);
    const planar = g(284, 1), predictor = g(317, 1), sfmt = g(339, 1);
    if (tags[322]) throw new Error('TIFF met tegels (tiled) wordt niet ondersteund. Sla op als gewone TIFF (strips) of PNG.');
    if (photo === 3) throw new Error('TIFF met kleurenpalet wordt niet ondersteund. Sla op als RGB of grijswaarden.');
    if (sfmt === 2) throw new Error('TIFF met signed integers wordt niet ondersteund. Sla op als unsigned 16-bit of 32-bit float.');
    if (predictor === 3) throw new Error('TIFF met floating-point predictor wordt niet ondersteund. Sla op zonder predictor.');
    if (![8, 16, 32].includes(bps)) throw new Error('TIFF: ' + bps + ' bits per kanaal wordt niet ondersteund');
    const offsets = tags[273], counts = tags[279];
    const rps = g(278, h);
    if (!offsets) throw new Error('TIFF: geen beelddata');
    const bytesPS = bps / 8;
    const strips = [];
    for (let i = 0; i < offsets.length; i++) {
      const len = counts ? counts[i] : buffer.byteLength - offsets[i];
      if (offsets[i] + len > buffer.byteLength) throw damaged('TIFF', `strip ${i + 1} van ${offsets.length} ontbreekt`);
      let data = new Uint8Array(buffer, offsets[i], len);
      if (comp === 5) data = lzwDecode(data);
      else if (comp === 8 || comp === 32946) { try { data = await inflate(data); } catch (e) { throw damaged('TIFF', 'compressie: ' + e.message); } }
      else if (comp === 32773) data = packbits(data);
      else if (comp !== 1) throw new Error('TIFF-compressie ' + comp + ' wordt niet ondersteund');
      strips.push(data);
    }
    const samplesPerRowChunky = w * (planar === 1 ? spp : 1);
    const stripsPerPlane = Math.ceil(h / rps);
    const img = makeImage(w, h);
    const chans = [img.r, img.g, img.b];
    const maxv = sfmt === 3 ? 1 : Math.pow(2, bps) - 1;
    const readS = (dvS, o) => {
      if (bps === 8) return dvS.getUint8(o);
      if (bps === 16) return dvS.getUint16(o, le);
      if (bps === 32) return sfmt === 3 ? dvS.getFloat32(o, le) : dvS.getUint32(o, le);
      throw new Error('TIFF: ' + bps + ' bits per kanaal wordt niet ondersteund');
    };
    for (let s = 0; s < strips.length; s++) {
      const plane = planar === 2 ? Math.floor(s / stripsPerPlane) : 0;
      const y0 = (s % stripsPerPlane) * rps;
      const data = strips[s];
      const dvS = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const rows = Math.min(rps, h - y0);
      for (let ry = 0; ry < rows; ry++) {
        const y = y0 + ry;
        const rowOff = ry * samplesPerRowChunky * bytesPS;
        const prev = new Array(spp).fill(0);
        for (let x = 0; x < w; x++) {
          for (let c = 0; c < (planar === 1 ? spp : 1); c++) {
            const si = x * (planar === 1 ? spp : 1) + c;
            const o = rowOff + si * bytesPS;
            if (o + bytesPS > data.byteLength) continue;
            let v = readS(dvS, o);
            if (predictor === 2 && sfmt !== 3) {
              v = (v + prev[c]) & maxv; prev[c] = v;
            }
            const ch = planar === 1 ? c : plane;
            if (ch > 2) continue;
            chans[ch][y * w + x] = sfmt === 3 ? v : v / maxv;
          }
        }
      }
    }
    if (sfmt === 3) normaliseFloat(spp < 3 || photo < 2 ? [img.r] : chans);
    if (spp < 3 || photo < 2) {
      if (photo === 0) for (let i = 0; i < img.r.length; i++) img.r[i] = 1 - img.r[i];
      img.g.set(img.r); img.b.set(img.r); img.mono = true;
    }
    img.meta = { format: 'TIFF', linear: bps > 8, object: '' };
    return img;
  }

  function packbits(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const n = (src[i] << 24) >> 24; i++;
      if (n >= 0) { for (let k = 0; k <= n; k++) out.push(src[i++]); }
      else if (n !== -128) { const v = src[i++]; for (let k = 0; k <= -n; k++) out.push(v); }
    }
    return new Uint8Array(out);
  }

  function lzwDecode(src) {
    let out = new Uint8Array(src.length * 4 + 1024), op = 0;
    const push = (seq) => {
      if (op + seq.length > out.length) { const n = new Uint8Array(out.length * 2 + seq.length); n.set(out); out = n; }
      out.set(seq, op); op += seq.length;
    };
    let dict = [], codeLen = 9, bitPos = 0, prev = null;
    const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict.push(Uint8Array.of(i)); dict.push(null, null); codeLen = 9; };
    reset();
    const total = src.length * 8;
    while (bitPos + codeLen <= total) {
      let code = 0;
      for (let k = 0; k < codeLen; k++) {
        const bp = bitPos + k;
        code = (code << 1) | ((src[bp >> 3] >> (7 - (bp & 7))) & 1);
      }
      bitPos += codeLen;
      if (code === 257) break;
      if (code === 256) { reset(); prev = null; continue; }
      let entry;
      if (code < dict.length && dict[code]) entry = dict[code];
      else if (prev) { entry = new Uint8Array(prev.length + 1); entry.set(prev); entry[prev.length] = prev[0]; }
      else break;
      push(entry);
      if (prev) { const ne = new Uint8Array(prev.length + 1); ne.set(prev); ne[prev.length] = entry[0]; dict.push(ne); }
      prev = entry;
      if (dict.length + 1 >= (1 << codeLen) && codeLen < 12) codeLen++;
    }
    return out.subarray(0, op);
  }

  async function inflate(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Deze TIFF-compressie wordt hier niet ondersteund');
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // 16-bit RGB TIFF writer (uncompressed)
  function writeTIFF16(rgb16, w, h) {
    const nEntries = 11;
    const ifdSize = 2 + nEntries * 12 + 4;
    const hdr = 8, bpsOff = hdr + ifdSize, dataOff = bpsOff + 8;
    const dataLen = w * h * 6;
    const buf = new ArrayBuffer(dataOff + dataLen);
    const dv = new DataView(buf);
    dv.setUint8(0, 0x49); dv.setUint8(1, 0x49); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
    let p = 8;
    dv.setUint16(p, nEntries, true); p += 2;
    const ent = (tag, type, n, val) => {
      dv.setUint16(p, tag, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, n, true);
      if (type === 3 && n === 1) dv.setUint16(p + 8, val, true); else dv.setUint32(p + 8, val, true);
      p += 12;
    };
    ent(256, 4, 1, w); ent(257, 4, 1, h); ent(258, 3, 3, bpsOff); ent(259, 3, 1, 1); ent(262, 3, 1, 2);
    ent(273, 4, 1, dataOff); ent(277, 3, 1, 3); ent(278, 4, 1, h); ent(279, 4, 1, dataLen); ent(284, 3, 1, 1);
    ent(339, 3, 1, 1);
    dv.setUint32(p, 0, true);
    dv.setUint16(bpsOff, 16, true); dv.setUint16(bpsOff + 2, 16, true); dv.setUint16(bpsOff + 4, 16, true);
    const out = new Uint16Array(buf, dataOff, w * h * 3);
    out.set(rgb16); // little-endian platform assumed (all x86/ARM)
    return buf;
  }

  // 32-bit float RGB FITS writer (values 0..1), rows bottom-up as the standard says
  function writeFITS(r, g, b, w, h, extra) {
    const cards = [];
    const card = (k, v, c) => {
      let s;
      if (typeof v === 'string') s = `${k.padEnd(8)}= '${v.replace(/'/g, "''").slice(0, 60)}'`;
      else if (typeof v === 'boolean') s = `${k.padEnd(8)}= ${(v ? 'T' : 'F').padStart(20)}`;
      else s = `${k.padEnd(8)}= ${String(v).padStart(20)}`;
      if (c) s += ' / ' + c;
      cards.push(s.slice(0, 80).padEnd(80));
    };
    card('SIMPLE', true); card('BITPIX', -32); card('NAXIS', 3); card('NAXIS1', w); card('NAXIS2', h); card('NAXIS3', 3);
    card('BZERO', 0); card('BSCALE', 1); card('ROWORDER', 'BOTTOM-UP');
    for (const k in (extra || {})) if (/^[A-Z0-9_-]{1,8}$/.test(k) && extra[k] !== undefined && extra[k] !== '') card(k, extra[k]);
    cards.push('END'.padEnd(80));
    let head = cards.join('');
    head += ' '.repeat((2880 - head.length % 2880) % 2880);
    const dataLen = w * h * 3 * 4;
    const total = head.length + dataLen + ((2880 - dataLen % 2880) % 2880);
    const buf = new ArrayBuffer(total);
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < head.length; i++) u8[i] = head.charCodeAt(i) & 0x7f;
    const dv = new DataView(buf, head.length);
    let o = 0;
    for (const ch of [r, g, b]) for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) { const v = ch[y * w + x]; dv.setFloat32(o, v > 0 ? (v < 1 ? v : 1) : 0, false); o += 4; }
    return buf;
  }

  const api = { readFITS, readTIFF, writeTIFF16, writeFITS, makeImage, debayer, flipV, normaliseFloat, MAX_PIXELS };
  root.AstroFormats = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
