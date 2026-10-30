#!/usr/bin/env node
/**
 * Usage :
 *   node lab/cli.js                    synthèse des 5 profils (attendu vs obtenu)
 *   node lab/cli.js --write            idem + écrit lab/fixtures/<profil>.json
 *   node lab/cli.js analyze <fichier>  analyse une capture JSON ou une session JSONL
 *   node lab/cli.js inspect <fichier>  liste les types de messages d'une capture
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyze, summarize, getAdapter, looksLikeJsonl, parseJsonl, captureFromRecords, inspectCapture, formatInspection } from '../analyzer/index.js';
import { simulate } from './simulator.js';
import { PROFILES } from './profiles.js';

const args = process.argv.slice(2);

function load(path) {
  const text = readFileSync(path, 'utf8');
  if (!looksLikeJsonl(text)) { const capture = JSON.parse(text); return { capture, adapter: getAdapter(capture.meta?.adapter) }; }
  const records = parseJsonl(text);
  const adapter = getAdapter(records.find((r) => r.type === 'meta')?.adapter);
  return { capture: captureFromRecords(records, { adapter }), adapter };
}

if (args[0] === 'analyze' || args[0] === 'inspect') {
  if (!args[1]) { console.error(`Usage : node lab/cli.js ${args[0]} <fichier>`); process.exit(2); }
  const { capture, adapter } = load(args[1]);
  console.log(args[0] === 'inspect' ? formatInspection(inspectCapture(capture, { adapter })) : summarize(analyze(capture, { adapter })));
} else {
  const write = args.includes('--write');
  const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
  if (write) mkdirSync(dir, { recursive: true });
  let failures = 0;
  console.log('Profil  Attendu                    Obtenu                     Phase            Champs');
  for (const id of Object.keys(PROFILES)) {
    const capture = simulate({ profile: id, seed: 1 });
    const result = analyze(capture);
    const ok = result.verdict === PROFILES[id].expected.verdict;
    if (!ok) failures++;
    const early = result.candidates.filter((c) => c.worstPhase !== 'post_correction').length;
    console.log(`${ok ? '✔' : '✘'} ${id}    ${PROFILES[id].expected.verdict.padEnd(26)} ${result.verdict.padEnd(26)} ${String(result.worstPhase).padEnd(16)} ${early} précoce(s)`);
    if (write) writeFileSync(`${dir}${id}.json`, JSON.stringify(capture, null, 1));
  }
  if (write) console.log(`\nCaptures écrites dans ${dir}`);
  process.exit(failures ? 1 : 0);
}
