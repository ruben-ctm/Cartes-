#!/usr/bin/env node
/**
 * Vérification de bout en bout dans un VRAI Chromium : démarre le serveur de démonstration,
 * joue une partie avec un vrai onglet joueur (host-bot.js côté hôte), l'extension MV3 chargée
 * normalement (--load-extension, aucune API de test), observe le trafic réel, puis lit le
 * verdict dans le tableau de bord de l'extension lui-même (pas de raccourci par le serveur).
 *
 * N'est PAS lancé par `npm test` (il a besoin d'un Chromium pilotable, via Playwright, et
 * dans un conteneur sans affichage, d'un serveur X virtuel — voir README « Vérifier soi-même »).
 *
 * Usage : xvfb-run -a node test/chromium-check.mjs [scenario1 scenario2 …]   (défaut : L0 L1 L4)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { server } from '../demo-app/server.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXT_PATH = join(ROOT, 'demo-extension');
const SCENARIOS = process.argv.slice(2).length ? process.argv.slice(2) : ['L0', 'L1', 'L4'];
const EXPECTED = { L0: 'NO_PREMATURE_DISCLOSURE', L1: 'LEAK_BEFORE_ANSWER', L2: 'LEAK_BEFORE_ANSWER', L3: 'LEAK_BEFORE_ANSWER', L4: 'LEAK_AFTER_ANSWER' };

const log = (...a) => console.log('[chromium-check]', ...a);

function runHostBot(port, scenario) {
  return new Promise((resolve, reject) => {
    // Graine fixée : avec peu de questions, un tirage aléatoire peut inclure plusieurs
    // questions vrai/faux (k=2 choix), où deviner juste 6 fois par hasard est assez probable
    // pour que même une vraie fuite ne franchisse pas le seuil statistique strict (p < 1e-3).
    // La graine 4 ne tire que des questions à 4 choix sur ce lot — voir README « Limites ».
    const child = spawn(process.execPath, [join(ROOT, 'demo-app', 'host-bot.js'), '--port', port, '--scenario', scenario, '--count', '8', '--time', '2', '--revealDelay', '600', '--seed', '4'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let code = null;
    child.stdout.on('data', (d) => {
      const m = /code : ([A-Z0-9]{5})/.exec(d.toString());
      if (m && !code) { code = m[1]; resolve({ code, child }); }
    });
    child.once('error', reject);
    child.once('exit', (c) => { if (!code) reject(new Error(`host-bot terminé sans code de partie (exit ${c})`)); });
  });
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  log(`serveur de démonstration : http://127.0.0.1:${port}/`);

  const profileDir = mkdtempSync(join(tmpdir(), 'leaklab-chromium-'));
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, // chargé sous xvfb-run : voir le commentaire d'en-tête
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 10000 }));
  const extId = new URL(sw.url()).host;
  log(`extension chargée : ${extId}`);

  const results = {};
  try {
    for (const scenario of SCENARIOS) {
      log(`--- scénario ${scenario} ---`);
      const { code, child } = await runHostBot(port, scenario);
      log(`partie créée, code=${code}`);

      const player = await ctx.newPage();
      const pageErrors = [];
      player.on('pageerror', (e) => pageErrors.push(String(e)));
      await player.goto(`http://127.0.0.1:${port}/player.html`);
      await player.fill('#code', code);
      await player.fill('#name', 'Chromium');
      await player.click('#joinBtn');
      // Répond à chaque question dès qu'un choix est cliquable, comme le ferait un vrai
      // joueur, jusqu'à la fin de la partie — sans jamais lire la bonne réponse dans la page.
      const answerLoop = setInterval(() => {
        player.locator('#choices button:not([disabled])').first().click({ timeout: 300 }).catch(() => {});
      }, 180);
      try { await player.waitForSelector('#over:not([hidden])', { timeout: 60000 }); } finally { clearInterval(answerLoop); }
      log('partie jouée jusqu’au bout dans un vrai onglet Chromium (joueur réel qui répond, trafic réel)');
      if (pageErrors.length) throw new Error(`Erreurs JS sur la page joueur : ${pageErrors.join(' | ')}`);

      const dash = await ctx.newPage();
      await dash.goto(`chrome-extension://${extId}/ui/dashboard.html`);
      await dash.waitForSelector('#session option', { state: 'attached' }); // <option> n'est jamais "visible" pour Playwright
      await dash.fill('#roomCode', code);
      await dash.click('#keyBtn');
      await dash.waitForFunction(() => document.getElementById('verdict')?.querySelector('strong')?.textContent?.length > 0, { timeout: 10000 });
      // Laisse le filet de sécurité (poll 1.5 s) faire au moins un tour après la clé.
      await dash.waitForTimeout(1800);
      const verdictText = await dash.textContent('#verdict strong');
      const laneCount = await dash.locator('g.lane').count();
      const screenshot = join(ROOT, 'test', `chromium-check-${scenario}.png`);
      await dash.screenshot({ path: screenshot, fullPage: true });
      log(`verdict affiché dans le tableau de bord de l'extension : "${verdictText}" (${laneCount} question(s) sur la chronologie)`);
      log(`capture d'écran : ${screenshot}`);

      const ok = verdictLooksLike(verdictText, EXPECTED[scenario]);
      results[scenario] = { verdictText, laneCount, ok };
      if (!ok) log(`⚠ attendu un verdict de type ${EXPECTED[scenario]}, texte obtenu : "${verdictText}"`);

      await player.close(); await dash.close();
      child.kill();
    }
  } finally {
    await ctx.close();
    rmSync(profileDir, { recursive: true, force: true });
    server.close();
  }

  log('--- résumé ---');
  let allOk = true;
  for (const [scenario, r] of Object.entries(results)) { log(`${r.ok ? '✔' : '✘'} ${scenario} : ${r.verdictText}`); allOk &&= r.ok; }
  process.exit(allOk ? 0 : 1);
}

const LABELS = {
  NO_PREMATURE_DISCLOSURE: /aucune divulgation/i,
  LEAK_BEFORE_ANSWER: /avant la réponse/i,
  LEAK_AFTER_ANSWER: /après la réponse/i,
};
function verdictLooksLike(text, expected) { return LABELS[expected]?.test(text ?? '') ?? false; }

main().catch((err) => { console.error('[chromium-check] ÉCHEC', err); process.exit(1); });
