import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import handler from './api/rooms.js';
const root=resolve('public');
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 res.status=n=>{res.statusCode=n;return res;};res.json=obj=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(obj));};
 if(url.pathname==='/api/rooms'){req.query=Object.fromEntries(url.searchParams);let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){res.status(413).json({error:'Requête trop volumineuse.'});return;}}try{req.body=body?JSON.parse(body):null;}catch{res.status(400).json({error:'JSON invalide.'});return;}await handler(req,res);return;}
 try{const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(root+'/'))throw new Error();const data=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(data);}catch{res.statusCode=404;res.end('Not found');}
}).listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Tableclub: http://localhost:'+(process.env.PORT||3000)));
