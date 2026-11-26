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

    # english
    page.evaluate("I18N.setLang('en')"); page.evaluate("AstroApp.setTool('hand')")
    page.reload(); page.wait_for_selector('#menubar .mtop')
    page.screenshot(path=f'{OUT}/11-en-start.png')
    b.close()

bad = [e for e in errors if 'favicon' not in e]
print('\n'.join(bad) if bad else 'no errors')
print('UI OK' if not bad else 'UI ERRORS')
sys.exit(1 if bad else 0)
