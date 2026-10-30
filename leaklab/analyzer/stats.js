/** Utilitaires statistiques : queue d'une loi binomiale (test « mieux que le hasard »). */

const logFact = [0];
function lf(n) {
  for (let i = logFact.length; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  return logFact[n];
}

/** P(X ≥ hits) pour X ~ Binomiale(n, p), calculé en log pour rester stable. */
export function binomialTail(n, hits, p) {
  if (hits <= 0) return 1;
  if (hits > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let sum = 0;
  for (let x = hits; x <= n; x++) {
    const logTerm = lf(n) - lf(x) - lf(n - x) + x * Math.log(p) + (n - x) * Math.log(1 - p);
    sum += Math.exp(logTerm);
  }
  return Math.min(1, sum);
}
