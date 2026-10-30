/**
 * Décodage des « couches » d'un message : les protocoles de type CometD/Bayeux
 * transportent souvent du JSON sérialisé dans une chaîne, et les valeurs peuvent
 * être encodées en base64. Ces fonctions révèlent la structure sans connaître les champs.
 */

const B64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;
const PRINTABLE_RE = /^[\x20-\x7e]+$/;

function tryJson(text) {
  const t = text.trim();
  if (t.length < 2 || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

function b64decode(s) {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  try { return atob(std); } catch { return null; }
}

/**
 * Tente de décoder une chaîne. Retourne `{ tag, value }` ou `null`.
 *  - tag `json`    : la chaîne est du JSON ;
 *  - tag `b64`     : base64 d'un petit entier (ex. un index) → `value` numérique ;
 *  - tag `b64json` : base64 d'un document JSON.
 */
export function decodeEmbedded(str) {
  const json = tryJson(str);
  if (json !== undefined) return { tag: 'json', value: json };
  if (str.length >= 4 && str.length % 4 === 0 && B64_RE.test(str)) {
    const decoded = b64decode(str);
    if (decoded && PRINTABLE_RE.test(decoded)) {
      if (/^\d{1,3}$/.test(decoded)) return { tag: 'b64', value: Number(decoded) };
      const inner = tryJson(decoded);
      if (inner !== undefined) return { tag: 'b64json', value: inner };
    }
  }
  return null;
}

/** Analyse la charge utile brute d'une trame (chaîne JSON ou objet déjà parsé). */
export function parseRoot(data) {
  if (typeof data !== 'string') return data;
  const json = tryJson(data);
  return json !== undefined ? json : data;
}
