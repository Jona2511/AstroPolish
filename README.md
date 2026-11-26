# ✨ AstroPolish

**Maak astrofoto's van de Dwarf 3 (en andere smart-telescopen) met één klik mooi.**
Foto erin slepen, stijl aanklikken, opslaan. Klaar.

![AstroPolish](docs/screenshot.png)

## Downloaden

| | |
|---|---|
| 🪟 **Windows-app** | Ga naar [Releases](../../releases/latest) en download `AstroPolish-…-portable.exe` (direct starten, niets installeren) of `AstroPolish-…-setup.exe` (installatieprogramma met snelkoppeling). |
| 🌐 **In de browser** | [jona2511.github.io/astropolish](https://jona2511.github.io/astropolish/): werkt in Chrome en Edge, ook zonder installatie. |

> Windows SmartScreen kan bij de eerste keer waarschuwen omdat de app (nog) niet digitaal ondertekend is. Kies dan *Meer informatie* → *Toch uitvoeren*.

## Wat kan het?

- **Eén-klik-stijlen**: Automatisch, Nevel, Sterrenstelsel, Sterrenhoop, Melkweg/breedbeeld, Maximaal helder, Natuurlijk, Zwart-wit, Maan, Kleurrijke maan, Zon en Planeet.
- **Automatisch herkennen**: leest de objectnaam uit de FITS-header of bestandsnaam (bijv. `DWARF_RAW_TELE_M 42_…`: alle 110 Messier-objecten en veel bekende namen) en herkent maan of zon aan de foto zelf.
- **Zo helder mogelijk**: automatisch oprekken (zoals PixInsight's STF), met bescherming van felle kernen.
- **Alle bewerkingen**:
  - zwarte stackranden automatisch bijsnijden en hete pixels verwijderen
  - lichtvervuiling en gradients wegwerken
  - achtergrond neutraliseren en kleuren kalibreren op sterren
  - ruis in helderheid en kleur onderdrukken
  - sterren verkleinen, lokaal contrast en verscherpen
  - contrast, verzadiging, levendigheid en groene zweem (SCNR)
- **Voor/na-vergelijking** met schuifbalk en 100%-zoom (in volle resolutie berekend).
- **Meerdere foto's tegelijk** bewerken.
- **Bestanden**: JPG, PNG, WebP, TIFF (8/16/32-bit, ongecomprimeerd, LZW, Deflate, PackBits) en FITS (8/16/32-bit en float, RGB of Bayer/RAW met debayer).
- **Opslaan** als JPG, PNG of TIFF 16-bit.
- Nederlands en Engels.
- **Privé**: alles draait lokaal, er wordt niets geüpload.

## Tips voor de Dwarf 3

- Gebruik het gestackte **FITS**-bestand als het kan. Daar zit veel meer informatie in dan in de JPG.
- Komt een FITS ondersteboven binnen? Klik op ⇵.
- Duoband-filter: zet *Groene zweem verwijderen* laag, anders verdwijnt de blauwgroene OIII-kleur.

## Zelf bouwen

```bash
npm install
npm start        # app starten
npm run dist     # Windows .exe bouwen (in dist/)
```

De web-versie staat in de map `app/` en heeft geen build-stap nodig. Start bijvoorbeeld `python -m http.server` in die map.

Elke push naar `main` bouwt de Windows-app automatisch via GitHub Actions. Een tag als `v1.0.1` maakt een nieuwe release met de .exe-bestanden.

## Projectstructuur

```
app/              web-app (HTML/CSS/JS, geen dependencies)
  js/engine.js    beeldbewerking (gradient, kleur, stretch, ruis, sterren…)
  js/formats.js   FITS- en TIFF-lezer, TIFF16-schrijver
  js/worker.js    rekent op de achtergrond, zodat de interface soepel blijft
  js/app.js       interface
electron/main.js  Windows-app
test/             tests (engine, bestandsformaten, interface)
```

---

*English:* AstroPolish is a free, open-source one-click editor for smart-telescope astrophotos (Dwarf 3, Seestar, Vespera…). Drop a JPG/PNG/TIFF/FITS, click a style, save. Everything runs locally. MIT licence.
