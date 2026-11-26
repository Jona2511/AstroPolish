# UI test with Playwright + Chrome: python3 test/ui-test.py <url> <testfiles-dir> <outdir>
import sys, time, os
from playwright.sync_api import sync_playwright
url, tdir, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(url)
    pg.screenshot(path=f'{out}/01_welcome.png')
    print('worker:', pg.evaluate('AstroApp.isWorker'))
    def idle():
        pg.wait_for_function('!AstroApp.S.previewBusy && document.getElementById("overlay").classList.contains("hidden")', timeout=60000)
        time.sleep(0.4)
    pg.click('#btnDemo'); idle()
    pg.screenshot(path=f'{out}/02_demo_auto.png')
    pg.click('[data-preset="bright"]'); idle()
    pg.click('[data-view="after"]'); time.sleep(0.2)
    pg.screenshot(path=f'{out}/03_demo_bright_after.png')
    pg.click('[data-zoom="1"]'); time.sleep(3); idle()
    pg.screenshot(path=f'{out}/04_zoom100.png')
    pg.click('[data-zoom="fit"]'); pg.click('[data-view="split"]')
    pg.click('#advanced summary'); time.sleep(0.3)
    pg.screenshot(path=f'{out}/05_advanced.png')
    # save JPG
    t=time.time()
    with pg.expect_download(timeout=120000) as d:
        pg.evaluate('window.showSaveFilePicker = undefined')
        pg.click('#btnSave')
    d.value.save_as(f'{out}/saved.jpg'); print('save jpg', round(time.time()-t,1),'s', d.value.suggested_filename)
    pg.select_option('#format', 'tif')
    with pg.expect_download(timeout=120000) as d:
        pg.click('#btnSave')
    d.value.save_as(f'{out}/saved.tif'); print('save tif', d.value.suggested_filename)
    # real files
    for f in ['rgb16.fits', 'bayer.fits', 'maan_test.jpg', 'rgb16_deflate.tif']:
        pg.set_input_files('#fileInput', f'{tdir}/{f}'); idle()
        det = pg.inner_text('#detected'); on = pg.get_attribute('.preset.on', 'data-preset')
        print(f, '->', on, '|', det, '| params.stretchMode', pg.evaluate('AstroApp.S.params.stretchMode'))
        pg.screenshot(path=f'{out}/06_{f}.png')
    # language
    pg.click('[data-lang="en"]'); time.sleep(0.3); pg.screenshot(path=f'{out}/07_en.png')
    pg.click('[data-lang="nl"]')
    # mobile-ish
    pg.set_viewport_size({'width': 800, 'height': 900}); time.sleep(0.5); pg.screenshot(path=f'{out}/08_small.png')
    b.close()
print('ERRORS:', errors)
