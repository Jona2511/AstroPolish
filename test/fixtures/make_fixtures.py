"""Generates the small FITS/TIFF fixtures used by test/formats-test.js.

Independent of the JavaScript code: FITS files are written with numpy following
the FITS 4.0 standard, TIFF files with the `tifffile` library.
All images use the same analytic pattern so the test can compute the expected
value of every pixel:   v(c, y, x) = ((7*x + 13*y + 101*c) % 997) / 996
(y = 0 is the TOP row as displayed). Odd sizes catch stride/row-order bugs.

Usage: python3 test/fixtures/make_fixtures.py   (needs numpy + tifffile)
"""
import os, numpy as np, tifffile
from PIL import Image

W, H = 37, 23
HERE = os.path.dirname(os.path.abspath(__file__))
y, x = np.mgrid[0:H, 0:W]
def pattern(c):
    return ((7 * x + 13 * y + 101 * c) % 997) / 996.0
RGB = np.stack([pattern(c) for c in range(3)])  # (3, H, W), top row first
MONO = pattern(0)

def fits(name, data, bitpix, extra=None, topdown=False, primary_empty=False, truncate=None):
    """data: (planes, H, W) or (H, W) in display order (top row first)."""
    data = np.asarray(data)
    if not topdown:
        data = data[..., ::-1, :]  # FITS standard: first stored row is the bottom row
    def header(cards):
        s = ''.join(c.ljust(80)[:80] for c in cards + ['END'])
        return (s + ' ' * ((2880 - len(s) % 2880) % 2880)).encode('ascii')
    def card(k, v):
        if isinstance(v, bool): v = 'T' if v else 'F'
        if isinstance(v, str) and v not in ('T', 'F'): return f"{k:<8}= '{v}'"
        return f"{k:<8}= {str(v):>20}"
    dims = data.shape[::-1]
    cards = [card('SIMPLE', True) if not primary_empty else card('SIMPLE', True), card('BITPIX', bitpix)]
    dtype = {8: '>u1', 16: '>i2', 32: '>i4', -32: '>f4', -64: '>f8'}[bitpix]
    if primary_empty:
        out = header([card('SIMPLE', True), card('BITPIX', 8), card('NAXIS', 0), card('EXTEND', True)])
        cards = [card('XTENSION', 'IMAGE'), card('BITPIX', bitpix)]
    else:
        out = b''
    cards.append(card('NAXIS', len(dims)))
    for i, d in enumerate(dims): cards.append(card(f'NAXIS{i + 1}', d))
    if primary_empty: cards += [card('PCOUNT', 0), card('GCOUNT', 1)]
    if topdown: cards.append(card('ROWORDER', 'TOP-DOWN'))
    for k, v in (extra or {}).items(): cards.append(card(k, v))
    raw = data.astype(dtype).tobytes()
    out += header(cards) + raw + b'\0' * ((2880 - len(raw) % 2880) % 2880)
    if truncate: out = out[:truncate]
    open(os.path.join(HERE, name), 'wb').write(out)

