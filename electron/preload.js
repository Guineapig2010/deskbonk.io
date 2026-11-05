// Gives the game the same native bridge it uses inside the Swift app (window.webkit.messageHandlers.bonk).
const { ipcRenderer } = require('electron');
const boot = ipcRenderer.sendSync('bonk-boot');
window.__DB_NATIVE__ = { version: boot.version, store: boot.store, jsResize: true, electron: true };
window.webkit = { messageHandlers: { bonk: { postMessage: (msg) => ipcRenderer.send('bonk', msg) } } };
ipcRenderer.on('bonk-event', (_e, payload) => {
  if (window.DB && window.DB.native) window.DB.native._event(payload);
});
