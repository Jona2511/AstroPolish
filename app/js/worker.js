/* AstroPolish - background worker so the interface never freezes */
importScripts('engine.js', 'ops.js', 'formats.js', 'stack.js', 'core.js');
const state = {};
const fail = (id, err) => self.postMessage({ cmd: 'error', id, name: err && err.name, message: String((err && err.message) || err), stack: err && err.stack });
self.onmessage = async (e) => {
  const id = e.data && e.data.id;
  try {
    // decoding is asynchronous (deflate TIFF); everything else is synchronous
    const { result, transfer } = e.data.cmd === 'decode' ? await self.AstroCore.decode(e.data) : self.AstroCore.handle(state, e.data);
    result.id = id;
    self.postMessage(result, transfer);
  } catch (err) {
    fail(id, err);
  }
};
