// Texts for the native dialogs of the Electron main process (no Electron imports, so they can be unit-tested).
// The app itself is translated in app/js/i18n.js; these dialogs follow the language the app is shown in.
const CLOSE_DIALOG = {
  nl: {
    buttons: ['Toch sluiten', 'Annuleren'],
    message: 'Er zijn bewerkingen die nog niet zijn geëxporteerd of als project opgeslagen.',
    detail: 'Wil je AstroPolish toch sluiten? Niet-opgeslagen bewerkingen gaan dan verloren.',
  },
  en: {
    buttons: ['Close anyway', 'Cancel'],
    message: 'Some edits have not been exported or saved as a project yet.',
    detail: 'Do you still want to close AstroPolish? Unsaved edits will be lost.',
  },
};

// Same rule as the app: Dutch for 'nl' / 'nl-NL' and so on, English for everything else.
function dialogLang(lang) { return String(lang || '').toLowerCase().startsWith('nl') ? 'nl' : 'en'; }

function closeDialogText(lang) { return CLOSE_DIALOG[dialogLang(lang)]; }

module.exports = { dialogLang, closeDialogText, CLOSE_DIALOG };
