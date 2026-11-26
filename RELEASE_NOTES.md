## What's new in 3.4.0

**Thank you to the testers on Reddit!** Your honest feedback ("none of the automatic modes gives a usable result on my M42") made this release possible. The problem went deeper than expected, and it is now fixed.

### Automatic processing now really works on Dwarf 3 images
- **Faint nebulae and galaxy arms become visible.** Dwarf 3 FITS files have a "pedestal": every pixel sits around 0.078 with only a very small signal above it. Because of that, the automatic stretch set the black point far too low, measured the noise too coarsely and applied its curve too coarsely, so nebulae stayed flat and grey. All three are fixed. On real Dwarf 3 images of the Pelican Nebula (IC 5070) and M31, the nebula structure, spiral arms and dust lanes are now clearly visible with the automatic setting.
- **Bright cores keep their structure.** New *Protect highlights* setting: the core of M42 or a galaxy no longer turns into a white blob.
- **Neutral sky.** No more teal or green cast when a large nebula fills the frame.
- **No dark rings** around nebulae and galaxies.
- **Saturation leaves the empty sky alone**, so no coloured noise in the background.
- **The Milky Way survives** light-pollution removal.
- Object names with numbers (such as IC 5070) are recognised correctly.

### More guidance for beginners
- **Simple mode** is now a guided workflow in six short steps: what is in the photo → automatic edit → brightness and stretch → colour and sky → noise and stars → compare and save.
- Is the detected object wrong? Choose nebula, galaxy, star cluster, Milky Way, Moon, Sun or planet yourself, and tick dual-band filter if you used one.
- **Every slider has a short explanation**, plus tips based on your photo (for example when it is noisy or has light pollution) and warnings when a setting is likely to make the photo worse.
- Nothing is mandatory: open any step directly or show everything at once. Experienced users still have Expert mode.

### Good to know
- Now that faint signal is stretched properly, the edge of a stack can become visible (for example a yellowish band along one side). Crop it off.
- *Starless* is still experimental and can leave blotches around bright stars.
- Tested on two real Dwarf 3 images and six synthetic test scenes; not yet on Seestar or Siril files. Got an image that doesn't come out well? Please open an issue.

All changes are listed in [CHANGELOG.md](https://github.com/Jona2511/AstroPolish/blob/main/CHANGELOG.md).

<!-- nl -->
---

# Nederlands

## Wat is er nieuw in 3.4.0


**Met dank aan de testers op Reddit!** Jullie eerlijke feedback ("geen enkele automatische modus geeft een bruikbaar resultaat op mijn M42") heeft deze versie mogelijk gemaakt. Het probleem zat dieper dan gedacht, en is nu opgelost.

### Automatische bewerking werkt nu echt op Dwarf 3-opnames
- **Zwakke nevels en spiraalarmen worden zichtbaar.** Dwarf 3-FITS-bestanden hebben een "sokkel": alle pixels liggen rond 0,078 met maar een heel klein signaal erboven. De automatische stretch zette het zwartpunt daardoor veel te laag, mat de ruis te grof en paste de curve te grof toe, waardoor nevels vlak en grijs bleven. Alle drie zijn opgelost. Op echte Dwarf 3-opnames van de Pelikaannevel (IC 5070) en M31 zijn de nevelstructuur, spiraalarmen en stofbanen nu duidelijk zichtbaar met de automatische instelling.
- **Heldere kernen houden structuur.** Nieuwe instelling *Hoge lichten sparen*: de kern van M42 of een sterrenstelsel wordt geen witte vlek meer.
- **Neutrale lucht.** Geen blauwgroene of groene zweem meer als een grote nevel het beeld vult.
- **Geen donkere ringen** rond nevels en sterrenstelsels.
- **Verzadiging laat de lege lucht met rust**, dus geen gekleurde ruis in de achtergrond.
- **De Melkweg blijft staan** bij het weghalen van lichtvervuiling.
- Objectnamen met cijfers (zoals IC 5070) worden goed herkend.

### Meer uitleg voor beginners
- De **eenvoudige modus** is nu een begeleide werkwijze in zes korte stappen: wat staat er op de foto → automatische bewerking → helderheid en stretch → kleur en lucht → ruis en sterren → vergelijken en opslaan.
- Klopt het herkende object niet? Kies zelf nevel, sterrenstelsel, sterrenhoop, Melkweg, maan, zon of planeet, en vink een duoband-filter aan.
- **Elk schuifje heeft een korte uitleg**, plus tips op basis van jouw foto (bijvoorbeeld bij veel ruis of lichtvervuiling) en waarschuwingen als een instelling de foto waarschijnlijk slechter maakt.
- Niets is verplicht: open elke stap direct of toon alles tegelijk. Ervaren gebruikers hebben nog steeds de Expert-modus.

### Goed om te weten
- Nu zwak signaal goed wordt uitgerekt, kan de rand van een stack zichtbaar worden (bijvoorbeeld een gelige band langs één kant). Snijd die bij.
- *Sterrenloos* is nog experimenteel en kan vlekken rond felle sterren achterlaten.
- Getest op twee echte Dwarf 3-opnames en zes synthetische testscènes; nog niet op Seestar- of Siril-bestanden. Heb je een opname die er niet goed uitkomt? Laat het weten via een issue.
