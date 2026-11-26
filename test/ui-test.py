"""UI smoke test for AstroPolish v3 (Photoshop-style UI). Needs: python3 -m http.server 8765 in app/."""
import sys, os
from playwright.sync_api import sync_playwright

URL = os.environ.get('URL', 'http://localhost:8765/')
OUT = os.environ.get('OUT', '/tmp/ui')
os.makedirs(OUT, exist_ok=True)
errors = []

def wait_idle(page, t=60000):
    page.wait_for_function("() => document.getElementById('busy').classList.contains('hidden') && !window.AstroApp.S.previewBusy && !window.AstroApp.S.previewPending", timeout=t)
    page.wait_for_timeout(150)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    page = b.new_page(viewport={'width': 1600, 'height': 950})
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
    page.goto(URL)
    page.wait_for_selector('#menubar .mtop')
    page.screenshot(path=f'{OUT}/s0-start.png')
    # ---- simple mode (default for new users)
    assert page.evaluate("document.body.classList.contains('simple')")
    page.click('#ssDemo')
    page.wait_for_function('() => AstroApp.D() && AstroApp.D().layers.length > 3', timeout=60000)
    wait_idle(page)
    page.screenshot(path=f'{OUT}/s1-simple.png')
    # guided steps: step 2 (automatic edit) is open after opening a photo
    assert page.evaluate("document.querySelector('.gstep.open').dataset.step") == '2'
    page.click('.stile[data-action="bright"]'); wait_idle(page)
    page.click('.gstep.open .nextstep'); wait_idle(page)
    assert page.evaluate("document.querySelector('.gstep.open').dataset.step") == '3'
    page.screenshot(path=f'{OUT}/s1b-step3.png')
    # warning appears for an extreme value
    page.eval_on_selector('.srow[data-k="bright"] input', "(i) => { i.value = '0.42'; i.dispatchEvent(new Event('input')); }"); wait_idle(page)
    assert page.evaluate("document.querySelector('.srow[data-k=\"bright\"] .adv').classList.contains('warn')")
    # step 1: choose object type manually
    page.click('.gstep[data-step="1"] .gstephead'); page.click('.stile[data-object="galaxy"]'); wait_idle(page)
    assert page.evaluate('AstroApp.D().action') == 'galaxy'
    # show every step at once (no forced wizard)
    page.click('.guidehead input'); wait_idle(page)
    assert page.evaluate("document.querySelectorAll('.gstep.open').length") == 6
    for k, v in [('bright', '0.3'), ('noise', '0.6'), ('stars', '0.5'), ('lp', '1'), ('warm', '0.3'), ('sharp', '0.5'), ('color', '1.8'), ('contrast', '0.3')]:
        page.eval_on_selector(f'.srow[data-k="{k}"] input', f"(i) => {{ i.value = '{v}'; i.dispatchEvent(new Event('input')); }}")
        wait_idle(page)
    page.screenshot(path=f'{OUT}/s2-sliders.png', full_page=True)
    assert page.evaluate("AstroApp.D().layers.find(l=>l.op==='stretch').params.shoulder") is not None
    page.click('.guidehead input')
    print('simple layers:', page.evaluate('AstroApp.D().layers.map(l=>l.op).join(",")'))
    page.keyboard.press('Control+z'); wait_idle(page)
    page.click('.modeswitch button[data-mode="expert"]'); wait_idle(page)
    assert page.evaluate("!document.body.classList.contains('simple')")
    page.evaluate("AstroApp.S.docs.length = 0; AstroApp.S.cur = null; AstroApp.setMode('expert')")
    page.screenshot(path=f'{OUT}/0-start.png')
    assert page.evaluate('AstroApp.isWorker'), 'worker not active'

    page.click('#ssDemo')
    page.wait_for_function('() => AstroApp.D() && AstroApp.D().layers.length > 3', timeout=60000)
    wait_idle(page)
    n0 = page.evaluate('AstroApp.D().layers.length')
    print('auto layers:', n0, page.evaluate('AstroApp.D().layers.map(l=>l.op).join(",")'))
    page.screenshot(path=f'{OUT}/1-auto.png')

    # menus
    page.click('.mtop >> nth=2')  # Afbeelding
    page.wait_for_selector('.menu .mi')
    page.hover('.menu .mi.sub >> nth=0')
    page.wait_for_selector('.menu[data-depth="1"]')
    page.screenshot(path=f'{OUT}/2-menu.png')
    page.keyboard.press('Escape'); page.mouse.click(800, 500)

    # add curves via shortcut, edit curve
    page.keyboard.press('Control+m')
    wait_idle(page)
    assert page.evaluate('AstroApp.curLayer().op') == 'curves'
    cv = page.locator('canvas.curvecanvas')
    bb = cv.bounding_box()
    page.mouse.move(bb['x'] + bb['width'] * 0.5, bb['y'] + bb['height'] * 0.5)
    page.mouse.down(); page.mouse.move(bb['x'] + bb['width'] * 0.5, bb['y'] + bb['height'] * 0.35, steps=5); page.mouse.up()
    wait_idle(page)
    page.screenshot(path=f'{OUT}/3-curves.png')

    # every op as layer
    ops = page.evaluate("Object.keys(AstroOps.OPS).filter(k=>k!=='text')")
    for op in ops:
        page.evaluate(f"AstroApp.addLayer('{op}')")
        wait_idle(page)
        page.evaluate("AstroApp.deleteLayer()")
    wait_idle(page)
    print('ops ok:', len(ops))

    # blend + mask
    page.evaluate("AstroApp.addLayer('huesat', {sat: 1.8})"); wait_idle(page)
    page.select_option('.lyr-top select', 'screen'); wait_idle(page)
    page.evaluate("AstroApp.setMask(AstroApp.curLayer(), 'type', 'stars')"); wait_idle(page)
    page.evaluate("AstroApp.toggleViewMask(AstroApp.curLayer())"); wait_idle(page)
    page.screenshot(path=f'{OUT}/4-mask.png')
    page.evaluate("AstroApp.toggleViewMask(AstroApp.curLayer())"); wait_idle(page)

    # brush on mask
    page.keyboard.press('b')
    page.mouse.move(600, 400); page.mouse.down(); page.mouse.move(800, 450, steps=8); page.mouse.up()
    wait_idle(page)
    assert page.evaluate('AstroApp.curLayer().mask.strokes.length') == 1

    # marquee selection -> new layer masked
    page.keyboard.press('m')
    page.mouse.move(500, 300); page.mouse.down(); page.mouse.move(900, 600, steps=6); page.mouse.up()
    page.evaluate("AstroApp.addLayer('exposure', {exposure: 1})"); wait_idle(page)
    assert page.evaluate('AstroApp.curLayer().mask.type') == 'shape'
    page.screenshot(path=f'{OUT}/5-selection.png')
    page.keyboard.press('Control+d')

    # heal
    page.keyboard.press('j')
    page.mouse.move(400, 300); page.mouse.down(); page.mouse.move(700, 320, steps=6); page.mouse.up()
    wait_idle(page)
    assert page.evaluate("AstroApp.D().layers.some(l=>l.op==='heal')")

    # text
    page.keyboard.press('t'); page.mouse.click(450, 700); wait_idle(page)
    assert page.evaluate("AstroApp.D().layers.some(l=>l.op==='text')")

    # undo / redo
    h = page.evaluate('AstroApp.D().hIndex')
    page.keyboard.press('Control+z'); wait_idle(page)
    assert page.evaluate('AstroApp.D().hIndex') == h - 1
    page.keyboard.press('Control+Shift+z'); wait_idle(page)

    # zoom 100% (region render)
    page.keyboard.press('h')
    page.keyboard.press('Control+1')
    page.wait_for_timeout(300); wait_idle(page)
    page.wait_for_function('() => AstroApp.S.region', timeout=60000)
    page.screenshot(path=f'{OUT}/6-zoom100.png')
    page.keyboard.press('Control+0'); wait_idle(page)

    # actions
    page.click('.ptab[data-panel="actions"]')
    page.click('li[data-action="hoo"]'); wait_idle(page)
    page.screenshot(path=f'{OUT}/7-hoo.png')
    page.click('li[data-action="moon"]'); wait_idle(page)
    page.click('li[data-action="auto"]'); wait_idle(page)

    # geometry
    page.evaluate("AstroApp.setGeom('rot', 1)"); wait_idle(page)
    page.evaluate("AstroApp.setGeom('angle', 3)"); wait_idle(page)
    page.keyboard.press('c'); page.keyboard.press('Enter'); wait_idle(page)
    page.screenshot(path=f'{OUT}/8-geom.png')

    # panels
    for tab in ['hist', 'info', 'adj', 'history', 'nav']:
        page.click(f'.ptab[data-panel="{tab}"]'); page.wait_for_timeout(100)
    page.screenshot(path=f'{OUT}/9-panels.png')

    # export
    blob = page.evaluate("""async () => { const d = AstroApp.D(); const out = {};
      for (const f of ['jpg','png','tif','fits']) { const b = await AstroApp.renderFull(d, {format: f, quality: .9, size: 'orig', compare: false, text: true}); out[f] = b.size; }
      const c = await AstroApp.renderFull(d, {format: 'jpg', quality: .9, size: 'ig45', compare: true, text: true}); out.cmp = c.size; return out; }""")
    print('export sizes:', blob)
    assert all(v > 1000 for v in blob.values())

    # dialogs
    page.keyboard.press('Control+s'); page.wait_for_selector('#dlg[open]'); page.screenshot(path=f'{OUT}/10-export.png'); page.click('#dlg .df .btn >> nth=0')
    page.keyboard.press('F1'); page.wait_for_selector('#dlg[open]'); page.click('#dlg .df .btn >> nth=0')

    # ---- workflow: undo/redo is exact, project save -> reload gives an identical export
    exp = """async (fmt) => { const b = await AstroApp.renderFull(AstroApp.D(), {format: 'png', quality: 1, size: 'orig', compare: false, text: false}); return Array.from(new Uint8Array(await b.arrayBuffer())).reduce((h, v) => (h * 31 + v) >>> 0, 7); }"""
    h_now = page.evaluate(exp)
    n_hist = page.evaluate('AstroApp.D().hIndex')
    page.evaluate("AstroApp.addLayer('curves', {curves: {rgb: [[0,0],[0.4,0.6],[1,1]]}})"); wait_idle(page)
    page.evaluate("AstroApp.addLayer('huesat', {sat: 0.5})"); wait_idle(page)
    h_edit = page.evaluate(exp)
    assert h_edit != h_now, 'edits changed nothing'
    page.keyboard.press('Control+z'); wait_idle(page); page.keyboard.press('Control+z'); wait_idle(page)
    assert page.evaluate('AstroApp.D().hIndex') == n_hist
    assert page.evaluate(exp) == h_now, 'undo did not restore the exact result'
    page.keyboard.press('Control+Shift+z'); wait_idle(page); page.keyboard.press('Control+Shift+z'); wait_idle(page)
    assert page.evaluate(exp) == h_edit, 'redo did not restore the exact result'
    print('undo/redo exact: ok')
    # unsaved-changes flag + beforeunload guard
    assert page.evaluate('AstroApp.D().dirty') is True
    # save project (download fallback: no file picker in this test)
    page.evaluate('window.showSaveFilePicker = undefined')
    with page.expect_download() as dl:
        page.keyboard.press('Control+Alt+s')
    proj = dl.value.path()
    assert page.evaluate('AstroApp.D().dirty') is False
    # change things, then load the project again
    page.evaluate("AstroApp.applyAction('mono')"); wait_idle(page)
    page.evaluate("AstroApp.D().dirty = false")
    page.set_input_files('#jsonInput', proj) if False else None
    page.evaluate("document.getElementById('jsonInput').onchange = null")
    page.evaluate("""() => { const app = window.AstroApp; }""")
    # use the real menu path: File > Load project
    page.evaluate("""() => { const m = [...document.querySelectorAll('.mtop')][0]; m.click(); }""")
    item = page.locator('.menu .mi', has_text='laden').first if page.locator('.menu .mi', has_text='laden').count() else page.locator('.menu .mi', has_text='Load').first
    with page.expect_file_chooser() as fc:
        item.click()
    fc.value.set_files(proj)
    page.wait_for_timeout(500); wait_idle(page)
    assert page.evaluate(exp) == h_edit, 'project reload does not reproduce the export'
    print('project save/reload exact: ok')
    # ---- error handling: corrupt FITS shows a clear dialog with technical details, app keeps working
    page.set_input_files('#fileInput', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'fits_truncated.fits'))
    page.wait_for_selector('#dlg[open]', timeout=20000)
    txt = page.inner_text('#dlg')
    assert ('onvolledig' in txt or 'incomplete' in txt.lower() or 'beschadigd' in txt), txt
    assert page.locator('#dlg details pre').count() == 1
    page.screenshot(path=f'{OUT}/12-error.png')
    page.click('#dlg .df .btn.primary')
    # NaN TIFF opens, NaN pixels replaced
    page.set_input_files('#fileInput', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'tif_f32_nan.tif'))
    page.wait_for_function("() => AstroApp.D() && AstroApp.D().name === 'tif_f32_nan.tif' && AstroApp.D().src", timeout=30000); wait_idle(page)
    # unsupported format
    tmp = os.path.join(OUT, 'photo.cr2'); open(tmp, 'wb').write(b'not really raw')
    page.set_input_files('#fileInput', tmp)
    page.wait_for_selector('#dlg[open]', timeout=20000)
    assert 'cr2' in page.inner_text('#dlg')
    page.click('#dlg .df .btn.primary')
    # ---- invalid numeric input is ignored, not turned into NaN
    page.evaluate("AstroApp.addLayer('exposure')"); wait_idle(page)
    before_v = page.evaluate("AstroApp.curLayer().params.exposure")
    page.locator('#pb-b .prow input[type=number]').first.fill('')
    page.locator('#pb-b .prow input[type=number]').first.dispatch_event('change')
    wait_idle(page)
    v = page.evaluate("AstroApp.curLayer().params.exposure")
    assert isinstance(v, (int, float)) and v == v and v == before_v, v
    print('error handling + input validation: ok')
    # ---- closing with unsaved edits asks first
    page.evaluate("AstroApp.D().dirty = true")
    seen_dlg = []
    def on_dialog(d):
        seen_dlg.append(d.type)
        (d.dismiss if d.type == 'confirm' else d.accept)()
    page.on('dialog', on_dialog)
    n_docs = page.evaluate('AstroApp.S.docs.length')
    page.mouse.click(700, 500)
    page.keyboard.press('Control+w'); page.wait_for_timeout(500)
    assert seen_dlg == ['confirm'], 'no confirmation when closing an edited document: %r' % seen_dlg
    assert page.evaluate('AstroApp.S.docs.length') == n_docs, 'document closed although the user cancelled'

    # english
    page.evaluate("I18N.setLang('en')"); page.evaluate("AstroApp.setTool('hand')")
    seen_dlg.clear()
    page.reload(); page.wait_for_selector('#menubar .mtop')
    assert seen_dlg == ['beforeunload'], 'no unsaved-changes warning on reload: %r' % seen_dlg
    page.screenshot(path=f'{OUT}/11-en-start.png')
    b.close()

bad = [e for e in errors if 'favicon' not in e]
print('\n'.join(bad) if bad else 'no errors')
print('UI OK' if not bad else 'UI ERRORS')
sys.exit(1 if bad else 0)
