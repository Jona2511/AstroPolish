// File-format tests: FITS and TIFF readers checked pixel-by-pixel against fixtures
// written by independent tools (numpy FITS writer, tifffile, Pillow): see test/fixtures/make_fixtures.py.
// Usage: node test/formats-test.js
const F = require('../app/js/formats.js');
const fs = require('fs');
const path = require('path');
const { check, summary } = require('./lib/check.js');

const DIR = path.join(__dirname, 'fixtures');
const W = 37, H = 23;
const pat = (c, x, y) => ((7 * x + 13 * y + 101 * c) % 997) / 996;
let PMAX = 0; for (let c = 0; c < 3; c++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) PMAX = Math.max(PMAX, pat(c, x, y));
const load = (f) => { const b = fs.readFileSync(path.join(DIR, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

// compare every pixel with expected(c, x, y); returns max abs error
function maxErr(img, expected, chans) {
  let m = 0;
  for (const [ci, k] of (chans || [[0, 'r'], [1, 'g'], [2, 'b']])) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const e = expected(ci, x, y);
      if (e === null) continue;
      const v = img[k][y * W + x];
      const d = Math.abs(v - e);
      if (!(d <= m)) m = Number.isFinite(d) ? d : Infinity;
    }
  }
  return m;
}
const allFinite01 = (img) => ['r', 'g', 'b'].every((k) => img[k].every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
// numpy rounds half to even; reproduce that so expected integer values match the fixtures exactly
const q = (v, n) => { const t = v * n, f = Math.floor(t), d = t - f; const r = d > 0.5 + 1e-9 ? f + 1 : d < 0.5 - 1e-9 ? f : (f % 2 === 0 ? f : f + 1); return r / n; };
const mono = (f) => (c, x, y) => f(pat(0, x, y));
const rgb = (f) => (c, x, y) => f(pat(c, x, y));

async function expectThrows(name, fn, re) {
  try { await fn(); check(name, false, 'no error thrown'); }
  catch (e) { check(name, re.test(e.message), 'message: ' + e.message); }
}

(async () => {
  // ------------------------------------------------------------ FITS ---
  const fits = (f) => F.readFITS(load(f));
  const cases = [
    ['fits_u8_mono.fits', mono((v) => q(v, 255)), 1e-6, true],
    ['fits_u16_mono_bzero.fits', mono((v) => q(v, 65535)), 1e-6, true],
    // signed 16-bit without BZERO: physical range is 0..32767 for non-negative data
    ['fits_i16_mono_signed.fits', mono((v) => q(v, 32767)), 1e-6, true],
    ['fits_f32_rgb.fits', rgb((v) => v), 1e-6, false],
    ['fits_f64_mono.fits', mono((v) => v), 1e-6, true],
    ['fits_f32_rgb_topdown.fits', rgb((v) => v), 1e-6, false],
    ['fits_f32_adu.fits', rgb((v) => (v * 60000) / 65535), 1e-5, false],
    // regression: float data slightly above 1.0 was divided by 65535 (image became black)
    ['fits_f32_over1.fits', rgb((v) => v / PMAX), 1e-5, false],
    // small negative values after bias subtraction: shifted, no clipping of the faint end
    ['fits_f32_negative.fits', mono((v) => v / 1.02), 1e-5, true],
    // primary HDU without data + IMAGE extension
    ['fits_f32_extension.fits', rgb((v) => v), 1e-6, false],
  ];
  for (const [f, exp, tol, isMono] of cases) {
    try {
      const img = fits(f);
      check(`${f}: size`, img.w === W && img.h === H, `${img.w}x${img.h}`);
      const e = maxErr(img, exp);
      check(`${f}: pixel values + orientation`, e <= tol, 'max error ' + e.toExponential(2));
      check(`${f}: mono flag`, img.mono === isMono);
      check(`${f}: finite and in 0..1`, allFinite01(img));
    } catch (err) { check(`${f}: read`, false, err.message); }
  }
  {
    const img = fits('fits_i32_mono.fits');
    let mx = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mx = Math.max(mx, Math.round(pat(0, x, y) * 1e6));
    check('fits_i32_mono.fits: values', maxErr(img, mono((v) => Math.round(v * 1e6) / mx)) <= 1e-6);
  }
  {
    const img = fits('fits_f32_rgb.fits');
    check('FITS header: OBJECT/EXPTIME parsed', img.meta.object === 'M 42' && img.meta.header.EXPTIME === 15);
    check('FITS marked linear', img.meta.linear === true);
  }
  {
    const img = fits('fits_f32_nan.fits');
    check('fits_f32_nan.fits: NaN/Inf replaced, all finite', allFinite01(img));
    const bad = (x, y) => (x === y && x <= 2);
    check('fits_f32_nan.fits: other pixels untouched', maxErr(img, (c, x, y) => (bad(x, y) ? null : pat(c, x, y))) <= 1e-6);
    check('fits_f32_nan.fits: NaN/Inf pixels become 0', [0, 1, 2].every((k) => img.r[k * W + k] === 0));
  }
  {
    const img = fits('fits_bayer_rggb.fits');
    let e = 0;
    for (let i = 0; i < W * H; i++) e = Math.max(e, Math.abs(img.r[i] - q(0.8, 65535)), Math.abs(img.g[i] - q(0.4, 65535)), Math.abs(img.b[i] - q(0.1, 65535)));
    check('fits_bayer_rggb.fits: debayered to uniform colour', e < 1e-4 && !img.mono, 'max error ' + e.toExponential(2));
  }
  await expectThrows('fits_truncated.fits: clear error', () => fits('fits_truncated.fits'), /onvolledig|beschadigd/i);
  await expectThrows('fits_garbage.fits: clear error', () => fits('fits_garbage.fits'), /FITS/);
  await expectThrows('empty FITS buffer: clear error', () => F.readFITS(new ArrayBuffer(0)), /FITS/);

  // round trip: AstroPolish FITS writer -> reader
  {
    const r = new Float32Array(W * H), g = new Float32Array(W * H), b = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; r[i] = pat(0, x, y); g[i] = pat(1, x, y); b[i] = pat(2, x, y); }
    const img = F.readFITS(F.writeFITS(r, g, b, W, H, { OBJECT: "NGC 7000 'North America'", EXPTIME: 30 }));
    check('FITS writer round trip: exact float values + orientation', maxErr(img, rgb((v) => v)) <= 1e-7);
    check('FITS writer round trip: header strings with quotes', img.meta.object === "NGC 7000 'North America'", img.meta.object);
    const nanR = new Float32Array(r); nanR[5] = NaN;
    const img2 = F.readFITS(F.writeFITS(nanR, g, b, W, H, {}));
    check('FITS writer never writes NaN', allFinite01(img2));
  }

  // ------------------------------------------------------------ TIFF ---
  const tif = (f) => F.readTIFF(load(f));
  const tcases = [
    ['tif_u8_rgb.tif', rgb((v) => q(v, 255)), 1e-6, false],
    ['tif_u8_rgb_lzw.tif', rgb((v) => q(v, 255)), 1e-6, false],
    ['tif_u8_rgb_packbits.tif', rgb((v) => q(v, 255)), 1e-6, false],
    ['tif_u16_mono_lzw.tif', mono((v) => q(v, 65535)), 1e-6, true],
    ['tif_u16_mono_deflate_pred.tif', mono((v) => q(v, 65535)), 1e-6, true],
    ['tif_u16_rgb_bigendian.tif', rgb((v) => q(v, 65535)), 1e-6, false],
    ['tif_u16_rgb_planar.tif', rgb((v) => q(v, 65535)), 1e-6, false],
    ['tif_u16_rgb_strips.tif', rgb((v) => q(v, 65535)), 1e-6, false],
    ['tif_u16_rgba.tif', rgb((v) => q(v, 65535)), 1e-6, false],
    ['tif_f32_rgb.tif', rgb((v) => v), 1e-6, false],
  ];
  for (const [f, exp, tol, isMono] of tcases) {
    try {
      const img = await tif(f);
      check(`${f}: size`, img.w === W && img.h === H, `${img.w}x${img.h}`);
      const e = maxErr(img, exp);
      check(`${f}: pixel values + orientation`, e <= tol, 'max error ' + e.toExponential(2));
      check(`${f}: mono flag`, img.mono === isMono);
    } catch (err) { check(`${f}: read`, false, err.message); }
  }
  {
    const img = await tif('tif_f32_nan.tif');
    check('tif_f32_nan.tif: NaN/Inf/negative sanitised (finite, 0..1)', allFinite01(img));
    // remaining pixels keep their order (monotone mapping of the original values)
    let ok = true, prevV = -1;
    const pts = [];
    for (let y = 3; y < H; y++) for (let x = 3; x < W; x++) pts.push([pat(0, x, y), img.r[y * W + x]]);
    pts.sort((a, b) => a[0] - b[0]);
    for (const [, v] of pts) { if (v < prevV - 1e-7) ok = false; prevV = v; }
    check('tif_f32_nan.tif: valid pixels keep their order', ok);
  }
  await expectThrows('tif_u16_tiled.tif: clear error for tiled TIFF', () => tif('tif_u16_tiled.tif'), /tegels|tiled/i);
  await expectThrows('tif_truncated.tif: clear error', () => tif('tif_truncated.tif'), /onvolledig|beschadigd/i);
  await expectThrows('empty TIFF buffer: clear error', () => F.readTIFF(new ArrayBuffer(0)), /TIFF/);

  // round trip: AstroPolish TIFF16 writer -> reader (incl. values outside 0..1 must not wrap around)
  {
    const n = W * H, rgb16 = new Uint16Array(n * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) rgb16[(y * W + x) * 3 + c] = Math.round(pat(c, x, y) * 65535);
    const img = await F.readTIFF(F.writeTIFF16(rgb16, W, H));
    check('TIFF16 writer round trip', maxErr(img, rgb((v) => Math.round(v * 65535) / 65535)) <= 1e-6);
  }
  summary('FORMATS');
})();
