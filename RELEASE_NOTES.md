## Wat is er nieuw in 3.4.0

**Met dank aan de testers op Reddit!** Jullie eerlijke feedback ("geen enkele automatische modus geeft een bruikbaar resultaat op mijn M42") heeft deze versie mogelijk gemaakt. Het probleem zat dieper dan gedacht, en is nu opgelost.

### Automatische bewerking werkt nu echt op Dwarf 3-opnames
- **Zwakke nevels en spiraalarmen worden zichtbaar.** Dwarf 3-FITS-bestanden hebben een "sokkel": alle pixels liggen rond 0,078 met maar een heel klein signaal erboven. De automatische stretch zette het zwartpunt daardoor veel te laag, mat de ruis te grof en rekte de curve te grof uit, waardoor nevels vlak en grijs bleven. Alle drie zijn opgelost. Op een echte Dwarf 3-opname van de Pelikaannevel (IC 5070) en van M31 zijn de nevelstructuur, spiraalarmen en stofbanen nu duidelijk zichtbaar met de automatische instelling.
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

Alle wijzigingen staan in [CHANGELOG.md](https://github.com/Jona2511/AstroPolish/blob/main/CHANGELOG.md).

---
