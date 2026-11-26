/* AstroPolish - translations (Dutch / English) */
(function (root) {
  'use strict';
  const T = {
    nl: {
      tagline: "Astrofoto's mooi maken met één klik", newPhoto: 'Nieuwe foto', batch: "Meerdere foto's",
      dropTitle: 'Sleep je astrofoto hierheen', dropOr: 'of', choose: 'Kies een foto',
      formats: 'JPG, PNG, TIFF en FITS · ook gestackte FITS van de Dwarf 3',
      demo: 'Of probeer het eerst met een voorbeeldfoto', step1: 'Foto kiezen', step2: 'Stijl aanklikken', step3: 'Opslaan',
      privacy: "Je foto's blijven op je eigen computer. Er wordt niets geüpload.",
      before: 'Voor', after: 'Na', compare: 'Voor / na', fit: 'Passend', zoom100: '100%', working: 'Bezig…',
      hint: 'Sleep de lijn om voor en na te vergelijken · houd spatie ingedrukt voor het origineel',
      rotate: 'Draai 90°', flipH: 'Spiegel horizontaal', flipV: 'Spiegel verticaal',
      chooseStyle: 'Kies een stijl', quick: 'Snel bijstellen', optional: '(optioneel)', allSettings: 'Alle instellingen',
      reset: 'Terug naar stijl', save: 'Opslaan',
      fmtJpg: 'JPG – deelbaar, kleine bestanden', fmtPng: 'PNG – zonder kwaliteitsverlies', fmtTif: 'TIFF 16-bit – voor verder bewerken',
      saveBtn: 'Foto opslaan', batchTitle: "Meerdere foto's tegelijk",
      batchText: 'Alle foto\'s krijgen de stijl en instellingen die je nu gebruikt. Met de stijl "Automatisch" kiest de app per foto zelf de beste stijl.',
      batchPick: "Foto's kiezen", close: 'Sluiten', batchStart: 'Start',
      // presets
      p_auto: 'Automatisch', p_auto_d: 'Beste keuze voor jouw foto',
      p_nebula: 'Nevel', p_nebula_d: 'Orion, Lagune, Hart…',
      p_galaxy: 'Sterrenstelsel', p_galaxy_d: 'Andromeda, M81, M51…',
      p_cluster: 'Sterrenhoop', p_cluster_d: 'Plejaden, M13…',
      p_milkyway: 'Melkweg / breed', p_milkyway_d: 'Groothoekcamera',
      p_bright: 'Maximaal helder', p_bright_d: 'Zo veel mogelijk zichtbaar',
      p_natural: 'Natuurlijk', p_natural_d: 'Rustig en subtiel',
      p_moon: 'Maan', p_moon_d: 'Scherpe kraters',
      p_moonColour: 'Kleurrijke maan', p_moonColour_d: 'Mineralen zichtbaar',
      p_sun: 'Zon', p_sun_d: 'Alleen met zonnefilter!',
      p_planet: 'Planeet', p_planet_d: 'Jupiter, Saturnus…',
      p_mono: 'Zwart-wit', p_mono_d: 'Klassiek en strak',
      detected: 'Herkend als: {type}', detectedNone: 'Geen object herkend, gekozen voor een algemene stijl.',
      t_nebula: 'nevel', t_galaxy: 'sterrenstelsel', t_cluster: 'sterrenhoop', t_milkyway: 'melkweg / breedbeeld', t_moon: 'maan', t_sun: 'zon', t_planet: 'planeet',
      // quick sliders
      q_brightness: 'Helderheid', q_colour: 'Kleur', q_noise: 'Ruis weghalen', q_detail: 'Details', q_stars: 'Sterren kleiner',
      // groups
      g_prep: 'Voorbewerking', g_colour: 'Kleur', g_light: 'Helderheid & contrast', g_detail: 'Ruis & details',
      s_autoCrop: 'Zwarte randen automatisch wegsnijden', s_hotPixels: 'Hete pixels verwijderen',
      s_gradient: 'Lichtvervuiling / gradient verwijderen', s_gradientDegree: 'Soort gradient',
      deg1: 'Eenvoudig (scheef)', deg2: 'Normaal', deg3: 'Complex', deg4: 'Zeer complex',
      s_neutralize: 'Achtergrond neutraal grijs maken', s_whiteBalance: 'Automatische witbalans (op sterren)',
      s_temperature: 'Kleurtemperatuur (blauw ↔ warm)', s_tint: 'Tint (groen ↔ paars)', s_saturation: 'Kleurverzadiging',
      s_vibrance: 'Levendigheid (zwakke kleuren)', s_scnr: 'Groene zweem verwijderen', s_mono: 'Zwart-wit',
      s_stretchMode: 'Methode', mode_auto: 'Deep-sky (automatisch oprekken)', mode_levels: 'Maan / zon / planeet (niveaus)',
      s_brightness: 'Helderheid', s_blackPoint: 'Zwartpunt (achtergrond donkerder)', s_colorPreserve: 'Kleurbehoud bij oprekken',
      s_highlightProtect: 'Felle delen beschermen (kern)', s_contrast: 'Contrast',
      s_denoise: 'Ruisonderdrukking', s_chromaDenoise: 'Kleurruis weghalen', s_starReduce: 'Sterren verkleinen',
      s_localContrast: 'Lokaal contrast (structuur)', s_sharpen: 'Verscherpen',
      // messages
      loading: 'Foto laden…', processing: 'Foto in volle resolutie bewerken…', saving: 'Opslaan…', saved: 'Opgeslagen: {name}',
      loadError: 'Deze foto kan niet worden geopend: {msg}', makingDemo: 'Voorbeeldfoto maken…',
      batchWaiting: 'wacht', batchBusy: 'bezig…', batchDone: 'klaar', batchError: 'fout', batchAllDone: "Klaar! {n} foto's opgeslagen.",
      batchFolder: "Kies een map waarin de foto's worden opgeslagen",
      help: `<h2>Zo werkt AstroPolish</h2>
<ol class="help-steps"><li><b>Kies een foto.</b> Sleep hem in het venster of klik op <i>Kies een foto</i>.</li>
<li><b>Klik op een stijl.</b> <i>Automatisch</i> kijkt naar de bestandsnaam (bijv. <code>M 42</code>) en naar de foto zelf, en kiest de beste stijl.</li>
<li><b>Opslaan.</b> Kies JPG om te delen, of TIFF 16-bit als je later nog verder wilt bewerken.</li></ol>
<h3>Tips voor de Dwarf 3</h3>
<ul><li>Gebruik als het kan het gestackte <b>FITS</b>-bestand (<code>stacked…fits</code>). Daar zit veel meer detail in dan in de JPG.</li>
<li>Komt een FITS ondersteboven binnen? Gebruik de knop ⇵.</li>
<li>Zie je nog een kleurverloop? Zet bij <i>Alle instellingen</i> de soort gradient op <i>Complex</i>.</li>
<li>Bij foto's met de duoband-filter kun je <i>Groene zweem verwijderen</i> beter laag zetten, anders verdwijnt de blauwgroene OIII-kleur.</li></ul>
<h3>Wat doet de app?</h3>
<p>Hij verwijdert randen van het stacken, hete pixels en lichtvervuiling, maakt de achtergrond neutraal, kalibreert kleuren op de sterren, rekt het beeld zo helder mogelijk op zonder de achtergrond grijs te maken, haalt ruis weg, verkleint sterren, versterkt structuur en verzadigt de kleuren.</p>
<h3>Sneltoetsen</h3>
<p><kbd>Spatie</kbd> ingedrukt houden: origineel · <kbd>Ctrl</kbd>+<kbd>S</kbd>: opslaan · <kbd>Ctrl</kbd>+<kbd>O</kbd>: foto openen</p>
<p class="muted">AstroPolish is gratis en open source. Je foto's verlaten je computer nooit.</p>`,
    },
    en: {
      tagline: 'Beautiful astrophotos in one click', newPhoto: 'New photo', batch: 'Multiple photos',
      dropTitle: 'Drop your astrophoto here', dropOr: 'or', choose: 'Choose a photo',
      formats: 'JPG, PNG, TIFF and FITS · including stacked FITS from the Dwarf 3',
      demo: 'Or try it first with a sample photo', step1: 'Choose photo', step2: 'Click a style', step3: 'Save',
      privacy: 'Your photos stay on your own computer. Nothing is uploaded.',
      before: 'Before', after: 'After', compare: 'Before / after', fit: 'Fit', zoom100: '100%', working: 'Working…',
      hint: 'Drag the line to compare before and after · hold space to see the original',
      rotate: 'Rotate 90°', flipH: 'Flip horizontal', flipV: 'Flip vertical',
      chooseStyle: 'Choose a style', quick: 'Quick adjust', optional: '(optional)', allSettings: 'All settings',
      reset: 'Back to style', save: 'Save',
      fmtJpg: 'JPG – easy to share, small files', fmtPng: 'PNG – lossless', fmtTif: 'TIFF 16-bit – for further editing',
      saveBtn: 'Save photo', batchTitle: 'Multiple photos at once',
      batchText: 'All photos get the style and settings you are using now. With the "Automatic" style the app picks the best style for each photo.',
      batchPick: 'Choose photos', close: 'Close', batchStart: 'Start',
      p_auto: 'Automatic', p_auto_d: 'Best choice for your photo',
      p_nebula: 'Nebula', p_nebula_d: 'Orion, Lagoon, Heart…',
      p_galaxy: 'Galaxy', p_galaxy_d: 'Andromeda, M81, M51…',
      p_cluster: 'Star cluster', p_cluster_d: 'Pleiades, M13…',
      p_milkyway: 'Milky Way / wide', p_milkyway_d: 'Wide-angle camera',
      p_bright: 'Maximum bright', p_bright_d: 'Show as much as possible',
      p_natural: 'Natural', p_natural_d: 'Calm and subtle',
      p_moon: 'Moon', p_moon_d: 'Crisp craters',
      p_moonColour: 'Colourful moon', p_moonColour_d: 'Shows minerals',
      p_sun: 'Sun', p_sun_d: 'Only with a solar filter!',
      p_planet: 'Planet', p_planet_d: 'Jupiter, Saturn…',
      p_mono: 'Black & white', p_mono_d: 'Classic and clean',
      detected: 'Recognised as: {type}', detectedNone: 'No object recognised, using a general style.',
      t_nebula: 'nebula', t_galaxy: 'galaxy', t_cluster: 'star cluster', t_milkyway: 'Milky Way / wide field', t_moon: 'moon', t_sun: 'sun', t_planet: 'planet',
      q_brightness: 'Brightness', q_colour: 'Colour', q_noise: 'Remove noise', q_detail: 'Detail', q_stars: 'Smaller stars',
      g_prep: 'Pre-processing', g_colour: 'Colour', g_light: 'Brightness & contrast', g_detail: 'Noise & detail',
      s_autoCrop: 'Automatically crop black borders', s_hotPixels: 'Remove hot pixels',
      s_gradient: 'Remove light pollution / gradient', s_gradientDegree: 'Gradient type',
      deg1: 'Simple (tilted)', deg2: 'Normal', deg3: 'Complex', deg4: 'Very complex',
      s_neutralize: 'Make background neutral grey', s_whiteBalance: 'Automatic white balance (on stars)',
      s_temperature: 'Colour temperature (blue ↔ warm)', s_tint: 'Tint (green ↔ magenta)', s_saturation: 'Saturation',
      s_vibrance: 'Vibrance (weak colours)', s_scnr: 'Remove green cast', s_mono: 'Black & white',
      s_stretchMode: 'Method', mode_auto: 'Deep-sky (automatic stretch)', mode_levels: 'Moon / sun / planet (levels)',
      s_brightness: 'Brightness', s_blackPoint: 'Black point (darker background)', s_colorPreserve: 'Preserve colour while stretching',
      s_highlightProtect: 'Protect bright areas (core)', s_contrast: 'Contrast',
      s_denoise: 'Noise reduction', s_chromaDenoise: 'Remove colour noise', s_starReduce: 'Reduce stars',
      s_localContrast: 'Local contrast (structure)', s_sharpen: 'Sharpen',
      loading: 'Loading photo…', processing: 'Processing at full resolution…', saving: 'Saving…', saved: 'Saved: {name}',
      loadError: 'This photo cannot be opened: {msg}', makingDemo: 'Creating sample photo…',
      batchWaiting: 'waiting', batchBusy: 'working…', batchDone: 'done', batchError: 'error', batchAllDone: 'Done! {n} photos saved.',
      batchFolder: 'Choose a folder to save the photos in',
      help: `<h2>How AstroPolish works</h2>
<ol class="help-steps"><li><b>Choose a photo.</b> Drop it on the window or click <i>Choose a photo</i>.</li>
<li><b>Click a style.</b> <i>Automatic</i> looks at the file name (e.g. <code>M 42</code>) and the photo itself and picks the best style.</li>
<li><b>Save.</b> Choose JPG to share, or 16-bit TIFF if you want to keep editing.</li></ol>
<h3>Tips for the Dwarf 3</h3>
<ul><li>If possible use the stacked <b>FITS</b> file (<code>stacked…fits</code>). It holds much more detail than the JPG.</li>
<li>FITS shows upside down? Use the ⇵ button.</li>
<li>Still a colour gradient? Under <i>All settings</i> set the gradient type to <i>Complex</i>.</li>
<li>With the dual-band filter keep <i>Remove green cast</i> low, or the teal OIII colour disappears.</li></ul>
<h3>What does it do?</h3>
<p>It removes stacking borders, hot pixels and light pollution, neutralises the background, calibrates colour on the stars, stretches the image as bright as possible without a grey background, reduces noise, shrinks stars, enhances structure and boosts colour.</p>
<h3>Shortcuts</h3>
<p>Hold <kbd>Space</kbd>: original · <kbd>Ctrl</kbd>+<kbd>S</kbd>: save · <kbd>Ctrl</kbd>+<kbd>O</kbd>: open photo</p>
<p class="muted">AstroPolish is free and open source. Your photos never leave your computer.</p>`,
    },
  };
  let lang = 'nl';
  try { lang = localStorage.getItem('ap-lang') || ((navigator.language || 'nl').toLowerCase().startsWith('nl') ? 'nl' : 'en'); } catch (e) { /* storage may be blocked */ }
  if (!T[lang]) lang = 'nl';
  function t(key, vars) {
    let s = (T[lang] && T[lang][key]) || T.nl[key] || key;
    if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
    return s;
  }
  function setLang(l) { lang = T[l] ? l : 'nl'; try { localStorage.setItem('ap-lang', lang); } catch (e) { /* ignore */ } }
  function getLang() { return lang; }
  root.I18N = { t, setLang, getLang };
})(typeof self !== 'undefined' ? self : this);