# ---- FITS
fits('fits_u8_mono.fits', np.round(MONO * 255), 8)
fits('fits_u16_mono_bzero.fits', np.round(MONO * 65535) - 32768, 16, {'BZERO': 32768, 'BSCALE': 1})
fits('fits_i16_mono_signed.fits', np.round(MONO * 32767), 16)
fits('fits_i32_mono.fits', np.round(MONO * 1_000_000), 32)
fits('fits_f32_rgb.fits', RGB, -32, {'OBJECT': 'M 42', 'EXPTIME': 15.0})
fits('fits_f64_mono.fits', MONO, -64)
fits('fits_f32_rgb_topdown.fits', RGB, -32, topdown=True)
fits('fits_f32_adu.fits', RGB * 60000.0, -32)
over = RGB / RGB.max() * 1.15  # calibrated float data slightly above 1.0 (regression: was divided by 65535)
fits('fits_f32_over1.fits', over, -32)
neg = MONO - 0.02  # small negative values after bias subtraction
fits('fits_f32_negative.fits', neg, -32)
nan = RGB.copy(); nan[:, 0, 0] = np.nan; nan[:, 1, 1] = np.inf; nan[:, 2, 2] = -np.inf
fits('fits_f32_nan.fits', nan, -32)
fits('fits_f32_extension.fits', RGB, -32, primary_empty=True)
# Bayer RGGB: R sites = 0.8, G sites = 0.4, B sites = 0.1 (uniform colour after debayering)
bay = np.zeros((H, W))
bay[0::2, 0::2] = 0.8; bay[0::2, 1::2] = 0.4; bay[1::2, 0::2] = 0.4; bay[1::2, 1::2] = 0.1
fits('fits_bayer_rggb.fits', np.round(bay * 65535) - 32768, 16, {'BZERO': 32768, 'BAYERPAT': 'RGGB'}, topdown=True)
fits('fits_truncated.fits', RGB, -32, truncate=2880 + 1000)
open(os.path.join(HERE, 'fits_garbage.fits'), 'wb').write(b'This is not a FITS file' * 200)

# ---- TIFF (tifffile)
def tif(name, arr, **kw):
    tifffile.imwrite(os.path.join(HERE, name), arr, **kw)
rgb_hwc = np.moveaxis(RGB, 0, -1)
tif('tif_u8_rgb.tif', np.round(rgb_hwc * 255).astype(np.uint8), photometric='rgb')
# LZW via Pillow (tifffile needs imagecodecs for LZW): 8-bit RGB and 16-bit mono
Image.fromarray(np.round(rgb_hwc * 255).astype(np.uint8), 'RGB').save(os.path.join(HERE, 'tif_u8_rgb_lzw.tif'), compression='tiff_lzw')
Image.fromarray(np.round(MONO * 65535).astype(np.uint16)).save(os.path.join(HERE, 'tif_u16_mono_lzw.tif'), compression='tiff_lzw')
tif('tif_u16_mono_deflate_pred.tif', np.round(MONO * 65535).astype(np.uint16), photometric='minisblack', compression='zlib', predictor=True)
tif('tif_u16_rgb_bigendian.tif', np.round(rgb_hwc * 65535).astype('>u2'), photometric='rgb', byteorder='>')
tif('tif_u16_rgb_planar.tif', np.round(RGB * 65535).astype(np.uint16), photometric='rgb', planarconfig='separate')
Image.fromarray(np.round(rgb_hwc * 255).astype(np.uint8), 'RGB').save(os.path.join(HERE, 'tif_u8_rgb_packbits.tif'), compression='packbits')
tif('tif_u16_rgb_strips.tif', np.round(rgb_hwc * 65535).astype(np.uint16), photometric='rgb', rowsperstrip=4)
rgba = np.concatenate([rgb_hwc, np.ones((H, W, 1))], axis=2)
tif('tif_u16_rgba.tif', np.round(rgba * 65535).astype(np.uint16), photometric='rgb', extrasamples=['unassalpha'])
tif('tif_f32_rgb.tif', rgb_hwc.astype(np.float32), photometric='rgb')
fn = rgb_hwc.astype(np.float32).copy(); fn[0, 0, :] = np.nan; fn[1, 1, :] = np.inf; fn[2, 2, :] = -1.0
tif('tif_f32_nan.tif', fn, photometric='rgb')
tif('tif_u16_tiled.tif', np.round(rgb_hwc * 65535).astype(np.uint16), photometric='rgb', tile=(16, 16))
b = open(os.path.join(HERE, 'tif_u16_rgb_strips.tif'), 'rb').read()
open(os.path.join(HERE, 'tif_truncated.tif'), 'wb').write(b[:len(b) // 3])
print('fixtures written to', HERE)
