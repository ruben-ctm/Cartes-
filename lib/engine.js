import { randomBytes, randomInt, createHash } from 'node:crypto';

export const PACKS = ['classic', 'uno'];
export const MAX_PLAYERS = 100;
export class GameError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const hashToken = token => createHash('sha256').update(token).digest('hex');
export const uid = () => randomBytes(12).toString('hex');
export const roomCode = () => Array.from({length:6},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('');
export function shuffle(cards) { for(let i=cards.length-1;i>0;i--){const j=randomInt(i+1);[cards[i],cards[j]]=[cards[j],cards[i]];}return cards; }
export function validateName(name) { if(typeof name!=='string')throw new GameError('Choisis un pseudo.');name=name.trim().replace(/[\u0000-\u001f\u007f]/g,'');if(!name||name.length>20)throw new GameError('Le pseudo doit contenir 1 à 20 caractères.');return name; }
function int(value,min,max,label){if(!Number.isInteger(value)||value<min||value>max)throw new GameError(label);return value;}
function position(cmd){const x=cmd.x??50,y=cmd.y??50;if(!Number.isFinite(x)||!Number.isFinite(y))throw new GameError('Position invalide.');return {x:Math.max(7,Math.min(93,x)),y:Math.max(10,Math.min(90,y))};}
export function makeDeck(pack='classic',copies=1){
 if(!PACKS.includes(pack))throw new GameError('Jeu de cartes inconnu.');int(copies,1,4,'Choisis de 1 à 4 paquets.');const cards=[];
 for(let n=0;n<copies;n++){
  if(pack==='classic'){for(const suit of ['♠','♥','♦','♣'])for(let v=1;v<=13;v++)cards.push({id:uid(),suit,value:String(v),pack});}
  else {for(const color of ['red','yellow','green','blue']){cards.push({id:uid(),color,value:'0',pack});for(const value of ['1','2','3','4','5','6','7','8','9','skip','reverse','+2'])for(let k=0;k<2;k++)cards.push({id:uid(),color,value,pack});}for(let k=0;k<4;k++){cards.push({id:uid(),color:'wild',value:'wild',pack});cards.push({id:uid(),color:'wild',value:'+4',pack});}}
 }return shuffle(cards);
}
function player(name,token){return {id:uid(),name:validateName(name),tokenHash:hashToken(token),hand:[],active:true};}
function log(room,text){room.log.push(text);room.log=room.log.slice(-16);}
export function makeRoom(code,pack,name,token,options={},now=Date.now()){
 const p=player(name,token);const copies=options.copies??1;const deck=makeDeck(pack,copies);
 const room={code,pack,copies,version:1,players:[p],host:p.id,createdAt:now,updatedAt:now,expiresAt:now+21600000,deck,table:[],discard:[],log:['La table est ouverte. À vous de choisir les règles.'],processed:[],closed:false};
 if(options.layout==='circle')circle(room,Math.min(deck.length,options.circleCount??20));return room;
}
export function authenticate(room,token){const p=room.players.find(p=>p.active&&p.tokenHash===hashToken(token||''));if(!p)throw new GameError('Rejoins cette table pour continuer.',403);return p;}
export function join(room,name,token){
 if(room.closed)throw new GameError('Cette table est fermée.',404);
 const existing=room.players.find(p=>p.tokenHash===hashToken(token));if(existing){existing.active=true;existing.name=validateName(name);return false;}
 if(room.players.filter(p=>p.active).length>=MAX_PLAYERS)throw new GameError('La table est complète.',409);
 room.players=room.players.filter(p=>p.active);room.players.push(player(name,token));log(room,validateName(name)+' rejoint la table.');return true;
}
function takeFrom(array,id){const index=array.findIndex(c=>c.id===id);if(index<0)throw new GameError('Cette carte a déjà été déplacée.',409);return array.splice(index,1)[0];}
function plain(c){const {x,y,faceUp,owner,...base}=c;return base;}
function circle(room,count){int(count,1,52,'Le cercle contient de 1 à 52 cartes.');if(room.deck.length<count)throw new GameError('Il n’y a pas assez de cartes dans la pioche.');for(let i=0;i<count;i++){const a=2*Math.PI*i/count-Math.PI/2;room.table.push({...room.deck.pop(),x:50+35*Math.cos(a),y:50+35*Math.sin(a),faceUp:false,owner:null});}}
export function command(room,token,cmd){
 if(!cmd||typeof cmd.type!=='string')throw new GameError('Action invalide.');const p=authenticate(room,token);if(room.closed)throw new GameError('Table fermée.',404);
 if(cmd.type==='draw'){const count=int(cmd.count??1,1,20,'Tu peux piocher de 1 à 20 cartes.');if(room.deck.length<count)throw new GameError('Il ne reste pas assez de cartes dans la pioche.');for(let i=0;i<count;i++)p.hand.push(room.deck.pop());log(room,p.name+' pioche '+count+' carte'+(count>1?'s.':'.'));}
 else if(cmd.type==='place'){const c=takeFrom(p.hand,cmd.cardId);room.table.push({...c,...position(cmd),faceUp:cmd.faceUp!==false,owner:p.id});log(room,p.name+' pose une carte.');}
 else if(cmd.type==='discard'){let c;if(cmd.source==='table')c=takeFrom(room.table,cmd.cardId);else c=takeFrom(p.hand,cmd.cardId);room.discard.push(plain(c));log(room,p.name+' défausse une carte.');}
 else if(cmd.type==='flip'){const c=room.table.find(c=>c.id===cmd.cardId);if(!c)throw new GameError('Carte introuvable.',409);if(typeof cmd.expectedFaceUp==='boolean'&&cmd.expectedFaceUp!==c.faceUp)throw new GameError('Cette carte vient d’être retournée.',409);c.faceUp=!c.faceUp;log(room,p.name+' retourne une carte.');}
 else if(cmd.type==='move'){const c=takeFrom(room.table,cmd.cardId);Object.assign(c,position(cmd));room.table.push(c);}
 else if(cmd.type==='take'){const c=cmd.source==='discard'?room.discard.pop():takeFrom(room.table,cmd.cardId);if(!c)throw new GameError('La défausse est vide.');p.hand.push(plain(c));log(room,p.name+' récupère une carte.');}
 else if(cmd.type==='give'){const target=room.players.find(other=>other.id===cmd.playerId&&other.active);if(!target||target.id===p.id)throw new GameError('Choisis un autre joueur.');target.hand.push(takeFrom(p.hand,cmd.cardId));log(room,p.name+' donne une carte à '+target.name+'.');}
 else if(cmd.type==='return'){const c=takeFrom(p.hand,cmd.cardId);room.deck.push(c);log(room,p.name+' remet une carte sur la pioche.');}
 else if(cmd.type==='shuffle'){shuffle(room.deck);log(room,p.name+' mélange la pioche.');}
 else if(cmd.type==='recycle'){room.deck.push(...room.discard);room.discard=[];shuffle(room.deck);log(room,p.name+' mélange la défausse dans la pioche.');}
 else if(cmd.type==='circle'){const count=int(cmd.count??20,1,52,'Le cercle contient de 1 à 52 cartes.');circle(room,count);log(room,p.name+' dispose '+count+' cartes en cercle.');}
 else if(cmd.type==='deal'){const count=int(cmd.count??3,1,20,'Distribue de 1 à 20 cartes par personne.');const active=room.players.filter(other=>other.active);if(room.deck.length<count*active.length)throw new GameError('Pas assez de cartes pour distribuer à tout le monde.');for(let i=0;i<count;i++)for(const other of active)other.hand.push(room.deck.pop());log(room,p.name+' distribue '+count+' cartes à chacun.');}
 else if(cmd.type==='counter'){if(cmd.value!==undefined)room.counter=int(cmd.value,-9999,9999,'Valeur invalide.');else {const delta=int(cmd.delta,-99,99,'Valeur invalide.');room.counter=Math.max(-9999,Math.min(9999,(room.counter||0)+delta));}}
 else if(cmd.type==='reset'){
  if(room.host!==p.id)throw new GameError('Seul l’hôte peut remettre toute la table à zéro.',403);
  const pack=cmd.pack??room.pack,copies=cmd.copies??room.copies;const deck=makeDeck(pack,copies);room.pack=pack;room.copies=copies;room.deck=deck;room.discard=[];room.table=[];room.counter=0;for(const other of room.players)other.hand=[];log(room,'L’hôte remet la table à zéro.');
 }
 else if(cmd.type==='leave'){
  room.deck.push(...p.hand);p.hand=[];p.active=false;const active=room.players.filter(other=>other.active);if(!active.length)room.closed=true;else if(room.host===p.id)room.host=active[0].id;log(room,p.name+' quitte la table.');
 }
 else throw new GameError('Action inconnue.');return true;
}
export function view(room,token,now=Date.now()){
 const p=authenticate(room,token);
 return {code:room.code,pack:room.pack,copies:room.copies,version:room.version,host:room.host,you:p.id,players:room.players.filter(p=>p.active).map(({id,name,hand})=>({id,name,count:hand.length})),hand:p.hand,table:room.table.map(c=>c.faceUp?c:{id:c.id,x:c.x,y:c.y,faceUp:false,owner:c.owner,pack:c.pack}),discardTop:room.discard.at(-1)||null,discardCount:room.discard.length,deckCount:room.deck.length,counter:room.counter||0,log:room.log,closed:room.closed,serverTime:now};
}
