# ✨ AstroPolish

**English** · [Nederlands](#nederlands)

**Astrophoto editor for the Dwarf 3 (and other smart telescopes), laid out like Adobe Photoshop: menu bar, tools, options bar, document tabs and panels, with non-destructive adjustment layers.**
Drop in a photo and you immediately get a complete automatic edit, built from layers you can still adjust, hide, mask and blend.

**Two modes** (switch at the top right):
- **Simple** (default for new users): a guided workflow in six short steps — what is in the photo (detected automatically, easy to change), automatic edit (choose a style), brightness and stretch, colour and sky, noise and stars, compare and save. Every slider has a one-line explanation and shows a tip or warning when a value is likely to hurt the photo. Steps are optional: open any step directly, or tick *Show all steps at once*. See [docs/simple-mode.md](docs/simple-mode.md).
- **Expert**: the full Photoshop-style workspace described below. Every layer comes with a short explanation of what it does.

![AstroPolish](docs/screenshot.png)

**Who is it for?** Owners of smart telescopes (Dwarf 3, Seestar, Vespera…) who want a beautiful photo without learning PixInsight or Siril, and more advanced users who want layers, masks and astro-specific processing. AstroPolish edits **stacked** images; calibrating and stacking individual lights, darks and flats is done in your telescope app or in Siril.

## Download

| | |
|---|---|
| 🪟 **Windows** | Go to [Releases](../../releases/latest) and download `AstroPolish-…-portable.exe` (just run it, nothing to install) or `AstroPolish-…-setup.exe` (installer with a desktop shortcut). |
| 🍎 **Mac** | Go to [Releases](../../releases/latest) and download `AstroPolish-…-mac.dmg` (Apple Silicon and Intel, macOS 12 or newer). Open it and drag AstroPolish to *Applications*. |

> The app is not code-signed (yet). **Windows:** SmartScreen may warn you; choose *More info* → *Run anyway*. **Mac:** macOS blocks the first launch; go to *System Settings → Privacy & Security* and choose *Open Anyway*. If macOS says the app is "damaged", run `xattr -cr /Applications/AstroPolish.app` in Terminal.

## Features

**Photoshop-style workspace.**
- Menu bar (File, Edit, Image, Layer, Select, Filter, Astro, View, Window, Help) with the familiar Photoshop shortcuts (Ctrl+L, Ctrl+M, Ctrl+U, Ctrl+B, Ctrl+J, Ctrl+Z…; Cmd on a Mac).
- Toolbar: move, hand, zoom, rectangular and elliptical marquee, crop, eyedropper, star info (FWHM), ruler/straighten, brush and eraser for layer masks, healing brush (satellite trails) and text.
- Options bar per tool, multiple documents in tabs, status bar with pixel values.
- Panels: Navigator, Histogram, Info, Properties, Adjustments, Layers, History (with snapshots) and Actions. Show or hide panels via *Window*.

**Layers.**
- 53 operations as adjustment layers; every layer has opacity, 13 blend modes (screen, overlay, soft light, color, luminosity…) and a mask.
- Masks by luminance range, colour range, stars only, everything except stars, object, background or selection, plus painting with brush/eraser, feather, density and invert. Alt+click shows the mask.
- Drag, duplicate, rename and hide layers. The original is never changed.
- Save projects as .json and open them again later.

**Actions: 19 one-click styles.**
- *Deep sky*: Automatic, Nebula, Galaxy, Star cluster, Milky Way/wide field, Maximum brightness, Natural, Starless, Star spikes, Dreamy and Black & white.
- *Dual-band filter*: HOO, Foraxx and Hubble style.
- *Solar system*: Moon, Colourful moon, Sun, Orange sun (H-alpha look) and Planet.
- Record, export and import **your own actions**. Batch processing with any action.

**Photoshop adjustments.**
- Brightness/contrast, levels, curves (per channel), exposure, vibrance, hue/saturation, HSL per colour, colour balance, white balance, photo filter, black & white, channel mixer, invert, posterize, threshold, gradient map, shadows/highlights and auto tone/contrast/colour.
- Filters: Gaussian blur, median, surface blur, minimum, maximum, unsharp mask, high pass, clarity, dehaze, CLAHE, emboss, find edges, grain, glow, vignette, dust & scratches.

**Automatic detection and analysis.**
- Recognises the object from the FITS header or file name (all 110 Messier objects and many well-known names), and the Moon or Sun from the image itself.
- Info panel with stacking borders, light pollution, green cast, noise level, star count and sharpness (FWHM), plus the full FITS header.

**Light.**
- Stretching with seven methods: Automatic (STF), statistical, arcsinh, GHS (Generalized Hyperbolic Stretch), logarithmic, levels and manual. The automatic stretch has a *Protect highlights* control that keeps structure in bright cores (e.g. M42). How it works: [docs/stretch.md](docs/stretch.md).
- HDR multiscale transform.
- Brightness, black point, colour preservation and HDR protection of bright cores.
- Contrast, levels (black/gamma/white) and a per-channel **curves editor**.

**Colour.**
- Background neutralisation and colour calibration on the stars.
- **Eyedropper** for white balance (white star) and for the background. Temperature and tint.
- **Dual-band palettes**: HOO, soft HOO, Foraxx, Hubble-like (SHO style), Ha only and OIII only, plus OIII boost.
- Saturation, vibrance and SCNR (green removal).
- **HSL per hue** (8 colours) and **colour balance** for shadows, midtones and highlights.
- Black & white, invert and colourise.

**Detail.**
- Noise reduction: edge-preserving, wavelets, median or bilateral. Separate colour noise control, and a smoother background.
- Local contrast, sharpening, **deconvolution** (Richardson-Lucy) and **6 wavelet layers like RegiStax**.

**Stars.**
- Make stars smaller, dimmer or remove them entirely (**starless version**).
- Separate star colour, smaller halos and removal of blue or purple fringes.
- Edit nebula and stars separately.
- **Star spikes** with 4, 6 (JWST style) or 8 rays.

**Effects.**
- Soft glow and vignette.
- **Text or watermark** with object, date, exposure and telescope filled in automatically.

**Image.**
- **Crop** with aspect ratios, straighten by any angle, rotate and flip.
- 2×2 binning and automatic removal of stacking borders.
- Hot pixel removal.
- Light pollution removal with a smooth (polynomial) or complex (grid) model, subtract or divide, plus vignetting correction.

**Info.**
- Histogram (also logarithmic), statistics and noise.
- Stars and FWHM.
- All FITS metadata.

**View and compare.**
- Before/after slider and **snapshots** to compare versions.
- Zoom to 100% and 200%, computed at full resolution.
- Special views: star mask, starless, detected light pollution and clipping.
- Pixel values under the cursor.
- **Undo and redo** (Ctrl+Z / Ctrl+Y).

**Combine sessions.**
- Stack several nights of the same object.
- Automatic alignment on the stars (shift and rotation) and normalisation.

**Several photos at once** in tabs, and batch processing.

**Save.**
- As JPG, PNG, WebP, 16-bit TIFF or 32-bit FITS.
- Sizes: original, 4K, 2048 or 1080 px, Instagram 4:5 and 1:1, desktop 16:9, phone wallpaper, 2× upscale, or a side-by-side before/after image.
- **Save and load settings** as a file.

**Open.**
- JPG, PNG and WebP.
- TIFF in 8, 16 or 32 bit: uncompressed, LZW, Deflate or PackBits.
- FITS in 8, 16 or 32 bit and float: RGB, or Bayer/RAW with debayering.

**General.**
- English and Dutch. Runs completely locally: nothing is uploaded.

> Star removal and noise reduction work without AI models, so the app stays small and offline. On demanding data, StarNet, GraXpert or the RC-Astro tools are still stronger.

## Supported file formats

| Format | Open | Save | Notes |
|---|---|---|---|
| FITS | 8, 16 (signed and unsigned with BZERO), 32-bit integer, 32/64-bit float; mono, RGB (3 planes) and Bayer (RGGB/BGGR/GRBG/GBRG) | 32-bit float RGB | Also an image in an IMAGE extension. NaN/Inf become 0. Not supported: compressed FITS (fpack), tables, data cubes with more than 3 planes. |
| TIFF | 8/16-bit unsigned, 32-bit float; mono, RGB, RGBA; uncompressed, LZW, Deflate (with predictor), PackBits; strips, planar, big- and little-endian | 16-bit RGB (uncompressed) | Not supported: tiled, BigTIFF, palette, signed integers, float predictor. |
| JPG, PNG, WebP | yes (8-bit, EXIF orientation) | yes | Colour profiles are converted to sRGB. Exports contain no ICC profile and are sRGB. |
| RAW (CR2, NEF, ARW…), HEIC, AVI/SER | no | no | Rejected with a clear message. |
| Project (`.astropolish.json`) | yes | yes | Contains layers, masks and geometry, **not the photo itself**: keep it next to the original file. |

Maximum image size: 250 megapixels. A 24 Mpx export with the automatic edit uses about 1.8 GB of memory (see *Performance*).

## Feature status

**Stable (covered by automated tests):** opening and saving the formats above, stretching (STF, statistical, arcsinh, GHS, log, levels, manual), light pollution/gradient removal, colour calibration, noise reduction (4 methods), layers with opacity, 13 blend modes and masks, curves, HSL, levels and the other adjustments, undo/redo, saving and loading projects, export in all formats and sizes.

**Experimental (works, but little tested on real data yet):**
- *Combine sessions*: shift + rotation (+ scale) only, plain average without outlier rejection, needs enough stars.
- *Star removal / editing*: morphological, no AI. Large or saturated stars on a bright nebula leave traces; StarNet or StarXTerminator are stronger.
- *Deconvolution*: Richardson-Lucy with a Gaussian PSF and a protected background; slightly amplifies noise around stars.
- *Debayering*: bilinear; row order follows ROWORDER/BAYERPAT from the header, but has not been checked with every camera.
- *Healing brush*, *CLAHE* and *HDR multiscale*.

**Known limitations**
- The preview is computed on a downscaled copy (1200 px by default). The full-resolution export differs by about 1% on average (tested: < 2% per preset), because noise at full resolution reacts differently to non-linear steps. At 100% zoom the visible region is computed at full resolution.
- CLAHE computes its tiles per image, so at 100% zoom (a crop) it can look slightly different locally than in the export.
- Mono images use three channels internally (3× memory).
- Error messages from the file readers are in Dutch only.
- The Windows and Mac apps are not code-signed and the Mac app is not notarised by Apple (warning on first launch).
- There is no full colour management pipeline (no ICC profiles in exports, everything is sRGB).
- The automatic presets are tuned and tested on synthetic scenes with known ground truth (see [CHANGELOG.md](CHANGELOG.md)); they have not yet been validated on a broad set of real stacked images.
- Light-pollution removal cannot always tell a very faint nebula that fills the whole frame apart from a sky gradient; lower *Remove light pollution* if faint outer nebulosity disappears.

## Performance

Measured on a Linux server (one CPU core in the worker, Node 22), automatic edit with 12 layers:

| Size | Preview | Full-resolution export | Peak memory |
|---|---|---|---|
| 1920 × 1080 | 1.5 s | 2.9 s | 0.4 GB |
| 3840 × 2160 (Dwarf 3) | 1.4 s | 11.3 s | 0.9 GB |
| 6000 × 4000 (24 Mpx) | 1.6 s | 37.7 s | 1.7 GB |

Changing one layer only recomputes that layer and the layers above it (cache). All heavy computation runs in a background worker, so the interface stays responsive.

## Reporting bugs and questions

Open an [issue](../../issues/new/choose). Include the version (*Help → About AstroPolish*), what you did, what you expected and what happened. For an error message: click **Copy details** in the error window and paste that text into the issue. If you can share the file (for example via a download link), that helps a lot. Security problems: see [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). In short: no new runtime dependencies, every change to image processing comes with a test that shows the result is correct, and `npm test` must pass.

## Tips for the Dwarf 3

- Use the stacked **FITS** file when you can. It contains far more information than the JPG.
- **Dual-band filter**: try the HOO, Foraxx or Hubble styles.
- The same object on **several nights**? Use *Combine sessions*.
- A FITS that comes in upside down can be turned via *Image* → *Image rotation* → *180°*.
- Satellite trail? Take the healing brush (J) and paint over it.

## Building it yourself

```bash
npm install
npm start          # start the app
npm test           # all Node tests (lint, formats, algorithms, projects, security, layers, stacking)
npm run test:ui    # interface test in Chrome (python3 + playwright, server on port 8765: see test/README.md)
npm run dist       # build the Windows .exe (in dist/)
npm run dist:mac   # build the Mac .dmg (on a Mac, in dist/)
```

The web version lives in the `app/` folder and needs no build step. Start for example `python -m http.server` in that folder.

Every push and pull request runs all tests in GitHub Actions and builds the Windows and Mac apps. Only a push to `main` with a **new** version number in `package.json` creates a release; an existing release is never overwritten.

## Project structure

```
app/              web app (HTML/CSS/JS, no dependencies)
  js/engine.js    image processing: gradient, colour, stretch, noise, stars, wavelets, spikes…
  js/stack.js     aligning (triangle matching + RANSAC) and combining sessions
  js/ops.js       layers, masks, blend modes, cache and project validation
  js/formats.js   FITS and TIFF readers, TIFF16 and FITS writers
  js/core.js      commands for the background worker
  js/worker.js    computes in the background so the interface stays smooth
  js/app.js       interface
electron/         desktop app (main.js) and security rules (security.js)
test/             tests; test/fixtures holds small FITS/TIFF test files (see test/README.md)
```

## Licence

MIT, see [LICENSE](LICENSE). The app itself has no runtime dependencies. Building the desktop apps uses Electron (MIT) and electron-builder (MIT).

---


# Nederlands

[English](#-astropolish) · **Nederlands**

**Astrofoto-editor voor de Dwarf 3 (en andere smart-telescopen), opgezet zoals Adobe Photoshop: menubalk, gereedschappen, optiebalk, documenttabs en panelen, met niet-destructieve aanpassingslagen.**
Foto erin slepen en je krijgt meteen een complete automatische bewerking, opgebouwd uit lagen die je allemaal nog kunt aanpassen, verbergen, maskeren en mengen.

**Twee modi** (rechtsboven te wisselen):
- **Eenvoudig** (standaard voor nieuwe gebruikers): een begeleide werkwijze in zes korte stappen — wat staat er op de foto (automatisch herkend, makkelijk aan te passen), automatische bewerking (stijl kiezen), helderheid en stretch, kleur en lucht, ruis en sterren, vergelijken en opslaan. Elk schuifje heeft een uitleg van één regel en geeft een tip of waarschuwing als een waarde de foto waarschijnlijk slechter maakt. De stappen zijn niet verplicht: open elke stap direct, of vink *Alle stappen tegelijk tonen* aan. Zie [docs/simple-mode.md](docs/simple-mode.md).
- **Expert**: de volledige Photoshop-werkruimte hieronder. Elke laag heeft een korte uitleg wat hij doet.

![AstroPolish](docs/screenshot.png)

**Voor wie?** Voor eigenaren van smart-telescopen (Dwarf 3, Seestar, Vespera…) die zonder kennis van PixInsight of Siril een mooie foto willen, én voor gevorderden die lagen, maskers en astro-specifieke bewerkingen willen gebruiken. AstroPolish bewerkt **gestackte** opnames; het kalibreren en stacken van losse lights, darks en flats doe je in je telescoop-app of in Siril.

## Downloaden

| | |
|---|---|
| 🪟 **Windows-app** | Ga naar [Releases](../../releases/latest) en download `AstroPolish-…-portable.exe` (direct starten, niets installeren) of `AstroPolish-…-setup.exe` (installatieprogramma met snelkoppeling). |
| 🍎 **Mac** | Ga naar [Releases](../../releases/latest) en download `AstroPolish-…-mac.dmg` (Apple Silicon en Intel, macOS 12 of nieuwer). Open het bestand en sleep AstroPolish naar *Programma's*. |

> De app is (nog) niet digitaal ondertekend. **Windows:** SmartScreen kan waarschuwen; kies *Meer informatie* → *Toch uitvoeren*. **Mac:** macOS blokkeert de eerste keer openen; ga naar *Systeeminstellingen → Privacy en beveiliging* en kies *Open toch*. Zegt macOS dat de app "beschadigd" is, voer dan in Terminal `xattr -cr /Applications/AstroPolish.app` uit.

## Alles wat erin zit

**Photoshop-werkruimte.**
- Menubalk (Bestand, Bewerken, Afbeelding, Laag, Selecteren, Filter, Astro, Weergave, Venster, Help) met de bekende Photoshop-sneltoetsen (Ctrl+L, Ctrl+M, Ctrl+U, Ctrl+B, Ctrl+J, Ctrl+Z…).
- Gereedschapsbalk: verplaatsen, hand, zoom, rechthoek- en ovaalselectie, bijsnijden, pipet, sterinfo (FWHM), liniaal/rechtzetten, penseel en gum voor laagmaskers, herstelpenseel (satellietstrepen) en tekst.
- Optiebalk per gereedschap, meerdere documenten in tabbladen, statusbalk met pixelwaarden.
- Panelen: Navigator, Histogram, Info, Eigenschappen, Aanpassingen, Lagen, Geschiedenis (met momentopnamen) en Acties. Panelen aan/uit via *Venster*.

**Lagen.**
- 53 bewerkingen als aanpassingslaag; elke laag heeft dekking, 13 overvloeimodi (bleken, bedekken, zacht licht, kleur, lichtsterkte…) en een masker.
- Maskers op helderheidsbereik, kleurbereik, alleen sterren, alles behalve sterren, object, achtergrond of selectie, plus schilderen met penseel/gum, doezelaar, dichtheid en omkeren. Alt+klik toont het masker.
- Lagen slepen, dupliceren, hernoemen en verbergen. Het origineel blijft altijd onaangetast.
- Projecten opslaan als .json en later weer openen.

**Acties: 19 stijlen met één klik.**
- *Deep-sky*: Automatisch, Nevel, Sterrenstelsel, Sterrenhoop, Melkweg/breed, Maximaal helder, Natuurlijk, Zonder sterren, Star spikes, Dromerig en Zwart-wit.
- *Duoband-filter*: HOO, Foraxx en Hubble-stijl.
- *Zonnestelsel*: Maan, Kleurrijke maan, Zon, Zon oranje (H-alpha-look) en Planeet.
- Je **eigen acties** opnemen, exporteren en importeren. Batchverwerking met elke actie.

**Photoshop-aanpassingen.**
- Helderheid/contrast, niveaus, curven (per kanaal), belichting, levendigheid, kleurtoon/verzadiging, HSL per kleur, kleurbalans, witbalans, fotofilter, zwart-wit, kanaalmixer, negatief, posterize, drempel, verloop toewijzen, schaduwen/hooglichten en automatische tint/contrast/kleur.
- Filters: Gaussiaans vervagen, mediaan, oppervlakte vervagen, minimum, maximum, onscherp masker, hoogdoorlaat, helderheid (clarity), nevel verwijderen (dehaze), CLAHE, reliëf, randen zoeken, korrel, gloed, vignet, stof en krassen.

**Automatisch herkennen en analyseren.**
- Herkent het object via de FITS-header of bestandsnaam (alle 110 Messier-objecten en veel bekende namen), en een maan of zon aan de foto zelf.
- Info-paneel met stackranden, lichtvervuiling, groene zweem, ruisniveau, aantal sterren en scherpte (FWHM), plus de volledige FITS-header.

**Licht.**
- Oprekken met zeven methoden: Automatisch (STF), statistisch, Arcsinh, GHS (Generalized Hyperbolic Stretch), logaritmisch, niveaus en handmatig. De automatische stretch heeft een schuif *Hoge lichten sparen* die structuur in heldere kernen (zoals M42) bewaart. Uitleg: [docs/stretch.md](docs/stretch.md).
- HDR-multischaaltransformatie.
- Helderheid, zwartpunt, kleurbehoud en HDR-bescherming van felle kernen.
- Contrast, niveaus (zwart/gamma/wit) en een **curves-editor** per kanaal.

**Kleur.**
- Achtergrond neutraliseren en kleurkalibratie op de sterren.
- **Pipet** voor witbalans (witte ster) en voor de achtergrond. Temperatuur en tint.
- **Paletten voor de duoband-filter**: HOO, HOO zacht, Foraxx, Hubble-achtig (SHO-stijl), alleen Ha en alleen OIII, plus OIII-boost.
- Verzadiging, levendigheid en SCNR (groene zweem verwijderen).
- **HSL per tint** (8 kleuren) en **kleurbalans** voor schaduwen, middentonen en hoge lichten.
- Zwart-wit, negatief en inkleuren.

**Detail.**
- Ruisonderdrukking: randbehoudend, wavelets, mediaan of bilateraal. Kleurruis apart, en een gladdere achtergrond.
- Lokaal contrast, verscherpen, **deconvolutie** (Richardson-Lucy) en **6 wavelet-lagen zoals in RegiStax**.

**Sterren.**
- Sterren kleiner, minder fel of helemaal weg (**sterrenloze versie**).
- Sterkleur apart, halo's kleiner en blauwe of paarse randen weg.
- Nevel en sterren gescheiden bewerken.
- **Star spikes** met 4, 6 (JWST-stijl) of 8 stralen.

**Effect.**
- Zachte gloed en vignet.
- **Tekst of watermerk** met automatisch ingevuld object, datum, belichting en telescoop.

**Beeld.**
- **Bijsnijden** met beeldverhoudingen, rechtzetten met elke hoek, draaien en spiegelen.
- 2×2 binning en stackranden automatisch wegsnijden.
- Hete pixels verwijderen.
- Lichtvervuiling weghalen met een gladde (polynoom) of complexe (raster) methode, aftrekken of delen, plus vignetteringscorrectie.

**Info.**
- Histogram (ook logaritmisch), statistieken en ruis.
- Sterren en FWHM.
- Alle FITS-gegevens.

**Bekijken en vergelijken.**
- Voor/na-schuifbalk en **momentopnames** om versies te vergelijken.
- Zoom op 100% en 200%, in volle resolutie berekend.
- Speciale weergaven: sterrenmasker, zonder sterren, gevonden lichtvervuiling en over-/onderbelichting.
- Pixelwaarden onder de muis.
- **Ongedaan maken en opnieuw** (Ctrl+Z / Ctrl+Y).

**Sessies combineren.**
- Stack meerdere nachten van hetzelfde object.
- Automatisch uitlijnen op de sterren (verschuiving en rotatie) en normaliseren.

**Meerdere foto's tegelijk** openen in tabbladen, en batchverwerking.

**Opslaan.**
- Als JPG, PNG, WebP, TIFF 16-bit of FITS 32-bit.
- Formaten: origineel, 4K, 2048 of 1080 px, Instagram 4:5 en 1:1, bureaublad 16:9, telefoon-achtergrond, 2× vergroot, of een voor/na-afbeelding naast elkaar.
- **Instellingen opslaan en laden** als bestand.

**Openen.**
- JPG, PNG en WebP.
- TIFF in 8, 16 of 32 bit: ongecomprimeerd, LZW, Deflate of PackBits.
- FITS in 8, 16 of 32 bit en float: RGB, of Bayer/RAW met debayer.

**Algemeen.**
- Nederlands en Engels. Werkt volledig lokaal: er wordt niets geüpload.

> Sterren verwijderen en ruisonderdrukking werken zonder AI-modellen, zodat de app klein en offline blijft. Op zware data zijn StarNet, GraXpert of de RC-Astro-tools nog sterker.

## Ondersteunde bestandsformaten

| Formaat | Openen | Opslaan | Opmerkingen |
|---|---|---|---|
| FITS | 8, 16 (signed en unsigned met BZERO), 32-bit integer, 32/64-bit float; mono, RGB (3 vlakken) en Bayer (RGGB/BGGR/GRBG/GBRG) | 32-bit float RGB | Ook een afbeelding in een IMAGE-extensie. NaN/Inf worden 0. Niet: gecomprimeerde FITS (fpack), tabellen, data-cubes met meer dan 3 vlakken. |
| TIFF | 8/16-bit unsigned, 32-bit float; mono, RGB, RGBA; ongecomprimeerd, LZW, Deflate (met predictor), PackBits; strips, planar, big- en little-endian | 16-bit RGB (ongecomprimeerd) | Niet: tegels (tiled), BigTIFF, kleurenpalet, signed integers, float-predictor. |
| JPG, PNG, WebP | ja (8-bit, EXIF-oriëntatie) | ja | De browser zet kleurprofielen om naar sRGB. Exports bevatten geen ICC-profiel en zijn sRGB. |
| RAW (CR2, NEF, ARW…), HEIC, AVI/SER | nee | nee | Wordt met een duidelijke melding geweigerd. |
| Project (`.astropolish.json`) | ja | ja | Bevat lagen, maskers en geometrie, **niet de foto zelf**: bewaar het naast het originele bestand. |

Maximale afbeeldingsgrootte: 250 megapixel. Een 24 Mpx-export met de automatische bewerking gebruikt ongeveer 1,8 GB werkgeheugen (zie *Prestaties*).

## Status van de functies

**Stabiel (getest met automatische tests):** openen en opslaan van de formaten hierboven, oprekken (STF, statistisch, arcsinh, GHS, log, niveaus, handmatig), lichtvervuiling/gradient, kleurkalibratie, ruisonderdrukking (4 methoden), lagen met dekking, 13 overvloeimodi en maskers, curven, HSL, niveaus en de andere aanpassingen, ongedaan maken/opnieuw, projecten opslaan en laden, export in alle formaten en afmetingen.

**Experimenteel (werkt, maar nog weinig getest op echte opnames):**
- *Sessies combineren*: alleen verschuiving + rotatie (+ schaal), gewoon gemiddelde zonder outlier-rejection, vereist voldoende sterren.
- *Sterren verwijderen / bewerken*: morfologisch, zonder AI. Grote of verzadigde sterren op een heldere nevel laten sporen achter; StarNet of StarXTerminator zijn sterker.
- *Deconvolutie*: Richardson-Lucy met een Gaussische PSF en beschermde achtergrond; versterkt ruis rond sterren een beetje.
- *Debayer*: bilineair; de rijvolgorde volgt ROWORDER/BAYERPAT uit de header, maar is niet met alle camera's gecontroleerd.
- *Herstelpenseel*, *CLAHE* en *HDR multischaal*.

**Bekende beperkingen**
- Het voorbeeld wordt berekend op een verkleinde versie (standaard 1200 px). De export op volle resolutie wijkt gemiddeld ongeveer 1% af (getest: < 2% per preset), omdat ruis op volle resolutie anders reageert op niet-lineaire bewerkingen. Op 100% zoom wordt het uitsnede-gebied op volle resolutie berekend.
- CLAHE berekent zijn tegels per beeld: bij 100%-zoom (uitsnede) kan het lokaal iets anders ogen dan in de export.
- Mono-opnames gebruiken intern drie kanalen (3× geheugen).
- Foutmeldingen van de bestandslezers zijn alleen in het Nederlands.
- De Windows- en Mac-app zijn niet digitaal ondertekend en de Mac-app is niet door Apple genotariseerd (waarschuwing bij de eerste keer openen).
- Er is geen echte kleurbeheer-pipeline (geen ICC-profielen in exports, alles is sRGB).
- De automatische presets zijn afgesteld en getest op synthetische scènes met bekende waarheid (zie [CHANGELOG.md](CHANGELOG.md)); ze zijn nog niet gevalideerd op een brede set echte gestackte opnames.
- Lichtvervuiling weghalen kan een heel zwakke nevel die het hele beeld vult niet altijd onderscheiden van een gradient in de lucht; zet *Lichtvervuiling weghalen* lager als zwakke buitenste nevel verdwijnt.

## Prestaties

Gemeten op een Linux-server (één CPU-kern in de worker, Node 22), automatische bewerking met 12 lagen:

| Afmeting | Voorbeeld | Export volle resolutie | Piekgeheugen |
|---|---|---|---|
| 1920 × 1080 | 1,5 s | 2,9 s | 0,4 GB |
| 3840 × 2160 (Dwarf 3) | 1,4 s | 11,3 s | 0,9 GB |
| 6000 × 4000 (24 Mpx) | 1,6 s | 37,7 s | 1,7 GB |

Een wijziging van één laag rekent alleen die laag en de lagen erboven opnieuw (cache). Alle zware berekeningen draaien in een achtergrondproces, zodat de interface blijft reageren.

## Bugs melden en vragen

Maak een [issue](../../issues/new/choose) aan. Vermeld de versie (*Help → Over AstroPolish*), wat je deed, wat je verwachtte en wat er gebeurde. Bij een foutmelding: klik in het foutvenster op **Details kopiëren** en plak die tekst in het issue. Kun je het bestand delen (bijvoorbeeld via een downloadlink), dan helpt dat enorm. Beveiligingsproblemen: zie [SECURITY.md](SECURITY.md).

## Bijdragen

Bijdragen zijn welkom, zie [CONTRIBUTING.md](CONTRIBUTING.md). Kort: geen nieuwe runtime-dependencies, elke wijziging aan beeldbewerking krijgt een test die aantoont dat het resultaat klopt, en `npm test` moet slagen.

## Tips voor de Dwarf 3

- Gebruik het gestackte **FITS**-bestand als het kan. Daar zit veel meer informatie in dan in de JPG.
- **Duoband-filter**: probeer de stijlen HOO, Foraxx of Hubble.
- **Meerdere avonden** hetzelfde object? Gebruik *Sessies combineren*.
- Een FITS die ondersteboven binnenkomt draai je om via *Afbeelding* → *Afbeelding roteren* → *180°*.
- Satellietstreep? Pak het herstelpenseel (J) en schilder eroverheen.

## Zelf bouwen

```bash
npm install
npm start        # app starten
npm test         # alle Node-tests (lint, formaten, algoritmes, projecten, beveiliging, lagen, stacken)
npm run test:ui  # interfacetest in Chrome (python3 + playwright, server op poort 8765: zie test/README.md)
npm run dist     # Windows .exe bouwen (in dist/)
npm run dist:mac # Mac .dmg bouwen (op een Mac, in dist/)
```

De web-versie staat in de map `app/` en heeft geen build-stap nodig. Start bijvoorbeeld `python -m http.server` in die map.

Elke push en pull request draait alle tests in GitHub Actions en bouwt de Windows- en Mac-app. Alleen een push naar `main` met een **nieuw** versienummer in `package.json` maakt een release; een bestaande release wordt nooit overschreven.

## Projectstructuur

```
app/              web-app (HTML/CSS/JS, geen dependencies)
  js/engine.js    beeldbewerking: gradient, kleur, stretch, ruis, sterren, wavelets, spikes…
  js/stack.js     sessies uitlijnen (driehoek-matching + RANSAC) en combineren
  js/ops.js       lagen, maskers, overvloeimodi, cache en validatie van projecten
  js/formats.js   FITS- en TIFF-lezer, TIFF16- en FITS-schrijver
  js/core.js      opdrachten voor het achtergrondproces
  js/worker.js    rekent op de achtergrond, zodat de interface soepel blijft
  js/app.js       interface
electron/         desktop-app (main.js) en beveiligingsregels (security.js)
test/             tests; test/fixtures bevat kleine FITS/TIFF-testbestanden (zie test/README.md)
```

## Licentie

MIT, zie [LICENSE](LICENSE). De app zelf heeft geen runtime-dependencies. Voor het bouwen van de desktop-apps worden Electron (MIT) en electron-builder (MIT) gebruikt.
