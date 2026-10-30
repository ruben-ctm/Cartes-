const $ = id => document.getElementById(id);
const STORE_KEY = "leaklabCaptureState";
let currentState = null;
async function send(type){return chrome.runtime.sendMessage({type});}
function setStatus(message,isError=false){
  $("status").textContent=message;
  $("status").classList.toggle("error",isError);
}
function formatTime(value){
  if(!value)return "—";
  const d=new Date(value);
  return Number.isNaN(d.getTime())?value:d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit",second:"2-digit",fractionalSecondDigits:3});
}
function addCell(parent,text,className=""){
  const el=document.createElement("span");
  el.textContent=text??"";
  if(className)el.className=className;
  parent.appendChild(el);
}
function renderEvents(events){
  const root=$("events");
  root.replaceChildren();
  $("eventCount").textContent=events.length+(events.length>1?" événements":" événement");
  if(!events.length){
    const empty=document.createElement("p");empty.className="empty";empty.textContent="Aucun événement pour le moment.";root.appendChild(empty);return;
  }
  for(const event of [...events].reverse().slice(0,160)){
    const row=document.createElement("article");row.className="event";
    const top=document.createElement("div");top.className="event-top";
    addCell(top,formatTime(event.time),"event-time");addCell(top,event.direction||"système","direction");row.appendChild(top);
    const title=document.createElement("div");title.className="event-title";title.textContent=event.kind||"événement";row.appendChild(title);
    const details=[];
    if(event.endpoint)details.push(event.endpoint);
    if(event.channel)details.push(event.channel);
    if(event.eventType)details.push("type : "+event.eventType);
    if(Number.isInteger(event.questionIndex))details.push("question : "+(event.questionIndex+1));
    if(event.payloadBytes)details.push(event.payloadBytes+" caractères");
    if(details.length){const meta=document.createElement("div");meta.className="event-meta";meta.textContent=details.join(" · ");row.appendChild(meta);}
    const flags=[];
    if(event.correctionFieldDetected)flags.push("Champ de correction repéré — valeur masquée");
    if(event.submissionFieldDetected)flags.push("Champ de soumission repéré — valeur masquée");
    if(flags.length){const flag=document.createElement("div");flag.className="flag";flag.textContent=flags.join(" · ");row.appendChild(flag);}
    if(event.detectedFieldNames?.length){const fields=document.createElement("div");fields.className="event-meta";fields.textContent="Noms des champs : "+event.detectedFieldNames.join(", ");row.appendChild(fields);}
    root.appendChild(row);
  }
}
function renderTiming(events){
  const corrections=events.filter(e=>e.correctionFieldDetected&&e.direction==="entrant").sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const submissions=events.filter(e=>e.submissionFieldDetected&&e.direction==="sortant").sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  if(!corrections.length||!submissions.length){$("timing").textContent="Il faut au moins un champ de correction entrant et une soumission sortante pour comparer leur ordre.";return;}
  const correction=corrections[0],submission=submissions[0],delta=Date.parse(correction.time)-Date.parse(submission.time);
  if(delta<0)$("timing").textContent="Un champ de correction a été repéré "+Math.abs(delta)+" ms avant la première soumission sortante détectée.";
  else if(delta>0)$("timing").textContent="Le premier champ de correction repéré arrive "+delta+" ms après la première soumission sortante détectée.";
  else $("timing").textContent="Les événements ont le même horodatage à la précision disponible.";
}
function render(state){
  currentState=state;
  const events=Array.isArray(state.events)?state.events:[];
  const corrections=events.filter(e=>e.correctionFieldDetected);
  const submissions=events.filter(e=>e.submissionFieldDetected);
  $("frameCount").textContent=events.filter(e=>e.kind?.startsWith("trame")).length;
  $("socketCount").textContent=state.connectionCount||0;
  $("correctionCount").textContent=corrections.length;
  $("submissionCount").textContent=submissions.length;
  $("statusPill").textContent=state.status==="capturing"?"Capture active":state.status==="starting"?"Démarrage…":state.status==="stopped"?"Arrêtée":"Inactif";
  $("statusPill").className="pill "+(state.status==="capturing"?"active":"");
  $("start").disabled=state.status==="capturing"||state.status==="starting";
  $("stop").disabled=state.status!=="capturing";
  $("export").disabled=events.length===0;
  $("clear").disabled=state.status==="capturing";
  if(state.status==="capturing")setStatus("Capture active — le panneau reste disponible pendant la navigation.");
  else if(state.error)setStatus(state.error,true);
  else if(state.status==="stopped")setStatus("Capture arrêtée. Tu peux exporter le rapport ou effacer le journal.");
  else setStatus("Ouvre l'onglet Kahoot, puis démarre la capture.");
  renderTiming(events);
  renderEvents(events);
}
async function refresh(){
  try{const result=await send("GET_STATE");if(result?.ok)render(result.state);else setStatus(result?.error||"Impossible de lire l'état.",true);}
  catch(error){setStatus(error?.message||String(error),true);}
}
$("start").addEventListener("click",async()=>{
  $("start").disabled=true;setStatus("Connexion à l'onglet actif…");
  try{const result=await send("START_CAPTURE");if(!result?.ok)setStatus(result?.error||"Démarrage impossible.",true);if(result?.state)render(result.state);else await refresh();}
  catch(error){setStatus(error?.message||String(error),true);}
});
$("stop").addEventListener("click",async()=>{
  $("stop").disabled=true;
  try{const result=await send("STOP_CAPTURE");if(result?.state)render(result.state);else await refresh();}
  catch(error){setStatus(error?.message||String(error),true);}
});
$("clear").addEventListener("click",async()=>{
  try{const result=await send("CLEAR_LOG");if(result?.ok)render(result.state);else setStatus(result?.error||"Impossible d'effacer le journal.",true);}
  catch(error){setStatus(error?.message||String(error),true);}
});
$("export").addEventListener("click",()=>{
  if(!currentState)return;
  const report={
    tool:"Leaklab Live WebSocket Audit",
    exportedAt:new Date().toISOString(),
    startedAt:currentState.startedAt,
    stoppedAt:currentState.stoppedAt,
    connectionCount:currentState.connectionCount,
    events:(currentState.events||[]).map(e=>({
      time:e.time,direction:e.direction,kind:e.kind,endpoint:e.endpoint,channel:e.channel,
      eventType:e.eventType,questionIndex:e.questionIndex,
      correctionFieldDetected:e.correctionFieldDetected,
      submissionFieldDetected:e.submissionFieldDetected,
      detectedFieldNames:e.detectedFieldNames,payloadBytes:e.payloadBytes
    }))
  };
  const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download="leaklab-audit-"+new Date().toISOString().replace(/[:.]/g,"-")+".json";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==="session"&&changes[STORE_KEY]?.newValue)render(changes[STORE_KEY].newValue);
});
refresh();
