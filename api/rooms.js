import { randomBytes } from 'node:crypto';
import { GameError, makeRoom, roomCode, join, command, view } from '../lib/engine.js';
import { create, readCached, mutate, storageKind } from '../lib/storage.js';
const buckets=new Map();
function limit(key,max,period){const now=Date.now();let entry=buckets.get(key);if(!entry||entry.until<now){entry={n:0,until:now+period};buckets.set(key,entry);}if(++entry.n>max)throw new GameError('Trop de requêtes. Patiente quelques secondes.',429);if(buckets.size>10000)for(const [k,v]of buckets)if(v.until<now)buckets.delete(k);}
function cookie(req){return (req.headers.cookie||'').match(/(?:^|;\s*)tableclub=([a-f0-9]{64})(?:;|$)/)?.[1];}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');throw new GameError('Méthode non autorisée.',405);}
  if(req.method==='GET'&&req.query.health==='1')return res.status(200).json({ok:storageKind()!=='missing',storage:storageKind()});
  const ip=(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'local').split(',')[0];limit(ip,6000,60000);
  let token=cookie(req);if(token)limit('read:'+token,150,60000);const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(req.method==='POST'){
   const origin=req.headers.origin;const expected=req.headers['x-forwarded-host']||req.headers.host;
   if(origin&&new URL(origin).host!==expected)throw new GameError('Origine refusée.',403);
   if(!body||JSON.stringify(body).length>4096)throw new GameError('Requête invalide.');
   if(!token){token=randomBytes(32).toString('hex');res.setHeader('Set-Cookie',`tableclub=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=21600${process.env.VERCEL?'; Secure':''}`);}
   limit(token,90,60000);
   if(body.type==='create'){limit('create:'+ip,30,3600000);for(let i=0;i<4;i++){const room=makeRoom(roomCode(),body.pack,body.name,token,{copies:body.copies,layout:body.layout});if(await create(room))return res.status(201).json(view(room,token));}throw new GameError('Réessaie de créer le salon.',503);}
   const code=String(body.code||'').toUpperCase();if(!/^[A-Z2-9]{6}$/.test(code))throw new GameError('Le code contient 6 caractères.');
   const room=await mutate(code,room=>{
    if(body.type==='join'){join(room,body.name,token);return true;}
    if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(body.requestId))throw new GameError('Identifiant de requête invalide.');
    if(room.processed.includes(body.requestId))return false;
    const changed=command(room,token,body);if(!changed)return false;room.processed.push(body.requestId);room.processed=room.processed.slice(-64);return true;
   });return res.status(200).json(body.type==='leave'?{left:true}:view(room,token));
  }
  const code=String(req.query.code||'').toUpperCase();if(!/^[A-Z2-9]{6}$/.test(code))throw new GameError('Code invalide.');if(!token)throw new GameError('Rejoins le salon.',403);
  const {room}=await readCached(code);const state=view(room,token);
  if(req.query.version===String(room.version))return res.status(200).json({unchanged:true,version:room.version,serverTime:Date.now(),closed:room.closed});
  return res.status(200).json(state);
 }catch(e){if(!(e instanceof GameError))console.error('rooms_error',{name:e.name,message:e.message});const status=e instanceof GameError?e.status:500;if(status===429)res.setHeader('Retry-After','5');return res.status(status).json({error:e instanceof GameError?e.message:'Le serveur est momentanément indisponible. Réessaie.'});}
}
