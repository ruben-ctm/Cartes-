/**
 * Hook PASSIF (monde MAIN, document_start), limité par le manifeste à http://127.0.0.1/* —
 * l'application de test de ce projet (`demo-app/`), jamais un autre site. Il observe
 * WebSocket, fetch et XHR et transmet des copies au pont (bridge.js) par postMessage.
 * Il ne modifie, ne retarde et ne bloque aucun message : les données d'origine circulent
 * exactement comme sans l'extension.
 *
 * Enregistrements émis vers bridge.js (même origine, canal interne) :
 *   { type:'frame', t, dir:'in'|'out', kind:'ws'|'http', url, data, … }
 *   { type:'event', t, name:'hook_installed'|'ws_open'|'ws_close', … }
 * `t` = ms epoch haute résolution (performance.timeOrigin + performance.now()).
 */
(() => {
  if (window.__leaklabHook) return;
  window.__leaklabHook = true;

  const CHANNEL = '__leaklab__';
  const MAX_BODY = 2_000_000;
  const now = () => performance.timeOrigin + performance.now();
  const emit = (rec) => {
    try { window.postMessage({ [CHANNEL]: true, rec }, window.location.origin); } catch (_) { /* jamais d'effet sur la page */ }
  };

  // Masque les jetons de session éventuels avant toute émission (prudence générique ;
  // le protocole de démonstration n'en a pas, mais la règle reste utile si le serveur évolue).
  const redact = (u) => String(u).replace(/([?&](?:token|session|sessionToken|access_token|authorization)=)[^&#]*/gi, '$1<redacted>');

  const absolute = (u) => { try { return new URL(u, window.location.href).href; } catch (_) { return String(u); } };
  const sameOrigin = (u) => { try { return new URL(u, window.location.href).origin === window.location.origin; } catch (_) { return false; } };
  const textual = (res) => /json|text|javascript/i.test(res.headers.get('content-type') || '');

  let wsCounter = 0;
  const NativeWS = window.WebSocket;
  const nativeSend = NativeWS.prototype.send;

  const frame = (dir, wsId, url, data) => {
    const rec = { type: 'frame', t: now(), dir, kind: 'ws', wsId, url: redact(url) };
    if (typeof data === 'string') rec.data = data.length > MAX_BODY ? data.slice(0, MAX_BODY) : data;
    else { rec.data = ''; rec.binary = true; rec.size = (data && (data.byteLength || data.size)) || 0; }
    emit(rec);
  };

  function LeaklabWebSocket(url, protocols) {
    const ws = protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols);
    const id = ++wsCounter;
    const shown = redact(url);
    Object.defineProperty(ws, '__leaklabId', { value: id });
    emit({ type: 'event', t: now(), name: 'ws_open', wsId: id, url: shown });
    // Écouteur ajouté avant ceux de l'application : horodatage au plus tôt possible.
    ws.addEventListener('message', (e) => frame('in', id, shown, e.data));
    ws.addEventListener('close', (e) => emit({ type: 'event', t: now(), name: 'ws_close', wsId: id, code: e.code }));
    return ws;
  }
  LeaklabWebSocket.prototype = NativeWS.prototype;
  Object.setPrototypeOf(LeaklabWebSocket, NativeWS);
  window.WebSocket = LeaklabWebSocket;

  NativeWS.prototype.send = function send(data) {
    try { frame('out', this.__leaklabId || 0, this.url, data); } catch (_) { /* ignorer */ }
    return nativeSend.apply(this, arguments);
  };

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function fetch(input, init) {
      const url = absolute(typeof input === 'string' ? input : (input && input.url) || input);
      const method = (init && init.method) || (input && input.method) || 'GET';
      const promise = nativeFetch.apply(this, arguments);
      if (sameOrigin(url)) {
        promise.then((res) => {
          const t = now();
          try {
            if (textual(res)) res.clone().text().then((body) => emit({ type: 'frame', t, dir: 'in', kind: 'http', method, url: redact(url), status: res.status, data: body.slice(0, MAX_BODY) })).catch(() => {});
          } catch (_) { /* ignorer */ }
        }, () => {});
      }
      return promise;
    };
  }

  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const nativeOpen = XHR.open;
    const nativeXhrSend = XHR.send;
    XHR.open = function open(method, url) {
      this.__leaklab = { method, url: absolute(url) };
      return nativeOpen.apply(this, arguments);
    };
    XHR.send = function send() {
      const info = this.__leaklab;
      if (info && sameOrigin(info.url)) {
        this.addEventListener('load', () => {
          try {
            if (this.responseType === '' || this.responseType === 'text') {
              emit({ type: 'frame', t: now(), dir: 'in', kind: 'http', method: info.method, url: redact(info.url), status: this.status, data: String(this.responseText).slice(0, MAX_BODY) });
            }
          } catch (_) { /* ignorer */ }
        });
      }
      return nativeXhrSend.apply(this, arguments);
    };
  }

  emit({ type: 'event', t: now(), name: 'hook_installed', href: redact(window.location.href) });
})();
