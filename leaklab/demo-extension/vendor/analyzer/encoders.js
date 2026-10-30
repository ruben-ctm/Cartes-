/**
 * Encodages « avant » : pour chaque question dont on connaît la clé (côté hôte),
 * on calcule les formes encodées plausibles de chaque choix (index et texte) :
 * identité, md5, sha1, sha256. Une valeur observée qui égale l'une de ces formes
 * révèle quel choix elle désigne — même si le champ porte un nom opaque.
 * (Les encodages réversibles, ex. base64, sont traités à la lecture, dans payload.js.)
 */

const HEX_RE = /^[0-9a-f]{32,64}$/i;

export function createEncoder(hashers, truth) {
  const tables = new Map(); // q → Map<valeur encodée, [{ index, via }]>

  function build(q) {
    const entry = truth.byQ.get(q);
    const table = new Map();
    if (!entry) return table;
    const add = (value, index, via) => {
      const list = table.get(value) ?? [];
      list.push({ index, via });
      table.set(value, list);
    };
    entry.choices.forEach((text, i) => {
      const textForms = [['text', text], ['text~norm', text.trim().toLowerCase()]];
      const indexForms = [['index0', String(i)], ['index1', String(i + 1)]];
      for (const [label, form] of [...textForms, ...indexForms]) {
        if (label.startsWith('text')) add(form, i, label);
        for (const [hname, hfn] of Object.entries(hashers)) add(hfn(form), i, `${hname}(${label})`);
      }
    });
    return table;
  }

  return {
    /** Choix désignés par la valeur `value` pour la question `q` : `[{ index, via }]`. */
    lookup(q, value) {
      if (typeof value !== 'string') return [];
      if (!tables.has(q)) tables.set(q, build(q));
      const table = tables.get(q);
      const direct = table.get(value);
      if (direct) return direct;
      return HEX_RE.test(value) ? table.get(value.toLowerCase()) ?? [] : [];
    },
  };
}
