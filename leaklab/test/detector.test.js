import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../analyzer/index.js';
import { simulate } from '../lab/simulator.js';
import { PROFILES } from '../lab/profiles.js';

const OFFICIAL = /correctChoices/; // divulgation légitime à l'événement de résultat
const early = (r) => r.candidates.filter((c) => c.worstPhase !== 'post_correction');

for (const id of Object.keys(PROFILES)) {
  test(`${id} : verdict et phase attendus`, () => {
    const r = analyze(simulate({ profile: id, seed: 1 }));
    assert.equal(r.verdict, PROFILES[id].expected.verdict);
    assert.equal(r.worstPhase, PROFILES[id].expected.worstPhase);
    assert.equal(r.questionsAnalyzed, 12);
  });
}

test('L0 (témoin) : seule la divulgation officielle est trouvée, jamais plus tôt', () => {
  const r = analyze(simulate({ profile: 'L0' }));
  assert.equal(early(r).length, 0);
  assert.equal(r.candidates.length, 1);
  assert.match(r.candidates[0].template, OFFICIAL);
  assert.equal(r.candidates[0].worstPhase, 'post_correction');
});

test('L1 : le drapeau est localisé dans la trame de question, lisible à t = 0', () => {
  const r = analyze(simulate({ profile: 'L1' }));
  const flag = r.candidates.find((c) => c.variant === 'array:flag');
  assert.match(flag.template, /choices\[\]\.correct$/);
  assert.equal(flag.hits, 12);
  assert.equal(flag.medianDtFromQuestionMs, 0);
  assert.ok(flag.medianLeadToAnswerMs > 2000, 'le joueur a plusieurs secondes d’avance');
  assert.ok(flag.perQuestion.every((h) => h.phase === 'pre_answer' && h.dtFromRenderMs < 0));
});

test('L2 : index base64 ET md5 du texte sont retrouvés sous des noms opaques', () => {
  const r = analyze(simulate({ profile: 'L2' }));
  const variants = early(r).map((c) => `${c.template}|${c.variant}`);
  assert.ok(variants.some((v) => v.endsWith('meta.ref~b64|index0')), variants.join('\n'));
  assert.ok(variants.some((v) => v.endsWith('meta.sig|enc:md5(text)')), variants.join('\n'));
  assert.equal(early(r).length, 2, 'le champ leurre `build` ne doit pas ressortir');
});

test('L3 : fuite REST détectée avant l’apparition de toutes les questions', () => {
  const r = analyze(simulate({ profile: 'L3' }));
  for (const c of early(r)) {
    assert.equal(c.phases.pre_question, c.hits);
    assert.ok(c.perQuestion.every((h) => h.dtFromQuestionMs < 0 && h.leadToAnswerMs > 0));
  }
  assert.ok(early(r).some((c) => /^\.questions\[\]\.choices\[\]\.correct$/.test(c.template)));
});

test('L4 : fuite après la réponse, avant la correction', () => {
  const r = analyze(simulate({ profile: 'L4' }));
  const [c] = early(r);
  assert.equal(c.worstPhase, 'post_answer');
  assert.equal(c.ambiguous, false);
  assert.ok(c.perQuestion.every((h) => h.leadToAnswerMs < 0 && h.leadToResultMs > 5000));
});

test('écho de la sélection du joueur : écarté s’il se trompe avec le joueur, jamais pris pour une fuite', () => {
  const r = analyze(simulate({ profile: 'L0', seed: 3, accuracy: 0.8 })); // 11/12 bonnes réponses : coïncidence
  assert.equal(r.verdict, 'NO_PREMATURE_DISCLOSURE');
  assert.ok(r.ignored.some((i) => i.reason === 'echo' && /content~json\.choice\|/.test(i.id)), JSON.stringify(r.ignored));
  assert.equal(early(r).length, 0);
});

test('joueur toujours juste : écho et fuite après réponse sont indiscernables → verdict prudent', () => {
  const clean = analyze(simulate({ profile: 'L0', accuracy: 1 }));
  assert.equal(clean.verdict, 'INCONCLUSIVE_PLAYER_ECHO');
  assert.ok(early(clean).every((c) => c.ambiguous));
  const leaky = analyze(simulate({ profile: 'L4', accuracy: 1 }));
  assert.equal(leaky.verdict, 'INCONCLUSIVE_PLAYER_ECHO'); // la mesure doit être refaite avec des réponses fausses
});

