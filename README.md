# ✨ AstroPolish

**Maak astrofoto's van de Dwarf 3 (en andere smart-telescopen) met één klik mooi, met de tools van de grote programma's in één simpele app.**
Foto erin slepen, stijl aanklikken, opslaan. Wie verder wil, vindt in acht tabbladen alles wat je anders met Siril, GraXpert, StarNet, SetiAstro, RegiStax en Photoshop-acties doet.

![AstroPolish](docs/screenshot.png)

## Downloaden

| | |
|---|---|
| 🪟 **Windows-app** | Ga naar [Releases](../../releases/latest) en download `AstroPolish-…-portable.exe` (direct starten, niets installeren) of `AstroPolish-…-setup.exe` (installatieprogramma met snelkoppeling). |
| 🌐 **In de browser** | [jona2511.github.io/astropolish](https://jona2511.github.io/astropolish/): werkt in Chrome en Edge zonder installatie. |

> Windows SmartScreen kan bij de eerste keer waarschuwen omdat de app (nog) niet digitaal ondertekend is. Kies dan *Meer informatie* → *Toch uitvoeren*.

## Alles wat erin zit

**Eén klik: 19 stijlen.**
- *Deep-sky*: Automatisch, Nevel, Sterrenstelsel, Sterrenhoop, Melkweg/breed, Maximaal helder, Natuurlijk, Zonder sterren, Star spikes, Dromerig en Zwart-wit.
- *Duoband-filter*: HOO, Foraxx en Hubble-stijl.
- *Zonnestelsel*: Maan, Kleurrijke maan, Zon, Zon oranje (H-alpha-look) en Planeet.
- Daarnaast je **eigen stijlen**: bewaren, exporteren en importeren.

**Automatisch herkennen en analyseren.**
- Herkent het object via de FITS-header of bestandsnaam (alle 110 Messier-objecten en veel bekende namen), en een maan of zon aan de foto zelf.
- Een checklist laat zien wat de app ziet: stackranden, lichtvervuiling, groene zweem, ruisniveau, aantal sterren en scherpte (FWHM). Herkent ook de duoband-filter.

**Licht.**
- Oprekken met vier methoden: Automatisch (STF), Arcsinh, GHS (Generalized Hyperbolic Stretch) en Niveaus.
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
- Ruisonderdrukking: snel (randbehoudend) of met wavelets. Kleurruis apart, en een gladdere achtergrond.
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

**Meerdere foto's tegelijk** bewerken.

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

## Tips voor de Dwarf 3

- Gebruik het gestackte **FITS**-bestand als het kan. Daar zit veel meer informatie in dan in de JPG.
- **Duoband-filter**: probeer de stijlen HOO, Foraxx of Hubble.
- **Meerdere avonden** hetzelfde object? Gebruik *Sessies combineren*.
- Een FITS die ondersteboven binnenkomt draai je om via *Beeld* → *Ondersteboven*.

## Zelf bouwen

```bash
npm install
npm start        # app starten
npm test         # engine- en stacktests
npm run dist     # Windows .exe bouwen (in dist/)
```

De web-versie staat in de map `app/` en heeft geen build-stap nodig. Start bijvoorbeeld `python -m http.server` in die map.

Elke push naar `main` bouwt de Windows-app via GitHub Actions. Een nieuw versienummer in `package.json` maakt automatisch een nieuwe release met de .exe-bestanden.

## Projectstructuur

```
app/              web-app (HTML/CSS/JS, geen dependencies)
  js/engine.js    beeldbewerking: gradient, kleur, stretch, ruis, sterren, wavelets, spikes…
  js/stack.js     sessies uitlijnen (driehoek-matching + RANSAC) en combineren
  js/formats.js   FITS- en TIFF-lezer, TIFF16- en FITS-schrijver
  js/core.js      opdrachten voor het achtergrondproces
  js/worker.js    rekent op de achtergrond, zodat de interface soepel blijft
  js/app.js       interface
electron/main.js  Windows-app
test/             tests (engine, bestandsformaten, stacken, interface)
```

---

*English:* AstroPolish is a free, open-source astrophoto editor for smart telescopes (Dwarf 3, Seestar, Vespera…). It offers one-click styles plus GHS/arcsinh stretching, gradient removal, colour calibration, HOO/Foraxx palettes, curves, HSL, deconvolution, wavelets, star reduction/removal, star spikes, multi-night stacking, batch processing and many export sizes. Everything runs locally. MIT licence.
