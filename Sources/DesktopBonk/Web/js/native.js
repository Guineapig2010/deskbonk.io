// Bridge to the macOS host (WKWebView message handler "bonk") with a browser fallback.
// Persistent data lives in ~/Library/Application Support/DesktopBonk/store.json on macOS
// (injected at document start as window.__DB_NATIVE__.store), or localStorage in a browser.
(function (root) {
  'use strict';
  const DB = root.DB;
  const boot = root.__DB_NATIVE__ || null;
  const handler = root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.bonk;
  const isNative = !!handler;

  const N = DB.native = {
    isNative,
    version: boot && boot.version ? boot.version : 'web',
    jsResize: !!(boot && boot.jsResize),
    electron: !!(boot && boot.electron),
    listeners: [],
    post(type, data) {
      if (!isNative) return false;
      try { handler.postMessage(Object.assign({ type }, data || {})); return true; } catch (e) { return false; }
    },
    on(fn) { this.listeners.push(fn); },
    // called by the host via evaluateJavaScript("DB.native._event({...})")
    _event(e) { for (const fn of this.listeners) { try { fn(e); } catch (err) { console.error(err); } } },
  };

  // ---- key/value store ---------------------------------------------------------------
  const mem = Object.assign({}, boot && boot.store ? boot.store : {});
  DB.store = {
    get(key, fallback) {
      let raw = null;
      if (isNative) raw = mem[key] != null ? mem[key] : null;
      else { try { raw = root.localStorage ? root.localStorage.getItem('deskbonk.' + key) : null; } catch (e) { raw = null; } }
      if (raw == null) return fallback;
      try { return JSON.parse(raw); } catch (e) { return fallback; }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      if (isNative) { mem[key] = raw; N.post('store', { key, value: raw }); }
      else { try { root.localStorage && root.localStorage.setItem('deskbonk.' + key, raw); } catch (e) { /* private mode */ } }
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
