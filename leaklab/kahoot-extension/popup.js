const $ = id => document.getElementById(id);
const STORE_KEY = "leaklabCaptureState";
let currentState = null;
async function send(type) { return chrome.runtime.sendMessage({type}); }
function setStatus(message, isError = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", isError);
}
function formatTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleTimeString("fr-FR", {hour:"2-digit",minute:"2-digit",second:"2-digit",fractionalSecondDigits:3});
}
function addCell(row, text, className = "") {
  const cell = document.createElement("span");
  cell.textContent = text ?? "";
  if (className) cell.className = className;
  row.appendChild(cell);
}
function renderAnswers(detections) {
  const root = $("answers");
  root.replaceChildren();
  $("answerCount").textContent = String(detections.length);
  if (!detections.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Aucune valeur de correction détectée. Cela ne signifie pas nécessairement qu'aucune donnée n'a été envoyée.";
    root.appendChild(empty);
    return;
  }
  for (const item of [...detections].reverse().slice(0, 50)) {
    const card = document.createElement("article");
    card.className = "answer-card";
    const head = document.createElement("div");
    head.className = "answer-head";
    addCell(head, "Question " + (Number.isInteger(item.questionIndex) ? item.questionIndex + 1 : "non identifiée"), "answer-question");
    addCell(head, formatTime(item.time), "event-time");
    card.appendChild(head);
    const label = document.createElement("div");
    label.className = "answer-label";
    label.textContent = item.field || "Champ de correction";
    card.appendChild(label);
    const value = document.createElement("pre");
    value.className = "answer-value";
    value.textContent = item.value ?? "[valeur vide]";
    card.appendChild(value);
    const endpoint = document.createElement("div");
    endpoint.className = "event-meta";
    endpoint.textContent = item.endpoint || "";
    card.appendChild(endpoint);
    root.appendChild(card);
  }
}
function renderEvents(events) {
  const root = $("events");
  root.replaceChildren();
  $("eventCount").textContent = events.length + (events.length > 1 ? " événements" : " événement");
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Aucun événement pour le moment.";
    root.appendChild(empty);
    return;
  }
  for (const event of [...events].reverse().slice(0, 100)) {
    const row = document.createElement("div");
    row.className = "event";
    const top = document.createElement("div");
    top.className = "event-top";
    addCell(top, formatTime(event.time), "event-time");
    addCell(top, event.direction || "système", "direction");
    row.appendChild(top);
    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = event.kind || "événement";
    row.appendChild(title);
    const details = [];
    if (event.endpoint) details.push(event.endpoint);
    if (event.channel) details.push(event.channel);
    if (event.eventType) details.push("type : " + event.eventType);
    if (Number.isInteger(event.questionIndex)) details.push("question : " + (event.questionIndex + 1));
    if (event.payloadBytes) details.push(event.payloadBytes + " caractères");
    if (details.length) {
      const meta = document.createElement("div");
      meta.className = "event-meta";
      meta.textContent = details.join(" · ");
      row.appendChild(meta);
    }
    const flags = [];
    if (event.correctionFieldDetected) flags.push("Champ de correction détecté");
    if (event.submissionFieldDetected) flags.push("Champ de soumission détecté");
    if (event.answerDetectionCount) flags.push(event.answerDetectionCount + " valeur(s) de correction extraite(s)");
    if (flags.length) {
      const flag = document.createElement("div");
      flag.className = "flag";
      flag.textContent = flags.join(" · ");
      row.appendChild(flag);
    }
    if (event.detectedFieldNames?.length) {
      const fields = document.createElement("div");
      fields.className = "event-meta";
      fields.textContent = "Champs : " + event.detectedFieldNames.join(", ");
      row.appendChild(fields);
    }
    if (event.statusFlags?.length) {
      const flagsText = event.statusFlags.map(flag => flag.field + " = " + flag.value).join(" · ");
      const status = document.createElement("div");
      status.className = "event-meta";
      status.textContent = "Indicateurs : " + flagsText;
      row.appendChild(status);
    }
    root.appendChild(row);
  }
}
function renderTiming(events) {
  const corrections = events.filter(e => e.correctionFieldDetected && e.direction === "entrant").sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const submissions = events.filter(e => e.submissionFieldDetected && e.direction === "sortant").sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  if (!corrections.length || !submissions.length) {
    $("timing").textContent = "Il faut au moins un champ de correction entrant et une soumission sortante pour comparer leur ordre d'arrivée.";
    return;
  }
  const correction = corrections.find(c => submissions.some(s => c.questionIndex !== null && c.questionIndex !== undefined && s.questionIndex === c.questionIndex)) || corrections[0];
  const submission = submissions.find(s => correction.questionIndex !== null && correction.questionIndex !== undefined && s.questionIndex === correction.questionIndex) || submissions[0];
  const delta = Date.parse(correction.time) - Date.parse(submission.time);
  const questionLabel = Number.isInteger(correction.questionIndex) ? " pour la question " + (correction.questionIndex + 1) : "";
  if (delta < 0) $("timing").textContent = "Champ de correction entrant détecté" + questionLabel + " " + Math.abs(delta) + " ms avant la soumission sortante comparée.";
  else if (delta > 0) $("timing").textContent = "Champ de correction entrant détecté" + questionLabel + " " + delta + " ms après la soumission sortante comparée.";
  else $("timing").textContent = "Les deux événements ont le même horodatage à la précision disponible.";
}
function render(state) {
  currentState = state;
  const events = Array.isArray(state.events) ? state.events : [];
  const corrections = events.filter(e => e.correctionFieldDetected);
  const submissions = events.filter(e => e.submissionFieldDetected);
  $("frameCount").textContent = events.filter(e => e.kind?.startsWith("trame")).length;
  $("socketCount").textContent = state.connectionCount || 0;
  $("correctionCount").textContent = corrections.length;
  $("submissionCount").textContent = submissions.length;
  $("statusPill").textContent = state.status === "capturing" ? "Capture active" : state.status === "starting" ? "Démarrage…" : state.status === "stopped" ? "Arrêtée" : "Inactive";
  $("statusPill").className = "pill " + (state.status === "capturing" ? "active" : "");
  $("start").disabled = state.status === "capturing" || state.status === "starting";
  $("stop").disabled = state.status !== "capturing";
  $("export").disabled = events.length === 0;
  $("clear").disabled = state.status === "capturing";
  if (state.status === "capturing") setStatus("Capture active sur l'onglet Kahoot. Les trames entrantes sont analysées localement.");
  else if (state.error) setStatus(state.error, true);
  else if (state.status === "stopped") setStatus("Capture arrêtée. Tu peux exporter le rapport ou effacer le journal.");
  else setStatus("Ouvre l'onglet de la session de test, puis démarre la capture.");
  renderTiming(events);
  renderAnswers(Array.isArray(state.answerDetections) ? state.answerDetections : []);
  renderEvents(events);
}
async function refresh() {
  try {
    const result = await send("GET_STATE");
    if (result?.ok) render(result.state);
    else setStatus(result?.error || "Impossible de lire l'état.", true);
  } catch (error) { setStatus(error?.message || String(error), true); }
}
$("start").addEventListener("click", async () => {
  $("start").disabled = true;
  setStatus("Connexion à l'onglet actif…");
  try {
    const result = await send("START_CAPTURE");
    if (!result?.ok) setStatus(result?.error || "Démarrage impossible.", true);
    if (result?.state) render(result.state); else await refresh();
  } catch (error) { setStatus(error?.message || String(error), true); }
});
$("stop").addEventListener("click", async () => {
  $("stop").disabled = true;
  try {
    const result = await send("STOP_CAPTURE");
    if (result?.state) render(result.state); else await refresh();
  } catch (error) { setStatus(error?.message || String(error), true); }
});
$("clear").addEventListener("click", async () => {
  try {
    const result = await send("CLEAR_LOG");
    if (result?.ok) render(result.state); else setStatus(result?.error || "Impossible d'effacer le journal.", true);
  } catch (error) { setStatus(error?.message || String(error), true); }
});
$("export").addEventListener("click", () => {
  if (!currentState) return;
  const report = {
    tool:"Leaklab Live WebSocket Audit",
    exportedAt:new Date().toISOString(),
    startedAt:currentState.startedAt,
    stoppedAt:currentState.stoppedAt,
    connectionCount:currentState.connectionCount,
    answerDetections:currentState.answerDetections || [],
    events:(currentState.events || []).map(e => ({
      time:e.time,direction:e.direction,kind:e.kind,endpoint:e.endpoint,channel:e.channel,
      eventType:e.eventType,questionIndex:e.questionIndex,
      correctionFieldDetected:e.correctionFieldDetected,
      submissionFieldDetected:e.submissionFieldDetected,
      detectedFieldNames:e.detectedFieldNames,statusFlags:e.statusFlags,
      answerDetectionCount:e.answerDetectionCount,payloadBytes:e.payloadBytes
    }))
  };
  const blob = new Blob([JSON.stringify(report,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leaklab-audit-" + new Date().toISOString().replace(/[:.]/g,"-") + ".json";
  a.click();
  URL.revokeObjectURL(url);
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes[STORE_KEY]?.newValue) render(changes[STORE_KEY].newValue);
});
refresh();
