/* AstroPolish - background worker so the interface never freezes */
importScripts('engine.js', 'formats.js', 'stack.js', 'core.js');
const state = {};
self.onmessage = (e) => {
  try {
    const { result, transfer } = self.AstroCore.handle(state, e.data);
    result.id = e.data.id;
    self.postMessage(result, transfer);
  } catch (err) {
    self.postMessage({ cmd: 'error', id: e.data && e.data.id, message: String(err && err.message || err) });
  }
};
