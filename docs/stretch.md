# Stretching in AstroPolish

**English** · [Nederlands](#nederlands)

A stacked astrophoto is *linear*: the sky and the faint nebula sit in the bottom one or two percent of the brightness range, so the photo looks almost black. Stretching maps those values to a visible range. It is the single most important step: it decides how much faint detail you see, how dark the sky is and whether bright cores keep their structure.

## Methods

| Method | What it does | When to use |
|---|---|---|
| **Automatic (STF)** *(default)* | A midtone transfer function (MTF), the same curve PixInsight's ScreenTransferFunction uses. The black point is set a few noise-sigmas below the median brightness (in a typical astrophoto that is the sky); the midtone is chosen so the median lands at the *Brightness* target. Applied to luminance with colour preservation. | Almost always. All deep-sky presets use it. |
| Statistical | Same curve, but measured and applied per colour channel, which also neutralises the background colour. | When colours look off after the automatic stretch. |
| Arcsinh | `asinh(k·x)/asinh(k)`: lifts faint signal while compressing bright parts; keeps star colour well. | Star fields, clusters. |
| GHS | Generalized Hyperbolic Stretch with a symmetry point, protection of shadows (LP) and highlights (HP). | Experienced users who want precise control. |
| Logarithmic | Simple log curve. | Quick look. |
| Levels | Black/white point from percentiles, no curve. | Moon, Sun, planets (already bright, not linear). |
| Manual | Your own black point, midtone and white point. | Full control. |

## Settings of the automatic stretch

- **Brightness** — where the sky ends up after the stretch. Higher reveals more faint detail but also more noise and a greyer sky. Usually 0.15–0.25 looks best. The presets use 0.13–0.20 depending on the object.
- **Black point** — how far below the sky level the black point is set (in noise-sigmas). Higher means a darker sky; too high clips faint signal.
- **Protect highlights** (*shoulder*) — new in this version, see below.
- **Colour preservation** — 0 stretches R, G and B separately (colours wash out towards white), 1 stretches luminance only and keeps the colour ratios.

## Protect highlights (the "shoulder")

The plain MTF curve is very steep at the bottom and very flat at the top. That is what makes faint nebula visible, but it also squeezes everything brighter than about 40% of the stretched range into a few percent at the top: the core of M42 or a galaxy becomes a white blob.

The shoulder replaces only the top part of the curve with a logarithmic segment:

- Below a knee the curve is **exactly** the normal MTF, so faint detail and the sky are unchanged (tested: identical up to the knee).
- At the knee the log segment matches the MTF in value **and** slope (C¹-continuous), so there is no visible band or edge.
- Above the knee the log segment rises much more gently, so a 10× brighter core still spreads over a usable range (tested: at least 5× more output range in the core than the plain MTF).
- The curve stays monotone and still maps 0→0 and 1→1.

*Protect highlights* sets where the knee lies: 0 = off (plain MTF), 1 = knee low, strongest protection. The presets use `0.3 + highlightProtect` (0.5–0.8). The control is shown only for the automatic method.

Before this change the presets added a separate *HDR* layer after the stretch to rescue cores. That halved the core contrast again (measured on the synthetic M42 scene: core spread 0.026 → with shoulder 0.069). The HDR layer is still available in Expert mode and is still used for non-automatic stretch methods.

## How the sky level is measured

Background neutralisation in colour calibration depends on knowing the colour of the empty sky. The image is split into tiles; tiles that contain the object or bright stars would raise the estimate. AstroPolish now takes the **darkest 30% of the tiles** (after discarding tiles that are implausibly dark, e.g. stacking borders) and uses their per-channel median. On a synthetic frame where a red nebula covers half the image, this estimate is more than 4× closer to the truth than the whole-image median, which is what prevented the teal/green sky cast reported by testers.

## Order of operations

The automatic edit applies, in order: hot pixels → vignetting → light pollution/gradient → colour calibration → (deconvolution) → **stretch** → noise reduction → stars → local contrast → sharpening → brightness/contrast → saturation → green removal. Gradient removal and colour calibration happen on the *linear* data, where they are physically correct; noise reduction and star work happen after the stretch, where the noise is visible.

## Preview and export

The preview is computed on a downscaled copy. The stretch is measured with statistics that do not depend on the image size, and a test checks that preview and full-resolution export of the automatic, natural and HOO presets differ by less than 2% on average.

---

## Nederlands

Een gestackte astrofoto is *lineair*: de lucht en de zwakke nevel zitten in de onderste een of twee procent van het helderheidsbereik, dus de foto lijkt bijna zwart. Oprekken (stretchen) brengt die waarden naar een zichtbaar bereik. Het is de belangrijkste stap: hij bepaalt hoeveel zwak detail je ziet, hoe donker de lucht is en of heldere kernen hun structuur houden.

**Methoden.** *Automatisch (STF)* is de standaard en wordt door alle deep-sky-presets gebruikt: een middentoon-curve (MTF), met het zwartpunt een paar ruis-sigma's onder de mediaan (meestal de lucht) en de middentoon zo gekozen dat de mediaan op de ingestelde *Helderheid* uitkomt. Daarnaast: statistisch (dezelfde curve per kleurkanaal), arcsinh (sterrenvelden), GHS (precieze controle), logaritmisch, niveaus (maan, zon, planeten) en handmatig.

**Instellingen.** *Helderheid*: waar de lucht uitkomt; hoger toont meer zwak detail maar ook meer ruis (meestal 0,15–0,25). *Zwartpunt*: hoe donker de lucht wordt; te hoog knipt zwakke nevel weg. *Kleurbehoud*: 1 houdt de kleurverhoudingen vast.

**Hoge lichten sparen (de "schouder").** De gewone MTF-curve is onderaan heel steil en bovenaan heel vlak, waardoor de kern van M42 of een sterrenstelsel een witte vlek wordt. De schouder vervangt alleen het bovenste deel van de curve door een logaritmisch stuk. Onder de knik is de curve precies gelijk aan de gewone MTF (zwak detail en lucht veranderen niet); op de knik sluiten waarde én helling naadloos aan (geen zichtbare rand); erboven loopt de curve veel geleidelijker, zodat een felle kern ruim vijf keer zoveel bereik houdt. 0 = uit, 1 = sterkste bescherming; de presets gebruiken 0,5–0,8. Vroeger zetten de presets hiervoor een aparte HDR-laag na de stretch, maar die halveerde het kerncontrast opnieuw (gemeten op de synthetische M42: 0,026 → met schouder 0,069).

**Luchtkleur meten.** Voor het neutraliseren van de achtergrond bij de kleurkalibratie moet de kleur van de lege lucht bekend zijn. Het beeld wordt in tegels verdeeld; AstroPolish neemt nu de **donkerste 30% van de tegels** en daarvan de mediaan per kleurkanaal. Op een synthetisch beeld waar een rode nevel de helft vult, zit dat ruim vier keer dichter bij de waarheid dan de mediaan van het hele beeld. Dat voorkomt de blauwgroene lucht die testers zagen.

**Volgorde.** Hete pixels → vignettering → lichtvervuiling → kleurkalibratie → (deconvolutie) → **stretch** → ruis → sterren → lokaal contrast → verscherpen → helderheid/contrast → verzadiging → groen verwijderen. Gradient en kleur gebeuren op de lineaire data, ruis en sterren na de stretch.

**Voorbeeld en export.** Een test controleert dat voorbeeld en export op volle resolutie voor de presets Automatisch, Natuurlijk en HOO gemiddeld minder dan 2% verschillen.
