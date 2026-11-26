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

  // ---------------------------------------------------------------- FITS ---
  function readFITS(buffer) {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    const hdr = {};
    let pos = 0, done = false;
    while (!done && pos + 2880 <= bytes.length) {
      for (let c = 0; c < 36; c++) {
        let card = '';
        for (let k = 0; k < 80; k++) card += String.fromCharCode(bytes[pos + c * 80 + k]);
        const key = card.substring(0, 8).trim();
        if (key === 'END') { done = true; break; }
        if (card[8] === '=') {
          let v = card.substring(10);
          let val;
          const t = v.trim();
          if (t.startsWith("'")) {
            const end = t.indexOf("'", 1);
            val = t.substring(1, end < 0 ? t.length : end).trim();
          } else {
            const s = t.split('/')[0].trim();
            if (s === 'T') val = true; else if (s === 'F') val = false;
            else val = isNaN(parseFloat(s)) ? s : parseFloat(s);
          }
          hdr[key] = val;
        }
      }
      pos += 2880;
    }
    if (!done) throw new Error('FITS: header niet gevonden');
    const bitpix = hdr.BITPIX, naxis = hdr.NAXIS;
    const w = hdr.NAXIS1, h = hdr.NAXIS2, planes = naxis >= 3 ? (hdr.NAXIS3 || 1) : 1;
    if (!w || !h) throw new Error('FITS: geen afbeelding in bestand');
    const bzero = hdr.BZERO || 0, bscale = hdr.BSCALE === undefined ? 1 : hdr.BSCALE;
    const bpp = Math.abs(bitpix) / 8;
    const n = w * h;
    const read = (i) => {
      const o = pos + i * bpp;
      switch (bitpix) {
        case 8: return bytes[o];
        case 16: return dv.getInt16(o, false);
        case 32: return dv.getInt32(o, false);
        case -32: return dv.getFloat32(o, false);
        case -64: return dv.getFloat64(o, false);
        default: throw new Error('FITS: BITPIX ' + bitpix + ' niet ondersteund');
      }
    };
    const raw = [];
    let mn = Infinity, mx = -Infinity;
    for (let p = 0; p < Math.min(planes, 3); p++) {
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let v = read(p * n + i) * bscale + bzero;
        if (!isFinite(v)) v = 0;
        a[i] = v;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      raw.push(a);
    }
    // normalise to 0..1
    let lo = 0, hi;
    if (bitpix === 8) hi = 255;
    else if (bitpix === 16) hi = (bzero === 32768 || mn >= 0) ? 65535 : 32767;
    else if (bitpix === 32) hi = mx > 0 ? mx : 1;
    else hi = mx <= 1.0 ? 1.0 : (mx <= 65535 ? 65535 : mx);
    if (mn < 0) lo = mn;
    const sc = 1 / (hi - lo || 1);
    for (const a of raw) for (let i = 0; i < n; i++) a[i] = Math.min(1, Math.max(0, (a[i] - lo) * sc));

    const topDown = String(hdr.ROWORDER || '').toUpperCase() === 'TOP-DOWN';
    let img;
    if (raw.length >= 3) {
      img = { w, h, r: raw[0], g: raw[1], b: raw[2], mono: false, meta: {} };
    } else {
      const bayer = String(hdr.BAYERPAT || hdr.COLORTYP || '').toUpperCase().replace(/[^RGB]/g, '');
      if (bayer.length === 4) {
        let pat = bayer;
        // FITS is bottom-up: when we flip rows, the bayer phase shifts vertically if height is odd
        img = debayer(raw[0], w, h, pat, (hdr.XBAYROFF || 0) | 0, (hdr.YBAYROFF || 0) | 0);
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
    const dv = new DataView(buffer);
    const bo = String.fromCharCode(dv.getUint8(0), dv.getUint8(1));
    if (bo !== 'II' && bo !== 'MM') throw new Error('TIFF: ongeldig bestand');
    const le = bo === 'II';
    const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
    if (u16(2) !== 42) throw new Error('TIFF: BigTIFF wordt niet ondersteund');
    const ifd = u32(4);
    const cnt = u16(ifd);
    const tags = {};
    const tsize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
    for (let i = 0; i < cnt; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), n = u32(e + 4);
      const sz = (tsize[type] || 1) * n;
      const off = sz <= 4 ? e + 8 : u32(e + 8);
      const vals = [];
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
    const bps = g(258, 1), spp = g(277, 1), comp = g(259, 1), photo = g(262, 1);
    const planar = g(284, 1), predictor = g(317, 1), sfmt = g(339, 1);
    if (tags[322]) throw new Error('TIFF met tegels wordt niet ondersteund. Sla op als PNG of gewone TIFF.');
    const offsets = tags[273], counts = tags[279];
    const rps = g(278, h);
    if (!offsets) throw new Error('TIFF: geen beelddata');
    const bytesPS = bps / 8;
    const strips = [];
    for (let i = 0; i < offsets.length; i++) {
      let data = new Uint8Array(buffer, offsets[i], counts ? counts[i] : buffer.byteLength - offsets[i]);
      if (comp === 5) data = lzwDecode(data);
      else if (comp === 8 || comp === 32946) data = await inflate(data);
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
    let fmax = 0;
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
            const val = sfmt === 3 ? v : v / maxv;
            if (sfmt === 3 && val > fmax) fmax = val;
            chans[ch][y * w + x] = val;
          }
        }
      }
    }
    if (sfmt === 3 && fmax > 1) for (const ch of chans) for (let i = 0; i < ch.length; i++) ch[i] /= fmax;
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
    for (const ch of [r, g, b]) for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) { dv.setFloat32(o, ch[y * w + x], false); o += 4; }
    return buf;
  }

  const api = { readFITS, readTIFF, writeTIFF16, writeFITS, makeImage, debayer, flipV };
  root.AstroFormats = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
