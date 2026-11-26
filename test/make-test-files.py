# Creates synthetic test images (FITS RGB, FITS Bayer, TIFF variants, moon JPG).
# Usage: python3 test/make-test-files.py /tmp/apf   (needs numpy, pillow, tifffile)
import sys, os, numpy as np, tifffile
from PIL import Image
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/apf'
os.makedirs(out, exist_ok=True); os.chdir(out)
rng = np.random.default_rng(1)
H, W = 600, 800
y, x = np.mgrid[0:H, 0:W]
img = np.zeros((3, H, W)) + 0.02
r = np.hypot(x - 400, y - 300)
img[0] += 0.05 * np.exp(-(r / 150) ** 2); img[2] += 0.02 * np.exp(-(r / 80) ** 2)
for _ in range(300):
    sx, sy, b = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(0.01, 0.5) ** 2
    img += b * np.exp(-((x - sx) ** 2 + (y - sy) ** 2) / 2.0)
img = np.clip(img + rng.normal(0, 0.003, img.shape), 0, 1)
img[:, 0:40, 0:40] = 0.9  # orientation marker: top-left
def fits(path, data, extra):
    hdr = []
    def card(k, v):
        s = f"{k:<8}= '{v}'" if isinstance(v, str) else f"{k:<8}= {('T' if v else 'F') if isinstance(v, bool) else v:>20}"
        hdr.append(s.ljust(80))
    card('SIMPLE', True); card('BITPIX', 16); card('NAXIS', data.ndim)
    for i, n in enumerate(reversed(data.shape)): card(f'NAXIS{i+1}', n)
    card('BZERO', 32768); card('BSCALE', 1)
    for k, v in extra.items(): card(k, v)
    hdr.append('END'.ljust(80))
    h = ''.join(hdr); h += ' ' * ((2880 - len(h) % 2880) % 2880)
    d = ((data * 65535).round().astype(np.int64) - 32768)[..., ::-1, :]
    raw = d.astype('>i2').tobytes(); raw += b'\0' * ((2880 - len(raw) % 2880) % 2880)
    open(path, 'wb').write(h.encode() + raw)
fits('rgb16.fits', img, {'OBJECT': 'M 31'})
bay = np.zeros((H, W)); bay[0::2, 0::2] = img[0, 0::2, 0::2]; bay[0::2, 1::2] = img[1, 0::2, 1::2]; bay[1::2, 0::2] = img[1, 1::2, 0::2]; bay[1::2, 1::2] = img[2, 1::2, 1::2]
fits('bayer.fits', bay, {'BAYERPAT': 'RGGB', 'OBJECT': 'M 45'})
t = (np.transpose(img, (1, 2, 0)) * 65535).astype(np.uint16)
tifffile.imwrite('rgb16.tif', t, photometric='rgb')
tifffile.imwrite('rgb16_deflate.tif', t, photometric='rgb', compression='zlib')
t8 = (t >> 8).astype(np.uint8)
Image.fromarray(t8).save('rgb8_lzw_pil.tif', compression='tiff_lzw')
Image.fromarray(t8).save('rgb8_pack.tif', compression='packbits')
Image.fromarray(t8).save('rgb8_deflate_pil.tif', compression='tiff_adobe_deflate')
m = np.zeros((H, W)); disc = np.hypot(x - 400, y - 300) < 230
tex = 0.55 + 0.15 * np.sin(x / 17) * np.cos(y / 23)
for _ in range(60):
    cx, cy, cr = rng.uniform(200, 600), rng.uniform(100, 500), rng.uniform(5, 30)
    tex -= 0.15 * np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (cr ** 2))
m[disc] = tex[disc] * 0.6
m += rng.normal(0, 0.01, m.shape)
Image.fromarray((np.clip(np.stack([m, m * 0.97, m * 0.9], 2), 0, 1) * 255).astype(np.uint8)).save('maan_test.jpg', quality=92)
print('test files written to', out)
