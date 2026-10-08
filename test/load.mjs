import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base=process.env.BASE_URL||'http://localhost:3000';
async function call(body,cookie){const start=performance.now();const res=await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});const data=await res.json();assert.ok(res.ok,JSON.stringify(data));return {data,cookie:res.headers.get('set-cookie')?.split(';')[0]||cookie,ms:performance.now()-start};}
const host=await call({type:'create',pack:'uno',copies:4,name:'Load0'});const {code}=host.data;const clients=[host];
for(let i=1;i<100;i++)clients.push(await call({type:'join',code,name:'Load'+i}));
const reads=[];for(let round=0;round<5;round++){await Promise.all(clients.map(async c=>{const start=performance.now();const res=await fetch(base+'/api/rooms?code='+code,{headers:{Cookie:c.cookie}});assert.ok(res.ok);const data=await res.json();assert.equal(data.players.length,100);reads.push(performance.now()-start);}));}
const writes=await Promise.all(clients.map(c=>call({type:'draw',code,count:1,requestId:randomUUID(),version:1},c.cookie)));
const final=await (await fetch(base+'/api/rooms?code='+code,{headers:{Cookie:host.cookie}})).json();assert.equal(final.deckCount,332);assert.equal(final.hand.length,1);assert.equal(final.players.every(p=>p.count===1),true);
const p95=values=>Math.round(values.sort((a,b)=>a-b)[Math.floor(values.length*.95)]*10)/10;
const report={environment:'local Node.js + in-memory storage; not Vercel performance',participants:100,parallelReads:100,totalReads:500,parallelWrites:100,readP95Ms:p95(reads),writeP95Ms:p95(writes.map(w=>w.ms)),cardsConserved:true,privateHands:true};
await writeFile('artifacts/load-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
