# Bijdragen aan AstroPolish

Fijn dat je wilt helpen. AstroPolish is bedoeld als betrouwbare astrofoto-editor: **de kwaliteit van de beeldbewerking gaat voor het aantal functies.**

## Ontwikkelomgeving

```bash
git clone https://github.com/Jona2511/AstroPolish
cd AstroPolish
npm install          # alleen nodig voor de Windows-app (Electron)
npm test             # alle Node-tests
cd app && python3 -m http.server 8765   # web-versie op http://localhost:8765
```

De app in `app/` is gewone HTML/CSS/JavaScript zonder build-stap en zonder runtime-dependencies.

## Regels

1. **Geen nieuwe runtime-dependencies.** De app moet zonder `node_modules` werken (web-versie) en klein blijven.
2. **Elke wijziging aan beeldbewerking krijgt een test die aantoont dat het resultaat klopt**, niet alleen dat de code zonder fout draait. Voorbeelden staan in `test/algorithms-test.js` (bekende eigenschappen, zoals "ruis daalt zonder dat de helderheid verschuift" of "voorbeeld en export verschillen < 2%").
3. **Een gevonden fout krijgt eerst een test die faalt**, daarna de oplossing (regressietest).
4. **Voorbeeld en export moeten overeenkomen.** Statistieken die een bewerking meet (achtergrond, mediaan, model) horen in `env.ctx`, zodat ze één keer op het voorbeeld worden gemeten en voor de export en de 100%-uitsnede worden hergebruikt.
5. **NaN en Infinity mogen de pijplijn niet in.** Nieuwe lezers gebruiken `normaliseFloat`/`sanitize`.
6. **Beveiliging van de desktop-app niet afzwakken** (`contextIsolation`, `sandbox`, geen `nodeIntegration`, geen IPC, CSP). `test/electron-security-test.js` bewaakt dit.
7. Teksten in de interface in het Nederlands én Engels (`L('nl', 'en')`).

## Tests

| Bestand | Wat |
|---|---|
| `test/lint.js` | Syntaxis van alle JS-bestanden en projectregels |
| `test/formats-test.js` | FITS/TIFF pixel voor pixel tegen bestanden van onafhankelijke tools (`test/fixtures`) |
| `test/algorithms-test.js` | Numerieke eigenschappen van de algoritmes |
| `test/project-test.js` | Projecten opslaan/laden, beschadigde projecten |
| `test/electron-security-test.js` | Beveiligingsinstellingen van de desktop-app |
| `test/ops-test.js` | Alle bewerkingen, maskers en overvloeimodi (rooktest) |
| `test/stack-test.js` | Sessies combineren |
| `test/ui-test.py` | Volledige workflow in Chrome (Playwright) |

Zie `test/README.md` voor details en voor tests die echte telescoopdata vereisen.

## Pull requests

- Kleine, overzichtelijke wijzigingen; beschrijf wat en waarom.
- `npm test` en de interfacetest slagen (GitHub Actions draait ze automatisch).
- Verander geen versienummer: dat gebeurt bij een release.
- Door bij te dragen ga je akkoord met publicatie onder de MIT-licentie.
