# UI test (v2) with Playwright + Chrome:
#   python3 test/ui-test.py <url> <testfiles-dir> <outdir>
# testfiles: run test/make-test-files.py first.
import sys, time, os, json
from playwright.sync_api import sync_playwright
url, tdir, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
errors = []
def log(*a): print(*a, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 1500, 'height': 920}, accept_downloads=True, locale='nl-NL')
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('dialog', lambda d: d.accept('Testpreset'))
    pg.goto(url)
    pg.evaluate('window.showSaveFilePicker = undefined; window.showDirectoryPicker = undefined')
    log('worker:', pg.evaluate('AstroApp.isWorker'))
    def idle(extra=0.4):
        pg.wait_for_function('!AstroApp.S.previewBusy && document.getElementById("overlay").classList.contains("hidden")', timeout=90000)
        time.sleep(extra)
    shot = lambda n: pg.screenshot(path=f'{out}/{n}.png')
    pg.click('#btnDemo'); idle(1)
    shot('01_style')
    for tab in ['light', 'colour', 'detail', 'stars', 'effect', 'image', 'info']:
        pg.click(f'.tab[data-tab="{tab}"]'); time.sleep(0.5); shot(f'02_tab_{tab}')
    # presets
    pg.click('.tab[data-tab="style"]')
    for pr in ['hoo', 'foraxx', 'hubble', 'starless', 'spikes', 'dreamy']:
        pg.click(f'[data-preset="{pr}"]'); idle(); pg.click('[data-view="after"]'); time.sleep(0.2); shot(f'03_preset_{pr}')
    pg.click('[data-preset="nebula"]'); idle()
    # slider change + undo/redo
    before = pg.evaluate('AstroApp.S.params.brightness')
    pg.evaluate("AstroApp.setParam('brightness', 0.35)"); time.sleep(0.6); idle()
    pg.click('#btnUndo'); idle()
    after_undo = pg.evaluate('AstroApp.S.params.brightness')
    pg.click('#btnRedo'); idle()
    log('undo/redo brightness', before, after_undo, pg.evaluate('AstroApp.S.params.brightness'))
    # curves: click in the curve canvas
    pg.click('.tab[data-tab="light"]'); time.sleep(0.3)
    pg.locator('.curvecanvas').scroll_into_view_if_needed(); box = pg.locator('.curvecanvas').bounding_box()
    pg.mouse.click(box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.35); idle()
    log('curve points', json.dumps(pg.evaluate('AstroApp.S.params.curves && AstroApp.S.params.curves.rgb')))
    # GHS mode
    pg.locator('label.select select').first.select_option('ghs'); idle(); shot('04_ghs')
    # HSL
    pg.click('.tab[data-tab="colour"]'); time.sleep(0.3)
    pg.evaluate("AstroApp.setParam('hsl', {red:[0.3,1.6,0.1]})"); idle(); shot('05_hsl')
    # view modes
    for vm in ['stars', 'starless', 'gradient', 'clip']:
        pg.select_option('#viewMode', vm); idle(); shot(f'06_view_{vm}')
    pg.select_option('#viewMode', 'normal'); idle()
    # crop tool
    pg.click('#btnCrop'); time.sleep(0.3)
    sb = pg.locator('#stage').bounding_box()
    pg.mouse.move(sb['x'] + sb['width'] * 0.3, sb['y'] + sb['height'] * 0.3); pg.mouse.down()
    pg.mouse.move(sb['x'] + sb['width'] * 0.75, sb['y'] + sb['height'] * 0.8, steps=5); time.sleep(0.2); shot('07_crop_tool')
    pg.mouse.up(); pg.click('#toolApply'); idle(1)
    log('after crop', pg.evaluate('JSON.stringify(AstroApp.S.src)'), pg.evaluate('JSON.stringify(AstroApp.S.geom.crop)'))
    # white balance picker
    pg.click('#btnPickWB'); time.sleep(0.2)
    pg.mouse.click(sb['x'] + sb['width'] * 0.5, sb['y'] + sb['height'] * 0.5); idle()
    log('wbPick', pg.evaluate('JSON.stringify(AstroApp.S.params.wbPick)'))
    # straighten + bin
    pg.evaluate("AstroApp.setGeom('angle', 3)"); idle(1)
    log('after angle', pg.evaluate('JSON.stringify(AstroApp.S.src)'))
    # snapshot compare
    pg.click('#btnSnap'); idle(1); pg.evaluate("AstroApp.setParam('saturation', 2.5)"); idle(1); shot('08_snapshot')
    # zoom
    pg.click('[data-zoom="1"]'); time.sleep(3); idle(); shot('09_zoom')
    pg.click('[data-zoom="fit"]')
    # text overlay
    pg.click('.tab[data-tab="effect"]'); time.sleep(0.3)
    pg.locator('label.check input').first.check(); time.sleep(0.5); shot('10_text')
    # saves
    for fmt, size in [('jpg', 'orig'), ('png', 'ig45'), ('webp', 'cmp'), ('tif', '2k'), ('fits', 'orig'), ('jpg', 'up2')]:
        pg.select_option('#format', fmt); pg.select_option('#exportSize', size)
        with pg.expect_download(timeout=180000) as d:
            pg.click('#btnSave')
        fn = f'{out}/save_{size}.{fmt}'; d.value.save_as(fn); log('saved', d.value.suggested_filename, os.path.getsize(fn))
    # own preset
    pg.click('.tab[data-tab="style"]'); time.sleep(0.3)
    pg.get_by_text('Huidige instellingen bewaren').click(); time.sleep(0.5)
    log('my presets', pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('ap-presets')||'{}'))"))
    # project export
    with pg.expect_download() as d:
        pg.get_by_text('Instellingen opslaan').click()
    d.value.save_as(f'{out}/project.json'); log('project keys', list(json.load(open(f'{out}/project.json')).keys()))
    # real files
    for f in ['rgb16.fits', 'maan_test.jpg', 'bayer.fits']:
        pg.set_input_files('#fileInput', f'{tdir}/{f}'); idle(1.5)
        log(f, '->', pg.inner_text('.detected') if pg.locator('.detected').count() else '', '|', pg.evaluate('AstroApp.S.preset'))
    shot('11_moon_or_last')
    # stacking
    pg.click('#btnStack')
    pg.set_input_files('#stackInput', [f'{tdir}/sessie1_M 27.fits', f'{tdir}/sessie2_M 27.fits', f'{tdir}/sessie3_M 27.fits'])
    pg.click('#stackStart')
    pg.wait_for_function('document.getElementById("fileInfo").textContent.includes("gecombineerd")', timeout=180000); idle(1)
    log('stacked file', pg.inner_text('#fileInfo'))
    shot('12_stacked')
    # language switch
    pg.click('[data-lang="en"]'); time.sleep(0.4); shot('13_en'); pg.click('[data-lang="nl"]')
    pg.set_viewport_size({'width': 820, 'height': 1000}); time.sleep(0.5); shot('14_small')
    b.close()
log('ERRORS:', errors)
