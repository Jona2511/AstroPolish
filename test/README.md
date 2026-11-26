# Tests

Alle Node-tests: `npm test` (of los, bijvoorbeeld `node test/algorithms-test.js`; `VERBOSE=1` toont ook de gemeten waarden van geslaagde controles).

Interfacetest: start `python3 -m http.server 8765` in `app/` en draai `python3 test/ui-test.py` (vereist `pip install playwright` en Google Chrome in `/usr/bin/google-chrome`). Schermafbeeldingen komen in `/tmp/ui` (of `$OUT`).

## Testdata

- `test/fixtures/` bevat kleine FITS- en TIFF-bestanden (37 × 23 pixels, oneven om rij-/kolomfouten te vangen). Ze zijn gemaakt met **onafhankelijke** software (een numpy-FITS-schrijver volgens de FITS 4.0-standaard, `tifffile` en Pillow), niet met AstroPolish zelf. Elk bestand bevat hetzelfde analytische patroon, zodat de test van elke pixel de juiste waarde kent. Opnieuw maken: `python3 test/fixtures/make_fixtures.py`.
- `test/lib/scenes.js` maakt realistische lineaire scènes (M42-achtige nevel met felle kern, sterrenstelsel, sterrenhoop, Melkweg, duoband, mono) met lichtvervuiling en bekende waarheid, plus objectieve maten (luchtniveau en -ruis, luchtkleur, contrast van zwak detail, kernstructuur, halo's, clipping). Gebruikt door `test/presets-test.js`; zie ook `docs/stretch.md`.
- `test/lib/synth.js` maakt synthetische sterrenvelden met bekende waarheid (achtergrond, gradient, sterren met bekende FWHM, ruis met bekende sigma) voor de algoritmetests.

## Wat synthetische data wel en niet aantoont

De algoritmetests bewijzen wiskundige eigenschappen (monotone curves, behoud van sterflux, geen helderheidsverschuiving door ruisonderdrukking, overeenkomst tussen voorbeeld en export, reproduceerbaarheid). Ze **vervangen geen tests op echte opnames**: echte data heeft andere ruis (Poisson, amp glow, hot pixels), vignettering, sterprofielen en kleurverhoudingen.

### Tests die echte astronomische data vereisen (nog handmatig)

Deze tests zijn **nog niet geautomatiseerd** omdat er geen vrij te verspreiden echte opnames in de repository zitten. Ze staan op de checklist voor een release:

| Wat | Waarom echte data nodig is |
|---|---|
| Dwarf 3 FITS (tele + wide), Seestar FITS, ZWO/N.I.N.A. FITS met BAYERPAT | rijvolgorde (ROWORDER) en Bayer-fase verschillen per software |
| Siril-output (32-bit float, waarden net boven 1, NaN-randen) | normalisatie en NaN-afhandeling op realistische data |
| PixInsight XISF-export naar TIFF/FITS | big-endian/planar varianten |
| Duoband-opnames (L-eNhance/L-eXtreme) | HOO/Foraxx-palet en neutralisatie |
| Maan, zon en planeten (JPG/TIFF uit de app van de telescoop) | niveaus-stretch en detectie |
| Meerdere nachten van hetzelfde object | uitlijnen met veldrotatie en verschillende ruisniveaus |

Wie zulke bestanden met een vrije licentie wil delen: graag via een issue. Ze kunnen dan als (gemarkeerde) praktijktest worden toegevoegd.
