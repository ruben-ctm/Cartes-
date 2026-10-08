import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { Redis } from '@upstash/redis';
import { GameError } from './engine.js';
const memory = new Map();
const cache = new Map();
const queues = new Map();
const redis = process.env.UPSTASH_REDIS_REST_URL ? Redis.fromEnv() : null;
const ttl=21600;
const key = code => 'rooms/'+code+'.json';
const backend = () => redis ? 'redis' : (process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN) ? 'blob' : !process.env.VERCEL ? 'memory' : 'missing';
export function storageKind(){return backend();}
export async function read(code) {
 const mode=backend();if(mode==='missing')throw new GameError('Le stockage des salons n’est pas configuré.',503);
 let room,etag;
 if(mode==='redis'){room=await redis.get(key(code));etag=room?.version;}
 else if(mode==='memory'){room=structuredClone(memory.get(code));etag=room?.version;}
 else {const result=await get(key(code),{access:'private',useCache:false});if(result?.statusCode===200){room=JSON.parse(await new Response(result.stream).text());etag=result.blob.etag;}}
 if(!room||room.expiresAt<Date.now())throw new GameError('Salon introuvable ou expiré.',404);
 return {room,etag};
}
export async function create(room) {
 const mode=backend();if(mode==='missing')throw new GameError('Le stockage n’est pas configuré.',503);
 if(mode==='redis'){return !!await redis.set(key(room.code),room,{nx:true,ex:ttl});}
 if(mode==='memory'){if(memory.has(room.code))return false;memory.set(room.code,structuredClone(room));return true;}
 try{await put(key(room.code),JSON.stringify(room),{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});return true;}catch(e){if(e instanceof BlobPreconditionFailedError||/already exists/i.test(e.message))return false;throw e;}
}
export async function write(room,etag) {
 const mode=backend();
 if(mode==='redis'){const script=`local value=redis.call('GET',KEYS[1]);if not value then return 0 end;local r=cjson.decode(value);if r.version~=tonumber(ARGV[1]) then return 0 end;redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]);return 1`;return !!await redis.eval(script,[key(room.code)],[etag,JSON.stringify(room),ttl]);}
 if(mode==='memory'){if(memory.get(room.code)?.version!==etag)return false;memory.set(room.code,structuredClone(room));return true;}
 try{await put(key(room.code),JSON.stringify(room),{access:'private',addRandomSuffix:false,allowOverwrite:true,ifMatch:etag,contentType:'application/json'});return true;}catch(e){if(e instanceof BlobPreconditionFailedError)return false;throw e;}
}
async function performMutation(code,apply) {
 for(let attempt=0;attempt<5;attempt++){const {room,etag}=await read(code);const changed=apply(room);if(changed===false)return room;room.version++;room.updatedAt=Date.now();if(await write(room,etag)){cache.delete(code);return room;}
await new Promise(resolve=>setTimeout(resolve,15+Math.random()*50));}
 throw new GameError('Le salon vient de changer. Réessaie.',409);
}

export async function readCached(code){
 const entry=cache.get(code);if(entry&&entry.until>Date.now())return entry.promise;
 const promise=read(code);cache.set(code,{promise,until:Date.now()+350});
 if(cache.size>200)for(const [key,value] of cache)if(value.until<Date.now())cache.delete(key);
 try{return await promise;}catch(e){cache.delete(code);throw e;}
}
export async function mutate(code,apply){
 const previous=queues.get(code)||Promise.resolve();
 const next=previous.catch(()=>{}).then(()=>performMutation(code,apply));queues.set(code,next);
 try{return await next;}finally{if(queues.get(code)===next)queues.delete(code);}
}
