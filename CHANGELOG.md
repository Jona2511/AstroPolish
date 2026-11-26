# Changelog

**English** · [Nederlands](#nederlands)

## Unreleased

Based on feedback from testers on Reddit: none of the automatic modes gave a usable result on a real stacked M42, the stretches were badly tuned (white cores, greenish/teal sky), and beginners need more guidance. The presets and the simple workflow were appreciated, so they stay; this update makes them better.

### Better automatic processing

- **Fixed: faint nebulae and galaxy arms stayed flat and grey on Dwarf 3 FITS files.** This was the main cause of "no automatic mode gives a usable result". Dwarf stacks put every pixel on a pedestal (about 0.078) with a very small signal range above it (sky noise about 0.00005). On such data the automatic stretch:
  - set the black point about 20 noise-sigmas below the sky (the old limit was 98% of the median) instead of about 3;
  - measured the sky noise with a histogram that was too coarse (the noise was only 2–3 bins wide);
  - stored its curve in a table where the whole sky-to-nebula range fell into 2–3 steps.

  All three are fixed. On two real Dwarf 3 stacks (M31, 3.9 h, and the Pelican Nebula IC 5070, 43 min) the galaxy arms, dust lanes and the Pelican's structure are now clearly visible with the automatic preset; before, the Pelican was barely visible in any preset. A new test simulates this kind of data: faint detail now comes out at 100% of the same scene without a pedestal, against about 5% with the old code.
- **Object names with numbers** are read correctly (e.g. *IC 5070* instead of *IC 5*).
- **Bright cores keep their structure.** The automatic stretch has a new *Protect highlights* setting (a logarithmic "shoulder" at the top of the curve). Faint detail is unchanged; bright cores such as M42 or a galaxy nucleus no longer turn into a white blob. The presets no longer add a separate HDR layer after the stretch, which used to flatten the core a second time. See [docs/stretch.md](docs/stretch.md).
- **Neutral sky colour.** The sky colour used for background neutralisation is now measured on the darkest 30% of the image tiles. Before, a large nebula could pull the estimate and give the whole sky a teal or green cast.
- **No dark rings around nebulae and galaxies.** Local contrast now uses an edge-aware (guided) filter instead of a plain blur.
- **Saturation leaves the empty sky alone,** so a higher saturation no longer adds coloured noise to the background.
- **The Milky Way survives light-pollution removal.** The Milky Way preset now models the sky gradient with a straight plane instead of a grid/curved surface, which used to remove more than half of the faint band.
- **Calmer default brightness.** All deep-sky presets stretch about 20% less, so the sky is darker and less noisy and faint detail stands out more clearly against it. Every value can still be changed.

### Guided simple mode

- Six short steps: what is in the photo → automatic edit → brightness and stretch → colour and sky → noise and stars → compare and save. See [docs/simple-mode.md](docs/simple-mode.md).
- You can correct the detected object type (nebula, galaxy, star cluster, Milky Way, Moon, Sun, planet) and mark a dual-band filter.
- Every control has a one-line explanation, plus tips based on your photo and warnings when a value is likely to make it worse.
- Not a forced wizard: open any step directly or show all steps at once.
- New simple controls: *Black point* and *Protect bright areas*.

### Tests

- New `test/presets-test.js` (75 checks, also in CI and `npm test`): six synthetic scenes with known ground truth (M42-like nebula with a bright core, galaxy, star cluster, Milky Way wide field, dual-band nebula, mono) with linear and curved light pollution. It measures sky level and noise, sky colour, faint-detail contrast, core structure, halos, clipping, preview-vs-export difference, and the properties of the new stretch curve.
- The UI test now walks through the guided steps, checks a warning and the object-type selection.

### Measured before/after (synthetic scenes, automatic preset; Milky Way preset for the wide field)

| Scene | What | Before | After |
|---|---|---|---|
| M42-like | core structure (spread in the core, higher is better) | 0.026 | 0.069 |
| M42-like | sky colour cast (lower is better) | 0.023 | 0.005 |
| M42-like | dark ring around the nebula (lower is better) | 0.007 | 0.004 |
| M42-like | sky level / sky noise | 0.219 / 0.039 | 0.169 / 0.032 |
| Milky Way | faint band contrast-to-noise (higher is better) | 1.46 | 4.48 |
| Dual-band | sky colour cast | 0.022 | 0.014 |
| Mono | core structure | 0.047 | 0.080 |

Honest notes: faint detail is a little darker in absolute terms because the whole image is stretched less (its contrast against the noise went *up* in every scene). On the galaxy and star-cluster scenes the remaining sky colour cast went up slightly (0.004 → 0.007 and 0.005 → 0.008), still well below a visible level. Side-by-side images: [docs/before-after-synthetic.jpg](docs/before-after-synthetic.jpg).

### Limitations

- Tested on real data: two Dwarf 3 stacks (M31 and IC 5070), automatic, natural, bright, starless and HOO presets; preview and full-resolution export differ by less than 1%. Not yet tested on Seestar, Siril or other camera output.
- The weak edge of a stack (fewer frames near the border) becomes visible now that faint signal is stretched properly, for example a yellowish band along one side. Crop it off.
- *Starless* (morphological star removal) leaves blotches and rings around bright stars on real data, and can make a galaxy core look odd. It remains experimental.
- Light-pollution removal on a nebula can still remove part of a very faint halo that fills the whole frame (about a third in the synthetic test). Lower *Remove light pollution* if that happens.
- In the HOO palette the oxygen boost is applied after the stretch and can still compress a bright core somewhat.

---

## Nederlands

### Nog niet uitgebracht

Naar aanleiding van feedback van testers op Reddit: geen enkele automatische modus gaf een bruikbaar resultaat op een echte gestackte M42, de stretches waren slecht afgesteld (witte kernen, groenige/blauwgroene lucht) en beginners hebben meer begeleiding nodig.

**Betere automatische bewerking**
- **Heldere kernen houden structuur** dankzij de nieuwe instelling *Hoge lichten sparen* in de automatische stretch (een logaritmische "schouder" bovenaan de curve). De aparte HDR-laag na de stretch, die de kern nog eens platdrukte, is uit de presets gehaald.
- **Neutrale lucht**: de luchtkleur wordt nu gemeten op de donkerste 30% van de beeldtegels, zodat een grote nevel de lucht niet meer blauwgroen kleurt.
- **Geen donkere ringen** rond nevels en sterrenstelsels: lokaal contrast gebruikt nu een randbewust filter.
- **Verzadiging laat de lege lucht met rust.**
- **De Melkweg blijft staan** bij het weghalen van lichtvervuiling (vlak model in plaats van een raster).
- **Rustigere standaardhelderheid**: de deep-sky-presets rekken ongeveer 20% minder op; donkerdere, rustigere lucht. Alles blijft instelbaar.

**Begeleide eenvoudige modus**: zes korte stappen, objecttype zelf te verbeteren, uitleg bij elk schuifje, tips op basis van je foto en waarschuwingen bij waarden die de foto slechter maken. Geen verplichte wizard. Nieuwe schuifjes: *Zwartpunt* en *Felle delen sparen*.

**Tests**: nieuwe `test/presets-test.js` (75 controles, ook in CI) met zes synthetische scènes met bekende waarheid; de interfacetest loopt nu door de stappen. Zie de tabel hierboven voor de gemeten voor/na-waarden.

**Opgelost: zwakke nevels en spiraalarmen bleven vlak en grijs bij Dwarf 3-FITS.** Dwarf-stacks hebben een sokkel (~0,078) met een heel klein signaalbereik. Het zwartpunt lag daardoor ~20 ruis-sigma te laag, de ruismeting was te grof en de stretchtabel te grof. Alle drie zijn opgelost. Op twee echte Dwarf 3-opnames (M31 en de Pelikaannevel IC 5070) zijn armen, stofbanen en de nevelstructuur nu duidelijk zichtbaar. Objectnamen met cijfers (IC 5070) worden goed gelezen.

**Beperkingen**: getest op synthetische beelden en twee echte Dwarf 3-opnames, nog niet op Seestar/Siril. De zwakke rand van een stack kan zichtbaar worden (bijsnijden). *Sterrenloos* laat op echte data vlekken rond felle sterren achter. Lichtvervuiling weghalen kan een heel zwakke, beeldvullende nevelhalo deels wegnemen. In HOO kan de zuurstofversterking een felle kern nog wat samendrukken.