test('joueur toujours juste : une fuite AVANT la réponse reste détectée sans ambiguïté', () => {
  const r = analyze(simulate({ profile: 'L1', accuracy: 1 }));
  assert.equal(r.verdict, 'LEAK_BEFORE_ANSWER');
  assert.ok(r.candidates.filter((c) => c.worstPhase === 'pre_answer').every((c) => !c.ambiguous));
});

test('indépendance vis-à-vis du nom des champs (alias aléatoires)', () => {
  const cases = [
    ['L1', { flag: 'zq7' }, /choices\[\]\.zq7$/],
    ['L2', { container: 'x', ref: 'k1', sig: 'k2' }, /x\.k1~b64$/],
    ['L3', { flag: 'v' }, /choices\[\]\.v$/],
    ['L4', { solution: 'w' }, /content~json\.w$/],
  ];
  for (const [profile, keys, re] of cases) {
    const r = analyze(simulate({ profile, keys }));
    assert.equal(r.verdict, PROFILES[profile].expected.verdict, profile);
    assert.ok(early(r).some((c) => re.test(c.template)), `${profile} : ${early(r).map((c) => c.template)}`);
  }
});

test('robustesse statistique sur 30 graines : aucun faux positif sur L0, aucune fuite manquée', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const clean = analyze(simulate({ profile: 'L0', seed, accuracy: seed % 3 ? 0.6 : 0.8 }));
    assert.equal(early(clean).length, 0, `faux positif L0 graine ${seed}: ${early(clean).map((c) => c.template)}`);
    for (const id of ['L1', 'L2', 'L3', 'L4']) {
      const r = analyze(simulate({ profile: id, seed }));
      assert.equal(r.verdict, PROFILES[id].expected.verdict, `${id} graine ${seed}`);
    }
  }
});

test('les trames sortantes (choix du joueur) ne sont jamais prises pour une fuite', () => {
  const cap = simulate({ profile: 'L0', accuracy: 1 }); // le joueur répond toujours juste
  // sans l'accusé (qui répète le choix), seules les trames sortantes corrèlent avec la vérité
  const noAck = { ...cap, frames: cap.frames.filter((f) => !/answerAck/.test(f.data)) };
  const r = analyze(noAck);
  assert.equal(r.verdict, 'NO_PREMATURE_DISCLOSURE');
  assert.equal(early(r).length, 0);
});

test('données insuffisantes : moins de questions que le minimum', () => {
  const r = analyze(simulate({ profile: 'L1', questions: 3 }));
  assert.equal(r.verdict, 'INSUFFICIENT_DATA');
});

test('un champ constant ou corrélé au hasard n’est pas retenu', () => {
  const cap = simulate({ profile: 'L0', seed: 5 });
  const r = analyze(cap);
  const templates = r.candidates.map((c) => c.template).join(' ');
  for (const decoy of ['shuffleSeed', 'serverTime', 'answerCounts', 'timeAvailable', 'quizQuestionAnswers', 'questionIndex', 'rank']) {
    assert.ok(!templates.includes(decoy), `leurre ${decoy} retenu à tort`);
  }
});

test('précision : les durées mesurées correspondent aux horodatages de la capture', () => {
  const cap = simulate({ profile: 'L1', seed: 3 });
  const r = analyze(cap);
  const flag = r.candidates.find((c) => c.variant === 'array:flag');
  const t0 = r.timeline.find((e) => e.q === 4);
  const hit = flag.perQuestion.find((h) => h.q === 4);
  assert.equal(hit.t, t0.tQuestion);
  assert.equal(hit.leadToAnswerMs, Math.round((t0.tAnswer - t0.tQuestion) * 10) / 10);
});

test('l’analyseur n’importe aucune API Node (réutilisable dans un navigateur)', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  for (const file of walk(new URL('../analyzer', import.meta.url).pathname)) {
    const src = readFileSync(file, 'utf8');
    assert.ok(!/from ['"]node:|require\(|Buffer\./.test(src), `${file} dépend de Node`);
  }
});
