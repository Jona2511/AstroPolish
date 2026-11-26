# Changelog

**English** · [Nederlands](#nederlands)

## Unreleased

Based on feedback from testers on Reddit: none of the automatic modes gave a usable result on a real stacked M42, the stretches were badly tuned (white cores, greenish/teal sky), and beginners need more guidance. The presets and the simple workflow were appreciated, so they stay; this update makes them better.

### Better automatic processing

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

- New `test/presets-test.js` (68 checks, also in CI and `npm test`): six synthetic scenes with known ground truth (M42-like nebula with a bright core, galaxy, star cluster, Milky Way wide field, dual-band nebula, mono) with linear and curved light pollution. It measures sky level and noise, sky colour, faint-detail contrast, core structure, halos, clipping, preview-vs-export difference, and the properties of the new stretch curve.
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

- All tuning and measurements above use **synthetic** images. They have not yet been checked on a broad set of real stacked photos (Dwarf 3, Seestar, Siril output). Real data has different noise, star shapes and colours; feedback with real FITS files is very welcome.
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

**Tests**: nieuwe `test/presets-test.js` (68 controles, ook in CI) met zes synthetische scènes met bekende waarheid; de interfacetest loopt nu door de stappen. Zie de tabel hierboven voor de gemeten voor/na-waarden.

**Beperkingen**: alles is afgesteld en gemeten op **synthetische** beelden en nog niet op een brede set echte opnames. Lichtvervuiling weghalen kan een heel zwakke, beeldvullende nevelhalo deels wegnemen. In HOO kan de zuurstofversterking een felle kern nog wat samendrukken.
