const $ = id => document.getElementById(id);
const sensitive = /token|authorization|cookie|password|secret|session.?id|player.?id|nickname|username|email/i;
const correctionKeys = new Set(["correctChoices","isCorrect","correctAnswer","correctAnswers","answer"]);
function scrub(value, depth = 0) {
  if (depth > 8) return "[profondeur limitée]";
  if (Array.isArray(value)) return value.slice(0, 100).map(v => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      if (sensitive.test(key)) out[key] = "[MASQUÉ]";
      else if (correctionKeys.has(key)) out[key] = "[VALEUR MASQUÉE — champ de correction détecté]";
      else out[key] = scrub(item, depth + 1);
    }
    return out;
  }
  return typeof value === "string" && value.length > 3000 ? value.slice(0, 3000) + "… [tronqué]" : value;
}
function esc(value) {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function parsePayload(raw) {
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw); } catch {
    const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) { try { return JSON.parse(raw.slice(start, end + 1)); } catch {} }
  }
  return null;
}
function flatten(value, out = []) {
  if (Array.isArray(value)) value.forEach(v => flatten(v, out));
  else if (value && typeof value === "object") {
    out.push(value);
    for (const v of Object.values(value)) flatten(v, out);
  }
  return out;
}
function renderList(id, rows, empty) {
  $(id).innerHTML = rows.length ? rows.slice(0, 80).map(row => '<div class="item"><pre>' + esc(JSON.stringify(row, null, 2)) + '</pre></div>').join("") : '<p class="muted">' + empty + '</p>';
}
$("file").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  $("status").textContent = "Lecture et analyse locales…";
  try {
    const har = JSON.parse(await file.text());
    const entries = har?.log?.entries;
    if (!Array.isArray(entries)) throw new Error("Format HAR invalide : log.entries absent.");
    const sockets = entries.filter(e => /^wss?:/i.test(e.request?.url || "")).map(e => {
      let endpoint = "URL invalide";
      try { const u = new URL(e.request.url); endpoint = u.origin + u.pathname; } catch {}
      return { endpoint, time: e.startedDateTime, status: e.response?.status };
    });
    const events = [];
    for (const entry of entries) {
      const url = entry.request?.url || "";
      const candidates = [entry.request?.postData?.text, entry.response?.content?.text].filter(Boolean);
      for (const raw of candidates) {
        const parsed = parsePayload(raw);
        if (!parsed) continue;
        for (const obj of flatten(parsed)) {
          const keys = Object.keys(obj);
          const hasCorrection = keys.some(k => correctionKeys.has(k));
          const isQuestionOrChoice = keys.some(k => ["choice","questionIndex","type"].includes(k));
          if (hasCorrection || isQuestionOrChoice) {
            events.push({
              time: entry.startedDateTime || null,
              direction: entry.request?.postData?.text === raw ? "sortant (requête)" : "entrant (réponse)",
              endpoint: (() => { try { const u = new URL(url); return u.origin + u.pathname; } catch { return "URL non disponible"; } })(),
              eventType: obj.type || "événement",
              questionIndex: Number.isInteger(obj.questionIndex) ? obj.questionIndex : undefined,
              correctionFieldDetected: hasCorrection,
              correctionValues: hasCorrection ? "[MASQUÉES]" : undefined,
              choiceSubmissionFieldDetected: keys.includes("choice")
            });
          }
        }
      }
    }
    events.sort((a,b) => String(a.time || "").localeCompare(String(b.time || "")));
    const submissions = events.filter(e => e.choiceSubmissionFieldDetected);
    const corrections = events.filter(e => e.correctionFieldDetected);
    const firstSubmission = submissions[0]?.time;
    const firstCorrection = corrections[0]?.time;
    let timing = "Données insuffisantes pour comparer les événements.";
    if (firstSubmission && firstCorrection) {
      timing = firstCorrection < firstSubmission ? "Un champ de correction apparaît avant la première soumission détectée." :
        firstCorrection > firstSubmission ? "Le premier champ de correction apparaît après la première soumission détectée." :
        "Les deux événements ont le même horodatage à la précision disponible.";
    }
    $("stats").innerHTML =
      '<div class="item">Entrées HAR : <b>' + entries.length + '</b></div>' +
      '<div class="item">Connexions WebSocket repérées : <b>' + sockets.length + '</b></div>' +
      '<div class="item">Événements pertinents analysés : <b>' + events.length + '</b></div>' +
      '<div class="item">Soumissions repérées : <b>' + submissions.length + '</b></div>' +
      '<div class="item">Champs de correction repérés : <b>' + corrections.length + '</b></div>' +
      '<div class="item"><b>Comparaison temporelle :</b><br>' + esc(timing) + '</div>';
    renderList("sockets", sockets, "Aucune connexion WebSocket trouvée dans les entrées HAR.");
    renderList("messages", events, "Aucun événement pertinent trouvé. Les exports HAR ne contiennent pas toujours les trames WebSocket.");
    $("summary").hidden = false;
    $("status").textContent = "Analyse locale terminée. Les valeurs de correction et données sensibles sont masquées.";
  } catch (error) {
    $("status").textContent = "Erreur : " + error.message;
    $("summary").hidden = true;
  }
});