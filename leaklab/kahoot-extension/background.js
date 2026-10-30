const STORE_KEY = "leaklabCaptureState";
const MAX_EVENTS = 500;
const MAX_DETECTIONS = 100;
const ALLOWED_HOSTS = ["kahoot.com", "kahoot.it"];
const ANSWER_KEYS = new Set(["correctchoices","correctchoice","correctanswer","correctanswers","correctoption","correctoptionid","correctanswerid","solution"]);
const STATUS_KEYS = new Set(["iscorrect","iscorrectanswer"]);
const SUBMISSION_KEYS = new Set(["choice","selectedchoice","selectedanswer","answerid"]);
let state = {status:"idle",tabId:null,tabTitle:"",startedAt:null,stoppedAt:null,events:[],answerDetections:[],connectionCount:0,error:null,socketUrls:{}};
const ready = chrome.storage.session.get(STORE_KEY).then(({[STORE_KEY]:saved}) => {if(saved && typeof saved === "object") state = {...state,...saved,answerDetections:saved.answerDetections||[]};}).catch(()=>{});
async function persist(){await chrome.storage.session.set({[STORE_KEY]:state});}
function safeEndpoint(raw){try{const u=new URL(raw);return u.origin+u.pathname;}catch{return "WebSocket";}}
function isKahootUrl(raw){try{const host=new URL(raw).hostname.toLowerCase();return ALLOWED_HOSTS.some(root=>host===root||host.endsWith("."+root));}catch{return false;}}
function parseFrame(payloadData,opcode){if(opcode!==1||typeof payloadData!=="string"||payloadData.length>200000)return null;try{return JSON.parse(payloadData);}catch{return null;}}
function safeValue(value){
 try {
  const encoded=JSON.stringify(value);
  if(encoded===undefined)return String(value);
  return encoded.length>1200?encoded.slice(0,1200)+"…":encoded;
 } catch {return "[valeur non sérialisable]";}
}
function inspectPayload(value){
 const result={correction:false,submission:false,fields:new Set(),questionIndex:null,eventType:null,channel:null,answers:[],statusFlags:[]};let visited=0;
 function walk(node,depth,inheritedQuestion=null){
  if(depth>10||visited>1500||node===null||typeof node!=="object")return;visited++;
  if(Array.isArray(node)){for(const item of node)walk(item,depth+1,inheritedQuestion);return;}
  const localQuestion=Number.isInteger(node.questionIndex)?node.questionIndex:inheritedQuestion;
  if(Number.isInteger(localQuestion))result.questionIndex=localQuestion;
  if(typeof node.type==="string"&&node.type.length<40)result.eventType=node.type;
  if(typeof node.channel==="string"&&node.channel.length<100)result.channel=node.channel;
  for(const[key,child]of Object.entries(node)){
   const k=key.toLowerCase();
   if(ANSWER_KEYS.has(k)){
    result.correction=true;result.fields.add(key);
    result.answers.push({field:key,value:safeValue(child),questionIndex:Number.isInteger(localQuestion)?localQuestion:null});
   }
   if(STATUS_KEYS.has(k)){
    result.correction=true;result.fields.add(key);
    result.statusFlags.push({field:key,value:safeValue(child),questionIndex:Number.isInteger(localQuestion)?localQuestion:null});
   }
   if(SUBMISSION_KEYS.has(k)){result.submission=true;result.fields.add(key);}
   walk(child,depth+1,localQuestion);
  }
 }
 walk(value,0);
 result.answers=result.answers.slice(0,20);
 result.statusFlags=result.statusFlags.slice(0,20);
 return result;
}
function pushEvent(event){state.events.push(event);if(state.events.length>MAX_EVENTS)state.events.splice(0,state.events.length-MAX_EVENTS);persist().catch(()=>{});}
async function stopCapture(reason=null){await ready;const tabId=state.tabId;if(tabId!==null){try{await chrome.debugger.detach({tabId});}catch{}}state.status="stopped";state.stoppedAt=new Date().toISOString();state.error=reason;await persist();return state;}
chrome.debugger.onEvent.addListener(async(source,method,params)=>{
 await ready;if(state.status!=="capturing"||source.tabId!==state.tabId)return;const now=new Date().toISOString();
 if(method==="Network.webSocketCreated"){state.connectionCount++;state.socketUrls[params.requestId]=safeEndpoint(params.url);pushEvent({time:now,direction:"système",kind:"websocket-open",endpoint:safeEndpoint(params.url),correctionFieldDetected:false,submissionFieldDetected:false});return;}
 if(method==="Network.webSocketClosed"){pushEvent({time:now,direction:"système",kind:"websocket-close",endpoint:state.socketUrls[params.requestId]||"WebSocket",correctionFieldDetected:false,submissionFieldDetected:false});delete state.socketUrls[params.requestId];persist().catch(()=>{});return;}
 if(method!=="Network.webSocketFrameReceived"&&method!=="Network.webSocketFrameSent")return;
 const frame=params.response||params;const parsed=parseFrame(frame.payloadData,frame.opcode);
 const signals=parsed===null?{correction:false,submission:false,fields:new Set(),questionIndex:null,eventType:null,channel:null,answers:[],statusFlags:[]}:inspectPayload(parsed);
 const direction=method.endsWith("Received")?"entrant":"sortant";
 if(direction==="entrant"&&signals.answers.length){
  for(const answer of signals.answers){
   const detection={time:now,questionIndex:answer.questionIndex??signals.questionIndex,field:answer.field,value:answer.value,endpoint:state.socketUrls[params.requestId]||"WebSocket"};
   state.answerDetections.push(detection);
   if(state.answerDetections.length>MAX_DETECTIONS)state.answerDetections.splice(0,state.answerDetections.length-MAX_DETECTIONS);
  }
 }
 pushEvent({time:now,direction,kind:parsed===null?(frame.opcode===1?"trame-texte-non-JSON":"trame-binaire"):"trame-json",endpoint:state.socketUrls[params.requestId]||"WebSocket",channel:signals.channel,eventType:signals.eventType,questionIndex:signals.questionIndex,correctionFieldDetected:signals.correction,submissionFieldDetected:signals.submission,detectedFieldNames:[...signals.fields],statusFlags:direction==="entrant"?signals.statusFlags:[],answerDetectionCount:direction==="entrant"?signals.answers.length:0,payloadBytes:typeof frame.payloadData==="string"?frame.payloadData.length:0});
});
chrome.debugger.onDetach.addListener(async(source,reason)=>{await ready;if(source.tabId!==state.tabId||state.status!=="capturing")return;state.status="stopped";state.stoppedAt=new Date().toISOString();state.error="Chrome a détaché l'observateur : "+reason;persist().catch(()=>{});});
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 (async()=>{
  await ready;
  if(message?.type==="GET_STATE"){sendResponse({ok:true,state});return;}
  if(message?.type==="CLEAR_LOG"){if(state.status==="capturing"){sendResponse({ok:false,error:"Arrête la capture avant d'effacer le journal."});return;}state={...state,events:[],answerDetections:[],connectionCount:0,startedAt:null,stoppedAt:null,error:null,socketUrls:{}};await persist();sendResponse({ok:true,state});return;}
  if(message?.type==="START_CAPTURE"){
   if(state.status==="capturing"){sendResponse({ok:false,error:"Une capture est déjà active."});return;}
   const[tab]=await chrome.tabs.query({active:true,currentWindow:true});
   if(!tab?.id||!tab.url||!isKahootUrl(tab.url)){sendResponse({ok:false,error:"Ouvre d'abord l'onglet de ta session Kahoot (kahoot.com ou kahoot.it), puis relance la capture."});return;}
   state={status:"starting",tabId:tab.id,tabTitle:tab.title||"Session Kahoot",startedAt:new Date().toISOString(),stoppedAt:null,events:[],answerDetections:[],connectionCount:0,error:null,socketUrls:{}};
   await persist();
   try{await chrome.debugger.attach({tabId:tab.id},"1.3");await chrome.debugger.sendCommand({tabId:tab.id},"Network.enable");state.status="capturing";pushEvent({time:new Date().toISOString(),direction:"système",kind:"capture-started",endpoint:"Onglet Kahoot",correctionFieldDetected:false,submissionFieldDetected:false});await persist();sendResponse({ok:true,state});}
   catch(error){state.status="stopped";state.error=error?.message||String(error);state.stoppedAt=new Date().toISOString();await persist();sendResponse({ok:false,error:state.error});}return;
  }
  if(message?.type==="STOP_CAPTURE"){sendResponse({ok:true,state:await stopCapture()});return;}
  sendResponse({ok:false,error:"Commande inconnue."});
 })().catch(error=>sendResponse({ok:false,error:error?.message||String(error)}));
 return true;
});
