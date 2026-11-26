// Node test: read FITS/TIFF test files and compare against reference (written by gen script)
const F = require('../app/js/formats.js');
const E = require('../app/js/engine.js');
const fs = require('fs');
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => /\.(fits|tif)$/.test(f) && !f.startsWith('sessie'));
(async () => {
  let fail = 0;
  for (const f of files) {
    const b = fs.readFileSync(`${dir}/${f}`);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    try {
      const img = f.endsWith('.fits') ? F.readFITS(ab) : await F.readTIFF(ab);
      // orientation check: top-left 40x40 block was set to 0.9
      const tl = img.g[10 * img.w + 10], br = img.g[(img.h - 10) * img.w + img.w - 10];
      const ok = tl > 0.8 && br < 0.5;
      const g = E.autoPreset(img, f);
      console.log(f.padEnd(22), img.w + 'x' + img.h, 'mono', img.mono, 'TL', tl.toFixed(3), 'BR', br.toFixed(3), ok ? 'OK' : 'FOUT', 'obj', img.meta.object || '-', '->', g.type, g.label);
      if (!ok) fail++;
    } catch (e) { console.log(f, 'ERROR', e.message); fail++; }
  }
  process.exit(fail ? 1 : 0);
})();
