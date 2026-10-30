#!/usr/bin/env node
/**
 * Usage :
 *   node lab/cli.js                    synthèse des 5 profils (attendu vs obtenu)
 *   node lab/cli.js --write            idem + écrit lab/fixtures/<profil>.json
 *   node lab/cli.js analyze <fichier>  analyse une capture JSON et affiche le rapport
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyze, summarize } from '../analyzer/index.js';
import { simulate } from './simulator.js';
import { PROFILES } from './profiles.js';

const args = process.argv.slice(2);

if (args[0] === 'analyze') {
  if (!args[1]) { console.error('Usage : node lab/cli.js analyze <capture.json>'); process.exit(2); }
  console.log(summarize(analyze(JSON.parse(readFileSync(args[1], 'utf8')))));
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
