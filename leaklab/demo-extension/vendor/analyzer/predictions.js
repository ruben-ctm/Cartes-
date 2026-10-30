/**
 * Extraction de « prédictions » : pour une trame, toutes les façons dont une valeur
 * pourrait désigner le bon choix d'une question, SANS connaître le nom des champs.
 *
 * Une prédiction = { q, template, variant, predicted, path }
 *   - template : chemin générique du champ (indices de tableau remplacés par `[]`,
 *                couches décodées signalées par `~json` / `~b64` / `~b64json`) ;
 *   - variant  : hypothèse testée sur ce champ (voir plus bas) ;
 *   - predicted: index du choix désigné selon cette hypothèse.
 *
 * Hypothèses :
 *   scalaires   index0 / index1   la valeur est l'index (base 0 ou 1) du bon choix
 *               enc:<via>         la valeur est le texte/index encodé (hash…) d'un choix
 *   tableaux de la taille des choix (un élément par choix)
 *               array:flag        un seul élément « vrai » parmi des booléens/0-1
 *               array:odd         un seul élément diffère des autres (k ≥ 3)
 *
 * Association à une question : par la position dans un tableau de la taille du quiz
 * (cas d'une définition complète du quiz) sinon par la question en cours (`contextQ`).
 */

import { decodeEmbedded } from './payload.js';

const MAX_DEPTH = 10;
const isObject = (v) => v !== null && typeof v === 'object';
const isScalar = (v) => !isObject(v);

const FLAGS = new Set([true, false, 'true', 'false', 0, 1]);
const isTrue = (v) => v === true || v === 'true' || v === 1;

function elementLeaves(el, rel = '', depth = 0, acc = new Map()) {
  if (isScalar(el)) { acc.set(rel, el); return acc; }
  if (Array.isArray(el) || depth > 3) return acc;
  for (const [k, v] of Object.entries(el)) elementLeaves(v, `${rel}.${k}`, depth + 1, acc);
  return acc;
}

function oddOneOut(values) {
  const counts = new Map();
  values.forEach((v) => counts.set(JSON.stringify(v), (counts.get(JSON.stringify(v)) ?? 0) + 1));
  if (counts.size !== 2) return -1;
  const single = [...counts].find(([, c]) => c === 1);
  if (!single) return -1;
  return values.findIndex((v) => JSON.stringify(v) === single[0]);
}

/**
 * @param {object} args
 * @param {*} args.root        charge utile parsée de la trame
 * @param {number|null} args.contextQ question en cours au moment de la trame
 * @param {{byQ: Map<number,{correctIndex:number,choices:string[]}>, count:number}} args.truth
 * @param {{lookup:Function}} args.encoder
 */
export function extractPredictions({ root, contextQ, truth, encoder }) {
  const out = [];
  const kOf = (q) => truth.byQ.get(q)?.choices.length ?? null;

  const emit = (q, template, variant, predicted, path) => {
    const k = kOf(q);
    if (k !== null && Number.isInteger(predicted) && predicted >= 0 && predicted < k) {
      out.push({ q, template, variant, predicted, path });
    }
  };

  function scalar(value, q, path, template) {
    if (q === null || kOf(q) === null) return;
    let num = null;
    if (typeof value === 'number' && Number.isInteger(value)) num = value;
    else if (typeof value === 'string' && /^\d{1,3}$/.test(value.trim())) num = Number(value);
    if (num !== null) {
      emit(q, template, 'index0', num, path);
      emit(q, template, 'index1', num - 1, path);
    } else if (typeof value === 'string') {
      for (const hit of encoder.lookup(q, value)) emit(q, template, `enc:${hit.via}`, hit.index, path);
    }
  }

  function choiceArray(arr, q, path, template) {
    const leaves = arr.map((el) => elementLeaves(el));
    const rels = [...leaves[0].keys()].filter((rel) => leaves.every((m) => m.has(rel)));
    for (const rel of rels) {
      const values = leaves.map((m) => m.get(rel));
      if (values.every((v) => FLAGS.has(v)) && values.filter(isTrue).length === 1) {
        emit(q, `${template}[]${rel}`, 'array:flag', values.findIndex(isTrue), `${path}[*]${rel}`);
      }
      if (values.length >= 3) emit(q, `${template}[]${rel}`, 'array:odd', oddOneOut(values), `${path}[*]${rel}`);
    }
  }

  function visit(node, path, template, q, depth) {
    if (depth > MAX_DEPTH) return;
    if (typeof node === 'string') {
      const decoded = decodeEmbedded(node);
      if (decoded) visit(decoded.value, `${path}~${decoded.tag}`, `${template}~${decoded.tag}`, q, depth + 1);
      else scalar(node, q, path, template);
    } else if (isScalar(node)) {
      scalar(node, q, path, template);
    } else if (Array.isArray(node)) {
      if (q !== null && node.length === kOf(q)) {
        choiceArray(node, q, path, template);
      } else if (node.length === truth.count && node.length > 1 && node.every(isObject)) {
        node.forEach((el, i) => visit(el, `${path}[${i}]`, `${template}[]`, i, depth + 1));
      } else {
        node.forEach((el, i) => visit(el, `${path}[${i}]`, `${template}[]`, q, depth + 1));
      }
    } else {
      for (const [key, value] of Object.entries(node)) visit(value, `${path}.${key}`, `${template}.${key}`, q, depth + 1);
    }
  }

  visit(root, '', '', contextQ, 0);
  return out;
}
